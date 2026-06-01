# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Two-page web app serving as an operational manual and flight tools suite for a custom FPV relay carrier drone (Heewing T2 VTOL, ArduPlane/QuadPlane firmware). No build step, no frameworks, no dependencies — pure vanilla HTML/CSS/JS.

Hosted on GitHub Pages, used in the field on laptop and mobile. Works fully offline via `sw.js`.

## Deployment

There is no build process. Edit files and push — GitHub Pages deploys automatically (~60s).

**Auto-push watcher** (run while working):
```powershell
.\watch-push.ps1
```
Watches for file saves, waits 4 seconds, commits, and pushes automatically.

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
| `index.html` | Flight Tools — pre-flight/turnaround/post-flight checklists, battery log, weather tab |
| `manual.html` | Operations manual — systems, RF/comms, flight modes, procedures, emergency cards, pre-arm error reference |
| `sw.js` | Service worker — offline caching |

Both pages are self-contained (all CSS and JS inline). They link to each other via nav buttons.

**Service worker cache version** is `CACHE` in `sw.js`. Bump it whenever deploying changes that must invalidate the offline cache (e.g. `vtol-manual-v4` → `vtol-manual-v5`).

## Checklist data structure

Checklist items follow this schema:
```js
{ s: 'short title ≤5 words', t: 'full detail text', n: 'note text',
  w: true,         // amber warning flag (optional)
  copy: true,      // show copyable code block in detail pane (optional)
  extras: [{label, val}]  // multiple copyable values (optional)
}
```

Two separate renderers exist: `buildChecklist()` is the generic one, called as:
```js
buildChecklist(data, containerId, storageKey, secProgPrefix, overallFn)
```

## localStorage keys

| Key | Contents |
|---|---|
| `vtol_cl2` | Pre-flight checklist state |
| `vtol_cl3` | Turnaround checklist state |
| `vtol_battlog` | Battery log entries |
| `vtol_pf_archive` | Preflight timer archive (sessions with notes) |

## Style conventions

All colours use CSS variables defined in `:root` — never hardcode colour values.

| Variable | Value | Use |
|---|---|---|
| `--accent` | `#f97316` | Orange — primary accent |
| `--red` | `#ef4444` | Danger / emergency |
| `--green` | `#22c55e` | GO status |
| `--amber` | `#facc15` | Warning / caution |

Fonts: `Oswald` for headings, `Share Tech Mono` for body (loaded from Google Fonts).

Design aesthetic: dark theme, military/operational — uppercase section headers, monospace data, no decorative elements.

## Known issues (flagged throughout the app)

1. `BATT_LOW_VOLT = 0` — not set; no low-voltage warning before critical failsafe at 22.2V. Battery log analysis recommends a value from real flight data.
2. `FENCE_ENABLE = 0` — geofence is configured but disabled.
3. `BATT_FS_CRT_ACT = 6` — critical battery triggers Loiter→QLand at current position, NOT return-to-home.

## Key network addresses / copyable strings

These appear verbatim in checklist copy blocks and the manual:

- Mission Planner: UDPCI, IP `192.168.144.12`, Port `19856`
- FPV video RTSP: `rtsp://192.168.144.25:8554/main.264`
- Carrier camera RTSP: `rtsp://192.168.144.26:8554/main.264`
- Subnet: `192.168.144.X / 255.255.255.0`
