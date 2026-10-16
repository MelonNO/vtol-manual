# WP01 verification — round 2
VERDICT: APPROVED

Verifier: independent verification agent. Worktree `S\wt\WP01`, branch `wp/01`, HEAD `ee963f4` ("WP01 rework 1: safe settings merge, store validation, escaping"). Round 1 report: `S\verify\WP01\VERIFY-round1.md`.

## Scope

The rework commit (`208dcc6..ee963f4`) touches only owned files: `js/store.js` (143 lines changed), `index.html` (33), `test/tools/store.test.js` (102) and the implementation report. The full branch diff against the base still has the same out-of-scope files as in round 1 (`sw.js`, `test/index.js`), both already judged justified. A trial merge into the current `main` is clean (`git merge-tree`). The commit trailers are present.

## Re-check of round-1 findings

| # | Sev (r1) | Status | Evidence (own reproduction: `S\verify\WP01\round2.js`, output in `round2-output.txt`) |
|---|---|---|---|
| 1 | MAJOR | **FIXED** | `js/store.js:333-347`: incoming settings are taken only when they carry their own `settings.updatedAt` newer than the local stamp. Reproduced the phone→laptop scenario in the page: local edits BATT_CRT 22.4 and wind GO 4. Importing a never-edited file with top-level `updatedAt` 2099 keeps 22.4 and 4, still merges the phone's battery record, and sets `lastStats.settings=false`. A stamped, newer file is taken, and its invalid `manualRtlVolt:'abc'` keeps the local 23.0 and is reported. A stamped, older file is ignored. The test was rewritten (`store.test.js:195`) and a regression test added (`:211`). |
| 2 | MAJOR | **FIXED** | First layer, the store: `cleanPack` (`store.js:116-133`) requires `cells` to be an integer 1–24 and `chem`/`role` to be enum values, so the XSS pack and a pack with a markup `chem` are rejected on import, `'4'` is coerced to 4, and a bad battery entry is dropped. Second layer, the page: `index.html:973`, `:981`, `:1524` escape `cells` and the chemistry name. I injected a bad pack straight into the in-memory `store` (bypassing validation) and `renderBattLog` still produced 0 injected elements. `.bin`: `escH(s.name)` in the title attribute and the legend (`:1549`, `:1554`). Feeding `renderBinResult` a mode `'<img …>'` and filename `f<i>.bin` gives 0 injected elements and the literal text is shown. |
| 3 | MINOR | **FIXED** | `normalize()` validates on load and on import (`store.js:100-199`). In the page, I stored `battCrtVolt:'22.6'`, `manualRtlVolt:null`, `hardLimitVolt:'abc'`, `checklistExpiryHours:-1` and a default carrier pack with `cells:'six'`. Result: no script errors, values 22.6 / 23.0 / 22.5 / 6 and cells 6, a visible `#store-notice` (escaped, dismissable), and the analysis renders with "BATT_CRT_VOLT (22.6V)". The repair is saved once (`takeIssues()` is empty on the next load). |
| 4 | MINOR | **FIXED** | `importJSON` throws "the merged data could not be saved … nothing was imported" when `setItem` throws, and the store is unchanged. Reproduced. |
| 5 | MINOR | Unchanged (judgement, documented) | Migrated legacy ticks still get a fresh 6 h session, with an amber notice and "time unknown" on each row. For the PM to decide; it is not a defect. |
| 6 | MINOR | **FIXED** | `index.html:890`: the pack selector now stamps `settings.updatedAt` (reproduced). |
| 7 | MINOR | **FIXED** | `index.html:1016`: `setInterval(clRecheck, 60000)`. |
| 8 | info | Unchanged | 4-motor note and "120m AGL" emergency texts; left for WP05 per the brief. |

## Requirement results (regression pass)

R1–R23 were re-run through the smoke and unit tests below. R2, R3 and R10, which partly failed in round 1, now **PASS**. Every other requirement still **PASSES**, with the same evidence as round 1 (line numbers moved by ≤ 15 because of the additions). The C1/C4 contract checks are unchanged:
- `takeIssues`, `lastStats.settings` and `lastStats.issues` are additive extensions; the specified API and shape are intact.
- Default profiles still match C1 (`store.test.js` defaults test passes).

## Tests run

```
export PATH="/c/Program Files/nodejs:$PATH"; cd S/wt/WP01; node --test test/
ℹ tests 61  ℹ pass 61  ℹ fail 0
```

The new tests are meaningful:
- a rewritten settings-merge test, including an unstamped file dated 2030
- a regression test of the round-1 phone→laptop scenario
- import validation: XSS cells, a coerced 4S pack, a bad battery entry, a bad favourite
- load validation: repair is saved and reported once
- failed save on import

`html-validate index.html`: no-implicit-button-type 41, no-inline-style 72, prefer-tbody 1. These are identical to round 1, so the rework adds no new errors.

## Smoke tests

- **Round-1 script** `S\verify\WP01\smoke.js` (unchanged), output `smoke-output-r2.txt`: **58 pass, 0 fail.**
  - It covers legacy migration and gh-key removal, escaping of every XSS vector, the S-05 margin and settings, the mast pack, checklist ticks, expiry and fresh session, swipe guards, clean-up, copy fallback, export, the weather index, relay winds, limits, cache-on-network-failure and the HTTP error.
  - The two round-1 failures (settings revert, pack.cells injection) now pass.
- **Round-2 script** `S\verify\WP01\round2.js`, output `round2-output.txt`: **27 pass, 0 fail**, no script errors in any load.
- **Gist grep:** only `js/store.js` cleanup plus the word "register".

## Findings (round 2)

1. **MINOR — an invalid incoming record for a *default* pack id resets the local pack's fields to the defaults** (`js/store.js:131-133`, used by `coerceIncoming` at `:329`).
   - **Reproduced:**
     - A local carrier pack migrated as 4S Li-Ion.
     - The import file holds a newer `pack-carrier-6s-7000` record with `cells:'bad'`.
     - After import, the local pack is 6S Li-Ion.
   - **Why it matters:** this partly contradicts the report's claim that invalid records are rejected "before they can overwrite a valid local copy".
   - **Mitigations in place:**
     - It needs a malformed file.
     - A visible notice says "reset to the default profile value".
     - The carrier thresholds are absolute settings, so the BATT_LOW recommendation is unaffected.
   - **Suggested:** on import, drop invalid incoming records for default ids too, and repair to the default only on load. `store.test.js:241` currently asserts the fallback.
2. **MINOR (carried over, judgement)** — round-1 Finding 5: migrated legacy ticks keep a 6 h session.
3. **MINOR (carried over, info)** — round-1 Finding 8: content strings for WP05.

## Approval rationale

Zero BLOCKER and zero MAJOR findings. Every MUST requirement passes, including R2, R3 and R10, which were partial in round 1.

Both MAJOR findings are fixed. I confirmed each with my own reproductions, and both are now covered by unit tests. The new validation layer is readable, sits in the store where the later consumers (WP02/05/11) benefit from it, reports repairs visibly and has tests.

The regression pass found nothing broken. The three MINOR items above may remain. I suggest the PM:
- puts item 1 on the WP05 list, or asks for a one-line change
- decides on item 2
- adds the C1 extensions (`settings.updatedAt`, wind limits, `takeIssues`, `lastStats`) to `02-CONTRACTS.md` at merge.
