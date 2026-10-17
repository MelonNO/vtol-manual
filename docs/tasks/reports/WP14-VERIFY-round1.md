# WP14 verification — round 1
VERDICT: REJECTED

Branch `wp/14` at `5aa3b35` (implementation `abafb8e` + report), base `d89a977`. Verified read-only. Throw-away clones, scripts and screenshots are in `S\verify\WP14\` (`clone`, `base` = current `main` 81e6c52, `mergetest`, `scripts\`, `edge\`, `shots\`).

Most of the work is accurate and thorough. Every plan §15.1 value matches the reference file. The copy block is the owner's 15 lines byte for byte. The reference file is byte-exact. Store migration, the Params tab, the map, R12b and R12c all work in a real browser.

Two MAJOR findings block approval:
- **F1:** several pre-Rev C failsafe statements survive. The worst is the glossary, which still says only SIYI loss and battery critical trigger an action, so no low-battery RTL.
- **F2:** the param-file precedence ignores a file value of 0. An imported file with `BATT_LOW_VOLT = 0` (failsafe disabled) still shows "22.0 V → AUTO RTL (FAILSAFE)".

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `docs/reference/carrier-params-2026-10-17.param`; `.gitattributes:30-31`; `scripts/gen-params-reference.mjs`; `data/params-reference.js`; `test/params/reference.test.js` | **Byte-exact:** SHA-256 `2eb324cc…e460` matches the Downloads original, `cmp` is identical, and the hash is the same after a fresh clone with `core.autocrlf=true`. **Independent check** (`scripts/refcheck.js`): 1663 lines, all CRLF; every name and value matches `VtolParamsRef`, in the same order. **`--check`:** passes, and fails after I tampered with one value. **README:** gives the date, the source and the update steps. |
| R2 | PASS | `manual.html:315` nav, `:1354` panel, `renderParamsTab`/`paramsFilter` `:2085-2140` | **Content:** header shows the file, 2026-10-17 and 1663. There are 68 relied-on rows, and all 68 chapter links resolve to existing anchors. There are 116 groups, and opening all of them reaches 1663 rows, 68 of them starred. **Search:** `q_rtl` gives 3, `426016` gives Q_OPTIONS, and the input is escaped. **Edge at 360 px:** `scrollWidth` 360 with a group open and with a search. **Offline from the SW cache:** renders fully. |
| R3 | **FAIL** | see F1 | **Correct:** every §15.1 value is right wherever it is written, including km/h 43.2, ≈100 m, "learned, drifts" and the new Aircraft rows. My own grep of all 126 page, content, JS and diagram files finds no obsolete value in a safety context. **Not removed:** several obsolete failsafe statements remain (F1). The R3 scan test misses them because they are worded differently. |
| R4 | **FAIL** (partial) | content `fs-*` rows, cards, `site-home-lz-flight`, manual `#siyi-loss`, `#battery-failsafe`, `#lowbatt-qhover-landing`, D7 | **Correct:** the failsafe table, design intent, card summaries and immediate steps, the transition card, D7, the mission SVG and the checklist. The 915 drift, the transition 8 s → QRTL with the pilot's QHOVER at 2–3 s, the WP2 → home route, the home landing zone and "reselect QHOVER" are all right. **Wrong:** the emerg-gcs clean-up step 1 still says "RTL … in every mode" (F1), against §15.2 VTOL → QRTL. |
| R5 | PASS (with F1) | `emerg-batt` steps; manual ladder card `#voltage-ladder`; Pre-Arm rows; glossary 6S; storage note | **Correct:** the ladder reads 23.0 → 22.5 → 22.0 AUTO RTL → 21.0 AUTO QLAND HERE, rendered in Tools, the manual and the kneeboard. "Set BATT_LOW_VOLT" is gone. Pre-Arm shows 21.0 V, plus the new 24.6 V row. **Gaps:** the BATT_FS_VOLTSRC note is not shown in the compact Tools card (F3, MINOR). The glossary "Failsafe" row is wrong (F1). |
| R6 | PASS | `ToolsCore.suggestManualRtl`; `index.html:1125-1160`; header `:293-296`; `js/diagrams.js:203-205` | **Label:** the jsdom battery log shows "Suggested manual RTL trigger (pilot, OSD raw voltage)". **No recommendation:** no BATT_LOW value is recommended; a fixed box shows 22.0 / 21.0 "not changed from this log". **Trend chart:** has MANUAL RTL, HARD LIMIT, BATT_LOW RTL and BATT_CRT QLAND lines. **Header:** 22.0 / 21.0 / 12 m/s. |
| R7 | PASS | `js/store.js:17-24, 98-103, 389-428, 492-496`; `ToolsCore.effectiveSettings` | **My tests** (`scripts/store-verify.test.js`, 10/10): an unedited 22.2 store (number or string) becomes 21.0 once, is persisted, gets one notice and no re-migration. An edited 22.2 store is kept, and the notice names the difference. An edited store with reference values gets no "differs" notice. A Rev C or fresh store is left alone. paramFile values flow through the tokens, the card and `packThresholds`. **Pages:** the notice shows and dismisses in Tools and the manual. **Caveats:** the 0-value precedence gap (F2) and the edited-backup import (F4). |
| R8 | PASS | `PARAM_NOTES`/`expectedParams`/`EXPECTED_PARAMS` getter; `renderParams` `index.html:2383` | **Baseline:** 56 rows with FLTMODE2 = 11 (RTL) and the "using the reference baseline" card. **Imports:** the reference itself gives 0 differ, 0/0/0 in the whole-file diff. `test/fixtures/sample.param` gives 6 DIFFER and a whole-file diff card. |
| R9 | PASS | `js/diagrams.js:84-180`; `scripts/diagrams/d4-8.js:116-160`; `inline.js` | **Gauge** (rendered at 360 px, inspected): 24.6 / 23.0 / 22.8 / 22.5 / 22.0 AUTOMATIC RTL / 21.0 QLand HERE, an 18.6 floor and the VOLTSRC note. **D7** (rendered, inspected): all four rows and the timeline are correct and legible. **Mission SVG:** QRTL path and ≈100 m. **Motors:** 45°/s. **Check:** `build.js --check` is green. |
| R10 | PASS | `manual.html` `#ac-compass`, `#compass-cal`, Pre-Arm rows, `#prearm-fence`, `#maint-compass-ofs`; content `carrier-compass-ext` | **Fence:** "no geofence" with both conflicts noted. **Compass:** the §15.5 steps are verbatim, plus the Pre-Arm "Compass not found / not healthy" row. **Offsets:** match the file (−10.10444 / −16.05964 / −70.66866). |
| R11 | PASS | `relay/map.html:278-285, 617-642, 2222` | **jsdom and offline Edge:** min 10 / default 12, with the reference named as the source. **Imported file:** with AIRSPEED_MIN 11 / AIRSPEED_CRUISE 13 the slider follows to 11 / 13. **TECS:** stays at 5 m/s, which matches the reference. |
| R12 | PASS | `data/content.js:45-63` | `FAILSAFE_PARAMS` and the rendered `.copy-val` textContent are **byte-identical** to the owner's block (15 lines, spacing included; `scripts/copyblock.js` and the jsdom smoke). |
| R12b | PASS | `js/gcs-client.js:29-50,96-118` | **Headless Edge, app absent** (127.0.0.1:47800 refused through CDP Fetch, because a real app listens on this machine): there are 0 exceptions and 0 non-network console lines on index and map. Health polling continues with gaps of 0.51 / 1.01 / 2.01 / 3.0 / 3.0 s. **Same harness on `main`:** "TypeError: Illegal invocation at Session.schedule" and 0 further polls, so the fix is real. **Remaining console output:** only the browser's own network-failure lines. |
| R12c | PASS | (a) `relay/map.html:63-67`; (b)(c) `css/print.css:58-61,81`; (d) `test/pwa/assets.js`; (e) `css/base.css:24,68` | **(a) Map header at 360×640** (Edge): header 218 → 134 px, map 422 → 506 px. **(b) Kneeboard PDF:** `main` has 11 pages, the last footer-only. WP14 has 10 pages, and the turnaround list and footer share the last page. **(c), (d), (e):** checked in the code. |
| R13 | **FAIL** (via F1) | — | **Checks run:** all tests pass and all three `--check` scripts are green. My jsdom smoke passes (63/64; the one miss is F3). html-validate shows no new errors. No invented numbers. **Why FAIL:** obsolete failsafe statements remain (F1). |

