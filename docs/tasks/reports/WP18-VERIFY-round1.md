VERDICT: REJECTED

# WP18 verification — round 1

Verifier: independent agent · 2026-10-17 · branch `wp/18` at 582dfe4 (code fabbbfb), base `main` c11fff0.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.
All experiments ran in throw-away copies (`git archive` of c11fff0 and 582dfe4) under `S\verify\WP18\scratch\`.
Logs are under `S\verify\WP18\logs\`. My own tools (not the implementer's): `vbench.py`, `vrun.py`, `vplug\vforce.py`,
`pin.py`, `mut.sh`, `sddl_check.py`, `crc_check.py`, `extract_step.py` in `S\verify\WP18\`.

**Summary.** The root-cause analysis is right, and the product fix (1 ms switch interval) is safe and clearly better.
I confirmed it from the CPython 3.12 source and reproduced it independently. The DACL test still enforces everything
it must; all 8 mutations fail it. CRC, R4, R7, R8 and every regression run are green. But the new guard logic has
two holes in exactly the failure path WP18 is about. (1) A timeout that expires while pytest formats a failure
(the CI incident) is now raised at the start of the test's **healthy** teardown. That aborts the fixture
finalisers, so the runtime is left running. (2) The leak detector only runs when the teardown hook returns
normally, so after any teardown exception a leaked runtime is neither reported nor stopped. Both are reproduced
below and contradict R1 ("even when the test fails or times out") and R2. That is 2 MAJOR findings, so the work
package is rejected.

## Scope

`git diff c11fff0...582dfe4 --stat` lists 21 files:
- the workflows and `test/ci/workflows.test.js`;
- `docs/relay/OPEN-ITEMS.md` (row edits only) and the WP18 report;
- `gcs/README.md`: the test section, plus one line in "Timing limits" (0.5 → 1 ms), justified in report §8.4;
- `gcs/conftest.py` and 12 test files;
- product: `gcs/vtolgcs/runtime.py`, `protocol.py`, `ui/app.py`, each listed and justified in report §5.

Everything is in the brief's "Files you own" or is justified. **PASS.**

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 no leaked runtimes | **FAIL** (one path) | Rigs converted to `ExitStack` (`test_control.py:31-92`, `test_crsf_menu.py`, `test_runtime_e2e.py`, `test_ui.py`, `test_bridge_sim.py` `udp`, `test_main_cli.py`, `test_mavlink_ro.py`, `test_sender.py`, `test_api.py` with `keep_started`). The remaining `start()` sites I grepped all use `try/finally`. No leak in any of my 8 full runs. | **F1:** after a slow failure report, the watchdog's `TestTimeout` aborts the teardown, and the runtime is left running. |
| R2 leak detector | **FAIL** (one path) | `conftest.py:619-712`. My probe: a real leaked `BridgeSim`+`Runtime` is named (5 threads, targets, owners, stacks), the test gets a teardown ERROR, and `BridgeSim.stop()`/`Runtime.stop()` end it. A plain-function thread is reported STILL RUNNING. No false positive in 8 full runs (`test_api` module fixture via `THREADS.keep_started`). | **F2:** the check is skipped whenever the teardown hook raises. |
| R3 DACL | PASS | `test_control.py:454-490` (ACE by ACE against the token user SID, protected, one ACE `0x1F01FF`, flags 0, owner == token default owner, remote half unchanged). Product unchanged. 8 mutations all fail (below). | The `LA` alias is confirmed independently. The `runneradmin` = RID 500 point is an inference, and the uncertainty is named in report and OPEN-ITEMS. |
| R4 failures never lost | PASS | `conftest.py:841-852`. The run B log has `+++ FAILED [22:52:20] gcs/tests/test_control.py::test_pipe_dacl… (call)` at line 501 with the full text, also in `pytest-failures.txt`. The verbatim workflow steps annotate every id (below). | MINOR F4: collection errors are no longer annotated by id. |
| R5 no INTERNALERROR | PASS (with F1) | `conftest.py:531-570`, `574-590`. Old main reproduces `INTERNALERROR> conftest.TestTimeout`; wp/18 shows none in any run or probe. | The fallback that raises "in the next phase" causes F1. |
| R6 spin / CRC | PASS | `protocol.py:103-126`. Identical to main's bit-wise CRC on 24 030 random inputs and start values; 15.5 → 1.9 µs per 34 B. Spin unchanged; the reasoning is sound. | |
| R7 M-17 | PASS | Unanchored `Timeout \([0-9:.]+\)!` in both workflows. Teardown cases in `workflows.test.js` (7/7 pass). `_descendants` (`conftest.py:317`). `IsProcessInJob` (`:409-412`). F-D docstring item 4. Self-tests pass in the suite. | |
| R8 local reproduction | PASS | `VTOLGCS_TEST_CPUS` / `VTOLGCS_TEST_FORCE_FAIL` (`conftest.py:725-731`, `:805-811`). Runs A/B/E below. | |
| R9 all green | PASS | Runs C, D, F, G, H; node 310/310; workflows 7/7; every `--check` passes. | |

## a. Root cause: source check and independent reproduction

**CPython 3.12.10 source.**
- `Python/ceval_gil.c` `take_gil`: `interval = gil->interval >= 1 ? gil->interval : 1` (µs), then `COND_TIMED_WAIT(gil->cond, gil->mutex, interval, timed_out)`. On a timeout with no switch, it calls `SET_GIL_DROP_REQUEST`.
- `drop_gil` (FORCE_SWITCHING) waits on `switch_cond` until another thread has taken the GIL.
- `Python/condvar.h`, Windows, both variants: `PyCOND_TIMEDWAIT(..., long long us)` → `(DWORD)(us/1000)` ms. The installed `include/internal/pycore_condvar.h` has `_PY_EMULATED_WIN_CV 1`, so the wait is `WaitForSingleObjectEx(sem, ms)`.
- Result: 500 µs becomes a 0 ms wait. A waiter times out at once, sets a drop request and loops. The holder is forced to switch at every eval-breaker check. 999 µs → 0 ms as well; 1000 µs → 1 ms.

The claim is confirmed.

**My bench** (`vbench.py`: an in-process `BridgeSim` + `Runtime` streaming FPV, as the tests do; affinity set on my own process only; real Python 3.12.10; mean rate over the window):

| CPUs | main thread | 0.5 ms | 1.0 ms |
|---|---|---|---|
| 4 | idle | 159 / 167 Hz; bridge sim hit FAILSAFE ("no valid rc_up for 251 ms") several times; process CPU 95-98 % | 250.0 Hz, p99 0.53/0.78 ms, 0 late; CPU 15-18 % |
| 2 | idle | **44 Hz**, gaps to 773 ms, 252 skipped slots; CPU 164 % | 250.0 Hz, p99 0.54 ms; CPU 15 % |
| 4 | CPU-bound (ast) | **4 Hz**, p50 289 ms; CPU 348 % | 244 Hz, p99 7.4 ms |
| 4, 3 rigs | CPU-bound | the setup itself starved ("controller data stale (1046 ms old)") | 247-249 Hz each, p99 ≈ 6-7 ms |
| 28 (all) | idle | 249.5 Hz, p99 0.45 ms, max 3.5 ms | 250.0 Hz, p99 0.81 ms, max 1.0 ms |
| 28 (all) | CPU-bound | **14-18 Hz** (×3 runs), CPU 430-440 % | 175-192 Hz, p99 8-11 ms (the README's documented in-process limit) |

The 0.5 ms collapse is reproduced. 1 ms is better or equal in every configuration.

**Suite reproduction** (my `vrun.py`: real Python, `CI=true GITHUB_ACTIONS=true`, stdin NUL, the gcs-build flags; my own plugin `vforce` for old main):

| Run | Tree | Setting | Result |
|---|---|---|---|
| A | main | 4 CPUs, DACL forced | `+++ TIMEOUT [22:49:27] tests/test_control.py::test_concurrent_stop_and_resume…`, main thread in `ast.walk` ← `_format_failed_longrepr`; `INTERNALERROR> conftest.TestTimeout`; **exit 3 after 240 s, 168 passed**, the rest never ran. This is the CI pattern line for line. |
| E | main | 4 CPUs, **no** forced failure (DACL passed locally) | Same: TIMEOUT in the concurrent test, INTERNALERROR, exit 3 after 212 s. The DACL failure does not cause the hang (confirms the report). |
| B | wp/18 | 4 CPUs, DACL forced | 1 failed (forced, `+++ FAILED` at once), 692 passed, 117.7 s, exit 1, no process left |
| C | wp/18 | 4 CPUs | 693 passed, 117.0 s, exit 0, no leaks |
| D | wp/18 | 2 CPUs | 693 passed, 117.4 s, exit 0, no leaks |

The CI dump (`S\ci-logs\art\build-tests.txt`, lines 520-750) shows exactly 3 runtimes' worth of threads. That is consistent with "the running test's own rigs", not leaks from earlier tests. The 6 tests between DACL and the concurrent test ran in 9 s.

## b. Safety of the 1 ms switch interval

- The plan requires 200-250 Hz (§7.1) and jitter < 1 ms p99 (stage 3). With 1 ms, idle p99 is 0.5-0.8 ms on 2, 4 and 28 CPUs (above).
- Timing tests (`test_timing_win.py`, `test_sender.py`, `test_protocol.py`) pass in runs C, D, F, G and H.
- No plan or contract text cites the 0.5 ms switch interval. The plan's "~0.5 ms" (§7.3) is the spin, `timing_win.FALLBACK_SPIN_S`, and is unchanged.
- `gcs/README.md` "Timing limits" now says 1 ms. `runtime.py:61-68` documents why. `test_the_runtime_switch_interval_is_at_least_1_ms` guards it.
- Nothing else in the product relies on 0.5 ms. `runtime.py:184` uses `min(current, 1 ms)`.

1 ms is a sensible, documented choice. **Safe.**

## c. DACL test: mutation results

Each mutation was made in a scratch copy (`mut.sh`). The baseline gives 2 passed: the remote-client half really runs here, because SMB loopback is available.

| Mutation | Result |
|---|---|
| M1: extra `(A;;GR;;;WD)` Everyone | FAILED at the ACE assertion |
| M2: extra `(A;;FA;;;AU)` Authenticated Users | FAILED |
| M3: `D:` (not protected) | FAILED at `sec["protected"]` |
| M4: `(A;OICI;FA;;;<user>)` inherit flags | FAILED |
| M5: `O:BA` owner in the product SD (non-elevated) | FAILED: the pipe cannot be created (WinError 1307) |
| M6: extra `(A;;GRGW;;;AN)` Anonymous | FAILED |
| M7: `PIPE_REJECT_REMOTE_CLIENTS` removed | FAILED at `assert not _remote_open(address)` |
| M8: read-back owner forced to `S-1-5-32-544` on this non-elevated token | FAILED at the owner check |

The owner check is no loophole. It compares with the actual token's default owner, and for a non-elevated token that is the user.

My `sddl_check.py` confirms the alias claim: RID 500 → `O:LAD:P(A;;FA;;;LA)`, RID 501 → `LG`, RID 1001 → the full SID.

The diagnostics print SIDs, elevation, integrity, session and groups, plus the pipe SDDL. They print no secrets: the control token or authkey is not in `diag`.

## d. R2 detector

Probes are in `S\verify\WP18\scratch\r5\gcs\tests\`. My test `test_r2c.py`:
- A test that leaks a real streaming `Runtime` + `BridgeSim` gets `+++ LEAKED THREADS … ['bridge_sim','session-log','bridge-rx','rc-sender','monitor']; stopped their owners: ['BridgeSim.stop()','Runtime.stop()',…]` and a teardown ERROR. The next test sees none of those threads.
- A plain-function thread is reported STILL RUNNING, which is the documented limit.
- The reaper is a daemon thread with a 10 s budget, excluded by name, so it cannot block later tests.
- No false positives in the full runs.

But see **F2**.

## e. R4/R5

- Immediate failure text: run B line 501, plus `pytest-failures.txt` (above).
- No INTERNALERROR in any wp/18 run.
- Workflow steps run verbatim (`extract_step.py` takes the `run:` block exactly; a fake `python.cmd` replays a real log; Windows PowerShell 5.1, as in `workflows.test.js`):
  - gcs-build step on run B: `::error::gcs/tests/test_control.py::test_pipe_dacl_is_user_only_and_remote_clients_are_rejected failed`, then the summary line, exit 1.
  - ci ×5 step on run B: the same id "in run(s) 1, 2, 3, 4, 5 of 5".
  - gcs-build step on old main run A: `::error::tests/test_control.py::test_concurrent_stop_and_resume_from_two_clients failed`, from the `tests/…` TIMEOUT id.
  - gcs-build step on the GitHub log: the same id plus `(hang at interpreter exit) hung (… +++ EXIT GUARD)`.

  The `tests/…` ids (rootdir `gcs`) are now annotated; the WP17 regex `(gcs|protocol)/` missed them.
- `node --test test/ci/workflows.test.js` with `VTOL_REQUIRE_WORKFLOW_TEST=1`: 7/7 pass (PowerShell 5.1; pwsh 7 is absent).
- R5 hole: **F1**.

## f. CRC

`test_crc16_table_matches_the_bitwise_definition` compares against the module's own `_crc16_bitwise`. I also compared directly with **main's** `crc16_ccitt_false` on 24 030 random inputs and start values, plus the `bytearray`/`memoryview` check value 0x29B1. All are identical (`crc_check.py`).

## Tests run (commands + results)

| # | Command / context | Result |
|---|---|---|
| A | `vrun.py scratch\main … ci VCPUS=4 VFORCE=test_pipe_dacl -- gcs protocol -p vforce` | exit 3 after 240 s, INTERNALERROR, 168 passed |
| E | the same without VFORCE | exit 3 after 212 s, INTERNALERROR |
| B | `vrun.py scratch\wp18 … ci VTOLGCS_TEST_CPUS=4 VTOLGCS_TEST_FORCE_FAIL=test_pipe_dacl` | 1 failed (forced), 692 passed, 117.7 s, exit 1 |
| C | `… ci VTOLGCS_TEST_CPUS=4` | 693 passed, 117.0 s |
| D | `… ci VTOLGCS_TEST_CPUS=2` | 693 passed, 117.4 s |
| F, G | `… ci` (CI mode ×2, all CPUs, real Python, stdin NUL) | 693 passed each, 116.7 / 116.8 s, exit 0 |
| H | `… desktop` (venv, interactive tests RUN; desktop run 1 of 2) | 698 passed, 2 skipped (UI smoke, needs `VTOLGCS_UI_SMOKE`), 141 s |
| | `VTOL_JSDOM=… node --test test/` | 310 pass, 0 fail, 0 skipped |
| | `VTOL_REQUIRE_WORKFLOW_TEST=1 node --test test/ci/workflows.test.js` | 7/7 |
| | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0 / OK |
| | Trial merge: `git clone` of the main repo → `checkout c11fff0` → `merge --no-ff origin/wp/18` | clean, 21 files |

No run left a process behind: `vrun.py` diffs the process lists, and a final `Win32_Process` search for my paths found nothing.

## Smoke tests

Not a web WP. The behavioural checks are the probes above.

## Findings

1. **MAJOR — R1/R5: a timeout during pytest's failure formatting now aborts the test's healthy teardown and leaves the runtime running.** (`gcs/conftest.py:544-560`, raise in the next phase; README test table.)
   - **Mechanism.**
     - When the watchdog fires while the main thread is in pytest's own code, it waits for the item's next phase.
     - It raises `TestTimeout` as soon as the teardown phase starts, polling every 50 ms, even though the teardown is not hanging.
     - `TestTimeout` is a `BaseException`. pytest's `SetupState.teardown_exact` catches only `TEST_OUTCOME` (`Exception`, `OutcomeException`; `_pytest/runner.py:567-570`), so the remaining finalisers are skipped. The aborted one does not finish either.
   - **Repro** (`S\verify\WP18\scratch\r5\gcs\tests\test_r5.py`, wp/18 conftest, `VTOLGCS_TEST_TIMEOUT=2 VTOLGCS_TEST_GRACE=8 SLOW_S=4`): a test fails, and formatting its error takes 4 s. The output is:
     - `the main thread is in pytest's own code … waiting up to 8 s`;
     - `+++ TIMEOUT: TestTimeout raised in the main thread (teardown)`;
     - `E conftest.TestTimeout` at the fixture's first teardown line;
     - finaliser flag **MISSING**;
     - the next test fails with `assert ['busy-runtime'] == []`.

     No `LEAKED THREADS` report is printed (see F2).
   - **Why it matters.** This is the CI incident's sequence: a test fails, its report is slow, the timeout fires. Each runtime it leaks is then a busy thread for the rest of the run. Brief R1: "must stop it … even when the test fails or times out".
   - **Coverage gap.** The self-test `test_a_timeout_in_pytests_own_report_code_is_no_internalerror` (`test_test_guards.py:384-406`) only covers a teardown that hangs, never a normal one.
   - **Expected.** When the timeout expired outside the item's phases, do not inject into a teardown that is making progress: let the finalisers run under their own budget, and raise or hard-exit only if the teardown itself overruns. Add a self-test: slow report + normal teardown → the finaliser ran, the thread is stopped, the next test is clean.

