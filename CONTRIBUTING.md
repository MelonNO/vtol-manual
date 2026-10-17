# Contributing

This repository holds **safety documents** (checklists, emergency procedures, failsafe descriptions) next to code.
A wrong number on a page can cause a mishap. Every change therefore follows the rules below, and every content
change goes through the **content-review checklist** (plan Q-4) before it is merged.

## Workflow

1. Branch from `main`; never commit straight to `main`, never force-push it (see README "Releases and rollback").
2. Make the change. No build step: edit the files, open the pages in a browser (`python -m http.server` in the repo
   root, then `http://localhost:8000/`).
3. Regenerate what you touched and run the tests (all must pass; CI runs the same):
   ```bash
   node scripts/gen-precache.mjs               # after changing any page, script, CSS, image or diagram
   node scripts/diagrams/build.js              # after changing a diagram definition (scripts/diagrams/)
   node scripts/gen-params-reference.mjs       # after replacing the reference .param file
   node --test test/                           # unit tests (set VTOL_JSDOM to run the jsdom tests too)
   node scripts/check-links.mjs && node scripts/check-images.mjs && node scripts/check-colours.mjs
   python -m pytest gcs protocol               # GCS app and protocol (Python 3.12)
   ```
4. Content change? Fill in the checklist below in the pull request.
5. Add a line to `CHANGELOG.md` under the next version. Releases are tagged (README).

## Content-review checklist (plan Q-4)

Copy this into the pull request and tick every line that applies. A reviewer who flies the aircraft (or the owner)
approves content changes.

### Sources

- [ ] **Every parameter claim cites the parameter file or the ArduPilot documentation.** The reference is
      `docs/reference/carrier-params-2026-10-17.param` (see `docs/reference/README.md`); the meaning of a value comes
      from ArduPilot (`ArduPlane/Parameters.cpp`, `quadplane.cpp`, the ArduPilot wiki) — name the source in the PR,
      and in an HTML comment next to non-obvious text.
- [ ] **Every relay claim cites the relay design** (*Analog Video to IP Relay with Drone TX Control — Technical
      Solution*): ports, switch ports P1–P5, bridge states, T_hold, packet layouts, tests 1–9. Protocol details cite
      `protocol/README.md` (contract C3, still a PROPOSAL).
- [ ] Client-drone values cite the client's own configuration (e.g. `docs/FPV_betaflight_dump.txt` for Reference
      client #1) or the Betaflight / ExpressLRS / EdgeTX documentation.
- [ ] Requirements and owner decisions cite the plan (`docs/SOFTWARE-IMPROVEMENT-PLAN.md`, §1.1 decisions, §4
      safety findings, §15 Rev C values).

### Values

- [ ] **No invented numbers.** If a value is unknown (a measurement, an IP, a register name, a firmware feature),
      write a visible placeholder **`TBD — <what is needed>`**, styled amber (`.warn-val` in HTML, `[[TBD — …]]` in
      `data/content.js`). A value that exists but still needs confirming is **`VERIFY — <against what>`**, amber too.
- [ ] Every new TBD/VERIFY is also listed in `docs/relay/OPEN-ITEMS.md` (or closes an item there).
- [ ] Removing a TBD/VERIFY: the PR names the source (test result row in `docs/relay/TEST-RESULTS.md`, parameter
      file line, document section).
- [ ] The same value is the same everywhere: shared content lives once in `data/content.js` (checklists, emergency
      cards, failsafe table, network table, callouts); thresholds come from the store settings / the parameter
      reference, not from copies in page text. `test/params/reference.test.js` pins the safety-relevant values.
- [ ] Units and references are explicit: altitudes are **REL (above home)** unless stated otherwise; voltages say
      pack or per-cell; the battery failsafes read the sag-compensated voltage, the OSD the raw voltage.

### Design intent (never contradict, plan §1.1 / §4 / §15.2)

- [ ] The carrier fails safe **only on SIYI/GCS link loss** (RTL in fixed-wing modes, QRTL in VTOL modes, after
      5 s). **915 MHz RC loss triggers no action** (`THR_FAILSAFE` = 2). Battery: low 22.0 V → RTL, critical
      21.0 V → QLand at the current position.
- [ ] Mission Planner is the heartbeat; no other program sends MAVLink as sysid 255; the GCS app never sends
      MAVLink to the carrier.
- [ ] An airborne client is never sent a DISARMED start: the only way back after a GCS-app failure is
      **RESUME (client airborne)**.
- [ ] The carrier is a 3-motor Heewing T2 Cruza (M1/M2 tilt, M4 tail); the client is any analog FPV drone.

### Presentation

- [ ] Emergency cards keep the two tiers: short **IMMEDIATE** memory items, then the collapsible **CLEAN-UP**.
- [ ] Checklist items keep their stable `id`; an item whose meaning changes gets a **new** id.
- [ ] Dynamic text is escaped (`VtolCommon.escH()` or `textContent`).
- [ ] Colours come from the CSS variables in `css/base.css` (`var(--accent)` etc.), also inside inline SVG;
      standalone SVG files use the same hex values with a palette comment (`img/README.md`).
- [ ] Works at 360 px width; tap targets ≥ 44 px; works offline after the first visit.
- [ ] Images: own photos preferred, metadata stripped (`scripts/optimize-images.py`), ≤ 250 KiB per photo,
      ≤ 60 KiB per diagram, alt text describes this aircraft.

## Code conventions

- Plain HTML/CSS/JS served as static files by GitHub Pages: **no build step, no frameworks, no npm runtime
  dependencies, no CDN** (fonts, Leaflet and the QR library are vendored).
- Shared JS files work in the browser and in Node (UMD-style wrapper, see `CLAUDE.md`), so they can be unit-tested.
- Python (`gcs/`, `protocol/` tools): Python 3.12, standard library first; allowed third-party packages are
  `pygame-ce` (joystick), `pytest` (tests) and `pyinstaller` (packaging).
- Match the surrounding style; do not reformat code you did not need to touch.
- New Node tests go under `test/` (`*.test.js`, `node:test` + `node:assert`); tests that need jsdom skip themselves
  unless `VTOL_JSDOM` points to a jsdom package (CI sets it).

## CI

Every push and pull request runs `.github/workflows/ci.yml`: Node tests with and without jsdom (including the page
smoke tests in `test/smoke/`), html-validate (`.htmlvalidate.cjs` lists the accepted rules and why), the internal
link check, the image-size budget, the inline-SVG colour lint, the generated-file checks, and the GCS suite on
Windows five times. A red CI blocks the merge.
