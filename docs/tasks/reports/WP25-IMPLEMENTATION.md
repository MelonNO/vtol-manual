# WP25 — Tools page body: implementation report

Branch `wp/25` (worktree `S/wt/WP25`), based on `main` with WP23 and WP24 merged. Implementation commit `326fe7f`; this
report is in a second commit.

## 1. Summary

- **No inline styles.** Every static `style="…"` in `index.html` is gone (html-validate on `index.html`: 117 warnings →
  **0**; all four pages: 159 → 42, 0 errors). Every `<button>` in the markup and in the page script has `type="button"`.
  The script-built markup (battery analysis, archive, .bin / GCS results, weather, flights, params, profiles, notices,
  challenge–response) uses classes too; the only inline styles left are run-time data values (mode-timeline segment
  widths and mode colours, bridge-timeline widths, progress-bar width, timer colour, toggled `display`).
- **Checklists:** one calm sticky toolbar — title, progress (count above a 4 px bar, one line: M1 fixed), timer, START as
  the only primary button, ↺ and Expand all / Challenge–response / Reset as small ghost buttons on the right. On a phone
  the secondary actions move into a CSS-only **More ▾** menu, so the toolbar is two rows at 390 and 360. Rows: the
  title takes the width (no word-per-line wrap at 360), detail zone 120 px (desktop) / 52 px (phone), rows 52 px,
  checkbox 24 × 24 px with a radius, amber edge + "!" for warning items, AUTO chips kept, done rows 44 px with a struck
  muted title and the tick time. Section headers: letter badge (the only use of the section accent) + title in the text
  colour + a mono counter. GO / NO-GO banners: tinted, 2 px border, no infinite pulse.
- **Other tabs:** one page heading + a one-line intro each (Post-flight, Battery log, Telemetry, Flights, Parameter
  file check, Weather check, Link, Profiles); forms on a `.form-grid` of label-over-control fields (one column on a
  phone); one primary button per card; data tables with `<thead>`, `.num` value cells, in `.tbl-wrap` scroll wrappers
  with dark thin scrollbars; long help behind disclosures (MP buttons, maintenance counting, weather wind limits).
- **Emergency modal:** solid background, a sticky header (red title, "Emergency only ▶", Close), the CAUTION callout,
  the pills, then the **IMMEDIATE cards first** — the design-intent card now follows the cards (it pushed the first
  IMMEDIATE block below the fold on a phone). Challenge–response restyled with tokens (Close on the title row).
- **R8:** the battery analysis now shows the suggested manual RTL trigger first as a large value with a definition list
  (per cell · margin to the failsafe · how it is set · chemistry hard floor) and the unchanged "Configured failsafes"
  note, then Pack health, then the ladder table grouped into Flight statistics / Chemistry thresholds / Carrier
  thresholds.
- **M5:** no `--dim` used for text in page rules (the expand icon is `--muted`). **M7:** Checklists sub-tabs sticky
  under the top on a phone (page-scoped rule, request for WP28).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 no inline styles, typed buttons | DONE | `index.html` `<style>` (page rules), markup `index.html:451-742`; test `test/tools/wp25-tools-body.test.js` R1 | html-validate `no-inline-style` / `no-implicit-button-type` / `prefer-tbody` for index.html: 94 / 22 / 1 → 0 / 0 / 0. Initially hidden elements: `:empty` rules (`#store-notice`, `#info-notice`, `.cl-notice`, `#mp-fetch-status`, `#bl-log-table`), `:has()` for `#pf-archive-wrap`, `#emerg-modal` hidden in CSS **and** its inline `display:none` is set by one init line in the script (§5.2) |