2. **MAJOR — R2: the leak check is skipped whenever the teardown hook raises.** (`gcs/conftest.py:581-583`, `result = yield` then `after()`; `:816`.)
   - **Mechanism.**
     - `_check_threads` runs only if the wrapped teardown returns normally.
     - Any teardown exception, such as an ordinary fixture error or the `TestTimeout` of F1, skips it.
     - The leaked threads are then in the next test's `before` snapshot, so they are never reported or stopped.
   - **Repro** (`scratch\r5\gcs\tests\test_r2b.py`): `test_leak_plus_teardown_error` has one fixture that leaks a thread and another that raises `ValueError` at teardown. Its output shows only the ValueError ERROR and **no** `LEAKED THREADS`. `test_after` then fails with `assert ['leaky-runtime'] == []`. The same leak without the other error is caught (`test_leak_only`).
   - **Why it matters.** R2 requires that every thread still alive after teardown is reported and that leaks "must not be able to slow later tests". Failing teardowns are exactly when rigs leak.
   - **Expected.** Run the thread check in `finally` (or regardless of the teardown outcome), attaching its error to the teardown report. Add a self-test with a leak plus a raising finaliser.

3. **MINOR — M-15 row and report §2/§8.6: "the runner starvation it fixed needs few CPUs, and that PC has 28" is not accurate.**
   - On this 28-CPU PC, an in-process runtime + sim at 0.5 ms with one CPU-bound Python thread (pytest formatting a failure is one) gives **14-18 Hz** at 430 % CPU (3 runs). At 1 ms it gives 175-192 Hz.
   - The report's 28-CPU "under load" figure (242.8 Hz) used an out-of-process simulator.
   - So the 0.5 ms convoy can plausibly also explain M-15. Reword the row: possibly explained, not ruled out.

