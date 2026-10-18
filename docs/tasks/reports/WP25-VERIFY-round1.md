# WP25 verification — round 1
VERDICT: REJECTED

Worktree `S/wt/WP25`, branch `wp/25` (commits 326fe7f and dfb62a3), base `main` 3247bf0.
Changed files: `index.html`, `CLAUDE.md` (checklist section only), `sw-precache.js` (generated), new `test/tools/wp25-tools-body.test.js`, and the report. All of them are in the brief's "Files you own" list.

## Requirement results
| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 no inline styles, typed buttons | PASS | html-validate index.html: main 117 warnings, WP25 0; test R1 | The only inline styles left are set at run time (mode/timeline widths, progress, timer colour, display toggles). `#emerg-modal` starts hidden through one script line (index.html, after `emergIsOpen()`), so `emergIsOpen()` and `css/print.css` `[style*="display: none"]` behave as before. Checked in jsdom. |
| R2 checklists | PASS (with minors) | page CSS "CHECKLISTS"; Firefox measurements (below); shots preflight-1366/390/360, turnaround-360, more-open-390 | One toolbar row at 1366 and two rows on a phone; START is the only primary button. Tick zone ≥ 272 px at 360, detail zone 52 px (phone) / 120 px (desktop), rows 52 px, checkbox 24×24. No word-per-line wrapping at 360. The amber edge and "!" mark warning items. Section headers are calm. The CLAUDE.md sentence is updated. Done rows are 44 px (MINOR 3). |
| R3 other tabs | PASS | shots of all tabs at 1366/390 | Page heading and intro on each tab, `.form-grid` with one column on a phone, one primary button per card, tables in `.tbl-wrap` that scroll, one-sentence empty states, help text in disclosures |
| R4 emergency + C–R | **FAIL** | shots emerg-jump-390, emerg-jump-video-1366 vs main-emerg-jump-390, main-emerg-jump-video-1366 | IMMEDIATE cards now come first and the 915 note stays a note. But the new sticky modal header hides the scenario title after `emergJump()` (Finding 1). |
| R5 no logic changes | PASS | ids/data-*/on*/localStorage/getElementById diff vs main: identical except the new `cl-more-pf/ta`; function list identical except the local helpers `row`/`lbl` inside `renderBinResult` (replaced by `sc()`/`chartBlock`) | The script diff has only style edits: the timer class swap, renderer markup, STATUS_STYLE bg tokens, the renderContent order and the modal init line. No existing test changed. |
| R6 copy rules | PASS | safety-tokens output (below) | LOST AUTO×2 / MANUAL×2 are label case only ("auto RTL" = automatic; "Manual RTL" = pilot RTL). NEW RTL×1 is the battery intro, which names the existing output. Battery analysis text is identical in content to main (jsdom diff). "Per-chemistry analysis above→below" is correct for the new order. The post-flight intro matches the three content sections. |
| R7 evidence | PASS | S/shots/WP25/final, own shots S/verify/WP25/shots | The implementer's emergency shots cover only the modal's first screen and miss Finding 1. |
| R8 battery log (SHOULD) | PASS | renderBattLog; jsdom text | The definition list and grouped ladder are in place. The CLAUDE.md "Battery-log recommendation" meaning is unchanged: no BATT_LOW_VOLT recommendation, fixed failsafe margins, "not changed from this log". |
| M1 / M5 / M7 | PASS | `.cl-progress-label{white-space:nowrap}`, no `color:var(--dim)`, sticky `body>#nav.tn-has-sub` on phone | |

## Contract results
`VtolRender` output is consumed unchanged. The store keys are unchanged (`vtol_active_tab`, `vtol_cl_preflight`, `vtol_cl_turnaround`, `vtol_store`). The hash route `#emergency-only` works: jsdom shows `vf-eo` with no errors. Kneeboard print: `.cl-hdr-title` is still a direct child, and the More checkbox and label are hidden by `.cl-hdr > :not(.cl-hdr-title)`.

## Tests run (commands + results)
- `node --test test/` with VTOL_JSDOM: 339 pass / 0 fail. The new test file has 5 tests and is meaningful: it does a real jsdom run with tick, detail, timer, battery entry through the form, every tab, the modal order, and closed-at-load. No test is weakened.
- `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images` and `check-colours` all pass.
- html-validate on the 4 pages: 0 errors. Warnings: index 117→0, manual 0→0, map 40→40, latency 2→2.
- `safety-tokens.py --git S/wt/WP25 main index.html`: LOST AUTO×2 and MANUAL×2 (both gone completely), NEW RTL×1. Reviewed above; acceptable.