## Contract results

- **C1.6:**
  - **Shape and defaults:** `VtolParamsRef {source, savedDate, params}` (+ `count`, `sha256`, additive). The defaults are 21.0 / 22.0 / 24.6, with 23.0 / 22.5 unchanged.
  - **Migration:** behaves as specified.
  - **paramFile precedence:** implemented, **except for non-positive file values** (F2). Those fall back silently to the settings value, which contradicts "its BATT_CRT_VOLT / BATT_LOW_VOLT / BATT_ARM_VOLT take precedence for display and analysis".
- **C2 (gcs-client):** never throws and never logs; backoff runs 0.5 s doubling to a 3 s cap; the API is unchanged.
- **C4 / C5:** the item-id rule is respected (new ids `site-home-lz-flight`, `carrier-compass-ext`). The markup is rendered with no raw `[[…]]`.
- **Additive API changes** (report §5.1) still need recording in `02-CONTRACTS.md`:
  - `ToolsCore.*`
  - `VtolStore.REV_C`, `notices` and `dismissNotice`
  - `paramValue` source `'reference'`
  - `compareParams` status `learned`

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"
node --test test/                                     (clone of wp/14)  → 282 tests, 281 pass, 0 fail, 1 skipped
VTOL_JSDOM=S\jsenv\node_modules\jsdom node --test test/                 → 282 tests, 282 pass, 0 fail
node scripts/gen-params-reference.mjs --check                          → up to date (1663 parameters); exits 1 after tampering
node scripts/diagrams/build.js --check                                 → up to date (16 SVG files, slots, inline)
node scripts/gen-precache.mjs --check                                  → up to date (57 assets)
Merge into current main (81e6c52, includes WP15): clean, no conflicts; on the merged tree: 282/282 (jsdom), all three --check green
WT=… node --test S\verify\WP14\scripts\store-verify.test.js            → 10/10 (my C1.6 migration / precedence tests)
node S\verify\WP14\scripts\copyblock.js                                → EXACT EQUAL: true (15 lines)
node S\verify\WP14\scripts\refcheck.js                                 → 1663 lines, 0 mismatches, same order, all CRLF
npx --prefix S/jsenv html-validate (main vs wp14): index 127→127, manual 0→0, map 40→40, latency-clock 2→2 (same rule breakdown)
```

The new tests are substantive:
- `test/params/reference.test.js`: pins the hash, the CRLF line endings, the generator output, an independent parse, and every §15.1 and unchanged value.
- `obsolete.test.js`: a context regex scan with a self-test, plus a check of every written `PARAM value` against the reference.
- `store-revc.test.js`: migration and precedence.
- `wp14-carryover.test.js`: browser-strict timer stubs and a rejecting fetch.

## Smoke tests (what I loaded / clicked + result)

### jsdom (`S\verify\WP14\scripts\smoke.js`): 63 pass, 1 fail (F3)

**Tools (index.html)**
- **Loads:** no errors. Header shows 22.0 / 21.0 / 12 m/s.
- **Copy block:** byte-identical to the owner's list.
- **New items:** the home-LZ item and the compass item are present.
- **Emergency cards:** battery ladder in order; transition 8 s → QRTL; SIYI card RTL/QRTL with HOME LZ CLEAR.
- **Params:** 56 rows; FLTMODE2 11 (RTL). Importing the reference gives 0 differ; importing sample.param gives 6 differ plus the whole-file diff.
- **Battery log:** 3 entries. The relabelled suggestion appears, no BATT_LOW recommendation, configured 22.0 / 21.0 shown, and all trend lines drawn.
- **Old store:** the notice shows, the header reads 21.0, and DISMISS works.

**Manual**
- `#params`: everything listed under R2.
- **Gauge:** all 7 values, the labels and the VOLTSRC note.
- **Ladder card:** values in order.
- **Other sections:** compass sections, Pre-Arm rows, Flight Modes (QRTL, home LZ, drift) and the emergency ladder.
- **22.2 V:** appears nowhere in the rendered manual except "6S nominal".
- **paramFile precedence:** with 20.6 / 21.4 / 24.2 the gauge follows and names the file, and so does the emergency card.
- **Old store:** the migration notice shows.

