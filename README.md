# VTOL FPV Relay — Operations Manual & Coverage Map

Flight tools suite and 5.8 GHz relay coverage planner for a custom VTOL FPV relay carrier system (Heewing T2, ArduPlane/QuadPlane firmware).

**Live site:** https://melonno.github.io/vtol-manual/

---

## Pages

| Page | URL | Purpose |
|---|---|---|
| Flight Tools | `/index.html` | Pre-flight checklists, battery log, telemetry analysis, weather |
| Operations Manual | `/manual.html` | Reference manual — procedures, modes, comms, emergency |
| Relay Coverage Map | `/relay/map.html` | 5.8 GHz RF coverage + GCS LOS planner (runs in any browser) |

All pages are fully offline-capable via the service worker (`sw.js`).

---

## Coverage Map

The map computes real-time 5.8 GHz RF coverage polygons with terrain line-of-sight, using only browser-side JS — no server required.

### Features

- **RF coverage polygon** — 72-bearing polygon with antenna gain model (dual patch, cos³·⁵ pattern), VTX power slider, attitude (roll/pitch/heading) inputs
- **Terrain LOS** — AWS Terrain Tiles (Terrarium PNG, zoom 11, ~76 m/px) with proper CORS; Fresnel zone clearance and Earth-curvature correction
- **GCS Coverage tool** — draws a second polygon showing where the carrier plane has LOS from a fixed GCS antenna; accounts for antenna height, tree canopy, and terrain
- **Altitude reference** — relative altitude (ArduPlane frame); reference is GCS terrain when a GCS is placed, terrain under aircraft otherwise
- **Simulation** — straight flight, orbit, or QGC `.waypoints` mission playback at configurable speed
- **Cursor AMSL** — hover anywhere on the map to see elevation from loaded terrain tiles
- **Header readout** — always shows both AGL and AMSL for the aircraft
- **Collapsible sidebar** — ◀/▶ toggle to give the map full-width view

### RF model constants

| Parameter | Value |
|---|---|
| Frequency | 5800 MHz |
| TX gain | 2.0 dBi |
| RX gain | 10.0 dBi |
| RX sensitivity | −85 dBm |
| Link margin | 6 dB |
| Antenna pattern | cos³·⁵ (PATCH_N = 3.5) |

---

## Development

No build step. Edit files directly and push.

```bash
# Clone
git clone https://github.com/MelonNO/vtol-manual.git
cd vtol-manual

# Edit relay/map.html (or index.html / manual.html) then push
git add -p
git commit -m "description"
git push origin main
```

GitHub Pages redeploys automatically on push to `main`.

**Service worker cache:** bump `CACHE` version in `sw.js` when deploying changes that must bypass the offline cache.

---

## Releases & Rollback

Stable states are tagged and published as GitHub Releases.

### View releases

```bash
gh release list
```

Or browse: https://github.com/MelonNO/vtol-manual/releases

### Roll back to a previous release

```bash
# See available tags
git tag -l

# Check out a previous version locally to inspect it
git checkout v1.0.0

# Hard reset main to a previous tag (then force-push to redeploy Pages)
git checkout main
git reset --hard v1.0.0
git push --force origin main
```

> After a force-push, GitHub Pages redeploys within ~30 seconds. Hard-refresh the browser (`Ctrl+Shift+R`) to bypass the service worker cache.

### Tagging a new release

```bash
git tag -a v1.x.0 -m "Short description"
git push origin v1.x.0
gh release create v1.x.0 --title "v1.x.0 — Description" --notes "What changed"
```

---

## Flask relay backend (RPi only)

`relay/app.py` is a separate Flask server for live MAVLink telemetry on the Raspberry Pi. It is **not** used by the static GitHub Pages map.

```bash
cd relay
pip3 install -r requirements.txt
./start.sh          # or: python3 -u app.py
# Browse to http://<pi-ip>:5000
```

---

## Aircraft

**Heewing T2 VTOL** — 3 motors (M1/M2 tilt, M4 tail lift), ArduPlane QuadPlane firmware.  
**FPV sub-drone** — Betaflight, 6S, ELRS 2.4 GHz RX, 5806 MHz VTX 25 mW.  
**Relay** — SIYI HM30, 5.8 GHz, UDP telemetry to Mission Planner at `192.168.144.12:19856`.
