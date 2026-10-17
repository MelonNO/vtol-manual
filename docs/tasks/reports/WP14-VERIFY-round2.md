# WP14 verification — round 2
VERDICT: REJECTED

This round checks rework commit `e02b29c` on `wp/14` against `VERIFY-round1.md` and the PM's round-1 decisions. All work was read-only, using throw-away clones in `S\verify\WP14\` (`clone2`, `mergetest2`). New scripts: `scripts\smoke-f2.js`, `scripts\smoke-clear.js`, `edge\disabled360.mjs`.

| Finding | Status |
|---|---|
| F1 | Fixed |
| F2, after a page load | Fixed: every surface handles a disabled failsafe correctly |
| F3, F4, F5, F7 | Fixed |
| F6 | Withdrawn: it was my error |

**One MAJOR finding remains (F8).** Importing a param file in the Tools PARAMS tab does not refresh the safety surfaces in the same page. After importing `sample.param`, these keep their old values until the page is reloaded:

- the header shows "LOW 22.0V auto RTL · CRIT 21.0V";
- there is no red banner;
- the emergency modal, kneeboard and emergency-only cards still show "22.0V → AUTO RTL (FAILSAFE)" and "21.0V → AUTO QLAND";
- the checklists still show the old values;
- the battery analysis still shows "BATT_LOW_VOLT 22.0V".

This is the silent fallback the PM decision forbids, in the normal import flow. The same gap existed in round 1 for the CRT precedence. I missed it then because my smoke called the render functions by hand after the import.

## Round-1 findings

| ID | Result | Evidence |
|---|---|---|
| **F1** stale failsafe statements | **FIXED** | Rewritten per §15.2 / §15.3: glossary `manual.html:1215`, crew training `:1385`, HM30 `:483`, S-02a `:599`, `emerg-gcs` clean-up `data/content.js:200`, D6 text, desc and alt, D1 legend and caption. **My re-grep** of all 125 page, content, JS, diagram and SVG files found no remaining instance of: "only SIYI … failsafe" without "link", RTL in any/every/all modes without QRTL, a failsafe list missing the 22.0 V low RTL, or "RTL after 5 s". **D1 and D6:** regenerated, rendered in Edge and inspected; text is legible with no overlap. **Scan test:** the new per-sentence checks in `test/params/obsolete.test.js` include a self-test with my five round-1 sentences (caught) and the Rev C wording (passes). |
| **F2** imported 0 / action 0 | **FIXED on load; FAIL in-session (see F8)** | `ToolsCore.effectiveSettings` now takes any finite file value. **Disabled conditions:** BATT_LOW_VOLT ≤ 0, BATT_FS_LOW_ACT = 0, BATT_CRT_VOLT ≤ 0, BATT_FS_CRT_ACT = 0 and BATT_ARM_VOLT ≤ 0 each give `null` plus `fsDisabled` with the text "… DISABLED in imported file X (…) — differs from reference …". A non-reference action (BATT_FS_LOW_ACT = 2) is flagged in the banner and on the card. `contentForFailsafes` deep-copies the content and rewrites it; the original `VtolContent` is unchanged. Surface results are in the next table. |
| **F3** VOLTSRC note in the compact card | **FIXED** | A new `emerg-batt` clean-up line. My round-1 smoke check now passes in the Tools modal, and the kneeboard (`emerg-list`) shows it. |
| **F4** import of an old edited backup | **FIXED** | `mergeStores` runs `migrateRevC` on incoming pre-Rev C settings. My test: values kept (22.2), new keys added, **1 notice** ("Import: …"). |
| **F5** version stamp | **FIXED** | `js/version.js` now reads `content '2026-10-17'` and `paramFile '2026-10-17 (reference)'` (PM-permitted). The imported file's label wins in the manual `data-ver` cells and in the footers (`js/field.js`). |
| **F6** semicolon | **WITHDRAWN** | My error: `git show 5aa3b35:scripts/diagrams/d4-8.js` line 129 already ended `});`. I had read a ';' inside the string 'keep the home LZ clear;'. The implementer changed that text to a comma, which is harmless. |
| **F7** report page count | **FIXED** | The report now says 10 pages, which matches my PDF. |

## F2 surfaces with `test/fixtures/sample.param` (BATT_CRT_VOLT 22.2, BATT_LOW_VOLT 0)

The store already held the imported file when the page loaded (`scripts/smoke-f2.js`, jsdom; Edge at 360 px with screenshots `shots/r2-*.png`).

| Surface | Result |
|---|---|
| Tools header | PASS: "LOW VOLT DISABLED in sample.param (BATT_LOW_VOLT = 0)", "CRIT VOLT 22.2V QLand here"; 360 px has no horizontal scroll |
| Red banner (`#fs-alert`, every tab) | PASS: "LOW-BATTERY FAILSAFE DISABLED in imported file sample.param (BATT_LOW_VOLT = 0) — differs from reference 22.0 V" |
| Emergency card, compact (Tools modal) | PASS: step 3 "LOW-BATT FAILSAFE DISABLED — NO AUTO RTL", step 4 "22.2V → AUTO QLAND HERE"; no "22.0 → AUTO RTL" (Edge screenshot) |
| Kneeboard (`emerg-list`) | PASS: same content |
| Emergency-only mode (`#emergency-only/emerg-batt`) | PASS: DISABLED step and 22.2 QLand |
| Design intent | PASS: DISABLED statement |
| Checklists (`site-home-lz-flight`, etc.) | PASS: DISABLED statement; no raw `{settings.*}` or `[[` anywhere in the rendered page |
| Battery analysis rows and box | PASS: "BATT_LOW_VOLT DISABLED in sample.param (reference 22.0V) — NO automatic RTL"; no "above the automatic RTL" margin |
| Trend chart | PASS: no BATT_LOW line |
| Params view | PASS: red banner above the comparison; BATT_LOW_VOLT ✖ DIFFERS 0 / 22 |
| Manual banner, full card, failsafe table | PASS: banner shown; the card summary and steps say DISABLED; the "Battery low" row says DISABLED |
| Manual gauge | PASS: no auto-RTL marker or zone; red note; critical at 22.2 (Edge screenshot) |
| Manual header token | PASS (wording MINOR, F9): "LOW VOLT 22.0 [reference — DISABLED in sample.param]V auto RTL" |

