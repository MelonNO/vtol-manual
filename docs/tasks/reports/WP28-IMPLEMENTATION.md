# WP28 — Shared content copy, rendered components, CHANGELOG: implementation report

Branch `wp/28` (worktree `S/wt/WP28`), based on `main` with WP23–WP27 merged. S = the scratchpad of
`04-REDESIGN-CONTEXT.md` §3.

## 1. Summary

- **R2 first:** a safety-token lock (`test/content/safety-lock.js`, `wp28-safety-lock.test.js`) and its fixture. The
  fixture was generated from `main`'s `data/content.js` and committed (3406aea) **before** any copy edit.
- **R1 copy pass** on `data/content.js` (checklist `t` / `n`, section names, post-flight, clean-up, callouts intro). The
  safety-token diff is **0 LOST / 0 NEW**, and the lock passes. The emergency IMMEDIATE steps are **unchanged word for
  word**.
- **R3 / R4:**
  - every wave-3 request is folded into `css/base.css` or rejected with a reason (§7); the page overrides are removed;
  - `js/render-content.js` emits no inline styles: tables in `.tbl-wrap` with `thead` / `tbody`, the section colour as
    `--sec`, a plain design-intent card, the abort heading id, Link row labels in sentence case.
- **Carried items:** all are done except the optional diagram layout and the CLEAN-UP button text (§7, with reasons).
  - The phone EMERGENCY button is now a full-width red bar above the bottom nav.
  - A tap outside the More menu only closes it.
  - Also fixed: the Menu sheet, the 360 px search placeholder, the map's 1 px, "Use My Location", the styleguide in
    jsdom, the tint test, print.css.
- **R5:** CHANGELOG "Unreleased — redesign", README pages table, `docs/design/README.md` (folds, page patterns).
- All checks pass: 373 tests. html-validate: 0 findings.

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 copy pass | DONE | `data/content.js` (diff vs main) | Shorter, plainer, consistent wording ("GCS app", "Mission Planner", "home landing zone", "Setup → Profiles"). Section names are in sentence case. The GO banners lost their `// … //` decoration. Every `s` is ≤ 5 words: "Home LZ kept clear all flight" (6 words on main) became "Home LZ clear all flight". IMMEDIATE steps, ids, order, `w`, `copy`, `auto`, numbers, params, IPs, modes and markers are unchanged (§3). The manual's data-fs tests are green |
| R2 lock test | DONE | `test/content/safety-lock.js`, `test/content/wp28-safety-lock.test.js`, `test/content/fixtures/wp28-safety-lock.json` | Tokens per item id and per field: ip, param, mode, marker, value+unit, and `{template}`. Each IMMEDIATE step is locked on its own, so their count and order are locked too. The structure is also locked: ids in order, `w/copy/auto/priority/kind/primary/style`. A mutation test proves that the lock catches a changed value, a dropped TBD, swapped IMMEDIATE steps, a removed `w`, reordered items and QRTL→QLAND, and that wording alone does not trip it. One justified fixture update: §3 |
| R3 wave-3 requests | DONE | `css/base.css:112,134-143,146,154,161,223,233-234,265,425,438,477,482,490`; table in `docs/design/README.md` "Wave-3 requests" | Each request is folded or rejected with a reason. Page copies removed: `index.html` (`.btn-icon`, `.tbl-wrap` scrollbar, `!important` ×2, `body>#nav.tn-has-sub`), `manual.html` (`.man-main .alert p`, `.man-more` ×8, `.man-main .section-title`, `.tbl-wrap` scrollbar), `relay/map.html` (`.help`) |
| R4 rendered components | DONE | `js/render-content.js:105-112,165-169,183,185-196,305-357` | Same class contracts (`cl-section`, `cl-section-hdr/letter/name/prog`, `fs-table`, `net-table`, `co-table`, `fs-primary`, `design-intent`, emergency family, `lk-*`). Escaping is unchanged. `[[TBD/VERIFY]]` still renders amber (render tests). Only a valid hex reaches `style="--sec:…"` (tested) |
| R5 CHANGELOG / README | DONE | `CHANGELOG.md` "Unreleased — redesign (WP23–WP28)"; `README.md` pages table and Params path | No version bump (`js/version.js` untouched) |
| R6 no regressions + evidence | DONE | §4, §8 | Every check in 04 §3 passes. Screenshots in `S/shots/WP28/after/` (before: `S/shots/WP28/before/`) |

