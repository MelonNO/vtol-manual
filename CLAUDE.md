# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Two-page web app serving as an operational manual and flight tools suite for a custom FPV relay carrier drone (Heewing T2 VTOL, ArduPlane/QuadPlane firmware). No build step, no frameworks, no dependencies — pure vanilla HTML/CSS/JS.

Hosted on GitHub Pages at **https://MelonNO.github.io/vtol-Manual/**. Works fully offline via `sw.js`.

## Working on this project

No build step. Edit files directly — `watch-push.ps1` auto-commits and pushes on save (4s debounce), and GitHub Pages deploys ~60s after push.

**Auto-push watcher** (run while working):
```powershell
.\watch-push.ps1
```

**One-time git init** (first time only):
```powershell
.\git-setup.ps1
```

If PowerShell blocks scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Architecture

| File | Purpose |
|---|---|
| `index.html` | Flight Tools — pre-flight/turnaround/post-flight checklists, battery log, weather |
| `manual.html` | Operations manual — systems, RF/comms, flight modes, procedures, emergency cards, pre-arm error reference, abbreviations |
| `sw.js` | Service worker — offline caching |

Both pages are fully self-contained (all CSS and JS inline). They link to each other via nav buttons (`MANUAL ▶` / `◀ TOOLS`).

**Service worker cache:** bump the `CACHE` constant in `sw.js` whenever deploying changes that must invalidate the offline cache (currently `vtol-manual-v4`).

## Checklist data structure

```js
{ s: 'short title ≤5 words', t: 'full detail text', n: 'note text',
  w: true,                    // amber warning flag (optional)
  copy: true,                 // show copyable code block in detail (optional)
  extras: [{label, val}]      // multiple copyable values (optional)
}
```

Generic renderer signature:
```js
buildChecklist(data, containerId, storageKey, secProgPrefix, overallFn)
```

Checklist rows are split 50/50: left half checks the item, right half expands the detail pane. This is intentional — it was introduced specifically to fix small tap targets on mobile.

## localStorage keys

| Key | Contents |
|---|---|
| `vtol_cl2` | Pre-flight checklist state |
| `vtol_cl3` | Turnaround checklist state |
| `vtol_battlog` | Battery log entries |
| `vtol_pf_archive` | Preflight timer archive (sessions with notes) |

## Feature implementation notes

**Battery log — .tlog parser**
- `parseTlog()` / `mavlinkExtractBattery()` — pure JS MAVLink v1/v2 binary parser, no server
- Extracts start V, min V, end V, flight time → pre-fills the log form
- Duration is approximated (assumes ~1Hz samples) — not exact

**Battery log — Mission Planner live fetch**
- "MP" button fetches from `http://localhost:20199/mavlink/SYS_STATUS`
- Parses `voltage_battery` (mV → V)
- Only works on the laptop running Mission Planner with REST API enabled
- Uses `AbortSignal.timeout()` — may not work in older browsers; graceful fallback is in place

**Weather tab**
- Uses Open-Meteo free API (lat/lon input or browser geolocation)
- Requires internet — no offline fallback

**Emergency modal**
- Emergency content lives in `index.html` as a full-screen modal overlay, not in `manual.html`

## Style conventions

All colours use CSS variables defined in `:root` — never hardcode colour values.

| Variable | Value | Use |
|---|---|---|
| `--accent` | `#f97316` | Orange — primary accent |
| `--red` | `#ef4444` | Danger / emergency |
| `--green` | `#22c55e` | GO status |
| `--amber` | `#facc15` | Warning / caution |

Fonts: `Oswald` for headings, `Share Tech Mono` for body. Base font size: `15px`. Checklist rows: `50px` min height, checkboxes `24×24px`.

## Known issues / gaps

1. **`BATT_LOW_VOLT = 0`** — not set; no low-voltage warning before critical failsafe at 22.2V. Battery log analysis recommends ~23.1V based on real flight data. This is a flight controller param change, not a code change.
2. **`FENCE_ENABLE = 0`** — geofence is configured (ALT_MAX=100m, RADIUS=300m) but intentionally disabled for now.
3. **`BATT_FS_CRT_ACT = 6`** — critical battery triggers Loiter→QLand at current position, NOT return-to-home.

## Key network addresses / copyable strings

These appear verbatim in checklist copy blocks and the manual — keep them consistent:

- Mission Planner: UDPCI, IP `192.168.144.12`, Port `19856`
- FPV video RTSP: `rtsp://192.168.144.25:8554/main.264`
- Carrier camera RTSP: `rtsp://192.168.144.26:8554/main.264`
- Subnet: `192.168.144.X / 255.255.255.0`
- GStreamer pipeline: `rtspsrc location=rtsp://192.168.144.26:8554/main.264 latency=41 udp-reconnect=1 timeout=0 do-retransmission=false ! application/x-rtp ! decodebin3 ! queue max-size-buffers=1 leaky=2 ! videoconvert ! video/x-raw,format=BGRA ! appsink name=outsink sync=false`
