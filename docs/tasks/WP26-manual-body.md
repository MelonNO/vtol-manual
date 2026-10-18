# WP26 — Manual body and diagrams (redesign wave 3)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md`**, `docs/design/README.md`, `CLAUDE.md` (all
sections on the manual, aircraft, failsafes and the voltage ladder), `manual.html`, `scripts/diagrams/README.md`, and
the relay design (path in `04` §3) for any relay statement you touch.

Worktree: `S/wt/WP26`, branch `wp/26`. WP25 and WP27 run in parallel with you. They never touch `manual.html`.

## Files you own

- `manual.html` below the nav: every tab's content, the page `<style>` rules for it, and the inline content scripts
  that only lay out content. **Not** the header, nav or footer (WP24), and **not** `css/base.css` (frozen in wave 3;
  put requests in your report).
- `scripts/diagrams/**`, `img/diagrams/**` (regenerate with `node scripts/diagrams/build.js`).
- `test/manual/*`, `test/diagrams/*`.
- `sw-precache.js` (generated).

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Readable prose.** Body text in the base sans at 16 px. Prose blocks at most about 70ch wide; tables and diagrams may be wider. Clear heading hierarchy in every tab: one tab title, then section headings, then sub-headings. Paragraph spacing from the token scale. |
| R2 | MUST | **Overview.**<br>- The 10 "key performance figures" cards become a compact two-column definition list or table: label, value in monospace, safety values in their colour chip.<br>- Images sit side by side at a modest size, with short captions.<br>- Add a short "How to use this manual" line that points to Emergency and Tools. |
| R3 | MUST | **Fewer, calmer callouts.**<br>- Use the base callout component everywhere.<br>- Where two or more callouts stack and repeat the same fact that is stated elsewhere on the tab, merge or shorten them (copy rules apply).<br>- Long explanatory callouts get a short visible lead plus a disclosure for the rest. |
| R4 | MUST | **Fix the step rendering bug.** In Procedures → Power-up sequence (`S/baseline/manual-procedures-1366.png`), steps 2 and 7: inline bold phrases and "OFF" break onto their own lines. Every step text must flow inline. Check all `.step` / `.proc-step` instances. |
| R5 | MUST | **"On this page".**<br>- Desktop (≥ 1200 px): a sticky side list of the active tab's sections, scrolling to each anchor through the existing `showTab(tab, anchor)` / hash routing.<br>- Phone: a collapsible "On this page" at the top of the tab.<br>- Built from the section headings at render time. No hard-coded duplicate list. |
| R6 | MUST | **Copy pass** over all tabs (`04` §4):<br>- tighten prose, remove repetition across tabs (link instead), keep the terminology consistent (carrier, client, relay, GCS app, Mission Planner);<br>- every relay statement consistent with the relay design.<br>- Run the safety-token diff for `manual.html` and explain every LOST or NEW token in the report. `data-fs` phrases (`fillFailsafePhrases()`) must keep working: do not change their markup contract. |
| R7 | MUST | **Tables and inline styles.** All tables use the base table style with a scroll wrapper on phones. No static inline styles in `manual.html` (html-validate `no-inline-style` → 0 for this file). The Parameters tab stays fast and searchable as now. |
| R8 | SHOULD | **Diagrams.** The generated SVG diagrams (D1–D15, D8b) use font sizes and weights that match the new type scale: no giant text next to small prose (see `S/baseline/manual-procedures-1366.png`, D10). Keep the colours as tokens or the documented palette. `node scripts/diagrams/build.js --check` must pass. |
| R9 | MUST | **No regressions.** `renderManual()`, `showTab`, `manGoTo` search, hash routes, `ManualCore`, the Emergency tab rendering from `VtolContent`, `data-fs` DISABLED statements and the image credits section all work. All tests stay green; change a test only where it asserted old layout. |
| R10 | MUST | **Evidence.** Screenshots in `S/shots/WP26/` of all 16 tabs at 1366 and 390 px, plus one sunlight-mode view. Compare them with `S/baseline/manual-*`. |

## Report

`docs/tasks/reports/WP26-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus the safety-token output, a list of
merged or removed callouts (old text → where the fact lives now), the screenshot list and `css/base.css` requests.
