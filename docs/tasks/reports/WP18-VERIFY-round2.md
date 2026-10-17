VERDICT: APPROVED

# WP18 verification — round 2

Verifier: independent agent · 2026-10-17 · branch `wp/18` at 1f97633 (round-2 code a612eb5, report 1f97633), base `main` c11fff0.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.

I ran every experiment in throw-away copies under `S\verify\WP18\scratch2\`:
- `wp18\` is a `git archive 1f97633`;
- `p\` holds the round-2 `gcs/conftest.py` plus my probes;
- `replay\` holds the workflow steps;
- `mergeclone\` is the trial merge;
- `rl_main\` and `rl_wp18\` are instrumented copies.

Logs are in `scratch2\logs\`. My tools are `scratch2\vprobe.py` (probe runner, timestamps every output line), the round-1 `vrun.py` and `extract_step.py`, and the probe tests `p\gcs\tests\test_v*.py` + `vhelp.py`. I did not touch the worktree or the main repo. Both are clean, at 1f97633 and c11fff0.

**Summary.**
- **Both MAJOR findings from round 1 are fixed.**
  - F1: a timeout before or during a teardown no longer cuts it short. The teardown gets its own budget, and only a teardown still running after that budget is interrupted or hard-exited.
  - F2: the leak check now runs, chained, after a finaliser raises.
- F3 and F4 are fixed.
- Every round-1 probe and every new adversarial probe behaves as documented. Setup and call are still interrupted at once, and every hang ends within the documented bound.
- WP17 guards: no regressions.
- Regression runs: all green, except one desktop-run flake. It is in a test that WP18 did not change, and main shows the same near-zero margin (finding 3).
- Three MINOR findings remain (below). None blocks.

## Scope

`git diff c11fff0...1f97633 --stat` lists the same 21 files as round 1. Round 2 (582dfe4..a612eb5) touches only these:
- `ci.yml`, `gcs-build.yml`
- `OPEN-ITEMS.md` (the M-15 row)
- `gcs/README.md` (test table)
- `gcs/conftest.py`, `test_test_guards.py`
- `workflows.test.js`

There are no product changes in round 2. **PASS.**

## Round-2 claims

| Claim | Result | Evidence |
|---|---|---|
| F1: a teardown is never interrupted at once; its budget (30 s) counts from the later of its start and the timeout; `TestTimeout` comes only after the budget; hard exit and backstop at budget + grace | **PASS** | `conftest.py:519-610` (`_Watchdog._run`), `_PHASE["since"]` (`:626`). Probes A, B, C, G below |
| F1: setup and call are still interrupted at once; pytest internals are never interrupted | **PASS** | Probe F: `TestTimeout raised in the main thread (setup)` and `(call)` both at +0.00 s after the timeout. In every probe, a timeout during report formatting prints "main thread is in pytest's own code … not raised there" and never gives an INTERNALERROR |
| F2: `_check_threads` always runs after teardown, chained to the finaliser's exception | **PASS** | `_in_phase(..., always=True)` (`:618-644`, `:871`). Round-1 `test_r2b.py`: both leaks are named and stopped, the ValueError text is kept ("The above exception was the direct cause…"), and `test_after` passes. Probe D below |
| F3: M-15 wording | **PASS** | The `OPEN-ITEMS.md` M-15 row now says "may explain it too and is not ruled out" (14–18 Hz). Report §1 and §8 are corrected; no "needs few CPUs / has 28" text is left |
| F4: collection errors annotated by path | **PASS** | `pytest_collectreport` gives `+++ ERROR [t] <path> (collect)`. Both workflows have `collect` in the pattern and the fallback `^(FAILED|ERROR) (\S+)`. Replay below. New `workflows.test.js` cases: 7/7 pass. Mutation: with the old ci.yml fallback `(\S+::\S+)`, test 6 fails |

### a. Round-1 probes, re-run on the round-2 conftest

- `test_r5.py` (`TIMEOUT=2 GRACE=8 SLOW_S=4`):
  - "main thread is in pytest's own code" → `+++ FAILED (call)` → "is in its teardown: not interrupted (its finalisers must run); TestTimeout only if it is still running in 30 s";
  - `finaliser-ran.flag` present;
  - `test_next_one PASSED`;
  - `1 failed, 1 passed`, 8.6 s.

  Round 1 had: finaliser MISSING, next test failed.
- `test_r2b.py`:
  - `+++ LEAKED THREADS … test_leak_plus_teardown_error … ['leaky-runtime']; stopped their owners: ['Busy.stop()']`;
  - the ERROR text holds the ValueError, then "direct cause of", then `LeakedThreads`;
  - `test_after PASSED`;
  - `3 passed, 2 errors`.

  Round 1 had: no leak report, `test_after` failed.

### a. New adversarial probes

All probes use `TIMEOUT=2 GRACE=4 TEARDOWN_BUDGET=8 BACKSTOP_MARGIN=3`. Times are seconds from the start of pytest; events are written by the tests.

| Probe | What it does | Result |
|---|---|---|
| **A** `test_va.py`, `SLOW_S=1.5 TD_S=6` | Report formatting is slow, and the timeout fires inside it (2.21). Then an inner teardown loops for 6 s. That is longer than grace, but within budget. Nested: function `outer_busy` + module `outer_mod`. | Teardown 3.22→9.22, **not interrupted**, no hard exit. The old hard-exit point would have been 6.2, so it moved. Outer function finaliser ran 9.22, `test_next_one PASSED` (no `outer-busy` thread), module finaliser ran. `1 failed, 1 passed`, exit 1, 9.2 s |
| **B-sleep** `test_vb.py MODE=sleep` | After a slow-report timeout, the teardown hangs in `time.sleep(10**6)`, which `TestTimeout` cannot interrupt. | Teardown starts 3.21. Budget message, then `TestTimeout raised … (teardown, still running after its 8 s budget)` at 11.26, then `+++ TIMEOUT: … still running 13 s later: hard exit (status 1)` + stacks at **15.26 = 3.21 + 8 + 4**. Exit 1 after 15.3 s. The test is named |
| **B-loop** `MODE=loop` | The same, but the hang is an interruptible Python loop. | `TestTimeout` at 11.28. The leak check runs after the aborted teardown: `+++ LEAKED THREADS … ['outer-busy']; stopped their owners: ['Busy.stop()']`. Teardown ERROR shows `TestTimeout`, then `LeakedThreads`. The run goes on and ends at 13.3 s. **See finding 1:** the next test got pytest's cached, already-stopped `outer_busy` instance (`serial 1 stopped=True`) |
| **C-native** `MODE=native PRE_S=0.3` | `ctypes.PyDLL("kernel32").Sleep(10_000_000)`, which holds the GIL, 0.3 s into the teardown, after the timeout. | `Timeout (0:00:15)!` + all stacks (hanging frame `test_vb.py line 29 in hang`) at **18.23 = 3.22 + 8 + 4 + 3**, the documented budget + grace + margin. Exit 1 |
| **C-native0** `PRE_S=0` | The GIL hang starts at once, before the watchdog has seen the teardown. | The backstop is not re-armed. The original deadline fires: `Timeout (0:00:05.97)!` at **9.19** (test start + 2 + 4 + 3). This is earlier than the bound, so it is fine |
| **C-fmt** `NATIVE_FORMAT=1` | The GIL hang is inside pytest's report formatting. | `Timeout (0:00:09)!` at 9.21 on the START line (the CI regex is unanchored). Exit 1 |
| **D** `test_vd.py` | A fixture teardown raises `RuntimeError` **and** leaks `raise-leak-rt`, between two clean tests. | `+++ LEAKED THREADS … test_vd.py::test_raise_and_leak … ['raise-leak-rt']; stopped their owners: ['Busy.stop()']`, attributed to the right test. ERROR with the RuntimeError chained. `test_after` sees `[]` and passes |
| **E** `test_ve.py` + `test_ve2.py` | Nested function + module fixtures; the inner function finaliser raises ValueError. | Function outer finaliser ran, then module finaliser ran (at the module end); the other module sees no threads; `3 passed, 1 error`. Note: in my first variant the module fixture's thread was started without `THREADS.keep_started()`. The detector then reported it and stopped it after the first test, as documented (README "Threads" row). |
| **F** `test_vf.py` | A setup hangs; a call hangs; the call test's teardown takes 1 s. | Setup: timeout 2.19 → `TestTimeout … (setup)` 2.19 → ERROR 2.22. Call: timeout 4.23 → `(call)` 4.23 → FAILED 4.25; its teardown gets the budget message and **runs fully** (4.25→5.25). `test_after PASSED` |
| **G** `test_vg.py` | The timeout fires **during** a teardown that started before it (1.5 s). `TD_S=5`, then `TD_S=inf`. | TD 5: not interrupted, finishes at 6.5 (after the old hard-exit point), teardown ERROR "TestTimeout: exceeded…", next test passes. TD inf: `TestTimeout` at **10.22 = timeout 2.2 + 8**, so the budget counts from the timeout, not from the teardown start |
| worst case | A slow report just under grace, then the teardown hangs. | Hard exit at 16.03 = 2.19 + 1.84 + 8 + 4. So the worst case is timeout + grace + budget + grace (+ margin for a GIL hang) |

### a. Worst-case time bound against the workflow step timeouts

With the defaults (`120 + 20 + 30 + 20 + 10`), a hang that the watchdog can see ends **≤ 190 s** after the test starts (hard exit). A GIL hang ends **≤ 200 s** after it (backstop). Round 1 had 150 s.

**Runner pace.** In the CI log `ci5\art…\run-1.txt`, the runner reached `test_concurrent_stop_and_resume…` 23 s after the first START. My local CI-mode run took the same 23 s (23:37:14 → 23:37:37). So the runner's pace is close to local. A local CI-mode full run takes 130 s.

**ci.yml ×5 step** (35 min = 2100 s), with a test that hangs in every run, at the worst position (last):
- 5 × (130 + 200 + ~5 start-up) ≈ **1675 s ≈ 28 min**;
- it fits as long as the runner's full run stays ≤ ~215 s;
- the job timeout is 45 min.

**gcs-build step** (15 min): 130 + 200 ≈ 5.5 min.

Both fit. The margin in the ×5 step is about 7 min. See finding 2.

### b. WP17 behaviour: no regressions

- `pytest gcs/tests/test_test_guards.py` (venv, `VTOLGCS_INTERACTIVE_TESTS=0`): **15 passed** in 59 s. That covers:
  - hang dumps and kills;
  - grace exit;
  - native GIL hang;
  - exit hang with and without faulthandler (the exit watcher);
  - kept-tree descendants;
  - `IsProcessInJob`;
  - leak, slow report, and the two new round-2 self-tests.
- My own probe `test_vh.py` (`EXIT_GRACE=3`):
  - a non-daemon thread kept past the session gives `+++ EXIT GUARD: … not exited 3 s after the session ended (non-daemon threads: ['forever'])` at 3.27 s, exit 1;
  - an orphaned grandchild (`cmd /c start /b python …`) gives `killed process(es) still running after the test: [(640,'python.exe'), (3808,'python.exe')]`;
  - `tasklist` then finds no PID 3808: the job object works.

### c. F4: workflow steps replayed verbatim on synthetic logs

Both `run:` blocks were taken verbatim (`extract_step.py` from the 1f97633 workflows). A fake `python.cmd` types the log and exits with the given code. They ran under Windows PowerShell 5.1, as in `workflows.test.js`.

| Log | gcs-build step | ci ×5 step |
|---|---|---|
| collect error with the conftest line `+++ ERROR [t] gcs/tests/test_broken.py (collect)` | `::error::gcs/tests/test_broken.py failed`, `exit code 2` | `… failed in run(s) 1, 2, 3, 4, 5 of 5` |
| collect error, pytest lines only (fallback), plus a captured `ERROR    vtolgcs.runtime:…` log line | `::error::tests/test_broken.py failed` (only that) | the same ×5 |
| failed test + teardown ERROR (`tests/…` live ids, `gcs/…` conftest ids), plus captured `ERROR    vtolgcs.control…` and `FAILED   not a real id` lines | exactly the 2 real ids | exactly the 2 real ids |
| fallback only, with captured log lines | the 2 `FAILED tests/…` ids; no log line | the same |
| GIL hang `…PASSED [ 75%]Timeout (0:03:20)!` after `[t] START tests/test_runtime_e2e.py::test_hangs` | `::error::tests/test_runtime_e2e.py::test_hangs hung (… Timeout (0:03:20)!)` | the id in runs 1–5 |
| watchdog `+++ TIMEOUT [t] tests/test_control.py::test_concurrent… still running after` + hard exit | that id | that id |

Captured log lines are never annotated. Every step exits 1.

Mutation checks on `workflows.test.js`:
- reverting the ci.yml fallback to `(\S+::\S+)` makes test 6 fail;
- removing `collect` from the gcs-build primary pattern does **not** fail test 7, because the new fallback covers it (the collect error interrupts the session, so no other `+++` line exists). That is harmless.

### d. Round-1 items

- Round 2 changed no product file and no test outside `test_test_guards.py`. These are therefore byte-identical to the round-1 state that I verified then:
  - the switch interval (`runtime.py`, 1 ms) and its guard test;
  - the DACL test (`test_control.py`);
  - the CRC table (`protocol.py`) and `test_crc16_table_matches_the_bitwise_definition`;
  - the M-17 items (R7).
- R4: run A logs `+++ FAILED [23:41:58] …test_pipe_dacl… (call)` in the same second as its START line.
- R8 4-CPU run (`vrun.py … ci VTOLGCS_TEST_CPUS=4 VTOLGCS_TEST_FORCE_FAIL=test_pipe_dacl`):
  - header: "restricted to 4 logical CPU(s)" and "FORCED to fail";
  - the failure is named at once (line 501);
  - **1 failed, 694 passed, 7 deselected, 130.4 s**, exit 1;
  - `END of session` at 23:43:53, and the process exited at once;
  - no LEAKED, TIMEOUT or INTERNALERROR lines; no process left.

### e. Regression

| # | Command / context | Result |
|---|---|---|
| ciA | `vrun.py scratch2\wp18 … ci`: real Python 3.12.10, `CI=true GITHUB_ACTIONS=true`, stdin NUL, gcs-build flags | **695 passed, 7 deselected**, 130.5 s, exit 0, no LEAKED/TIMEOUT/INTERNALERROR, no process left |
| ciB | the same, again | **695 passed, 7 deselected**, 130.0 s, exit 0, clean |
| cpu4 | the 4-CPU forced-fail run above | 1 failed (forced), 694 passed, 130.4 s, exit 1 at once |
| desktop | `vrun.py … desktop` (venv; interactive tests RUN, WinSta0 session 1); my only desktop run | **1 failed, 699 passed, 2 skipped** (UI smoke needs `VTOLGCS_UI_SMOKE`), 153.5 s. The failure is `test_control.py::test_rate_limit_refuses_the_excess_with_a_warning`: `assert 13 <= 20 * 0.594 + 1`. It is a pre-existing near-zero-margin timing test that WP18 did not change (finding 3). No LEAKED, no TIMEOUT |
| guards | `pytest gcs/tests/test_test_guards.py` | 15 passed |
| node | `VTOL_JSDOM=… node --test --test-reporter=tap test/` | 310 tests, 310 pass, 0 fail, 0 skipped |
| wf | `VTOL_PYTHON=<venv python> VTOL_REQUIRE_WORKFLOW_TEST=1 node --test test/ci/workflows.test.js` | 7/7 pass. Without `VTOL_PYTHON`, tests 6 and 7 fail by design: "no Python with pytest" |
| checks | `gen-precache.mjs --check`, `diagrams/build.js --check`, `gen-params-reference.mjs --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0 ("up to date", "SELFTEST OK") |
| merge | `git clone` of the main repo → `checkout c11fff0` → `merge --no-ff wp/18` (in `scratch2\mergeclone`) | clean, 21 files, +1549/−300 |

