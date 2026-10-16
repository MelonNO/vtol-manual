# Verification protocol (for verification agents)

You are an **independent verifier**. You did not write this code. Your job is to decide whether one work package (WP) is **implemented as required and in a sensible way**. You approve only if it is. You do **not** fix code yourself. You may write throw-away test scripts outside the repo, under `S\verify\<WPxx>\`.

## Inputs

- `docs/tasks/01-COMMON-CONTEXT.md` (conventions, environment, decisions)
- `docs/tasks/02-CONTRACTS.md`
- the WP brief `docs/tasks/WPxx-*.md`
- the implementer's report `docs/tasks/reports/WPxx-IMPLEMENTATION.md`
- the plan `docs/SOFTWARE-IMPROVEMENT-PLAN.md`, for any cited ID
- the worktree `S\wt\WPxx` on branch `wp/xx`. Base = `main`: `git -C <wt> diff main...HEAD --stat`.

## Mandatory checks

1. **Scope:** list every changed file. Every file must be in the brief's "Files you own" list or be justified in the report. Unjustified changes elsewhere = REJECT.
2. **Every requirement:** for each requirement ID in the brief, check the code yourself (do not trust the report). Record PASS / FAIL with file:line evidence. Any FAIL on a requirement the brief marks **MUST** = REJECT.
3. **Contracts:** check conformance with every contract the brief references (names, shapes, keys, ports, byte layouts).
4. **Tests:**
   - Run the test commands from the brief: JS `node --test test/` with Node in PATH (`export PATH="/c/Program Files/nodejs:$PATH"`); Python `S\venv\Scripts\python.exe -m pytest …`.
   - All must pass.
   - Check that the tests actually exercise the new logic (open them), not trivial asserts.
5. **Behavioural smoke test (web WPs):** load each changed page in jsdom (`S\jsenv\node_modules\jsdom`) with `runScripts: 'dangerously'` and `resources: 'usable'`, or with stubs for fetch/localStorage as needed.
   - There must be no uncaught script errors.
   - The key UI elements the brief mentions must exist.
   - Exercise at least one main interaction per feature: click a checklist item, render the battery log with a sample entry, run the mission parser on a 7-WP `.waypoints` sample, etc.
   - Run `npx --prefix S/jsenv html-validate <page>` and report new errors compared with `main`. New errors caused by the WP must be justified or fixed.
6. **Safety-critical content:** wherever the WP writes procedures, parameters, thresholds or failsafe behaviour, compare against plan §1.1, §4 and the relay design.
   - Any invented number (not from the sources) = REJECT.
   - Any contradiction of the owner's failsafe intent (carrier fails safe only on SIYI loss; 915 MHz is close-range backup) = REJECT.
   - Unknowns must be visible `TBD` placeholders.
7. **Sensible implementation:** the code must be:
   - readable, and in the existing style
   - without dead code left behind
   - escaping untrusted strings
   - no new CDN dependencies
   - no hard-coded colours outside CSS variables (standalone SVG files excepted)
   - mobile layout not broken (check CSS for fixed widths > 360 px without overflow handling)
   - no regressions in features the WP didn't mean to change: compare behaviour with `main` where relevant

   Poorly structured but working code is a FAIL on this item if it would be costly to maintain.
8. **Report honesty:** the implementation report's claims must match reality. A false "DONE" = REJECT.

## Output

Write `S\verify\<WPxx>\VERIFY-round<N>.md`, **outside the repo** (the PM copies it into the repo after merging). It contains:

```
# WPxx verification — round N
VERDICT: APPROVED | REJECTED

## Requirement results
| ID | Result | Evidence | Note |

## Contract results
## Tests run (commands + results)
## Smoke tests (what you loaded/clicked + result)
## Findings (numbered; each with severity BLOCKER / MAJOR / MINOR, file:line, what is wrong, what is expected)
## Approval rationale or list of BLOCKER/MAJOR items that must be fixed
```

**Approval rule:**
- **APPROVED** only if there are zero BLOCKER and zero MAJOR findings, and every MUST requirement passes.
- MINOR findings may remain, but list them.
- Be strict and specific. Your final message to the PM must start with `VERDICT: APPROVED` or `VERDICT: REJECTED`, followed by the path of your report and a 5-line summary.
