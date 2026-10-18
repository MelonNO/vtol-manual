# WP24 — Shared page frame: implementation report

Branch `wp/24` (worktree `S/wt/WP24`), based on `main` with WP23 merged. Implementation commit `4de56d0`; this report is in
a second commit.

## 1. Summary

- **One app bar on all four pages.** It is one row: badge, short title, a **Tools · Manual · Map** switcher with the
  current page marked, and ☀. It is 56 px high; the map uses a 48 px variant, which is its old header height, so the
  map does not shrink. The doc-id and subtitle lines are gone from the header. The doc id, revision and date now sit
  in the footer as `#hdr-doc-id`, with the same id and the same render code.
- **"Aircraft summary" disclosure** (Tools, manual). The old meta strip sits under the bar, closed by default. Its
  open state is stored per device in `vtol_summary_open`. The items, their ids and the render functions are unchanged.
  `js/field.js` watches the items with a MutationObserver. Every warning state is shown in the summary row as a chip,
  so it stays visible while the summary is closed:
  - red ✖ for DISABLED (also when the item has `.crit-val`);
  - amber ⚠ for TBD and "not verified" (also when the item has `.warn-val`);
  - amber ⚠ for the TBD parts of the footer doc line, e.g. "ELRS TBD (client)".
- **Tools navigation in five groups:** Checklists · Link · Logs · Weather · Setup.
  - Desktop: a group row, plus a segmented sub-tab row (Pre-flight | Turnaround | Post-flight etc.) for groups with
    more than one tab.
  - Phone: the five groups are the fixed bottom nav (56 px, labelled), and the sub-tabs sit at the top of the content.
  - Kept: the 10 tab buttons with `onclick="switchTab('…',this)"`, `switchTab`, `vtol_active_tab`, and
    `navTabOrder()`. The swipe still reads the nav and now runs over all ten tabs in group order.
- **EMERGENCY button.** Still fixed, red, on every tab. The infinite pulse is removed. On a phone it sits above the
  bottom nav, on the right, so it never covers the tick boxes (they are on the left).
- **Manual navigation.** The same grouped dropdowns and search, restyled. Dropdowns are still `position:fixed` from
  `getBoundingClientRect()`. ⚠ Emergency is always visible and red. Up to 900 px wide, a **☰ Menu** button opens a
  fixed sheet that lists every tab by group. It reuses the same nav buttons, so there is one source of truth.
  Emergency and the search stay outside the menu. The white bar under the phone header is fixed: it was a light native
  scrollbar of the nav. The nav no longer scrolls, and `color-scheme:dark` is set.
- **Map:**
  - Wide screens: SRC · VIDEO · OP AREA · TERRAIN · GCS APP and the SIM/LIVE banner are inline in the bar.
  - The **Status** button opens a fixed panel with every item. ALT and the link frequencies (which used to sit in the
    title) are only in the panel.
  - Below 1280 px only the button is shown. It carries the red/amber/green source dot and turns to ⚠ when an item is
    amber.
- **Clock:** same bar. The test name and the CLOCK ONLY / FULL SCREEN buttons stay at the top of the page.
- **Shell CSS.** All header, nav and footer styles now live in a new **section 8 "Shell"** of `css/base.css`. The page
  `<style>` blocks no longer hold any frame rules.