| R2 checklists | DONE | CSS `index.html` "CHECKLISTS" block and phone block; markup `index.html:457-516`; `CLAUDE.md` "index.html — checklist system" | Toolbar, two tap zones (≥ 44 px), rows ≥ 50 px, 24 px checkbox, amber warning mark, AUTO hints, calmer section headers (`!important` over the renderer's inline section colour: §5.4), GO/NO-GO. Two rows max on a phone (`tools-preflight-390/360`, `tools-turnaround-360`, `tools-more-open-390`) |
| R3 every other tab | DONE | markup `index.html:517-742`; renderers `renderBattLog`, `pfRenderArchive`, `renderBinResult`, `binExtrasHTML`, `renderGcs`, `renderFlights`, `renderFlightForm`, `renderMaint`, `renderParams`, `wxRender`, `wxCloudVisHTML`, `renderAirspace`, profile renderers | Heading + intro; `.form-grid` fields; one primary per card; tables in `.tbl-wrap` (min-width 520 px, first column ≥ 120 px, notes ≥ 200 px → they scroll, never squeeze); empty states one sentence ("No entries yet.", "No flight records yet.", "No saved locations yet — …"); disclosures for long help. Weather result: solar-window panel, three status tiles (tinted by level), real tables instead of div grids |
| R4 emergency + challenge–response | DONE | CSS "EMERGENCY MODAL" / "CHALLENGE–RESPONSE"; markup `index.html:409-439`; `renderContent()` order | Cards come from `VtolRender` (base emergency components, untouched). IMMEDIATE first, large and bold. `openEmerg()` / `closeEmerg()` / `emergJump(id)` / `emergIsOpen()` unchanged |
| R5 no logic changes | DONE (see §5.1) | ids, `data-*`, `onclick` handlers and `localStorage` uses diffed against `main`: identical (+2 new ids `cl-more-pf`, `cl-more-ta`); 150 functions before and after | Style-only edits inside functions are listed in §5.1. No test changed; one new test file |
| R6 copy rules | DONE | §3 | Token diff explained below |
| R7 evidence | DONE | §7; jsdom test `wp25-tools-body.test.js` R7 | Ticks an item, opens a detail, START/STOP, saves a battery entry through the form (analysis rendered, no inline styles in it), switches every tab, opens/closes the emergency modal |
| R8 battery log (SHOULD) | DONE | `renderBattLog` | Definition list + grouped ladder table. The `CLAUDE.md` "Battery-log recommendation" wording is unchanged in meaning: no `BATT_LOW_VOLT` recommendation, "Suggested manual RTL trigger (pilot, OSD raw voltage)", fixed failsafe margins |
| M1 (WP23) | DONE | `.cl-progress-label{white-space:nowrap}` | One line at 1366 |
| M5 (WP23) | DONE | test R1/M5 | No `color:var(--dim)` in page rules |
| M7 (WP24, SHOULD) | DONE (page-scoped) | phone block `body>#nav.tn-has-sub{position:sticky;top:0;…}` | Request for WP28 (§6) |

## 3. Placeholders and safety tokens

No `TBD` added or removed. `python3 -I S/tools/safety-tokens.py --git S/wt/WP25 main index.html`:

```
index.html: 48 tokens before, 45 after

LOST (fewer occurrences after): 2
  mode   'AUTO' x2 (GONE COMPLETELY)
  mode   'MANUAL' x2 (GONE COMPLETELY)

NEW (more occurrences after): 1
  mode   'RTL' x1
```

- `AUTO` ×2: the field labels "BATT_LOW_VOLT (AUTO RTL)" and "BATT_LOW_VOLT, AUTO RTL (V)" are now "(auto RTL)" —
  "auto" means automatic here, not the AUTO flight mode; the lower case removes that ambiguity. Same parameter, same
  value, same field.
- `MANUAL` ×2: "MANUAL RTL (OSD)" / "MANUAL RTL, OSD (V)" → "Manual RTL (OSD)" / "Manual RTL, OSD (V)" — the
  pilot-initiated RTL, not the MANUAL flight mode.
- `RTL` +1: the new Battery-log intro sentence ("… the suggested manual RTL trigger appear once the selected pack has
  entries") names the existing output; no value.

The tool ignores `<script>`; the script-built text was checked by hand: every number, unit, parameter name, mode and
`TBD` / `VERIFY` string in the renderers is unchanged. Changed script copy: label case (form labels, chart labels,
"Flight phases & events", profile field labels and section titles), the data-file status lines (same meaning, sentence
case), "Per-chemistry analysis above" → "below" (the analysis now comes after the card), and the hard-floor line split
into a definition ("Chemistry hard floor: 18.6V (3.1V/cell LiPo) — separate, not an operating margin").

## 4. Tests

New `test/tools/wp25-tools-body.test.js` (5 tests): R1 no inline style / typed buttons (markup and script-built);
R1/M5 tokens only, no `--dim` text, no `infinite`; R2 toolbar structure (title a direct child of `.cl-hdr` for the
kneeboard print, START primary, More menu) and the row geometry rules; M7 sticky rule; R7 jsdom run (see §2).
No existing test was changed.

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                        → tests 339 · pass 339 · fail 0 · skipped 0
node scripts/gen-precache.mjs            → wrote sw-precache.js (committed)
node scripts/gen-precache.mjs --check && node scripts/diagrams/build.js --check && node scripts/gen-params-reference.mjs --check
                                         → up to date (61 assets) · diagrams up to date · 1663 parameters
node scripts/check-links.mjs             → every internal link and asset resolves
node scripts/check-images.mjs            → 39 images within budget
node scripts/check-colours.mjs           → no hard-coded colours
html-validate index.html manual.html relay/map.html tools/latency-clock.html
                                         → 0 errors, 42 warnings (main: 0 errors, 159); index.html 0 warnings
```

## 5. Deviations / contract issues

1. **Small style-only edits inside existing functions** (no behaviour change; the verifier may want to diff them):
   - `pfTimerToggle` / `pfTimerReset`: the START/STOP button toggles a `running` class instead of setting inline
     border/text colours (START is now a filled primary button, the old inline orange would have made its text
     invisible); the running timer is `var(--text)` instead of `var(--accent)` (amber after 20 min unchanged).
   - Markup strings of the renderers listed in §2 R3 (classes instead of inline styles, `<thead>`/`<tbody>`, label case).
   - `STATUS_STYLE.bg` hex values → tint tokens (`c` unchanged; it still colours the wind compass).
   - `renderContent()`: `emergencies(...) + designIntent(...)` instead of the reverse (R4; the kneeboard print hides
     the design intent anyway; `test/params/failsafe-disabled.test.js` regex still matches).
2. **`#emerg-modal` initial state:** the inline `style="display:none"` was removed (R1) and replaced by one init line
   after `emergIsOpen()`: `document.getElementById('emerg-modal').style.display = 'none';`. `emergIsOpen()` and
   `css/print.css` (`#emerg-modal[style*="display: none"]`) read the inline value, so this keeps both exactly as before.
3. **M7 selector** `body>#nav.tn-has-sub`: the shell guard in `test/shell/shell.test.js` R7 rejects page selectors that
   *start* with `#nav`; the brief asks for a page-scoped rule until WP28 moves it into the shell section, so the
   selector is prefixed with `body>`. WP28 should move it to `css/base.css` section 8 and drop the prefix.
4. **`!important` on `.cl-section-hdr` border and `.cl-section-name` colour:** `js/render-content.js` (WP28) writes the
   section accent as inline styles; the page rule overrides them so only the letter badge carries the accent.
5. **More menu** is a CSS-only checkbox toggle (`.cl-more-cb` + `<label>`), so no new script; it closes by tapping More
   again (no outside-click / Escape close).
6. Section names stay upper case: they come in upper case from `data/content.js` ("VTOL BUILD", …; WP28 owns the
   text) and are short labels.
7. `.htmlvalidate.cjs` comments still describe the old index.html counts (95 inline styles, 31 buttons, the
   `#bl-log-table` tbody case) — now 0; not my file, left for WP28/PM.
8. The phone EMERGENCY button (WP24 position) overlaps the right end of a row's title text while scrolling; tick boxes
   stay clear. Not changed (frame).

## 6. Requests for WP28 (`css/base.css`, `js/render-content.js`)

- Shell (section 8): move M7 `body>#nav.tn-has-sub{position:sticky;top:0;z-index:700;background:var(--bg);padding-bottom:var(--sp-2)}` (phone) into the Tools nav rules.
- `VtolRender.checklistSection`: emit the section accent as a custom property (`style="--sec:#hex"`) used only by the
  letter badge, so the page `!important` overrides can go.
- Promote to components if other pages want them: `.form-grid` (+ `.wide`), `.actions`, `.note`, `.status`, `.st` /
  status chips, `.kv` definition list, `.stat` cards, `.chart-lbl` / `.chart-box`, `.file-input` (styled
  `::file-selector-button`), `.check` (checkbox + label), `.txt-ok/warn/crit/muted`, `.v-*` value classes, and the
  uppercase-label button modifier (`:is(.content,#cr-modal,#emerg-modal) .btn`).
- `.tbl-wrap`: dark thin scrollbars (`scrollbar-color:var(--dim) var(--surface)`) — Firefox drew a white bar.
- `data/content.js` checklist section names in sentence case if wanted (CSS cannot sentence-case "VTOL BUILD").
- `docs/design/README.md`: the Tools body patterns above; `.htmlvalidate.cjs` comment counts (§5.7).

## 7. Screenshots (`S/shots/WP25/final/`; iterations in `S/shots/WP25/it/`, before-state in `S/shots/WP25/before/`)

| File(s) | Observation vs `S/baseline/tools-*` |
|---|---|
| `tools-preflight-{1366,390,360}.png` | Baseline: orange letter-spaced title, a tiny two-line progress label, seven equal outlined buttons wrapping to three rows on a phone, coloured section titles, 50/50 rows with titles wrapping one word per line. Now: one toolbar row (desktop) / two rows (phone), START the only filled button, text-coloured section titles with a small accent badge, titles on one or two lines at 360 |
| `tools-preflight-detail-{1366,390,360}.png` | Ticked rows (green box, struck muted title, time), an open detail (surface panel, accent edge, readable 16 px text) |
| `tools-more-open-390.png` | The phone More menu (Expand all / Challenge–response / Reset) |
| `tools-turnaround-{1366,390,360}.png`, `tools-postflight-{1366,390}.png` | Same toolbar without timer; post-flight with a page heading over the step cards |
| `tools-battlog-{1366,390}.png`, `tools-battlog-seeded-{1366,390}.png` | Baseline: small grey uppercase labels, a 2-column cramped form, orange 44 px RTL value. Now: three cards with field grid, MP buttons beside their inputs, MP note in a disclosure; with entries: trend chart, the RTL suggestion (large neutral value + definition list + failsafe note), pack health, the grouped ladder table, the flight-log table scrolling on a phone |
| `tools-tlog-{1366,390}.png` | Three cards (DataFlash, GCS session, latency clock), one primary each, styled file pickers |
| `tools-flights-{1366,390}.png`, `tools-flights-seeded-{1366,390}.png` | Maintenance help in a disclosure, status chips, tables scroll on a phone; flight record cards as definition lists |
| `tools-params-{1366,390}.png` | Heading + one-line intro naming the reference file; import card; baseline card; parameter table with code chips |
| `tools-weather-{1366,390}.png`, `tools-weather-result-{1366,390}.png` | Location card (FETCH primary); wind limits in a disclosure; result (synthetic data): solar-window panel, three tinted status tiles, real tables; airspace card and data-file bar |
| `tools-link-{1366,390}.png`, `tools-link-live-{1366,390}.png` | Status bar, not-running card; live status (synthetic C2 object): calm panels with grey titles, red edge only on the critical panel, mono values, ⚠/✖ marks |
| `tools-profiles-{1366,390}.png` | Active selection, profile rows with ghost actions, settings grouped by sub-heading |
| `tools-emergency-modal-{1366,390}.png` | Sticky red header, CAUTION callout, pills, then the first IMMEDIATE block on the first phone screen |
| `tools-cr-{1366,390}.png` | Challenge–response: title + Close on one row, chips, large item, green CHECK / amber SKIP |
| `tools-emergency-only-{1366,390}.png` | Unchanged (base.css), still works |
| `sun-tools-preflight-1366.png` | Sunlight mode: white on black, 2 px row lines, toolbar and rows follow the tokens |

## 8. Notes for the verifier

- Seeded and synthetic views were taken with `S/wp24tools/shotjs.sh`; the store seed is `S/wp25/seed.js`
  (4 battery entries, 1 archive session, 1 favourite, 1 flight record). The weather and Link snippets call
  `wxRender(...)` / `linkOnStatus(...)` with synthetic objects (no network).
- Phone More menu: tap **More ▾**; it is a hidden checkbox (`#cl-more-pf` / `#cl-more-ta`).
- Kneeboard print: the `.cl-hdr-title` is still a direct child of `.cl-hdr`, and `#emerg-modal > div` / `.emerg-modal-hdr`
  still exist; a page `@media print` rule resets the sticky header's negative margins.
