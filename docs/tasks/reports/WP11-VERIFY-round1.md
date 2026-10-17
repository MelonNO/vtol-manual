# WP11 verification — round 1
VERDICT: REJECTED

Worktree `S\wt\WP11`, branch `wp/11` at `f88cfbf`. Diff base is `git merge-base main HEAD` = `e8f9008`, which is the current `main` of `S\repo\vtol-manual`. `main` is an ancestor of `HEAD`, so the merge is a fast-forward with no conflicts (`git merge-tree --write-tree main HEAD` is clean). `git diff --check` is clean.

## Scope

Changed files (`git diff --name-only main...HEAD`):

| File | Owned / justified |
|---|---|
| `index.html` | owned |
| `js/tools-core.js` | owned |
| `js/store.js` | owned (additive). It adds `paramFile` plus `flights`, `maintenance` and `battLog[].usedMah`. The report justifies these in §5.1: R4 and R5 require store keys. |
| `tools/latency-clock.html` | owned (new) |
| `test/tools/{params,bin-analysis,session-log,maintenance,store-wp11}.test.js` | owned |
| `test/fixtures/sample.param` | not on the list, but R1 asks for "tests with a sample `.param`" and the report names it. Accepted. |
| `docs/tasks/reports/WP11-IMPLEMENTATION.md` | owned |

