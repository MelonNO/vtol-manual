# WP13 verification — round 1
VERDICT: APPROVED

Verifier: independent verification agent. Worktree `S\wt\WP13`, branch `wp/13` at `fab6398`. Diff base `git merge-base main HEAD` = `79b321a`.

- The worktree was used read-only. `git status` is clean after all runs; pytest only wrote the git-ignored `__pycache__`.
- Comparison runs used throw-away clones under `S\verify\WP13\`:
  - `base` = `79b321a`, the WP08b code;
  - `mergeclone` = current `main` `7e56547` merged with `wp/13`.
- The source repository is shallow, so its `shallow` file was copied into the clones.
- `%APPDATA%\vtol-gcs` does not exist before or after the runs.
- My scripts are in `S\verify\WP13\scripts\` and their logs in `S\verify\WP13\runs\`.

## Scope (13 files changed)

- `gcs/vtolgcs/{control,sender,runtime,crsf_menu,video}.py`, `gcs/vtolgcs/ui/app.py`, `gcs/README.md`
- `gcs/tests/{test_control,test_sender,test_crsf_menu,test_ui,test_video}.py`
- `docs/tasks/reports/WP13-IMPLEMENTATION.md`

All are inside the brief's "Files you own" (`gcs/**` plus the report).

- `sender.py`, with `begin_stop`, the start gates and `accepted_seq`, is needed for R4.
- The one-line `runtime.py` change is justified in report §5.2.

No contract was touched. C2 is re-checked below.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 pipe ACL | **PASS** | `control.py:148` `user_only_sddl`, `:237-271` `SecurePipeListener._new_handle` (SECURITY_ATTRIBUTES + `PIPE_REJECT_REMOTE_CLIENTS` `:82,:267`); test `test_control.py:364` (not skipped here) | See below |
| R2 handshake | **PASS** | `control.py:70` (2.0 s), `:274-297` `_Deadline` / `server_handshake`, `:471-496` accept-only loop, `:498-519` one thread per connection, `:68` `MAX_PENDING`; tests `test_control.py:383,:407` | See below |
| R3 rate limit and bounded work | **PASS** (residual: finding 1) | `control.py:73-79`, `:300-328` `RateLimit`, `:521-551` `_serve` (`_work_lock` plus server budget), `:553-580` `_process` (refuse with `id`, warning ≤ 1/s, pause ≥ 1 token) | See below |
| R4 stop / RESUME race | **PASS** | `sender.py:379-392` `begin_stop`; gates `:437`, `:468`, `:509`, `:545`; `control.py:612-616` (refuse after stop except `request_mode idle` / `stop`), `:682-694` | See below |
| R5 Revert label | **PASS** | `crsf_menu.py:355-367,:382,:388-390`; `ui/app.py:691-698` | See below |
| R6 GStreamer cache | **PASS** | `video.py:145-166` `GstLocator`; `ui/app.py:117,:436,:462` | `find_gst` is no longer called from the UI (grep). Re-checked after 30 s and on *Launch viewer*. The test drives 299 redraws |
| R7 fan-out docstring | **PASS** | `video.py:9-13`; README "Video helper" | The wording now matches reality: a new UI cannot stop or adopt the helper, and the orphan is ended in Task Manager |
| R8 tests and regression | **PASS** | see Tests / Smoke | 3 full + 1 merged + 3 full windowed runs, all green. Every WP08a/WP08b acceptance check gives the same result as before |

### R1 (pipe ACL)

- **My own `GetSecurityInfo` read-back on a real headless sender** (`acl_probe.py`) gives `O:<user>G:<group>D:P(A;;FA;;;<user SID>)`.
- **Later instances too:** I read the instance created by `accept()` after 3 connections. It has the same DACL (the unit test only reads the first instance).
- **Remote opens are refused (error 5)** through `\\127.0.0.1\pipe\…`, `\\localhost\…` and `\\<hostname>\…`, on the first instance and on later ones.
- **Control on the WP08b base code:** the same probe shows the default DACL (`SY`, `BA`, user, `WD:FR`, `AN:FR`), and all three remote opens are **ACCEPTED**.
- **`control.json`:** `icacls` shows only `<user>:(F)`.

### R2 (handshake)

- **One stalled raw client** (my `CreateFileW` client reads the challenge and never answers):
  - a legitimate client connects and pings in **0.5 ms**;
  - the stalled client is closed after **2.00 s**.
- **The WP08b `attack.py` stall check now PASSes.** See finding 2 for the many-client case.

### R3 (rate limit and bounded work)

All measurements use an independent UDP tap process, separate flooder processes, and the real headless sender. Numbers are in the Smoke section.

- **One flooding connection:**
  - executed: 1,100 per 21 s ≈ **52/s**;
  - refused: about **47/s**;
  - the sender logs one rate-limit warning per second.
- **6 flooding connections:** 150 messages/s in total, no refusals (each connection is under 50/s).
- **The stream keeps 250 Hz in every phase.** On WP08b, 6 connections pulled it down to **133.7 Hz**, with 2,354 gaps over 6 ms in 20 s.
- **STOP latency during a 6-connection flood stays at about 46 ms.** I measured, through the UI's `ControlClient`:
  - typed STOP: 45.7–46.5 ms;
  - `request_mode idle`: ≤ 46.4 ms;
  - `fpv`: ≤ 47.7 ms;
  - 20 STOP-path refusals: max 45.8 ms;
  - ping: p99 47.6 ms, max 51.7 ms.
- **Why it is bounded:** about (number of busy connections) × 1/150 s, so ≤ about 47 ms with the 8-connection cap. The lock hand-over is effectively round-robin, and no starvation was seen.
- **Margin:** the UI client timeout is 2 s.
- **The trade-off is acceptable:**
  - without a flood, ping p50 is 0.3 ms;
  - on WP08b, STOP took 4.6 ms under the flood, but the RC stream was degraded to 134 Hz.

### R4 (stop gate)

`race_probe.py` runs over real named pipes, with independent `ControlClient` connections and random 0–1.5 ms skew. **All pass.**

**Races (stop without the word, from idle):**

| Race | n | Stop won | Start won | Both |
|---|---|---|---|---|
| `confirm_resume` vs `stop` | 60 | 26 | 34 | **0** |
| `request_mode fpv` vs `stop` | 60 | 29 | 31 | **0** |
| `confirm_carrier_only` vs `stop` | 20 | 12 | 8 | **0** |

- Whenever stop won, I waited 150 ms and checked:
  - **no RC packet reached the sim** (`rx_ok == 0`);
  - `fpv` was refused, both through the channel and through `rt.request_mode`, the console path.

**Other orderings:**

- **Pipelined on one connection** (`stop` and `confirm_resume` written back to back): stop ok, resume refused, 10/10.
- **Resume queued on a second connection behind 5 flooders** that saturate the budget: never both ok, 10/10. The resume was sent first and won every time, and the stop was then correctly refused because it had no word while streaming.

**Stop in every state:**

| State | Stop without the word | Typed STOP | Notes |
|---|---|---|---|
| idle | ok | — | a repeated stop is ok |
| FPV | refused | ok | lower-case `stop` is also refused, and a refused stop leaves the gate open. After STOP: fpv refused, `request_mode idle` ok, restart after idle refused |
| RESUME stream | refused | ok | |
| carrier-only stream | refused | ok | |
| suspended (controller lost) | ok | — | not streaming. The stream does **not** come back when the controller reconnects |
| pending carrier-only preview | ok | — | the confirm is refused afterwards and nothing is sent |

- **WP08b `attack2.py`:** stop (idle) is ok, then `prepare_resume` has no `result` (refused), as the report predicts.
- **Every start path is gated:** normal start, RESUME prepare and confirm, carrier-only prepare and confirm, `r` restart (it goes through `_request_locked`), and the console keys. A suspended stream resumes only through `_accept`.

### R5 (Revert label)

- **My end-to-end check** (`r5_e2e.py`): the real `App.revert_vtx`, a real `VtxAdmin` over the control channel, and the elrs sim with `vrx_follows=False`.
- **Arm switch ARMED → Revert:**
  - while the revert is in flight, the label shows `reverting...` and Revert is disabled;
  - then `revert FAILED (parameter writes are refused while the client may be armed…)`, Revert is offered again, and the sim VTX stays at 1/0.
- **Disarm → Revert again:** the label shows `reverted`, and the sim VTX is back at 5/4.

## Contract results

- **C2/C2.1** (`regress.py` on WP13):
  - the top-level and second-level keys match exactly;
  - CORS reflects `https://melonno.github.io`, not the evil origin, with `no-store`;
  - OPTIONS → 204, PNA `true`;
  - POST/PUT/DELETE → 405;
  - health is ok.
- **C3 / `crsf_pass`:** unchanged; `menu_e2e.py` gives the full 15-field tree, and VTX writes work.
- **Control channel:** messages are unchanged. The new refusals use the existing reply shape (`ok:false` + `error` or `reasons`, with the request `id`).

## Tests run (commands + results)

`S\venv\Scripts\python.exe -m pytest gcs` (Python 3.12.10), run from the worktree:

| Run | Result |
|---|---|
| 1, 2, 3 | 663 passed, 1 skipped (63 s each) |
| merged tree (`main` 7e56547 + `wp/13`), `pytest gcs protocol` | 663 passed, 1 skipped |
| `VTOLGCS_UI_SMOKE=1` full suite ×3, with my thread-leak plugin | **664 passed** each time |
| `VTOLGCS_UI_SMOKE=1` `test_ui_smoke_with_spawned_sender` alone ×6 | 6/6 pass |
| R1–R4 subset with `-rs` | 11 passed; the DACL/remote test is **not** skipped on this machine |

**Merge:** no conflicts. `main` changed no `gcs/` or `protocol/` files since the base.

**The new tests exercise the real logic** (I opened them):

- the DACL is read back through a handle;
- an SMB open is tried, with a stdlib control pipe as reference;
- real stalled clients;
- rate-limit timing and counts;
- races through two real connections;
- the real `App.revert_vtx` handler.

## Smoke tests (what I ran + result)

### 1. Flood probe (`probe_flood.py`)

Separate processes: sim, tap, headless sender, flooders. A UI-like client pings at 10/s and holds an event stream.

Packet deviation from 4 ms, in ms:

| Run (phase length) | Phase | Hz | p99 | p99.9 | max | gaps > 6 ms |
|---|---|---|---|---|---|---|
| WP13 run a (20 s) | base | 250 | 0.86 | 1.82 | 2.5 | 1 |
| | flood1 | 250 | 1.13 | 3.91 | 10.3 | 5 |
| | flood6 | 250 | 1.54 | 3.74 | 4.5 | 5 |
| WP13 run b (30 s) | base | 250 | 0.64 | 0.97 | 3.9 | 1 |
| | flood1 | 250 | 1.12 | 3.82 | 7.0 | 10 |
| | flood6 | 250 | 0.89 | 2.01 | 3.4 | 1 |
| WP13 run c (30 s) | base | 250 | 0.62 | 1.16 | 1.2 | 0 |
| | flood1 | 250 | 1.25 | 3.25 | 5.9 | 13 |
| | flood6 | 250 | 1.08 | 3.15 | 11.8 | 8 |
| **WP08b base** (20 s) | base | 250 | 0.56 | 1.12 | 1.5 | 0 |
| | flood1 | 250 | 1.63 | 9.41 | 10.5 | 13 |
| | flood6 | **133.7** | 6.50 | 8.38 | 10.0 | **2,354** |

**Diagnostic run** (`probe_diag.py`, 20 s phases, three base phases):

| Phase | p99 | gaps > 6 ms |
|---|---|---|
| base | 0.50–0.78 | 0 |
| tight1 | 0.97–1.08 | 3 |
| paced1@45/s | 0.94 | 0–2 |
| paced3@45/s (130 executed commands/s, all within the limits) | **1.97** | **24** |

### 2. R1/R2 probe (`acl_probe.py`)

See R1 and R2 above.

- Sustained stalling: 10 same-user threads keep re-opening stalled handshakes. During that, **0 of 40** legitimate connects succeeded (finding 2).
- It recovers as soon as the stalling stops.

### 3. Race probe (`race_probe.py`)

See R4. **ALL PASS.**

### 4. WP08b verifier scripts on the WP13 code

- **`attack.py`:** 42/44 (normal) and 43/45 (`armed`).
  - The stall check now PASSes.
  - The 2 FAILs are the script's own flaws named in WP08b round 1: the `icacls` substring, and the client-side `BrokenPipeError` on the oversize send. The server survives, and the next checks pass.
- **`attack2.py`:**
  - SDDL `D:P(A;;FA;;;<user>)`;
  - oversize is closed, and a fresh ping is ok;
  - the 9th connection is refused and recovers;
  - stop → RESUME is refused.
- **`regress.py`:** C2 is exact, CORS and 405 are as before, and `taskkill /F` of the sender → sim `RUN → FAILSAFE` at T_hold.
- **`menu_e2e.py`:** not-supported path after 2.0 s; elrs tree with 15 fields; VTX fields and VRX follow as before.

### 5. Windowed UI smoke

3 full windowed suites plus 6 isolated runs, all pass. RUN, camera reported ON, link up.

**Investigation of the implementer's single failure** (`S\wp13run\fullSmoke.txt`: `camera_reported_on` false, sim log `client: ARMED`):

- **Not a leaked in-process runtime.** My `leakcheck` plugin recorded the `rc-sender` threads alive after each test in 3 full windowed runs. The only ones belong to `test_api.py`'s module-scoped runtime, which ends with that module. No other test leaves a sender running.
- **No orphan sender processes** were present during my runs. I removed two orphan `bridge_sim` processes left by earlier `attack2.py` runs; sims do not send RC.
- **The spawned sender's console window steals the keyboard focus.** `fgwatch.py` shows that during the smoke the sender's new console (`CREATE_NEW_CONSOLE`) became the **foreground window for about 11 s**, taking focus from the user's browser.
- **That console handles single keystrokes** (`__main__.py:186-215`). With `--sim`, the key `a` toggles the fake arm switch to ARMED, which arms the sim client, and the camera interlock then refuses camera ON. That is exactly the failure signature.
- **Most likely cause:** a keystroke typed on this shared, actively used desktop landed in that console. This is consistent with the failure not reproducing in 6 + 5 + 5 isolated runs. It is not a WP13 regression. It does point at a pre-existing product issue (finding 3).

## Findings

1. **MINOR — R3 residual: the timing is much better but not quite "within the normal jitter".** Where: `control.py:521-580`.
   - **What I measured:**
     - Under a token-holding flood, the stream keeps 250 Hz. WP08b fell to 134 Hz with 8 connections.
     - Packets still show p99 about 1.1–2.0 ms against 0.5–0.9 at baseline, and p99.9 about 2–4 ms against about 1–1.8.
     - Per 20–30 s there are 3–24 packets late by more than 2 ms, against 0–1 at baseline.
     - The worst case was 3 connections at 45/s each (130 executed commands/s, all within the limits): 24 late packets in 20 s, about 1.2/s.
   - **Why only MINOR:**
     - This stays below the late-packet alarm (3/s), and nothing is skipped.
     - Only a holder of the per-session token can produce this load. The legitimate UI's own load had no measurable effect in WP08b.
     - The improvement over WP08b is large.
   - **Wording:** report §1 and README ("does not push packets beyond the normal jitter") are slightly optimistic, although report §4.3(b)'s own numbers show the same small excess.
   - **Optional:** a lower `SERVER_MSGS_PER_S` would tighten it further. About 100/s is still well above the UI's ≤ 41/s worst case (menu 25 + inputs 10 + status 5 + ping 1).
2. **MINOR — a same-user process can deny new connections indefinitely by holding `MAX_PENDING` stalled handshakes.** Where: `control.py:486-496`.
   - **What I measured:** 0/40 legitimate connects succeeded during the attack. One stalled client, the R2 case, no longer blocks anything.
   - **Why only MINOR:** since R1, only the same user can open the pipe, and that user can read `control.json` and stop the sender anyway, so this crosses no privilege boundary. Existing connections, including the UI, and RC streaming are unaffected.
   - **Expected:** nothing more needed, or a sentence in README "Hardening".
3. **MINOR (pre-existing, outside WP13's R-list; recommended PM follow-up) — the RC sender's console takes keyboard focus and acts on single keystrokes.** Where: `ui/link.py` (`spawn_sender`, `CREATE_NEW_CONSOLE`) and `__main__.py:186-215`.
   - **What happens:**
     - When the UI spawns the sender, its console becomes the foreground window, as measured.
     - In that console, `q` quits and `i` idles: both end the RC stream (client failsafe) with no typed confirmation. The control channel needs a typed `STOP` for the same effect.
     - With `--sim`, `a` arms the fake switch. This is the most likely cause of the implementer's one smoke failure.
   - **Expected (follow-up WP):**
     - start the sender console minimised or without focus (`STARTUPINFO`/`SW_SHOWMINNOACTIVE`);
     - and/or require the same typed word for `q`/`i` while streaming, or ignore keys when the UI spawned the sender.
4. **MINOR — reliance on CPython internals.** Where: `control.py:244-269`, `:54-55`, `:296-297`.
   - **What the code relies on:**
     - `PipeListener._new_handle` and the `security_attributes` argument of `_winapi.CreateNamedPipe`;
     - also `deliver_challenge` / `answer_challenge`, which the report does not mention. They are undocumented, but they are the same functions the stdlib `Listener.accept` uses.
   - **The tests are an adequate guard:**
     - the DACL is read back and compared exactly;
     - the remote open is checked;
     - any handshake change would break every client test.
   - **Weak spots:**
     - `pyproject.toml:9` says `requires-python = ">=3.12"`, not a pin, contrary to report §5.5 ("The project pins 3.12");
     - the unit test only reads the DACL of the first pipe instance. My probe confirmed the later instances.
   - **Expected:** either pin `<3.13` or keep the test, and optionally read back one post-accept instance in the test. A runtime self-check of the DACL at start-up would make it fail-closed.
5. **MINOR — `_cmd_lock` is redundant.** Where: `control.py:396,:612`. Every request is already processed under `_work_lock`. It is harmless and makes `handle()` safe when it is called directly (tests), so it may stay. It is noted only for clarity.

## Approval rationale

- **Zero BLOCKER and zero MAJOR findings.** Every MUST requirement R1–R8 passes on my own evidence.
- **The pipe is user-only and local-only:** I read it back myself, on later instances too, and remote opens are refused while they were accepted on WP08b.
- **Stalled handshakes no longer block the listener:** 2 s deadline, one thread per connection.
- **The flood protection works:**
  - per-connection refusals at 50/s;
  - a server-wide 150/s budget;
  - 250 Hz kept where WP08b dropped to 134 Hz.
- **UI safety commands stay fast under a flood:** STOP, `request_mode idle` and `fpv` all stay at about 46 ms during a flood that saturates the cap, so the extra serialisation does not starve them.
- **The stop gate holds:**
  - 140 real-pipe races never let a start and a stop both succeed;
  - no RC packet left after an accepted stop;
  - pipelined and queued orderings are handled;
  - stop works in every state, and STOP is still required while streaming.
- **R5–R7 are correct.** The Revert label is verified end-to-end with a refused revert.
- **The runtime.py change is a correct, minimal fix:** `accepted_seq` is taken under the sender lock at the accept, and it only affects the diagnostic `start_timing` event.
- **No regression:** every WP08a/WP08b acceptance check gives the same result as before, the suite is green over 7 full runs, and the branch merges cleanly into current `main`.
- **Recommended follow-up:** finding 3 (sender console focus and single-key stop) is worth a separate small WP; it is pre-existing, not WP13 scope.
