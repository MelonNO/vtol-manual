# WP24 — Shared page frame: header, key-values strip, navigation (redesign wave 2)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md`**, `docs/design/README.md` (from WP23),
`CLAUDE.md` ("manual.html tab structure", "index.html — checklist system"), `js/field.js`, the header, nav and
footer markup, CSS and script of all four pages, `test/manual/nav.test.js`, `test/tools/swipe-order.test.js`,
`test/pwa/field.test.js`, `test/pwa/pages.test.js`, `test/smoke/pages.test.js`.

Worktree: `S/wt/WP24`, branch `wp/24`.

**Known fix to keep:** the manual's nav dropdowns are `position:fixed`, placed from `getBoundingClientRect()` in
`toggleNavGroup()`. `position:absolute` children were clipped by the nav's `overflow-x:auto`. A scroll listener closes
open dropdowns. Do not reintroduce `position:absolute` inside an overflow container.

## Files you own

- In `index.html`, `manual.html`, `relay/map.html` and `tools/latency-clock.html`: the `<header>`, `<nav>` and
  `<footer>` markup, their page CSS, and the script functions that only drive them. On the Tools page this includes:
  - the nav, `switchTab` and `navTabOrder`;
  - the swipe navigation;
  - the bottom nav;
  - the header key-values (meta) rendering.
- The Tools emergency FAB styling.
- `js/field.js` (header tools, sunlight toggle, version line).
- `css/base.css`: a new **"shell"** section only.
- Nav, field and smoke tests listed above; new `test/shell/*.test.js`.
- `CLAUDE.md` sections "manual.html tab structure" and the nav sentence of "Style conventions".
- `sw-precache.js` (generated).

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **One compact app bar** on all four pages:<br>- Height ≤ 56 px on desktop and phone, in one row.<br>- Contents: the page identity (Tools / Manual / Map / Clock: a small badge, no longer a tall vertical orange block) and a short title (for example "Flight Tools", "Operations Manual", "Coverage Map").<br>- A **page switcher** Tools · Manual · Map with the current page marked. The clock stays reachable where it is linked today.<br>- The ☀ sunlight toggle.<br>- Remove the doc-id line and the subtitle line from the header. The document id, revision and date move to the footer or version line, so no information is lost. |
| R2 | MUST | **Key values no longer always expanded.**<br>- The meta strip (platform, client, battery, LOW / CRIT volt, RTL alt, cruise, version, params-verified state, …) becomes a compact **"Aircraft summary"** disclosure directly under the bar, closed by default and laid out as a tidy grid when open.<br>- Its live values keep updating exactly as now: same render functions, re-rendered on `vtol-store-changed`.<br>- **Safety rule:** any warning state the strip shows today must stay visible **without opening it**, as an amber or red chip in the bar or next to the summary. Examples: "params not verified against a param file", a DISABLED failsafe, TBD values.<br>- The open/closed choice may be remembered per device under a new `localStorage` key `vtol_summary_open`. Add the key to the `CLAUDE.md` key table. |
| R3 | MUST | **Tools navigation in groups.**<br>- Five groups: **Checklists** (Pre-flight, Turnaround, Post-flight) · **Link** · **Logs** (Battery, Telemetry, Flights) · **Weather** · **Setup** (Params, Profiles).<br>- Desktop: one group row, plus a segmented sub-tab row under it when the group has more than one tab.<br>- Phone (≤ 600 px): the fixed bottom nav shows the five groups with labels (icons optional), each ≥ 44 px; the sub-tabs show at the top of the content.<br>- Keep the 10 tab ids, the panels, `switchTab(name, …)`, `vtol_active_tab`, and swipe navigation over **all ten tabs in group order**, still derived from the nav (no hard-coded list).<br>- Update `swipe-order.test.js` deliberately so it still proves "every panel has exactly one nav entry" and "swipe order = nav order". |
| R4 | MUST | **Manual navigation.**<br>- Keep the grouped dropdown nav (Overview, Aircraft, Operations, Planning, Reference, ⚠ Emergency) and the search field, restyled in the new system.<br>- Emergency is always visible and red.<br>- At 390 px and at 360 px nothing may be clipped or need a sideways scroll to reach Emergency. Either it all fits, or a "Menu" button opens a sheet listing every tab by group, with Emergency kept outside the menu.<br>- **Fix the white gap bar** under the phone header (visible in `S/baseline/manual-*-390.png`).<br>- `showTab`, `selectNavItem`, `toggleNavGroup`, hash routes, `vtol_manual_tab` and the search (`manGoTo`) keep working. Update `nav.test.js` only where it asserts old markup layout. |
| R5 | MUST | **Map and clock headers.**<br>- Same app bar. The map's status items (SRC, VIDEO, OP AREA, TERRAIN, GCS APP) stay visible in compact form on desktop; on phones they may move into a disclosure.<br>- The map keeps its full-height layout: the map area must not shrink because of the new bar. |
| R6 | MUST | **Emergency access.**<br>- The Tools EMERGENCY button stays fixed, red and visible on every tab, but without the infinite pulse animation.<br>- On phones it must not cover the bottom nav or the checklist tick boxes. Check the screenshots.<br>- Emergency-only mode (`index.html#emergency-only`) still works and looks unchanged in function. |
| R7 | MUST | **One shell CSS.** All header, nav and footer styles live in the `css/base.css` shell section and are shared by the four pages; page `<style>` blocks keep only true page specifics. Every `<button>` you touch gets `type="button"`. html-validate: no new errors. |
| R8 | MUST | **No regressions.**<br>- Everything in `04` §3 passes.<br>- Screenshots in `S/shots/WP24/` at 1366 and 390 px (and one at 360 px for the manual nav): every Tools group, manual overview, the manual nav with a dropdown open, the manual Menu sheet if any, map, clock, sunlight mode once.<br>- Compare them with `S/baseline/` and describe the changes in the report. |
| R9 | SHOULD | **Footer.** One calm, consistent footer (version line, share/kneeboard menu on Tools, doc id) on every page. |

## Out of scope

Tab panel content and page body layouts (WP25–WP27), `data/content.js` and the renderers (WP28), and the base component
section of `css/base.css` (WP23 is done). If a component needs a change, add a request in your report.

## Report

`docs/tasks/reports/WP24-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus the screenshot list and
observations.
