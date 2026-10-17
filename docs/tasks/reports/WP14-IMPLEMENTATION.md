# WP14 — Implementation report (carrier parameter update Rev C and parameter reference)

Branch `wp/14`, worktree `S\wt\WP14`, base `d89a977`. Implementation commit `abafb8e`, plus this report.

## 1. Summary

- **Reference file (R1).** The owner's `params.param` is stored byte for byte as `docs/reference/carrier-params-2026-10-17.param`. That is 1663 parameters with CRLF line endings, SHA-256 `2eb324cc…e460`; `.gitattributes` marks it `-text`. `docs/reference/README.md` gives the date, the source and the update steps. `scripts/gen-params-reference.mjs` (plain Node, with `--check`) generates `data/params-reference.js`, the global `VtolParamsRef` of contract C1.6.
- **Manual.**
  - New **Reference ▾ Parameters** tab with all 1663 parameters. They are grouped by prefix, and a group's rows are built only when the group is opened. The tab has a search, and the 68 relied-on parameters are highlighted with a meaning and a chapter link.
  - Every value, failsafe description, the battery ladder, the compass and the geofence follow plan §15. The tab also adds the voltage ladder card, a GPS & Compass section, a Compass Calibration procedure, new Pre-Arm rows and the maintenance offsets item.
- **Shared content.**
  - The failsafe copy block is now exactly the owner's list.
  - SIYI loss → RTL in fixed-wing modes, QRTL in VTOL modes. Every RTL ends with an automatic VTOL landing at home, so a checklist item keeps the home landing zone clear.
  - Battery card ladder: 23.0 manual RTL → 22.5 must be active → **22.0 auto RTL** → **21.0 QLand here**.
  - Transition timeout: 8 s → QRTL home.
  - 915 MHz loss: no action; QHOVER holds and drifts with the wind.
  - New compass item.
- **Store (C1.6).** New defaults 21.0 / 22.0 / 24.6. Old stored settings are migrated, with a one-time notice that stays until it is dismissed on any page. An imported param file's values take precedence everywhere, through `ToolsCore.effectiveSettings`.
- **Tools.**
  - Header: LOW 22.0, CRIT 21.0, cruise 12 m/s.
  - The battery analysis output is relabelled "Suggested manual RTL trigger (pilot, OSD raw voltage)". It shows the configured failsafes and never recommends changing them.
  - The trend chart has 22.0 / 21.0 lines.
  - The Params tab compares a 56-row safety subset against the reference, shows the reference as the baseline when no file is imported, and diffs a whole imported file against it.
- **Diagrams and map.**
  - Diagrams: gauge, trend, D7, the mission profile with the QRTL path and ≈100 m back-transition, and the motor diagram at 45°/s.
  - Map simulation speeds: minimum = `AIRSPEED_MIN` (10 m/s), default = `AIRSPEED_CRUISE` (12 m/s), taken from the imported param file, otherwise from the reference.
