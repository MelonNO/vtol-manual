# WP11 verification — round 2
VERDICT: APPROVED

Worktree `S\wt\WP11`, branch `wp/11` at `0ad72ed` ("WP11 rework round 1"). The worktree was clean, and I worked on it read-only. The merge test used a throw-away clone, which I deleted afterwards.

**Rework diff `f88cfbf..0ad72ed`:**
- `index.html`
- `js/store.js`
- `js/tools-core.js`
- `tools/latency-clock.html`
- `test/tools/bin-analysis.test.js`
- `test/tools/store-wp11.test.js`
- the report

All of these are owned files. Scope is unchanged from round 1, which passed.

## Requirement results

Round-1 results stand for R1–R5 and R7–R10, all PASS. Changes this round:

| ID | Result | Evidence | Note |
|---|---|---|---|
| R6 | **PASS** (was FAIL) | `index.html:567-568` | **Text:** "Remote piloting through the relay is covered by the operator's authorisation (Luftfartstilsynet) — owner decision, plan §1.1. Radio-spectrum rules (Nkom) are a separate question."<br>**Consistency:** this matches `manual.html:466` and `data/content.js:66` (`site-airspace`).<br>**Only placeholder:** amber "TBD — authorisation reference / document number (plan §10.5)".<br>**Smoke checks:** the decision text is present, the old "confirm that … covered" text is gone, and the card has exactly one `.warn-val`, which names only the reference. |
| R2 | PASS | `js/tools-core.js:629-648`, `index.html:2029` | Event classes were reworked (finding 4 below). |
| R8 | PASS | `index.html:41`, `:247`, `:259`, `:334`, `:641-643` | The emergency button now stays on top (finding 5 below). |
| R9 | PASS | `tools/latency-clock.html:93`, `:146-150` | The page now uses `VtolCommon.copyToClipboard` (finding 8 below). |

## Round-1 findings — re-check, each with my own reproduction

| # | Sev (r1) | Status | My reproduction |
|---|---|---|---|
| 1 | MAJOR | **FIXED** | See R6 above (smoke-r2). |
| 2 | MINOR | **FIXED** | **Change:** `cleanParamFile` stores `new Date(Date.parse(…)).toISOString()` (`js/store.js:315`), and `mergeStores` compares `Date.parse` values (`:527-531`).<br>**Smoke checks:**<br>- "Fri, 01 Jan 2000 …" no longer beats a newer ISO stamp.<br>- "Mon, 01 Jan 2120 00:00:00 GMT" wins and is stored as `2120-01-01T00:00:00.000Z`.<br>- "not a date" never wins.<br>**Load path:** an old local store with `importedAt: "9999"` normalises on load. |
| 3 | MINOR | **FIXED** | **Change:** `cleanFlight` (`js/store.js:280-300`, `isDay` :280) now drops records with:<br>- a date that is not a real `YYYY-MM-DD`, via the shared `isDay`<br>- `battIds` that is not an array of strings<br>- label / notes / archiveId that is an object<br>- a summary that is not an object<br>`cleanMaint` uses `isDay` too.<br>**Smoke checks:**<br>- import records with `2026-02-30`, `battIds: [5]` and `gcsSummary: [1]` → all three rejected<br>- a valid local `f2`, then a newer `{date: 'yesterday'}` import → local `f2` unchanged<br>- a well-formed record with XSS strings in every field is accepted, rendered escaped, and no script runs |
| 4 | MINOR | **FIXED** | **ArduPilot source:**<br>- `AP_BattMonitor.cpp:966`: `"Battery %d is %s %.2fV used %.0f mAh"` with "low" / "critical"<br>- `events.cpp`: "RC Short Failsafe On", "%s Failsafe On: switched to %s", "… Failsafe Cleared"<br>- `quadplane.cpp`: "Transition …" texts<br>- `VTOL_Assist.cpp`: "Alt assist" / "Angle assist"<br>**My 31-text run:**<br>- every real failsafe, battery, assist and transition text is classified correctly<br>- "Transition failed, exceeded time limit" → transition + failsafe<br>- "Calibration failed", "Mode change to QLAND failed…", "Airspeed sensor 1 failed", "Lost GPS lock" and "PreArm: Battery 1 below…" → `warning` only, labelled "⚠ ERROR / WARNING" in amber<br>- "VTOL transition only in AUTO", "Disarmed" and "Mission: 3 VTOL_LAND" → no event<br>**Test:** `bin-analysis.test.js` now has a matching test. |
| 5 | MINOR | **FIXED** | **Z-order:** `#emerg-fab` 1050 > `#cr-modal` 1000; `#emerg-modal` 1100 > FAB (computed in jsdom).<br>**Escape order, smoke:**<br>- In challenge–response mode, the FAB opens the emergency modal above it.<br>- Escape #1 closes only the emergency modal; challenge–response stays open with body scroll still locked (`closeEmerg` keeps `overflow:hidden` while `cr` is open).<br>- Escape #2 closes challenge–response.<br>**Mobile:** the FAB sits at bottom 68 px, about 44 px tall. The 140 px bottom padding of `.cr-wrap` keeps it clear of the CHECK / SKIP buttons. |
| 6 | MINOR | **FIXED** | **Change:** `fmtS` rounds before splitting (`index.html:2007`); the pre-existing `.bin` `tFmt`, duration and MSG times are fixed the same way.<br>**Smoke:** 59.6 → `1:00`, 119.5 → `2:00`, 59.4 → `0:59`, 3599.6 → `60:00`, null → `—`. |
| 7 | MINOR | **FIXED** | **Report counts:** now correct. `main` has 163 tests and the branch 194, so WP11 adds 31 tests in 5 files. |
| 8 | MINOR | **FIXED** | **Change:** the latency page loads `../js/common.js` (same origin, still offline-safe and still under its own CSP).<br>**Smoke:**<br>- `copyResult` calls `VtolCommon.copyToClipboard` with "n=3, mean 157 ms, worst 200 ms…"<br>- on failure it shows "Copy blocked — select and copy: …" |
| 9 | MINOR | **Partly fixed, rest disclosed** | **Fixed:**<br>- `packOptions(selId)` and `battSel(role)` are cleaned up.<br>- The Q_ASSIST_ALT "VERIFY …" note renders as an amber `.warn-val`; checked in the smoke test.<br>**Left as disclosed:**<br>- +21 `no-inline-style`<br>- CLEAR PARAM FILE not propagated through import<br>- AUTO VTOL-takeoff counted as transition |

