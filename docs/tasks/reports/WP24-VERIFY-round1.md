# WP24 verification — round 1
VERDICT: APPROVED

Worktree `S/wt/WP24`, branch `wp/24` (commits `4de56d0` implementation, `b1e0922` report), base `main`.
Verifier scripts and screenshots: `S/verify/WP24/` (`smoke.js`, `shots/*.png`, `hv-*.json`, `main/` = `git archive main`).

## Scope (check 1)

| File | Owned? | Verdict |
|---|---|---|
| `index.html`, `manual.html`, `relay/map.html`, `tools/latency-clock.html` (header / nav / footer markup, frame CSS, nav script) | yes | OK |
| `js/field.js`, `css/base.css` (new section 8 only; file-header comment line added) | yes | OK |
| `test/shell/shell.test.js` (new), `test/tools/swipe-order.test.js`, `test/smoke/pages.test.js`, `test/pwa/field.test.js` | yes | OK |
| `CLAUDE.md` (key table row required by R2, "manual.html tab structure", style sentence) | yes | OK |
| `sw-precache.js` | generated | OK (`--check` green) |
| `css/print.css` | no, justified §5.6 | **Accepted**: the switcher, summary, badge and map status would otherwise print; the bar/title print compactly. But it leaves dead `.hdr-*` selectors (F5) |
| `test/manual/manual.test.js:37` | no (WP26), justified | **Accepted**: `'<nav id="nav">'` → `'<nav id="nav"'` only, because the nav got a class; every assertion unchanged |
| `test/pwa/wp14-carryover.test.js` R12c(a) | no (WP23), justified | **Accepted**: the old assertion pinned the WP14 stacked-buttons markup, which no longer exists. The new one keeps the intent (map header keeps one compact height on phones, the sidebar stays at `top:54px`, the status is a fixed panel). It is not a safety or behaviour assertion |
| `relay/map.html:1165` `renderState` | page body (WP27), justified | **Accepted**: a one-line move of the frequency text from the title to `#h-freq`. The value and the formatting are unchanged; the smoke test now asserts it |

No unjustified files.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 app bar (MUST) | PASS | `css/base.css` §8 `.app-bar{height:56px}`; markup `index.html:178-183`, `manual.html:131-136`, `relay/map.html:205-222`, `tools/latency-clock.html:43-49` | Measured in Firefox: bar 56 px (Tools/manual/clock), 48 px (map), one row at 1366/390/360. The badge, title, switcher with `aria-current` and ☀ are present. The doc-id and subtitle lines are gone from the header. The doc id, REV and date are in the footer `#hdr-doc-id` (jsdom: `DOC-RC-001 · REV 2.0.0 · 2026-10-17 · …`). The clock is still linked from Tools (Telemetry). Deviation "title hidden ≤ 600 px" accepted (see Deviations) |
| R2 aircraft summary (MUST) | PASS | `js/field.js:198-246`; `index.html:184-198`; `manual.html:137-151`; `CLAUDE.md:124` | Closed by default, a 2-column (phone) or auto-fill (desktop) grid when open, `vtol_summary_open` persisted. The items, ids and render functions are unchanged. **Safety exercised:** see Smoke §1. Real UI import of `test/fixtures/sample.param` → red "✖ LOW VOLT DISABLED" while closed; `BATT_FS_CRT_ACT=0` → "✖ CRIT VOLT DISABLED"; no client → "⚠ CLIENT TBD" + "⚠ ELRS TBD (client)" (doc line); default → "⚠ PARAMS not verified", which disappears after the import. Manual: imported file → "✖ LOW VOLT DISABLED". All of them update live on `vtol-store-changed` (VtolStore.update) without reopening anything |
| R3 Tools nav groups (MUST) | PASS | `index.html:200-226`, `:589-618`, `:2676-2707`; `css/base.css` `.tn-*` | Five groups in order; desktop group row plus segmented sub-row (none for Link / Weather); phone bottom nav of 5 labelled 56 px buttons. The 10 ids, `switchTab`, `vtol_active_tab` and `navTabOrder()` are kept (DOM-derived). Swipe exercised in jsdom: preflight→…→profiles over all ten in group order, stops at the end. The swipe-order test still proves both properties (unchanged "exactly one nav button" test, plus swipe = nav order = group order); not weakened |
| R4 manual nav (MUST) | PASS | `manual.html:152-203`, `:2107-2171`; `css/base.css` `.mn`, `.nav-dropdown{position:fixed}` | Dropdowns `position:fixed`, placed from `getBoundingClientRect()`; the scroll close is kept. Emergency is red and outside `#nav-items`. Measured at 360 (348 px viewport): Menu 8-92, Emergency 100-219, search 227-340, `scrollWidth = clientWidth` = 348. At 390: fits, no sideways scroll. At 920 / 1024 the full nav fits (`nav sw = cw`). Menu sheet works (screens 360 / 390 / 800). The white bar is gone (`color-scheme:dark`). `#relay/relay-ports` route and `showTab('emergency')` pass in jsdom and the screenshot. The search returns hits and `manGoTo` navigates |
| R5 map / clock (MUST) | PASS | `css/base.css` `.map-hdr .app-bar{height:48px}`, `.map-st*`; `relay/map.html:2181-2192` | Desktop 1366: SRC · VIDEO · OP AREA · TERRAIN · GCS APP inline. Map area: 1366 → main `#map` 48-700, WP24 49-700 (−1 px, F3); 360 → main 134-700, WP24 49-700 (+85 px). The clock uses the same bar |
| R6 emergency (MUST) | PASS | `css/base.css` `#emerg-fab` (no animation), phone rule `bottom:calc(56px + 12px + safe-area)`; `index.html:228` | Measured at 360×700: bottom nav 643-700, FAB 584-632 (12 px gap), x 207-336; the tick boxes are at x ≈ 20-44, never covered. The FAB is present on all ten tabs and opens the modal (jsdom). `#emergency-only`: frame hidden, 9 scenario buttons, no errors; the screenshot matches the baseline in function |
| R7 one shell CSS (MUST) | PASS | `test/shell` R7; my diff review | No frame selectors in page `<style>`; frame buttons have `type="button"`; colours via tokens (`check-colours` green). html-validate: 0 errors on main and on WP24; warnings 169 → 159 |
| R8 no regressions (MUST) | PASS | Tests / Smoke below | All §3 checks green. Screenshots compared with `S/baseline/`: much calmer frame, no overlap, no horizontal scroll. Remarks F1-F7 are MINOR |
| R9 footer (SHOULD) | PARTIAL, accepted | `index.html:552`, `manual.html:1721`, `tools/latency-clock.html:95` | One footer on Tools, manual and clock. No footer under the full-height map; its version line stays in the sidebar. Reasonable for a SHOULD |

