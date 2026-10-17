# WP14 — Carrier parameter update (Rev C) and parameter reference

- **Worktree:** `S\wt\WP14`
- **Branch:** `wp/14`
- **Starts after:** WP09 is merged (it shares pages and `js/diagrams.js` with WP09). Runs in parallel with WP13 (gcs only).

Read first:
- `01-COMMON-CONTEXT.md`
- `02-CONTRACTS.md` — especially the new **C1.6**
- **plan §15 (Rev C)** in `docs/SOFTWARE-IMPROVEMENT-PLAN.md`. It supersedes all older parameter values, battery thresholds and failsafe descriptions.
- the owner's source document `C:\Users\Simulator\Downloads\docs2\VTOL Manual Changes Needed to Match Carrier Params.md` (read only). Its line numbers refer to the **old** GitHub manual and do not match the rewritten files. Apply the **meaning**, not the line numbers.
- the parameter file `C:\Users\Simulator\Downloads\docs2\params.param` (read only)
- all reports in `docs/tasks/reports/`

## Goal

Make every page, the shared data, the store defaults, the diagrams and the map match the **current carrier parameters** (plan §15). Add the parameter file as a browsable, offline **reference**. Safety content: the battery ladder and the failsafe behaviour are what crews act on in flight, so accuracy is paramount.

## Files you own

