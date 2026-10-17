# WP15 — Implementation report (RC sender console safety)

Branch `wp/15` · follow-up to `WP13-VERIFY-round1.md` finding 3 · Contracts C2/C2.1/C3 and the control channel unchanged · Date 2026-10-17

## 1. Summary

- **R1 — no console for the sender the UI starts.** The UI starts the sender with `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`, stdin `NUL`, and a new flag `--no-keys`. The sender has no window, never becomes the foreground window, and reads no keys and no typed input.
  - Its output (stdout and stderr) is appended to `sender-YYYYMMDDTHHMMSSZ.log` in the log folder.
  - The UI shows the sender's exit code and last output lines under *Events*, and a new *Sender output* button opens the file.
- **R2 — standalone headless console.** No single key starts, ends or changes the RC stream, the mode or the camera.
  - These keys only print what they would do and ask for a typed word: `START`, `STOP`, `CAMERA`, and for `--sim` `ARM`/`SAFE` and `UNPLUG`/`PLUG`. `RESUME` and `NOCLIENT` are unchanged.
  - `q` and Ctrl+C need `STOP` while streaming. They go through `Sender.begin_stop`, so the stop is final, as on the control channel.
  - Only `s` (status) and `h`/`?` (help) act at once.
- **A bug found on the way:** on Windows `isatty()` is True for `NUL`. The old code would have treated a `NUL` stdin as an interactive console. A new `is_console()` also checks `GetConsoleMode`.
- **R3 — tests** type real keystrokes into a **windowless** console with `WriteConsoleInputW`, so nothing appears on the desktop. They cover:
  - the spawned sender: no window, no focus, keys and Ctrl+C ignored, output in the file;
  - a hand-started headless sender: every single key changes nothing while streaming, and the typed words work;
  - every key against the real runtime, interactive and piped.
- **Results:** the windowed UI smoke test passed **10/10**. During those runs the foreground window **never** changed; before, the verifier saw the sender's terminal take it for about 11 s.
- **R4 — no regression:** `pytest gcs` ×3 plus one full run with the smoke test, all green. The WP08a/WP08b/WP13 scripts give the same results as on the WP13 code. `%APPDATA%\vtol-gcs` was never created.

## 2. Requirement table

Line numbers refer to the final commit.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `gcs/vtolgcs/ui/link.py:48` `sender_command` (adds `--no-keys`, once); `:91` `sender_output_path`; `:96` `spawn_sender` (`:106` `CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP`, `:117` stdin `DEVNULL`, stdout/stderr → file); `:125` `tail_lines`; `gcs/vtolgcs/__main__.py:102` `--no-keys`, `:408` `console_input` (`--no-keys` → no keys, not interactive), `:527`; `gcs/vtolgcs/ui/app.py:109` `log_dir` (honours `--log-dir`), `:899` `start_sender_process`, `:905` `_watch_spawned`, `:920` `open_sender_output`, `:1020` `close` | **No window:** the child's `GetConsoleWindow()` is 0. **No focus:** the foreground pid was sampled during start-up and while streaming. **No input:** stdin is `NUL`, `--no-keys` is set, and Ctrl+C is disabled by the new process group; keys written into its console buffer change nothing. **Output:** a file in the log folder, plus *Events* and *Sender output* in the UI. `DETACHED_PROCESS` was rejected (§5.1). |
| R2 | DONE | `__main__.py:131` words; `:210` `Console.confirm`; `:221` `quit_ok` (`begin_stop`); `:236` `Console.key`; `:391` `is_console`; `:531-553` Ctrl+C → same path as `q`; README "Keys (WP15)" table (`gcs/README.md:109`) and module docstring | `f`/`r` `START`, `i` `STOP`, `k` `CAMERA`, `q`/Ctrl+C `STOP` while streaming (at once otherwise), sim `a` `ARM`/`SAFE`, sim `d` `UNPLUG`/`PLUG`; `R`/`c` keep `RESUME`(+`THROTTLE`) / `NOCLIENT`(+`LANDED`). Words are case-sensitive, as on the control channel. With piped or redirected input, or with `--no-keys`, these keys are refused. |
| R3 | DONE | `tests/test_ui.py:115,:131,:272` (smoke now also checks the output file), `:95,:105`; `tests/test_main_cli.py:260,:283`; `tests/test_runtime_e2e.py:400,:424,:459`; helper `tests/_console.py` | See §4. Smoke ×10 with `VTOLGCS_UI_SMOKE=1`: 10/10. |
| R4 | DONE | §4.2, §4.3 | `pytest gcs`: 671 passed, 1 skipped, three times. Full run with the smoke test: 672 passed. WP08a acceptance output is identical to WP13's. attack, attack (armed), attack2, regress, menu_e2e and race_probe give the WP13-verification results. `%APPDATA%\vtol-gcs` is absent before and after. |

## 3. Placeholders