The branch does not edit `data/content.js`, which follows the PM rule. The `index.html` CSP is unchanged, and no new hosts are needed.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `js/tools-core.js:521-553` (table + TODO(content)), `parseParamFile` :561, `paramEq` (float32 tolerance), `compareParams` :581, `paramFileLabel` :598; `js/store.js:292` `cleanParamFile`, load :352-357, merge :513-517; `index.html:509` tab, :2306-2375 | **Values traced to sources (all of them):**<br>- THR_FAILSAFE 2, FS_GCS_ENABL 2, FS_LONG_TIMEOUT 5 and FS_LONG_ACTN 1: plan §13.1 / §6.1.5<br>- BATT_CRT_VOLT 22.2 and BATT_FS_CRT_ACT 6: plan / CLAUDE.md / content.js<br>- BATT_LOW_VOLT 0: manual.html:886<br>- RTL_ALTITUDE 120 and Q_RTL_ALT 70: manual.html:888<br>- Q_TRANS_FAIL 4: manual.html:846<br>- **Q_TRANS_FAIL_ACT 0 = QLand**: plan §13.1, manual.html:847<br>- Q_ASSIST_SPEED 9 and Q_ASSIST_ALT 25: manual.html:849-850<br>- Q_FRAME_CLASS 7 and Q_TILT_MASK 3: manual.html:782-786<br>- AIRSPEED 13 / 11 / 22: manual.html:858-860<br>- FENCE_ENABLE 0: CLAUDE.md:217<br>- FLTMODE1/3/4/5/6: `ai/PROJECT_CONTEXT.txt:224-228`. The positions 1/4/6 also match the manual's 3-position switch (QHOVER / FBWB / AUTO) under standard ArduPilot PWM mapping.<br><br>**FLTMODE2 as TBD:** the right call. The notes say `11 (QLOITER …)`, but in ArduPlane `mode.h` 11 is RTL and QLOITER is 19 (checked against source). The row is shown with the file value and its mode name, and is never judged.<br><br>**Smoke test:** DIFFERS / MISSING / MATCH (float32 22.2), the filter, and the header label all work. |
| R2 | PASS | `binAnalyze` `js/tools-core.js:641-708`, `binBattEntry` :711, `binSummary` :721; `parseBin` keeps `cur` and `Rsn`; UI `index.html:2014-2076` | **Checked against ArduPilot master (downloaded):**<br>- `ModeReason.h`: every number in `MODE_REASON` / `FAILSAFE_REASONS` / `BATTERY_REASONS` matches.<br>- `LogStructure.h`: `MODE` = `TimeUS,Mode,ModeNum,Rsn`.<br>- `VTOL_Assist.cpp`: the texts are `"Alt assist %.1fm"` and `"Angle assist r=%d p=%d"`. Speed assist sends no MSG, so it is correctly not claimed.<br>- `quadplane.cpp`: "Transition started airspeed", "Transition airspeed reached", "Transition FW done", "Transition done", and "Transition failed, exceeded time limit". The `/^Transition (FW )?done/` regex matches both "done" variants.<br><br>**My synthetic `.bin` runs:**<br>- forward transition with time to AIRSPEED_MIN taken from the param file<br>- assist, GCS-failsafe and battery-failsafe (MODE Rsn 4) events<br>- max current per phase<br>- battery entry and attach<br><br>**Edge cases** (unsorted modes, duplicate timestamps, INITIALISING, no modes): no crash, sensible output. See findings 4 and 6 for MSG over-classification and time formatting. |
| R3 | PASS | `parseSessionLog` `js/tools-core.js:737-786`, `sessionBattEntry` :803, `sessionSummary` :815; UI `index.html:2081-2160` | **Conformance to `gcs/README.md` "Session log schema":**<br>- `t` / `mono_s` / `type`<br>- `status.status.bridge.{state,rtt_ms,uplink_loss_pct}`<br>- `status.client.link.lq_pct`<br>- `telemetry` `kind` link / battery / flight_mode<br>- `bridge_state.to`<br>- `alarm` `{id, severity, text, active}`<br>- `mode.start_path`<br>- `session_end`<br>- unknown types ignored and bad lines counted<br><br>**Smoke test:** 4 charts, a WAIT_GCS → RUN → FAILSAFE timeline, RAISED and CLEARED alarms, mAh 380 = last − first, duration from armed time, attach to the same record, XSS escaped. |
| R4 | PASS | `MAINT_TASKS` `js/tools-core.js:831`, `maintStatus` :854; store `cleanMaint` `js/store.js:284`; UI `index.html:2256-2304` | **Intervals:** 5 / 10 / 25 flights + monthly (carrier) and 5 flights (client), per manual.html:1631-1698.<br>**Smoke test:** after 6 carrier entries the status shows ✖ OVERDUE; DONE → ✓ OK 0/5; UNDO → DUE.<br>**Also present:** the pack-cycles table and the client TBD when there is no `packId`. |
| R5 | PASS | `cleanFlight` `js/store.js:279`; UI `flAttach`/`renderFlights`/`flSave` `index.html:2162-2254` | One id links the archive, carrier and client battery entries, the `.bin` summary and the GCS summary. The list view resolves deleted links. The edit form works, and an XSS label is escaped. |
| R6 | **FAIL (partial)** | URL `index.html:2410`; `cloudVis` `js/tools-core.js:885`; `AIRSPACE_LINKS` :889-903; card `index.html:563-568` | **What works:**<br>- Cloud cover, low cloud and visibility render (stubbed Open-Meteo).<br>- I opened every link myself:<br>  - `ippc.no/ippc/index.jsp`: 200, © Avinor Flysikring AS, NOTAM.<br>  - `luftfartstilsynet.no/en/drones/no-drone-zones/`: 301 → www, title "No drone zones". It says "NOTAM can be checked at IPPC.no" and links to dronesoner.no, the Avinor drone map and the AIP.<br>  - `avinor.no/en/practical-info/drone/dronekart/`: 200, "Drone map".<br>  - `partner.avinor.no/en/ais/aip/`: 200, "Aeronautical Information Publication". `avinor.no/en/ais/aipnorway/` 301s to it.<br>  - `dronesoner.no`: 200 "Dronesoner.no", linked by Luftfartstilsynet.<br>  - All are official, and all are cited in the code comment.<br><br>**What fails:** the authorisation line contradicts the owner decision (finding 1, MAJOR). |
| R7 | PASS | CSS `index.html:221-259`, `clA11y` :772, keydown :643, `aria-expanded` in `toggleDetail` / `toggleExpandAll`, `LEVEL_TXT`, `MT_LABEL`, `PF_ST`, forecast GO / CAUTION / NO-GO text | **Smoke test:**<br>- Enter on `.ci-left` (`role=button`, `tabindex=0`) ticks the row and sets `aria-pressed`.<br>- Space on DETAILS sets `aria-expanded=true`.<br>- Every input and select on the page has a label.<br>- `:focus-visible` is present.<br>- The emergency clean-up toggles already carry `aria-expanded` (`js/render-content.js:130`). |
| R8 | PASS | modal `index.html:317-332`, `crOpen`…`crReview` :883-955, `clSetItem` / `clRowSync` :785-800; helpers `js/tools-core.js:505-519` | **Smoke test:**<br>- CHECK ticks through `ToolsCore.clToggle`: persisted in `vtol_cl_preflight` with a time stamp, and the list row is synced.<br>- SKIP is counted; BACK shows "SKIPPED — NOT CHECKED".<br>- Speech is off by default; when on, it speaks plain text.<br>- Escape closes the mode, and the emergency modal is untouched.<br><br>See finding 5 (the FAB is hidden behind the mode). |
| R9 | PASS | `tools/latency-clock.html`; `latencyStats` / `fmtClockMs` `js/tools-core.js:866-881`; link `index.html:487-491` | **Smoke test:** the clock runs `HH:MM:SS.mmm`, the frame counter is > 0, and samples 120/150/200 give mean 157 and worst 200.<br>**Offline:** no external URLs in the page; its own strict CSP (`default-src 'self'`); the only script is `../js/tools-core.js`. The SW network-first rule caches it after the first visit (`sw.js`); precaching is WP09.<br>**Content:** the wording matches relay-design test 2 (line 550: 240 fps, 20 samples, mean and worst). |
| R10 | PASS | 5 new test files, 28 new tests (main has 163; this branch has 191, all passing); my jsdom smoke: 86/86 | Each test file exercises real logic (38 / 52 / 30 / 32 / 20 asserts). WP01/WP05 regressions all pass: expiry, Link "GCS APP NOT RUNNING" with the real `gcs-client.js`, emergency modal, profiles, invalid-pack import. The report's test count is wrong (finding 7). |

