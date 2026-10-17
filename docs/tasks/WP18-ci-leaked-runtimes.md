# WP18 — GitHub Windows run: leaked GCS runtimes starve the suite; DACL test fails on the runner

- **Worktree:** `S\wt\WP18`
- **Branch:** `wp/18` (from `main` at 9c20d6f, which already contains WP17)
- **Files you own:**
  - `gcs/tests/**`, `gcs/conftest.py`, `gcs/pyproject.toml` (test config only)
  - `gcs/tools/bridge_sim.py`
  - `gcs/vtolgcs/**`, only where a test-isolation, shutdown or CPU fix needs it. Every product change must be listed and justified in your report.
  - `.github/workflows/*.yml`, `test/ci/**`
  - `docs/relay/OPEN-ITEMS.md` (row edits only), `gcs/README.md` (test section only)
  - `docs/tasks/reports/WP18-IMPLEMENTATION.md`

Read first:
- `01-COMMON-CONTEXT.md`
- the WP17 brief and both reports: `docs/tasks/WP17-ci-runner-hang.md`, `docs/tasks/reports/WP17-IMPLEMENTATION.md`, and `WP17-VERIFY-round1.md` / `-round2.md`
- the OPEN-ITEMS rows M-15, M-16 and M-17

## Evidence: first GitHub run with the WP17 guards (commit 9c20d6f, run 39061961482)

The PM has downloaded the logs:
- `S\ci-logs\build-job.txt` is the full job log.
- `S\ci-logs\art\build-tests.txt` and `S\ci-logs\art\pytest-timeouts.txt` are the uploaded pytest-logs artifact.

Read them yourself; the summary below is the PM's interpretation, not proof.

- **Runner:** `windows-2025`, Python 3.12.10, step "Tests, headless-safe suite". The step failed after 6 min instead of hanging 40 min, so WP17 worked as intended.
- **First failure:** at 19:20:10, `tests/test_control.py::test_pipe_dacl_is_user_only_and_remote_clients_are_rejected` → **FAILED**. Its failure text was **never printed**, because the session later died with an INTERNALERROR before the summary.
- **Then:** `tests/test_control.py::test_concurrent_stop_and_resume_from_two_clients` started at 19:20:19 and at 19:22:19 hit the 120 s test timeout (`+++ TIMEOUT`).
  - The main thread was **inside pytest's own failure-report formatting** (`_format_failed_longrepr` → `ast.walk`), i.e. that test had already failed or raised, and pytest could not finish formatting the traceback in 100+ s.
  - The `TestTimeout` from conftest was then raised inside pytest's hook, which became `INTERNALERROR> conftest.TestTimeout`, ending the session at 19:24:56.
- **At the timeout and again at the exit guard** (`+++ EXIT GUARD`, non-daemon threads: `[]`), the process still had **several complete GCS runtimes running as daemon threads**:
  - at least two each of `control._accept_loop` and `control._admit/_serve`;
  - `sender._run` (in `protocol.pack` → `crc16_ccitt_false`, and in `timing_win.wait_until`);
  - `runtime._monitor_loop`, `receiver._run`, `session_log._run`;
  - **two `bridge_sim.run`** threads.

  None of them belongs to the test that was running. They were leaked by earlier tests.
- **`timing_win.Waiter.wait_until` ends in a pure-Python busy spin** (`while time.perf_counter() < deadline: pass`) that holds the GIL. CRC-16 is computed in pure Python per packet.
- **Exit:** the process did not exit 60 s after the session ended, presumably because the busy daemon threads keep contending for the GIL during finalisation. The faulthandler backstop ended it with exit 1.
- **PM's working hypothesis:** this is probably also the 40-minute "hang" of the first run. It was not a deadlock; tests that fail on the runner (DACL first) skip their teardown or leave runtimes and bridge simulators running. Their busy threads starve the main thread of the GIL on the small runner VM, until everything crawls. Locally nothing fails, so nothing leaks and the suite passes.