## 2. Requirements

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 one compact app bar | **DONE** (one deviation, §5.1) | `css/base.css:336` (`.app-bar` 56 px), `:428` (map 48 px); markup `index.html:178`, `manual.html:131`, `relay/map.html:205`, `tools/latency-clock.html:43`; footer doc line `index.html:552`, `manual.html:1721` | Badge, title, switcher (`aria-current="page"`; the clock marks none and stays linked from the Tools Telemetry tab, `index.html` "OPEN LATENCY CLOCK"), ☀. The doc id, revision and date are in the footer (`#hdr-doc-id`, same render code). On phones (≤ 600 px) the title is visually hidden (still in the DOM as `<h1>`): see §5.1 |
| R2 aircraft summary | **DONE** | `index.html:184`, `manual.html:137`; `js/field.js:201-245` (`summaryChip`, `summaryChips`, `renderSummary`, `initSummary`); CSS `css/base.css:345-366`; key `CLAUDE.md:124` | Closed by default, grid when open. Same ids (`hdr-client`, `hdr-low`, `hdr-crit`, `hdr-params`, `data-fs`, `data-tok`) and the same render functions on `vtol-store-changed`. Chips: "PARAMS not verified" (Tools default), "LOW VOLT DISABLED" / "CRIT VOLT DISABLED", "CLIENT TBD", any TBD value, "ELRS TBD (client)" from the doc line. Screenshots `tools-summary-disabled-closed-390.png`, `manual-summary-disabled-390.png` |
| R3 Tools nav in groups | **DONE** | markup `index.html:200-226`; `switchTab` / `navMark` / `switchGroup` `index.html:589-618`; init restore `index.html` (DOMContentLoaded, `navMark(tabBtn)`); swipe `index.html:2676` (unchanged selector); CSS `css/base.css:372-382` + phone block | Group buttons use `data-group` with `onclick="switchGroup(this.dataset.group)"` (no quoted tab names, so the old `onclick*=` lookups cannot hit them). A group opens its last tab of this page view, else its first. `swipe-order.test.js` updated on purpose (§4) |
| R4 manual nav | **DONE** | markup `manual.html:152-203`; `toggleNavMenu` `manual.html:2114`; `toggleNavGroup` no-op inside the sheet `:2154`; CSS `css/base.css:390-427` | Fits at 390 and 360 with no sideways scroll: measured nav 8→370 px of a 378 px viewport, `scrollWidth = clientWidth`. Emergency is outside `#nav-items`. `showTab`, `selectNavItem`, `toggleNavGroup`, hash routes, `vtol_manual_tab` and `manGoTo` are unchanged (`showTab` → `closeDropdowns()` now also closes the menu). `nav.test.js` needed no change (it tests ManualCore only) |
| R5 map and clock headers | **DONE** | `relay/map.html:205-224`, `toggleMapStatus` `:2182`; CSS `css/base.css:428-460` | The map bar is 48 px = the old desktop height, and `#sb-wrap` stays at `top:54px`, so the map does not shrink. The phone header went from about 110 px to 48 px. The status is inline on wide screens and in a fixed panel otherwise. The title no longer carries the frequencies: `h-freq` holds them (`relay/map.html:1165`) |
| R6 emergency access | **DONE** | `css/base.css:385-388` + phone rule; `index.html:228` (`type="button"`); `pulseFab` removed | On a phone: bottom = nav 56 px + 12 px, right 12 px. Tick boxes are on the left of each row and are never covered (screenshots `tools-*-390/360`). Emergency-only mode is unchanged: `tools-emergency-only-*.png`, smoke and emergency-only tests green |
| R7 one shell CSS | **DONE** | `css/base.css:328-` section 8; checked by `test/shell/shell.test.js` R7 | No frame selectors are left in any page `<style>`. Every button in header, nav and footer has `type="button"`. html-validate: **0 errors** (main 0); warnings 169 → 159 (`no-implicit-button-type` 31 → 22, `no-inline-style` 136 → 135) |
| R8 no regressions | **DONE** | §4, §7 | All §3 checks green; screenshot list in §7 |
| R9 footer | **PARTIAL** | `index.html:552`, `manual.html:1721`, `tools/latency-clock.html:95` | One calm `.app-footer` (doc line, version line, Share / kneeboard on Tools) on Tools, manual and clock. **The map has no footer**: the full-height map has no room, and its version line stays in the sidebar (`data-vf-version`). This is a SHOULD, kept deliberately so the map does not shrink |

## 3. Placeholders

None added. The only visible-text changes are frame labels.

## 4. Tests

**New: `test/shell/shell.test.js`** (12 tests).

