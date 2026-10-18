# WP19 — GCS test follow-ups (M-18): implementation report

Branch `wp/19` (from `main` 786acae) · Date 2026-10-18 · Contracts unchanged

`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.
My tools and logs are in `S\wp19\`.

## 1. Summary

- **R1, rate-limit test.** `test_rate_limit_refuses_the_excess_with_a_warning` is now exact.
  - `ControlServer` takes a `rate_clock` (default `perf_counter`) for its per-connection token bucket. This is the
    one product change. The test drives the bucket with a fake clock: exactly 5 commands run, 10 are refused with the
    warning, and each refusal's 50 ms pause is recorded (plus a real-time lower bound).
  - The UI-load test now runs 10 s of 30/s load on the same fake clock. The old version sent 45 commands, which is
    fewer than the burst of 50, so it could not have failed at all.
- **R1, other timing tests.** I scanned all of `gcs/tests` and fixed three more few-ms margins:
  - the e2e FAILSAFE timing;
  - the sender's rate upper bound;
  - `monotonic` in the server-budget test.
  - The other timing-sensitive tests are listed with their margins (§4).
  - 150/150 isolated repeats under 4-CPU affinity passed.
- **M-15 is closed: two known candidates, both now fixed, and which one caused WP10's failure cannot be told** (§5,
  corrected in round 2).
  - WP17's stalled-handshake race.
  - This rate-limit test.

  Both existed in race-prone form at WP10, and both later failed in full local runs.
- **R2, design (b).** After a teardown `TestTimeout`, the conftest runs the finalisers pytest skipped and finishes
  the teardown, so later tests get fresh fixtures. If pytest's internals are not as expected, it takes the hard exit
  instead.
  - Self-test: a module-scoped hanging teardown and a function-scoped one with `monkeypatch`. Both failed before the
    fix: a stale fixture `serial 2 (was 2)`, and a `monkeypatch` that was never undone.
- **R3, bounds.** The worst case per hanging test is **190 s** (watchdog hard exit) and **200 s** with the GIL held.
  It is recomputed from the code (`worst_case_s()`) and stated in the header line, the conftest docstring and
  `gcs/README.md`. It fits the workflow step timeouts.
- **R4.** All green: CI mode ×2, 1 desktop run, node, workflows, every check (§6).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 deterministic rate-limit test | DONE | `gcs/vtolgcs/control.py:377,385,392,531`; `gcs/tests/test_control.py:562` `_FakeClock`, `:572`, `:607` | Security property kept: excess refused (not executed), warning logged, refusals paced (≥ 1 token interval, recorded per request, plus a wall-clock lower bound), the connection stays usable, UI load never limited. Mutations caught: no pause, refused commands executed, bucket ignoring the clock, limit 25/s |
| R1 scan of other tests | DONE | Fixed: `test_runtime_e2e.py:154-170`, `test_sender.py:530-544`, `test_control.py:685` (+ the two above). Listed: §4 | — |
| R1 stability | DONE | `S\wp19\r1\SUMMARY.txt` (150 logs beside it) | 5 tests × 30 isolated pytest processes, `VTOLGCS_TEST_CPUS=4`: **0 failures** |
| R1 M-15 | DONE | `docs/relay/OPEN-ITEMS.md` M-15 | CLOSED. Two known candidates (WP17's stalled handshakes, this rate-limit test), both fixed; which one failed in WP10 cannot be told (round 2) |
| R2 stale fixtures | DONE, option (b) | `gcs/conftest.py:802` `_finaliser_lists`, `:824` `_finish_teardown`, `:642-652` `_in_phase(on_timeout=…)`, `:993` teardown hook, `:629` `_hard_exit` | Self-test `test_test_guards.py:674` (fails on the old conftest, passes now); the fallback path probed by hand (§7) |
| R3 bounds | DONE | `conftest.py:34` docstring, `:680` `worst_case_s`, `:912-918` header; `gcs/README.md` watchdog row and "Time bounds (WP19)" | Header: `… a teardown gets 30 s more, hard exit 20 s after the timeout or that budget, faulthandler backstop 10 s after the hard exit; worst case per hanging test 190 s (200 s with the GIL held)`. Tests: `test_test_guards.py:696` (190/200 with the defaults, docstring and README agree), the R2 self-test checks the header with its own settings (20 / 30 s) |
| R4 all green | DONE | §6 | M-18 CLOSED |

## 3. Placeholders

None.

## 4. R1: timing-sensitive tests in `gcs/tests`

**Fixed (now load-independent):**

| Test | Before | Now |
|---|---|---|
| `test_control.py::test_rate_limit_refuses_the_excess_with_a_warning` | `13 ≤ 20·elapsed + 1` with 12 × 50 ms pauses: ≈ 10 ms margin, `monotonic` (15.6 ms ticks) | Fake clock: exact counts, recorded pauses |
| `test_control.py::test_ui_load_is_never_rate_limited` | 45 commands < burst 50: could not fail | Fake clock: 300 at 30/s + 30 at once; static `RATE_LIMIT_PER_S > 30` |
| `test_control.py::test_server_budget_bounds_the_work_of_many_connections` | upper bound with `monotonic` (up to 1.6 tokens of the +4 slack lost to ticks) | `perf_counter`: the token-bucket bound is exact, +4 slack |
| `test_runtime_e2e.py::test_run_rtt_telemetry_camera_and_failsafe` | `t_fs − t_stop ≥ 0.24` and `observed_ms ≥ 240`: 6–10 ms margin on how promptly the sender and the test thread ran around the stop | `t_fs − last valid rc_up > T_hold` (the bridge's own clock), that rc_up is the GCS's last seq, `observed_ms ≥ (t_fs − t_after_stop)·1000` (all `perf_counter`, one process) |
| `test_sender.py::test_thread_rate_absolute_deadlines_and_stop` | `n ≤ 320` after `sleep(1.2)`: 80 ms of late wake-up of the test thread failed it | `n ≤ 250·measured span + 3` (absolute deadlines; at most 2 catch-up slots, +1) |

**Listed, not changed.** These are lower bounds on a real thread's rate, or upper bounds on latency. The margins are
wide, and they are the property under test:

| Test | Bound | Margin |
|---|---|---|
| `test_sender.py:540` thread rate | `n ≥ 200` in 1.2 s | ≈ 400 ms of sender stalls |
| `test_sender.py:549` thread rate | rate within ±15 % over the span | ≈ 180 ms of stalls |
| `test_ui.py:462` sender after the UI died | > 150 packets in 1.0 s | ≈ 400 ms |
| `test_runtime_e2e.py:474` console keys | > 40 packets in 0.3 s | ≈ 140 ms |
| `test_runtime_e2e.py:188` controller disconnect | detected < 2.0 s | ≈ 2 s (normally 4 ms) |
| `test_control.py:519` stalled handshake | 2nd client served < 4.0 s (handshake timeout 5 s) | ≈ 4 s |
| `test_control.py:699` server budget | every connection served at least once in 1.5 s | a flood thread starved for 1.5 s |
| `test_timing_win.py:29,37` | lateness < 250 ms; a past deadline returns < 250 ms | ≈ 249 ms |
| `test_bridge_sim.py:679` fake video | 100–500 kB in 1.0 s (≈ 250 kB) | ≈ 600 ms of sim stalls |
| `test_bridge_sim.py:604` status rate | 5–20 Hz (10 Hz) | ×2 |
| `test_bridge_sim.py:554` | FAILSAFE < 2.0 s after the last RUN | ≈ 1.75 s |
| `test_video.py:149` helper process | 20 packets within its `--run-seconds 2.5` | ≈ 2.3 s |
| `test_main_cli.py:403,455,468` (interactive only) | > 100 in 0.8 s; > 80 in 0.5 s; stop < 100 ms and < 25 packets | ≈ 400 ms; ≈ 180 ms; ≈ 95 ms |

**Short sleeps that are not synchronisation risks:**
- **Absence checks** (`sleep(0.2–0.8)`, then "nothing was sent / nothing changed"; `test_control`, `test_runtime_e2e`,
  `test_bridge_sim`, `test_main_cli`). They cannot fail because the machine is busy. They can only miss a late event.
- **Sleeps that are lower bounds by construction.** The `sleep(0.1)` "past BOOT" in `test_bridge_sim.py:532` and the
  e2e harness: `boot_s` is 0.05 s on the sim's `perf_counter`, and a sleep is never short. The `sleep(0.02)` in
  `test_runtime_e2e.py:434` against a 1 ms cache age.
- **Polling loops** with generous deadlines (`expect`, `_wait`, `_wait_for`: 5–20 s).

## 5. M-15 (corrected in round 2, verify F1)

In round 1 I wrote that the rate-limit test was "the only test seen failing in a full local run since WP10". That
is false: WP17 saw another one. There are **two known candidates** for WP10's unidentified "1 failed, 681 passed".
Both were present in race-prone form at WP10 R10b (32b73f5), and both are fixed now:

| Candidate | Evidence | Fixed |
|---|---|---|
| `test_control.py::test_many_stalled_handshakes_time_out_and_free_their_slots` | Failed once in WP17's full CI-like local run (WP17-IMPLEMENTATION §1, R4 c), and 1 time in 50 isolated runs before the fix (round 3: corrected from "2 in about 51", which counted that full run twice). Race: a slot is freed just after its failure is counted. Its pre-fix form is in 32b73f5 | WP17 (331732c): 0 in 50 after the fix |
| `test_control.py::test_rate_limit_refuses_the_excess_with_a_warning` | Failed once in the WP18 verifier's desktop run. Its margin was zero by construction: 12 server pauses of ≥ 50 ms give an elapsed time of ≈ 0.60 s, and the assertion needs `13 ≤ 20·elapsed + 1`. The slack was 9–13 ms against a 15.6 ms clock. It was added in WP13 (3244ff5) and is byte-identical in 32b73f5 | WP19: exact on a fake clock, 0 in 30 isolated repeats under 4-CPU affinity, of both the round-1 and the final (round-2) form |

**Verdict.** Either one could be WP10's failure, and which one cannot be told, because the WP10 test id was never
kept. The row stays CLOSED because both known candidates are fixed (as are two more few-ms margins, §4), and
nothing known is left open. If a full-suite failure recurs, the WP18 `+++ FAILED` line names it, and a new row
should be opened for that test.

## 6. R2 design choice: (b), finish the teardown

**Why not (a), a hard exit.**
- It would end the whole session at the first teardown that outlives its budget.
- In the ×5 CI step that also hides every later failure in that run.
- WP17 and WP18 deliberately made interruptible hangs "fail and go on".

**Why not plain invalidation.** Marking the fixtures stale, or making them raise, would leave their finalisers
unrun. That means `monkeypatch` patches stay applied and module resources stay live. It would also make a
function-scoped fixture fail in every later test.

**What the conftest does.** `pytest_runtest_teardown` keeps references to pytest's per-node finaliser lists before
the teardown. pytest pops from these same lists. When the hook raises after the watchdog raised `TestTimeout` in
that teardown, `_finish_teardown`:
1. runs what is left in the interrupted node's list, innermost first, collecting errors like pytest does;
2. calls `teardown_exact(nextitem)` for the nodes pytest did not reach, e.g. the module when the next test is in
   another module;
3. resets every fixture of the test whose `cached_result` survived although its scope node is gone. This is the
   safety net for a finaliser lost between pop and call.

It prints `+++ TIMEOUT: <id>: its teardown was interrupted after its budget: ran the N finaliser(s) pytest skipped
and finished its teardown; …`, and adds the same text as a note to the teardown ERROR. The leak check runs after it.

**Bounded.** Everything runs inside the teardown phase, under the watchdog's existing hard exit (grace after the
budget), so a second hang in a skipped finaliser ends at the same 190 s.

**Fallback.** If the finaliser lists or `_setupstate` are missing (a future pytest), it takes the hard exit with a
message naming the test and the reason, so a stale fixture can never reach a later test.

**Relies on pytest internals.** `Session._setupstate.stack`, `SetupState.teardown_exact`, and
`FixtureDef.cached_result` / `_finalizers` / `scope`. These were read from pytest 9.1.1 (`runner.py:551`,
`fixtures.py:1146-1210`).

Coverage, corrected in round 2 (verify F2):
- In round 1, the fallback covered only **structural** changes, where attributes are missing.
- Since round 2, the recovery runs only on a pytest release listed in `PYTEST_VERIFIED`, currently (9, 1). Any
  other release takes the hard exit, the header warns, and a self-test fails, asking for re-verification.
- A behaviour change **within** a listed release is not detected by the conftest. The R2 self-test catches it on
  the release CI installs: it asserts fresh fixtures, plus every finaliser exactly once.

See Round 2.

## 7. Tests and results

| Run | Command / context | Result |
|---|---|---|
| R1 repeats | `S\wp19\r1_repeat.py 30`: each test in its own pytest process, `VTOLGCS_TEST_CPUS=4` (the header line checked in every log) | rate limit 30/30 · UI load 30/30 · server budget 30/30 · e2e FAILSAFE 30/30 · sender rate 30/30 (`S\wp19\r1\SUMMARY.txt`) |
| R2 before/after | the new self-test on the **old** conftest | failed: `stale module fixture: serial 2 (was 2)`; `test_next_test_gets_a_fresh_monkeypatch` FAILED |
| | on the new conftest | `4 passed, 2 errors` as intended, the run goes on, 8.5 s |
| R2 fallback (by hand) | a copy of the conftest with `_setupstate` renamed (`S\wp19\probe\fallback`) | `… the finalisers pytest skipped cannot be found (…): hard exit (status 1) …`, stacks, exit 1, `test_b_next` never ran |
| Mutations (R1) | `S\wp19\mut1`, `mut2` (copies) | no refusal pause → FAIL; refused commands executed → FAIL; bucket ignores the clock → 2 FAIL; limit 25/s → FAIL (after strengthening the UI-load test; the first version missed it) |
| CI mode ×2 | `S\wp19\run.py <wt> <log> ci`: real Python 3.12, `CI=true GITHUB_ACTIONS=true`, stdin NUL, the gcs-build flags | **697 passed, 7 deselected**, 138.2 s / 137.4 s, exit 0, no LEAKED / TIMEOUT / FAILED / INTERNALERROR line, no process left (`S\wp19\ci1`, `ci2`) |
| Desktop (the one allowed) | `run.py … normal` (venv, interactive tests RUN, WinSta0 session 1) | **702 passed, 2 skipped** (UI smoke needs `VTOLGCS_UI_SMOKE`), 161.5 s, exit 0, clean (`S\wp19\desktop`) |
| Node | `VTOL_JSDOM=S\jsenv\node_modules\jsdom VTOL_PYTHON=<venv> node --test test/` | 310 pass, 0 fail, 0 skipped |
| Workflows | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv> node --test test/ci/workflows.test.js` | 7/7 |
| Checks | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0 |

