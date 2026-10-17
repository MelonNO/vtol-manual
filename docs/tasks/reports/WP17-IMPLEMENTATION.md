# WP17 — GCS test suite hangs on GitHub's Windows runners: implementation report

Branch `wp/17` · Files: `gcs/conftest.py`, `gcs/tests/**`, `.github/workflows/*.yml`, `test/ci/workflows.test.js`, `docs/relay/OPEN-ITEMS.md` · Contracts unchanged · Date 2026-10-17

## 1. Summary

- **The suite can no longer hang a CI job silently.** `gcs/conftest.py` now:
  - gives every test a hard timeout (120 s, or longer with `@pytest.mark.timeout(s)`);
  - on a timeout, prints `+++ TIMEOUT [time] <test id>` and the stacks of all threads, kills the tests' processes, raises `TestTimeout` in the main thread and reports the test FAILED. If the main thread is still blocked 20 s later, the process exits with status 1;
  - kills, by PID, every process a test started that is still alive after the test;
  - prints a `START <test id>` line per test on GitHub;
  - adds an exit guard: if the interpreter has not exited 60 s after the session ends, it dumps the stacks and exits.
- **Interactive-desktop tests.** A new `interactive_desktop` marker is on the 8 tests that need a real console, the foreground window, windows or the real SDL stack. They skip themselves where there is no interactive session: `GITHUB_ACTIONS` or `CI` set, session 0, or a window station that is not interactive. On the owner's PC they still run. One test was split so its headless safety part runs in CI.
- **Workflows.** Every pytest step now runs with `-v` and unbuffered output, and has a step timeout below its job timeout. The watchdog's stack dumps go into the uploaded log folder, and the ids of tests that hang are annotated. The build tests only the headless-safe suite and keeps its log. Job timeouts are 30 min (build) and 45 min (CI Windows).
- **R8.** Every action is on the major that runs on Node 24: checkout, setup-node, setup-python and upload-artifact v7; download-artifact v8. Runner images are pinned to `ubuntu-24.04` and `windows-2025`. `test/ci/workflows.test.js` guards all of this.
- **Reproduction (R4).** No hang reproduced locally, under any setup I could build without elevation:
  - with `CI=true GITHUB_ACTIONS=true` and stdin `NUL`;
  - in a runner-like launch: no window, a new process group, stdin `NUL`, output to a file, and the real (non-venv) Python;
  - in a **non-interactive window station** (`Service-0x0-…$`, no desktop) created without admin rights.
  
  **The original suite passes in all of these**, interactive tests included. The full logs in the next CI run will name the cause.