Static tests:
- R1: bar contents on all four pages, current page marked, no doc-id or subtitle in the header.
- R1/R9: footer contents.
- R2: summary markup and ids, `vtol_summary_open` in `CLAUDE.md`.
- R2: chip rules — DISABLED is red; TBD and "not verified" are amber; normal values give no chip; text is escaped.
- R3: groups and the phone bottom nav.
- R4: dropdowns stay `position:fixed` (no `position:absolute` on a dropdown or sheet); Emergency is outside the menu
  and red.
- R6: no animation on the FAB; it sits above the bottom nav.
- R7: no frame selectors in page styles; every frame button is `type="button"`; colours only via tokens.

jsdom tests:
- Tools summary: closed by default; the chips follow store changes (import → LOW VOLT DISABLED, clear → PARAMS not
  verified); the open state is remembered and restored.
- Manual chips: CRIT VOLT DISABLED, CLIENT TBD.
- Tools groups: saved tab restored with its group; one-tab groups have no sub-row; a group remembers its last tab;
  the swipe order.
- Manual Menu sheet: open, close, Escape, outside click; lists every tab except Emergency; a choice opens the tab and
  closes the sheet; inside the sheet the dropdowns are no-ops; the desktop dropdown is fixed and closes on a choice.

**Changed** (each was a look or markup-layout assertion, never a safety or behaviour one):