New tests:
- `test_test_guards.py::test_a_hung_teardown_leaves_no_stale_fixture_for_later_tests` (R2, R3 header);
- `test_test_guards.py::test_the_documented_worst_case_per_hanging_test` (R3).

The counts are WP18's 695 + these 2 = 697.

## 8. R3: the bound, recomputed from the code

These are the facts from `_Watchdog._run`, measured from the test's start (T 120, G 20, B 30, M 10):
- The watchdog fires at T.
- The hard exit starts at T + G.
- A teardown seen by the watchdog moves the hard exit to `max(start, T) + B + G`.
- A teardown can only start before the current hard exit, i.e. before T + G. The latest case is when pytest
  formatted the failure for almost the grace after the timeout.

So:
- `TestTimeout` comes at most at T + G + B = **170 s**.
- The hard exit comes at most at T + 2G + B = **190 s**.
- The faulthandler backstop is re-armed at the hard exit + M = **200 s**. A GIL hang that starts before the watchdog
  saw the teardown keeps the earlier backstop at T + G + M = 150 s.
- R2's extra finalisers run under the same hard exit.

The verifier's measured worst case, 16.03 s with T 2 / G 4 / B 8, is within the formula's 18 s.

Against the workflow step timeouts (the arithmetic is also in `gcs/README.md`):

