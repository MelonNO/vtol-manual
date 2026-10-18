# WP28 — Shared content copy, rendered components, CHANGELOG (redesign wave 4)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md`**, `docs/design/README.md`, `02-CONTRACTS.md` C5,
`CLAUDE.md` ("index.html — checklist system", "Emergency procedures structure"), `data/content.js`,
`js/render-content.js`, `test/content/*`, and the WP25 / WP26 / WP27 implementation reports (their `css/base.css`
requests).

Worktree: `S/wt/WP28`, branch `wp/28`.

## Files you own

- `data/content.js`: **text only**. Ids, keys, item shapes, tokens and markup syntax are unchanged.
- `js/render-content.js`: markup and class changes only; escaping and token behaviour unchanged.
- `css/base.css`: the components section, plus folding in the wave-3 requests.
- The page `<style>` rules that those requests replace (delete only the override being folded in).
- `test/content/*`, new `test/content/wp28-*.test.js`.
- `CHANGELOG.md`, `README.md` (the description of the pages, if it is now wrong), `docs/design/README.md`.
- `sw-precache.js` (generated).

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Copy pass on the shared content.** Applies to: checklist `s` / `t` / `n`, post-flight, emergency notes and CLEAN-UP text, callouts, failsafe table wording, Link view labels.<br>- Write shorter, plainer text with consistent terminology. Checklist `s` stays ≤ 5 words.<br>- **Emergency IMMEDIATE steps:** wording may only get shorter or clearer, never change in order, meaning, mode or number.<br>- Copy rules `04` §4 apply. Paste the safety-token diff for `data/content.js` into the report and explain every LOST or NEW token. |
| R2 | MUST | **Safety-token lock test.** Add a test that, for each content item (by id), extracts the numbers, parameter names, modes, IPs and TBD / VERIFY markers, and compares them with a committed fixture. Generate the fixture from `main` before your copy edits, then update it only for tokens you justify in the report. Future copy edits can then not silently change a value. |
| R3 | MUST | **Wave-3 requests.** Fold each `css/base.css` request from the WP25–WP27 reports into the base components (or reject it, with a reason). Remove the matching page overrides. Document the result in `docs/design/README.md`. |
| R4 | MUST | **Rendered components polish.** Make the renderer output consistent with the base components (checklist rows, emergency cards, tables, callouts, Link view) without changing class contracts that pages or tests rely on. Escaping is unchanged; `[[TBD — …]]` and `[[VERIFY — …]]` still render amber. |
| R5 | MUST | **CHANGELOG.** Add an "Unreleased — redesign" entry summarising WP23–WP28 for a field user: what looks different and where things moved (Tools groups, Aircraft summary, manual "On this page", map panel). No version bump. Update `README.md` if it describes the old layout. |
| R6 | MUST | **No regressions and evidence.** Everything in `04` §3 passes. Screenshots in `S/shots/WP28/` at 1366 and 390 px of: Tools pre-flight with one item expanded, Tools Link, the Tools emergency modal or emergency-only mode, manual emergency, manual comms (network table), plus one sunlight view. Compare them with the WP25 and WP26 shots and the baseline. |

## Report

`docs/tasks/reports/WP28-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus the safety-token output, the
request-fold table and the screenshot list.

## Carried over from the WP23 verification (MINOR)

- M2: `docs/design/styleguide.html`'s contrast script throws in jsdom (works in Firefox) — make it robust.
- M3: the tint-contrast test does not cover `--surface2` — extend it.
- M4: a comment in `css/print.css` is stale — correct it.

## Carried over from the WP24 verification and report (MINOR; shell section of `css/base.css` and `js/field.js` are yours in wave 4)

- M1: manual Menu sheet at 601–900 px: columns vertically centred and misaligned — `align-items:start`.
- M4: the manual search placeholder is cut off at 360 px.
- M5: dead `.hdr-*` selectors in `css/print.css`; dead `.vf-hdr-tools` / `.vf-lbl` in `css/base.css` §6 — remove; update `docs/design/README.md` for the shell (WP24 request).
- M6: scrolling past the end of the Menu sheet scrolls the page and closes the sheet — contain the scroll (`overscroll-behavior:contain`) or keep it open.
- Fold in WP25's sticky sub-tab request (WP25 report).

## Carried over from the WP27 verification (MINOR)

- Map, desktop width: the "⊕ Use My Location" label is 10 px wider than its button and touches the border (phones fine) — fix in `relay/map.html` page CSS or via the shared button rule; WP28 may touch this one rule in `relay/map.html`.
- Fold in the WP27 report §6 requests (M3 shell height 1 px, sunlight borders for map overlays, shared patterns: unit-suffix input, segmented choice, helper line, icon button).

## Carried over from the WP25 verification (MINOR)

- Tools phone: a tap outside the open "More" menu also activates whatever is under it — swallow that first outside tap (closing only), or use a backdrop. WP28 may touch this listener in `index.html`.
- Remove the WP25 `!important` overrides of the inline section colours (render the section accent through a class or CSS variable in `js/render-content.js`) and fold `body>#nav.tn-has-sub` into the shell section (WP25 report §6).
- Tools phone: the fixed EMERGENCY button covers the right end of checklist rows (detail zone) while scrolling (pre-existing). Reserve space for it (e.g. bottom padding plus a narrower button, or place it inside the bottom nav row) without making it less visible.
