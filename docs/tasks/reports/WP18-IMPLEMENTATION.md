# WP18 — leaked GCS runtimes / GIL starvation on the GitHub runner, DACL test: implementation report

Branch `wp/18` (from `main` c11fff0) · Date 2026-10-17 · Contracts unchanged

## 1. Summary

- **Root cause found and reproduced locally.** The runtime set the GIL switch interval to 0.5 ms. On Windows,
  CPython waits for the GIL in whole milliseconds, so any value below 1 ms becomes a 0 ms wait. Every thread that
  wants the GIL then forces a switch at once, and the waiters poll in a tight loop.
  - On this 28-CPU PC nothing shows.
  - On 2–4 CPUs (the `windows-2025` runner has 4) the process collapses. That holds even for **one** streaming
    runtime with nothing else running: 0.5 ms gives 131–222 Hz with p99 29–44 ms; 0.999 ms the same; **1.000 ms
    gives 250 Hz with p99 0.6 ms**.
  - `test_concurrent_stop_and_resume_from_two_clients` keeps up to 6 runtimes alive until its teardown. On the
    runner that made pytest's main thread crawl. Formatting the test's failure took minutes. The watchdog's
    `TestTimeout` then landed inside pytest's own code (`INTERNALERROR`), every teardown was skipped, and the
    runtimes kept the process busy past the step timeout.
  - `VTOLGCS_TEST_CPUS=4` plus a forced DACL failure reproduces this exactly on current `main`.
  - With WP18 the same reproduction runs the full suite in 117 s (2 CPUs: 118 s): 691 passed and 1 named failure.
- **The PM hypothesis is partly confirmed and partly refuted** (§2).
- **DACL test (R3).** The probable cause is SDDL aliasing. Windows prints the built-in Administrator account
  (RID 500) as `LA`, not as its SID. `runneradmin` is presumably that account. The pipe's DACL was right; the
  test's string comparison was wrong. The test now compares ACE by ACE against the SID and prints full
  diagnostics. Security is unchanged.
- **R1/R2/R4/R5/R7.**
  - Every rig now stops what it started, even on failure.
  - A per-test leaked-thread detector names the thread with its stack, fails the test and stops the leak.
  - Failures are written the moment they happen, and the workflows annotate every failed id.
  - `TestTimeout` is raised only inside the test's own phases.
  - M-17 F-A, F-B, F-C and F-D are done.
- **Product changes:** 3 small ones (§5): the switch interval, a table-driven CRC and one thread name.

## 2. Evidence for and against the PM hypothesis

Sources: `S\ci-logs\build-job.txt`, `art\build-tests.txt`, and the ×5 job `ci5\art12112392774\run-1..4.txt`.

| Claim | Verdict | Evidence |
|---|---|---|
| A runner test fails first (DACL), which is deterministic | **Confirmed** | Build run plus all 4 ×5 runs: `test_pipe_dacl_…` FAILED at 23% |
| The runtimes on the stack were **leaked by earlier tests** (the DACL test skipped its teardown) | **Refuted** | (1) Each dump has exactly the `rig()`s of the running test: 3 runtimes (build, run-1, run-2) and **6** in run-3, which is the test's loop count (`for _ in range(6)`), and they are closed only in its teardown. (2) The DACL test's rig is closed by the fixture teardown: no `ERROR` at teardown appears in the -v log. (3) The 6 tests between DACL and the concurrent test ran at normal speed (19:20:10 → 19:20:19). A leaked runtime would already have slowed them, as one runtime does on 2–4 CPUs locally. |
| Busy daemon threads starve the main thread of the GIL; not a deadlock | **Confirmed** | The main thread makes progress between dumps: `ast.walk` at 120 s, then `pathlib` in `cleanup_dead_symlinks` at the exit guard, then `iterdir` 10 s later. INTERNALERROR lines are 0.2–1 s apart. The ×5 job took 8–13 min to print the INTERNALERROR. |
| The cause is the `wait_until` spin and the pure-Python CRC | **Mostly refuted** | Measured (§6): the spin holds the GIL for 1–3% of each period and the CRC costs 0.4% of a core. The cause is the **0.5 ms switch interval**: 0.999 ms collapses, 1.000 ms does not (`S\wp18\field_bench.py`). |
| The runtimes were leaked at exit | **Confirmed, with another cause** | They were leaked because `TestTimeout` raised in pytest's report hook became `INTERNALERROR`, which skips all teardowns (R5) |
| This is also the 40-minute hang of the first run | **Consistent, not provable** | The same test with no timeout keeps up to 6 runtimes on 4 CPUs. Locally (4 CPUs, old main) it crawls the same way. No log of that run exists. |
| The DACL failure causes the hang | **Refuted** | They are independent. With `main` on 4 CPUs the concurrent test hangs whether or not DACL fails. The forced failure was only to match CI. |