| Step | Timeout | One hanging test per run | Fits |
|---|---|---|---|
| `ci.yml` ×5 | 35 min | 5 × (130 + 200 + 5) ≈ 1675 s ≈ 28 min | Yes, about 7 min to spare, as long as one full run stays ≤ ≈ 215 s |
| `ci.yml` ×5, with an exit-guard hang too | 35 min | 5 × (130 + 170 + 80 + 5) ≈ 1925 s | Yes |
| `ci.yml` ×5, two hangs in every run | 35 min | — | **No.** The step times out, and the logs are still uploaded (the job timeout is 45 min) |
| `gcs-build.yml` | 15 min | 330 s | Yes, up to 3 hanging tests |

I did not change the workflows (not my files). The README and this report carry the arithmetic.

## 9. Deviations / notes for the PM

1. **Product change: one.** `ControlServer.__init__` takes `rate_clock: Callable[[], float] = time.perf_counter`
   and passes it to each connection's `RateLimit`. The default behaviour is unchanged.
   - `RateLimit` already accepted a clock, but the server did not pass one through.
   - The server-wide budget stays on the real clock.
2. **Tests outside `test_control.py`** (`test_runtime_e2e.py`, `test_sender.py`) were changed under R1's "fix them".
   They are in `gcs/tests/**`.