## Smoke tests (what you loaded/clicked + result)
`S/verify/WP25/smoke.js` loads main and WP25 side by side in jsdom, with the same JS:
- The pre-flight list (36 items) and turnaround list (16 items) are identical in id order, `w` flag, AUTO hint presence, title and detail text: SAME.
- The emergency cards (8 scenarios) are identical in IMMEDIATE steps, order and clean-up steps; pills and post-flight are SAME. `#emerg-list` order in WP25 is the 8 cards, then the 915 note (`card amber emerg-note`), then design-intent. Every card is header → `.emerg-imm` → clean-up.
- Tick: `1 / 36 ITEMS COMPLETE`. The detail opens. The timer START→STOP→START works with the `running` class, and reset gives 00:00. Two battery entries were saved and the analysis text matches main word for word apart from order and case. All 10 tabs activate. `openEmerg` and `emergJump` run, and Escape closes the modal. Emergency-only mode works. No script errors on either page.
- Firefox geometry (shotjs overlay): at 360 and 390 the minimum row is 52 px, the tick zone is 272/302 px, the detail zone 52 px, the box 24×24, and scrollWidth equals clientWidth (no horizontal scroll). At 1366 the tick zone is 832 px and the detail zone 120 px.

## Visual review
I took my own shots in `S/verify/WP25/shots/`: all 10 tabs at 1366 and 390, checklists at 360, the More menu open, the modal, modal jumps (WP25 and main), sunlight preflight-1366 and battlog-390, and emergency-only. Against `S/baseline/tools-*` this is a large improvement: calm toolbar, titles on one or two lines at 360, readable forms, tables that scroll, sunlight follows the tokens. Nothing overlaps or is clipped except the frame-level EMERGENCY button over the right end of rows while scrolling, which also happens in the baseline (WP24 frame). The one regression is Finding 1.

## Findings
1. **MAJOR** — `index.html` page CSS `.emerg-modal-hdr{position:sticky;top:0;…}` together with the unchanged `emergJump()` (`modal.scrollTop = el.offsetTop - 16`).
   - **What is wrong:** jumping to a scenario puts the top of its card under the new sticky header, which is about 70 px tall at 1366 and about 95 px at 390. The scenario title ("Battery Low / Critical — Carrier", "Video Loss …", "Transition …") and the IMMEDIATE badge are hidden. The pilot sees step lines without the heading that confirms which emergency was opened. On main the title is visible after the jump (main-emerg-jump-390.png, main-emerg-jump-video-1366.png). This is a regression in the safety path that R4 requires to keep working ("IMMEDIATE steps stay the first thing seen"; the jump target must be readable).
   - **Expected:** after `emergJump(id)` the card title and its whole IMMEDIATE block are visible below the header, at 390 and 1366. Possible fixes:
     - make the header non-sticky;
     - or offset the jump by the header height (a minimal, justified change to `emergJump`, e.g. `scrollTop = el.offsetTop - hdr.offsetHeight - 16`);
     - or use `scrollIntoView` with `scroll-margin-top`.
   - Add a test or screenshot of a jump.
2. MINOR — More menu (CSS-only checkbox).
   - On a phone it works by touch and keyboard: the sr-only checkbox takes Space, and a focus ring is drawn on the label.
   - It does not close after an action, on Escape, or on an outside tap.
   - On desktop the sr-only checkbox stays in the tab order with no visible focus and no effect. It should be `display:none` or `tabindex` handled outside the phone media query.
   - The visible label is `aria-hidden`. That is acceptable because the checkbox carries the aria-label.
3. MINOR — Done rows are 44 px (`.ci.done{min-height:44px}`), below the 04 §2 "rows ≥ 50 px" wording. This is better than main (28 px) and still ≥ 44 px as a tap target. Either accept it explicitly as the collapsed state or document it. CLAUDE.md says "rows ≥ 52 px" without mentioning the done state.
4. MINOR — `!important` on `.cl-section-hdr` border and `.cl-section-name` colour overrides the renderer's inline section colours. It is narrowly scoped, commented, and has a WP28 request to emit `--sec`. It is acceptable as temporary, not a maintainability FAIL, but WP28 must remove it.
5. MINOR — `body>#nav.tn-has-sub` works around the shell-test guard. It is acceptable as page-scoped until WP28 moves it to base.css section 8, as requested.
6. MINOR — The `.htmlvalidate.cjs` comments still describe the old index.html counts (95 inline styles, buttons, the `#bl-log-table` tbody case). This is not WP25's file and is listed for WP28/PM.
7. MINOR — `pf-table` class has no rule (unused hook). The battery-analysis statistics lost their amber/red emphasis (Avg min, Lowest min, Worst sag). The numbers and thresholds are unchanged and the status chips remain, so this is acceptable under "calm".
8. MINOR (pre-existing, frame) — on a phone the fixed EMERGENCY button covers the warning dot and detail zone of whichever row is under it while scrolling. The tick zones are clear. This also happens in the baseline; it is for WP24/WP28 frame follow-up.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed
REJECTED for one MAJOR item: **Finding 1** — the emergency-modal jump hides the scenario title under the new sticky header at both 390 and 1366 (regression vs main in the emergency path). Everything else passes: scope, R1–R3, R5–R8, tests, html-validate, the safety-token review, unchanged checklist and emergency content and order, and no horizontal scroll. Once Finding 1 is fixed and shown with jump screenshots at 390/1366 (and ideally a test), this WP should be approvable. The MINORs can be carried forward.