## Contract results

| Contract | Result | Note |
|---|---|---|
| C1 / C1.4 (store) | PASS with minor notes | **Conforming:**<br>- `flights` and `maintenance` are normal collections (merge by id, tombstones). A tombstone import deletes the local record (smoke test).<br>- Invalid maintenance records are dropped.<br>- `usedMah` < 0 is coerced to null.<br>- `paramFile` is validated on load and import. An older or invalid incoming record does not overwrite the local one (smoke test).<br>- An old store without the new keys loads with `[]`.<br><br>**Gaps:** `importedAt` is compared as a raw string without normalising to ISO (finding 2), and `cleanFlight` coerces but never rejects (finding 3).<br><br>These extensions need to go into `02-CONTRACTS.md` (PM). |
| C1.2 `battLog.source` | PASS | `'bin'` / `'gcs'` used. |
| C2 / C2.1 (session-log status object) | PASS | Paths match the Status object, and `start_path` is read from `mode` records. |
| C4 | PASS (minor) | `index.html` uses `escH` and `fmtTime`. `tools/latency-clock.html` has its own clipboard code instead of `VtolCommon.copyToClipboard`, so it has no fallback (finding 8). |
| C5 / C5.1 | PASS | `VtolContent` checklists are consumed through `VtolRender.fmt` / `plain`. Raw markup is never shown or spoken. `data/content.js` is untouched. |

## Tests run

- `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/` in the worktree → **tests 191, pass 191, fail 0**. The same on `main` gives 163, so 28 tests are new.
- `node --test test/tools/{params,maintenance,store-wp11,session-log,bin-analysis}.test.js` → 28 / 28 pass.
- Pure-logic edge cases, run inline with Node:
  - `msgKinds` on 19 real ArduPilot texts
  - `binAnalyze` with unsorted modes, duplicate timestamps, INITIALISING, and an empty log
  - store load of a store without `flights` / `maintenance`
  - `paramFile` merges with non-ISO dates

## Smoke tests