## Findings

1. **MINOR: after a teardown runs past its budget, `TestTimeout` skips that test's other finalisers, and pytest hands the stale fixture values to later tests.** (`conftest.py:589-594`; pre-existing since WP17; round 2 narrows it to teardowns still running 30 s after the timeout.)
   - **Evidence.** Probe B-loop, `logs\vb_loop.txt`:
     - the teardown hang is interrupted at its budget;
     - `outer_busy`'s finaliser never runs, and its thread is stopped only by the leak reaper;
     - the next test that requests `outer_busy` gets **the same, already-stopped instance**: event `next test got Busy serial 1 stopped=True alive=False`, then `assert not True`.
   - **Why.** pytest 9.1.1 `FixtureDef.execute` (`_pytest/fixtures.py` ~1190-1206) returns `cached_result` on a key hit (`None == None` for unparametrised fixtures) and registers no new finaliser. So every later test that uses such a fixture gets the stale object. This includes pytest's own `monkeypatch` and `tmp_path` if they were among the skipped finalisers.
   - **Impact.** The hung test itself is named correctly and first, and threads are still stopped (R1/R2 hold). But later results in the same run can be misleading.
   - **Suggestion.** Document it next to the budget. Or, after a teardown `TestTimeout`, either take the hard-exit path or finish the remaining fixture definitions.