None.

## 4. Tests

### 4.1 Added or changed tests

| Test | What it proves |
|---|---|
| `test_ui.py::test_spawn_sender_gives_no_console_window_and_no_input` | `spawn_sender` on a probe command: `GetConsoleWindow() == 0`; stdin is not a console and reads `''` (NUL); stdout is not a console; stdout and stderr land in the output file. |
| `test_ui.py::test_spawned_sender_has_no_window_takes_no_focus_and_ignores_keys` | The **real sender**, started exactly as the UI does (`spawn_sender(sender_command(passthrough_args(argv)))`, `--sim`):<br>• no visible window for the launcher or sender pid;<br>• neither pid is ever the foreground window;<br>• then `q i a d k`, `iSTOP⏎ qSTOP⏎ aARM⏎ dUNPLUG⏎` and Ctrl+C are typed into its windowless console: still FPV/streaming/RUN, arm switch SAFE, controller connected, camera off;<br>• only the control channel's typed `STOP` stops it (exit 0);<br>• the output file holds the start-up line, `console keys off (--no-keys)` and the stop lines, and never a prompt;<br>• the session log has one `mode` record. |
| `test_ui.py::test_passthrough_and_commands` (changed), `::test_sender_output_file_helpers` | `--no-keys` follows `--headless` exactly once; output file name; `tail_lines`. |
| `test_ui.py::test_ui_smoke_with_spawned_sender` (extended) | It also checks that one `sender-*.log` exists, with `--no-keys` in effect. |
| `test_main_cli.py::test_no_keys_and_console_detection` | `--no-keys` → `(False, False)`; `NUL`, a file and `None` are not consoles. |
| `test_main_cli.py::test_real_console_single_keys_change_nothing_typed_words_work` | A hand-started `--headless --sim` sender on a real (windowless) console:<br>• each of `q i a k d f r c R` and Ctrl+C, typed while streaming, leaves mode, streaming, RUN, the arm switch, the controller and the camera unchanged, still at ≥ 100 packets per 0.8 s; Enter then cancels;<br>• the typed words work: `kCAMERA⏎`, `iSTOP⏎`, `fSTART⏎`, `aARM⏎` and `qSTOP⏎` (exit 0);<br>• the session log shows exactly `fpv, idle, fpv` and one operator camera request. |
| `test_runtime_e2e.py::test_single_console_keys_change_nothing_while_streaming` | Every key × answers `""`/`"stop"`/`"yes"` × interactive/piped against the real runtime and simulator: nothing changes, and piped input is never read. |
| `test_runtime_e2e.py::test_console_typed_confirmations_still_work` | `START`, `CAMERA` on and off, `STOP` (idle), `ARM`/`SAFE`, `UNPLUG` (stream stops), `PLUG` (stays stopped), `r`+`START`, `q`+`STOP`. After that, a start is refused ("stop was accepted"). |
| `test_runtime_e2e.py::test_console_quit_and_harmless_keys_when_not_streaming` | `s`/`h`/`?` act and read nothing. `q` while idle quits at once and closes the start gate. |

`tests/_console.py` is the helper for these tests. It attaches a helper process to the target's console (`AttachConsole`) and writes `KEY_EVENT` records (`WriteConsoleInputW`) or sends `GenerateConsoleCtrlEvent(CTRL_C)`. Each target runs with `CREATE_NO_WINDOW`: a real console with no window, so the tests never open a window or take the focus on the shared desktop.

### 4.2 Commands and results