Local reproduction on current `main` (R8, "without"), from a throw-away `git archive c11fff0` at `S\wp18\base`:
- Run with `S\wp18\run.py ci` (the real Python, `CI=true GITHUB_ACTIONS=true`, stdin NUL, the gcs-build flags),
  plus `WP18_CPUS=4 WP18_FORCE=test_pipe_dacl` through `S\wp18\plug\wp18_force.py`.
- Result:
  - `+++ TIMEOUT [22:22:06] …test_concurrent_stop_and_resume_from_two_clients`, with the main thread in
    `_format_failed_longrepr`;
  - `INTERNALERROR> conftest.TestTimeout`, **exit 3 after 228 s at 24%**. The other ~76% of the suite never ran.
- This is the CI pattern line for line. Log: `S\wp18\r8-base\run.txt`.

## 3. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 no leaked runtimes | DONE | Leak sites below. Fixed with `contextlib.ExitStack`: each part registers its stop as soon as it exists, and `__init__` cleans up on failure. Rigs: `test_control.py:31` `Rig`, `:85` `rig`, `:612` (closes each iteration's runtime); `test_crsf_menu.py` `MenuRig`/`menu_rig`; `test_runtime_e2e.py` `Harness`/`harness`; `test_ui.py` `_Sender`, `_UiSpawnedSender`, launch test; `test_main_cli.py` `_HandSender`; `test_bridge_sim.py` `udp`; `test_mavlink_ro.py`, `test_sender.py` (`try/finally`); `test_api.py` module fixture | The full suite reports **no** leak (CI mode, desktop, 2 and 4 CPUs) |
| R2 leak detector | DONE | `conftest.py:619` `_Threads`, `:653` `_stop_owners`, `:683` `_check_threads`, `:815` teardown hook | Threads started during a test and still alive 2 s after its teardown → `+++ LEAKED THREADS` with each thread's name, target, owner and stack (stdout and `pytest-leaks.txt`) → teardown ERROR naming the test → the owners' `stop()`/`close()` run (whole runtimes first, 10 s budget). Self-test `test_test_guards.py:363`. |
| R3 DACL on the runner | DONE, cause probable (see §4) | `test_control.py:454`, `:488`, `:367` `_token_facts`, `:402` `_pipe_security` | Product unchanged (it was right); the test now checks ACEs by SID and prints diagnostics |
| R4 failures never lost | DONE | `conftest.py:841` `pytest_runtest_logreport` (`+++ FAILED/ERROR [time] <id> (<phase>)`, full text, `pytest-failures.txt`); both workflows annotate every id (7, then the rest in one line) from those lines, else from the summary, plus TIMEOUT ids | Self-tests: `test_test_guards.py:409`, `workflows.test.js` (failure then GIL hang, 9 failures). Also fixed: the WP17 regexes expected `gcs/…` ids but the runner's ids are `tests/…` (rootdir `gcs`), so they annotated nothing. Ids are now cwd-relative (`gcs/tests/…`), and the test trees carry the real `gcs/pyproject.toml`. |
| R5 no INTERNALERROR | DONE | `conftest.py:574` `_in_phase`, `:508` `_Watchdog._run`, `:805`, `:815` | Raised only while the main thread is inside the item's setup, call or teardown hook (pytest turns it into that phase's report). Otherwise the watchdog says so, waits up to the grace for the next phase, else takes the hard exit. A pending exception is withdrawn when a phase ends. Self-test `:384` covers both paths (report formatting slow, then a hard exit; formatting slow, then teardown hangs → teardown ERROR and the run goes on). |
| R6 spin/CRC CPU | DONE | §6 | The CRC is table-driven; the spin is unchanged (1–3% of the period); the real fix is the switch interval |
| R7 M-17 | DONE | F-A: `ci.yml`/`gcs-build.yml` `Timeout \([0-9:.]+\)!` unanchored; `workflows.test.js` teardown cases (pass: `[100%]Timeout (0:00:04)!`; fail: fractional). F-B: `conftest.py:317` `_descendants`, used by `alive()`. F-C: `:411` `IsProcessInJob`. F-D: docstring item 4. | Self-tests `:422`, `:434`; M-17 marked CLOSED |
| R8 local reproduction | DONE | `VTOLGCS_TEST_CPUS`, `VTOLGCS_TEST_FORCE_FAIL` (`conftest.py:725`, `:805`); §7 | — |
| R9 all green | DONE | §7 | — |