2. **MINOR: the worst-case per-test bound grew to timeout + grace + budget + grace (+ margin) = 190/200 s, and neither the report nor the header says so.**
   - The header still says "hard exit 20 s later, faulthandler backstop 10 s after that" (`conftest.py:795-797`) and does not mention the teardown budget.
   - My arithmetic (above): ≈ 28 of 35 min for 5 runs with a hang in each. That fits with about 7 min of margin, provided the runner's full run stays ≤ ~215 s.
   - Suggestion: add the budget to the header line and the bound to the ci.yml comment or the report.
3. **MINOR (not caused by WP18; a candidate for M-15): `test_control.py::test_rate_limit_refuses_the_excess_with_a_warning` has almost no margin.** It failed once in my desktop run.
   - The server pauses ≥ 50 ms after each refusal. 12 inter-refusal pauses therefore make `elapsed ≥ ~0.60 s`, while the assertion needs `13 ≤ 20·elapsed + 1`.
   - `elapsed` is measured with `time.monotonic`, which ticks in 15.6 ms steps on Windows under 3.12. `control.py:303` says so itself.
   - Instrumented copies, 12 runs each: the margin is 0.18–0.27 refusals (≈ 9–13 ms) on **both** main c11fff0 and wp/18. 0 of 15 plain repeats failed on each.
   - The test and `control.py` are unchanged by WP18.
   - The WP18 machinery worked as intended here: `+++ FAILED [23:50:05] … (call)` was written at once with the full text.
   - Suggestion for the PM: record it under M-15, and fix it with `perf_counter` or a margin in a follow-up.
