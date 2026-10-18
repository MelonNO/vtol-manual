# WP25 — Tools page body (redesign wave 3)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md`**, `docs/design/README.md`, `CLAUDE.md`
("index.html — checklist system", "Emergency procedures structure", "Battery-log recommendation"), `index.html`, and
the classes `js/render-content.js` emits for the Tools page.

Worktree: `S/wt/WP25`, branch `wp/25`. WP26 and WP27 run in parallel with you. They never touch `index.html`.

## Files you own

- `index.html` below the nav: every tab panel, the emergency modal, the challenge-response view, other modals, and the
  page `<style>` rules for them. **Not** the header, nav or footer (finished in WP24) and **not** `css/base.css`
  (frozen in wave 3; request changes in your report).
- `test/tools/*`, the Tools parts of `test/smoke/pages.test.js`, new `test/tools/wp25-*.test.js`.
- `CLAUDE.md` section "index.html — checklist system".
- `sw-precache.js` (generated).

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **No inline styles.** Move every static `style="…"` in `index.html` into classes: base components or page rules. html-validate `no-inline-style` warnings for `index.html` → 0. Styles set from JavaScript at run time (for example `el.style.width` of a progress bar) are fine. Every `<button>` gets a `type`. |
| R2 | MUST | **Checklists (Pre-flight, Turnaround).**<br>- The header becomes one calm toolbar: title, progress (count and a thin bar), timer and START as the primary action.<br>- Secondary actions (Expand all, Challenge–response, Reset, the ↺ button) become ghost or small buttons grouped to the right on desktop, or put behind a "More" disclosure. At most two rows on a phone.<br>- **Phone rows:** the item title gets most of the row width. No word-per-line wrapping at 360 px (see `S/baseline/tools-preflight-390.png`).<br>- Keep the two tap zones: tick on the left, detail on the right. Each ≥ 44 px wide; row ≥ 50 px; checkbox 24 × 24 px. The split no longer has to be 50/50: update the `CLAUDE.md` sentence.<br>- Warning items (`w`) keep a clear amber mark. AUTO hints stay visible.<br>- Section headers are calmer: letter badge plus title, with the section accent used only as a small mark.<br>- The GO / NO-GO banner and completion states stay clear. |
| R3 | MUST | **Every other tab** (Post-flight, Link, Battery log, Telemetry, Flights, Params, Weather, Profiles):<br>- one page heading and an optional one-line intro (rewrite copy where it helps);<br>- forms laid out with the base field pattern in a consistent grid (one column on phones);<br>- one primary button per card, other buttons ghost;<br>- results and data tables use the base table style, readable at 390 px (scroll wrapper, not a squeezed table);<br>- empty states with one short sentence;<br>- long help text collapsed behind a disclosure. |
| R4 | MUST | **Emergency modal and challenge–response** restyled with the base emergency and button components. The IMMEDIATE steps stay the first thing seen, large and bold. `openEmerg()` / `emergJump(id)` unchanged. |
| R5 | MUST | **No logic changes.** All ids, function names, `data-*` hooks, `localStorage` keys and rendered values are unchanged. Every test stays green. Change a test only where it asserted old markup layout, and say so. |
| R6 | MUST | **Copy rules** (`04` §4). For `index.html` text you change, run `python3 -I S/tools/safety-tokens.py --git S/wt/WP25 main index.html` and explain every LOST or NEW token in the report. |
| R7 | MUST | **Evidence.**<br>- Screenshots in `S/shots/WP25/` of all ten tabs at 1366 and 390 px, the emergency modal (open it: write a tiny wrapper or read how `shot.sh` works; or verify in jsdom and screenshot emergency-only), and one sunlight-mode view.<br>- Compare them with `S/baseline/tools-*`.<br>- Exercise in jsdom: tick a checklist item, open a detail, save a battery-log entry, switch every tab. |
| R8 | SHOULD | **Battery log.** The voltage ladder and the "Suggested manual RTL trigger" output read as a clear small table or definition list. The wording rule of `CLAUDE.md` "Battery-log recommendation" stays exact in meaning. |

## Report

`docs/tasks/reports/WP25-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus the safety-token output, the
screenshot list and any `css/base.css` change requests for WP28.

## Carried over from the WP23 verification (MINOR)

- M1: the pre-flight progress label ("0 / 36 ITEMS COMPLETE") wraps onto two lines at 1366 px (page rule) — fix in R2.
- M5: some page rules in `index.html` still use `--dim` for text-like glyphs; `--dim` is non-text only (contrast < 4.5:1) — use `--muted`.

## Carried over from the WP24 verification (MINOR)

- M7 (SHOULD): on phones the Checklists sub-tab row scrolls away, so switching Pre-flight ↔ Turnaround deep in a checklist needs scrolling up. Make the sub-tab row sticky below the app bar on phones (page-scoped rule in `index.html`; list it as a request for WP28 to fold into the shell section of `css/base.css`).
