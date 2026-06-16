#!/usr/bin/env python3
"""
VTOL Relay Coverage Map
5.8GHz analog FPV relay — TRUE RC X-Air Mk II patch antenna array.
Two patches on right side of carrier: 90° and 135° from vertical.
Terrain always limits range; no terrain data → 300m conservative radius.
"""

import math, time, threading, requests
from flask import Flask, render_template, jsonify, request as req

app = Flask(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
EARTH_R     = 6_371_000.0
EARTH_R_EFF = EARTH_R * 4 / 3           # k=4/3 standard atmosphere

SIYI_IP, SIYI_PORT = "192.168.144.12", 19856
N_BRG     = 72                           # polygon points (every 5°)
TERR_PTS  = 15                           # terrain samples per bearing (every ~240m at 3.6km)
QUAD_ALT  = 3.0                          # FPV quad height AGL (m) — pilot-level reception
NO_DATA_RANGE = 200.0                    # conservative radius when terrain unknown (m)

# ── 5.8GHz analog FPV link budget ────────────────────────────────────────────
FREQ_MHZ  = 5800.0
TX_DBM    = 27.8      # default 600mW VTX (configurable via API)
TX_DBI    = 2.0       # quad cloverleaf/stubby (omnidirectional)
RX_DBI    = 10.0      # TRUE RC X-Air Mk II patch gain (dBi)
RX_SENS   = -85.0     # analog video noise floor (dBm)
MARGIN_DB = 6.0       # fade margin

# ── TRUE RC X-Air Mk II patch antenna model ───────────────────────────────────
# Empirically: ~70° 3dB beamwidth → cos^n with n=3.5
# Front-to-back ratio ~20dB → back-hemisphere gain = 0
PATCH_N = 3.5

# Body frame: X=forward, Y=right, Z=down (standard aerospace, right-handed)
# "0° from sky" = [0, 0, -1] (up in body = -Z)
# Patch boresight vectors in body frame:
#   Patch 1: 90° from sky  = horizontal right = [0, 1, 0]
#   Patch 2: 135° from sky = 45° below horizontal right
#            = [0, sin(135°−from−vertical), -cos(135°−from−vertical)]
#            using angle measured from +Z_sky = [0,0,-1]:
#            at angle α: direction = [0, sin(α), -cos(α)]
#            P1 α=90°:  [0, sin90,  -cos90 ] = [0, 1.0,  0.0 ]
#            P2 α=135°: [0, sin135, -cos135] = [0, 0.707, 0.707]
_r2 = math.sqrt(0.5)
PATCH1_B = (0.0, 1.0,   0.0  )   # horizontal right
PATCH2_B = (0.0, _r2,   _r2  )   # 45° below horizontal right

# ── Shared state ──────────────────────────────────────────────────────────────
_lock = threading.Lock()
_state = dict(
    connected=False, source="offline",
    lat=None, lon=None, alt_m=100.0,
    roll=0.0, pitch=0.0, yaw=0.0, heading=0.0,
    battery_v=None, flight_mode=None, airspeed=None,
    polygon=[], seg_types=[],
    terrain_status="idle",
    boresight_km=0.0, min_range_km=0.0, max_range_km=0.0,
    vtx_dbm=TX_DBM, quad_alt=QUAD_ALT,
)

_elev: dict = {}
_elev_wide: dict = {}   # coarse 1km grid for 50×50km cursor AMSL display
_elev_lock = threading.Lock()
_ter_center = None

# Global rate limiter — OpenTopoData allows 1 req/s; shared by all prefetch threads
_api_lock = threading.Lock()
_api_last_call = 0.0

# ── Simulation state ───────────────────────────────────────────────────────────
_sim = dict(
    mode=None,           # None | "straight" | "orbit" | "mission"
    speed_ms=15.0,
    heading=0.0,         # straight mode: travel direction
    orbit_lat=None,
    orbit_lon=None,
    orbit_r=200.0,
    orbit_angle=0.0,     # current angle (radians) around orbit center
    waypoints=[],        # list of (lat, lon, alt_m) tuples
    wp_idx=0,
)

# ── Geometry ──────────────────────────────────────────────────────────────────
def _bearing_to(lat1, lon1, lat2, lon2):
    """Initial bearing from (lat1,lon1) to (lat2,lon2) in degrees [0..360)."""
    φ1, λ1 = math.radians(lat1), math.radians(lon1)
    φ2, λ2 = math.radians(lat2), math.radians(lon2)
    y = math.sin(λ2 - λ1) * math.cos(φ2)
    x = math.cos(φ1)*math.sin(φ2) - math.sin(φ1)*math.cos(φ2)*math.cos(λ2 - λ1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def _dist_m(lat1, lon1, lat2, lon2):
    """Haversine distance in metres."""
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = φ2 - φ1
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(dλ/2)**2
    return 2 * EARTH_R * math.asin(math.sqrt(a))

def dest(lat, lon, brg, dist):
    d  = dist / EARTH_R
    θ  = math.radians(brg)
    φ1, λ1 = math.radians(lat), math.radians(lon)
    φ2 = math.asin(math.sin(φ1)*math.cos(d) + math.cos(φ1)*math.sin(d)*math.cos(θ))
    λ2 = λ1 + math.atan2(math.sin(θ)*math.sin(d)*math.cos(φ1),
                          math.cos(d) - math.sin(φ1)*math.sin(φ2))
    return math.degrees(φ2), math.degrees(λ2)

def boresight_range(vtx_dbm=None):
    """Max RF range at patch antenna boresight — no terrain, no attitude loss."""
    txp = vtx_dbm if vtx_dbm is not None else TX_DBM
    with _lock:
        txp = _state.get("vtx_dbm", TX_DBM)
    pl    = txp + TX_DBI + RX_DBI - RX_SENS - MARGIN_DB
    log_d = (pl - 20*math.log10(FREQ_MHZ) + 27.55) / 20
    return 10**log_d

# ── NED ↔ body rotation ───────────────────────────────────────────────────────
def _ned_to_body(d_ned, heading_deg, pitch_deg, roll_deg):
    """
    Rotate NED direction vector into body frame (X=fwd, Y=right, Z=down).
    Standard ZYX aerospace rotation: Rx(roll)·Ry(pitch)·Rz(heading).
    Heading 0 = North, positive clockwise. Pitch positive = nose up.
    Roll positive = right wing down.
    """
    ψ  = math.radians(heading_deg)
    θ  = math.radians(pitch_deg)
    φ  = math.radians(roll_deg)
    cψ, sψ = math.cos(ψ), math.sin(ψ)
    cθ, sθ = math.cos(θ), math.sin(θ)
    cφ, sφ = math.cos(φ), math.sin(φ)
    n, e, d = d_ned

    # Rz(ψ) — align NED North with body forward for this heading
    x1 =  n*cψ + e*sψ
    y1 = -n*sψ + e*cψ
    z1 =  d

    # Ry(θ) — NED pitch convention: nose-up = -Down tilts forward
    x2 =  x1*cθ + z1*sθ
    y2 =  y1
    z2 = -x1*sθ + z1*cθ

    # Rx(φ) — right-wing-down positive
    x3 =  x2
    y3 =  y2*cφ + z2*sφ
    z3 = -y2*sφ + z2*cφ

    return (x3, y3, z3)   # (forward, right, down) in body frame

def _brg_to_ned(brg_deg, depression_m, dist_m):
    """Bearing + vertical drop → unit NED vector (N, E, Down)."""
    B = math.radians(brg_deg)
    dep_angle = math.atan2(max(depression_m, 0), max(dist_m, 1))
    ca = math.cos(dep_angle)
    return (math.cos(B)*ca, math.sin(B)*ca, math.sin(dep_angle))

# ── Antenna gain ──────────────────────────────────────────────────────────────
def _patch_gain(d_body, boresight):
    """Linear gain for one patch. dot ≤ 0 → back hemisphere → zero."""
    dot = d_body[0]*boresight[0] + d_body[1]*boresight[1] + d_body[2]*boresight[2]
    return max(dot, 0.0) ** PATCH_N

def combined_range_factor(brg_deg, alt_m, dist_m, heading, pitch, roll):
    """
    Antenna range factor [0..1] for this bearing.
    Takes the better of two patches via RX diversity.
    Range ∝ √(power gain).
    """
    alt_drop = max(alt_m - QUAD_ALT, 0.0)
    d_ned    = _brg_to_ned(brg_deg, alt_drop, dist_m)
    d_body   = _ned_to_body(d_ned, heading, pitch, roll)

    g1 = _patch_gain(d_body, PATCH1_B)
    g2 = _patch_gain(d_body, PATCH2_B)
    g  = max(g1, g2)
    return math.sqrt(g) if g > 0 else 0.0

# ── Elevation cache ───────────────────────────────────────────────────────────
def _ck(lat, lon):
    # Isotropic ~111m cells: 0.001° lat ≈ 111m everywhere; adjust lon so cells are
    # square regardless of latitude (at 60°N, 0.001° lon ≈ 55m → double the step).
    lat_r = round(lat, 3)
    cos_lat = max(abs(math.cos(math.radians(lat))), 0.1)
    step = round(0.001 / cos_lat, 4)          # lon step that gives ~111m at this latitude
    lon_r = round(round(lon / step) * step, 5)
    return (lat_r, lon_r)

def _ck_wide(lat, lon):
    """~1km isotropic grid key for the wide-area cursor elevation cache."""
    lat_r = round(lat, 2)
    cos_lat = max(abs(math.cos(math.radians(lat))), 0.1)
    step = round(0.01 / cos_lat, 3)
    lon_r = round(round(lon / step) * step, 4)
    return (lat_r, lon_r)

def _cached_elev(lat, lon):
    with _elev_lock:
        v = _elev.get(_ck(lat, lon))
    if v is None:
        return None
    return None if math.isnan(v) else v   # NaN = confirmed no-data (ocean/gap)

def _cached_elev_wide(lat, lon):
    with _elev_lock:
        v = _elev_wide.get(_ck_wide(lat, lon))
    if v is None:
        return None
    return None if math.isnan(v) else v

def _topodata_post(loc_str):
    """Rate-limited POST to OpenTopoData ASTER 30m. At most 1 call/s globally
    across all prefetch threads so we never exceed the API rate limit."""
    global _api_last_call
    with _api_lock:
        gap = time.time() - _api_last_call
        if gap < 1.1:
            time.sleep(1.1 - gap)
        try:
            return requests.post(
                "https://api.opentopodata.org/v1/aster30m",
                json={"locations": loc_str},
                timeout=15,
            )
        finally:
            _api_last_call = time.time()

def _fetch_elevations(points: list):
    """Fetch missing elevations from OpenTopoData ASTER 30m (global, covers >60°N).
    Writes only non-null results; null (ocean / gap) stays absent → treated as blocked."""
    with _elev_lock:
        miss = [p for p in points if _ck(*p) not in _elev]
    if not miss:
        return
    print(f"[terrain] fetching {len(miss)} points ({math.ceil(len(miss)/100)} requests)")
    for i in range(0, len(miss), 100):
        chunk = miss[i:i+100]
        loc_str = "|".join(f"{a},{b}" for a, b in chunk)
        try:
            r = _topodata_post(loc_str)
            if r.ok:
                with _elev_lock:
                    for j, rec in enumerate(r.json().get("results", [])):
                        elev = rec.get("elevation")
                        # NaN = confirmed no-data (ocean/gap) so it's never re-fetched
                        _elev[_ck(*chunk[j])] = float(elev) if elev is not None else float('nan')
        except Exception as e:
            print(f"[terrain] request error: {e}")

# ── Terrain LOS ───────────────────────────────────────────────────────────────
def _terrain_los(relay_lat, relay_lon, relay_asl, brg, cap_r, sample_r, quad_alt=QUAD_ALT):
    """
    Find max range along bearing where quad has LOS to relay.
    sample_r: total sampling range (must equal boresight_range() so cache keys
              always match what the prefetcher fetched — do NOT use adj_r here).
    cap_r:    antenna-limited max range; result is capped to this value.
    Returns (range_m, limited_by) where limited_by is "terrain"|"rf"|"nodata".
    """
    samples = []
    for k in range(1, TERR_PTS + 1):
        d = sample_r * k / TERR_PTS       # always full boresight range — matches prefetcher
        slat, slon = dest(relay_lat, relay_lon, brg, d)
        samples.append((d, slat, slon, _cached_elev(slat, slon)))

    has_data = any(h is not None for _, _, _, h in samples)
    if not has_data:
        return min(NO_DATA_RANGE, cap_r), "nodata"

    max_clear  = NO_DATA_RANGE
    limited_by = "nodata"

    for i, (d_tgt, _, _, h_tgt) in enumerate(samples):
        if d_tgt > cap_r:
            # Reached the antenna-limited range — mark as rf-limited and stop
            if limited_by == "nodata":
                max_clear  = cap_r
                limited_by = "rf"
            break
        if h_tgt is None:
            break   # no elevation data beyond this point

        target_asl = h_tgt + quad_alt
        los_clear  = True

        for j in range(i):
            d_mid, _, _, h_mid = samples[j]
            if h_mid is None:
                los_clear = False
                break
            frac  = d_mid / d_tgt
            los_h = relay_asl + (target_asl - relay_asl) * frac
            los_h -= d_mid * (d_tgt - d_mid) / (2 * EARTH_R_EFF)
            # Parabolic clearance margin: full 25m at midpoint, tapers to 0 at relay and target.
            # Prevents falsely blocking flat terrain where the LOS line descends toward the target.
            margin = 25.0 * 4.0 * frac * (1.0 - frac)
            if h_mid > los_h - margin:
                los_clear = False
                break

        if los_clear:
            max_clear  = d_tgt
            limited_by = "terrain" if i < TERR_PTS - 1 else "rf"
        else:
            break

    return min(max_clear, cap_r), limited_by

# ── Coverage polygon ──────────────────────────────────────────────────────────
def _compute_polygon(lat, lon, alt, roll, pitch, heading, quad_alt=QUAD_ALT):
    relay_ter = _cached_elev(lat, lon) or 0.0
    relay_asl = relay_ter + alt
    bs_range  = boresight_range()

    poly, seg_types = [], []
    ranges = []

    for i in range(N_BRG):
        brg = i * 360 / N_BRG

        # Antenna pattern: how much of the boresight range do we get in this direction?
        rf = combined_range_factor(brg, alt, bs_range, heading, pitch, roll)

        if rf < 0.05:
            # Behind both patches — append a 30m stub (polygon must be valid)
            poly.append(list(dest(lat, lon, brg, 30)))
            seg_types.append("patch")
            ranges.append(0.03)
            continue

        adj_r = bs_range * rf

        # Terrain LOS: sample always to bs_range (so cache keys match the prefetcher),
        # cap at adj_r (antenna-limited range).
        ter_r, lim = _terrain_los(lat, lon, relay_asl, brg, adj_r, bs_range, quad_alt)
        final_r = max(ter_r, 30)

        poly.append([round(p, 6) for p in dest(lat, lon, brg, final_r)])
        seg_types.append("nodata" if lim == "nodata" else
                         "terrain" if ter_r < adj_r * 0.95 else "rf")
        ranges.append(final_r / 1000)

    return poly, seg_types, ranges

def _polygon_updater():
    while True:
        time.sleep(1)
        try:
            with _lock:
                lat      = _state["lat"]
                lon      = _state["lon"]
                if lat is None:
                    continue
                alt      = _state["alt_m"]
                roll     = _state["roll"]
                pitch    = _state["pitch"]
                heading  = _state["heading"]
                qa       = _state["quad_alt"]
            poly, seg_types, ranges = _compute_polygon(lat, lon, alt, roll, pitch, heading, qa)
            active = [r for r, t in zip(ranges, seg_types) if t != "patch" and r > 0.05]
            bs_km  = round(boresight_range() / 1000, 2)
            with _lock:
                _state["polygon"]      = poly
                _state["seg_types"]    = seg_types
                _state["boresight_km"] = bs_km
                _state["min_range_km"] = round(min(active, default=0), 2)
                _state["max_range_km"] = round(max(active, default=0), 2)
        except Exception as e:
            print(f"[polygon_updater] error: {e}")

# ── Terrain pre-fetch ─────────────────────────────────────────────────────────
def _terrain_prefetcher():
    """Fetch terrain for current relay position. Runs every 2s but only makes
    API calls for actually-missing cache entries, so orbiting a POI is instant
    after the first pass fills the cache.
    Points are fetched closest-first so the polygon shows nearby terrain
    immediately after the first API request, not at the end of all requests."""
    while True:
        time.sleep(2)
        with _lock:
            lat, lon = _state["lat"], _state["lon"]
        if lat is None:
            continue

        try:
            bs  = boresight_range()
            # Build (dist, slat, slon) list sorted closest-first.
            # dict.fromkeys preserves insertion order while deduplicating cache keys.
            raw = [(0.0, lat, lon)]
            for b in range(0, 360, 5):
                for k in range(1, TERR_PTS + 1):
                    d = bs * k / TERR_PTS
                    slat, slon = dest(lat, lon, b, d)
                    raw.append((d, slat, slon))
            raw.sort(key=lambda x: x[0])
            pts = list(dict.fromkeys(_ck(slat, slon) for _, slat, slon in raw))

            # Only set "fetching" status when there are genuinely missing points
            with _elev_lock:
                miss_count = sum(1 for p in pts if p not in _elev)

            if miss_count > 0:
                with _lock:
                    _state["terrain_status"] = "fetching"
                _fetch_elevations(pts)
                with _lock:
                    _state["terrain_status"] = "ready"
        except Exception as e:
            print(f"[terrain_prefetcher] error: {e}")

# ── Simulation updater ────────────────────────────────────────────────────────
def _sim_updater():
    """Move the simulated aircraft at 2 Hz based on active simulation mode.
    Pauses automatically when MAVLink is connected (live telemetry overrides)."""
    dt = 0.5
    while True:
        time.sleep(dt)
        with _lock:
            if _state["source"] == "mavlink":
                continue
            mode = _sim["mode"]
            if mode is None:
                continue
            speed = _sim["speed_ms"]
            lat   = _state["lat"]
            lon   = _state["lon"]
            if lat is None:
                continue

            if mode == "straight":
                hdg = _sim["heading"]
                nlat, nlon = dest(lat, lon, hdg, speed * dt)
                _state.update({"lat": nlat, "lon": nlon, "heading": hdg,
                               "roll": 0.0, "pitch": 0.0, "source": "simulated"})

            elif mode == "orbit":
                o_lat = _sim["orbit_lat"]
                o_lon = _sim["orbit_lon"]
                r     = max(_sim["orbit_r"], 50.0)
                if o_lat is None:
                    continue
                omega = speed / r                               # rad/s
                angle = (_sim["orbit_angle"] + omega * dt) % (2 * math.pi)
                _sim["orbit_angle"] = angle
                nlat, nlon = dest(o_lat, o_lon, math.degrees(angle), r)
                hdg  = (math.degrees(angle) + 90.0) % 360.0   # tangent heading
                roll = math.degrees(math.atan2(speed**2, r * 9.81))
                _state.update({"lat": nlat, "lon": nlon, "heading": hdg,
                               "roll": roll, "pitch": 0.0, "source": "simulated"})

            elif mode == "mission":
                wps = _sim["waypoints"]
                idx = _sim["wp_idx"]
                if not wps or idx >= len(wps):
                    _sim["mode"] = None
                    continue
                wp_lat, wp_lon, wp_alt = wps[idx]
                d_rem = _dist_m(lat, lon, wp_lat, wp_lon)
                step  = speed * dt
                if d_rem <= max(step, 20.0):
                    _state.update({"lat": wp_lat, "lon": wp_lon,
                                   "alt_m": float(wp_alt), "source": "simulated"})
                    _sim["wp_idx"] = idx + 1
                    if idx + 1 >= len(wps):
                        _sim["mode"] = None   # mission complete
                else:
                    hdg = _bearing_to(lat, lon, wp_lat, wp_lon)
                    nlat, nlon = dest(lat, lon, hdg, step)
                    _state.update({"lat": nlat, "lon": nlon, "heading": hdg,
                                   "roll": 0.0, "pitch": 0.0, "source": "simulated"})

# ── Wide-area elevation prefetch (50×50 km, 1km grid, cursor AMSL) ────────────
def _wide_area_prefetcher():
    """Fetch 1km-resolution elevation over a 50×50km box around the relay.
    Runs every 60s; only re-fetches cells missing from the wide cache.
    After the first pass the cache covers the whole area and subsequent runs
    are instant (0 misses) unless the relay moves >25km."""
    time.sleep(30)   # stagger behind the fine-grid prefetcher's first run
    while True:
        with _lock:
            lat, lon = _state["lat"], _state["lon"]
        if lat is None:
            time.sleep(60)
            continue
        try:
            cos_lat  = max(abs(math.cos(math.radians(lat))), 0.1)
            lat_step = 0.01                       # ≈ 1.11 km
            lon_step = round(0.01 / cos_lat, 3)  # isotropic: same physical size
            n_steps  = math.ceil(25.0 / (lat_step * 111)) + 1  # ≈24 → 49 cells/side

            clat = round(lat, 2)
            clon = _ck_wide(lat, lon)[1]

            seen = set()
            pts  = []
            for di in range(-n_steps, n_steps + 1):
                nlat = round(clat + di * lat_step, 2)
                for dj in range(-n_steps, n_steps + 1):
                    nlon = round(round((clon + dj * lon_step) / lon_step) * lon_step, 4)
                    ck = (nlat, nlon)
                    if ck not in seen:
                        seen.add(ck)
                        pts.append(ck)

            with _elev_lock:
                miss = [p for p in pts if p not in _elev_wide]

            if miss:
                print(f"[wide_terrain] fetching {len(miss)} points ({math.ceil(len(miss)/100)} requests)")
                for i in range(0, len(miss), 100):
                    chunk = miss[i:i+100]
                    loc_str = "|".join(f"{a},{b}" for a, b in chunk)
                    try:
                        r = _topodata_post(loc_str)
                        if r.ok:
                            with _elev_lock:
                                for j, rec in enumerate(r.json().get("results", [])):
                                    elev = rec.get("elevation")
                                    _elev_wide[chunk[j]] = float(elev) if elev is not None else float('nan')
                    except Exception as e:
                        print(f"[wide_terrain] request error: {e}")
        except Exception as e:
            print(f"[wide_area_prefetcher] error: {e}")
        time.sleep(60)

# ── MAVLink listener ──────────────────────────────────────────────────────────
MODES = {
    0:"MANUAL", 5:"FBWA", 6:"FBWB", 10:"AUTO", 11:"RTL",
    12:"LOITER", 17:"QSTABILIZE", 18:"QHOVER", 19:"QLOITER",
    20:"QLAND", 21:"QRTL",
}

def _mavlink_listener():
    from pymavlink import mavutil
    while True:
        try:
            mav = mavutil.mavlink_connection(
                f"udpout:{SIYI_IP}:{SIYI_PORT}", source_system=255)
            print(f"Waiting for heartbeat from {SIYI_IP}:{SIYI_PORT} …")
            mav.wait_heartbeat(timeout=10)
            print("MAVLink connected.")
            with _lock:
                _state["connected"], _state["source"] = True, "mavlink"
            while True:
                msg = mav.recv_match(
                    type=["GLOBAL_POSITION_INT","ATTITUDE",
                          "SYS_STATUS","HEARTBEAT","VFR_HUD"],
                    blocking=True, timeout=3)
                if msg is None:
                    raise ConnectionError("timeout")
                t = msg.get_type()
                with _lock:
                    if t == "GLOBAL_POSITION_INT":
                        _state["lat"]     = msg.lat / 1e7
                        _state["lon"]     = msg.lon / 1e7
                        _state["alt_m"]   = msg.relative_alt / 1000
                        _state["heading"] = msg.hdg / 100 if msg.hdg != 65535 else 0
                    elif t == "ATTITUDE":
                        _state["roll"]  = round(math.degrees(msg.roll), 1)
                        _state["pitch"] = round(math.degrees(msg.pitch), 1)
                        _state["yaw"]   = round(math.degrees(msg.yaw), 1)
                    elif t == "VFR_HUD":
                        _state["airspeed"] = round(msg.airspeed, 1)
                    elif t == "SYS_STATUS" and msg.voltage_battery != 65535:
                        _state["battery_v"] = round(msg.voltage_battery / 1000, 2)
                    elif t == "HEARTBEAT":
                        _state["flight_mode"] = MODES.get(msg.custom_mode,
                                                           str(msg.custom_mode))
        except Exception as e:
            with _lock:
                _state["connected"], _state["source"] = False, "offline"
            print(f"MAVLink lost ({e}), retry in 5s …")
            time.sleep(5)

# ── Flask routes ──────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/state")
def api_state():
    with _lock:
        s = dict(_state)
        s["sim_mode"] = _sim["mode"]
    lat, lon, alt = s.get("lat"), s.get("lon"), s.get("alt_m", 0)
    if lat is not None:
        relay_ter = _cached_elev(lat, lon)
        s["relay_ter_m"] = relay_ter
        s["relay_asl_m"] = (relay_ter or 0.0) + alt
    return jsonify(s)

@app.route("/api/terrain_debug")
def api_terrain_debug():
    """Terrain profile along one bearing — for diagnosing LOS issues."""
    with _lock:
        lat = _state.get("lat")
        lon = _state.get("lon")
        alt = _state.get("alt_m", 100)
    if lat is None:
        return jsonify({"error": "no position set"})

    brg       = float(req.args.get("brg", 0))
    relay_ter = _cached_elev(lat, lon) or 0.0
    relay_asl = relay_ter + alt
    bs        = boresight_range()

    samples = []
    for k in range(1, TERR_PTS + 1):
        d = bs * k / TERR_PTS
        slat, slon = dest(lat, lon, brg, d)
        h = _cached_elev(slat, slon)
        samples.append((d, h))

    profile = []
    max_clear = None
    for i, (d_tgt, h_tgt) in enumerate(samples):
        if h_tgt is None:
            profile.append({"d_m": round(d_tgt), "terrain": None, "status": "nodata"})
            break
        target_asl = h_tgt + QUAD_ALT
        los_clear  = True
        blocker    = None
        for j in range(i):
            d_mid, h_mid = samples[j]
            if h_mid is None:
                los_clear = False
                blocker = {"d": round(d_mid), "h": None}
                break
            frac   = d_mid / d_tgt
            los_h  = relay_asl + (target_asl - relay_asl) * frac
            los_h -= d_mid * (d_tgt - d_mid) / (2 * EARTH_R_EFF)
            margin = 25.0 * 4.0 * frac * (1.0 - frac)
            if h_mid > los_h - margin:
                los_clear = False
                blocker = {"d": round(d_mid), "h": round(h_mid), "los_h": round(los_h), "margin": round(margin, 1)}
                break
        if los_clear:
            max_clear = round(d_tgt)
        profile.append({
            "d_m":      round(d_tgt),
            "terrain":  round(h_tgt),
            "tgt_asl":  round(target_asl),
            "clear":    los_clear,
            "blocker":  blocker,
        })
        if not los_clear:
            break

    return jsonify({
        "relay_lat":    lat,
        "relay_lon":    lon,
        "relay_ter_m":  relay_ter,
        "relay_asl_m":  relay_asl,
        "bearing_deg":  brg,
        "bs_km":        round(bs / 1000, 2),
        "max_clear_m":  max_clear,
        "profile":      profile,
    })

@app.route("/api/elev")
def api_elev():
    """Return cached terrain elevation for a lat/lon.
    Searches a 5×5 grid of neighbouring cache cells so the cursor elevation
    displays across the whole coverage area, not just the exact bearing-ray
    sample points (the cache is sparse — only ~33% of 111m cells are filled)."""
    try:
        lat = float(req.args["lat"])
        lon = float(req.args["lon"])
    except (KeyError, ValueError):
        return jsonify({"elev": None})

    # Exact cell first
    v = _cached_elev(lat, lon)
    if v is not None:
        return jsonify({"elev": v})

    # If the exact cell is confirmed no-data (NaN), don't search neighbours
    with _elev_lock:
        exact = _elev.get(_ck(lat, lon))
    if exact is not None:   # NaN sentinel — confirmed ocean / data gap
        return jsonify({"elev": None})

    # Search ±2 cells in each direction for the nearest cached point
    lat_r     = round(lat, 3)
    cos_lat   = max(abs(math.cos(math.radians(lat))), 0.1)
    dlat_step = 0.001
    dlon_step = round(0.001 / cos_lat, 4)
    base_lon  = _ck(lat, lon)[1]   # lon already snapped to grid

    best_elev = None
    best_dist2 = float("inf")

    with _elev_lock:
        for di in range(-2, 3):
            nlat = round(lat_r + di * dlat_step, 3)
            for dj in range(-2, 3):
                if di == 0 and dj == 0:
                    continue   # already checked
                nlon = round(round((base_lon + dj * dlon_step) / dlon_step) * dlon_step, 5)
                v = _elev.get((nlat, nlon))
                if v is None or math.isnan(v):
                    continue
                dist2 = di * di + dj * dj
                if dist2 < best_dist2:
                    best_dist2 = dist2
                    best_elev  = v

    if best_elev is not None:
        return jsonify({"elev": best_elev})

    # Fine-grid cache miss — fall back to wide-area 1km cache (covers 50×50km)
    return jsonify({"elev": _cached_elev_wide(lat, lon)})

@app.route("/api/sim", methods=["POST"])
def api_sim():
    d = req.json or {}
    with _lock:
        # Only change mode if explicitly provided; otherwise leave running sim intact
        new_mode = d["mode"] if "mode" in d else _sim["mode"]
        if "speed_ms"  in d: _sim["speed_ms"]  = float(d["speed_ms"])
        if "heading"   in d: _sim["heading"]    = float(d["heading"])
        if "orbit_lat" in d: _sim["orbit_lat"]  = d["orbit_lat"]
        if "orbit_lon" in d: _sim["orbit_lon"]  = d["orbit_lon"]
        if "orbit_r"   in d: _sim["orbit_r"]    = float(d["orbit_r"])
        # Apply altitude from form so sim starts at the user's configured height,
        # not the uninitialised 0.0 default (user may not have clicked Apply first).
        if "alt_m" in d and float(d["alt_m"]) > 0:
            _state["alt_m"] = float(d["alt_m"])

        if new_mode == "orbit":
            o_lat = _sim.get("orbit_lat")
            o_lon = _sim.get("orbit_lon")
            lat   = _state.get("lat")
            lon   = _state.get("lon")
            if o_lat is not None:
                if lat is not None:
                    # Start orbit at current relay's angular position relative to center
                    _sim["orbit_angle"] = math.radians(
                        _bearing_to(o_lat, o_lon, lat, lon))
                else:
                    _sim["orbit_angle"] = 0.0
                    # Place relay at north of orbit center so something appears on map
                    nlat, nlon = dest(o_lat, o_lon, 0.0, _sim["orbit_r"])
                    _state.update({"lat": nlat, "lon": nlon, "source": "simulated"})

        elif new_mode == "mission":
            _sim["wp_idx"] = 0

        elif new_mode is None and "mode" in d:
            if _state.get("source") == "simulated":
                _state["source"] = "manual"

        _sim["mode"] = new_mode
    return jsonify({"ok": True, "mode": _sim["mode"]})

@app.route("/api/mission", methods=["POST"])
def api_mission():
    """Accept a Mission Planner .waypoints file (QGC WPL 110 format) as JSON body."""
    d = req.json or {}
    content = d.get("content", "")
    wps = []
    for line in content.splitlines():
        line = line.strip()
        if not line or not line[0].isdigit():
            continue
        parts = line.split("\t")
        if len(parts) < 11:
            continue
        try:
            idx = int(parts[0])
            cmd = int(parts[3])
            lat = float(parts[8])
            lon = float(parts[9])
            alt = float(parts[10])
        except (ValueError, IndexError):
            continue
        if idx == 0:
            continue  # skip home / reference waypoint
        if cmd not in (16, 22, 21):  # WAYPOINT, TAKEOFF, LAND
            continue
        if abs(lat) < 0.001 and abs(lon) < 0.001:
            continue  # null coordinates
        wps.append((lat, lon, alt))
    with _lock:
        _sim["waypoints"] = wps
        _sim["wp_idx"] = 0
    return jsonify({"ok": True, "count": len(wps)})

@app.route("/api/manual", methods=["POST"])
def api_manual():
    d = req.json or {}
    with _lock:
        _state.update({
            "lat":      d.get("lat"),
            "lon":      d.get("lon"),
            "alt_m":    float(d.get("alt_m", 100)),
            "roll":     float(d.get("roll", 0)),
            "pitch":    float(d.get("pitch", 0)),
            "yaw":      float(d.get("yaw", 0)),
            "heading":  float(d.get("yaw", 0)),
            "vtx_dbm":  float(d.get("vtx_dbm", TX_DBM)),
            "quad_alt": float(d.get("quad_alt", QUAD_ALT)),
            "source":   "manual",
        })
    return jsonify({"ok": True})

if __name__ == "__main__":
    for fn in (_mavlink_listener, _polygon_updater, _terrain_prefetcher,
               _sim_updater, _wide_area_prefetcher):
        threading.Thread(target=fn, daemon=True).start()
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
