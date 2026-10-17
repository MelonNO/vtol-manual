# WP17 verification — round 1
VERDICT: REJECTED

Worktree `S\wt\WP17`, branch `wp/17`, HEAD `4efd572`, base `0909714` (= current `main` of `S\repo\vtol-manual`).
Verifier work: throw-away clones `S\verify\WP17\clone` (wp/17), `S\verify\WP17\base` (0909714) and `S\verify\WP17\mergetest`; hang harness `S\verify\WP17\hang_harness.py`, logs in `S\verify\WP17\hangs\` and `S\verify\WP17\run-*.txt`. Nothing in the worktree was changed. No UI smoke tests were run. Nothing was written to the real `%APPDATA%\vtol-gcs` (it does not exist; the CI-mode runs used `APPDATA=S\verify\WP17\appdata-ci`). The only processes killed were ones I started (the harness's pytest trees and one orphan from my own scenario, by PID).

## Scope

Changed files (14): `.github/workflows/ci.yml`, `.github/workflows/gcs-build.yml`, `gcs/conftest.py`, `gcs/tests/{test_control,test_controller,test_main_cli,test_test_guards,test_ui,test_video}.py`, `test/ci/workflows.test.js`, `docs/relay/OPEN-ITEMS.md` (2 rows added), `docs/tasks/reports/WP17-IMPLEMENTATION.md`, plus `README.md` and `gcs/README.md`, which the PM allowed. Everything is in scope. `gcs/pyproject.toml` is unchanged; the markers are registered in the conftest. Commit trailers are fine.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 per-test timeout + stack dump; subprocess timeouts; kill in teardown | **FAIL (partial)** | `gcs/conftest.py:304-348` (`_Watchdog`, a **Python** thread), `:419-430`, `:433-444`, `:454-465`; `test_test_guards.py` | Works for every hang that releases the GIL: sleep, blocked join, polling, a hanging subprocess, a grandchild holding a pipe, a leaked non-daemon thread at exit, a sleeping atexit handler. Each is named, its stacks are dumped and it fails or exits 1 within the limit (table below). It does **not** work for a hang in native code that holds the GIL: no timeout, no dump and no exit, in a test or at interpreter exit. See F1 (MAJOR). Orphaned grandchildren can outlive their test (F2). |
| R2 live names, unbuffered, step timeouts below job timeouts, upload `if: always()` | PASS | `ci.yml:107-110`, `:152-163`, `:188-190`; `gcs-build.yml:57-64`, `:75-77`; `conftest.py:408-416` (START lines) | The steps ran verbatim (below). Static guards: `workflows.test.js:110-136`. I made 10 mutations and every one was caught. |
| R3 `interactive_desktop` marker, detection, precise reason, headless split | PASS | `conftest.py:62-110`, `:378-405`; 8 markers (§2.1 of the report); split `test_ui.py:130-215` | Detection is correct: `UOI_NAME=2`, `UOI_FLAGS=1`, `WSF_VISIBLE=1`, session 0, env overrides, `CI=false` is not CI. On this desktop the header says `RUN (interactive window station WinSta0, session 1)` and all 6 non-smoke interactive tests ran and passed. With CI env it says `SKIPPED (GITHUB_ACTIONS=true: …)`, with the precise reason per test. No headless safety assertion is lost; the split even adds one (an untyped `stop` is refused). The pygame test is marked defensively rather than from need (F6). |
| R4 reproduce locally | PASS (plausible, honest) | report §4.2; implementer's logs in `S\wp17run\` checked | The logs match the claims: pre-winsta 681 passed plus 1 failure from the extract, pre-runner 682 passed, new-runner-ci 1 failed (the stalled-handshake race), ci2 681 passed / 8 skipped, build 681 / 8 deselected, winsta 681 / 8 skipped, forced 6 passed / 2 skipped. No elevation was used. The hypothesis is plausible. Its mechanism (SDL deadlock while the GIL is held) is exactly the case the new watchdog cannot catch (F1). |
| R5 build runs the headless-safe suite; ×5 keeps the same skips; job timeouts | PASS | `gcs-build.yml:37` (30), `:63` `-m "not interactive_desktop"`; `ci.yml:123` (45), `:161` (5 runs, full suite) | — |
| R6 green locally, workflow checks, node green, PID-only cleanup | PASS | runs below | — |
| R7 OPEN-ITEMS row with the command | PASS | `docs/relay/OPEN-ITEMS.md` M-16 (8 tests, why, both commands), follow-up row in the MINOR table | The command count "8 passed" is consistent with the markers. |
| R8 (PM addendum) Node 24 action majors, verified and cited; image pinning; guard | PASS | `ci.yml:6-14`, `gcs-build.yml:4-12`, `workflows.test.js:153-173` | Verified independently below. |

### R1: deliberate-hang proof (`hang_harness.py`, WP `conftest.py`, `VTOLGCS_TEST_TIMEOUT=3`, `VTOLGCS_TEST_GRACE=4`, `CI=true GITHUB_ACTIONS=true`, stdin NUL)

| Scenario | Result | Verdict |
|---|---|---|
| `time.sleep(600)` in the test | `+++ TIMEOUT` with all stacks (the main thread's names `test_sleeps`), then the hard exit at 7.3 s, exit 1 | OK |
| polling loop | FAILED `conftest.TestTimeout` at 3 s, the next test PASSED, exit 1 | OK |
| main thread `join()`s a blocked thread | dump (both threads), hard exit at 7.2 s, exit 1 | OK |
| `subprocess.run(sleeper)` without a timeout | 2 processes killed (launcher plus interpreter), FAILED, the run goes on, exit 1 | OK |
| child's grandchild holds the capture pipe | killed, FAILED at 3.3 s, exit 1 | OK |
| leaked non-daemon thread (hang at exit) | `+++ EXIT GUARD … non-daemon threads: ['Thread-1 (wait)']` with stacks, exit 1 at 64 s | OK |
| atexit handler `time.sleep(600)` | EXIT GUARD, exit 1 at 60 s | OK |
| **native call holding the GIL in a test** (`ctypes.PyDLL('kernel32').Sleep(45000)`) | **45 s of silence with a 3 s timeout.** Only after the call returned was the test marked FAILED, and the dump shows the *next* test's stack, not the hang site. An endless one is never reported. | **NOT OK (F1)** |
| **native call holding the GIL at exit** (atexit `PyDLL Sleep(100000)`) | no EXIT GUARD; the process ended by itself after 100 s with **exit 0** | **NOT OK (F1)** |
| orphan: a child spawns a sleeper and exits | the test PASSED and the **orphan was still alive** afterwards (I killed it by PID) | **gap (F2)** |
| normal test with a subprocess | passes, nothing reported | OK |

Control experiment: `faulthandler.dump_traceback_later(3, exit=True)` before the same GIL-holding call dumps the exact frame and exits 1 after 3 s (`S\verify\WP17\fh_demo.py`). The mechanism the brief suggests covers this case.

**Unrelated processes.** I reviewed `_Children.alive()` (`conftest.py:187-226`). Only processes created by `subprocess.Popen` in the test process are roots. A reused root PID is detected by its creation time. A descendant is accepted only if its PPID matches and it is not older than its parent. A PID that was reused under a still-recorded root is therefore rejected. I found no path to an unrelated process. The only theoretical one: a root dies, its PID is reused and freed again, and a child of the second owner remains. That is negligible.

**Normal tests not slowed.** The same 385 pure tests take 6.97 / 6.87 s on base and 6.88 / 6.91 s with the WP conftest. The full suite takes 93.4 s on base and 107–110 s on the WP. The difference (about 16 s) is the 4 new guard self-tests (13.7 s) plus the new headless split test.

## R8: action versions (checked on GitHub, 2026-10-17)

- **`action.yml` `runs.using`** (raw.githubusercontent.com, at each tag): `checkout@v7` node24, `setup-node@v7` node24, `setup-python@v7` node24, `upload-artifact@v7` node24, `download-artifact@v8` node24.
- **No newer majors:** `checkout`, `setup-node`, `setup-python` and `upload-artifact` have no `v8` or `v9` tag (404); `download-artifact` has no `v9` (404).
- **Latest releases** (API): checkout v7.0.1 (2026-07-20), setup-node v7.1.0 (2026-10-08), setup-python v7.0.0 (2026-07-20), upload-artifact v7.0.2 (2026-10-07), download-artifact v8.0.2 (2026-10-07). This matches the workflow headers exactly.

**Breaking changes, checked against our use:**

| Action | Breaking change | Our use | Impact |
|---|---|---|---|
| setup-python v7 | removes `pip-install`; removes EOL Pythons; moves to ESM | `python-version: 3.12` only (3.12 is not EOL) | none |
| download-artifact v8 | a digest mismatch is now an error by default; non-zip downloads are no longer unzipped (`Content-Type` check; `skip-decompress`) | it downloads by `name:` an artifact that `upload-artifact@v7` zipped as usual (`archive` defaults to true) | unchanged; failing on a mismatch is the safer default |
| upload-artifact v7 | adds `archive: false`; moves to ESM | `archive` unused | none |
| checkout v7 | blocks fork-PR checkout for `pull_request_target` / `workflow_run` | neither trigger used | none |
| setup-node v7 | ESM; removes the dummy `NODE_AUTH_TOKEN` | no npm publishing | none |

**Images.** The runner-images README maps `windows-latest` to `windows-2025`, so pinning `windows-2025` changes nothing today. GitHub's changelog of 2026-09-17 ("Ubuntu 26 generally available and latest migration") moves `ubuntu-latest` to 26.04 between 2026-10-19 and 2026-11-19, and recommends pinning `ubuntu-24.04` to opt out. Pinning both is well justified while a CI hang is being diagnosed. Note: the build job's display name is now "Build vtol-gcs (windows-2025)", so any branch-protection rule that names the old check must be updated.

## Flaky-test fix (`test_control.py:418-420`): race analysis

In `control.py:498-511` (`_admit`), the order is: `handshake_failures += 1` (under the lock), then `log.warning(...)`, then `_close(conn)`, and only then the `finally: _pending -= 1`.

All `MAX_PENDING` stalled handshakes hit the same 0.5 s deadline together. Each thread counts its failure and then queues on the logging handler lock and the pipe close. So `handshake_failures >= MAX_PENDING` can become true while all the slots are still counted as pending. In that case the accept loop (`:487`) closes the new client, and the test sees `cannot connect (EOFError)`. That is exactly the failure in `S\wp17run\new-runner-ci.txt:2167`.

Waiting for `_pending == 0` is the correct condition. The 2 extra stalled clients were refused while the slots were full, or, if they were admitted, they time out too and are included. The product behaviour is correct, because refusing while every slot is busy is by design, so changing only the test is right. My 20 + 20 repeats (old / new) did not reproduce the rare race (0/20 each). That is consistent with the implementer's 2 in about 51.

## Contract results
No contract is touched (C2 and the control channel are unchanged; the test changes only read `_pending`).

## Tests run (commands + results)

| # | Command / context | Result |
|---|---|---|
| 1 | `venv python -m pytest gcs protocol -v -p no:cacheprovider -rfEs --durations=15` (clone, desktop, interactive tests RUN) | 687 passed, 2 skipped (UI smoke), 109.7 s |
| 2, 3 | same, `-q` | 687 passed, 2 skipped (107.2 s, 108.2 s) |
| 4 | base `0909714`, same as 1 | 682 passed, 2 skipped, 93.4 s |
| 5 | CI mode: `CI=true GITHUB_ACTIONS=true PYTHONUNBUFFERED=1 VTOLGCS_TEST_DUMP_DIR=pytest-logs`, stdin NUL, the ci.yml command line `python -u -m pytest gcs protocol -v -p no:cacheprovider -rfEs --tb=long --durations=10` | 681 passed, 8 skipped (6 with the precise CI reason, 2 UI smoke), 84 s; 689 START lines |
| 6 | the gcs-build test step **verbatim** (`$ErrorActionPreference='stop'` + step + `exit $LASTEXITCODE`, Windows PowerShell 5.1 because pwsh 7 is not installed), CI env, empty stdin, venv python first on PATH | exit 0, 681 passed, 8 deselected; `pytest-logs/build-tests.txt` kept |
| 7 | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv> node --test test/ci/workflows.test.js` | 7/7 pass. This includes the ×5 pwsh step run verbatim on failing, hanging and passing trees, and the build step run verbatim. |
| 8 | 10 workflow mutations, `node --test --test-name-pattern=static`: step timeout 45, `ubuntu-latest`, `download-artifact@v7`, upload `if: success()`, no `-m`, build job 40 min, `-q`, buffered, dump dir moved, `checkout@v7.0.1` | each one fails the static tests (fail 1) |
| 9 | `node --test test/` without jsdom / with `VTOL_JSDOM` | 310 tests: 301 pass + 9 skipped / 310 pass, 0 skipped, 0 fail |
| 10 | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check` | all OK |
| 11 | `pytest gcs/tests/test_test_guards.py` ×5 | 4 passed each time (13.7 s) |
| 12 | stalled-handshake test ×20 on base and ×20 on WP (`CI=true`, stdin NUL) | 0/20 and 0/20 failed |
| 13 | merge `wp/17` into `S\repo\vtol-manual` main (`0909714`) in a throw-away clone | clean (main is the merge base); 14 files, +1201 / −103 |

## Smoke tests
Not a web WP: there are no page changes. The workflow steps were executed verbatim (rows 6–7). UI smoke tests were deliberately not run, because they open Tk windows on the owner's desktop.

## Findings

1. **MAJOR — R1: a native hang that holds the GIL is never timed out, dumped or ended.** `gcs/conftest.py:304-348` and `:454-465`.
   - **What is wrong.** The per-test watchdog and the exit guard are Python threads, so they need the GIL. When the test (or a thread of it, or an atexit handler) blocks inside a C function that does not release the GIL, the watchdog cannot run:
     - Proven: with a 3 s timeout there was 45 s of silence. The late dump then shows the wrong stack, and an endless hang is never reported.
     - Proven: at exit, there is no EXIT GUARD and the process exits 0.
   - **Why it matters.** This is not hypothetical for this suite. pygame-ce 2.5.8 calls `SDL_InitSubSystem(SDL_INIT_JOYSTICK)` (`joystick.c` `init`) and `SDL_QuitSubSystem` / `SDL_Quit` with the GIL held. That is the implementer's own leading hypothesis for the CI hang. Other C extensions behave the same way.
   - **What CI sees today.** Such a hang runs on until the 35 / 15 min step timeout. Only the last `START` line names the test; there is no stack and no FAILED line. R1 asks that *every* test get a hard timeout with a full stack dump, and the brief names `faulthandler.dump_traceback_later` for this reason: its watchdog is a C thread that needs no GIL.
   - **Overstated claims.** The report and docs claim more than the code does:
     - `test_test_guards.py:60-61` says "blocked in a C call… an asynchronous exception cannot interrupt this", but `time.sleep` releases the GIL.
     - `gcs/README.md` (the guard table) says "still blocked (for example inside a C call)".
     - The report's R1 row says "blocked in C".
   - **Expected.** Keep the current watchdog, which gives the nice per-test FAILED report, and add a GIL-independent backstop:
     - per test, `faulthandler.dump_traceback_later(timeout + grace + a few s, exit=True, file=<dup'd real stdout fd>)` in the protocol wrapper, cancelled in its `finally`;
     - in `pytest_sessionfinish`, also arm `dump_traceback_later(EXIT_GRACE_S + a few s, exit=True)`. faulthandler is finalised before the C-level `Py_AtExit` hooks such as `pg_atexit_quit`, so this covers atexit and thread-shutdown hangs, not the very last C hooks. Document that remainder.
   - **Add a self-test** with a GIL-holding call, e.g. `ctypes.PyDLL('kernel32').Sleep(...)`, and correct the wording in the docs and report.

2. **MINOR — "No process outlives its test" is overstated: orphans of an exited intermediate process escape.** `conftest.py:202-211`.
   - **What happens.** If a test's child spawns a process and exits, the tree walk finds the orphan only while the dead root's PID still appears as some live process's PPID. In the venv the root is the launcher, its child is the real interpreter, and both are gone. In my run the orphan was still alive after the test.
   - **Not tracked at all:** processes started with `_winapi.CreateProcess` (`multiprocessing`), `os.startfile` or `os.system`.
   - **Expected.** Either a Job object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, assign each Popen child), or recording descendants during the test. At minimum, state the limit in the conftest docstring, `gcs/README.md` and the report.