3. **R2 uses private pytest attributes**, with a hard-exit fallback (§6). A pytest upgrade should rerun
   `test_a_hung_teardown_leaves_no_stale_fixture_for_later_tests`.
4. **What remains open.** The listed margins in §4 are wide, but they are still real-time bounds. A runner much slower
   than today's (≈ 130 s per full run) could still fail one of them. The WP18 `+++ FAILED` lines would name it.
5. **Processes.** I stopped no process. Every run ended by itself, and `run.py` found no Python process left. No
   elevation, no network writes, no pushes. There was 1 desktop run. Affinity was set only on my own test
   processes.
6. **A minor slip.** The check commands' scratch output went to Git Bash's `/tmp/wp19c.txt` instead of `S`.

## 10. Notes for the verifier

- **R1:**
  - `python -m pytest gcs/tests/test_control.py -k "rate_limit or ui_load" -v`.
  - Mutations: in a copy, set `if pause:` in `_serve` to `if False:`, then check that the rate test fails.
  - Repeats: `S\venv\Scripts\python.exe S\wp19\r1_repeat.py 30` (≈ 4 min).
- **R2:**
  - The self-test above.
  - To see the old behaviour, copy `git show 786acae:gcs/conftest.py` over the copy's conftest and rerun the
    self-test: it fails with the stale serial.
  - The verifier's round-2 probe B-loop, with `outer_busy`, should now show a fresh instance in the next test.