## Contract results

| Contract | Result | Note |
|---|---|---|
| C1 / C1.4 | PASS | Invalid incoming flight and maintenance records can no longer overwrite valid local records. Tombstones are unchanged and still pass. |
| **C1.5** (added by the PM in `56d35e9`, 34 s **after** the rework commit) | **Text needs correcting (PM action)** | **What matches:** the `paramFile` and `battLog[].usedMah` wording matches the implementation.<br>**What differs:** the field names for `flights` and `maintenance`. The implementation and the WP11 report (§5.1) both use the names on the right.<br>- `flights.binSummary` → `logSummary` (it also holds `.tlog` summaries via `kind`)<br>- `flights` also has `label`<br>- `maintenance.item` → `taskId` (`carrier-5`, `carrier-10`, `carrier-25`, `client-5:<clientId>`)<br>- `maintenance.date` → `doneDate`<br>- `maintenance` also has `markedAt`<br><br>The implementer could not have seen C1.5, and no other WP consumes these keys yet. **Recommend correcting C1.5 to the implemented names** when merging; this is not counted against WP11. |
| C2 / C2.1, C4, C5 / C5.1 | PASS | Unchanged from round 1. C4 is now also used by the latency page. |

## Tests run

- `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/` in the worktree → **tests 194, pass 194, fail 0**.
- The new tests exercise the rework: MSG classification, `paramFile` date comparison, 7 malformed flight variants (plus a valid newer record still winning), and maintenance `2026-02-30` / `16.10.2026` rejected.
- **Merge test with current `main`** (`2d70005`; it moved twice since round 1, docs only): in a throw-away clone of `S\repo\vtol-manual`, `git merge wp/11` merged with no conflicts (merge `6a70dc0`). `node --test test/` on the merged tree gives 194 / 194. The clone was deleted. `git diff --check main...HEAD` is clean.

## Smoke tests

- `S\verify\WP11\smoke.js` (the round-1 script) on the rework: 85 / 86. The one failure is the expected new behaviour: my round-1 import record `f2` deliberately held `battIds: [XSS, 5]` and `gcsSummary: [1]`, which are now rejected under finding 3.
- `S\verify\WP11\smoke-r2.js` is the round-1 script with that record made well-formed, plus the round-2 checks. Log: `S\verify\WP11\smoke-r2.log`. Result: **103 pass, 0 fail, 0 script errors.**
- It still covers every round-1 feature and regression:
  - params, `.bin`, GCS session, flights, maintenance, challenge–response, a11y, weather
  - XSS in every imported string
  - WP01/WP05: expiry, Link "GCS APP NOT RUNNING", emergency modal, profiles, invalid-pack import
  - the latency page
- It adds the checks listed under findings 1–8.

**html-validate:**

| Page | `main` | this branch |
|---|---|---|
| `index.html` | no-implicit-button-type 31, no-inline-style 74, prefer-tbody 1 | 31, **95**, 1 |
| `tools/latency-clock.html` | — | no-inline-style 2 |

The one extra inline style versus round 1 is the new authorisation line.

## Findings (remaining)

1. **MINOR — `index.html`: inline styles.** +21 `no-inline-style` in new static markup, following the page's existing style. Disclosed.
2. **MINOR — `js/store.js`: CLEAR is not propagated.** `paramFile` has no tombstone, so CLEAR PARAM FILE does not travel through import. Disclosed in the report and in C1.5.
3. **MINOR — `js/tools-core.js` `binAnalyze`: AUTO takeoff phase.** A forward transition into AUTO (VTOL_TAKEOFF) counts the VTOL climb as "transition". Disclosed in the UI note.
4. **MINOR — `js/tools-core.js:642` `MSG_WARN`: matches inside words.** `error` matches inside unrelated words (e.g. "onerror"), and "Failsafe Cleared" is shown as ✖ FAILSAFE. Both are cosmetic.
5. **PM action — `docs/tasks/02-CONTRACTS.md` C1.5:** correct the `flights` and `maintenance` field names as described under Contract results.

## Approval rationale

APPROVED:
- **Blocking issues:** there are zero BLOCKER and zero MAJOR findings.
- **Requirements:** every MUST requirement R1–R10 passes.
- **Round-1 findings:** the round-1 MAJOR is fixed and consistent with plan §1.1, `manual.html` and the checklist. All round-1 MINOR findings 2–8 are fixed and verified by my own reproductions.
- **Tests and merge:** the 194 unit tests and my 103-check smoke test pass, and the branch merges cleanly into current `main`.
- **Remaining items:** only MINOR items remain, plus the C1.5 text correction for the PM.