My own script is `S\verify\WP11\smoke.js`; its log is `S\verify\WP11\smoke.log`. It loads the pages under `https://melonno.github.io/vtol-manual/…` with a request interceptor that serves the worktree files, and gives jsdom files through `input.files`. Result: **86 pass, 0 fail, 0 script errors.**

The script covers:
- **Load:** every new element exists, the latency link is present, and the header starts as "not verified".
- **Params:** an XSS file name, Q_TRANS_FAIL_ACT DIFFERS (QLand), BATT_CRT_VOLT float32 MATCH, AIRSPEED_MIN DIFFERS, AIRSPEED_MAX MISSING, FLTMODE2 TBD amber, the header label, the bad-line report, the filter, and persistence.
- **`.bin`** (synthetic DataFlash records: FMT / BAT / ARSP / MODE with Rsn / MSG / GPS):
  - forward transition QHOVER → FBWB, 10.0 s to the param-file AIRSPEED_MIN of 12
  - no false back transition for RTL → LOITER_QLAND
  - assist, GCS-failsafe and BATTERY_FAILSAFE events
  - per-phase current: VTOL 61 A, transition 70 A, FW 33 A
  - XSS in MSG text and file name escaped
  - battery entry and attach
- **GCS session:** see R3.
- **Flight record:** edit, XSS label escaped, both summaries listed.
- **Maintenance:** OVERDUE → DONE → UNDO.
- **Challenge–response:** see R8.
- **A11y:** see R7.
- **Weather:** stubbed fetch → total cloud 75 %, low cloud 40 %, visibility 8.5 km; GO text on rows; 5 https links.
- **Import:**
  - flight tombstone and new record
  - XSS in every flight, summary and param-file string, with no script executed
  - invalid maintenance record, negative `usedMah`
  - newer, older and invalid param files
  - invalid pack record does not reset the local one
- **Regression:**
  - emergency modal opens and closes with Escape
  - profiles render
  - Link tab with the real `gcs-client.js` and fetch rejected → "GCS APP NOT RUNNING"
  - a checklist 7 h old is reset with the notice "expired — reset (older than 6 h)"
- **`tools/latency-clock.html`:** see R9.

`npx --prefix S/jsenv html-validate`:

| Page | `main` | this branch |
|---|---|---|
| `index.html` | no-implicit-button-type 31, no-inline-style 74, prefer-tbody 1 | 31, **94**, 1 |
| `tools/latency-clock.html` | — | no-inline-style 2 |

The only new errors are +20 `no-inline-style` in new static markup. They follow the page's existing style; see finding 9.

## Findings

1. **MAJOR — `index.html:567`: the authorisation line contradicts the owner decision.** The new Weather / airspace card shows `TBD — confirm that remote piloting through the relay is covered by the operational authorisation (Luftfartstilsynet); open question in the relay design`.
   - Plan §1.1 records the owner's answer to that open question: "Remote piloting through the relay **is covered** by the operator's authorisation (Luftfartstilsynet)".
   - The rest of the app already states this: `manual.html:466`, and the pre-flight checklist item `site-airspace` in `data/content.js:66`.
   - So the Tools page now tells the crew, before flight, that coverage is unconfirmed, while the checklist they tick says it is covered. The report's placeholder table (§3) cites only the relay design and ignores §1.1.
   - **Expected:** state the owner decision ("covered by the operator's authorisation (Luftfartstilsynet) — plan §1.1"). Keep an amber `TBD` only for what is actually unknown, e.g. the authorisation reference number or document, as plan §10.5 asks for the reference.
2. **MINOR — `js/store.js:301` and `:514`: the param-file "newer wins" check compares raw strings.** `cleanParamFile` accepts any `Date.parse`-able `importedAt` and stores it unchanged. `mergeStores` then compares the strings.
   - An imported `"Fri, 01 Jan 2000 00:00:00 GMT"` beats a real ISO stamp, because `'F' > '2'`. I reproduced this.
   - **Expected:** normalise to `new Date(…).toISOString()` in `cleanParamFile`, or compare `Date.parse` values.