### 3.1 Leak sites found (R1)

Each could leave a runtime, sender, simulator or thread running after a failure:

| Site | Problem |
|---|---|
| `test_control.py` `Rig.__init__` | A failure after `sim.start()` or `rt.start()` (e.g. `ControlServer.start`) leaked them: the rig was never appended to the fixture's list |
| `test_control.py` `Rig.close` / `rig` fixture | Sequential stops: if one raised, the rest (and later rigs) leaked |
| `test_control.py::test_concurrent_stop_and_resume_from_two_clients` | Up to 6 live runtimes at once until teardown (the CI collapse) |
| `test_control.py::test_server_budget…` | The clients were closed only if the asserts passed |
| `test_crsf_menu.py` `MenuRig` / `menu_rig` | Same as Rig, plus an unnamed pump thread that was never joined |
| `test_runtime_e2e.py` `Harness` / `harness` | Same as Rig |
| `test_ui.py` `_Sender` | Same as Rig |
| `test_ui.py` `_UiSpawnedSender`; `test_main_cli.py` `_HandSender` | The simulator leaked if the spawn raised; a raising `close()` step skipped `sim.stop()` |
| `test_ui.py::test_ui_shows_the_launch_dialog_refusal_in_events` | The simulator started before the `try` (an assert came first) |
| `test_bridge_sim.py` `udp` fixture | Sim and TestClient (rx/tx threads) not registered until both existed; sequential stops |
| `test_mavlink_ro.py::test_listener_never_sends_with_recording_socket` | `ro.stop()` as a trailing body line |
| `test_sender.py::test_dead_sender_thread_is_detected` | `sender.stop()` as the last line: a failed assert leaked a 250 Hz high-priority thread |
| `test_api.py` module `runtime` fixture | Not a leak, but its threads outlive the first test: now `with THREADS.keep_started()` |
| `conftest.py` (WP17) | `TestTimeout` in pytest's report hook → INTERNALERROR → **no teardown at all** (R5) |

## 4. R3: the DACL test under the runner account

**What the test did.** It read the pipe's DACL back as SDDL and compared it with the string
`D:P(A;;FA;;;<S-1-5-21-…>)`.

**What Windows prints.** `ConvertSecurityDescriptorToStringSecurityDescriptor` prints some well-known SIDs as
aliases. I checked this on this PC without elevation, using this machine's domain SID:
- RID 500 → `D:P(A;;FA;;;LA)` (and `O:LA`);
- RID 501 → `LG`;
- RID 1001 → the full SID.

Script: `S\wp18\sddl_alias.py`. The new test `test_sddl_text_of_the_builtin_administrator_is_an_alias` proves it in
the suite.

**The runner account.** `runneradmin` is described as an elevated administrator. On Azure Windows VMs the admin
account given at provisioning is the **renamed built-in Administrator (RID 500)**, which also explains why it is
always elevated (UAC does not filter RID 500 by default). For that account the readback is `…;;;LA)` and the
string comparison fails, although the DACL is exactly right.