## 3. Placeholders and safety tokens

No `TBD` / `VERIFY` was added or removed.

```
$ python3 -I S/tools/safety-tokens.py --git S/wt/WP28 main data/content.js
data/content.js: 485 tokens before, 485 after
LOST (fewer occurrences after): 0
NEW (more occurrences after): 0

manual.html: 1457 tokens before, 1457 after   LOST 0  NEW 0   (CSS-only changes)
index.html:    45 tokens before,   45 after   LOST 0  NEW 0
relay/map.html: 35 tokens before,  35 after   LOST 0  NEW 0
js/render-content.js: 106 before, 101 after — LOST '1px', '22', '25%', '30%', '35%', '44', '66'; NEW '0', '3,8'
```

The `js/render-content.js` tokens are code, not content:
- the inline-style alpha suffixes (`22` / `44` / `66`), the `1px` border and the th widths (`30%` / `25%` / `35%`) moved
  to CSS classes;
- `3,8` is the `{3,8}` of the hex check, and `0` is in the slice / regex code.

Two phrasings were adjusted on purpose so that the token counter did not see a change:
- "on 5600; its HUD source" (a full stop after "5600" would hide the number from the counter);
- "within 48h. Never" (as on main).

**Fixture update (one, justified):** `pf-immediate` lost `style: 'accent'`. The post-flight "Right after landing" card
had an orange edge, and orange means interaction only (the same reason as the design-intent card, WP26 request 5).
This is a presentation flag, not a safety token. The steps, their ids and their order are unchanged. Diff of the
fixture: `"pf-immediate style=accent"` → `"pf-immediate"`.

## 4. Tests

New:
- `test/content/wp28-safety-lock.test.js`: 3 tests (extractor, lock, mutations).
- `test/content/wp28-components.test.js`: 9 tests:
  - renderer: no inline styles, `.tbl-wrap` / `thead`, `--sec` with hex-only, plain design-intent card, abort id,
    sentence-case Link labels;
  - section names, ≤ 5-word titles;
  - folds present and page copies gone;
  - shell minors;
  - print / base dead selectors;
  - jsdom: the styleguide (sunlight toggle wired, no errors; it threw on `main`);
  - jsdom: More menu (an outside tap closes it without ticking the row, the next tap ticks, a menu action runs,
    EMERGENCY opens on the first tap with the menu open).

  Mutation check: with the swallow disabled, or with EMERGENCY not exempt, the More-menu test fails.

Changed. Each change is a look or layout assertion; the intent is kept:
- `test/content/content.test.js:40`: `'CLIENT'` → `/^client$/i` (section names are now in sentence case; it still
  checks the E rename).
- `test/tools/wp25-tools-body.test.js`:
  - `.cl-section-name` is still the text colour, now without `!important`, and a guard for no `!important`;
  - the M7 sticky test now looks in the base shell and rejects a page copy.
- `test/shell/shell.test.js` R6: the phone FAB position regex now matches the full-width bar (`left:0;right:0;
  bottom:calc(56px + env(…))`, `min-height:48px`). Still asserted: fixed, red, no pulse, the markup.
- `test/design/tokens.test.js`: the tint pairs are now checked over `--surface2` too (WP23 M3; all pass, min > 4.5).

Commands, all green:

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                       → tests 373, pass 373, fail 0
node scripts/gen-precache.mjs --check   → up to date (61 assets)   (sw-precache.js regenerated and committed)
node scripts/diagrams/build.js --check  → up to date
node scripts/gen-params-reference.mjs --check → up to date
node scripts/check-links.mjs / check-images.mjs / check-colours.mjs → pass
html-validate index.html manual.html relay/map.html tools/latency-clock.html (+ docs/design/styleguide.html) → 0 findings
```

## 5. Deviations / contract issues

1. **Files outside the WP28 list, each minimal:**
   - `index.html`:
     - the More-menu listener (allowed by the brief);
     - removing the folded overrides;
     - `.cl-section-letter` / `.cl-section-name`: the letter reads `--sec`, with a `color-mix` tint inside
       `@supports` and a neutral fallback. The name letter-spacing is .3 px now that names are in sentence case.
   - `manual.html`: only page `<style>` lines were deleted or merged (`.man-main :is(.tbl-wrap,.alert) p` keeps the
     callout paragraphs full width).
   - `relay/map.html`: the `.help` rule removed (folded), plus the one button-row rule (allowed).
   - Tests in `test/tools`, `test/shell` and `test/design` (§4).
   - `CLAUDE.md`: three phrases in the checklist and style sections, which my change made wrong.
2. **Logic change, required by a carried item:** the More-menu click listener (capture phase) now calls
   `preventDefault` and `stopPropagation` on an outside tap while the menu is open, except on `#emerg-fab`. Taps inside
   the menu and on its toggle are unchanged. No other script changed. Renderer: markup and classes only.
