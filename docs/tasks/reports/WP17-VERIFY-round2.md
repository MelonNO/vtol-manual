VERDICT: APPROVED
# WP17 verification — round 2

- **Worktree:** `S\wt\WP17`, branch `wp/17`, HEAD `ab1c0ad` (round 2) on `4efd572` (round 1). Base: `0909714`, which is still `main` of `S\repo\vtol-manual`.
- **Unchanged by me:** the worktree and `S\repo`.
- **My work:** a throw-away clone at `S\verify\WP17\r2-scratch\clone` (ab1c0ad); round-1 base clone `S\verify\WP17\base` (0909714); merge clone `S\verify\WP17\r2-scratch\mergetest`.
- **Harnesses:**
  - `S\verify\WP17\r2_harness.py` (GIL hangs)
  - `S\verify\WP17\r2_jobsafety.py` (job object)
  - `S\verify\WP17\r2_fullrun.py` (full runs with process snapshots by PID)
  - `S\verify\WP17\r2-scratch\pyatexit_run.py` (C-level `Py_AtExit` hang)
- **Logs:** under `S\verify\WP17\r2-scratch\`.
- **Windows:** no UI smoke test was run. The only windows opened were from one normal desktop full-suite run of the WP, plus one of base.
- **Processes:** I stopped only my own processes (the harness's sibling sleepers, by PID).
- **Not mine, not touched:** two pre-existing `python.exe` processes are still running: PID 6564 and its child 20120. They are `wt\WP16\gcs\tools\bridge_sim.py --port 56668`, started at 14:43, before this verification.
- **APPDATA:** the real `%APPDATA%\vtol-gcs` still does not exist. The CI-mode runs used `APPDATA=r2-scratch\appdata-ci`.

## Scope
- The same 14 files as round 1 (`git diff --name-only main...ab1c0ad`).
- Round 2 changes 9 of them: both workflows, `gcs/conftest.py`, `test_controller.py`, `test_test_guards.py`, `workflows.test.js`, `OPEN-ITEMS.md`, `gcs/README.md` and the report. All are in scope.
- The commit trailers are present.
- The action versions are unchanged since round 1: there are no `uses:` diff lines. They were verified on GitHub on 2026-10-17 in round 1 and are still the current majors.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 per-test hard timeout + full stack dump; subprocess kill | **PASS** | `conftest.py:405-413` (`_arm_backstop`), `:543-560` (per-test arm/cancel), `:563-568` (re-arm), `:592-633` (exit backstop + watcher), `:181-209` (job) | Every GIL-holding hang I built was dumped and exited 1 within the documented bound (table below). This includes the case round 1 failed on. |
| R2 live names, unbuffered, step < job timeouts, `if: always()` upload | PASS | `ci.yml` ×5 step (35 / 45 min), `gcs-build.yml` test step (15 / 30 min); uploads `if: always()` | The dump goes to the dup'd real stdout, which `2>&1 \| Tee-Object` captures; `.err` was empty in every scenario. The hang annotation misses one case (F-A, MINOR). |
| R3 interactive_desktop marker, detection, headless split | PASS | 7 markers: `test_main_cli.py:371,427,470,505`, `test_ui.py:219,454,480` | The pygame test is unmarked and has `@pytest.mark.timeout(60)` (`test_controller.py:181`). The 7 remaining markers are the ones that really need a console, the foreground window or Tk windows. |
| R4 reproduce locally | PASS (unchanged) | — | — |
| R5 build = headless-safe suite; ×5 same skips; job timeouts ≤ 30 / ≤ 45 | PASS | unchanged | — |
| R6 green locally; workflow tests; node green; PID-only cleanup | PASS | runs below | — |
| R7 OPEN-ITEMS row | PASS | M-16 now lists 7 tests, says "all 7 must pass" and links `TEST-RESULTS.md`. New MINOR rows: "WP17 verify F5" and "WP17 guards" (collection/start-up hang not covered). | — |

### Round-1 findings

| Round-1 finding | Status | Evidence |
|---|---|---|
| **F1 MAJOR** (GIL-held native hang) | **FIXED** | Independent reproduction below. |
| F2 orphans | FIXED (job object) | `r2_jobsafety.py`: a leaked child is killed after its test. The harness `body` and `atexit` scenarios: the child is dead after the faulthandler exit, killed when the job closed. The self-test `test_orphans_a_grandchild` passes. |
| F3 misleading line | FIXED | `conftest.py:458-464`: "TestTimeout raised…" is printed only after `_async_raise`, inside the lock. Otherwise it prints "the test ended meanwhile". |
| F4 fixture processes | FIXED with a limit | `CHILDREN.keep` works for a single process. It does not cover that process's children (F-B). |
| F5 pwsh | FIXED | `workflows.test.js` `powershell()` uses pwsh when it is present. pwsh 7 is not on this PC, so the tests ran under 5.1 and printed that diagnostic. |
| F6 pygame marker | DONE, sensible | See "F6 decision". |
| F7 TEST-RESULTS path | FIXED | `gcs/README.md` links `../docs/relay/TEST-RESULTS.md`. |

### F1: independent reproduction (`r2_harness.py`)

Each scenario uses `ctypes.PyDLL('kernel32').Sleep(600000)` and runs with the WP conftest copy, `CI=true`, `GITHUB_ACTIONS=true` and stdin NUL. Timeouts are TIMEOUT 3 / GRACE 4 / MARGIN 5 / EXIT 6, so the expected bounds are 12 s per test and 6 / 11 / 16 s at exit.

| Scenario | Result | Stream |
|---|---|---|
| test body (it also starts a child sleeper first) | `Timeout (0:00:12)!`; the stacks show `line 9 in test_native_body`; exit 1 at 12.2 s; the child was dead afterwards (job closed) | stdout; `.err` empty |
| fixture teardown, test passed | `…PASSED [ 50%]Timeout (0:00:12)!`; the frame `in fx`; exit 1 at 12.2 s | stdout |
| fixture teardown, test failed (pytest's faulthandler plugin cancels; conftest re-arms) | `Timeout (0:00:11.984000)!`; the frame `in fx`; exit 1 at 12.2 s. The re-arm works. | stdout |
| failing test, then a GIL hang in the next test | dumped at 12 s; the frame `test_native_after_a_failure`; exit 1 | stdout |
| session-scoped fixture teardown | dumped at 12 s; the frame `in sfx`; exit 1 | stdout |
| a background thread holds the GIL, the main thread sleeps | dumped at 12 s; both frames; exit 1 | stdout |
| atexit handler (it also starts a child) | `END of session` printed, then `Timeout (0:00:11)!`; the frame `in <lambda>`; exit 1 at 11.3 s; the child was dead afterwards | stdout |
| non-daemon thread that takes the GIL at exit (`main_thread().join()`, then Sleep) | `Timeout (0:00:11)!`; the frame `in worker`; exit 1 at 11.2 s | stdout |
| **C-level `Py_AtExit` hook** that blocks (`msvcrt.getchar` on a pipe that stays open; faulthandler is already finalised there) | `+++ EXIT WATCHDOG: the test process 7776 still runs 16 s after its session ended…`; exit 1 at 16.2 s | stdout (pipe) |
| default settings (`R2_DEFAULTS=1`): test body / atexit / failed test + teardown | exit 1 at **150.2 s** / **70.2 s** / **150.2 s**. These match the documented 120+20+10 and 60+10. | stdout |
| normal test that leaves a child | the child is killed and listed; exit 0 in 0.3 s. The exit watcher did not delay the exit (the job killed it). | — |

The bundled self-tests also pass:
- `test_a_native_hang_holding_the_gil_is_dumped_and_exits_1`, about 5 s;
- `test_a_native_hang_at_interpreter_exit_ends_with_status_1[faulthandler|exit-watcher]`, 4.2 s and 6.3 s.

The `workflows.test.js` ×5 step and the build step run a GIL-hanging test verbatim and annotate it. The tests are real: they use real subprocesses, PyDLL and the exact step scripts.

### Job Object safety (`r2_jobsafety.py`)

**Setup.** The parent script starts an unrelated sibling sleeper, then runs pytest. In the "parentjob" variant, the parent first puts itself into its own `KILL_ON_JOB_CLOSE` job without breakaway, as an IDE or CI runner might.

**venv Python, plain and parentjob:**
- Header: `process cleanup after each test: job object`.
- During a test, the job members are only `[pytest itself, its fixture child, that child's interpreter]`.
- The parent and the sibling are alive after the run, in both variants. They are never members: a job only holds the processes created after the assignment, and its handle is unnamed and not inheritable.
- The leaked child is dead.
- `CREATE_BREAKAWAY_FROM_JOB` is refused (`PermissionError … WinError 5`), so nothing escapes. Product code does not use the flag (grep).

**Real (non-venv) Python with a parent job (CI-like):** the same results, and a process registered with `CHILDREN.keep` survives the following tests of its module.

**Exit watcher:**
- It is started in `pytest_sessionfinish` after the last per-test sweep and is registered with `keep`, so no per-test sweep can reach it.
- It is a job member, so it dies with the test process. A normal run exits at once: 0.3 s in the harness, and the full CI-mode runs printed `END of session` and exited with no `EXIT WATCHDOG`.
- Without a job it waits on the test process's handle and ends when that process ends, so it is never orphaned.

**Process snapshot before and after full runs** (PID plus creation time; `r2_fullrun.py`):

| Run | Processes created during the run and still alive |
|---|---|
| normal WP | 9: my own bash/sleep wait loops (`ppid` = my shell), their conhosts, and one SearchProtocolHost. **No python.exe and nothing descended from pytest PID 26232.** |
| CI-mode WP #1 | **0** |
| CI-mode WP #2 | **0** |
| base | 3 system processes |

### F6 decision (pygame/SDL test on CI)

**Sensible.** It turns the leading suspect into a diagnosis.

- **It ran on CI-like settings here.** It passed in both CI-mode runs.
- **SDL hang with the GIL held.** If SDL init hangs with the GIL held, the test's 60 s timeout puts the faulthandler backstop at 60 + 20 + 10 = **90 s**. The dump shows the controller thread's frame, the run ends with exit 1, and the START line names the test.
- **SDL hang without the GIL.** The test's own 10 s loop fails it, the controller thread is a daemon (`controller.py:230`), and an exit hang is ended at 60 / 70 / 80 s.

**Arithmetic, worst case:**
- **Build step** (15 min; job 30 min): about 1.6 min of suite (95 s locally in CI mode) + 90 s + 80 s exit ≈ 4.5 min.
- **×5 step** (35 min; job 45 min): 5 × (≈ 1.6 min + 90 s + 80 s) ≈ 22 min, in the worst case where it hangs in every run, both in the test and at exit.

Both bounds are well inside the step timeouts, so the logs are still uploaded.

The 7 remaining markers are correct: 4 console-input / Ctrl+C tests, 1 foreground-window and console-keys test, and 2 Tk-window smoke tests.

## Contract results
No contract is touched.

## Tests run (commands + results)

| # | Command / context | Result |
|---|---|---|
| 1 | `venv python -u -m pytest gcs protocol -v -p no:cacheprovider -rfEs --durations=10`, WP clone, normal desktop (interactive tests RUN), process snapshot | **690 passed, 2 skipped (UI smoke), 120.6 s**, exit 0; nothing killed after any test; no leftover process |
| 2 | the same on base `0909714` | 682 passed, 2 skipped, 93.1 s |
| 3, 4 | CI mode (`CI=true GITHUB_ACTIONS=true VTOLGCS_TEST_DUMP_DIR=pytest-logs`, own APPDATA, stdin NUL, the ci.yml flags `--tb=long`), WP clone | **685 passed, 7 skipped**, 95.9 s / 95.4 s; 692 START lines; `END of session (exit guards armed: 60 / 70 / 80 s)`, then an immediate exit 0; the pygame test PASSED; the 5 interactive tests skipped with the precise reason; 0 leftover processes |
| 5 | `r2_harness.py`: 10 scenarios, plus 3 with the default timeouts | see the F1 table: all exit 1 within their bound; normal → exit 0 |
| 6 | `r2_jobsafety.py`: venv plain, venv parentjob, real python parentjob | see the job-safety section |
| 7 | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv> node --test test/ci/workflows.test.js` | 7/7 pass (40.7 s; Windows PowerShell 5.1, with pwsh's absence printed as a diagnostic) |
| 8 | `node --test test/` with `VTOL_JSDOM=S\jsenv\node_modules\jsdom` | 310 pass, 0 fail, 0 skipped |
| 9 | `diagrams/build.js --check`, `gen-params-reference.mjs --check`, `gen-precache.mjs --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check` | all OK |
| 10 | the gcs-build test step **verbatim** (`$ErrorActionPreference='stop'` + step + `exit $LASTEXITCODE`, PowerShell 5.1, CI env, stdin NUL) on a test whose fixture teardown holds the GIL | step exit 1, the dump in the log, but no hang annotation (F-A) |
| 11 | trial merge of `wp/17` (ab1c0ad) into `main` (0909714) in a throw-away clone, `--no-ff` | clean; 14 files, +1532 / −104 |

**Overhead:**
- Normal: 93.1 s on base → 120.6 s on WP.
- The 7 guard self-tests take about 25 s together (6.4 + 6.3 + 5.2 + 4.2 + 3.3 s, and so on), plus the headless split test, which accounts for nearly all of the +27.5 s.
- CI mode: about 95 s.
- I saw no flakiness: every run was green.

## Smoke tests
Not a web WP. The workflow steps were executed verbatim (#7, #10). The UI smoke tests were not run because they open Tk windows.

## Findings

**F-A — MINOR. The hang annotation misses a GIL-held hang in a fixture teardown.**
- **Where:** `ci.yml` (×5 step) and `gcs-build.yml` (test step), the `$hang` pattern `'(^|\s)Timeout \([0-9:]+\)!|…'`.
- **What is wrong.** Two cases do not match:
  1. *Teardown after a passing test.* pytest `-v` leaves the result line open, so faulthandler's output follows `]` with no space: `gcs/tests/…::test PASSED [ 50%]Timeout (0:02:30)!`. The `(^|\s)` anchor does not match.
  2. *Teardown after a failing test.* The re-armed backstop has a fractional delay, so faulthandler prints microseconds (`Timeout (0:00:11.984000)!`), and `[0-9:]+` does not match.
- **Evidence:** run #10 annotated only `::error::pytest failed (exit code 1)`. Applying the step's own `Select-String` patterns to `r2-scratch\hangs\{teardown_pass,teardown_fail,session_teardown}.out` gives NO match.
- **Impact.** The run still fails, and the log and artifact hold the START line and the full dump naming the fixture frame (R1 and R2 hold). But the annotation, which the PM reads without logging in, does not name the test. The report's §7.1 claim "the workflows annotate a faulthandler … hang" is true for hangs in a test body and at exit, not for hangs in a teardown.
- **Expected:**
  - Use `Timeout \([0-9:.]+\)!` without the `(^|\s)` anchor, and/or round the re-armed delay up (`math.ceil`).
  - Add a teardown case to `workflows.test.js`.

**F-B — MINOR. `CHILDREN.keep(pid)` exempts only that PID, not its descendants.**
- **Where:** `conftest.py:218-221` and `:287`.
- **What is wrong.** With a venv (the owner's setup), `subprocess.Popen([sys.executable, …])` creates a launcher plus the real interpreter. Keeping the launcher's PID does not protect the interpreter: in `r2-scratch\jobs-venv\plain` the kept fixture's interpreter (3976) was killed after the module's second test, and the fixture's process died with it. With a non-venv Python, `keep` works. The same applies to any kept process that has children. No fixture uses `keep` today.
- **Expected.** Either exempt the kept process's descendants (in a job, a member whose parent chain reaches a kept PID), or document "register the PIDs of its children too / not with a venv launcher" in the docstring and `gcs/README.md`.

**F-C — MINOR. The job-object kill path has no check that a PID still belongs to the job at kill time.**
- **Where:** `conftest.py:281-291` and `:334-351`.
- **What is wrong.** The member list is read, then a full Toolhelp snapshot is taken, then each PID is opened and terminated. If a member exits in that window of a few milliseconds and Windows hands its PID to a new unrelated process, that process would be terminated. This is very improbable. The round-1 fallback guarded against reuse with creation times; the job path dropped that guard.
- **Expected.** After `OpenProcess`, call `IsProcessInJob(h, self.job)` and skip the process if it is not in the job.

**F-D — MINOR (notes, no action required unless convenient).**
- If `pytest.main()` is run in-process inside a long-lived host, the host itself is put into the kill-on-close job and stays there. Every process the host starts afterwards, including from other threads during the run, is swept after each test and killed when the host exits. This does not apply to `python -m pytest` or any IDE or CI that runs pytest as a subprocess. Worth one sentence in the docstring.
- Code that starts a process with `CREATE_BREAKAWAY_FROM_JOB` now fails under test with `WinError 5`, because the job does not set `BREAKAWAY_OK`. No product code does this.
- `_job_members` assumes a 64-bit `ULONG_PTR` layout. The runners and the PC are 64-bit.

## Approval rationale

APPROVED.

- **Round-1 MAJOR F1 is truly fixed.** Every GIL-holding hang I built ended with a dump (or the EXIT WATCHDOG line) on the captured stdout and exit status 1, within the documented bounds:
  - a test body, a fixture teardown after a pass or a failure, a session-fixture teardown, and a background thread;
  - an atexit handler and a non-daemon thread at exit;
  - a real C-level `Py_AtExit` hook;
  - with the default timeouts as well: 150 s per test, 70 s at exit.
- **The job object** cleans up orphans and never touched a process outside the suite's own tree: not the parent, not a sibling, and not with a parent already in a job. Breakaway is refused, normal runs leave no process behind, and the exit watcher is neither swept nor orphaned.
- **F3–F7 are addressed.** The F6 decision is sensible and fits inside the step timeouts with margin.
- **Every MUST requirement passes.** All regression checks are green, and the merge is clean.

F-A to F-D are MINOR. F-A, the missing annotation for teardown hangs, is a one-line regex fix and is recommended before or soon after merging.