### Deviations (judged)
1. **Page title hidden ≤ 600 px**: accepted. Badge + title + switcher + ☀ do not fit at 360 in one row. The badge and the marked switcher segment still name the page, and the `<h1>` stays for AT and print.
2. **48 px map bar**: accepted. It is ≤ 56 px, the same component, and it keeps the old desktop offsets. (−1 px from the border, F3.)
3. **ALT / LINKS only in the status panel**: accepted, but the frequencies are no longer visible at a glance on desktop (F2).
4. **R9 PARTIAL**: accepted (SHOULD; map full-height).
5. **Nav labels shortened** ("Battery", "Pre-flight"): accepted, as nav text only.

## Contract results
No external contract is touched. The `VtolStore` / `vtol-store-changed` usage is unchanged. The localStorage keys are unchanged plus the new `vtol_summary_open` (documented). Hash routes, `showTab`, `switchTab`, `manGoTo`, `renderManual` and the element ids are kept. `hdr-title` is kept on the map.

## Tests run (commands + results)
```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom   (in S/wt/WP24)
node --test test/                       → tests 334, pass 334, fail 0, skipped 0
node scripts/gen-precache.mjs --check   → up to date (61 assets)
node scripts/diagrams/build.js --check  → up to date
node scripts/gen-params-reference.mjs --check → up to date
node scripts/check-links.mjs / check-images.mjs / check-colours.mjs → all OK
html-validate index.html manual.html relay/map.html tools/latency-clock.html
   main: 0 errors; warnings multiple-labeled-controls 1, no-implicit-button-type 31, no-inline-style 136, prefer-tbody 1
   WP24: 0 errors; warnings multiple-labeled-controls 1, no-implicit-button-type 22, no-inline-style 135, prefer-tbody 1
safety-tokens (--git S/wt/WP24 main):
   index.html  LOST MANUAL x1 · manual.html LOST MANUAL x3, '001' x1 · relay/map.html LOST MANUAL x1 · latency-clock 0/0
   → every MANUAL is nav / title text ("MANUAL ▶", "OPERATIONS MANUAL", badge), not the flight mode; '001' = duplicate
     DOC-RC-001 (header + footer), still in the footer doc line. No NEW tokens in content. Verified.
```
The new `test/shell/shell.test.js` exercises real behaviour: chips follow store changes, persistence, group memory, the Menu sheet open/close/Escape/outside-click, and a fixed dropdown. These are not trivial asserts.

## Smoke tests (what you loaded/clicked + result)
`S/verify/WP24/smoke.js` (jsdom, real page scripts): **ALL PASS**
1. Tools: summary closed; chip `warn:PARAMS not verified`. A real `paramImport()` with a `File` of `test/fixtures/sample.param` gives `hdr-low` "DISABLED in sample.param (BATT_LOW_VOLT = 0)" and the chip `crit:LOW VOLT DISABLED`; the not-verified chip is gone, the summary stays closed and the `#fs-alert` banner shows. `BATT_FS_CRT_ACT=0` → `crit:CRIT VOLT DISABLED`. Client removed → `warn:CLIENT TBD`, `warn:ELRS TBD (client)`.
2. All ten tabs via `switchTab(t, navTabBtn(t))`: the panel is active and EMERGENCY is present on each. Swipe ×12 walks the ten tabs in group order and stops at the end. The FAB click opens `#emerg-modal`. No script errors.
3. `index.html#emergency-only`: `html.vf-eo`, 9 scenario buttons, no errors.
4. Manual `#relay/relay-ports` → relay tab. The imported file gives the chip `crit:LOW VOLT DISABLED` with the summary closed. The footer doc line has id, REV and date. Search hits work; Emergency is outside the menu; `showTab('emergency')` works. No errors.
5. Map, clock: load without errors.