3. **Phone EMERGENCY button:** a full-width red bar (48 px) directly on top of the 56 px bottom nav, instead of the
   floating button that covered the end of a row.
   - It is more visible than before and still one tap away.
   - `--content-pb` (140 px) already clears nav + bar.
   - Desktop is unchanged.
4. **Callout "More" disclosure:** the base component targets `.alert>details`, so no markup change was needed. The
   manual's `class="man-more"` stays as a hook (`test/manual/body.test.js` counts it); it has no CSS.
5. **Abort heading anchor:** "Abort Calls" now has `id="co-abort-calls"`. Before, `renderToc` gave it a positional
   runtime id (`callouts-sec-N`). A bookmark to that runtime id would no longer resolve. It was never a static id.
6. **Kept as is, on purpose:**
   - Emergency IMMEDIATE wording (any change is a memory-item change).
   - The emergency card titles (tests match them).
   - The Link meta line "APP · MODE · START …" (render tests assert `START NORMAL`).
   - `power-up` sentence "Allow GPS fix time after step 4, before arming" (`test/manual/amendments.test.js` asserts it).

## 6. Notes for the verifier

- Copy review: `git diff main -- data/content.js`. The lock test output lists any token change per item and field.
- Behaviour: in a 390 px window, open Pre-flight → More, then tap a row: the menu closes and the row stays unticked.
  Open More, then tap EMERGENCY: the modal opens.
- `docs/design/styleguide.html` now shows the callout with "More", a whole-cell marker, `.btn-icon`, `.help` and a
  shell sample.

## 7. Carried-over items and requests → result