3. **MINOR — misleading watchdog line.**
   - **What is wrong.** `conftest.py:336-338` prints "TestTimeout raised in the main thread; hard exit in N s" *before* re-checking `done`. In the GIL scenario it appeared after the session summary although nothing was raised.
   - **Expected.** Print it only when `_async_raise` was actually called.

4. **MINOR — latent trap for future fixtures.** `CHILDREN.kill_all()` after every test (`conftest.py:427`) also kills processes started by a module- or session-scoped fixture after its first test. No fixture does this today (`test_api.py:19` starts no process). Document it, or exempt fixture-owned processes.

5. **MINOR — the verbatim pwsh step tests run under Windows PowerShell 5.1** (`workflows.test.js:224`, `:275`), while GitHub runs `shell: pwsh` (7.x). Native-stderr handling under `$ErrorActionPreference='stop'` and the default encoding of `Tee-Object` differ. This approach predates WP17 (WP10); it is worth using `pwsh` when it is present.

6. **MINOR (judgement, transparently reported) — `test_real_pygame_thread_starts_and_stops` is marked `interactive_desktop` although it passed in a non-interactive window station.** The real reason is F1: an in-process SDL hang cannot be caught. Real SDL initialisation is still exercised headless on CI by the CLI tests without `--sim` (`test_main_cli.py:184`, `:197`, `:218`, `:227`), which are bounded by `timeout=30`. That is good, and the report could say so. Once F1 is fixed, reconsider running this test on CI with a `timeout` marker.

7. **MINOR — the path to the results file is not given.** `gcs/README.md` ("record the result in `TEST-RESULTS.md`") does not say where the file is. It is `docs/relay/TEST-RESULTS.md`.

## Approval rationale / items to fix

REJECTED because of **F1 (MAJOR)**. The R1 MUST requirement ("every test gets a hard timeout … fails with a full thread stack dump") does not hold for native hangs that hold the GIL. That is exactly the class of the leading hypothesis (pygame/SDL). For such a hang the CI log would still show only a START line until the step timeout, and the report and docs claim C-call hangs are covered.

The fix is small: add a `faulthandler.dump_traceback_later(..., exit=True)` backstop per test and after the session, add a self-test, and correct the wording.

Everything else is solid:
- R2, R3, R5, R6, R7 and R8 pass.
- The workflows ran verbatim and the static guards catch every mutation I tried.
- Action versions, Node 24 runtimes and the image pinning were verified on GitHub.
- The flaky-test fix is correct.
- The interactive marking and the headless split lose no safety assertion.
- Every regression run is green, and the merge into main is clean.

F2–F7 are MINOR and may remain if listed, though F2's documentation should be corrected together with F1.
