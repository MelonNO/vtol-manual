# WP28 verification — round 2
VERDICT: APPROVED

Worktree `S/wt/WP28`, branch `wp/28`, HEAD aed0da7 ("rework round 1"), base `main`. Round 1: `VERIFY-round1.md`
(REJECTED for F1). Scripts: `S/verify/WP28/` (mutate.sh, deepdiff.js → deepdiff2.txt, fix-main.json / fix-head.json,
fs.js, deeplink.js, shots/r2/).

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| F1 (MAJOR, round 1) safety lock | PASS | `test/content/safety-lock.js` (immediate / cleanup exact text, list lengths in `structure`, per-position tokens incl. empty), `wp28-safety-lock.test.js` (`diff` compares JSON, so missing ≠ `[]`; m7–m12 + count asserts) | All my source-level mutations now fail the lock (table below). The claims in the code comment and report match the behaviour. |
| Fixture provenance | PASS | regenerated with the HEAD extractor from main's `data/content.js` (`fix-main.json`) vs committed fixture (`fix-head.json`) | `immediate`: identical to main (0 diffs, byte for byte). `tokens`: identical. `structure`: 152/152 entries, one difference (`pf-immediate style=accent steps=4` → `pf-immediate steps=4`). `cleanup`: exactly the 11 reworded steps (emerg-video #4, emerg-camera #4, emerg-trans #2–#7, emerg-batt #5–#7). Exactly what the report says. |
| 11 clean-up rewordings | PASS | listed in "Smoke tests" | Each read: same action, same numbers/modes/ports, no warning weakened ("Do not retry without airspeed data", "Quarantine it and do not charge it", "at least 30 minutes", "Before a retry: first climb to 60m+ … clear a 300m corridor … Watch the airspeed immediately on AUTO"). |
| Qualifier sweep (PM) | PASS (one MINOR) | own sweep of all 79 changed strings, main vs HEAD, for normally / usually / only / never / until / unless / at least / minimum / immediately / first / must / all / before / after / not / no / do not / always / if / every / any / within / safely / correct / … | No loss of only, never, until, unless, must, all, before, after, not, do not, always, first, immediately. Restored as required: "normally OFF", "Must show a live picture" (×2), "immediately" (×2), "all systems power down", "before transport", "first … immediately on AUTO". Remaining drops are equivalent rephrasings: verify/confirm/check (items are checks by definition, now stated as criteria), "If no co-pilot" → "Without a co-pilot", "if telemetry is enabled" → "when telemetry is on", "minimum" → "at least", "If any present" → question form. Only open item: `pf-hm30-off` lost "safely" (Finding 1, MINOR). |
| Abort anchor alias | PASS | `manual.html:2277-2281`; jsdom test in `wp28-components.test.js`; own `deeplink.js` | `#callouts/callouts-sec-6` → tab opens and scrolls to `co-abort-calls`; hash rewritten. Exact-key lookup with `hasOwnProperty`; other anchors unaffected (`#callouts/co-recovery` still scrolls to `co-recovery`). Three lines, no side effects. |
| Inline-style wording | PASS | report §1 line 15, CHANGELOG line 49 | Both now say "no inline styles except the intended `style="--sec:#hex"` custom property". |
| 04 §3 checks, safety tokens, data-fs | PASS | below | |

## Contract results

Unchanged from round 1 (C5 shape kept; renderer contracts unchanged). The rework touches only `data/content.js` text,
the lock test files, the fixture, three lines of `manual.html` script, CHANGELOG, the report and `sw-precache.js`.

## Tests run (commands + results)

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                               → tests 374, pass 374, fail 0
node scripts/gen-precache.mjs --check           → up to date (61 assets)
node scripts/diagrams/build.js --check          → up to date
node scripts/gen-params-reference.mjs --check   → up to date
check-links / check-images / check-colours      → pass
html-validate index.html manual.html relay/map.html tools/latency-clock.html docs/design/styleguide.html → 0 findings
safety-tokens.py --git S/wt/WP28 main: data/content.js 485/485, manual.html 1457/1457, index.html 45/45,
  relay/map.html 35/35 — LOST 0, NEW 0 each
```

## Smoke tests (what you loaded/clicked + result)

- **Lock mutations** (real edits of `data/content.js` in an export of HEAD, then the lock test):
  drop "CLEAR AREA BELOW" → fail · swap "FPV PILOT: HANDS OFF"/"CARRIER: HOLD ORBIT" → fail · drop a clean-up step
  (emerg-batt "Let the pack cool…") → fail · add an IMMEDIATE step → fail · remove checklist item `site-lz` → fail ·
  edit IMMEDIATE text ("HOLD ORBIT" → "LAND IMMEDIATELY") → fail · edit clean-up text → fail · WAIT 10→20 SECONDS →
  fail · RTL→QLAND in a checklist → fail · drop a TBD → fail · edit a 915 close-in step → fail · drop post-flight step
  `pf-mp-close` → fail · wording-only change in a checklist `t` → pass (as intended).
- **data-fs** with `test/fixtures/sample.param`: DISABLED 31 (main 31), per-element output identical to main, no errors.
- **Screenshots** (`shots/r2/`): Tools pre-flight 390 with an item expanded (sentence-case sections, red EMERGENCY
  bar above the bottom nav, rows clear), manual emergency 390 (pills, plain design-intent card, IMMEDIATE list). No
  change from round 1, no regression.

## Findings

1. **MINOR** — `data/content.js` `pf-hm30-off`.t: "Remove mast battery safely." → "remove the mast battery." The word
   "safely" was dropped and is not listed in the report's qualifier table. It names no procedure, so it is not a
   safety change, but restoring it ("remove the mast battery safely") would make the qualifier sweep complete.
2. **MINOR** — `test/content/safety-lock.js:17` comment says the only justified difference from main is
   `pf-immediate` without `style=accent`; the fixture's `cleanup` part also holds the 11 reworded clean-up steps (as the
   report states correctly). Adjust the comment.
3. Round-1 MINORs 2–4 resolved; MINOR 5 (removed `style` key) accepted.

## Approval rationale

Round-1 MAJOR F1 is fixed: the lock now freezes IMMEDIATE and clean-up text, order and count, and every list length.
I tested this with independent mutations, and the fixture matches main exactly except for the justified differences.
The required qualifiers are restored, and the old anchor alias is minimal and tested. All checks pass, safety tokens
are unchanged, and the DISABLED count is 31. No BLOCKER or MAJOR findings remain, and every MUST passes. The two
MINORs are optional.
