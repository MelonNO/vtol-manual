# WP11 — Tools analysis features, maintenance tracking, parameter-file import, accessibility

- **Worktree:** `S\wt\WP11`
- **Branch:** `wp/11`
- **Wave:** 3 (parallel with WP06 and WP08b)
- **Starts after:** WP05 and WP08a are merged

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md`, the WP01, WP05 and WP08a reports (session-log schema in `gcs/README.md`), and plan §10.1 A-3, §10.3, §10.4, §10.5, §10.8, §14.7, §13.1.

## Files you own

- `index.html`, `js/tools-core.js`
- new: `tools/latency-clock.html`
- `test/tools/*.test.js`
- `js/store.js` — **additive only**: the new optional key `paramFile`, documented in the report as a C1 extension
- `docs/tasks/reports/WP11-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Parameter-file import (A-3):**<br>- import an ArduPilot `.param` file into `store.paramFile = {name, importedAt, params:{NAME: value}}`<br>- a "Params" view comparing against an **expected-values table** (values the manual relies on: THR_FAILSAFE 2, FS_GCS_ENABL 2, FS_LONG_TIMEOUT 5, FS_LONG_ACTN 1, BATT_CRT_VOLT 22.2, BATT_FS_CRT_ACT 6, BATT_LOW_VOLT 0, RTL_ALTITUDE 120, Q_RTL_ALT 70, Q_TRANS_FAIL 4, Q_TRANS_FAIL_ACT 0, Q_ASSIST_SPEED 9, Q_ASSIST_ALT 25, Q_FRAME_CLASS 7, Q_TILT_MASK 3, AIRSPEED_CRUISE 13, AIRSPEED_MIN 11, AIRSPEED_MAX 22, FENCE_ENABLE 0, FLTMODE1–6) — put the table in `data/content.js` only if WP05 left an `expectedParams` slot, otherwise in `tools-core` with a TODO to move it<br>- highlight differences and missing params<br>- show "verified against param file <name> <date>" so pages can display it (`store.paramFile`)<br>- tests with a sample `.param` |
| R2 | MUST | **.bin analysis (§10.4):** detect transitions (Q-mode ↔ FW mode changes, plus time to reach `AIRSPEED_MIN` after a FW mode when ARSP is available), VTOL-assist events (from MSG text when present), failsafe and battery events (MSG / MODE reason), max current per phase (VTOL / transition / FW). Add "Create battery-log entry from this .bin" (start/min/end/duration, pack selector). Tests with synthetic records. |
| R3 | MUST | **GCS session-log viewer:** load a `session-*.jsonl` (schema from WP08a); charts of RTT, loss, LQ, client battery and bridge-state timeline; an alarm list; and "create client battery entry" from telemetry (start/min/end, mAh). |
| R4 | MUST | **Maintenance tracker (§10.3):** flight counts per pack (battLog) and per aircraft (carrier entries); due/overdue status for the manual's 5/10/25-flight intervals and monthly; mark-done with date (stored in the store under `maintenance`, additive key); pack cycle counts. |
| R5 | MUST | **Flight records:** link a preflight archive session, battery entry, `.bin`/`.tlog` summary and GCS session summary under one record id (additive store key `flights`); a simple list view. |
| R6 | MUST | **Weather extras (§10.5):** cloud cover/low cloud and visibility from Open-Meteo where available; links to official Norwegian airspace/NOTAM sources — **verify the current official URLs on the web and cite them in a comment**; no guessing. |
| R7 | MUST | **Accessibility (§10.8, Tools):** status never by colour alone (icons/text), visible focus styles, `aria-expanded` on toggles, clickable rows as buttons or with `role="button"`/keyboard handlers, labels on inputs. |
| R8 | MUST | **Challenge–response checklist mode:** a full-screen one-item-at-a-time mode (big text, "CHECK" / "SKIP" / "BACK", optional speech via the `speechSynthesis` API, off by default). It uses the same state engine. |
| R9 | MUST | **`tools/latency-clock.html`:** a standalone page with a large millisecond clock for relay-design test 2 (glass-to-glass), plus a frame counter; offline-safe. Linked from the Tools page. |
| R10 | MUST | Tests for all new pure logic (`node --test test/`); jsdom smoke check for each new view; no regressions of WP01/WP05 behaviour. |