4. **Note, no finding.** The fallback pattern `(\S+)` cuts a parametrised id that contains a space at the space. The old pattern did the same, and the primary `+++` pattern `(.+)` is not affected. The new `workflows.test.js` collect case does not discriminate the `collect` alternative of the primary pattern (the fallback covers it); it does discriminate the fallback change.

## Approval rationale

- Round 1's two MAJOR findings are fixed, and I verified the fixes with the original probes and 11 new adversarial probes:
  - F1: a healthy teardown after a timeout is never cut short, and a hung one still ends within budget + grace (+ margin);
  - F2: a leak is caught, attributed and stopped even when a finaliser raises.
- F3 and F4 are fixed.
- Setup and call timeouts are still immediate. No INTERNALERROR.
- The WP17 guards (watchdog, backstop, exit guard, exit watcher, job object) still work.
- All regression runs are green, apart from one pre-existing timing flake that WP18 did not cause.
- Every MUST requirement (R1–R9) passes. There are zero BLOCKER and zero MAJOR findings. Three MINOR findings remain, listed above.

**Leftover processes:** none. A `Win32_Process` search for command lines under `verify\WP18`, `scratch2` or `vtol-wf-` returns nothing. The probes' hard exits and the job object ended everything I started, including the probe grandchild, PID 3808. I stopped no process by hand.
