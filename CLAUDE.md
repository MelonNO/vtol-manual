# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Two-page web app: operational manual + flight tools suite for a custom FPV relay carrier drone system (Heewing T2 VTOL, ArduPlane/QuadPlane firmware). No build step, no frameworks, no npm — pure vanilla HTML/CSS/JS.

Hosted on GitHub Pages at **https://MelonNO.github.io/vtol-Manual/**. Works fully offline via `sw.js`.

## Working on this project

No build step. Edit files directly — `watch-push.ps1` auto-commits and pushes on save (4s debounce).

```powershell
.\watch-push.ps1        # run while working
.\git-setup.ps1         # one-time init (first use only)
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned  # if PS blocks scripts
```

**Service worker cache:** bump `CACHE` in `sw.js` when deploying changes that must invalidate offline cache (currently `vtol-manual-v4`).

## Architecture

| File | Purpose |
|---|---|
| `index.html` | Flight Tools — checklists, battery log, telemetry analysis, weather |
| `manual.html` | Operations manual — grouped dropdown nav, all reference chapters |
| `sw.js` | Service worker — offline caching (network-first for HTML, cache-first for fonts) |
| `relay/map.html` | **Static** relay coverage map — all math in JS, calls OpenTopoData directly from browser |
| `relay/app.py` | Flask backend — RF coverage polygon, terrain LOS, MAVLink, simulation (RPi only) |
| `relay/templates/index.html` | Flask map frontend — Leaflet.js, terrain elevation, sim modes (served by app.py) |
| `relay/requirements.txt` | Python deps: flask, requests, pymavlink |
| `relay/start.sh` | Startup script — run to serve the Flask map on http://0.0.0.0:5000 |

Both static pages are fully self-contained (all CSS and JS inline). They cross-link via `MANUAL ▶` / `◀ TOOLS` buttons. Both also have a `MAP ▶` button linking to `relay/map.html` — the **static** coverage map that runs in any browser without any server, including directly from GitHub Pages.

## Relay coverage map (`relay/`)

Flask app that computes 5.8GHz FPV relay RF coverage in real time. Requires Python 3 and runs on the RPi.

```bash
cd relay
pip3 install -r requirements.txt   # first time only
./start.sh                         # or: python3 -u app.py
# Browse to http://localhost:5000 or http://<pi-ip>:5000
```

Key features:
- Live MAVLink telemetry (SIYI HM30 at `udpout:192.168.144.12:19856`)
- 5.8GHz RF coverage polygon with terrain LOS (OpenTopoData ASTER 30m elevation)
- Terrain prefetch: fine-grid 111m cells within ~3.5km, coarse 1km grid for 50×50km cursor AMSL
- Simulation: straight flight, orbit (click map to move center), mission (.waypoints upload)
- Manual aircraft placement with heading, altitude, VTX power controls
- Distance measurement tool, cursor AMSL elevation display
- Map layers: topo, satellite, OSM, dark

## Aircraft configuration

**Heewing T2 VTOL — 3 motors (not 4):**
- **M1, M2** — wing-mounted tilt motors. Tilt from 0° (vertical, VTOL lift) to 80° (forward thrust, FW cruise). These provide both VTOL lift and FW propulsion. Controlled by `Q_TILT_MASK=3`.
- **M4** — tail-mounted vertical lift motor. Fixed upward, VTOL only. Stops completely once FW transition is complete.

Do not confuse with quad layouts. The naming follows the ArduPlane tricopter convention (M1/M2/M4, no M3).

## manual.html tab structure

Navigation uses **grouped dropdowns** (not a flat scrolling tab bar). 6 top-level items:

| Nav item | Tab IDs inside |
|---|---|
| Overview | `overview` (direct) |
| Aircraft ▾ | `aircraft`, `flightmodes`, `fpv` |
| Operations ▾ | `procedures`, `mission`, `callouts` |
| Planning ▾ | `missionplan`, `crew`, `maintenance` |
| Reference ▾ | `comms`, `prearm`, `abbrev` |
| ⚠ Emergency | `emergency` (direct, always red) |

Key JS functions for the grouped nav:
- `switchTab(name, btn)` — direct tab switch, clears all group states
- `toggleNavGroup(btn)` — opens/closes a dropdown
- `selectNavItem(name, btn, e)` — selects a tab from inside a dropdown, marks the group button active
- `manGoTo(tabId)` — used by search results; detects whether tab is grouped and calls the right function
- Click-outside handler closes all dropdowns