- **R3:** the header line of any run; `worst_case_s()`; `gcs/README.md` "Time bounds (WP19)".

## 11. Round 2: rework after verification round 1

The verifier's findings are in `S\verify\WP19\VERIFY-round1.md`. The code verdict was positive. The rework fixes the
reporting error (F1) and both MINOR findings (F2, F3). Round 2 made no desktop run.

| Finding | Fix | Evidence |
|---|---|---|
| **F1 MAJOR:** M-15 claimed the rate-limit test was "the only test seen failing in a full local run since WP10" | False, and corrected. Two candidates are named with their evidence, and both are fixed. The row stays CLOSED on that basis, and does not single out one cause | `docs/relay/OPEN-ITEMS.md` M-15; this report §1, §2 (R1 M-15 row) and §5 |
| **F2 MINOR:** pytest is unpinned; the guard covered only structural changes | **Chosen: a guard in the conftest, not a pin** (reasons below). See the list after this table | `gcs/conftest.py:808` `PYTEST_VERIFIED`, `:811`, `:855`, header `:938-942`; `test_test_guards.py:715` (exactly once), `:719`; README watchdog row; M-18; §6 |
| **F3 MINOR:** a refused command that ran anyway went unnoticed | The 10 refused commands are now `request_mode fpv`, which would start the RC stream. A spy on `ControlServer.handle` records every executed command. The test asserts `handled == ["request_mode"] * 5`, and that the sender stays idle with `rx_ok == 0`. As a positive control, the same FPV start is accepted once a token is available, and the stream begins | `test_control.py:572-611` (`:602`) |

