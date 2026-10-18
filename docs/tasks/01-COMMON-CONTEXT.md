# Common context for every implementation and verification agent

Read this file completely before you start. Then read your own work-package brief (`WPxx-*.md`), `02-CONTRACTS.md`, and the parts of `docs/SOFTWARE-IMPROVEMENT-PLAN.md` that your brief cites.

## 1. The project

**vtol-manual** is a static web app hosted on GitHub Pages: https://melonno.github.io/vtol-manual/. It is the operating manual and flight-tools suite for a relay system:

- **Carrier:** a **Heewing T2 Cruza** VTOL (3 motors: M1/M2 tilt, M4 tail lift), running ArduPlane QuadPlane.
- **Client:** **any analog FPV drone** (the reference client is a Matek F405 / Betaflight 4.5.2 quad).
- **Old relay chain** (Nomad 868 → DBR4 → Nomad 2.4, CVBS→HDMI→SIYI IP): **removed**.
- **New relay:** a two-board PCB on the carrier, fully described in the relay design document:
  - **Video board** (STM32N657): CVBS → H.264 → RTP/UDP 5600.
  - **Net/RC board**: a KSZ8795 5-port switch plus W5500 + STM32G030 bridge. It receives UDP 5770 RC from the GCS and drives an ELRS TX module over CRSF.
  - **Switch ports:** P1 HM30, P2 W5500, P3 IP camera (switched by `CAM_ENABLE`), P4 spare, P5 N6.
- **Links:** the SIYI HM30 is the only GCS↔carrier link (Mission Planner MAVLink, RC UDP, video, camera). A 915 MHz Nomad is the carrier's **close-range backup only**.
- **Ground station:** Windows only. Mission Planner, plus a **new Windows GCS companion app** (built in this project, `gcs/`).

### Source documents (requirements)

| Document | Path | Use |
|---|---|---|
| Improvement plan (Rev B; Rev C §15 supersedes older values) | `docs/SOFTWARE-IMPROVEMENT-PLAN.md` in the repo | **Primary requirements.** Your brief cites its IDs (S-01, IDX-03, MAP-01, §6.1.4, …). |
| Relay design | `C:\Users\Simulator\Downloads\Docs\Analog Video to IP Relay with Drone TX Control — Technical Solution.md` | Hardware/firmware facts (ports, packets, states, tests). **Read only, never edit.** |
| Contracts | `docs/tasks/02-CONTRACTS.md` | Interfaces shared between work packages. **You must conform.** If a contract is wrong or insufficient, write it in your report; do not silently diverge. |

### Owner decisions you must respect (plan §1.1)

- **Carrier failsafe intent:** the carrier fails safe **only on SIYI/GCS link loss**. `THR_FAILSAFE = 2` (RC loss ignored) and `FS_GCS_ENABL = 2` (all modes) are **intentional**. The 915 MHz link is close-range backup; losing it out of range is expected, not an emergency.
- **ELRS band:** any band (868 / 915 / 2.4 / Gemini). **VRX band:** per client. **Video standard:** PAL **and** NTSC.
- **TX module on the relay:** RadioMaster Nomad (default) or a DBR4 flashed as TX.
- **FPV controller:** a RadioMaster EdgeTX radio used as a USB joystick, with its RF modules **off**.
- **Camera gating:** only needed while a client is connected.
- **Gist sync:** remove it. Keep and extend EXPORT/IMPORT/LINK FILE.
- **GCS app:** lives in this repo, in `gcs/` (Python), with `protocol/` shared.
- **Flask app** (`relay/app.py`, `relay/templates/`, `relay/start.sh`, `relay/requirements.txt`): to be retired (WP10).

## 2. Code conventions (non-negotiable)

1. **Web pages:** no build step, no frameworks, no npm runtime dependencies. Plain HTML/CSS/JS, served as static files from GitHub Pages. Small shared plain-JS files (`js/*.js`, `data/*.js`, `relay/*.js`) loaded by `<script src>` are allowed and encouraged.
2. **Shared JS files must work both in the browser and in Node tests.** Use this pattern:
   ```js
   (function (root, factory) {
     const api = factory();
     if (typeof module === 'object' && module.exports) module.exports = api;
     else root.ToolsCore = api;           // pick a clear global name
   })(typeof self !== 'undefined' ? self : this, function () { /* ... */ return { fnA, fnB }; });
   ```
