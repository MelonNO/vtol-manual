# WP05 verification — round 2
VERDICT: APPROVED

Branch `wp/05`, rework commit `e9533fa` (on top of `d91701b`). Current `main` = `4efbc3c`, which adds the PM's contracts C2.1 and C5.1 and the plan §13.1 correction for `Q_TRANS_FAIL_ACT`. Verifier: independent agent; no code changed.

## Scope of the rework (`git diff d91701b e9533fa --stat`)

| File | Judgement |
|---|---|
| `data/content.js`, `js/render-content.js`, `index.html`, `test/content/*.test.js`, report | Owned |
| `js/store.js`, `test/tools/store.test.js` | R11 / F5 (validation) — allowed |
| `js/tools-core.js`, `test/tools/checklist.test.js` | Removes `clMigrateLegacy` and its test only (F9, requested by the PM). Accepted. |

## Requirement results (round 2)

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | unchanged | — |
| R2 | **PASS** (round 1 FAIL fixed) | `data/content.js:247-265` (F1), `:281-297`, `:339` (F8) | See the F1 and F8 detail below. The failsafe intent is unchanged and correct. There are no invented numbers, and the forbidden-terms grep is clean (0 hits). |
| R3 | PASS | unchanged | — |
| R4 | PASS | `[[VERIFY — …]]` renders amber like TBD (no raw `[[ ]]` in the visible page; jsdom) | — |
| R5 | PASS | unchanged | — |
| R6 | PASS | `index.html:1173-1195` (F6), `js/store.js:126-133` (F5) | — |
| R7 | PASS | `js/render-content.js:361-364`: `app.start_path` shows NORMAL / an amber **RESUME (CLIENT AIRBORNE)** badge / —, escaped | Conforms to C2.1. `linkOnAlarm` already honours `active:false`. |
| R8 | PASS | `camera-sortie` rule `js/render-content.js:249-262`; items `:105`, `:138` | — |
| R9 | PASS | New tests F1, F8, F2/F3/F7, `start_path`, F4 and F5 cases | — |
| R10 | PASS | html-validate is unchanged from round 1 (31 / 74 / 1, no new rules); swipe and expiry regressions pass | — |
| R11a–d | PASS | unchanged | The F5 change only adds stricter import/form rejection. |

## F1 — GCS App / Controller card (`emerg-app`), re-read in full

Rendered in the Tools modal (jsdom):
- **Summary:** the app never resumes by itself. There are two start paths: normal start (client on the ground) and RESUME (client airborne).
- **IMMEDIATE (6):**
  1. CLIENT FAILSAFE FIRES — BRIDGE SILENT
  2. FPV PILOT: HANDS OFF
  3. CARRIER: HOLD ORBIT
  4. **CLIENT AIRBORNE: NEVER NORMAL START**
  5. **TAKE OVER ONLY BY RESUME — ARM SWITCH ARMED**
  6. WATCH VIDEO / OSD
- **CLEAN-UP:**
  - The chain; then:
  - "Client AIRBORNE: **never use the normal start** … its first packet would disarm the client in mid-air. The only way back is **RESUME (client airborne)**: hold the arm switch ARMED, check the live arm/throttle preview, type `RESUME` — and `THROTTLE` as well if the throttle is at minimum."
  - "Use RESUME only if taking over is safer than letting the client's own failsafe finish. Otherwise leave the app stopped until the client is on the ground."
  - "Client on the GROUND (disarmed): normal start — arm switch DISARMED, throttle low."
  - MP is separate; after-landing checks.