- **A real flaky test found and fixed (probably M-15).** In the CI-like run, `test_control.py::test_many_stalled_handshakes_time_out_and_free_their_slots` failed once. The cause is a race in the test: a slot is freed just after its failure is counted. Without the fix it failed 2 times in about 51 runs; with it, 0 in 50.

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 per-test timeout + stack dump; subprocess timeouts; kill in teardown | DONE | `gcs/conftest.py:43` (120 s), `:304` `_Watchdog`, `:326` `_run` (dump → kill → `TestTimeout` → hard exit `:348`), `:368` `timeout` marker, `:419` protocol wrapper, `:433` makereport (a test that ends only after the kill is still FAILED), `:115` `_Children` + `:257` Popen tracking (kill by PID, creation time checked against PID reuse), `:454` exit guard; `gcs/tests/test_control.py:91` (icacls `timeout=30`), `gcs/tests/test_video.py:96` (`_first_line` with a time limit) | No new dependency: `faulthandler.dump_traceback` + `PyThreadState_SetAsyncExc`. `pytest-timeout` was not used: its Windows "thread" method only dumps and `os._exit`s, which would lose the per-test FAILED report. Proven by `gcs/tests/test_test_guards.py` (hang on a child, poll forever, blocked in C, leaked child, `interactive_desktop` skip), plus a static rule: every `subprocess.run/call/check_*` and `communicate()` in the tests passes `timeout=`. |
| R2 live test names; step timeouts | DONE | `ci.yml:110`, `:163`; `gcs-build.yml:63` (`python -u … -v -rfEs --durations`, `PYTHONUNBUFFERED: '1'`); `conftest.py:408` (`[time] START <id>` lines, because `-v` leaves the running test's line unfinished and a piped log shows only whole lines); step timeouts `ci.yml:107` (5 < 10), `:134` (5), `:153` (35 < 45); `gcs-build.yml:48`, `:57` (15 < 30), `:85`, `:91`; uploads with `if: always()` `ci.yml:189`, `gcs-build.yml:76` | Checked by `test/ci/workflows.test.js:110`: every pytest step is `-v` (or `-rA` + `--durations`), never `-q`, unbuffered, and has a step timeout below its job timeout; the Windows steps write dumps to `pytest-logs` and are followed by an `if: always()` upload. The ×5 loop also annotates `+++ TIMEOUT` ids (`ci.yml:170`). |
| R3 `interactive_desktop` marker, detection, precise skip reason, headless split | DONE | `conftest.py:91` `interactive_session`, `:66` `_window_station` (`GetProcessWindowStation` + `UOI_FLAGS & WSF_VISIBLE`, `ProcessIdToSessionId`), `:398` skip with reason, `:391` header line; markers: see §2.1; split: `test_ui.py:130` `_UiSpawnedSender`, `:196` headless test | Overrides: `VTOLGCS_INTERACTIVE_TESTS=1` forces them on, `=0` off. Reason text example: `needs an interactive desktop: GITHUB_ACTIONS=true: a CI runner, where an interactive console and desktop are not guaranteed (run these on a desktop before a release: docs/relay/OPEN-ITEMS.md)`. |
| R4 reproduce locally | DONE (no hang reproduced) | §4.2 | Without elevation: CI env + NUL stdin; runner-like launch with the real Python; a self-created, non-interactive window station (`CreateWindowStation(NULL)` → `Service-0x0-7ebb3$`, `CreateDesktop`, `CreateProcess` with `lpDesktop`). No scheduled task and no `/RU SYSTEM` were used. |
| R5 build runs the headless-safe suite; ×5 keeps the same skips; job timeouts | DONE | `gcs-build.yml:37` (30), `:63` (`-m "not interactive_desktop"`); `ci.yml:123` (45), the ×5 loop is unchanged in count and runs the full suite (the tests skip themselves) | `workflows.test.js:138`; the build step itself runs verbatim on failing and passing trees (`:260`). |
| R6 green locally; workflow checks; node green; no load tests; PID-only cleanup | DONE | §4.1 | 3 full local runs: 687 passed, 2 skipped (UI smoke, need `VTOLGCS_UI_SMOKE=1`). `node --test test/`: 310/310, 0 skipped (with jsdom). Every process I started was killed by PID (launcher `tree()` + `TerminateProcess`); "descendants left: []" after every launch. |
| R7 OPEN-ITEMS row | DONE | `docs/relay/OPEN-ITEMS.md:53` (M-16: the 8 tests, why, the exact commands), `:115` (WP17 follow-up: read the next CI log) | |
| R8 actions on Node 24, verified and pinned; image decision; regression test | DONE | `ci.yml:6-18`, `gcs-build.yml:4-12` (versions, release-page URLs, image reasoning); `workflows.test.js:157` | Verified on 2026-10-17: each release page (latest checkout v7.0.1, setup-node v7.1.0, setup-python v7.0.0, upload-artifact v7.0.2, download-artifact v8.0.2) **and** each tag's `action.yml` (`runs.using: node24` for checkout@v7, setup-python@v7, setup-node@v7, upload-artifact@v7, download-artifact@v8; the old v4/v5 tags say `node20`). See §5.3. |

### 2.1 Every test marked `interactive_desktop`, and why

| Test | Why it needs an interactive desktop/console | What still runs headless (CI) |
|---|---|---|
| `test_main_cli.py::test_real_console_single_keys_change_nothing_typed_words_work` | Types keys into the sender's console (`AttachConsole` + `WriteConsoleInputW`), delivers Ctrl+C / Ctrl+Break (`GenerateConsoleCtrlEvent`), reads the screen buffer | `test_runtime_e2e.py` key tests (every key × interactive/piped against the real runtime), `test_prompt_runner_answer_cancel_and_state_change`, the piped/NUL refusal tests in `test_main_cli.py` |
| `test_main_cli.py::test_open_console_prompt_does_not_delay_a_control_stop` | Opens a prompt by typing on the console, waits for it on the screen buffer | as above; the stop path itself: `test_control.py` |
| `test_main_cli.py::test_console_prompt_cancelled_when_the_state_changes_events_keep_printing` | Console typing + screen reads | `test_prompt_runner_answer_cancel_and_state_change` (cancel on state change) |
| `test_main_cli.py::test_launch_resume_prompt_does_not_block_the_control_channel` | Waits for the `--resume` dialog on the console screen | `test_ui.py::test_ui_shows_the_launch_dialog_refusal_in_events` (the same dialog without a console: refused, nothing sent) |
| `test_ui.py::test_spawned_sender_has_no_window_takes_no_focus_and_ignores_keys` | Samples `GetForegroundWindow`; types keys and Ctrl+C / Ctrl+Break into the spawned sender's console | **Split:** `test_ui.py::test_spawned_sender_streams_without_input_and_stops_only_through_the_control_channel` runs everywhere. The sender is started as the UI starts it. It streams with keys off and no visible window, and asks for nothing. A `stop` without the typed word is refused and changes nothing; only `stop` + `STOP` ends it. Its session log has the single `fpv` mode. Also `test_spawn_sender_gives_no_console_window_and_no_input` (no console window, stdin NUL). |
| `test_controller.py::test_real_pygame_thread_starts_and_stops` | Loads the real SDL video and joystick stack (display enumeration, HID/XInput/Windows.Gaming.Input) in a background thread: the operator desktop's device stack. A hang there would also block the interpreter's exit, because pygame quits SDL at exit. It now also asserts that the first poll happened and that the thread ended on stop. | The fake-module controller tests in the same file. Note: it **passed** in my non-interactive window station; it is marked for what it touches, and because it is the main suspect for a hang at exit on a server image. |
| `test_ui.py::test_ui_smoke_launch_resume_refusal_in_events` | Opens Tk windows (already gated by `VTOLGCS_UI_SMOKE=1`) | — |
| `test_ui.py::test_ui_smoke_with_spawned_sender` | Opens Tk windows (already gated by `VTOLGCS_UI_SMOKE=1`) | — |

## 3. Placeholders

None.

## 4. Tests

### 4.1 Added or changed

| Test | What it proves |
|---|---|
| `gcs/tests/test_test_guards.py::test_a_hanging_test_is_named_dumped_killed_and_failed_and_the_run_goes_on` | Runs a throw-away tree that has a copy of the real `conftest.py`, with `VTOLGCS_TEST_TIMEOUT=3`. A test waiting on a child forever and a test polling forever are each named, stack-dumped (to stdout and to `pytest-timeouts.txt`) and reported FAILED. A leaked child is killed and reported, and is dead afterwards. A test marked `interactive_desktop` is skipped with `CI=true` in its reason. The run goes on: `2 failed, 2 passed, 1 skipped`. |
| `…::test_a_test_blocked_beyond_the_grace_period_ends_the_run_with_status_1` | `time.sleep(600)` (an async exception cannot interrupt it): after the grace period the run hard-exits with status 1, and the stack names the test function. |
| `…::test_interactive_session_detection` | `GITHUB_ACTIONS` / `CI` → skip; the `VTOLGCS_INTERACTIVE_TESTS` overrides; `CI=false` is not CI; otherwise the result follows the window station. |
| `…::test_every_subprocess_call_in_the_tests_has_a_timeout` | AST rule over `gcs/tests/*.py`. |
| `test_ui.py::test_spawned_sender_streams_without_input_and_stops_only_through_the_control_channel` | The headless split (see §2.1). |
| `test_controller.py::test_real_pygame_thread_starts_and_stops` (changed) | First poll within 10 s; the thread ends within 2 s of `stop()`. |
| `test_control.py::test_many_stalled_handshakes_time_out_and_free_their_slots` (fixed) | Waits until the slots are freed (`_pending == 0`), not only until the failures are counted. |
| `test/ci/workflows.test.js` | Static R2, R5 and R8 rules (above). The ×5 pwsh step is now also run verbatim on a tree with a **hanging** test and the real `conftest.py`: the annotation is the test id, there are 5 logs and 5 dumps, and the run goes on. The **gcs-build test step** is run verbatim: a failing test fails it with the id annotated; an `interactive_desktop` test is deselected even when forced on. I checked 7 mutations of the workflows (an old action major, `-q`, no step timeout, `ubuntu-latest`, buffered output, no `-m`, a 40 min job): each is caught. |

### 4.2 Results

| Run | Command / context | Result |
|---|---|---|
| baseline (before changes) | `python -m pytest gcs protocol -v` (venv, desktop) | 682 passed, 2 skipped, 93.6 s |
| local ×3 (R6) | `python -m pytest gcs protocol -v -p no:cacheprovider -rfEs` (venv, owner's desktop; interactive tests RUN) | 687 passed, 2 skipped, each run (109.5 s, 108.6 s, 106.8 s) |
| guard self-tests | `python -m pytest gcs/tests/test_test_guards.py -v` | 4 passed, 13.7 s |
| workflow tests | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<venv python> node --test test/ci/workflows.test.js` | 7/7 passed |
| node suite | `VTOL_JSDOM=… node --test test/` | 310 passed, 0 failed, 0 skipped |
| **R4 a:** original suite (`git archive HEAD`), hidden window station | `launch.py winsta`: `CreateWindowStation(NULL)` → `Service-0x0-7ebb3$` (not interactive), new desktop, `CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP`, stdin NUL, output to file | **No hang:** 681 passed (the 1 failure was `data/content.js` missing from my extract), interactive tests included, 93.7 s |
| **R4 b:** original suite, runner-like + real Python + CI env | `launch.py runner`, base `python.exe` (not the venv launcher), `CI=true GITHUB_ACTIONS=true` | **No hang:** 682 passed, 2 skipped; no process left behind |
| R4 c: new suite, runner-like + real Python + CI env (= ci.yml step) | as b, `-u -v -rfEs --tb=long --durations=10` | 1st: 680 passed, 8 skipped, **1 failed** (the stalled-handshake race, now fixed); 2nd after the fix: **681 passed, 8 skipped** |
| R4 d: new suite, gcs-build step | as b, plus `-m "not interactive_desktop"` | 681 passed, 8 deselected |
| R4 e: new suite, hidden window station, no CI env | as a | 681 passed, 8 skipped (detected: `window station 'Service-0x0-7ebb3$' is not interactive`) |
| R4 f: interactive tests forced on in the hidden window station | `VTOLGCS_INTERACTIVE_TESTS=1 … -m interactive_desktop` | 6 passed, 2 skipped (UI smoke) |
| race check | `test_many_stalled_handshakes…` alone, ×50 each, real Python, CI env | original: 1/20 + 0/30 failed; fixed: 0/20 + 0/30 |

Logs are in `S\wp17run\` (`baseline.txt`, `local1-3.txt`, `pre-winsta.txt`, `pre-runner-base.txt`, `new-runner-ci.txt`, `new-runner-ci2.txt`, `new-runner-build.txt`, `new-winsta.txt`, `new-winsta-forced.txt`). The launcher is `S\wp17run\launch.py`.

**What I could not reproduce:** the hang itself. I could not reproduce three parts of a hosted runner:
- the hosted runner VM: Windows Server 2025, Defender and the firewall in their image state, and no game-input or audio stack;
- the runner service's own process tree;
- a true session-0 service: no elevation was allowed.

The CI-like simulations above cover the console, window-station, stdin, process-group and Python-launcher differences. None of them hangs.

## 5. Deviations / contract issues / notes for the PM

1. **Root cause still unknown.** The changes make the next run self-diagnosing:
   - a hanging test fails after 120 s, with `+++ TIMEOUT [time] <id>` and full stacks in the live log and in `pytest-logs/pytest-timeouts.txt`;
   - a test that hangs inside C code ends the run 20 s later with exit status 1;
   - an interpreter that hangs after the summary is killed 60 s later, with `+++ EXIT GUARD` and stacks.
   
   My leading hypothesis: the real pygame/SDL joystick init on the server image blocks or slows down in its thread. The test still passes, but pygame's quit at exit then deadlocks. That fits a cancel at 40 min with nothing visible under `-q`. This test no longer runs on CI. **After the next push, read the logs. If anything still hangs or times out, it is named there.**
2. **The suite may now go red instead of hanging.** That is intended. If a test times out on the runner, the failure carries its id and its stacks.
3. **R8 action majors.** These changes could affect us:
   - setup-python v7 removed the `pip-install` input and EOL Pythons: we use neither, and 3.12 is supported;
   - download-artifact v8 fails on a digest mismatch by default and skips decompressing non-zip direct uploads: our artifact is zipped as before;
   - upload-artifact v7 adds `archive: false` (unused).

   These are the first runs on these majors.
4. **Images pinned.**
   - **`ubuntu-24.04`.** GitHub moves `ubuntu-latest` to 26.04 from 2026-10-19 (changelog 2026-09-17). GitHub recommends pinning if not ready, and a silent OS move in the middle of this debugging would confound it.
   - **`windows-2025`.** This is what `windows-latest` is today (runner-images README), so behaviour is unchanged. The build job's display name changed to "Build vtol-gcs (windows-2025)".

   Moving to a newer image should be a deliberate change.
5. **Files outside my list:** none. Two files that are not mine now say something stale or incomplete:
   - **`README.md:118`** still says "PyInstaller build on `windows-latest`";
   - **`gcs/README.md` "Tests"** does not mention the `interactive_desktop` marker or `VTOLGCS_INTERACTIVE_TESTS`.

   Both need a one-line update by whoever owns them.
6. **The new conftest wraps `subprocess.Popen.__init__`** (test runs only) to record child PIDs. A leftover process is killed only if it descends from a process a test started, and its creation time is checked, so a reused PID is never touched.
7. **Not run:** the two windowed UI smoke tests with `VTOLGCS_UI_SMOKE=1`, because they open Tk windows on the owner's desktop. They only gained a marker. M-16 lists them for the pre-release desktop run.
8. **M-15:** the stalled-handshake race fixed here is a likely candidate for M-15's "1 failed, 681 passed". I left the M-15 row open until CI has run ×5 a few times.

## 6. Notes for the verifier

- **Detection:** `python -m pytest gcs -m interactive_desktop -v`. On a desktop, the header says `interactive_desktop tests RUN (interactive window station WinSta0, session N)`. With `$env:CI='true'` they are skipped, with the reason.
- **Watchdog:** `python -m pytest gcs/tests/test_test_guards.py -v -s`, or put a `while True: time.sleep(0.05)` test in a scratch copy and set `VTOLGCS_TEST_TIMEOUT=3`.
- **Non-interactive window station without admin:** see `S\wp17run\launch.py` (`winsta` mode; it needs `WT_GCS=<worktree>\gcs` for its tree-kill helper).
- **Workflows:** `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=<python with pytest> node --test test/ci/workflows.test.js`.
