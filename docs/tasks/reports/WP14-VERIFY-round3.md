# WP14 verification — round 3
VERDICT: APPROVED

This round verifies rework commit `bba93af` on `wp/14`, which answers `VERIFY-round2.md` (F8 MAJOR, F9 MINOR). All work was read-only, in throw-away clones under `S\verify\WP14\` (`clone3`, `mergetest3`, `main3`).

New scripts this round:
- `scripts\smoke-r3.js` (jsdom);
- `edge\import.mjs` (headless Edge, real file input through `DOM.setFileInputFiles`).

**Result:**
- **F8:** fixed.
- **F9:** fixed.
- **Blockers:** none remain.
- **New:** two MINOR points (F10, F11) about the reference-labelled tables. The PM asked for a judgement on these; see F10.

## F8 — in-session store changes refresh every surface: FIXED

**How it works.** `VtolStore.save()` fires `vtol-store-changed` on every write. Tools now runs `vtolRefreshAll()` on that event, with a re-entry guard. The manual runs `renderManual()` and the map runs `applySimSpeedLimits()` on the same event. The `storage` event for other tabs is unchanged.

**Tools, real UI, no manual re-render.** In jsdom (`scripts/smoke-r3.js`, 29/29) and in headless Edge (`edge/import.mjs`, 14/14), I chose `test/fixtures/sample.param` in `#pf-file` and clicked **IMPORT**. Right afterwards:

| Surface | After IMPORT (sample.param) | After **CLEAR PARAM FILE** |
|---|---|---|
| Header | "DISABLED in sample.param (BATT_LOW_VOLT = 0)" / "22.2V QLand here" | "22.0V auto RTL" / "21.0V QLand here" |
| Red banner `#fs-alert` | shown, with the DISABLED text | hidden |
| Emergency modal card | "LOW-BATT FAILSAFE DISABLED — NO AUTO RTL", "22.2V → AUTO QLAND HERE"; no "22.0V → AUTO RTL" | "22.0V → AUTO RTL (FAILSAFE)", "21.0V → AUTO QLAND HERE" |
| Kneeboard | `emerg-list` updated. The Edge PDF (10 pages) prints the DISABLED steps and clean-up line, and the banner on the checklist page | — |
| Emergency-only mode (`#emergency-only/emerg-batt`) | DISABLED step, 22.2 V QLand (jsdom and Edge) | — |
| Checklists (pre-flight and turnaround) | DISABLED statement | restored |
| Battery analysis | "BATT_LOW_VOLT DISABLED in sample.param … NO automatic RTL" | no DISABLED text |
| Trend chart | no BATT_LOW line; critical line at 22.2 | — |
| Params view | red banner | — |
| Param-file header label | shows sample.param | — |

**Other store-changing paths (jsdom):**

| Path | Result |
|---|---|
| Settings edit (`#set-low` → 21.6, change event) | card, header, analysis and the `.ref-diff` line update |
| Store write adding a client | the profile select is refreshed |
| Active-client change through `#prof-active-client` | header client name updates |
| `VtolStore.importJSON` of a backup carrying a paramFile (the path `vtolImportData` uses) | header, banner and card show DISABLED |

**Manual, store written from the manual's own tab** (jsdom and Edge):
- header phrase, banner, gauge, emergency card and failsafe table update at once;
- after the file is cleared, the original phrases come back.

**Map, in-tab write:** the slider follows (11 / 13).

**Refresh loop: none found.**
- One import fires exactly 1 `vtol-store-changed` event.
- Tools idle: 0 events over 3 s in jsdom and 0 over 15 s in Edge.
- Manual idle: 0 events over 2 s in jsdom and 0 over 5 s in Edge.
- No exceptions, and no console messages other than the browser's network-failure lines for the absent GCS app.

**Cross-tab** (`storage` event) still refreshes both pages (`scripts/smoke-clear.js`).

**Implementer test** `test/pwa/wp14-refresh.test.js`: clicks the real IMPORT and CLEAR buttons, edits a setting, and checks a manual in-tab write. It needs jsdom and passes with `VTOL_JSDOM`.

## F9 — no disabled failsafe next to a bare "auto RTL": FIXED

**What changed in the manual.** Phrases promising a failsafe are wrapped in `data-fs`. With `sample.param` they become "LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)" in red. The "auto RTL" now appears only inside that DISABLED statement. This covers:
- the header and Overview stat boxes;
- the Overview and Flight Modes alerts;
- the Procedures arm step and battery-discipline step;
- the QHOVER-landing note;
- the glossary and crew-training rows.

**My scan of the rendered manual with the file imported** found 16 "auto/automatic RTL" phrases. 14 are inside DISABLED statements or unrelated (SIYI RTL, manual RTL). The other 2 are reference tables:
- the Aircraft "Battery & Power" table row "BATT_LOW_VOLT 22.0V — low battery → automatic RTL …";
- the Parameters tab relied-on row, which is the reference-file tab by definition.

The voltage-ladder card also shows 22.0 / Automatic RTL. Judgement on these is in F10.

## Judgement requested by the PM: the reference-labelled tables while a different file is imported

### Voltage-ladder card — acceptable

Its title is "Carrier voltage ladder — 6S 7000mAh (reference param file 2026-10-17)". It is a reference document, the red banner is shown at the top of every manual tab, and the gauge in the same tab draws the imported file's values with a red DISABLED note.