3. **MINOR — `js/store.js:279` `cleanFlight`: nothing is ever rejected.** It coerces every field and never rejects a record, so a newer incoming flight record with a non-date `date` or a non-array `battIds` replaces a valid local one with a coerced shell.
   - The result is display-only and escaped, so the risk is low. Still, C1.4 says invalid incoming records must not overwrite valid local ones.
   - **Expected:** reject records without a `YYYY-MM-DD` date. `cleanMaint` should also check that `doneDate` is a real date.
4. **MINOR — `js/tools-core.js:631-636` `MSG_KINDS`: the failsafe and battery patterns catch too much.** The failsafe pattern `\bfailed\b|\blost\b` labels non-failsafe messages as **⚠ FAILSAFE** in the debrief table, and the battery pattern also misfires. Verified:
   - "Calibration failed" → FAILSAFE
   - "Mode change to QLAND failed: requires position" → FAILSAFE
   - "Airspeed sensor 1 failed" → FAILSAFE
   - "Lost GPS lock" → FAILSAFE
   - "PreArm: Battery 1 below minimum arming voltage" → BATTERY
   - **Expected:** match the ArduPlane failsafe texts (`Failsafe`, e.g. "GCS Failsafe On", "RC Short Failsafe On"), plus "Transition failed". Battery should match "Battery … is low / critical", not PreArm or Arm texts.
5. **MINOR — `index.html:33` vs `:41`: the emergency button is hidden in challenge–response mode.** `#cr-modal` (z-index 1000, full screen, opaque) covers `#emerg-fab` (z-index 900), so the emergency card is reachable only after CLOSE. Consider an EMERGENCY button in the challenge–response top bar.
6. **MINOR — `index.html:2005` `fmtS`: wrong times near minute boundaries.** `Math.floor(s/60)` + `Math.round(s)%60` shows 59.6 s as `0:00` and 119.5 s as `1:00`. Round first, then split.
7. **MINOR — report §1 and §2 R10: wrong test numbers.**
   - The report claims "55 of them new" and "6 new test files (55 tests)". The real figures are 5 new test files and 28 new tests (191 − 163); its own §4 lists 5 + 7 + 4 + 7 + 5 = 28.
   - It also says "This cannot happen with the current table" for the `.bin` TBD; that one is correct.
8. **MINOR — `tools/latency-clock.html` `copyResult`: private clipboard code.** It does not use `VtolCommon.copyToClipboard` (C4), so it has no fallback on non-secure or blocked clipboards. It does show the text, which is an acceptable degradation.
9. **MINOR — housekeeping:**
   - +20 `no-inline-style` in new static markup.
   - Unused parameter `role` in `packOptions` (`index.html:2006`).
   - Redundant `n` argument in `battSel` (`index.html:2218`).
   - The Q_ASSIST_ALT "altitude reference: VERIFY" note shows as plain text in the Params table, not as the amber VERIFY marker the manual uses.
   - A `.param` CLEAR is not propagated through import (no tombstone; documented as a limitation).
   - A forward transition into AUTO (VTOL_TAKEOFF) counts the VTOL climb as "transition" (documented). The "Transition started" / "Transition done" messages could bound the window better.

## Approval rationale

REJECTED: one MAJOR finding remains.

- **Must fix:** finding 1 (R6, MUST). The airspace card must not contradict the owner decision in plan §1.1, which `manual.html` and the pre-flight checklist already state. Show the decision, and keep a visible amber TBD only for the authorisation reference itself.
- **Recommended in the same rework (MINOR):**
  - findings 2 and 3 (store robustness, C1.4)
  - finding 4 (misleading FAILSAFE labels)
  - finding 6 (time format)
  - finding 7 (report numbers)

Apart from finding 1, the rest of the work package is complete and well tested:
- every expected parameter value traces to a source, and Q_TRANS_FAIL_ACT is 0 = QLand
- FLTMODE2 TBD is justified
- the ArduPilot facts are correct
- the session-log viewer conforms to the schema
- every imported string is escaped
- the R6 URLs are official
- WP01 and WP05 behaviour is intact
- the branch fast-forwards onto `main`