**Result: PASS.**
- The normal start is given only for a client on the ground. RESUME (arm switch ARMED, typed `RESUME`/`THROTTLE` confirmations) is given for an airborne client.
- DISARMED never appears as an instruction for an airborne client. I checked the content strings (implementer's test) and all rendered texts (my jsdom check).
- It matches WP08a `gcs/README.md` rule 3 and C2.1 ("Pages and the manual must describe this path").
- The new content test (`content.test.js` "WP05 rework F1") is meaningful. It checks that every "airborne" string points to RESUME/NEVER, that "airborne + DISARMED" appears only next to "never" across all content, and that the RESUME line names ARMED, `RESUME` and `THROTTLE`.

## F8 — Transition failure (`Q_TRANS_FAIL_ACT`)

- **Failsafe row `fs-trans`:** "`Q_TRANS_FAIL_ACT` = 0 → **QLAND at current position** (ArduPlane source: -1 warn only, 0 QLand, 1 QRTL; amber **VERIFY — against the firmware version in use**)". Pilot column: "Switch to QHOVER and climb (emergency card); if QLand has started, clear the area below". No "→ QHOVER" remains (test plus my check).
- **Transition card:**
  - The summary (manual, full card) and clean-up step 1 (also visible in the compact Tools modal) say "QLAND at the current position — not QHOVER", each with an amber VERIFY marker.
  - **IMMEDIATE:** 1 QHOVER — switch now · 2 GAIN ALTITUDE — full VTOL power · 3 NO ACTION BY 4 s → AUTO QLAND HERE (QLAND mode badge) · 4 HOLD — assess before any retry.
- **The pilot's immediate action is still sensible.** QHOVER plus climb comes first and ends the transition attempt before the 4 s auto-action. The new item tells the pilot what happens if they do not act.
- The source is the PM-verified plan §13.1 row (on `main`). The value 0 is from the existing manual.

## Minor fixes from round 1

| Finding | Result | Evidence |
|---|---|---|
| F2 Video 10 s vs N s | FIXED | Clean-up: "Decision time: the 10 s wait above (current procedure value). Video-board restart / recovery time: TBD — measure, then review the 10 s." This gives the pilot one rule. |
| F3 Relay PCB | FIXED | "…does not pass through the relay PCB (plan §3.1). If MP telemetry also drops → SIYI / GCS LOSS card." |
| F4 Camera hint | FIXED | `camera-sortie` gives: mismatch → ✗; OFF/OFF → ✓; ON/ON in `carrier_only` → ✓; ON/ON otherwise → `?`. jsdom checked all four. |
| F5 Pack capacity / cycles | FIXED | Form: −5 mAh → "not saved — check: CAPACITY (mAh)"; −1 cycles → rejected; empty capacity = TBD and saves. Import drops the record. Load still coerces. |
| F6 Delete active client | FIXED | The confirmation ends "The active client becomes: "Reference client #1 (copy)"", and exactly that client becomes active. Deleting the last client → "none (TBD in checklists)", and the doc-id shows ELRS TBD. |
| F7 S-02b | FIXED | SIYI card clean-up and the pre-flight `gs-mp-connect` note: no other program may send MAVLink as GCS sysid 255. |
| F9 `clMigrateLegacy` | FIXED | Removed from `js/tools-core.js` (function and export) and its test. It is `undefined` in the page, and `git grep` finds nothing. |
| F10 Contracts | DONE by PM | C2.1 and C5.1 are on `main` and match the implementation (`camera-sortie`, `[[VERIFY]]`, `validateRecord`/`FIELDS`, `telemetryRatio` = N). |

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"; cd S/wt/WP05; node --test test/
ℹ tests 136  ℹ pass 136  ℹ fail 0

git -C S/repo/vtol-manual merge-tree --write-tree main wp/05   → clean (main = 4efbc3c)
merged tree (git archive of the merge result): node --test test/ → 136/136 pass

npx --prefix S/jsenv html-validate index.html → no-implicit-button-type 31, no-inline-style 74, prefer-tbody 1 (same as round 1; main 41/72/1)
forbidden-terms grep over index.html, data/, js/ → 0 hits
```

## Smoke tests (what you loaded/clicked + result)

- **`S\verify\WP05\smoke.js`** (the full round-1 regression): **99 pass, 0 fail**, on both the worktree and the merged tree (log `smoke-r2.log`). It covers:
  - checklists from data, ticks with `ts`, persistence, GO
  - legacy and untimed clearing, expiry
  - the emergency modal and pills
  - the swipe rules
  - profile CRUD with XSS in names
  - import drop rules
  - the Link tab with a failing or absent `fetch`, and with a stub `GcsClient` fed a C2 sample
  - AUTO hints, the audio cue, no script errors
- **`S\verify\WP05\smoke-r2.js`** (the rework checks): **31 pass, 0 fail**, on both the worktree and the merged tree (log `smoke-r2-rework.log`). It covers:
  - the F1 card text, immediate count ≤ 6, and that no rendered text pairs airborne with DISARMED without "never"
  - the F8 immediate order, the QLAND badge, the amber VERIFY in the compact modal, the `fs-trans` row and the full-card summary
  - no raw `[[ ]]` in the visible page
  - F2, F3 and F7 texts
  - `start_path`: RESUME amber badge, NORMAL, escaped
  - the camera-sortie hints in 4 cases
  - F5 form rejections
  - F6 named replacement and the last-client → TBD case
  - `clMigrateLegacy` removed
  - no script errors

## Findings (round 2)

No BLOCKER and no MAJOR findings. Optional MINOR notes for the PM or owner:

1. **MINOR — `data/content.js` `emerg-app` immediate 5:** "TAKE OVER ONLY BY RESUME — ARM SWITCH ARMED" may read as a prompt to take over. The clean-up qualifies it correctly ("only if taking over is safer…, otherwise leave the app stopped"), and §6.1.8's default is not to restart mid-recovery. A wording such as "IF TAKING OVER: RESUME ONLY — ARM SWITCH ARMED" would keep that bias in the memory items. Optional.
2. **MINOR — transition card clean-up step 1:** "if QLand has started … switch to QHOVER only if that spot is unsafe" sits next to the memory item "QHOVER — switch now". The two are consistent in sequence (the memory item applies before the 4 s auto-action). The owner may want to confirm the preferred action once QLand is already under way. Optional.
3. **Carried over from round 1, unchanged and disclosed:**
   - the static header "CRIT VOLT 22.2V" and the "22.8V" storage text
   - the manual's 2 s vs 3 s airspeed-build inconsistency
   - the existing dark tint colours in the CSS

## Approval rationale

**APPROVED.**
- The round-1 MAJOR finding F1 is fixed: the card now says normal start for a client on the ground, RESUME (arm switch ARMED, typed confirmations) for an airborne client, and never DISARMED for an airborne client. Tests cover it.
- F8 is corrected to QLand at the current position, with a visible VERIFY marker, and the immediate QHOVER/climb action is kept.
- Every minor finding from round 1 is fixed.
- All MUST requirements pass, and every test passes on the merged tree. The branch merges cleanly into current `main`.
- The implementation report's "Rework round 1" section matches what I observed.
