# WP15 verification — round 1
VERDICT: APPROVED

Branch `wp/15` at `4c8612e`, base `fd73ea9` (merge-base with `main`). Verifier: independent agent; nothing in the worktree was changed.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`. My scripts: `S\verify\WP15\scripts\`, logs: `S\verify\WP15\runs\`.

## Scope

`git diff fd73ea9 HEAD --stat` lists 10 files. All are in the brief's "Files you own" (`gcs/**` and the report):
- `gcs/README.md`, `gcs/packaging/build.ps1` (message only)
- `gcs/vtolgcs/__main__.py`, `gcs/vtolgcs/ui/app.py`, `gcs/vtolgcs/ui/link.py`
- `gcs/tests/_console.py` (new), `gcs/tests/test_main_cli.py`, `gcs/tests/test_runtime_e2e.py`, `gcs/tests/test_ui.py`
- `docs/tasks/reports/WP15-IMPLEMENTATION.md`

The worktree is clean (`git status` empty).

**Merge:** I cloned the worktree and merged `wp/15` into the current `main` (`d89a977`). It merges cleanly (`S\verify\WP15\mergeclone`, merge commit `6b5b620`). `main` has not touched `gcs/` since the merge base.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 no console for the UI-spawned sender | **PASS** | `ui/link.py:48-54` (`--headless --no-keys`, deduplicated), `:96-122` (`CREATE_NO_WINDOW \| CREATE_NEW_PROCESS_GROUP`, stdin `DEVNULL`, stdout+stderr → file), `:125` `tail_lines`; `__main__.py:408-413` (`--no-keys` → no keys, not interactive), `:526-527`; `ui/app.py:899-923` (`start_sender_process`, `_watch_spawned`, `note`, `open_sender_output`), `:193`, `:1158` | Independently verified with the real UI `App` (`ui_probe.py main`):<br>• The sender's command line contains `--headless --no-keys`.<br>• After `AttachConsole`, `GetConsoleWindow()` is 0: a console with no window.<br>• No visible window for the launcher or sender pid.<br>• Neither pid was ever the foreground window (sampled every 30 ms).<br>• The output file holds the start-up line, `console keys off (--no-keys)` and the status lines, and never a prompt.<br>• After a typed control `STOP`, *Events* shows `RC sender process exited (code 0); last output:` plus the tail lines. |
| R1 no keyboard input (injection attempt) | **PASS** | as above | I attached to the hidden console of the UI-spawned sender and typed `q i a d k f R c`, `iSTOP⏎ qSTOP⏎ kCAMERA⏎ aARM⏎ dUNPLUG⏎ cNOCLIENT⏎ RRESUME⏎`, plus 3 × `CTRL_C_EVENT`. Nothing changed: still FPV/streaming, arm SAFE, controller connected, camera off, process alive. Only Ctrl+Break (a same-user process attaching to the console) could end it; such a process could also simply kill it. |
| R1 no focus during repeated UI smoke runs | **PASS** | `runs/fgwatch_smoke.txt` | `fgwatch.py 200` ran during 10 smoke runs (13:36:39–13:38:26). The foreground stayed on the user's own windows (Brave, then Mission Planner after the runs). No `Terminal` or console, no sender or Tk window. The WP13 log had `Terminal` in front for about 11 s per run. |
| R2 no single key changes stream / mode / camera | **PASS** | `__main__.py:210-284` (`confirm`, `quit_ok`, `key`), `:529-555` (Ctrl+C → `interrupted` → `q`) | `headless_probe.py` run 1, on a real windowless console with the stream running. **Every** key 0x20–0x7E, plus `^C ESC TAB ^Z BS ^D ^Q NUL`, plus key records for Ctrl+C (VK_C+Ctrl), Ctrl+Break, F1 and Alt+q, plus 3 × `CTRL_C_EVENT`, each followed by Enter: mode, streaming, bridge RUN, controller, arm switch and camera were all unchanged. The packet rate stayed at about 250/s (103 + 4 + 3 checks, all PASS).<br>**Wrong words** (19 cases) change nothing: `istop`, `iSTOPP`, `i stop`, `i⏎STOP⏎`, `qstop`, `q⏎`, `qSTOPq`, `kcamera`, `kCamera`, `aarm`, `aSAFE` (wrong word for the current state), `dunplug`, `dPLUG`, `fstart`, `rSTOP`, `RRESUMe`, `cnoclient`, `iRESUME`, `kSTART`.<br>**Session log:** exactly one `mode` record (`fpv`) and no `camera` record. |
| R2 typed words still work | **PASS** | `headless_probe.py` run 2 | `kCAMERA` on, then off. `iSTOP` → idle, sim FAILSAFE. `fSTART` → streaming. `aARM` / `aSAFE`. `dUNPLUG` → stream stops. `dPLUG` → stays stopped. `rSTART` → streaming. `s` and `h` act at once. `qSTOP` → exit 0, sim FAILSAFE. |
| R2 Ctrl+C → STOP gate (implementer's addition) | **PASS** | `ctrlc_dbg2.py` | I started the sender in a console where Ctrl+C is *not* ignored, as a human would have it.<br>• **Streaming:** each Ctrl+C prints the `QUIT … Type STOP + Enter` prompt. The stream keeps going (260 packets/s). Enter cancels. Ctrl+C + `STOP` exits 0.<br>• **Idle:** Ctrl+C quits at once with rc 0, as documented (nothing is streaming). |
| R2 piped / NUL stdin | **PASS** | `headless_probe2.py` | I started the sender through `cmd /c … < NUL` and `type in.txt \| …`, with the console as stdout. `i q k f a d r R c` and Ctrl+C are all refused with "needs a typed confirmation on an interactive console" (9 refusals printed), and the stream is unchanged. The piped `STOP/START/CAMERA/ARM` lines are never acted on. |
| R2 sim keys | **PASS** | `__main__.py:265-283` | `a` needs `ARM`/`SAFE` and `d` needs `UNPLUG`/`PLUG`. The `--sim-armed` toggle bug (report §5.8) is fixed: `a` reads the current switch value. |
| R2 README key table | **PASS** | `gcs/README.md:105-130`, module docstring `__main__.py:26-35` | It matches the code key by key: `s`, `h`/`?` at once; `f`/`r` `START`; `R` `RESUME`(+`THROTTLE`); `c` `NOCLIENT`(+`LANDED`); `i` `STOP`; `k` `CAMERA`; `q`/Ctrl+C `STOP` while streaming; `a` `ARM`/`SAFE`; `d` `UNPLUG`/`PLUG`. Ctrl+Break and closing the window are documented as hard exits. |
| R2 Ctrl+Break / closing the console | **acceptable, documented** | README:129-130 | Ctrl+Break ended a streaming sender in 0.05 s (rc `0xC000013A`). The sim printed `no valid rc_up for 252 ms > T_hold: FAILSAFE`. This is the same path as a kill or crash, which the system is designed for (bridge T_hold → client failsafe).<br>Ctrl+Break is a deliberate two-key chord, not a stray single key. A close event cannot be refused by Windows design. See finding 2. |
| `is_console()` NUL fix | **PASS** | `__main__.py:391-405` | `isatty()` is True for NUL on Windows, and `GetConsoleMode` fails on it. The implementer's probe test (`test_spawn_sender_gives_no_console_window_and_no_input`) and my NUL run both give `interactive=False`. A real console still gives True: the typed words work in run 2. |
| UI close confirmation | **PASS** | `ui/app.py:1020-1024` | With the sender up, `close()` showed the "keeps running in the background… Close the UI?" box. On Cancel the UI stays open. `shutdown()` (smoke) is unchanged. |
| `--resume` / `--mode carrier_only` via the UI | **PASS (documented)** | README:64-68; report §5.6 | `ui_probe.py resume` and `ui_probe.py carrier`: the sender gets `--no-keys --sim-armed --resume` (or `--mode carrier_only`). It stays idle, the sim receives 0 packets, and `sender-*.log` says "RESUME (CARRIER-ONLY) needs a typed confirmation on an interactive console … nothing sent". The UI itself shows no notice (finding 3). |
| R3 tests | **PASS** | see Tests | The tests are real: actual keystrokes go into a real console, the real sender runs against bridge_sim, and the runtime tests drive every key × answer × interactive/piped. One weakness: finding 4. |
| R4 no regression | **PASS** | see Tests / Smoke | `pytest gcs` ×3 green; the windowed full run on the merged tree is green; every earlier script gives the same result on WP15 as on `main`; `%APPDATA%\vtol-gcs` is absent before and after. |

## Contract results

- C2, C2.1, C3 and the control channel are untouched. No protocol, API or control-channel file changed.
- **WP08a acceptance:** its C2 key diff is NONE on both trees. The normalised output is identical to `main`'s, apart from two expected differences:
  - the old `keys:` help line is no longer printed when stdout is a pipe (keys are not read then);
  - one more status line (timing).
- **Control `stop`:** still needs the typed `STOP` while streaming (attack.py).

## Tests run (commands + results)

Python `S\venv\Scripts\python.exe` (3.12).

| Run | Command | Result |
|---|---|---|
| full ×3 (worktree) | `python -m pytest gcs -q -p no:cacheprovider` | 671 passed, 1 skipped (79.6 s, 79.8 s, 80.3 s) — `pytest1-3.txt` |
| full windowed, merged tree | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs` in `mergeclone` | **672 passed** (91.9 s) — `pytest_merged_ui.txt` |
| smoke ×10 | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs/tests/test_ui.py -k smoke`, 10× | **10/10** passed (10.3–10.7 s) — `runs/smoke10.txt` |
| WP08a `acceptance.py` | on WP15 and on a `main` worktree | same results (normalised diff above): CORS/PNA/405, SSE, kill → FAILSAFE, sim-armed stays idle, piped RESUME refused, APPDATA False |
| WP08b `attack.py` | WP15 / main | 42 PASS + 2 FAIL on both: the known script flaws (`icacls` substring, client-side `BrokenPipeError`) |
| WP08b `attack.py armed` | WP15 / main | 43 PASS + the same 2 FAIL on both |
| WP08b `attack2.py` | WP15 / main | identical: ends at the expected `KeyError: 'result'` on `prepare_resume` after the stop |
| WP08b `regress.py` | WP15 / main | identical: C2 exact, CORS/405, kill → `RUN → FAILSAFE` |
| WP08b `menu_e2e.py` | WP15 / main | identical apart from paths |
| WP13 `race_probe.py` n=30 | WP15 / main | **ALL PASS** on both. The diffs are only the interleaving order of log lines. |

**Clean-up:** `attack2.py` left one `bridge_sim` (launcher + child) per tree. I started them, and I ended all four processes. The only Python processes left are the user's own `kisync` (`pythonw`), which existed before I started.

## Smoke tests (what I ran + result)

- **`scripts/headless_probe.py`** (`runs/headless_probe.txt`): run 1 (all keys, wrong words, Ctrl+C, Ctrl+C during a prompt, control STOP during a prompt), run 2 (typed words), run 3 (Ctrl+Break).
  - 46/52 checks PASS.
  - The 6 FAILs are mistakes in my own probe, not in WP15:
    - three FAILSAFE checks compared an `IntEnum` with a string. The sim printed `FAILSAFE` each time.
    - run 4 sent Ctrl+C to a process that ignores it by inheritance. It was redone in `ctrlc_dbg2.py`.
    - the two run 5 checks redirected stdout, so keys were never read. They were redone in `headless_probe2.py`.
- **`scripts/headless_probe2.py`:** NUL and piped stdin with a console stdout. PASS.
- **`scripts/ctrlc_dbg.py` and `ctrlc_dbg2.py`:** Ctrl+C with the inherited ignore flag set, then cleared. Gives finding 4, and the R2 Ctrl+C PASS.
- **`scripts/ui_probe.py main|resume|carrier`:** the real `App` in-process, which starts the real sender:
  - 10/10 checks for `main`;
  - 3/3 each for `resume` and `carrier`.
- **`fgwatch.py`** during the smoke runs and the UI probe (`runs/fgwatch_smoke.txt`): no sender or console window was ever in front.

## Findings

1. **MINOR — a pending console prompt blocks the main loop.** Where: `__main__.py:210-219` (`confirm` → `read_line()`), main loop `:548-561`.
   - **What happens:** any stream key (now `q i f r k a d` and Ctrl+C, before only `R` and `c`) blocks the main loop in `readline()` until Enter.
   - **Measured** (`headless_probe.py` run 1): with an `f` prompt pending, the UI's control `stop` (typed `STOP`) returned `ok: true`, but the process kept streaming. It ended only 3.2 s later, when I pressed Enter on the console. In principle the delay is unbounded.
   - **Also:** while the prompt waits, the console prints no events or alarms either, not just no status line. README:112-113 mentions only "the status line pauses".
   - **Why MINOR:**
     - the RC stream stays up, which is the safe direction;
     - the `begin_stop` gate already refuses every later start;
     - the prompt is visible as the console's last line;
     - it applies only to a hand-started sender; the UI-spawned one reads no keys;
     - before WP15 the same stray key would have *ended* the stream at once.
   - **Expected (optional):**
     - read the typed word without blocking: poll `msvcrt` while checking `stop_requested` and draining events, or use a timeout;
     - or document in README that a pending prompt defers a UI/control stop and hides alarms until Enter.
2. **MINOR (acceptable, documented) — Ctrl+Break and closing the console end a hand-started sender at once.** Where: README:129-130.
   - **Verified:** a streaming sender exits in 0.05 s, and the sim reaches FAILSAFE after T_hold. This is the designed path for a lost sender.
   - **Why acceptable:** Ctrl+Break is a deliberate chord; on many laptops it needs Fn as well. Closing the window cannot be refused (Windows design).
   - **Optional:** handle `SIGBREAK` like Ctrl+C. It is cheap with the same `signal.signal` call.
3. **MINOR — `--resume` / `--mode carrier_only` given to the UI are refused silently in the UI.** Where: `ui/link.py:74-88` (passed through), `__main__.py:541-544`.
   - **What happens:** the refusal is safe (nothing sent, verified) and documented (README:64-68). But it appears only in `sender-*.log`. *Events* shows nothing, because the sender keeps running.
   - **Expected (optional):** the UI warns, or rejects these flags itself, and points to the RESUME / CARRIER-ONLY buttons.
4. **MINOR (test quality) — the Ctrl+C steps in the real-process tests can pass without Ctrl+C being delivered.** Where: `tests/test_main_cli.py` (Ctrl+C in the key loop), `tests/test_ui.py` (spawned-sender test).
   - **What happens:** a process started from a parent that ignores Ctrl+C (`CREATE_NEW_PROCESS_GROUP` ancestry, as in my shell) inherits the ignore flag. `GenerateConsoleCtrlEvent(CTRL_C)` then never reaches its handler (`ctrlc_dbg.py`: no QUIT prompt).
   - **Gap:** the tests only assert "nothing changed" and never that the QUIT prompt appeared. So the SIGINT → `q` mapping is not proven by the suite in such environments.
   - **Not a defect in the code:** I verified the behaviour independently with the flag cleared (R2 Ctrl+C row).
   - **Expected (optional):** clear the flag in the target (a wrapper calling `SetConsoleCtrlHandler(NULL, FALSE)`), and assert the prompt by reading the console buffer.
5. **MINOR (observation) — no clean-up of the sender output files.** Where: `ui/link.py:91-93`.
   - **What happens:** each spawn creates a new `sender-*.log`, which grows by one status line per second (about 0.5 MB per hour). Nothing rotates or deletes these files.
   - **Cosmetic:** `close()` says "it has no window" even when the UI is attached to a hand-started sender that has a console.
   - **Expected:** nothing for now; maybe a note in README.

**Not verified:** the frozen build (`vtol-gcs.exe` → `vtol-gcs-sender.exe` with `CREATE_NO_WINDOW`). No build was made; the code path is the same `spawn_sender`.

## Report honesty

- The claims match what I found:
  - 671 passed / 1 skipped ×3;
  - smoke 10/10;
  - the foreground never changed;
  - the earlier scripts give the same results;
  - APPDATA was never created.
- Spot checks of the line references are all exact (link.py:48/91/96/106/117/125, `__main__`:102/131/210/221/236/391/408/527, app.py:109/899/905/920/1020, README:109).
- The deviations (§5) are justified, and the extra keys and Ctrl+C change are documented.

## Approval rationale

- Every MUST requirement (R1–R4) passes on my own evidence:
  - the UI-spawned sender has no window, no focus and no input path, its output goes to a file and to *Events*, and injection attempts change nothing;
  - no single key, wrong word or Ctrl+C changes the stream in a hand-started sender, and the typed words work;
  - the `is_console` NUL fix is correct;
  - the suite and the earlier verifiers' scripts are unchanged against `main`.
- There are zero BLOCKER and zero MAJOR findings. The five MINOR findings are listed above; findings 1 and 3 are the most worthwhile follow-ups.