3. **Colours** come from CSS variables in `:root` (`--accent #f97316`, `--red #ef4444`, `--green #22c55e`, `--amber #facc15`, `--bg`, `--surface`, `--text`, `--muted`, …). Never hard-code new colours in page CSS or inline SVG. Inline SVG may use `fill="var(--accent)"`. Standalone `.svg` files can't read page variables; use the same hex values there and note it.
4. **Fonts and design system (since WP23):** IBM Plex Sans (body, base 16 px), Oswald (headings and short labels), Share Tech Mono (values, parameters, IPs, code, timers only), all self-hosted. Tokens and one definition of every shared component in `css/base.css`; rules in `docs/design/README.md`. Dark operational style. Mobile first: tap targets ≥ 44 px, works at 360 px width, and the fixed bottom nav on mobile in `index.html` must keep working.
5. **Escape all dynamic text** inserted with `innerHTML`. Use the shared `escH()` (from `js/common.js` once WP01 creates it), or `textContent`.
6. **Offline first.** Anything the field needs must work without internet once cached. Never add new CDN dependencies. Leaflet gets vendored in WP02.
7. **Match the surrounding code style** (naming, comment density, compactness). Do not reformat code you did not need to touch.
8. **Safety-critical content:** every parameter value, threshold, IP or procedure you write must come from the plan, the relay design, or the existing manual. If the true value is unknown (measurements, IPs, register names, firmware features), write a visible placeholder `TBD — <what is needed>` styled with the `.warn-val` / amber style. **Never invent numbers.**
9. **Python (gcs/, protocol/):** Python 3.12, standard library first. Allowed third-party packages: `pygame-ce` (joystick), `pytest` (tests), `pyinstaller` (packaging only). Anything else must be justified in your report. Type hints and docstrings in the style of a small, tidy codebase.

## 3. Environment

These are the paths of the first PC (2026-10-16 … 18). On any other computer, `docs/HANDOFF.md` §2–§3 says what
each one maps to; the PM writes the actual paths into each brief.

| Item | Path / command |
|---|---|
| Scratchpad (S) | `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad` |
| Main repo (integration, PM only) | `S\repo\vtol-manual` — **do not edit unless your brief says so** |
| Your worktree | `S\wt\<WPxx>` (given in your brief). **Work only there.** |
| Node.js 24 | `C:\Program Files\nodejs\node.exe`. In Git Bash: `export PATH="/c/Program Files/nodejs:$PATH"` |
| JS test helpers | `S\jsenv` has `jsdom` and `html-validate` installed: `node -e "require('S/jsenv/node_modules/jsdom')"`, or run `npx --prefix S/jsenv html-validate <file>`. **Do not add `node_modules` to the repo.** |
| Python venv | `S\venv\Scripts\python.exe` (Pillow, pytest, pygame-ce installed). `pip install` more into this venv if your brief allows. |
| Unit tests | JS: `node --test test/` (Node built-in `node:test` + `node:assert`; no npm packages in the repo). Python: `S\venv\Scripts\python.exe -m pytest gcs protocol`. |

## 4. Git rules

- Your worktree is already on its own branch (`wp/<id>`). **Commit there** with clear messages ending in:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- **Never** push, never merge, never rebase other branches, never touch `main` or other worktrees. The PM merges after verification.
- Only change the files your brief lists under **Files you own**. If you must touch another file, keep it minimal and justify it in your report.

## 5. Your report (mandatory)

At the end, write `docs/tasks/reports/<WPxx>-IMPLEMENTATION.md` in your worktree and commit it. It must contain:

1. **Summary** — what you did, in 5–10 lines.
2. **Requirement table** — every requirement ID from your brief → `DONE` / `PARTIAL` / `NOT DONE` / `N/A`, with file:line evidence and one line of explanation.
3. **Placeholders** — every `TBD` you inserted, and why.
4. **Tests** — what you added, and the exact command plus output summary (all passing).
5. **Deviations / contract issues** — anything you did differently from the brief or contracts, and why.
6. **Notes for the verifier** — how to see each feature working.

## 6. If verification rejects your work

You will receive the verifier's findings. Fix **every** finding (or argue specifically why one is wrong), commit, and update your report with a "Rework round N" section.