Screenshots (headless Firefox, `S/verify/WP24/shots/`), read and compared with `S/baseline/`:
`tools-preflight-{1366,390,360}`, `tools-tlog-{1366,390,360}`, `tools-params-{1366,390,360}`, `tools-worst-360` (two DISABLED chips while closed), `tools-worst-open-390`, `tools-eo-390`, `sun-tools-390`, `manual-overview-{1366,390,360}`, `manual-dropdown-1366`, `manual-menu-{360,390,800}`, `manual-920`, `manual-1024`, `manual-summary-open-1366`, `manual-relayports-360`, `sun-manual-1366`, `map-{1366,390,360}`, `meas-map{,-main}-{1366,360}`, `latency-{360,390}`, `lat-try1` (1366), plus `meas-*` geometry captures.
Overall the frame is clearly cleaner than the baseline: one calm bar instead of about 223/270 px of letter-spaced header, a readable five-item bottom nav instead of ten 10 px cut-off labels, and orange only on the active items. No horizontal page scroll at 360/390. Nothing overlaps the bar or the nav. (Headless Firefox sometimes captures the clock with no text painted; the same happens on `main`, so it is a capture artifact. A retake shows the page correctly.)

## Findings
1. **MINOR** — `css/base.css` §8 `.mn-items{…align-items:center}` carries into the Menu sheet grid (`@media(max-width:900px) .mn.mn-open .mn-items{display:grid…}`). At 601-900 px (tablets, landscape phones) the sheet's columns are vertically centred in their rows: "Overview" floats mid-row and the "Operations" group sits about 20 px lower than "Aircraft" (`shots/manual-menu-800.png`). Expected: `align-items:start` in the sheet.
2. **MINOR** — `relay/map.html:209-218`, `css/base.css` `@media(max-width:1279px){.map-st:not(.open){display:none}}`. Below 1280 px the "SIMULATED — …" banner is only inside the Status panel; the closed button shows just the amber dot and keeps `▾` (`has-warn` only reacts to `b.warn`, not to `#sim-banner.sim`). On desktop the link frequencies (formerly in the title) are now panel-only. Suggest: let a SIM banner also set `has-warn` / ⚠ on the Status button.
3. **MINOR** — Map area is 1 px shorter on desktop (header 48 + 1 px border = 49 px vs. main 48 px total; `#map` 49-700 vs 48-700 at 1366×700). It is negligible and phones gain 85 px, but strictly R5 says "must not shrink".
4. **MINOR** — At 360 px the manual search placeholder is cut ("Search the ma…", `shots/manual-overview-360.png`). The control itself fits (227-340 of 348).
5. **MINOR** — Dead selectors left: `css/print.css:26,31-33` (`.hdr-badge`, `.hdr-sub`, `.hdr-top`, `.hdr-main`, `.hdr-title` no longer exist in any page; WP24 edited this file) and `css/base.css` §6 `.vf-hdr-tools`, `.vf-lbl` (handed to WP28 in the report). Please remove the print ones, or include them in the WP28 request.
6. **MINOR** — Manual Menu sheet: the window behind stays scrollable. A scroll-chain past the end of the sheet scrolls the page more than 40 px, and the `ddOpenY` scroll listener then closes the sheet unexpectedly. Consider `overscroll-behavior:contain` on the sheet.
7. **MINOR (UX note)** — On a phone the sub-tabs scroll away with the content. Switching Pre-flight ↔ Turnaround from deep in a checklist needs a scroll up or a swipe; tapping the already-active group does nothing. This is as the brief specified; tapping the active group could scroll to the top.

## Approval rationale
Every MUST (R1-R8) passes, with the code checked and exercised in jsdom and in real-browser screenshots. The safety rule of R2 is proven with a real param-file import: DISABLED failsafes (red), "PARAMS not verified" (amber) and TBD values (amber, including the TBD client band from the footer doc line) are all visible with the summary closed, and they update live on `vtol-store-changed`. Emergency is one tap away on all ten Tools tabs and in the manual nav row. The FAB clears the bottom nav and the tick boxes, and emergency-only mode works. Every test change is a markup or layout update with its intent kept; none is weakened. No new html-validate errors, no lost safety tokens, no hard-coded colours. The deviations are reasonable. Seven MINOR findings remain (listed above) for rework or for WP27 / WP28 to pick up. No BLOCKER or MAJOR.