**Other cases:**

| Case | Result |
|---|---|
| BATT_FS_LOW_ACT = 0 | Header, banner and card show DISABLED |
| BATT_CRT_VOLT = 0 | "CRIT-BATT FAILSAFE DISABLED — NO QLAND"; no 21.0 QLand step |
| BATT_ARM_VOLT = 0 | "ARMING-VOLTAGE CHECK DISABLED" in the checklist notes and the banner |
| BATT_FS_LOW_ACT = 2 | Banner and card flag "BATT_FS_LOW_ACT = 2 … differs from reference 1" |
| Reference file imported | Normal display, no banner |

**Cross-tab:** a `storage` event refreshes the Tools page and the manual correctly.

## Findings

### F8 — MAJOR — Tools does not refresh the failsafe surfaces after an in-session param import or clear

**Where:** `index.html` `paramImport()` (≈ line 2384) and `paramClear()` only call `renderParams(); renderParamHeader();`. `renderRefDiff`, `renderContent` and `renderBattLog` are not called. Those render the header, `#fs-alert`, the emergency modal / kneeboard / emergency-only content (`CONTENT`), the checklists and the battery analysis. Same-tab `localStorage` writes fire no `storage` event, so nothing else re-renders them.

**Reproduction** (`scripts/smoke-f2.js`, first block): import `sample.param` through `#pf-file` + `paramImport()`. Right afterwards:

- the header reads "LOW 22.0V auto RTL | CRIT 21.0V QLand here", which is wrong twice: the file disables LOW and sets CRIT to 22.2;
- the banner is hidden;
- the card reads "22.0V → AUTO RTL (FAILSAFE)" and "21.0V → AUTO QLAND HERE".

Only the Params view shows the banner. Everything is correct after a reload.

**Clear:** `paramClear()` likewise leaves "DISABLED in sample.param" and CRIT 22.2 on screen after the file is removed (`scripts/smoke-clear.js`).

**Expected:** after import and after clear, refresh everything that depends on the effective settings, e.g. call `vtolRefreshAll()`, or `renderRefDiff(); renderContent(); renderBattLog();`. Add a jsdom test that imports through the UI and checks the header, banner and card without a reload.

### F9 — MINOR — manual token wording

**Where:** the manual header and prose tokens become "22.0 [reference — DISABLED in sample.param]V auto RTL" and "Arming is refused below 24.6 [reference — DISABLED in a.param]V".

The text that follows the marker ("V auto RTL", "Arming is refused below") still reads as a promise. The red banner and the cards are correct, so this is wording only. A cleaner form would be "LOW VOLT DISABLED in <file>", as the Tools header does.

## Regression

```
node --test test/                                       → 291 tests, 290 pass, 0 fail, 1 skipped
VTOL_JSDOM=… node --test test/                          → 291 / 291 pass
gen-params-reference --check / diagrams build --check / gen-precache --check → all up to date (1663 params / 16 SVG / 57 assets)
reference file SHA-256 2eb324cc…e460 (unchanged, byte-exact)
scripts/store-verify.test.js                            → 10/10 (0 in file → null + fsDisabled; old edited backup import → 1 notice)
scripts/copyblock.js                                    → EXACT EQUAL (15 lines)
scripts/refcheck.js                                     → 1663 / 0 mismatches / all CRLF
scripts/smoke.js (round 1)                              → 62 pass; 2 "fail" are my exact-string header checks: header now reads "22.0V auto RTL" / "21.0V QLand here" (correct); F3 check now passes
scripts/smoke-f2.js                                     → 34 pass, 1 fail (F8)
edge/browser.mjs (headless Edge, wp/14 e02b29c)         → 19 pass; the 1 "fail" is the same header-format string (actual {"low":"22.0V auto RTL","crit":"21.0V QLand here"})
html-validate vs main: index 127 / manual 0 / map 40 / latency-clock 2 — identical rule breakdown (no new errors)
Merge into current main (81e6c52): clean; merged tree 291/291 (jsdom), all three --check green
```

### Headless Edge details

**R12b, GCS app absent** (127.0.0.1:47800 refused through CDP), on index and the map:
- 0 exceptions;
- 0 console lines other than the browser's network-failure lines;
- polling continues with backoff 0.51 / 1.0 / 2.0 / 3.0 / 3.0 s.

**Precache and offline:**
- all 57 assets are cached, including `data/params-reference.js`;
- with the server stopped and the browser offline:
  - manual#params renders (1663 / 68 / 116);
  - the map slider shows 10 / 12;
  - the Tools header shows 22.0 / 21.0;
  - no exceptions.

**360 px:** no horizontal scroll on the Parameters tab, the Aircraft battery tab, Tools PARAMS or pre-flight. The same holds with `sample.param` stored (header, modal and manual). The map area is 506 px.

## Approval rationale / items that must be fixed

F1 and F2 are fixed for the page-load case. F3–F7 are resolved; F6 was my error.

**Rejected only for F8 (MAJOR).** An in-session param-file import or clear in Tools must immediately refresh the header, banner, emergency modal / kneeboard / emergency-only content, checklists and battery analysis, and a UI-level test must cover it. F9 is optional.