**Map**
- Slider 10 / 12 from the reference; 11 / 13 from an imported file.
- The real gcs-client with a rejecting fetch keeps polling, with no console output.

**Latency clock:** no errors. No unhandled promise rejections on any page.

### Headless Edge (`S\verify\WP14\edge\browser.mjs`, `layout.mjs`): 20/20 on wp/14

**R12b with the GCS app absent:** index and map, as described under R12b.

**Service worker and offline**
- The SW controls the page, and all 57 precache assets are in the cache, including `data/params-reference.js`.
- I then stopped the server and switched the browser offline:
  - manual#params renders (1663 / 68 / 116);
  - the map slider shows 10 / 12;
  - the Tools header shows 22.0 / 21.0;
  - no exceptions.

**360 px, no horizontal page scroll:**
- manual Parameters: with a group open, and with a search;
- manual Aircraft battery;
- Tools PARAMS and pre-flight.

**Map header and kneeboard:** as described under R12c.

**Visual checks** (screenshots in `S\verify\WP14\shots\`): D7, the gauge at 360 px, the manual params tab at 360 px and the map at 360 px.

## Findings

### F1 — MAJOR — pre-Rev C failsafe statements remain (R3 / R4 / R13; plan §15.2, §15.3; owner: "All text saying 'no low-battery warning exists' is now wrong")

These lines are unchanged from the base and contradict §15:

- **`manual.html:1214` (Glossary "Failsafe"):** "On this carrier only SIYI / GCS loss (RTL after 5 s) and battery critical trigger an action."
  - This is the "no low-battery failsafe" claim in other words. It omits the automatic RTL at BATT_LOW_VOLT 22.0 V and the transition-timeout QRTL, and says plain RTL for SIYI loss.
- **`manual.html:1384` (Crew Training sign-off, "Failsafe intent"):** "Can explain: only SIYI / GCS loss triggers a carrier failsafe (RTL after 5 s, any mode)".
  - Crews are certified on this sentence. It omits the battery failsafes and says RTL in any mode, where §15.2 says QRTL in VTOL modes.
- **`data/content.js:199` (`emerg-gcs` clean-up step 1, rendered in the Tools modal, the manual Emergency tab and the kneeboard):** "→ RTL after FS_LONG_TIMEOUT (5 s), in every mode."
  - It contradicts the next step and §15.2 (VTOL modes → QRTL).
- **Lower severity, same class:**
  - `manual.html:482` (HM30 section): "the carrier RTLs after 5 s".
  - `manual.html:598` (S-02a): "→ RTL after 5 s".
  - `scripts/diagrams/d4-8.js:112` → `img/diagrams/d06-client-failsafe.svg` (+ D6 alt text): "On HM30 loss the carrier also RTLs after 5 s".

**Expected:**
- Reword all of these per §15.2 / §15.3: SIYI/GCS loss → RTL in fixed-wing modes, QRTL in VTOL modes; battery low 22.0 V → automatic RTL; critical 21.0 V → QLand here; transition timeout → QRTL home. The "only link whose loss…" wording of the design intent can stay.
- Extend `test/params/obsolete.test.js` so that "only SIYI … and battery critical", "RTL after 5 s, any mode" and "RTL … in every mode" without a QRTL qualifier are caught.

### F2 — MAJOR — param-file precedence drops a file value of 0 (contract C1.6; R7; safety display)

**Where:** `js/tools-core.js` `effectiveSettings` (≈ line 66) accepts a file value only when `v > 0`. Otherwise it silently keeps the settings value. In ArduPilot `BATT_LOW_VOLT = 0` (or `BATT_CRT_VOLT = 0`) means that failsafe is **disabled**.

**Reproduced** in jsdom by importing the repo's own `test/fixtures/sample.param` (BATT_CRT_VOLT 22.2, BATT_LOW_VOLT 0):
- Header: "LOW VOLT **22.0** V auto RTL · CRIT VOLT 22.2 V".
- Emergency card: "**22.0V → AUTO RTL (FAILSAFE)**" and "22.2V → AUTO QLAND".
- Battery analysis: "BATT_LOW_VOLT 22.0V (settings)".
- Gauge (manual): marks 22.0 as AUTOMATIC RTL.

So with an imported file that disables the low-battery failsafe, every display still promises an automatic RTL that the aircraft will not do. The old gauge handled "0 = not set"; WP14 removed that. Only the Params tab row (✖ DIFFERS 0 / 22) and the small `.ref-diff` line hint at it.

**Expected:** a finite file value takes precedence, 0 included. A 0 must be shown as "disabled (0) in param file <name>" in:
- the header;
- the card steps (no "AUTO RTL" step, or an explicit "NONE — disabled in <file>");
- the gauge (no marker, plus a note);
- the battery analysis.

Add a test for `BATT_LOW_VOLT = 0` / `BATT_CRT_VOLT = 0` in an imported file.

### F3 — MINOR — the BATT_FS_VOLTSRC note is not shown in the compact Tools emergency card / kneeboard

**Where:** `emerg-batt` carries the note only in `summary`, which `{compact:true}` hides (Tools modal and kneeboard). The manual card, ladder card, gauge and Tools analysis box do show it.

**Suggest:** a short clean-up line, e.g. "Failsafes read sag-compensated voltage (BATT_FS_VOLTSRC = 1); the OSD reads raw, lower under load."

### F4 — MINOR — an imported (JSON) pre-Rev C backup with edited settings brings back 22.2 without the one-time notice

**Where:** `mergeStores` takes newer edited settings. `battLowVolt` / `battArmVolt` are filled from the local store, so `migrateRevC` never runs. Only the permanent `.ref-diff` line in Tools shows the difference.

This is acceptable under C1.6, which covers stored settings, but an import notice naming the difference would be consistent.

### F5 — MINOR — version stamp

**Where:** `js/version.js` still reads `content: '2026-10-16', paramFile: 'TBD'`, so every footer and the kneeboard say "CONTENT 2026-10-16 · PARAM FILE TBD". The content has now been reviewed against the reference file of 2026-10-17.

The file is outside WP14's owned list, so this is for the PM to decide (WP01 / WP10).

### F6 — MINOR (style) — missing semicolon

**Where:** `scripts/diagrams/d4-8.js:129`. The first `card({...})` call in D7 ends without a semicolon (it relies on ASI), unlike the others.

### F7 — MINOR (report accuracy)

**Report says:** the kneeboard's "11th page" holds the turnaround list.

**I measured:** with A4 / CSS page size, WP14 prints 10 pages and `main` prints 11. The substance (no footer-only page) is correct.

## Notes on the checks the PM asked for

**Q_LAND_FINAL_SPD 0.2 → 0.5:** the reference file has `Q_LAND_FINAL_SPD,0.5`. It is consistent everywhere it appears: `manual.html:1064`, `PARAM_NOTES` (value from the reference) and the pinned test. No 0.2 m/s remains outside `archive/`. CLAUDE.md and `ai/` do not mention it.

**VERIFY markers kept:**
- **S-02** (QRTL in VTOL modes, Q_OPTIONS bit 5): appropriate. Plan §15.2 states the behaviour and the content states it plainly. The marker only asks for the outstanding SITL test, as the old TBD did.
- **S-01a** (QHOVER holds and drifts on 915 loss): appropriate. The expected behaviour is stated, and the bench/SITL result is still open.
- **Neither marker hides a value**, and neither contradicts the owner's intent.

**Owner's failsafe intent:**
- Link failsafe on SIYI/GCS loss only; 915 MHz loss → no action.
- Battery failsafes added.
- The design intent and the failsafe table state this correctly (apart from F1).

**Values check:** every §15.1 value was checked against `params.param`, including:
- Q_OPTIONS 426016 = bits 18, 17, 15 and 5: bit 5 set, bit 19 clear;
- the FLTMODE1–6 slots 18/11/6/6/0/10;
- the COMPASS_* IDs and offsets;
- TECS 5/5.

## Approval rationale / items that must be fixed

Rejected: **F1 (MAJOR)** and **F2 (MAJOR)** must be fixed.
- **F1:** stale failsafe statements in the glossary, the crew-training sign-off and the SIYI emergency card (plus the lower-severity lines listed), with the scan test extended.
- **F2:** `BATT_*_VOLT = 0` from an imported param file must show as disabled, not fall back to the settings value; add a test.

F3–F7 are MINOR and may remain, but F3 is a cheap safety-communication improvement. Everything else was verified as correct:
- the reference file, generator, Parameters tab, store migration, Params tab, battery analysis, gauge, D7 and map;
- R12b and R12c (a)–(e);
- the precache, the offline load and the 360 px layouts;
- html-validate, and a clean merge into current `main`.
