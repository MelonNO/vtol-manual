# WP16 — Implementation report (RC sender follow-ups)

Branch `wp/16` · follow-up to `WP15-VERIFY-round1.md` findings F1–F5 · Contracts C2/C2.1/C3 unchanged; the control channel is unchanged · Date 2026-10-17

## 1. Summary

- **R1 (F1): a console prompt no longer blocks the sender.**
  - A key's action (and the `--resume` / `--mode carrier_only` dialog at launch) now runs in a worker thread (`PromptRunner`). The worker waits for its typed word.
  - The main loop keeps running. It collects the typed characters itself (`msvcrt`; echo, Backspace, Esc), prints alarms and events, and wakes at once on a control-channel stop.
  - **Measured:** with an `i` (IDLE) prompt open, a UI `STOP` ended the RC stream **within 2 ms** (10 runs: −2.3 … +1.7 ms from the request to the last `rc_up` counted by the simulator, 0–1 packets after it). The test limit is 100 ms. Before, the stream ended only when Enter was pressed (the verifier measured 3.2 s).
  - **Cancelled prompts:** a pending prompt is cancelled, with a message, when the state changes underneath it. This also covers a change between the Enter and the action. After a cancel, the rest of the typed line is ignored, so a half-typed word can never turn into key presses (`CAMERA` would otherwise open the `R` RESUME dialog).
- **R2 (F3):** when the UI was started with `--resume` or `--mode carrier_only`, it reads the sender's own answer from the sender's output file. It shows that answer under *Events*: `RC sender refused --resume at launch: RESUME needs a typed confirmation on an interactive console; … - nothing sent`, plus which button to use. If the UI attaches to a running sender instead, it says that the flag was ignored.
- **R3 (F2):** Ctrl+Break is handled like Ctrl+C (QUIT prompt, typed `STOP` while streaming). README and the module docstring say what cannot be caught: closing the console window, logging off, shutting down, Task Manager.
- **R4 (F4):** the Ctrl+C tests now deliver the event for real.
  - The hand-started sender is launched with the inherited "ignore Ctrl+C" flag cleared (`_console.vtolgcs_command`).
  - The tests read the console screen buffer and assert that the QUIT prompt appears after Ctrl+C, after Ctrl+Break, and after a Ctrl+C on an open prompt.
  - The UI-spawned sender test asserts both layers: Ctrl+C never arrives (process group), and a real Ctrl+Break produces exactly one refused QUIT.
- **R5 (F5):** each sender start by the UI deletes old `sender-YYYYMMDDTHHMMSSZ.log` files. It keeps the newest `log.sender_output_keep` (20) and caps their total at `log.sender_output_max_mb` (100 MB). It never deletes the current file, a file still open, or any other file.
- **Also fixed:** the cosmetic part of F5 (the close dialog says "it has no window" only for a sender this UI started).
- **R6:**
  - `pytest gcs` ×3: 682 passed, 2 skipped.
  - UI smoke ×10: 10/10, and the foreground window never changed.
  - The WP08a/WP08b/WP13 scripts give the WP15 results.
  - `%APPDATA%\vtol-gcs` was never created.

## 2. Requirement table