| File | Change | Why |
|---|---|---|
| `test/tools/swipe-order.test.js` | Still proves "every panel has exactly one nav button" and "swipe order = nav order, read from the nav". Adds five groups in order, each tab in exactly one group row, swipe order = group order over all ten tabs | R3 asked for this update |
| `test/smoke/pages.test.js` | Map: `/RELAY COVERAGE/` in the body → title `Coverage Map` + `h-freq` "video … · RC …" | The header copy changed (R1, R5) |
| `test/pwa/field.test.js` | `indexOf('<footer>')` → `indexOf('<footer')` | The footer now has a class |
| `test/pwa/wp14-carryover.test.js` R12c(a) | The old phone layout (three stacked header buttons) → the new invariant: shared 48 px bar, status in a fixed panel, sidebar at `top:54px` | Header layout superseded by R5. Not in my "own" list (test/pwa is WP23's); the change is minimal |
| `test/manual/manual.test.js:37` | `indexOf('<nav id="nav">')` → `indexOf('<nav id="nav"')` | The nav element now has `class` / `aria-label`. One-token change in a WP26 test file. All its assertions (one nav item per tab, Aircraft group contents) are unchanged |

**Commands and results** (worktree, after `node scripts/gen-precache.mjs`):

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                → tests 334 · pass 334 · fail 0 · skipped 0
node scripts/gen-precache.mjs --check && node scripts/diagrams/build.js --check && node scripts/gen-params-reference.mjs --check
                                 → sw-precache.js up to date (61 assets) · diagrams up to date · params-reference up to date
node scripts/check-links.mjs     → every internal link and asset resolves
node scripts/check-images.mjs    → 39 images within budget
node scripts/check-colours.mjs   → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html
                                 → 0 errors, 159 warnings (main: 0 errors, 169 warnings)
```

**Safety-token diff** (`python3 -I S/tools/safety-tokens.py --git <wt> main <file>`):

```
index.html: 49 tokens before, 48 after      LOST: mode 'MANUAL' x1                 NEW: 0
manual.html: 1462 before, 1458 after        LOST: mode 'MANUAL' x3, value '001' x1   NEW: 0
relay/map.html: 36 before, 35 after         LOST: mode 'MANUAL' x1 (GONE COMPLETELY) NEW: 0
tools/latency-clock.html: 9 before, 9 after LOST: 0                                NEW: 0
```

Every LOST `MANUAL` is the word "Manual" in navigation text, never the flight mode:
- Tools: the "MANUAL ▶" nav link, now the switcher's "Manual".
- Manual: the "MANUAL" badge, "OPERATIONS MANUAL" in the header title and in the footer, now "Manual" and
  "Operations Manual".
- Map: the "MANUAL ▶" header link.

The MANUAL flight mode still appears everywhere it did: content, `mbadge`.

`'001'`: "DOC-RC-001" was written twice in the manual's static frame (header doc line and footer). It is now once, in
the footer doc line. `renderManual()` still renders `DOC-RC-001 · REV <app> · <content> · …` into it.

## 5. Deviations / contract issues

1. **Phone bar (≤ 600 px): the title is visually hidden** (`position:absolute` 1 px clip; the `<h1>` stays for
   screen readers and print). At 360 px, badge + title + a three-way switcher + ☀ does not fit in one row (about
   400 px). The badge and the marked switcher segment still name the page. Desktop and tablet show both.
2. **Map bar height 48 px** instead of the shared 56 px. It is still the same component in one row with 44 px targets.
   This is the old map header height, so the map area does not shrink (R5) and the sidebar and toast offsets
   (`top:54px` / `58px`, WP27's body) did not need changing.
3. **Map: ALT and LINKS only in the status panel.** Inline, all items do not fit at 1366 px (tested with a placed
   aircraft and the SIMULATED banner). The brief's five items (SRC, VIDEO, OP AREA, TERRAIN, GCS APP) and the
   SIM/LIVE banner stay inline. ALT had no label before; it is now labelled "ALT". The frequencies moved from the
   title to "LINKS" (`h-freq`). `hdr-title` is kept as the id of the title.
4. **Map: no footer** (R9 PARTIAL, see the table).
5. **`:root{color-scheme:dark}`** is in the shell section. It makes native scrollbars and control chrome dark, and
   fixes the white bar. Sunlight mode is dark as well, so nothing conflicts.
6. **Files outside the brief's list:**
   - `css/print.css`: the switcher, summary, badge and map status are added to the never-printed list; the bar and
     title print compactly. Without this, the switcher links and the summary would print.
   - The two test files in §4: `test/manual/manual.test.js` and `test/pwa/wp14-carryover.test.js`.
   - `relay/map.html` line 1165 (`renderState`): it writes the frequencies to `h-freq` instead of the title.
7. **Tools sub-tab labels** are shortened in the nav only: "Battery Log" → "Battery". "Pre-Flight" / "Post-Flight" →
   "Pre-flight" / "Post-flight". The panel headings are unchanged.

### Requests for WP28 (`css/base.css` components / section 6, `docs/design/`)

- Section 6 has dead rules that WP24 no longer uses: `.vf-hdr-tools`, the phone `.hdr-top{position:relative}`,
  `.vf-hdr-tools{position:absolute…}` and `.vf-lbl`. The old header toggle is gone. `.vf-btn` itself is still used
  by emergency-only mode and the Share menu. Please remove the dead rules.
- `docs/design/README.md`, "Where CSS goes": header, nav and footer are now in `css/base.css` section 8 (Shell), no
  longer in each page's `<style>`. The styleguide could show `.app-bar`, `.seg`, `.app-chip.warn/.crit` and
  `.app-summary`.
- `.seg` (segmented control) is a frame primitive in the shell. If the page bodies need a segmented control, WP28 may
  want to promote it to section 4.

### Observations for wave 3 (not changed by WP24)

- **WP27:**
  - The latency clock digits overflow their box at 1366 px. This is pre-existing: `S/baseline/latency-1366.png`
    shows the same.
  - The map ATTITUDE panel overlaps the sidebar on phones (pre-existing).
  - Headless Firefox sometimes captures the clock page before the text is painted (blank text). Retake the shot.
- **WP25:** `.cl-hdr-title` and the `.cl-hdr` buttons are still orange / letter-spaced uppercase (page body).

## 6. Notes for the verifier

- **Tools:**
  - Open `index.html`. The bar shows the TOOLS badge, Flight Tools, the switcher and ☀.
  - The summary row shows "⚠ PARAMS not verified" while closed. Open it: a grid of the old strip items.
  - Import `test/fixtures/sample.param` on Setup → Params: the chip becomes "✖ LOW VOLT DISABLED". Clear: it goes back.
  - Groups: click Logs, then Telemetry, then Checklists, then Logs → Telemetry is reopened.
  - At ≤ 600 px the groups are the bottom nav. Swiping left and right walks all ten tabs in group order.
- **Manual:**
  - Desktop: the dropdowns open under their buttons (fixed); a page scroll of more than 40 px closes them.
  - ≤ 900 px: ☰ Menu opens the sheet; ⚠ Emergency stays beside it. At 360 / 390 there is no sideways scroll and no
    white bar.
  - `manual.html#relay/relay-ports` and the search still jump to the right place.
- **Map:** at 1366 the status is inline; Status ▾ shows the full panel. At 390 only the dot ▾ button is shown.
  Click outside or press Esc to close it.
- **Sunlight:** ☀ on any page. The bar, nav and chips follow the tokens.
- **Screenshot helper.** `S/wp24tools/shotjs.sh` is `shot.sh` plus pre-load and post-load JS. It was used to open the
  dropdowns, the menu and the status panel, to set sunlight, and to import a param file for the screenshots below.

## 7. Screenshots (`S/shots/WP24/`) and comparison with `S/baseline/`

Iteration shots are in `S/shots/WP24/it/`; the before-state of `main` (after WP23) is in `S/shots/WP24/before/`.

| File(s) | Observation vs baseline |
|---|---|
| `tools-{preflight,turnaround,postflight,link,battlog,tlog,flights,weather,params,profiles}-{1366,390}.png`, `tools-{preflight,params}-360.png` | Header before content: baseline about 223 px (desktop) / 270 px (phone, plus a two-row nav strip). Now the 56 px bar plus the 44 px summary row, then the group row (desktop) or the sub-tabs (phone). Orange is only on the active group, segment and switcher item. No vertical orange badge. No two-row meta strip. The bottom nav has five readable group labels instead of ten 10 px tab names cut off at the edge. The EMERGENCY button sits above the bottom nav, right side, clear of the tick boxes |
| `tools-summary-disabled-{1366,390}.png` (open), `tools-summary-disabled-closed-390.png` | Imported file disables BATT_LOW_VOLT: a red "✖ LOW VOLT DISABLED" chip is visible with the summary closed; when open, the grid shows the red DISABLED text in place |
| `tools-emergency-only-{1366,390}.png` | Unchanged in function and look: frame hidden, large buttons |
| `manual-overview-{1366,390,360}.png` | Baseline phone: about 360 px of header and a white bar under the nav. Now: bar, summary, then one nav row (☰ Menu · ⚠ Emergency · search). The white bar is gone. Desktop: one nav row with Overview, four dropdown groups, a red Emergency and the search on the right; ◀ TOOLS / MAP ▶ are replaced by the switcher |
| `manual-dropdown-{1366,1024}.png` | Dropdown as a rounded panel under its group button, not clipped; active item in accent |
| `manual-menu-{390,360}.png` | The Menu sheet lists Overview and the four groups with all items; the current tab is marked; Emergency stays in the row above |
| `manual-emergency-{390,1366}.png` | Emergency active: the filled red button |
| `manual-summary-open-1366.png`, `manual-summary-disabled-390.png` | Summary grid; with the imported file, "✖ LOW VOLT DISABLED" in the closed summary row and the existing red banner in the content |
| `map-{1366,390}.png`, `map-sim-1366.png`, `map-status-open-{1024,360,390}.png` | Baseline phone: the header wrapped to about 110 px and the sidebar overlapped it. Now one 48 px bar and the sidebar sits under it. Desktop: the status is inline, the SIMULATED banner is amber, the TBD op. area is amber, and ⚠ shows on the Status button |
| `latency-{1366,390}.png` | The baseline orange letter-spaced title row is replaced by the shared bar. The test name and the CLOCK ONLY / FULL SCREEN buttons are at the top of the page. The version line is in the footer |
| `sun-tools-preflight-1366.png`, `sun-manual-390.png` | Sunlight mode: black / white tokens, thicker borders; the sub-tab row lines up with the zoomed content |