Confirm or refute this hypothesis with evidence.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **No leaked runtimes.**<br>- Every test or fixture that starts a GCS runtime, sender, receiver, control server, session log or `bridge_sim` must stop it and join its threads **even when the test fails or times out**. Use fixtures with finalisers or context managers, not trailing `stop()` calls in the test body.<br>- Find every place this is not true today. List them in the report. |
| R2 | MUST | **Leak detector.**<br>- Add a per-test check in `conftest.py`: after teardown, any thread started during the test that is still alive after a short join grace (e.g. 2 s) is reported **by name, with its stack**. That test is then marked failed (or errored) with a clear message naming the leaking test.<br>- Thread names: give the product's threads descriptive names if they don't have them (product change allowed; list it).<br>- Leaked threads must not be able to slow later tests. Choose a sensible way, e.g. ask the owning object to stop, or note them, and justify your choice.<br>- Self-test: a deliberately leaking test is named. |
| R3 | MUST | **The DACL test on the runner.**<br>- Find out why `test_pipe_dacl_is_user_only_and_remote_clients_are_rejected` fails under the GitHub runner account. That account is `runneradmin`, an **elevated administrator**; the service runs in session 0 with no interactive desktop. Likely causes include the owner SID of objects created with an elevated token being `BUILTIN\Administrators`, extra ACEs, or the "remote client" simulation behaving differently.<br>- Reason from the code and the Windows rules. You cannot get an elevated runner locally. **Do not** run anything elevated on the owner's PC, and do not change system settings.<br>- **Security must not be weakened.** The pipe must still admit only the current user, and remote clients must still be rejected. If the test's expectation is wrong for elevated tokens, make it correct for both cases and explain why that is still secure. If the product is wrong under an elevated token, fix the product.<br>- If you cannot determine the cause with confidence, make the test print everything needed to diagnose it on the next run: the token's user, owner, groups and elevation, and the actual DACL as SDDL. **Name the uncertainty in the report.** |
| R4 | MUST | **Failures must never be lost.**<br>- Every failure's full text (longrepr) is written to the log **when that test finishes**, not only in the end-of-session summary. For example, a `pytest_runtest_logreport` hook writes it immediately to `pytest-logs/` and to stdout.<br>- The workflow annotation names **every** failed test id (from the `FAILED`/`ERROR` lines), not only "pytest failed". |
| R5 | MUST | **The timeout must not cause an INTERNALERROR.** `TestTimeout` may only be raised while the main thread is running the test itself (setup/call/teardown of the item). If it is not (for example, it is inside pytest's own report hooks), use the hard-exit path instead, after dumping the stacks. Cover this with a self-test. |
| R6 | MUST | **CPU use of the sender spin.** Measure (and report) how much CPU and GIL the `wait_until` spin and the per-packet pure-Python CRC take at the real send rate, on this PC.<br>- If the spin holds the GIL for a significant fraction of each period, reduce it without hurting the timing that the timing tests and the plan require. For example: shorter spin, `time.sleep(0)` yields inside the spin, or a table-driven CRC.<br>- Keep the existing timing tests green and report before/after jitter numbers.<br>- This matters for the field laptop too (battery and UI responsiveness). |
| R7 | MUST | **Settle M-17 (WP17 verification round-2 minors):**<br>- F-A: the hang-annotation regex `Timeout \([0-9:.]+\)!` without the anchor, plus a teardown case in `workflows.test.js`;<br>- F-B: `CHILDREN.keep` also keeps descendants;<br>- F-C: an `IsProcessInJob` re-check before killing by PID.<br>Update the M-17 row: closed, or what remains. |
| R8 | MUST | **Make it fail locally the way it fails on CI.** Add a reproduction that forces the DACL test (or any earlier test) to fail locally, e.g. an environment variable that makes one test fail in a controlled way. Show that with R1/R2/R5 in place the rest of the suite still completes at normal speed, the failure is named and the process exits promptly.<br>Report the timings with and without the fixes (without = current main), using a throw-away copy for the "without" run. |
| R9 | MUST | **All green:**<br>- normal `pytest gcs protocol` on the owner's desktop;<br>- CI mode (`CI=true GITHUB_ACTIONS=true`, stdin NUL, real non-venv Python if available);<br>- `node --test test/` with `VTOL_JSDOM=S\jsenv\node_modules\jsdom`;<br>- `workflows.test.js`;<br>- all `--check` scripts, `check-links`, `check-images`, `check-colours`.<br>Update `gcs/README.md` (test section) and OPEN-ITEMS (M-15 if this explains it, M-16, M-17). |

## Rules

- Stop only processes **you** started, and only **by PID**. Never kill by image name (`taskkill /IM`, `Stop-Process -Name`).
- No UI windows on the owner's desktop except the normal interactive tests, at most 2 normal full runs. No stress loops.
- **No pushes** and no network writes. The PM pushes after verification.
- Commit on `wp/18` with the trailers from `01-COMMON-CONTEXT.md`.
- Report: `docs/tasks/reports/WP18-IMPLEMENTATION.md`. Include the evidence for or against the PM hypothesis, every leak site, the DACL analysis, every product change with its reason, measurements and test runs.