4. **MINOR — workflow annotations: a collection error is no longer annotated by id** (`.github/workflows/gcs-build.yml` and `ci.yml`, fallback pattern `^(FAILED|ERROR) (\S+::\S+)`).
   - I replayed a collection-error log (`ERROR gcs/tests/test_x.py`, "Interrupted: 1 error during collection") through the steps verbatim:
     - new step: only `::error::pytest failed (exit code 2)…`;
     - old main step: `::error::gcs/tests/test_x.py failed`.
   - Expected: also accept ids without `::` in the fallback, e.g. `^(FAILED|ERROR) (\S+)`.

5. **Note, no finding.** The report's counts (691 passed + 1 forced; CI 692) are one lower than mine (692 + 1; 693). That is probably a count from before the last added test. The guard self-tests are 13 as stated.

## Approval rationale / items to fix

The root-cause work is right: I confirmed it by source and reproduced it, and the 1 ms product fix is safe and
documented. R3, R4, R6, R7, R8 and R9 pass. **Fix before approval:**
- **F1:** do not abort a healthy teardown after a timeout that fired during pytest's report formatting.
- **F2:** run the leak check even when the teardown raises.

Each needs a self-test. F3 and F4 are minors to fix or record.

Leftover processes: none. Every process I started ended, and none of mine remain.
