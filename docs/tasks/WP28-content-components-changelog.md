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
