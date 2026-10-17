# WP16 verification — round 1
VERDICT: APPROVED

Branch `wp/16` at `18575e3`, base `81e6c52` (merge-base with `main`). Verifier: independent agent; nothing in the worktree was changed (`git status` clean at the end).
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`. My scripts: `S\verify\WP16\scripts\`, logs: `S\verify\WP16\runs\`.

## Scope

`git diff 81e6c52 HEAD --name-only` lists 9 files. All are in "Files you own" (`gcs/**` and the report):
- `gcs/vtolgcs/__main__.py`, `gcs/vtolgcs/config.py`, `gcs/vtolgcs/ui/app.py`, `gcs/vtolgcs/ui/link.py`
- `gcs/tests/_console.py`, `gcs/tests/test_main_cli.py`, `gcs/tests/test_ui.py`, `gcs/README.md`
- `docs/tasks/reports/WP16-IMPLEMENTATION.md`

**Merge:** `main` is still at the merge base (`81e6c52`). The merge into a scratch clone (`S\verify\WP16\mergeclone`) is a clean fast-forward.

**Commit trailers:** `Co-Authored-By: Claude Opus 5.5` and `Claude-Session:`. Both are fine.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 (MUST) prompt never blocks the main loop | **PASS** | `__main__.py:348-447` (`PromptRunner`), `:191-217` (`feed`, `end_input`), `:278` (`signature`), `:589` (`_read_chars`), main loop `:745-788`, `:797` | The action runs in a worker thread. The main loop reads characters only while the worker waits, and it wakes on `stop_requested`. On exit the RC stream is stopped first. My own probe (`r1_probe.py`, `runs/r1_probe.txt`) tested every prompt kind, 3 runs each, using a real Ctrl+C-enabled console, bridge_sim, and a UI `stop` (typed `STOP`) sent while the prompt was open. Results are below the table. |
| R1 other control commands | **PASS** | `runs/r1_other.txt` (16/16) | With a k, i, q or a prompt open:<br>• `set_camera on` answers in 0.3–3 ms and cancels the prompt (camera False → True).<br>• `request_mode idle` answers in 0.4–2 ms; the last `rc_up` comes −2.5…+1.3 ms after it (0–1 packets).<br>• The prompt is cancelled with the "state changed" message.<br>• `q` then quits at once (idle). |
| R1 events/alarms keep printing | **PASS** | `race_probe16.py` case E, `caseE2.py` (`runs/raceE/`) | • `ALARM RAISED: CRIT bridge_no_status` prints below an open QUIT prompt.<br>• `REFUSED fpv: …` prints below an open launch RESUME prompt.<br>• In both cases the half-typed answer (`ST`, `RES`) is redrawn as the last line.<br>• Esc cancels the prompt, and nothing is sent. |
| R1 cancel on state change, incl. between Enter and action | **PASS** | `read_line` re-checks after the Enter (`:418-430`); the main loop checks every 20 ms (`:768-771`) | My race probe (`race_probe16.py`, `runs/race_probe16.txt`, **67/67**) uses a persistent injector, so the Enter lands within about 1 ms:<br>• **Race A** (25 trials, Enter vs. UI `request_mode idle` at −20…+20 ms): 23 cancelled, 2 accepted. Whenever it was accepted, the session log shows `camera` *before* `mode idle`.<br>• **Race B** (25 trials, `i`+`STOP` Enter vs. UI `set_camera on`): 21 cancelled, 4 accepted. Whenever it was accepted, `mode idle` comes before `camera`.<br>• In no trial did a cancelled prompt act, and in no trial did an action run after the change.<br>• **Race D** (12 trials, Ctrl+C vs. Enter on the CAMERA prompt): each trial ended either cancelled (camera unchanged) or toggled (Ctrl+C after it). Every trial opened the QUIT prompt. The process stayed up and kept streaming. |
| R1 "ignore typed text until Enter after cancel" | **PASS (safe), message adequate; see F1** | `__main__.py:739-745`, `:779-783` | Case C (`runs/race/caseC_*.txt`):<br>• The cancel message says "what is typed up to the next Enter is ignored".<br>• `fSTART⏎` typed after the cancel changes nothing.<br>• After that Enter, `fSTART⏎` works again.<br>• Esc also ends the ignored line.<br>• Ctrl+C still opens the QUIT prompt at once.<br>The behaviour can only *drop* input, which is the safe direction. Its feedback is weak (F1). |
| R2 (MUST) refusal in UI Events | **PASS** | `ui/link.py:163-182`, `ui/app.py:908-930`, `:1193-1194` | My windowed UI probe (`ui_probe16.py`, `runs/ui_probe16.txt`, **19/19**) ran four cases: `--sim-armed --resume`, the `--resu` abbreviation, `--mode carrier_only`, and `--sim-armed --mode=carrier_only`.<br>• Events shows `RC sender refused <flag> at launch: <PREFIX> needs a typed confirmation on an interactive console; … - nothing sent`, plus the `Use Flight -> …` hint.<br>• bridge_sim got 0 packets.<br>• A plain start gives no launch note.<br>• **Attach case:** with a hand-started sender running, `--resume` gives `--resume ignored: the UI attached to a running RC sender…`; no sender is spawned and nothing is sent. |
| R3 (SHOULD) Ctrl+Break = Ctrl+C; uncatchable documented | **PASS** | `__main__.py:716-722`; README:149-157; module docstring `:31-40` | Ctrl+Break on a streaming hand-started sender opens the QUIT prompt. Streaming continues at 250/s, and a UI stop then works (r1_probe "QUIT(Ctrl+Break)" ×3).<br>Mutation M1 (SIGBREAK removed) makes the test fail: the process dies. README documents closing the window, logoff, shutdown and Task Manager as uncatchable, and the hidden-console case. |
| R4 (MUST) Ctrl+C tests deliver for real and assert the prompt | **PASS** | `tests/_console.py:84-100` (`vtolgcs_command`), `test_main_cli.py:371-433`, `test_ui.py:170-176` | The tests wait for one more `QUIT: the RC stream is running` line on the console screen after Ctrl+C, after Ctrl+Break, and after `k`+Ctrl+C.<br>**Mutation M4** removes the flag clearing in `_console.py`. The test then times out waiting for the QUIT prompt. This proves the environment *does* inherit the ignore flag and that the tests now detect non-delivery. |
| R5 (MUST) sender-*.log rotation | **PASS** (MINOR F3, F4) | `ui/link.py:126-160`, `config.py:179-183`, `:460-461`, `app.py:908-911` | **Function level** (`r5_probe.py`, `runs/r5_probe.txt`):<br>• keep 20 of 31 deletes exactly the 11 oldest by mtime;<br>• the size cap keeps the current file plus the newest files within the cap;<br>• a current file that is over the cap and has the oldest mtime is kept;<br>• `.bak`, `.LOG`, `Sender-`, wrong digit counts, `session-*`, `sender-notes.log` are not deleted, and a directory with a matching name is not removed;<br>• a file open in-process is skipped, and so is a file held by a running child process (exactly as `spawn_sender` holds it). It is deleted after the child exits;<br>• a missing folder returns `[]`.<br>**End to end:** 30 old files plus decoys, then one windowed UI start. 20 remain (19 old + the new one), the 11 oldest are gone, and the decoys are untouched. |
| R6 (MUST) no regression | **PASS** | see Tests | pytest ×3 green, smoke 10/10, and the earlier scripts are identical to WP15. `%APPDATA%\vtol-gcs` is absent before and after. |

**R1 measured stop timing, UI `stop` with the prompt open** (last `rc_up` relative to the request; exit time of the process):

| Prompt | last rc_up | pkts after | exit |
|---|---|---|---|
| IDLE `i` (STOP) | −2.1…+1.5 ms | 0–1 | 100–126 ms |
| QUIT `q` (STOP) | +1.5…+2.8 ms | 1 | 122–200 ms |
| QUIT via Ctrl+C | −1.6…+3.2 ms | 0–1 | 138–240 ms |
| QUIT via Ctrl+Break | −0.5…+2.1 ms | 0–1 | 228–240 ms |
| CAMERA `k` | −2.8…+3.5 ms | 0–1 | 121–219 ms |
| START `r` (streaming) | −1.6…+1.6 ms | 0–1 | 118–185 ms |
| sim ARM `a` / UNPLUG `d` | −2.2…+1.1 ms | 0–1 | 101–229 ms |
| START `f` (idle), NOCLIENT `c` (idle), RESUME `R` (idle, armed), `--resume` launch, `--mode carrier_only` launch | nothing streams | 0 | 142–306 ms |

All prompts were confirmed on screen before the stop. Every run exited with rc 0, and the session log has no extra mode record. The 100 ms limit is met with a wide margin.

`c` while streaming FPV opens no prompt (the preview is "not possible" while the sim client is heard), so NOCLIENT was covered in idle and at launch.

## Contract results

- C2, C2.1 and C3, the control channel and its words are unchanged; no protocol or API file changed.
- `attack.py` still requires the typed `STOP` for a control stop while streaming.
- WP08a acceptance, normalised, is identical to WP15's run except for the interleaving of one log line.

## Tests run (commands + results)

Python `S\venv\Scripts\python.exe` (3.12).

| Run | Command | Result |
|---|---|---|
| full ×3 (worktree) | `python -m pytest gcs -q -p no:cacheprovider` | **682 passed, 2 skipped** ×3 (89.0 / 89.7 / 90.3 s) — `runs/pytest1-3.txt` |
| UI smoke ×10 (+ fgwatch) | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs/tests/test_ui.py -k test_ui_smoke_with_spawned_sender` | **10/10** in each of two series (20/20, 10.33–10.40 s) — `runs/smoke10.txt`, `runs/smoke10b.txt` |
| mutation checks | `scripts/mutate.sh` in a scratch clone | M1 no SIGBREAK, M2 main loop blocks on a prompt, M3 no state-change cancel, M4 no Ctrl+C flag clearing, M5 prune deletes current, M6 no discard: **each is caught** by the new tests (`runs/mutations.txt`, `runs/mut_*.txt`) |
| WP08a `acceptance.py` | `scripts/run_old.sh` | exit 0. Normalised diff to WP15: only the order of one log line. APPDATA False. |
| WP08b `attack.py` / `attack.py armed` | | 42/44 and 43/45. The two FAILs are the known script flaws (`icacls` substring, client `BrokenPipeError`), the same as in WP15. |
| WP08b `attack2.py` | | the expected `KeyError: 'result'` on `prepare_resume` after the stop, as in WP15 |
| WP08b `regress.py`, `menu_e2e.py` | | normalised output identical to WP15 |
| WP13 `race_probe.py` n=30 | | **RESULT: ALL PASS** |

**fgwatch:** the first watcher crashed on a Unicode window title in the user's browser. The second (`runs/fgwatch_smoke2.txt`) covered all 10 runs of series 2.
- No console window or sender window was ever in front.
- The user was active on the desktop (Brave, an INAV Configurator installer). The UI's own Tk windows (`vtol-gcs 0.1.0`, the `vtol-gcs status` bar) were briefly in front 4 times, each right after one of the user's dialog or installer windows closed (Windows passes activation to the next top-level window).
- WP16 does not touch window creation.

**Not run:** the full windowed `VTOLGCS_UI_SMOKE=1 pytest gcs protocol` on the merge clone; the permission system refused it while the user was working on the desktop. The merged tree is identical to the worktree (fast-forward). The WP16 windowed behaviours were covered by the smoke ×10 and by `ui_probe16.py`.

## Smoke tests (what I ran + result)

- `scripts/r1_probe.py`: every prompt kind × 3, plus other control commands (`runs/r1_probe.txt`, `runs/r1_other.txt`).
- `scripts/race_probe16.py` A/B/C/D/E and `scripts/caseE2.py`: races, the ignored line after a cancel, events while a prompt is open.
- `scripts/r5_probe.py`: rotation with fake files.
- `scripts/ui_probe16.py`: the windowed UI with `--resume`, `--resu`, `--mode carrier_only`, the attach case, and rotation at UI start.

## Findings

1. **MINOR — weak feedback for the ignored line after a cancel.**
   - **Where:** `__main__.py:779-783`, `:785`.
   - **What happens:** after a cancel, the echoed characters are overwritten by the status line within 0.5 s, because the status line resumes while `discard` is set (`caseC_screen2.txt`: the typed `s` vanished). When the ignored line ends with Enter, nothing is printed.
   - **Effect:** an operator who missed the cancel message and types `iSTOP⏎` sees nothing happen and gets no reason. This is safe (input is only dropped, and Ctrl+C / UI still work), but it can confuse.
   - **Expected (optional):** on that Enter, print `ignored (prompt was cancelled): '<text>'`, and keep the status line paused while discarding.
2. **MINOR (cosmetic) — log lines break the half-typed echo.**
   - **What happens:** `logging` output (stderr, e.g. `INFO vtolgcs.runtime: camera requested ON`) does not go through `print_line`, so it is written straight after the half-typed answer on the same line (`runs/raceE/caseE2_NOCLIENT_c_idle.txt`: `NOCL14:34:11 INFO …`).
3. **MINOR — "exact pattern" uses `\d`.**
   - **Where:** `SENDER_OUTPUT_RE` (`ui/link.py:126`).
   - **What happens:** `\d` also matches non-ASCII digits. A file named `sender-٢٠٢٦١٠١٧T120000Z.log` (Arabic-Indic digits) was deleted in `r5_probe.py`.
   - **Effect:** none in practice.
   - **Expected:** `[0-9]` or `re.ASCII`.
4. **MINOR (doc wording) — "files still open … are never deleted" (README:74-76) is true only for handles without `FILE_SHARE_DELETE`.**
   - **Protected as claimed:** the sender's own inherited handle and Python `open()`; I verified both.
   - **Not protected:** a file held by a reader that shares delete (some log viewers) *is* deleted (`r5_probe.py` INFO line). This is harmless, since it is an old file.
5. **MINOR (observation) — a microsecond window is left between `read_line`'s final check and the action.**
   - **Where:** `__main__.py:425-429`, no lock.
   - **Effect:** 50 race trials never hit it. If hit, the result equals a UI command that arrives just after the action, and the sender's own interlocks and token checks still apply.
   - **Expected:** none needed.
6. **MINOR (nit) — wrong attach note with `--attach-only`.**
   - **Where:** `app.py:1193`.
   - **What happens:** with `--attach-only` and `--resume` but no running sender, the note still says "the UI attached to a running RC sender".
7. **Observation — no echo while stdout is redirected.**
   - **What happens:** with stdout redirected but stdin a console (`--headless --resume > file`), the typed answer is now read through `msvcrt` and is not echoed. Before WP16 the console's cooked input echoed it.
   - **Status:** from code reading; edge case, not tested.

**Housekeeping (not a code finding):**
- `attack2.py` ends at its known KeyError before `sim.terminate()`. It left the bridge_sim that my run started: launcher PID **6564** and child PID **20120**, `…\wt\WP16\gcs\tools\bridge_sim.py --port 56668`, started 14:43:24.
- My `Stop-Process` on exactly these two PIDs was refused by the permission system, so they are still running. Please end them (`Stop-Process -Id 6564,20120`).
- No other process of mine remains. I touched no other agent's processes, nor the user's `kisync`.

## Report honesty

- The claims match what I found:
  - 682 passed / 2 skipped ×3;
  - smoke 10/10;
  - R1 timing (they measured −2.3…+1.7 ms; I measured −2.8…+3.5 ms);
  - the earlier scripts are the same as WP15;
  - APPDATA was never created.
- The line references spot-checked (29 of them) are exact.
- The "foreground never changed" claim is consistent with no console or sender window reaching the front. My run shows the UI's Tk windows taking activation only after the user closed their own windows.
- Deviations §5.1–5.7 are justified and documented.

## Approval rationale

- **Every MUST requirement passes on my own evidence:**
  - **R1:** with any prompt open, a UI stop ends the stream within about 3 ms. Other commands act at once, events keep printing, and prompts are cancelled on a state change, including between the Enter and the action (race-tested; no inconsistent outcome in 62 race trials).
  - **R2:** the refusal reaches Events in the windowed UI.
  - **R4:** the tests demonstrably deliver Ctrl+C and Ctrl+Break and assert the prompt (mutations M1 and M4 caught).
  - **R5:** rotation keeps 20, caps the size, and never deletes the current, an open or a non-matching file.
  - **R6:** no regression.
- **R3 (SHOULD)** passes.
- There are zero BLOCKER and zero MAJOR findings. The MINOR items F1–F7 can be follow-ups; F1 and F3 are the most worthwhile.