The F2 guard, in detail:
- **The recovery runs only on verified releases.** `PYTEST_VERIFIED = ((9, 1),)`. On any other pytest release
  `_finish_teardown` takes the hard exit ("cannot be run safely (pytest X is not a release this recovery was
  verified for …)").
- **The header says which applies.** `a teardown interrupted after its budget: the finalisers pytest skipped are run
  (pytest 9.1.1, verified)`, or a WARNING on another release.
- **A self-test forces re-verification.** `test_the_teardown_recovery_was_verified_for_this_pytest` fails with
  "re-verify … then add it to PYTEST_VERIFIED".
- **The R2 self-test now checks run counts.** It asserts that every finaliser ran exactly once. That includes a node
  finaliser that ran before the hang, which would run twice if pytest stopped popping its lists. Before, it only
  checked fresh fixtures.
- **Remaining limit:** a behaviour change within a listed release is caught only by the self-test, on the release CI
  installs. README, M-18 and §6 now state this.

**Why a guard rather than a pin.** (Corrected in round 3. The round-2 reasoning was wrong.)
- Round 2 said the guard costs "one red CI run per new pytest minor release". **That was false.** Without a pin,
  every Windows CI run, and the `gcs-build` test step that gates every tagged GCS release, would have failed from
  the day PyPI published pytest 9.2. They would have stayed red until a developer re-verified and pushed.
- Round 3 pins pytest (PM decision). CI now stays on 9.1.x until someone upgrades on purpose. The guard remains for
  local venvs. See §12.

**Mutations** (fresh copies in `S\wp19\mut3`, `mut4`):

| Mutation | Test | Round 2 result | Round 1 result |
|---|---|---|---|
| refused command executed through `self.handle(req)`, the reply still "refused" | rate | **FAIL** (`handled` list) | passes |
| refused command executed directly through `self._cmd_request_mode(req)` (bypasses the spy) | rate | **FAIL** (sender mode `fpv`) | — |
| finaliser lists copied instead of referenced (= lists not popped in place) | R2 self-test | **FAIL**: `node-fin` ran twice | — |
| `PYTEST_VERIFIED = ((9, 0),)` | R2 self-test + version test | **FAIL** both. The inner run's header shows the WARNING, and the hang takes the hard exit with the reason | — |
| no mutation | — | pass | — |

**Regression (round 2):**

| Run | Result |
|---|---|
| `pytest gcs/tests/test_test_guards.py gcs/tests/test_control.py` | 46 passed |
| CI mode ×1 (`S\wp19\run.py … ci`: real Python, CI env, stdin NUL) | **698 passed, 7 deselected**, 137.0 s, exit 0. No LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR line, no process left. The header shows the verified line (`S\wp19\r2ci\run.txt`) |
| Node with jsdom | 310 pass, 0 fail, 0 skipped |
| Check scripts (all of §7) | all exit 0 |
| `workflows.test.js` | not rerun: workflows untouched |

The counts are round 1's 697 plus the new version test, giving 698. The check output went to `S\wp19\logs\chk.txt`.
I stopped no process. The only background job left after round 1, a `tail -f` log monitor, was stopped by its task
ID.