### Parameters tab (relied-on table) — acceptable

The whole tab is explicitly the reference file.

### Aircraft "Battery & Power" table — slightly misleading (F10, MINOR)

**The problem.** This table carries no reference label. Its section title is just "Battery & Power", with columns Parameter / Value / Notes. With a file that disables the low-battery failsafe, it still states "BATT_LOW_VOLT 22.0V — low battery → automatic RTL" as a plain fact about the aircraft. The implementation report says both tables are "labelled as the reference param file (2026-10-17)". That is true of the ladder card only (F11).

**Why MINOR and not MAJOR:**
- Every operational surface (emergency cards, kneeboard, emergency-only mode, checklists, header, failsafe table, Flight Modes / Procedures alerts, gauge) states DISABLED.
- The red banner sits above every tab.
- The gauge in the same Aircraft tab carries the red note.
- The table documents the reference configuration and is not read in flight.

**Recommended (cheap, before release):** label the table "Values: reference param file 2026-10-17". While `fsDisabled` is set, add an inline red line under the table that repeats the banner text, or mark the affected row.

## Findings

### F10 — MINOR — the Aircraft "Battery & Power" table is not labelled as reference values

**Where:** `manual.html:878-897`.

**What is wrong:** while an imported file disables a battery failsafe, this table keeps stating the reference failsafe as fact, with no reference label (see the judgement above).

**Suggested fix:** add a reference label, plus an inline DISABLED note when `fsDisabled` is set.

### F11 — MINOR (report accuracy) — the reference-label claim covers only one of the two tables

**Where:** "Rework round 2 — Reference tables kept on purpose" in `docs/tasks/reports/WP14-IMPLEMENTATION.md`.

**What is wrong:** it says "the Aircraft parameter table and the voltage-ladder card are labelled as the reference param file (2026-10-17)". Only the ladder card is labelled.

### Observation (not a finding)

Some handlers now render twice: their own render call, then the central refresh (e.g. `profSetActive` → `profAfterChange`). This has no visible effect; an import refreshes in well under 1 s in Edge.

## Regression

The only expectations I changed are ones that changed on purpose:
- the Tools header now reads "22.0V auto RTL" / "21.0V QLand here" (round-2 rework);
- the manual header phrase is now the F9 wording.

```
node --test test/                                     → 293 tests, 290 pass, 0 fail, 3 skipped (jsdom-only)
VTOL_JSDOM=… node --test test/                        → 293 / 293 pass
gen-params-reference --check / diagrams build --check / gen-precache --check → up to date (1663 / 16 SVG / 57 assets)
reference file SHA-256 2eb324cc…e460 — byte-exact, unchanged
scripts/store-verify.test.js                          → 10/10
scripts/copyblock.js                                  → EXACT EQUAL (owner's 15 lines)
scripts/refcheck.js                                   → 1663 / 0 mismatches / CRLF
scripts/smoke.js (round 1)                            → 64 pass, 0 fail
scripts/smoke-f2.js (round 2)                         → 35 pass, 0 fail (the in-session-import check that failed in round 2 now passes)
scripts/smoke-clear.js                                → CLEAR restores header / banner / card in the same tab; cross-tab still OK
scripts/smoke-r3.js (round 3)                         → 29 pass, 0 fail
edge/import.mjs (headless Edge, real file input)      → 14 / 14
edge/browser.mjs (headless Edge)                      → 20 / 20: R12b with GCS app absent on index + map, all 57 precache assets cached, offline manual#params / map / Tools, 360 px layouts, map area 506 px
edge/disabled360.mjs                                  → Tools and manual at 360 px with sample.param: no horizontal scroll, no exceptions
html-validate vs main: index 127 / manual 0 / map 40 / latency-clock 2 — identical rule breakdown, no new errors
```

**Merge into current `main`** (`4dabd5b`, includes WP16, gcs-only):
- the merge is clean and changes nothing under `gcs/` or `protocol/`;
- on the merged tree: JS 293/293 (jsdom) and all three `--check` scripts green.

**Python suite on the merged tree** (`pytest gcs protocol`):
- the first run gave 1 failure, `test_runtime_e2e.py::test_api_status_is_cached_briefly`;
- that test passes 3/3 when re-run on its own, both on `main` and on the merged tree;
- the full suite re-run gives 682 passed, 2 skipped.

That failure is a timing-sensitive test that flaked under machine load. WP14 does not touch gcs.

## Approval rationale

**All MUST requirements pass (R1–R13, R12b, R12c)**, verified independently over three rounds:
- the reference file is byte-exact;
- the generator and `--check` work;
- the Parameters tab is complete;
- every plan §15.1 value is correct everywhere;
- failsafe behaviour follows §15.2 and the battery ladder follows §15.3;
- the §15.4 battery-log relabel is in place;
- the C1.6 store migration and param-file precedence work, including disabled failsafes, which are now shown on every surface and refreshed in-session;
- the map uses 10 / 12;
- the owner's copy block matches exactly;
- the compass and geofence content is in place;
- R12b and R12c (a)–(e) are fixed in a real browser.

**The round-2 MAJOR (F8) is fixed** and checked through the real UI in jsdom and Edge, with no refresh loop.

**Remaining items:** F10 and F11 are MINOR and may remain. I recommend fixing F10 (label the Aircraft Battery & Power table as reference values and add an inline DISABLED note) before release.