**Uncertainty.** I cannot see the runner's SID. That `runneradmin` is RID 500 is an inference (Azure provisioning
plus the always-elevated token), not observed. The other candidates do not fit:
- **The owner** (an elevated token's default owner is `BUILTIN\Administrators`) is not part of a DACL-only readback.
- **Extra ACEs:** an explicit, protected DACL is never extended.
- **The remote-client check:** it comes after the SDDL assertion, so it never ran on the runner.

**Fix (test only; the product is correct).** `test_pipe_dacl_is_user_only_and_remote_clients_are_rejected` now:
- reads the owner and DACL through the handle and decodes each ACE: type, flags, mask, and the SID converted with
  `ConvertSidToStringSid`, which never uses aliases;
- asserts a protected DACL with exactly one ACE: ACCESS_ALLOWED, no inheritance, `FILE_ALL_ACCESS` (0x1F01FF),
  for **the token's user SID**;
- asserts that the owner equals the token's default owner;
- keeps the remote-client half unchanged.

**Why this is still secure for both kinds of token.**
- The DACL grants access to the user's SID and nobody else, elevated or not.
- Under an elevated token the owner is `BUILTIN\Administrators`, which only gives implicit READ_CONTROL/WRITE_DAC
  to elevated administrators. They can take any object anyway (SeTakeOwnership, SeDebug).
- No standard user, Everyone, Anonymous or network logon gets anything.
- `PIPE_REJECT_REMOTE_CLIENTS` is unchanged.

**Diagnostics for the next run.** The test prints the token's user, default owner, elevation and elevation type,
integrity, session and all groups (with enabled and owner flags), plus the pipe's full SDDL (owner and DACL). Every
assertion carries them, so if the next run still fails, the log has everything needed. The remote-client half will
run on a runner for the first time. Its result is recorded in OPEN-ITEMS row "WP18 R3".

## 5. Product changes (every one, with its reason)

| File | Change | Why |
|---|---|---|
| `gcs/vtolgcs/runtime.py:61-68` | `GIL_SWITCH_INTERVAL_S` 0.0005 → **0.001** | The root cause (§2, §6): below 1 ms Windows turns the GIL wait into 0 ms (immediate forced switch, polling waiters). It starved the RC thread itself on 2–4 CPUs, which matters for small field laptops too. At 1 ms the sender keeps 250 Hz and p99 ≈ 0.5 ms on 2, 4 and 28 CPUs. Under CPU load it is as good as 0.5 ms on 28 CPUs and far better on 4 (§6). |
| `gcs/vtolgcs/protocol.py:103-126` | Table-driven CRC-16/CCITT-FALSE (`_crc16_bitwise` kept as the reference) | 16 µs → 2 µs per rc_up (pack 19 → 4 µs). The bridge simulator, receiver and sender all use it. The results are identical: the test vectors, `--selftest`, and a new test against the bit-wise definition over random data and start values. |
| `gcs/vtolgcs/ui/app.py:180` | Worker thread named `ui-bg-<fn>` | R2: the one unnamed product thread (all others were already named: `rc-sender`, `bridge-rx`, `monitor`, `session-log`, `control-accept`, `control-auth`, …) |

**Not changed:** the `wait_until` spin (§6: 1–3% of the period). `gcs/README.md` "Timing limits" now says 1 ms
(one line outside the test section, kept consistent with the code). `gcs/tools/bridge_sim.py` is unchanged.

## 6. R6 measurements (this PC; `S\wp18\r6_measure.py`, `S\wp18\field_bench.py`; logs `S\wp18\logs\r6-*.txt`)

**Per packet:**

| | Before | After |
|---|---|---|
| CRC-16 (36 B rc_up) | 16.5 µs = 0.41% of one core at 250 Hz | 2.1 µs = 0.05% |
| Whole `pack()` | 19.0 µs | 4.3 µs |

**Spin** (`HR_SPIN_S` 0.3 ms, high-resolution timer):
- per 4 ms period, mean 0.04–0.11 ms (p99 0.17–0.27 ms), i.e. **1–3% of the period with the GIL held**;
- lateness p99 0.38–0.53 ms.

Not significant, so it is unchanged.

**A field-like sender process** (Runtime with the API on, bridge_sim in another process, streaming 10 s; CPU is
process CPU time over wall time, all threads):

| CPUs | Before: 0.5 ms switch | After: 1 ms switch |
|---|---|---|
| all (28) | CPU 9.7%, 250.0 Hz, p50 0.17 / p99 0.72 / worst p99 4.43 / max 6.15 ms, 17 late | CPU 9.0%, 250.1 Hz, p50 0.09 / p99 0.45 / worst p99 0.77 / max 1.30 ms, 0 late |
| 4 | CPU 19.7%, 240.9 Hz, p99 1.94 / worst p99 15.98 / max 55.36 ms, 40 late | CPU 8.4%, 250.0 Hz, p99 0.55 / worst p99 0.95 / max 1.89 ms, 0 late |
| 2 | **CPU 122.6%, 100.8 Hz**, p99 51.38 / worst p99 688.75 / **max 1014.65 ms** | CPU 9.5%, 250.0 Hz, p99 0.53 / worst p99 0.57 / max 1.91 ms, 0 late |

**Switch interval sweep** (`field_bench.py`, 4 CPUs, idle main thread):

| Interval | Rate | p99 |
|---|---|---|
| 0.5 ms | 222 Hz | 28.8 ms |
| **0.999 ms** | 229 Hz | 12.8 ms (worst 39 ms) |
| **1.0 ms** | 250 Hz | 0.65 ms |
| 5 ms | 250 Hz | 0.61 ms |

**Under CPU load** (the main thread parses `ast` continuously):

| Setting | Result |
|---|---|
| 28 CPUs, 0.5 ms | 242.8 Hz, p99 7.4 ms |
| 28 CPUs, 1 ms | 244.1 Hz, p99 7.4 ms |
| 28 CPUs, 5 ms | 141.8 Hz (WP08a's reason for a short interval still holds) |
| 4 CPUs, 0.5 ms | 67.6 Hz, p99 101 ms |
| 4 CPUs, 1 ms | 250 Hz, p99 4.3 ms |

**Main-thread slowdown** (`starve_bench.py`: pure-Python `ast` work with N rigs streaming in the same process):

| Setting | Slowdown |
|---|---|
| 4 CPUs, 1 rig, 0.5 ms | ×298 |
| 2 CPUs, 1 rig, 0.5 ms | ×548 |
| 2 CPUs, 0.5 ms, sender at normal priority | ×5.6 |
| 2 CPUs, 0.5 ms, no spin | ×634 (the spin is not the cause) |
| 2 CPUs, 5 ms | ×1.1 |
| 4 CPUs, 3 rigs, 1 ms (and normal prio, no spin) | ×1.2 |

The existing timing tests (`test_timing_win.py`, `test_sender.py`, `test_protocol.py`): 214 passed before and after.

## 7. Tests run

| Run | Command / context | Result |
|---|---|---|
| R8 without (old main) | `run.py ci` on `S\wp18\base`, 4 CPUs, DACL forced to fail | **exit 3 (INTERNALERROR) after 228 s at 24%**: concurrent test TIMEOUT, main thread in `_format_failed_longrepr`, ~76% never ran (`S\wp18\r8-base\run.txt`) |
| R8 with, 4 CPUs | `VTOLGCS_TEST_CPUS=4 VTOLGCS_TEST_FORCE_FAIL=test_pipe_dacl`, `run.py ci` (real Python, CI env, stdin NUL, gcs-build flags) | **1 failed (the forced one, `+++ FAILED [22:23:42] gcs/tests/test_control.py::test_pipe_dacl… (call)` at once), 691 passed, 117 s, exit 1 at once**, no leaks, no process left (`S\wp18\r8-new\run.txt`) |
| R8 with, 2 CPUs | the same with `VTOLGCS_TEST_CPUS=2` | 1 failed (forced), 691 passed, 118 s, exit at once (`S\wp18\r8-new2\run.txt`) |
| CI mode | `run.py ci` (no forcing) | **692 passed, 7 deselected, 116.8 s, exit 0**, no leaks, no process left (`S\wp18\logs\ci-2.txt`) |
| Desktop (1 of the allowed 2) | `run.py normal` (venv, interactive tests RUN) | **697 passed, 2 skipped (UI smoke)**, 140.7 s, exit 0 (`S\wp18\logs\desktop-1.txt`) |
| Guard self-tests | `pytest gcs/tests/test_test_guards.py` | 13 passed (7 WP17 + 6 WP18) |
| Workflows | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv> node --test test/ci/workflows.test.js` | 7/7 (PowerShell 5.1 here) |
| Node | `VTOL_JSDOM=S\jsenv\node_modules\jsdom node --test test/` | 310 pass, 0 fail, 0 skipped |
| Checks | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `python -m vtolgcs.protocol --selftest` | all OK |
| New annotation logic on the real CI log | the gcs-build block run on `S\ci-logs\art\build-tests.txt` | annotates `tests/test_control.py::test_concurrent_…` and `(hang at interpreter exit)`. The DACL id is not in that old log at all (it was only in a summary that never printed), which is exactly what R4's immediate lines fix. |

The first CI-mode run during development (`logs\ci-1.txt`) found one more detector hit: `test_api.py`'s
module-scoped runtime (reported, then stopped). It is now registered with `THREADS.keep_started()`.

New tests:
- `test_test_guards.py`:
  - `test_a_leaked_thread_is_named_with_its_stack_fails_its_test_and_is_stopped` (R2 + R8 force);
  - `test_a_timeout_in_pytests_own_report_code_is_no_internalerror` (R5, both paths);
  - `test_a_failure_is_written_when_it_happens_even_if_the_session_dies_later` (R4);
  - `test_a_kept_process_keeps_its_descendants` (F-B);
  - `test_the_kill_path_skips_a_pid_that_is_no_longer_in_the_job` (F-C);
  - `test_the_runtime_switch_interval_is_at_least_1_ms`.
- `test_control.py::test_sddl_text_of_the_builtin_administrator_is_an_alias`.
- `test_protocol.py::test_crc16_table_matches_the_bitwise_definition`.
- `workflows.test.js`: the real `gcs/pyproject.toml` in every tree; teardown GIL hang after a pass and after a
  failure (F-A); a failure then a session-killing hang (both ids); 9 failures (7 + "2 more").

## 8. Deviations / notes for the PM

1. **The root fix is a product timing constant** (0.5 → 1 ms), not only test hygiene. It is in scope as a "CPU
   fix" and is measured in §6. It also affects field laptops with few cores, where the old value could drop the
   RC rate to ~100 Hz with stalls of up to 1 s. I suggest the verifier re-checks a jitter run on the target
   laptop (M-12).
2. **The leak detector stops leaked owners.** It calls `stop()`/`close()` on the object whose bound method a
   leaked thread runs (`thread._target.__self__`, a CPython detail).
   - Why: a leak is then reported once and cannot slow everything after it.
   - Limit: threads whose target is a plain function can only be reported.
   - Module-scoped fixtures must use `THREADS.keep_started()`. `test_api.py` is the only one.
3. **Ids in the live lines changed** from rootdir-relative (`tests/…`) to cwd-relative (`gcs/tests/…`), the same
   as the -v lines and the summary. The workflow regexes accept any id.
4. **`gcs/README.md`:** besides the test section, one line in "Timing limits" (0.5 → 1 ms) so it matches the code.
5. **Not verifiable here:** the runner account's RID (R3); `pwsh` 7 (absent on this PC; the workflow tests ran
   under 5.1, as in WP17).
6. **OPEN-ITEMS:**
   - M-15: still open, not explained by WP18 (28-CPU PC); the close condition now relies on the immediate
     failure text.
   - M-16: no leak allowed.
   - M-17: CLOSED.
   - WP17 row: cause found, close it after the first green GitHub run.
   - New row "WP18 R3": read the DACL diagnostics.

## 9. Notes for the verifier

- **Reproduce the CI failure on old `main`.** Use a throw-away copy, `S\wp18\run.py <copy> <log> ci gcs protocol
  -p wp18_force`, with `WP18_CPUS=4 WP18_FORCE=test_pipe_dacl`. `run.py` puts `S\wp18\plug` on PYTHONPATH.
- **The same on this branch:** `VTOLGCS_TEST_CPUS=4 VTOLGCS_TEST_FORCE_FAIL=test_pipe_dacl` (or the README
  PowerShell lines).
- **Switch-interval threshold:** `S\wp18\field_bench.py <gcs> 4 0.999 high none` vs `… 4 1 high none`.
- **Leak detector by hand:** add `threading.Thread(target=lambda: time.sleep(30)).start()` to a scratch test. The
  test gets a teardown ERROR with the thread's stack, and the owner cannot be stopped (plain function), so it is
  reported as STILL RUNNING.
- I stopped only processes I started; the job objects of my runs and `Popen.terminate` on my own simulator
  children did that. No elevation, no system settings. Affinity was set only on my own test processes.