- `data/content.js`, `manual.html`, `index.html`, `relay/map.html`
- `js/store.js` (C1.6 defaults and migration), `js/tools-core.js` (expected-params table, battery recommendation), `js/diagrams.js` + `scripts/diagrams/*` + regenerated `img/diagrams/*.svg` (`--check` must stay green)
- new: `docs/reference/carrier-params-2026-10-17.param` (byte-exact copy of `params.param`), `docs/reference/README.md`, `data/params-reference.js`, `scripts/gen-params-reference.mjs`
- `sw.js` / the precache generator, only to add new assets
- `test/**`
- `docs/tasks/reports/WP14-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Parameter reference.**<br>- Copy `params.param` byte-exact to `docs/reference/carrier-params-2026-10-17.param`. `docs/reference/README.md` gives its date, its source and how to update it (replace the file, re-run the generator, bump the date).<br>- `scripts/gen-params-reference.mjs` (Node, no deps, with a `--check` mode) generates `data/params-reference.js` per C1.6.<br>- A test proves the generated file matches the `.param` file. |
| R2 | MUST | **Manual: new "Parameters" tab** under Reference ▾ (id `params`). It shows the full reference file (all 1663 params), searchable, grouped by prefix (BATT_, Q_, FS_, COMPASS_, FENCE_, …). Parameters the manual relies on are highlighted, with a one-line meaning and a link to the chapter that uses them. The header names the file date. Mobile-friendly: virtualise or paginate if needed. |
| R3 | MUST | **Values everywhere** (manual, `data/content.js`, `index.html`, map, diagrams) updated per plan §15.1. Includes the km/h conversion, the back-transition distance (≈ 100 m), the hover-thrust note (learned, drifts) and the new Aircraft-table rows (`BATT_FS_LOW_ACT`, `BATT_FS_VOLTSRC`, `BATT_ARM_VOLT`, `Q_M_BAT_VOLT_MAX/MIN`, `Q_RTL_MODE`, `Q_OPTIONS`). Remove the VERIFY markers that the reference file now resolves; keep them where behaviour, not just the value, still needs a firmware check. A test scans the content for every obsolete value in its safety context (22.2 V as critical, 13 m/s cruise, 11 m/s min, 4 s transition fail, QLand/QHOVER on transition fail, `Q_RTL_ALT` 70, 3000 ms, 10000 ms, 35 % trim, 0.272, 40 deg/s, "BATT_LOW_VOLT not set", "no low-battery warning", "fence configured but disabled"). |
| R4 | MUST | **Failsafe behaviour per plan §15.2** in the failsafe table, the design-intent text, the emergency cards, the procedures and the callouts:<br>- 915 MHz loss: no action; QHOVER holds with centred sticks and drifts.<br>- SIYI loss: RTL in FW modes, QRTL in VTOL modes.<br>- Transition timeout: 8 s → QRTL home. Keep the pilot's manual QHOVER at 2–3 s; keep the WP2 → home route clear.<br>- RTL ends in an automatic VTOL landing at home: **keep the home landing zone clear the whole flight**. Add a checklist item.<br>- Low-battery RTL during a manual QHOVER landing: reselect QHOVER. It does not interrupt QLAND/QRTL/AUTO VTOL landing. |
| R5 | MUST | **Battery ladder per plan §15.3** (emergency card immediate steps: 23.0 manual RTL → 22.5 must be active → **22.0 auto RTL** → **21.0 QLand here**), with the `BATT_FS_VOLTSRC` note (failsafe vs OSD voltage). Remove "set BATT_LOW_VOLT" steps. Pre-Arm Ref: "Battery failsafe on" uses 21.0 V; a new row "Battery below minimum arming voltage" → pack < 24.6 V, fit a fully charged pack. Glossary and storage notes updated. |
| R6 | MUST | **Tools battery analysis per plan §15.4:**<br>- relabel the recommendation as "Suggested manual RTL trigger (pilot, OSD raw voltage)"<br>- show `BATT_LOW_VOLT` 22.0 / `BATT_CRT_VOLT` 21.0 as configured failsafes<br>- never recommend changing them<br>- the trend chart gets 22.0 low and 21.0 critical lines plus the manual-RTL line<br>- header meta: CRIT 21.0 V, LOW 22.0 V, cruise 12 m/s |
| R7 | MUST | **Store (C1.6):** new defaults and keys, migration with a one-time notice, `paramFile` precedence. Tests cover migration of an unedited old store (22.2 → 21.0) and of an edited one (kept + notice). |
| R8 | MUST | **Params tab (Tools):** the expected-values table now comes from the reference (`VtolParamsRef`) for the safety-relevant subset (the plan §15.1 parameters plus the unchanged failsafe parameters). `FLTMODE2` is expected to be 11. An imported `.param` is compared against the reference. A "Use reference" baseline is shown when no file is imported. |
| R9 | MUST | **Diagrams/gauge:** the battery gauge shows 24.6 arm-minimum, 23.0 manual RTL, 22.5 hard limit, **22.0 auto-RTL (low)**, **21.0 critical**, 22.8 storage and 18.6 floor. D7 (carrier failsafe matrix): transition fail → QRTL home; GCS loss → RTL (FW) / QRTL (VTOL); battery low → RTL; critical → QLand here. Mission profile: back-transition ≈ 100 m; QRTL path. The motor/tilt diagram uses the 45 deg/s tilt rate where shown. Regenerate; `--check` green. |
| R10 | MUST | **Geofence and compass (plan §15.1, §15.5):**<br>- "no geofence configured" wherever a fence was mentioned. Keep the Pre-Arm "Fence requires position" row, with the two conflicts noted for a future fence.<br>- New compass configuration note (Aircraft tab, next to GPS).<br>- Compass calibration procedure (manual Procedures and Pre-Arm, the Tools "Compass calibrated" item with the priority-1 check and the four-direction check).<br>- New Pre-Arm row "Compass not found / not healthy".<br>- Maintenance item "record COMPASS_OFS_X/Y/Z". |
| R11 | MUST | **Map:** simulation minimum speed = `AIRSPEED_MIN` (10 m/s, from `paramFile` or the reference); default sim speed = `AIRSPEED_CRUISE` 12 m/s; TECS climb/sink stay at 5 m/s. |
| R12 | MUST | **Pre-flight "Failsafe params verified" copy block** = exactly the list in the owner's document (THR_FAILSAFE … Q_TRANS_FAIL_ACT), with the comments given there. |
| R12b | MUST | **Carry-over from WP09:** `js/gcs-client.js` (`Session.schedule`, ~line 42) logs "Uncaught (in promise)" in a real browser when the GCS app is absent. Fix it: no unhandled rejections and no console noise when the app is absent. Add a Node test with a rejecting fetch stub that asserts no unhandled rejection. You may edit `js/gcs-client.js` for this. After any asset change, run `node scripts/gen-precache.mjs` (the WP09 precache rule). |
| R13 | MUST | All tests pass (`node --test test/`, `node scripts/diagrams/build.js --check`, the precache completeness test if WP09 added one). jsdom smoke of all pages shows no errors. html-validate shows no new errors. No invented values: every number traces to plan §15 / the reference file. |