| Item (source) | Result | Where |
|---|---|---|
| WP23 M2 styleguide contrast script throws in jsdom | DONE: `rgb()` returns null for unparsable colours, the ratio shows "—", the toggle is wired; jsdom test | `docs/design/styleguide.html`, `wp28-components.test.js` |
| WP23 M3 tint test misses `--surface2` | DONE | `test/design/tokens.test.js` |
| WP23 M4 stale print.css comment | DONE | `css/print.css:8` |
| WP24 M1 Menu sheet columns centred at 601–900 px | DONE `align-items:start` | `css/base.css:425`; shot `manual-menu-800.png` |
| WP24 M4 search placeholder cut at 360 px | DONE: at ≤ 400 px tighter nav padding, 12 px placeholder; the full "Search the manual" shows, Menu and Emergency keep 44 px | `css/base.css:490`; `manual-overview-360.png` |
| WP24 M5 dead `.hdr-*` (print), `.vf-hdr-tools` / `.vf-lbl` (base) | DONE | `css/print.css`, `css/base.css` §6 |
| WP24 M6 sheet scroll chains to the page and closes it | DONE `overscroll-behavior:contain` | `css/base.css:425` |
| WP24 M7 / WP25 sticky sub-tabs | DONE in the shell; page rule removed | `css/base.css:477` |
| WP24 shell docs / `.seg` promotion | DONE docs and styleguide; `.seg` not promoted (no body consumer) | `docs/design/README.md` |
| WP25 outside tap on More also activates | DONE (dismiss only; EMERGENCY exempt) | `index.html:2857-2870` |
| WP25 `!important` section colours | DONE (`--sec`) | `js/render-content.js:105-112`, `index.html:106-112` |
| WP25 phone EMERGENCY covers the row ends | DONE (full-width bar above the bottom nav) | `css/base.css:482`; `tools-scroll-fab-{390,360}.png` |
| WP25 promote Tools patterns | REJECTED: one consumer; documented as page patterns | README "Page patterns" |
| WP25 `.tbl-wrap` scrollbar, section names in sentence case | DONE | base §4; `data/content.js` |
| WP26 callout paragraphs + More | DONE | `css/base.css:134-143` |
| WP26 heading scroll offset | DONE | `css/base.css:112` |
| WP26 chips in table cells | DONE | `css/base.css:161` |
| WP26 dark scrollbars | DONE | `css/base.css:146` |
| WP26 renderer inline-styled wrappers, abort id, design-intent accent | DONE | `js/render-content.js` |
| WP26 `.kv` / `.dg` shared | REJECTED: different structures / one consumer | README |
| WP26 callouts intro | DONE | `data/content.js` callouts.intro |
| WP26 README diagram palette link | DONE | README "Diagrams" |
| WP26 MINOR 4 (optional) single 440 px diagrams | NOT DONE: it needs a figure-beside-text layout in `manual.html` markup (not WP28's file), and pairing unrelated diagrams is not wanted | — |
| WP26 data-fs DISABLED phrase counts | Green (`test/manual/body.test.js`) | — |
| WP27 "⊕ Use My Location" overflows at desktop | DONE: auto flex basis, the label may wrap (it wrapped in sunlight zoom, never overflows) | `relay/map.html:109`; `crop-map-1366-btnrow.png`, `crop-sun-map-1366-btnrow.png` |
| WP27 M3 map bar 1 px | DONE: the divider is an inset shadow inside the 48 px | `css/base.css:438` |
| WP27 sunlight outlines for map overlays | DONE | `css/base.css:265`; `sun-map-1366.png` |
| WP27 `.u-in`, `.seg3`, `.vtx-row` | REJECTED: one consumer | README |
| WP27 shared helper line | DONE `.help` | `css/base.css:233` |
| WP27 shared icon button | DONE `.btn-icon` (from Tools); the map `.ico` stays a row modifier (map markup is outside WP28) | `css/base.css:223` |
| CLEAN-UP button text "CLEAN-UP — LOOK UP AFTER SITUATION STABLE" (an uppercase sentence) | NOT CHANGED: `js/common.js toggleCleanup` rewrites the label on every toggle, and `js/common.js` is outside WP28. Changing only the renderer would flip the text on the first tap. Candidate for a follow-up | — |

## 8. Screenshots (`S/shots/WP28/after/`; before = `S/shots/WP28/before/`, taken from this branch before the edits, comms from a `git archive main` export)

All of the following were viewed:

| File | Observation |
|---|---|
| `tools-preflight-detail-{1366,390,360}` | Sentence-case section names; the letter badge keeps its section colour as a tint; detail open. At 390 / 360 the red EMERGENCY bar sits above the bottom nav, and no row end is covered |
| `tools-scroll-fab-{390,360}` | Scrolled list: rows run fully to the ▶ zone above the bar. Before, the floating button covered "Client video viewer ▶" |
| `tools-more-open-390` | More menu open, unchanged look |
| `tools-turnaround-{1366,390}` | T1–T3 in sentence case, badges tinted |
| `tools-postflight-390`, `crop-postflight-390` | Plain cards (no orange edge), shorter step text |
| `tools-link-live-{1366,390}` | Row labels in sentence case ("Uplink loss", "Status age"); panel titles stay short labels; warn/crit marks unchanged |
| `tools-emergency-modal-{1366,390}`, `tools-emergency-only-{1366,390}` | IMMEDIATE identical; the design intent is a plain card; emergency-only unchanged, no bar over it |
| `manual-emergency-{1366,390}`, `sun-manual-emergency-1366` | Plain design-intent card, cards unchanged; sunlight thick outlines |
| `manual-comms-{1366,390}` | Network table in `.tbl-wrap` with `thead`, identical layout to before (D3 shows its alt text in both before and after: the image had not loaded when the shot was taken) |
| `manual-callouts-{1366,390}` | Shorter intro; tables with class widths, same layout; no sideways page scroll at 390 |
| `manual-flightmodes-more-{1366,390}` | Callout with the "More" disclosure open: pixel-identical to before at 1366 (the fold kept the look) |
| `manual-overview-{1366,390,360}` | At 360 the full "Search the manual" placeholder shows (before: "Search the ma") |
| `manual-menu-800` | Sheet columns top-aligned ("Overview" and the group lists start on one line) |
| `map-{1366,390}`, `sun-map-1366`, `crop-*-btnrow` | "⊕ Use My Location" inside its button; in sunlight the label wraps instead of overflowing; overlays get 2 px outlines in sunlight |
| `sun-tools-preflight-390` | Sunlight: 2 px row lines, the bar visible |