## index.html — checklist system

**Data structure:**
```js
{ s: 'short title ≤5 words', t: 'full detail text', n: 'note text',
  w: true,               // amber warning flag — adds left border + ! dot to row
  copy: true,            // show copyable code block in detail pane
  extras: [{label, val}] // multiple copyable values
}
```

**Renderer:**
```js
buildChecklist(data, containerId, storageKey, secProgPrefix, overallFn)
```

Rows split 50/50: left half checks, right half expands detail. This is intentional (mobile tap targets).

**Section colour coding** — `SEC_COLORS` map in JS assigns each section a distinct accent colour:
- A (Site): `#60a5fa` blue
- B (VTOL Build): `#f97316` orange
- C (Ground Station): `#22c55e` green
- D (Carrier Drone): `#a78bfa` purple
- E (FPV Sub-Drone): `#f43f5e` rose
- T1/T2/T3 (Turnaround): orange / purple / rose

Items with `w: true` get `.warn-item` CSS class → amber left border on the row + small amber `!` badge.

**localStorage keys:**
| Key | Contents |
|---|---|
| `vtol_cl2` | Pre-flight checklist state |
| `vtol_cl3` | Turnaround checklist state |
| `vtol_battlog` | Battery log entries |
| `vtol_pf_archive` | Preflight timer sessions |

## Battery chemistry thresholds

`BATT_CHEM` object in index.html — values are per-cell voltages:

```js
const BATT_CHEM = {
  lipo:  { full:4.20, nominal:3.70, low:3.35, critical:3.10, name:'LiPo' },
  liion: { full:4.20, nominal:3.60, low:3.20, critical:2.90, name:'Li-Ion' },
  life:  { full:3.65, nominal:3.30, low:3.00, critical:2.70, name:'LiFe' }
};
```

**Chemistry rationale (LiPo):**
- `critical: 3.10` — deep in the SEI damage zone; consistently landing here causes capacity loss and IR rise. The catastrophic failure (copper dissolution / polarity reversal) only occurs in complete over-discharge, not at these voltages.
- `low: 3.35` — longevity recommendation floor; SEI degradation accelerates below this on a regular basis.
- `full: 4.20` — theoretical max; typical charge completes at ~4.15–4.18V.
- **3.0V/cell is the hard floor** (conventional safe stop with headroom), not the damage point itself. The 3.3–3.5V range is a longevity recommendation.
- **Sag vs resting**: under-load voltage dips are IR×R_internal drop and recover instantly. Judge pack health by resting voltage after flight, not worst in-flight dip.

**Storage voltage: 22.8V (3.8V/cell) for 6S** — not 22.2V. The BATT_CRT_VOLT of 22.2V is an operational threshold (automated QLand trigger), not a storage target. Optimal storage SoC is 40–60% ≈ 3.80–3.85V/cell.

**Pack health assessment thresholds** (avgMin/cells, sequential):
- CRITICAL: < `chem.critical + 0.05` — deep damage territory
- LOW: < `chem.low + 0.05` — in SEI aging zone
- MARGINAL: < `chem.low + 0.10` — lower acceptable range
- HEALTHY: all else

**BATT_LOW_VOLT recommendation formula:**
```js
Math.max(avgMin + 0.8, 23.0)
```
Floor is hardcoded at 23.0V (manual RTL trigger) — the chemistry floor is irrelevant here since the operational constraint is the ArduPlane BATT_CRT_VOLT at 22.2V.

## Carrier voltage reference (6S 7000mAh LiPo)

| Threshold | Pack V | V/cell | Notes |
|---|---|---|---|
| Full charge | 25.2V | 4.20V | After complete charge |
| Manual RTL trigger | 23.0V | 3.83V | Initiate RTL now |
| Hard RTL limit | 22.5V | 3.75V | RTL must be active |
| `BATT_CRT_VOLT` | 22.2V | 3.70V | Automated Loiter→QLand (current position, NOT home) |
| Longevity floor | 20.1V | 3.35V | SEI aging zone |
| Storage target | 22.8V | 3.80V | ≥48h storage |
| Hard floor | 18.6V | 3.10V | Deep damage territory |

## Emergency procedures structure

Both `index.html` (modal) and `manual.html` (Emergency tab) use a two-tier layout per scenario:

1. **IMMEDIATE** — `<div class="emerg-imm">` — always visible, short action phrases, meant to be memorised. No explanatory text.
2. **CLEAN-UP** — `<div class="emerg-cleanup">` — collapsible amber section, opened after situation is stable, read from the screen. Toggle via `toggleCleanup(btn)`.

CSS classes: `.emerg-imm`, `.emerg-imm-badge`, `.emerg-imm-step`, `.emerg-cleanup-btn`, `.emerg-cleanup`, `.emerg-cu-label`, `.emerg-cu-step`.

## Key JS functions — index.html

| Function | Purpose |
|---|---|
| `buildChecklist(data, id, key, prefix, fn)` | Renders a checklist |
| `toggleCI(el, e)` | Check/uncheck item; auto-closes detail pane on check |
| `toggleCleanup(btn)` | Toggle emergency clean-up section |
| `emergJump(id)` | Scroll emergency modal to a scenario by ID |
| `parseTlog()` | Parse ArduPilot .tlog binary, pre-fill battery log |
| `mavlinkExtractBattery(buf)` | MAVLink v1/v2 parser — uses actual timestamps for duration when available |
| `fetchVoltage(fieldId)` | Fetch live voltage from MP REST API (uses `AbortController` + `setTimeout`, not `AbortSignal.timeout`) |
| `fetchWeather()` | Fetch Open-Meteo weather; caches result to `vtol_wx_cache` in localStorage |
| `battTrendSVG(entries, cells, chem)` | Returns SVG string — min voltage trend chart for last 12 flights |
| `battSparkline(sv, mv, rv, cells, chem)` | Returns SVG string — start/min/rest profile spark for table rows |
| `windCompassSVG(dir, speed, c)` | Returns SVG string — compass rose with directional wind arrow |

## Style conventions

All colours via CSS variables in `:root` — never hardcode:

| Variable | Value | Use |
|---|---|---|
| `--accent` | `#f97316` | Orange — primary accent |
| `--red` | `#ef4444` | Danger / emergency |
| `--green` | `#22c55e` | GO / healthy |
| `--amber` | `#facc15` | Warning / caution |

Fonts: `Oswald` (headings), `Share Tech Mono` (body). Base: `15px`. Checklist rows: `50px` min-height, checkboxes `24×24px`. On mobile (≤600px) `index.html` uses fixed bottom nav.

## FPV sub-drone (Betaflight config)

**FC:** Matek F405 STD (clone) · Betaflight 4.5.2  
**Battery:** 6S 1300mAh LiPo  
**VTX:** Raceband R5 · 5806 MHz · 25mW constant  
**RX:** ELRS 2.4GHz CRSF — **must be re-bound to carrier relay Nomad every preflight** (hold LEFT button on carrier Nomad 3s)  
**Motors:** 1960KV · 14-pole · DSHOT300 · bidirectional DSHOT  
**Failsafe:** GPS-RESCUE — 2.5s delay, 8+ sats required, climbs 30m above current position, cruises home at 100m AGL / 7.5 m/s, motor cut at 4m AGL

## Known issues / gaps

1. **`BATT_LOW_VOLT = 0`** — no automated low warning. Battery log analysis calculates a recommendation from real flight data. Must be set manually in ArduPlane Full Parameter List.
2. **`FENCE_ENABLE = 0`** — geofence configured (ALT_MAX=100m, RADIUS=300m) but intentionally disabled.
3. **`BATT_FS_CRT_ACT = 6`** — critical battery fires Loiter→QLand at **current position**, not RTL home.

## Key network addresses / copyable strings

Appear verbatim in checklist copy blocks and the manual — keep consistent:

- Mission Planner: UDPCI · IP `192.168.144.12` · Port `19856`
- FPV video RTSP: `rtsp://192.168.144.25:8554/main.264`
- Carrier camera RTSP: `rtsp://192.168.144.26:8554/main.264`
- Subnet: `192.168.144.X / 255.255.255.0`
- GStreamer: `rtspsrc location=rtsp://192.168.144.26:8554/main.264 latency=41 udp-reconnect=1 timeout=0 do-retransmission=false ! application/x-rtp ! decodebin3 ! queue max-size-buffers=1 leaky=2 ! videoconvert ! video/x-raw,format=BGRA ! appsink name=outsink sync=false`