- **WP09 carry-overs** R12b and R12c (a)–(e) are fixed.

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `docs/reference/carrier-params-2026-10-17.param`, `docs/reference/README.md`, `.gitattributes:30-31`, `scripts/gen-params-reference.mjs`, `data/params-reference.js`; test `test/params/reference.test.js` | **Byte-exact:** `cmp` against the Downloads file showed no difference, and the git blob SHA-256 equals the file's. **Generator:** a strict parser fails on any bad line or duplicate. The date comes from the file name, and exactly one reference file must exist. **Tests:** the SHA-256, line count and CRLF are pinned; `render()` equals the committed file; an independent `ToolsCore.parseParamFile` gives the same names, order and values; and every raw line is checked. |
| R2 | DONE | nav `manual.html:315`, panel `:1354`, `renderParamsTab`/`paramsFilter` `:2102+`, CSS `.pr-*`; `ManualCore.TABS` has `params` | **Header:** names the file, the saved date 2026-10-17, the 1663-parameter count and the source path. **Relied-on table:** 68 rows from `ToolsCore.PARAM_NOTES` (value from the reference, meaning, chapter link such as `#aircraft/ac-battery`). **Full file:** 116 prefix groups as `<details>`, with rows built when a group opens and relied-on rows starred and highlighted. **Search:** by name or exact value, capped at 200 rows. **Phone:** at 360 px the rows stack and the page has no horizontal scroll (Edge measurement: `scrollWidth` 360). |
| R3 | DONE | see the §7 table; `test/params/obsolete.test.js` | **Values:** all plan §15.1 values, plus the km/h conversion (43.2), back-transition ≈ 100 m, the hover-thrust "learned, drifts" note and the new Aircraft rows (BATT_FS_LOW_ACT, BATT_FS_VOLTSRC, BATT_ARM_VOLT, Q_M_BAT_VOLT_MAX/MIN, Q_RTL_MODE, Q_OPTIONS). **Scan test:** looks for every listed obsolete value in its safety context across 38 files: pages, data, js, map, diagram generators and SVGs. It has a regex self-test (old wording must be caught, new wording must not be). A second test checks every written `PARAM = value` against the reference. **VERIFY markers removed** where the reference resolves them: Q_TRANS_FAIL_ACT, ARSPD_TYPE, AHRS_GPS_MINSATS, ≥6 sats, Q-mode TBD → now a value. **Kept** where behaviour still needs a firmware or bench check: the Q-mode QRTL case (SITL S-02), S-01a QHOVER drift, the Q_TILT_MAX meaning, Q_FRAME_TYPE, the Q_ASSIST_ALT reference and HDOP. |
| R4 | DONE | content `fs-*` rows `data/content.js:349-354`, cards `emerg-gcs :187`, `emerg-trans :295`, `emerg-batt :313`, note `:336`, design intent `:65`, checklist `site-home-lz-flight :81`, `carrier-mission` note; manual `#siyi-loss :585`, `#battery-failsafe :593`, `#s01a :633`, `#lowbatt-qhover-landing :1067`, Mission / Procedures / Mission Planning alerts | All five points of §15.2 are covered. **Pilot's manual QHOVER at 2–3 s** is kept. **"Keep WP2 → home clear (QRTL path)"** appears in content, the manual and the mission diagram. |
| R5 | DONE | `emerg-batt` immediate steps; manual ladder card `:898`; Pre-Arm `:1124-1125`; glossary 6S row; storage note; content `pf-carrier-pack` token | **Ladder:** the steps resolve to 23.0 / 22.5 / 22.0 / 21.0 (tokens, so a param file takes precedence). **BATT_FS_VOLTSRC note:** in the ladder card, the battery alert, the card summary and the gauge. **Removed:** the "Set BATT_LOW_VOLT" step. |
| R6 | DONE | `ToolsCore.suggestManualRtl` `js/tools-core.js:106`; `index.html:1130-1155`; header `:293-296`; `js/diagrams.js:203-205` | **Formula:** avg landing + 0.8 V, floored at the manual RTL setting, labelled as the pilot's OSD call. **Configured failsafes:** shown in a fixed "not changed from this log" box and in the threshold rows, with their source (settings or param file). `recommendBattLow` is removed. **Chart:** 23.0 MANUAL RTL, 22.5 HARD LIMIT, 22.0 BATT_LOW RTL and 21.0 BATT_CRT QLAND lines. |
| R7 | DONE | `js/store.js:17-24`, defaults `:98-103`, `NUM_SETTINGS`, `notices/dismissNotice/migrateRevC :392-430`, `load()`; `ToolsCore.effectiveSettings/settingsVsReference :56-82`; tests `test/params/store-revc.test.js` | **Unedited old store:** 22.2 → 21.0, the new keys are added, and one notice is shown; the store is saved and never migrated twice. **Edited store:** the values are kept, the new keys are added, and the notice says "differ from the reference param file". The Tools settings also show a permanent `.ref-diff` line. **paramFile precedence:** on the manual, Tools, the gauge, content tokens, the battery analysis and the header, with the source named. |
| R8 | DONE | `PARAM_NOTES`/`expectedParams`/`EXPECTED_PARAMS` getter `js/tools-core.js:568-660`; `compareParams` (+`learned`), `diffParamSets`, `paramValue` → reference; `index.html renderParams :2383` | **Subset:** 56 Tools rows (plan §15.1, the unchanged list and FLTMODE1–6), with values only from `VtolParamsRef`. `FLTMODE2` = 11 (RTL). **Learned value:** hover thrust is never judged. **Imported file:** the subset table plus a whole-file diff (differ / only in reference / only in file). **No file:** the reference is shown as the baseline. |
| R9 | DONE | `js/diagrams.js:84-180`; `scripts/diagrams/d4-8.js` D7; `inline.js` motors / mission; `slots.js` D7 | **Gauge:** 24.6 arm, 23.0, 22.5, 22.0 auto RTL, 21.0 QLand here, 22.8 storage, "18.6 V floor", zones and the VOLTSRC note. **D7:** transition fail → QRTL home; GCS loss → RTL (fixed-wing) / QRTL (VTOL); low → RTL; critical → QLand here; timeline ends in an automatic VTOL landing at home. **Mission:** "8 s: automatic QRTL home", an amber QRTL path back to home at 50 m with "keep WP2 → home clear", and "glide ≈100 m (8 s)". **Motors:** 45°/s. **Checks:** `build.js --check` is green, and the diagrams were inspected visually in Edge. |
| R10 | DONE | Fence: Pre-Arm `#prearm-fence :1129` (kept, with both conflicts noted), `PARAM_NOTES` fence rows. Compass: Aircraft `#ac-compass :916`, Procedures `#compass-cal :1069`, Pre-Arm rows `:927-929`, content `carrier-compass-ext :110`, Maintenance `#maint-compass-ofs :1607` | The geofence is described as "no geofence configured" everywhere. The calibration steps are plan §15.5 verbatim. The maintenance item gives the reference offsets X −10.10444, Y −16.05964, Z −70.66866 from the file. |
| R11 | DONE | `relay/map.html:276-285`, `simSpeedLimits/applySimSpeedLimits :617-642`, init `:2222`, storage listener | Slider minimum = `AIRSPEED_MIN`, default = `AIRSPEED_CRUISE`, each taken from `store.paramFile` or else the reference, with the source in the text below. TECS climb / sink stay 5 m/s. |
| R12 | DONE | `data/content.js:45-63` | The block is **exactly** the owner's list (extracted programmatically from the owner's document, spacing included). A test pins it and checks every value against the reference. |
| R12b | DONE | `js/gcs-client.js:29-50,117` | **Root cause:** `this.setT = setTimeout` was called as a method, which a browser rejects with "Illegal invocation". That threw inside async `health()`, which surfaced as "Uncaught (in promise)" and stopped all polling (the WP09 verifier saw "GCS polled" fail). **Fix:** timers are called as plain functions, and every async step goes through `Session.run()`, which swallows rejections. Also fixed: when `/status` failed while `/health` succeeded, the client looped health → status with no delay (a hot loop that starves timers); it now waits `HEALTH_MIN_MS`. **Tests:** `test/pwa/wp14-carryover.test.js` uses browser-strict timer stubs and a rejecting fetch, and asserts there are no unhandled rejections. |
| R12c | DONE | (a) `relay/map.html:63-67`; (b)(c) `css/print.css:58-61,81`; (d) `test/pwa/assets.js:17-36`; (e) `css/base.css:24,68` | **(a) Map header:** the phone header buttons stack in one column. Measured in Edge at 360×640 with CDP device metrics: header 218 → **134 px**, map area 422 → **506 px** (pre-WP09: 162 / 478). **(b) Kneeboard PDF:** printed in Edge; the last page now holds the end of the turnaround list and the footer, so there is no footer-only page (corrected in rework round 1: with the A4 / CSS page size WP14 prints 10 pages vs 11 on `main`, as the verifier measured; my own print with Edge's default page size gave 11). **(c) print.css:** the comment is corrected. **(d) Asset scanner:** detects `<picture>` fallbacks by position, and the test covers it. **(e) Toast shadow:** now uses the `--shadow` token. |
| R13 | DONE | §4 | **Tests:** all pass; `build.js --check`, `gen-precache --check` and `gen-params-reference --check` are green. **Smoke:** my jsdom smoke passes 60/60 with no errors on all 4 pages. **html-validate:** index 127 → 127, manual 0 → 0, map 40 → 40, clock 2 → 2. **Values:** every number traces to plan §15 or the reference file (§7). |

## 3. Placeholders / markers

There is no new TBD placeholder. These VERIFY markers are new or kept on purpose:

| Where | Marker | Why |
|---|---|---|
| SIYI card clean-up, `fs-siyi`, manual `#siyi-loss`, D7 | VERIFY — confirm the Q-mode (QRTL) case in SITL (S-02) | Plan §15.2 states the behaviour. The old TBD asked for a SITL test, and that test has not been run. |
| 915 note close-in, manual S-01a | VERIFY — S-01a bench/SITL test | The behaviour (holds and drifts) comes from plan §15.2; the bench test is still open. |
| Gauge | "BATT_LOW_VOLT: TBD in the settings" | Shown only when a setting is cleared (null). |

## 4. Tests

- **New:**
  - `test/params/reference.test.js` (5 tests): the R1 file and generator, and the pinned §15.1 values.
  - `test/params/obsolete.test.js` (3): the R3 scan, the regex self-test, and every `PARAM = value` checked against the reference.
  - `test/params/store-revc.test.js` (7): the C1.6 defaults; migration of an unedited store (one notice, persisted, dismissable) and of an edited store (values kept, "differs" notice); no migration of a Rev C or fresh store; validation of the new settings; paramFile precedence through tokens, gauge and thresholds.
  - `test/pwa/wp14-carryover.test.js` (4): gcs-client with no unhandled rejection (browser-strict timers) and the swallowed sync throw, the map header CSS, and the asset scanner `<picture>` case.
- **Updated to Rev C:** content, render, manual (the Q_TRANS_FAIL_ACT test now asserts QRTL; FS_SHORT_TIMEOUT is allowed, as the owner's document requires), diagrams (D7, gauge, trend, inline SVGs), pwa (base tokens + `--shadow`, emergency-only ladder, print rules, gauge carry-overs), tools (battery suggestion, packThresholds, params against the reference, store defaults).

```
export PATH="/c/Program Files/nodejs:$PATH"
node --test test/                                   → tests 282, pass 281, fail 0, skipped 1 (jsdom)
VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/ → tests 282, pass 282, fail 0
node scripts/diagrams/build.js --check              → up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-precache.mjs --check               → up to date (57 assets; + data/params-reference.js)
node scripts/gen-params-reference.mjs --check       → up to date (1663 parameters)
```

**jsdom smoke** (outside the repo): `node S\wp14tools\smoke.js S\wt\WP14` → **60 pass, 0 fail**. It covers:
- all 4 pages load with no errors and no unhandled rejections; the map uses the real gcs-client;
- Tools: header values; the copy block equals the owner's list; the card ladder; the transition, SIYI and home-LZ items; the compass item; the params baseline (56 rows, FLTMODE2 11); the imported-file comparison and whole-file diff; param-file precedence in the header, the settings line and the emergency card; the relabelled battery analysis with no BATT_LOW recommendation; the trend lines; migration notices for unedited and edited stores, and dismiss;
- manual: the notice and dismiss; `#params`; the header date and count; 68 relied-on rows; chapter links; 116 groups, with all 1663 parameters reachable; search; the new Aircraft rows; km/h; back-transition; compass; gauge markers; Pre-Arm, Maintenance and Procedures rows; param-file precedence in the gauge;
- map: slider 10 / 12 from the reference, and 11 / 13 from an imported file.

**Earlier verifier smokes** (WP05 r2, WP07, WP11 r2, wp11smoke, WP06-link, WP09 jsdom), run on base `d89a977` and on WP14:
- WP09 jsdom: 40/40 on both.
- The other smokes' new failures are **only** assertions of the old values: QLand on transition fail, the 22.2 gauge, "BATT_LOW not set", Q_TRANS_FAIL_ACT 0 / FLTMODE2 TBD in Params, and the nav count (15 → 16, the new tab).

## 5. Deviations / contract issues — PM please read

1. **C1.6 additive fields:**
   - `VtolParamsRef` also carries `count` and `sha256` (the contract names `source`, `savedDate`, `params`).
   - `VtolStore` gains `REV_C`, `REV_C_PARAM`, `NOTICE_KEY`, `notices()` and `dismissNotice()`. One-time notices live in `localStorage['vtol_store_notices']`, not in `vtol_store`, so every page can show them whichever page ran the migration.
   - `ToolsCore` gains `refParams`, `FS_VOLT_PARAMS`, `effectiveSettings`, `settingsVsReference`, `PARAM_NOTES`, `expectedParams`, `diffParamSets` and `suggestManualRtl`; `recommendBattLow` is removed. `EXPECTED_PARAMS` is now a getter, and `compareParams` gets a new status `learned`. `paramValue` falls back to the reference (`source: 'reference'`) instead of `'documented'`.
   - `packThresholds` adds `battLowV` and `armV`.
   - Please record these in `02-CONTRACTS.md`.
2. **Files outside the brief's list:**
   - `.gitattributes`: the `-text` rule is needed for byte-exactness.
   - `js/gcs-client.js`, `css/base.css`, `css/print.css`, `test/pwa/assets.js`: permitted by R12b / R12c. `js/field.js` was not needed.
   - `js/render-content.js` is **not** changed. Precedence is done by passing effective settings into `ctxFrom`.
3. **Found beyond plan §15:** the manual said `Q_LAND_FINAL_SPD = 0.2 m/s`, but the reference file has **0.5**. It is corrected to 0.5 (source: reference file) and the reference test now pins it. Please confirm with the owner.
4. **The old `test/fixtures/sample.param`** (synthetic, pre-Rev C values) is kept on purpose. It now shows 6 DIFFERS against the reference, which tests the detection.
5. **WP10 scope, untouched:** `CLAUDE.md` and `ai/PROJECT_CONTEXT.txt` / `SESSION_NOTES.txt` still hold the old values (22.2, 13 / 11 m/s, Q_TRANS_FAIL 4 / 0, Q_RTL_ALT 70, BATT_LOW 0, "recommendation formula"), as plan §15.6 assigns them to WP10. `js/version.js` `paramFile: 'TBD'` is unchanged (WP01/WP09); the footer still shows TBD until a file is imported.
6. **Content judgements, all from §15 / the owner's document:**
   - The S-01a and Q-mode SITL items stay as VERIFY (see §3).
   - The new checklist item `site-home-lz-flight`.
   - The compass check got a **new id** `carrier-compass-ext`, because its meaning changed (content id rule).
   - The callout `co-clean-transition` now reads ">10 m/s (AIRSPEED_MIN)".
   - The manual keeps the pilot's 3 s abort rule as the one transition number. Q_TRANSITION_MS 3.5 s appears only in the parameter table, so MAN-06 still holds.
7. **Process note (please check other agents):** while a hung test run was in progress I used `taskkill /F /IM node.exe`, which ended **every** `node.exe` on the machine. If another work package's test or smoke run failed around 14:00 local time, re-run it.

## 6. Notes for the verifier

- **Parameters tab:** `manual.html#params`. Open any group (e.g. `BATT…`) and search `q_rtl` (3 matches) or `426016`. Chapter links jump to e.g. `#aircraft/ac-battery`.
- **Migration:** set `localStorage.vtol_store` to an old store (settings with `battCrtVolt: 22.2`, without `battLowVolt` / `battArmVolt`) and reload Tools or the manual. The amber notice appears on whichever page you open, until DISMISS. Add `settings.updatedAt` to see the "kept / differ" variant and the permanent `.ref-diff` line under Battery Configuration and PROFILES → Settings.
- **Precedence:** import a `.param` file with a different `BATT_CRT_VOLT` in Tools → PARAMS. The header CRIT, the emergency card, the gauge (manual Aircraft) and the battery analysis all follow it and name the file.
- **Map:** with no file, the slider is 10…35 with a default of 12, and the source line names the reference file.
- **Measurement scripts** (outside the repo):
  - `S\wp14tools\cdp.mjs` and `shot.mjs`: Edge CDP with 360×640 device metrics.
  - `smoke.js`: the jsdom smoke.
  - `xcheck.js`: the param cross-check.

## 7. Changed values (location → source)

"Plan" = `docs/SOFTWARE-IMPROVEMENT-PLAN.md` §15. "Ref" = `docs/reference/carrier-params-2026-10-17.param`. "Owner" = the owner's document of 2026-10-17.

| Value | Old → new | Where (files) | Source |
|---|---|---|---|
| BATT_CRT_VOLT | 22.2 → **21.0 V** (3.50 V/cell) | store default; manual header, Overview, Aircraft table + ladder, Flight Modes alert, Procedures battery step, Pre-Arm "Battery failsafe on", glossary 6S, storage note; content card / table / postflight token; Tools header; D7; gauge; trend | Plan §15.1/§15.3, Ref |
| BATT_LOW_VOLT | 0 "not set" → **22.0 V, auto RTL** (BATT_FS_LOW_ACT 1, BATT_LOW_TIMER 10 s) | as above + new store key `battLowVolt`, Tools settings inputs, battery analysis box, chart line | Plan §15.1/§15.2, Ref |
| BATT_ARM_VOLT | — → **24.6 V** | store key `battArmVolt`; Overview, Aircraft, ladder, Pre-Arm new row, Takeoff arm step, checklist notes, gauge | Plan §15.1/§15.3, Ref |
| BATT_FS_VOLTSRC | — → **1** (sag-compensated) | Aircraft row, ladder note, Flight Modes alert, battery card summary, gauge note, Tools box | Plan §15.1/§15.3, Ref |
| BATT_FS_CRT_ACT | 6 (meaning confirmed) | Aircraft row, `fs-batt-crit` | Plan §15.1, Ref |
| Q_M_BAT_VOLT_MAX/MIN | — → **25.2 / 19.8 V** | Aircraft row | Plan §15.1, Ref |
| AIRSPEED_CRUISE | 13 → **12 m/s (43.2 km/h)** | manual header, Overview, Aircraft, Mission table, Procedures step; Tools header, .bin "Cruise target" (from file / ref); map default speed | Plan §15.1, Ref |
| AIRSPEED_MIN | 11 → **10 m/s** | Overview, Aircraft, Procedures step, callout `co-clean-transition`; map slider minimum; .bin target via `paramValue` | Plan §15.1, Ref, Owner |
| Q_TRANSITION_MS | 3000 → **3500 ms** | Aircraft table | Plan §15.1, Ref |
| Q_TRANS_FAIL / _ACT | 4 s / 0 QLand → **8 s / 1 QRTL home** | Aircraft, Mission table + alert, Procedures alert, Mission Planning step 3, glossary QLAND / new QRTL; content `fs-trans`, `emerg-trans`, copy block; D7; mission SVG | Plan §15.1/§15.2, Ref |
| Q_BACKTRANS_MS | 10000 ms / 100–130 m → **8000 ms / ≈ 100 m** | Aircraft, Mission table, Procedures Recovery, Mission Planning step 4, mission SVG | Plan §15.1, Ref |
| Q_RTL_ALT | 70 → **50 m** | Overview, Aircraft; content SIYI clean-up / `fs-trans` / transition card; D7 | Plan §15.1, Ref |
| Q_RTL_MODE | — → **2** (auto VTOL landing at home) | Aircraft row, mode table, SIYI loss card, glossary RTL, content, D7, checklist | Plan §15.1/§15.2, Ref |
| Q_OPTIONS | — → **426016** (bit 5 set, bit 19 cleared) | Aircraft row, SIYI loss, `fs-siyi`, D7 | Plan §15.1, Ref |
| TRIM_THROTTLE | 35 → **30 %** | Overview, Aircraft | Plan §15.1, Ref |
| Q_M_THST_HOVER | 0.272 (~27.2 %) → **0.35 (~35 %), learned, drifts** | Overview, Aircraft; Params `learned` status | Plan §15.1, Ref |
| Q_TILT_RATE_UP/DN | 40 → **45 deg/s** | Aircraft, motors SVG | Plan §15.1, Ref |
| FLTMODE2 | TBD ("QLOITER") → **11 RTL** | Tools Params, Flight Modes paragraph | Plan §15.1, Ref |
| Fence | "configured but disabled" → **no geofence** (FENCE_ENABLE/TYPE/TOTAL 0) | Pre-Arm row + conflicts, PARAM_NOTES | Plan §15.1, Ref, Owner |
| Compass | not documented → **IST8310 only** (658945 prio 1, EXTERNAL 2, USE2 0, CAL_FIT 16, AUTO_ROT 2) | Aircraft GPS & Compass, Procedures, Pre-Arm, checklist, Maintenance (OFS X/Y/Z from Ref) | Plan §15.1/§15.5, Ref |
| Failsafe copy block | 7 lines → **owner's 15 lines** | `data/content.js` FAILSAFE_PARAMS | Owner, R12 |
| SIYI-loss action | RTL any mode (Q-mode TBD) → **RTL (FW) / QRTL (VTOL)** + auto VTOL landing at home | content, manual, D7 | Plan §15.2 |
| 915 loss in QHOVER | TBD → **holds with centred sticks, drifts with the wind** (VERIFY kept) | note, S-01a, `fs-915`, D7 | Plan §15.2 |
| Battery ladder steps | 23.0 / 22.5 / 22.2 autoland → **23.0 / 22.5 / 22.0 auto RTL / 21.0 QLand here** | emergency card, manual alerts, gauge, ladder card | Plan §15.3 |
| Battery-log output | "Recommended BATT_LOW_VOLT" → **"Suggested manual RTL trigger (pilot, OSD raw voltage)"** | Tools battery analysis, `suggestManualRtl` | Plan §15.4 |
| Q_LAND_FINAL_SPD | 0.2 → **0.5 m/s** | Procedures Recovery step 4 | Ref (beyond §15 — see §5.3) |
| Pre-Arm VERIFY | ARSPD_TYPE 4, AHRS_GPS_MINSATS 6, ≥6 sats: VERIFY → **checked** | Pre-Arm table and note | Ref |
| Map sim speed | min 11 / default 13 → **10 / 12** (file > ref) | `relay/map.html` | Plan §15.1, Ref (R11) |

## Rework round 1

This round answers `S\verify\WP14\VERIFY-round1.md` (REJECTED: F1, F2 MAJOR; F3–F7 MINOR) and the PM's decisions in the round-1 message.

| Finding | Sev | Fix | Evidence |
|---|---|---|---|
| **F1** Pre-Rev C failsafe statements survived | MAJOR | All of these now follow plan §15.2 / §15.3: the **link** failsafe is SIYI / GCS loss only (never 915 MHz), giving RTL in fixed-wing modes and QRTL in VTOL modes; the **battery** failsafes are low 22.0 V → RTL and critical 21.0 V → QLand here; a transition timeout QRTLs home. | **Manual:** glossary "Failsafe", crew-training "Failsafe intent", HM30 section and S-02a paragraph. **Content:** `emerg-gcs` clean-up step 1 and the header comment. **Diagrams:** D6 text and desc; D1 legend ("Link failsafe: SIYI / GCS loss only." + "Battery: low → RTL, critical → QLand.") and the D1 slot caption, regenerated. |
| | | **Scan extended** (`test/params/obsolete.test.js`): a per-sentence check now catches (1) SIYI as the only failsafe without the word "link", (2) RTL in any / every / all mode(s) without QRTL, and (3) a failsafe list that has the critical but not the low battery. A self-test proves that the verifier's five old sentences are caught and that the Rev C wording passes. | |
| **F2** Imported 0 values ignored | MAJOR | **Precedence:** `ToolsCore.effectiveSettings` now takes **any** finite file value (0 included). **Disabled when:** BATT_LOW_VOLT ≤ 0 or BATT_FS_LOW_ACT = 0 (low), BATT_CRT_VOLT ≤ 0 or BATT_FS_CRT_ACT = 0 (critical), BATT_ARM_VOLT ≤ 0 (arming check). The value becomes `null` and `fsDisabled[key]` carries the text, e.g. "LOW-BATTERY FAILSAFE DISABLED in imported file sample.param (BATT_LOW_VOLT = 0) — differs from reference 22.0 V". **Other action:** a non-reference action (e.g. BATT_FS_LOW_ACT = 2) goes to `fsActDiffers` and is flagged. **Content:** new `ToolsCore.contentForFailsafes(VtolContent, eff)` returns adapted content (deep copy; the original is never changed). Every step, row or sentence that promises the disabled failsafe becomes an explicit amber DISABLED statement, and no token of a disabled value can render as a number or TBD. | `js/tools-core.js` `effectiveSettings`, `contentForFailsafes`, `packThresholds` (≤ 0 → null), `suggestManualRtl` |
| | | **Shown in:** <br>- Tools header LOW / CRIT "DISABLED in <file> (…)"; <br>- a red banner `#fs-alert` on every Tools tab and `#man-fs-alert` in the manual; <br>- the emergency modal, kneeboard and emergency-only mode (`CONTENT`); <br>- the manual failsafe table, cards and design intent; <br>- the gauge (no marker or auto-action zone, red note); <br>- the trend (no line); <br>- the battery-analysis rows and box ("DISABLED … — NO automatic RTL"); <br>- the Params view (red banner); <br>- manual header / prose tokens ("22.0 [reference — DISABLED in <file>]"). <br>Nothing ever falls back silently to the default. | `index.html` `renderRefDiff`, `renderContent`, EO mount, battery analysis, `renderParams`; `manual.html` `renderManual`, `fillTokens`; `js/diagrams.js` gauge |
| | | **Tests:** new `test/params/failsafe-disabled.test.js` (7 tests, using the repo's `test/fixtures/sample.param`) covers the effective settings, the action-0 / arming / other-action cases, the rendered card / table / intent / checklists, the gauge / trend / analysis, the page wiring, F3 and F4. `test/tools/battery.test.js` is updated (0 now means disabled, not the setting). | jsdom smoke: sample.param imported → header, banner, card, analysis, Params, emergency-only, manual gauge / banner / card / header all show DISABLED |
| F3 | MINOR | The `emerg-batt` clean-up gains a line, so the compact Tools card and the kneeboard show it: "The failsafes read the sag-compensated voltage (BATT_FS_VOLTSRC = 1); the OSD reads raw voltage, lower under load — the pilot's {manual RTL} V call comes well before the automatic RTL." When the low failsafe is disabled, the line loses its RTL clause. | `data/content.js` `emerg-batt`; test F3 |
| F4 | MINOR | `mergeStores` runs the same `migrateRevC` rule on incoming pre-Rev C settings; `importJSON` adds the notice, prefixed "Import:". | `js/store.js` `mergeStores`, `importJSON`; test F4 |
| F5 | MINOR | `js/version.js` (permitted by the PM): `content: '2026-10-17'`, `paramFile: '2026-10-17 (reference)'`. Footers already prefer the imported `store.paramFile` (`js/field.js`). The manual's `data-ver="paramFile"` cells now prefer the imported file's label too. | `js/version.js`; `manual.html` `fillTokens`; `test/tools/common.test.js` |
| F6 | MINOR | "the semicolon": every statement in `d4-8.js` already ended with `;`. The only stray semicolon was the D7 text 'keep the home LZ clear;'. It is now a comma, and the SVG is regenerated. | `scripts/diagrams/d4-8.js`, `img/diagrams/d07-carrier-failsafe.svg` |
| F7 | MINOR | The page count in R12c(b) is corrected (see the table above). | this report |

**Process:** no process was ended by image name in this round. Long runs used `timeout` only.

### Tests (rework round 1)

```
export PATH="/c/Program Files/nodejs:$PATH"
node --test test/                                     → tests 291, pass 290, fail 0, skipped 1 (jsdom)
VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/  → tests 291, pass 291, fail 0
node scripts/diagrams/build.js --check                → up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-precache.mjs --check                 → up to date (57 assets)
node scripts/gen-params-reference.mjs --check         → up to date (1663 parameters)
html-validate: index 127 (unchanged), manual 0, map 40 (unchanged)
jsdom smoke S\wp14tools\smoke.js                      → 72 pass, 0 fail (12 new F2 checks with sample.param imported)
```

**For `02-CONTRACTS.md`** (additive to §5.1): `ToolsCore.FS_ACT_PARAMS` and `ToolsCore.contentForFailsafes(content, eff)`; `effectiveSettings(settings, paramFile, ref?)` now also returns `fsDisabled` / `fsActDiffers`, and a disabled value is `null`. `importJSON.lastStats.notice` is set when an imported pre-Rev C backup is migrated.