Line numbers refer to the final commit.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `gcs/vtolgcs/__main__.py:344` `PromptCancelled`, `:348` `PromptRunner` (`start`, `read_line`, `submit`, `cancel`, `changes`, `poll`); `:191` `Console.feed`, `:211` `end_input`, `:278` `Console.signature`; `:589` `_read_chars`; main loop `:728` (launch dialogs in the worker), `:739` `cancel` (+ ignore the rest of the line), `:747-788`, `:788` `stop_requested.wait` (wakes at once), `:797` RC stream stopped first on exit | **No blocking:** the main loop never reads a line; it reads characters only while the worker waits for an answer.<br>**Stop:** a control stop or `--run-seconds` ends the process at once, and the pending prompt is cancelled ("the sender is stopping").<br>**Events:** events and alarms print while the prompt is open; the half-typed answer is redrawn below them. The status line pauses, as before.<br>**Cancel on a state change:** mode, streaming, camera request, stop gate, sender-thread death and, with `--sim`, the fake arm switch and connection. The check runs every 20 ms in the main loop and again after the Enter in the worker. Every action reads all its words before it acts, so a cancelled prompt has done nothing. |
| R2 | DONE | `gcs/vtolgcs/ui/link.py:165` `LAUNCH_DIALOGS`, `:169` `launch_dialog` (uses the UI's parsed args, so `--resu` abbreviations count), `:178` `launch_refusals`; `gcs/vtolgcs/ui/app.py:50` `LAUNCH_WATCH_S`, `:915` `_check_launch_dialog`, `:1193` attach case | For up to 20 s after the spawn, the UI looks in the sender's output for its answer to the launch dialog, and puts each refusal line with its reason plus a hint under *Events*. Without an answer (timeout or sender exit) it says so. Nothing in the sender changed: it still refuses, and nothing is sent. |
| R3 | DONE | `__main__.py:716-722` (SIGINT and SIGBREAK → the same handler); `gcs/README.md:149` | Ctrl+Break → QUIT prompt (`STOP` while streaming; at once while idle), as Ctrl+C. **Cannot be caught:** closing the window, logoff and shutdown (Python's `signal` has no handler for these console events, and Windows ends the process after the handler anyway), and Task Manager. The UI-spawned sender never gets Ctrl+C (process group); a Ctrl+Break into its hidden console acts like `q` with `--no-keys`. |
| R4 | DONE | `gcs/tests/_console.py:90` `vtolgcs_command`, `:109` `ctrl_break`, `:113` `screen`, `:51` (the helper survives its own Ctrl+Break); `gcs/tests/test_main_cli.py:315` `_HandSender`, `:371`; `gcs/tests/test_ui.py:173` | See §4. |
| R5 | DONE | `link.py:129` `prune_sender_outputs`; `app.py:908`; `gcs/vtolgcs/config.py:180-183` (+ validation `:460-461`); README config table and "two processes" section | Only names matching `sender-\d{8}T\d{6}Z.log` are candidates. The files are sorted with the current file first, then newest first. A file is kept while the count is ≤ keep and the total is ≤ the cap; from the first file over a limit on, every older file is deleted. A file that is still open (a sender still running) cannot be deleted on Windows and is skipped. |
| R6 | DONE | §4.2, §4.3 | All green; details below. |

## 3. Placeholders

None. `sender_output_keep` = 20 is the brief's default; `sender_output_max_mb` = 100 is an app default (not a safety value), labelled so in the README.

## 4. Tests

### 4.1 Added or changed tests

| Test | What it proves |
|---|---|
| `test_main_cli.py::test_prompt_runner_answer_cancel_and_state_change` | The worker: answer, one prompt at a time, cancel with a message, a state change between the Enter and the action cancels, an action without a prompt. |
| `test_main_cli.py::test_real_console_single_keys_change_nothing_typed_words_work` (changed) | As in WP15, plus Ctrl+C, **Ctrl+Break** and "`k` then Ctrl+C" are delivered for real (ignore flag cleared). Each shows the **QUIT prompt on the console screen**, and Ctrl+C on an open prompt first cancels that prompt. At the end, Ctrl+C + `STOP` quits (exit 0). |
| `test_main_cli.py::test_open_console_prompt_does_not_delay_a_control_stop` | **R1 timing:** `i` prompt open (seen on screen), stream still at ~250 Hz. Then the UI's `stop` + `STOP`: the last `rc_up` must arrive < 100 ms after the request, with < 25 packets. It prints the measured value with `-s`. The session log has no mode change (the prompt did nothing). |
| `test_main_cli.py::test_console_prompt_cancelled_when_the_state_changes_events_keep_printing` | `k` prompt open; the simulator stops, and `ALARM RAISED: CRIT bridge_no_status` prints **below the prompt**. Typing `CAMERA` still works afterwards. A second `k` prompt plus a UI `request_mode idle`: `prompt cancelled: the state changed while it waited (mode fpv -> idle …`. Typing `CAMERA⏎` then changes nothing and opens no RESUME prompt; `s` works again; `q` quits. |
| `test_main_cli.py::test_launch_resume_prompt_does_not_block_the_control_channel` | `--sim-armed --resume`: the RESUME prompt waits, and a control `stop` still ends the process at once (exit 0, no mode record). |
| `test_ui.py::test_spawned_sender_has_no_window_takes_no_focus_and_ignores_keys` (changed) | Ctrl+C: nothing in the output (the process group ignores it). Ctrl+Break: delivered, and exactly one `QUIT needs a typed confirmation …` line; the stream is unchanged. |
| `test_ui.py::test_prune_sender_outputs`, `::test_prune_sender_outputs_leaves_a_file_in_use`, `::test_sender_output_retention_config` | Keep N, size cap, current file kept even when it is the oldest-looking, other files untouched, missing folder, an open file is skipped, config defaults and validation. |
| `test_ui.py::test_launch_dialog_helpers`, `::test_ui_shows_the_launch_dialog_refusal_in_events` (×2: `--resume`, `--mode carrier_only`), `::test_launch_dialog_watch_gives_up_without_an_answer` | The real sender is spawned exactly as the UI spawns it. The UI's `_check_launch_dialog` then puts `RC sender refused … at launch: … needs a typed confirmation on an interactive console … nothing sent` and the button hint under Events. The sender stays idle and the simulator receives 0 packets. |
| `test_ui.py::test_ui_smoke_launch_resume_refusal_in_events` (`VTOLGCS_UI_SMOKE=1`) | The windowed UI with `--sim --sim-armed --resume`: the refusal is in its Events (`notes` in the smoke summary); 0 packets. |

### 4.2 Commands and results

Python `S\venv\Scripts\python.exe` (3.12), run from the worktree root. Logs are in `S\wp16run\`.

| Run | Command | Result |
|---|---|---|
| baseline (before changes) | `python -m pytest gcs` | 671 passed, 1 skipped |
| full ×3 | `python -m pytest gcs -q -p no:cacheprovider` | **682 passed, 2 skipped** each time (89–91 s); `pytest1-3.txt` |
| full, windowed | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs protocol` | **684 passed** (106 s); `full_smoke.txt`. A fourth plain run after the last edit: 682 passed, 2 skipped (`pytest4.txt`) |
| smoke ×10 | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs/tests/test_ui.py -k test_ui_smoke_with_spawned_sender`, 10 times | **10/10 passed** (10.3–10.4 s each); `smoke10.txt` |
| foreground during the 10 smoke runs | `S\verify\WP13\scripts\fgwatch.py 260` | `fgwatch_smoke.txt`: one line only (the user's browser): **the foreground never changed** |
| R1 timing ×10 | `python -m pytest gcs/tests/test_main_cli.py -s -k delay_a_control_stop`, 10 times | last `rc_up` −2.31 … +1.71 ms after the STOP request, 0–1 packets after it; `r1_timing.txt` |

### 4.3 Earlier verifiers' scripts, against `wt\WP16\gcs`

Logs are in `S\wp16run\scripts\` (runner `S\wp16run\run_scripts.sh`).

| Script | Result |
|---|---|
| WP08a `acceptance.py` | Normalised output (numbers, temp names) **identical** to WP15's run (`wp15run\scripts\acceptance.log`); the only differences are the random pipe and temp names. `APPDATA vtol-gcs exists` False before and after. |
| WP08b `attack.py` | 42/44 |
| WP08b `attack.py armed` | 43/45 |
| | In both attack runs the 2 FAILs are the known script flaws (`icacls` substring; the client-side `BrokenPipeError` on the oversize send), the same as in WP13/WP15. |
| WP08b `attack2.py` | Ends at the expected `KeyError: 'result'` on `prepare_resume` after the stop, as before. |
| WP08b `regress.py` | 405s, health, kill → `RUN → FAILSAFE`, as before. |
| WP08b `menu_e2e.py` | Output identical to WP15's (numbers normalised). |
| WP13 `race_probe.py` (n = 30) | **RESULT: ALL PASS** |

**Clean-up:** `attack2.py` ends at its KeyError before `sim.terminate()` and left one `bridge_sim` (launcher + child, started by my run from `wt\WP16`); I ended both. No vtolgcs or bridge_sim process of mine remains. The only other Python processes are the user's `kisync` and another agent's `http.server` for WP14 (not mine, untouched). `%APPDATA%\vtol-gcs`: absent before and after every run.

**Typed-echo probe** (`S\wp16run\echo_probe.py`, output `echo_probe.txt`): with `k` open and `CAMX⌫` typed, the simulator stops. The screen shows the prompt line, then `ALARM RAISED: CRIT bridge_no_status - NO BRIDGE STATUS`, then `CAM` (the half-typed answer moved below). Esc cancels it: the camera request stays off.

## 5. Deviations and decisions

1. **Worker thread rather than a non-blocking line reader.**
   - The dialogs (`Console.key`, `resume_dialog`, `carrier_only_dialog`) stay synchronous and unchanged; they get a `read_line` that waits on a queue.
   - The main loop owns the console input (`msvcrt`) and feeds that queue. This keeps the WP15 dialog code and its in-process tests unchanged.
   - A thread blocked in `sys.stdin.readline` was rejected: it cannot be cancelled, it would compete with the key reader, and it can crash Python at exit (stdin lock held by a daemon thread).
2. **The rest of the typed line is ignored after a cancelled prompt.**
   - Not in the brief. Without it, the operator who keeps typing `CAMERA` after the cancel message would press `C A M E R A` as keys, and `R` opens the RESUME dialog. Harmless (that dialog needs its own word), but confusing.
   - The cancel message says so: `… - nothing changed; what is typed up to the next Enter is ignored`.
3. **Ctrl+C or Ctrl+Break on an open prompt** cancels it and opens the QUIT prompt. With the QUIT prompt itself open, it reprints the hint.
4. **On exit, the RC stream is stopped first** (`rt.sender.stop()` before `control.stop()`; `rt.stop()` still does everything else in the same order). Reason: a control stop then ends the stream within milliseconds. The stop gate (`begin_stop`) already refuses every later start.
5. **R2 is done in the UI, by reading the sender's output file;** the sender and the control channel are unchanged.
   - The refusal happens right after the sender starts, usually before the UI has subscribed to events, so an event would be missed.
   - The output line is the sender's own text, with its reason.
6. **Escape cancels a prompt.** Esc (and a Ctrl+C character, if one ever arrives as a key) gives an empty answer = cancel. It is in the key help.
7. **Not Windows:** the worker reads `stdin` itself (blocking only the worker). Cancelling cannot interrupt it there. The app is Windows-only; this path is not tested.

## 6. Notes for the verifier

- **R1 by hand:**
  1. Start the simulator, then run `python -m vtolgcs --headless --sim --config <tmp>\c.json --log-dir <tmp>` in a console window.
  2. Press `i`: the prompt waits.
  3. **Stop:** from another console, use the control channel (`ControlClient.from_file(<tmp>\control.json).request("stop", typed="STOP")`). The sender ends at once and the simulator reports FAILSAFE after T_hold.
  4. **State change:** press `k`, then switch the mode through the control channel (`request_mode idle`): `prompt cancelled: the state changed while it waited (mode fpv -> idle, streaming True -> False) - nothing changed; what is typed up to the next Enter is ignored`.
  5. **Alarms:** stop the simulator while a prompt is open: `ALARM RAISED` lines print, and your half-typed answer moves below them.
- **R1 timing:** `python -m pytest gcs/tests/test_main_cli.py -s -k delay_a_control_stop` prints the value.
- **R2:**
  1. With the simulator running, run `python -m vtolgcs --sim --sim-armed --resume --config <tmp>\c.json --log-dir <tmp>`.
  2. *Events* shows `RC sender refused --resume at launch: RESUME needs a typed confirmation on an interactive console; … - nothing sent`, then `Nothing was sent for --resume. Use Flight -> RESUME (client airborne): …`.
  3. Start a second UI with `--resume`: it attaches, and *Events* says `--resume ignored: the UI attached to a running RC sender`.
- **R3/R4:** `python -m pytest gcs/tests/test_main_cli.py gcs/tests/test_ui.py -k "real_console or spawned or prompt"`. The tests open nothing on the desktop (windowless consoles).
- **R5:** put 30 old `sender-2026…Z.log` files into the log folder and start the UI: 20 remain (19 old ones + the new one).
- Never set `VTOLGCS_TEST_INSTANCE_NAME` outside tests.