Python `S\venv\Scripts\python.exe` (3.12), run from the worktree root. Logs are in `S\wp15run\`.

| Run | Command | Result |
|---|---|---|
| baseline (before changes) | `python -m pytest gcs` | 663 passed, 1 skipped |
| full ×3 | `python -m pytest gcs` | **671 passed, 1 skipped** each time (80 s) |
| full, with windows | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs protocol` | **672 passed** |
| smoke ×10 | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs/tests/test_ui.py -k smoke`, 10 times | **10/10 passed** (10.3 s each), `S\wp15run\smoke10.txt` |
| foreground during the 10 smoke runs | `S\verify\WP13\scripts\fgwatch.py 230` | `S\wp15run\fgwatch_smoke.txt`: one line only, the user's browser. **The foreground never changed.** The verifier's WP13 log showed `Terminal` (the sender console) in front for about 11 s per run. |

### 4.3 Earlier verifiers' scripts, against `wt\WP15\gcs`

Logs are in `S\wp15run\scripts\`.

| Script | Result |
|---|---|
| WP08a `acceptance.py` | Summary output **identical** (after removing timestamps and measured values) to the same script run on the WP13 code (`verify\WP13\mergeclone`): C2 key diff NONE, CORS/PNA/405, SSE, kill → FAILSAFE, sim-armed stays idle, piped RESUME refused. The `APPDATA vtol-gcs` check is False before and after. |
| WP08b `attack.py` | 42/44 |
| WP08b `attack.py armed` | 43/45 |
| | The 2 FAILs in both attack runs are the script flaws already named in WP08b/WP13 verification (the `icacls` substring and the client-side `BrokenPipeError` on the oversize send); the same as in WP13-VERIFY. |
| WP08b `attack2.py` | 9th connection refused and recovers; stop (idle) ok; then `prepare_resume` refused (the expected `KeyError: 'result'`, as in WP13-VERIFY). |
| WP08b `regress.py` | C2 keys exact; CORS and 405 as before; killing the sender → sim `RUN → FAILSAFE`. |
| WP08b `menu_e2e.py` | Not-supported path; 15-field elrs tree; VTX fields; VRX follow text, as before. |
| WP13 `race_probe.py` (n = 30) | **ALL PASS**. |

After these runs, `attack2.py` (which ends at its expected KeyError before `sim.terminate()`) had left one `bridge_sim` running. I started it, so I ended it. No other vtolgcs or bridge_sim process remains.

## 5. Deviations and decisions

1. **`CREATE_NO_WINDOW`, not `DETACHED_PROCESS`.**
   - In a probe, a `DETACHED_PROCESS` child started through the venv's `python.exe` launcher got a **console window** (`GetConsoleWindow() ≠ 0`). The launcher has no console, so its real Python child creates a new one.
   - `CREATE_NO_WINDOW` gives a console without a window, and that is inherited by the launcher's child. Such a console can still receive input from a process that attaches to it, so the sender relies on `--no-keys` and stdin `NUL`, not on the flag alone. The tests prove this by typing into that console.
2. **More keys than the brief names now need a word.** The brief names `q`/`i`/`a`.
   - **`f`/`r`:** a normal start sends the arm switch value at once, and with the switch SAFE that would **disarm an airborne client**: the RESUME hazard.
   - **`k`:** the camera bit is part of `rc_up`.
   - **`d` (sim):** an unplug stops the stream.
   - The UI's camera button and F9 hotkey are unchanged: they need a click or a deliberate hotkey, not a console.
3. **Ctrl+C is treated like `q`** (typed `STOP` while streaming). Before, it ended the process at once. Ctrl+Break and closing the console window still end the process (README).
   - With piped input or `--no-keys`, Ctrl+C while streaming is refused like the other keys.
   - None of the verifiers' scripts sends Ctrl+C; they all kill the process.
4. **`r` restarts FPV only.** In idle or carrier-only mode, `r` says to use `f` or `c`. Before, `r` in carrier-only mode called `request_mode(carrier_only)`, which the sender always refuses anyway.
5. **Closing the UI asks first** while a sender is up (`app.py:1020`). The sender now runs invisibly, so closing the UI would otherwise silently leave a stream running in the background. This adds one message box; `shutdown()`, which the smoke test uses, is unchanged.
6. **`--resume` or `--mode carrier_only` passed to the UI** now reach a sender that has no console, so they are refused there ("needs a typed confirmation on an interactive console", nothing sent). Before, the dialog appeared in the sender's console. Use the UI's buttons; the README says so.
7. **`open_logs` now honours `--log-dir`** (`app.py:109`). It is needed so that the sender's output file and the *Open log folder* button point to the same folder.
8. **`sim --sim-armed` fix:** `a` now reads the current fake arm value instead of a private toggle flag. That flag started at "safe" even with `--sim-armed`, so the first `a` press did nothing.

## 6. Notes for the verifier

- **See R1:**
  1. Start the simulator, then run `python -m vtolgcs --sim --config <tmp>\c.json --log-dir <tmp>` from `gcs\`.
  2. No console window appears.
  3. `<tmp>\sender-*.log` fills with one status line per second.
  4. Flight tab → *Sender output* opens the file.
  5. *Stop sender* (typed `STOP`): *Events* shows `RC sender process exited (code 0)` and the last lines.
  6. Run `S\verify\WP13\scripts\fgwatch.py 30` during a smoke run: the foreground stays on your own window.
- **See R2:**
  1. Run `python -m vtolgcs --headless --sim --config <tmp>\c.json --no-log` in a console window (with the simulator running).
  2. Press `q`, `i`, `a`, `f`, `k`, `d` or Ctrl+C: each prints a prompt, the status of the stream is unchanged, and Enter cancels.
  3. `i` then `STOP` goes idle; `q` then `STOP` quits.
- **Automated:**
  - `python -m pytest gcs/tests/test_ui.py gcs/tests/test_main_cli.py gcs/tests/test_runtime_e2e.py -k "spawn or console or keys or sender_output"`.
  - These tests type into **windowless** consoles, so they are safe to run on a shared desktop.
- **Never set** `VTOLGCS_TEST_INSTANCE_NAME` outside tests. Every test passes `--config`/`--log-dir` in a tmp folder.