## 12. Round 3: rework after verification round 2

The verifier's findings are in `S\verify\WP19\VERIFY-round2.md`. The PM decided to pin pytest, and extended my files
to the two workflows, `gcs/pyproject.toml` (the `dev` extra) and `test/ci/**`. Round 3 made no desktop run.

| Item | Fix | Evidence |
|---|---|---|
| **F1 MAJOR / MUST 1:** pin pytest | `"pytest>=9.1,<9.2"` at the three CI install lines and in the `dev` extra. The `PYTEST_VERIFIED` guard stays for local venvs, and its failure message now says what to do. New test `test_the_pytest_pin_and_the_verified_release_agree`: all three CI install lines and the `dev` extra must carry the pin matching the newest `PYTEST_VERIFIED` entry. Mutations: changing one workflow pin alone fails it, and so does adding `(9, 2)` to `PYTEST_VERIFIED` alone (`S\wp19\mut5`). `workflows.test.js` does not assert the install lines; it stays 7/7 | `ci.yml:105,129`, `gcs-build.yml:49`, `gcs/pyproject.toml:14`, `gcs/conftest.py` (`PYTEST_VERIFIED` comment), `test_test_guards.py:742` |
| **MUST 2:** correct §11 | Round 2's "one red CI run per new pytest minor release" was false. Without the pin, every Windows CI run and the `gcs-build` step that gates tagged releases would have stayed red until a developer acted. **With the pin:** a new pytest minor release (9.2+) changes nothing; 9.1.x patch releases are taken automatically (wording corrected in round 4), and CI and the release build stay on 9.1.x until someone upgrades on purpose | §11 "Why a guard rather than a pin" (corrected) |
| **MUST 3:** upgrade procedure in plain language | **Superseded in round 4 (§13): the round-3 order could never succeed.** It ran the teardown self-test before the new release was in `PYTEST_VERIFIED`, and the conftest deliberately refuses its recovery on an unlisted release, so the self-test always failed. The corrected procedure lists the release first | `gcs/README.md` "Upgrading pytest (WP19)", `docs/relay/OPEN-ITEMS.md` M-18 |
| **MUST 4 / Finding 2:** stalled-handshake count | Now "1 time in 50 isolated runs", plus the one failure in WP17's full CI-like run (the round-2 "2 in about 51" counted that run twice) | M-15, §5 |
| **Optional 5 / Note 3:** repeats of the final form | 30 isolated repeats of the round-2 form of the rate-limit test under `VTOLGCS_TEST_CPUS=4`: **30/30 passed** (`S\wp19\r3\`). M-15 and §5 now say the 30-repeat figure holds for both forms | — |

**Regression (round 3):**

| Run | Result |
|---|---|
| `pytest gcs/tests/test_test_guards.py` | 19 passed |
| CI mode ×1 (`S\wp19\run.py … ci`: real Python, CI env, stdin NUL) | **699 passed, 7 deselected**, 137.4 s, exit 0. No LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR line, no process left. The header shows the verified line (`S\wp19\r3ci\run.txt`) |
| Node with jsdom | 310 pass, 0 fail, 0 skipped |
| `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv> node --test test/ci/workflows.test.js` | 7/7 |
| `--check` scripts, `check-links`, `check-images`, `check-colours`, `gen_test_vectors --check`, protocol self-test | all exit 0 |

The count 699 is round 2's 698 plus the pin test.

**Notes:**
- No YAML parser is available offline here, so the edited install lines were not parsed as YAML. They use the
  standard form `run: python -m pip install "pytest>=9.1,<9.2" …` with a trailing ` # comment`, which is a plain
  scalar plus a comment. The first GitHub run will confirm it.
- I stopped no process.

## 13. Round 4: rework after verification round 3

The verifier's findings are in `S\verify\WP19\VERIFY-round3.md`. Round 4 changes documentation only:
`gcs/README.md`, the M-18 row, one test docstring, and this report. No code changed, and no desktop run was made.

| Finding | Fix | Evidence |
|---|---|---|
| **F1 MAJOR:** the round-3 upgrade procedure could never succeed | The steps are reordered, in plain language. See the list after this table | `gcs/README.md` "Upgrading pytest (WP19)"; M-18; §12 MUST 3 row marked superseded |
| **F2 MINOR:** the stale "pytest is not pinned" docstring | `test_the_teardown_recovery_was_verified_for_this_pytest` now says that CI is pinned, so the test passes there. It catches a local venv on another release, and points to the README procedure (list the release first) | `gcs/tests/test_test_guards.py:720` |
| **F3 MINOR:** "a new pytest release changes nothing" was overstated | The text now says: a new **minor** release (9.2+) changes nothing; 9.1.x patch releases are still installed automatically, and the teardown self-test checks them on every CI run | README, M-18, §12 MUST 2 row |

The corrected upgrade procedure:
1. Install the new release in a separate venv. It goes next to the repository folder, so it cannot be committed;
   `.venv-new` would not have been ignored by `.gitignore`.
2. Add the release to `PYTEST_VERIFIED` **first**, and say why: on an unlisted release the conftest deliberately
   refuses its teardown recovery.
3. Run the teardown self-test and the version test. Both must pass.
4. If both pass, raise the four pins in the same change, run the whole suite (it includes the pin/verified drift
   test), and commit everything as one commit.
5. If the self-test fails, undo the `PYTEST_VERIFIED` edit and change nothing else. CI keeps working on the old pin,
   and a developer looks at `_finish_teardown`.

**End-to-end demonstration with a real pytest 9.0.3** (a released version that is not listed, standing in for a
future 9.2, which is not on PyPI yet):
- The venv is throw-away: `S\wp19\upgrade\venv903`, real Python 3.12, `pip install pytest==9.0.3`, later
  `pygame-ce`. That was a PyPI read only.
- The trees are `git archive HEAD` copies in `S\wp19\upgrade\`.

| Order | What was run | Result |
|---|---|---|
| **Round-3 order** (checks before listing) | `pytest gcs/tests/test_test_guards.py -k "stale_fixture or verified_for" -v` on an unchanged copy | **2 failed.** The header says `WARNING pytest 9.0.3 is not verified …`. The self-test fails because the inner run takes the hard exit ("cannot be run safely (pytest 9.0.3 is not a release this recovery was verified for …)"). This reproduces the verifier's finding (`old_order.txt`) |
| **Corrected order**, step 2 | `PYTEST_VERIFIED = ((9, 1), (9, 0))` in the copy's `gcs/conftest.py` | — |
| step 3 | the same two checks | **2 passed.** Header: `… the finalisers pytest skipped are run (pytest 9.0.3, verified)` (`new_order.txt`) |
| step 4 (whole suite) | `pytest gcs protocol` with 9.0.3, interactive tests off | 698 passed, 7 skipped, plus 1 failed: `test_video.py::test_pipelines_match_the_shared_content_file`, `FileNotFoundError` for `data/content.js`, because my extract left out `data/`. With `data/` added, `test_video.py` plus the drift test gave 14 passed. So the suite runs on 9.0.3 once the release is listed (`new_order_suite.txt`) |

The 9.0 stand-in is a downgrade, so the pins were not changed in step 4. `max(PYTEST_VERIFIED)` stays (9, 1), and the
drift test still expects the 9.1 pin. In a real upgrade to 9.2, `max` becomes (9, 2), and the drift test requires
the four raised pins.

**Regression (round 4):**

| Run | Result |
|---|---|
| `pytest gcs/tests/test_test_guards.py` | 19 passed |
| CI mode ×1 (`S\wp19un.py … ci`: real Python, CI env, stdin NUL) | **699 passed, 7 deselected**, 136.7 s, exit 0. No LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR line, no process left (`S\wp194ciun.txt`) |
| Node with jsdom | 310 pass, 0 fail, 0 skipped |
| `check-links` | OK |

No process was stopped. The throw-away venv is left in the scratchpad.
