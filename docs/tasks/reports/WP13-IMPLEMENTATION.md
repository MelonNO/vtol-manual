# WP13 — Implementation report (GCS app hardening)

Branch `wp/13` · follow-up to the WP08b verification findings 1–7 · Contracts C2/C2.1/C3 unchanged · Date 2026-10-17

## 1. Summary

WP13 closes the seven MINOR findings of `WP08b-VERIFY-round1.md`. The work is mostly in the control channel between the UI process and the RC sender process. Before changing anything, I reproduced every finding with the verifier's scripts and with my own probe (`S\wp13run\wp13_attack.py`).

- **R1 — pipe ACL:** the control pipe now has an explicit, protected DACL that grants the current user only (`D:P(A;;FA;;;<user SID>)`) and uses `PIPE_REJECT_REMOTE_CLIENTS`. Opening it over SMB (`\\127.0.0.1\pipe\...`) is refused with error 5. Before the change, that open was **accepted**.
- **R2 — handshake:** the accept thread only accepts connections. Each HMAC handshake runs in its own thread with a 2 s deadline. A stalled client no longer blocks a second client: before, the second client was BLOCKED; now it connects in 3–6 ms.
- **R3 — flood protection:**
  - **Per connection:** a token bucket (50 commands/s); the excess is refused with an error reply and a logged warning, never queued.
  - **Root cause found while measuring:** what delays RC packets is the GIL hand-over between *several busy connection threads*, not the commands themselves (about 10 µs each).
  - **So also:** the requests of all connections are processed one at a time, under a server budget of 150 messages/s.
  - **Result:** with the verifier's flood, the sender's packets stay within the normal jitter. Numbers are in §4.3.
- **R4 — stop is final:** the new `Sender.begin_stop` checks "streaming?" and closes the start gate in one locked step. After a stop is accepted, the control channel refuses every state-changing command. The verifier's sequence (stop, then RESUME) is refused, and a concurrent race test never lets both commands succeed.
- **R5 — Revert label:** it shows `reverting...` until the revert outcome is known, then `reverted` or `revert FAILED (<reason>)`, with Revert offered again.
- **R6 — GStreamer lookup:** cached (`GstLocator`). It is re-checked every 30 s, and at once when *Launch viewer* is pressed.
- **R7 — `video.py` docstring:** corrected. A new UI cannot stop or adopt an orphaned fan-out; the orphan is ended in Task Manager. The README says the same.
- **R8 — stability:** `pytest gcs` was run 9 times in full, plus one `gcs protocol` run.
  - On the final code, all 3 runs without windows pass (663 passed, 1 skipped), and so does `gcs protocol`.
  - Two failures over all runs: a pre-existing race in `start_timing`, which I fixed (§5.2), and one windowed smoke test failure that I could not reproduce (§6).
  - The verifier's attack, regression and ELRS-menu scripts give the expected results.

## 2. Requirement table

Line numbers refer to commit `3244ff5`.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `gcs/vtolgcs/control.py:148` `user_only_sddl`, `:237-273` `_make_listener` / `SecurePipeListener` (SECURITY_ATTRIBUTES on every `CreateNamedPipe`, `:267` `PIPE_REJECT_REMOTE_CLIENTS`); test `tests/test_control.py:364` | The DACL is read back with `GetSecurityInfo` and must equal exactly `D:P(A;;FA;;;<current user SID>)`. There is no SYSTEM entry; it is not needed. An SMB loopback open is refused. A stdlib probe pipe, opened the same way, *is* accepted, which proves the test is meaningful; if SMB is unavailable, the test skips that part. The control-file ACL is unchanged (it shares the same helper). |
| R2 | DONE | `control.py:70` `HANDSHAKE_TIMEOUT_S = 2.0`; `:290` `server_handshake` (deadline wrapper around the stdlib `deliver_challenge` / `answer_challenge`); `:471` `_accept_loop` (accept only); `:498` `_admit` (one thread per connection); `:68` `MAX_PENDING`; tests `test_control.py:383, :407` | A client that connects and never answers is closed after the timeout. A legitimate client connects meanwhile, in under 0.8 s in the test and 3–6 ms in the scripts. Ten stalled clients time out and free their slots. The client side is unchanged (stdlib `Client`). |
| R3 | DONE | `control.py:73` `RATE_LIMIT_PER_S = 50`, `:78` `SERVER_MSGS_PER_S = 150`; `:300` `RateLimit` (`perf_counter` clock); `:521` `_serve` (wait for input and send the reply outside `_work_lock`; `:535` server budget); `:553` `_process` (refuse with the request `id`, a warning at most 1/s, a pause of at least one token interval); tests `test_control.py:421, :433, :452, :512` | The excess is refused, not queued. The only queue is the pipe's fixed-size OS buffer, plus the existing bounded event queue (2000). The UI's own load (≤ 30/s) is never limited (tested at 30/s). **Re-measured:** §4.3. |
| R4 | DONE | `sender.py:379` `begin_stop`, `:86` `STOPPING_TEXT`, start gates at `:437` (request_mode), `:468` (prepare_resume), `:509` (confirm_resume), `:545` (carrier-only problems, used by prepare and confirm); `control.py:613` (refuse after a stop; only `request_mode idle` and a repeated `stop` pass), `:682` `_cmd_stop`; tests `test_sender.py:592, :599, :618`, `test_control.py:462, :483` | The verifier's reproduction (`attack2.py`: stop while idle, then an immediate RESUME) is refused: `prepare_resume` and `confirm_resume` both answer "a stop was accepted". A RESUME prepared before the stop is refused as well. Two threads race `begin_stop` against `confirm_resume` 200 times (sender) and 6 times over two real pipe connections: exactly one ever wins. |
| R5 | DONE | `crsf_menu.py:355` `begin_revert`, `:360` `revert_done`, `:367` sticky states; `ui/app.py:691` `revert_vtx`; tests `test_crsf_menu.py` `test_vrx_follow_revert_label_waits_for_the_outcome`, `test_ui.py` `test_revert_label_follows_the_revert_outcome` | The UI test calls the real `App.revert_vtx` with a fake app object, for a refused revert (`MenuError` "client may be armed") and a successful one. After a failure, Revert is offered again. |
| R6 | DONE | `video.py:145` `GST_RECHECK_S = 30.0`, `:148` `GstLocator`; `ui/app.py:117` (created once), `:436` (redraw uses the cache), `:462` (*Launch viewer*: `refresh=True`); test `test_video.py` `test_gst_locator_caches_the_lookup` | 299 redraws at 100 ms make one lookup. The next lookup comes at 30 s, and one on demand. |
| R7 | DONE | `video.py:9-13` docstring; README "Video helper" | The wording was fixed; the feature was not implemented. A new UI's *Start fan-out* reports `cannot listen on UDP 5600`, and the orphan is ended in Task Manager (`vtol-gcs-sender.exe` / `python` with `--video-fanout`). |
| R8 | DONE | §4 | `pytest gcs`: on the final code, 3 full runs pass, and `gcs protocol` passes. Two earlier failures are explained in §4.1, §5.2 and §6. Verifier scripts: attack ×2, attack2, regress, menu_e2e ×2, timing ×2; plus the flood measurements. `%APPDATA%\vtol-gcs` was never created. |

## 3. Placeholders

None. The new limits are app defaults, documented in the README with how they were derived:

- 50 commands/s per connection (the brief's example);
- 150 messages/s for the whole server;
- a 2 s handshake;
- a 30 s GStreamer re-check.

## 4. Tests

### 4.1 Commands and results

Python `S\venv\Scripts\python.exe`, run from the worktree root.

| Run | Command | Result |
|---|---|---|
| full ×3 (before the §5.2 fix) | `python -m pytest gcs` | 661 passed, **1 failed** (`test_runtime_e2e` `packets_sent` 4 < 5, a pre-existing race, §5.2); then 662 passed twice. 1 skipped each time (the opt-in windowed smoke test) |
| full ×3 (final code) | `python -m pytest gcs` | **663 passed, 1 skipped** (63 s), three times in a row |
| full, with windows | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs` | 663 passed, **1 failed**: the windowed smoke test, see §6 |
| windowed smoke alone ×5 | `VTOLGCS_UI_SMOKE=1 python -m pytest gcs/tests/test_ui.py::test_ui_smoke_with_spawned_sender` | 5/5 pass (and 5/5 on the unmodified WP08b code) |
| gcs + protocol | `python -m pytest gcs protocol` | 663 passed, 1 skipped |
| e2e race ×20 | `test_runtime_e2e.py::test_run_rtt_telemetry_camera_and_failsafe` | 20/20 pass after the fix (before it: 1/15 failed) |
| control/UI/menu/CLI ×7 | `tests/test_control.py tests/test_ui.py tests/test_crsf_menu.py tests/test_main_cli.py` | 58 passed, 1 skipped each time. Then 59 with the later test. In one early run, pytest reported one unhandled thread exception warning (no failure). It did not come back in 6 further runs with warnings shown, nor in any full run. |

**New tests (19):**

- `test_control.py`: the 10 listed under R1–R4, plus the rig accepts server options and gives each rig a unique control file.
- `test_sender.py`: 4, for R4 and the `accepted_seq` fix.
- `test_crsf_menu.py`, `test_ui.py`, `test_video.py`: 1 each, for R5 and R6.

### 4.2 Reproduction before and after (same scripts, same machine)

| Check | WP08b code | WP13 code |
|---|---|---|
| Pipe SDDL (`GetSecurityInfo`) | `D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<user>)(A;;FR;;;WD)(A;;FR;;;AN)` | `D:P(A;;FA;;;<user>)` |
| Open as a remote client `\\127.0.0.1\pipe\...` | ACCEPTED | REFUSED (error 5) |
| Raw client stalls in the handshake → second client | BLOCKED | connects in 3–6 ms |
| One connection flooding `status` for 2 s | 45,445 executed (22,722/s) | 150 executed (50 burst + 50/s), the rest refused |
| `stop` (idle), then `prepare_resume` + `confirm_resume` (`attack2.py`) | RESUME accepted, then streamed and exited | both refused, "a stop was accepted"; no resume start in the sender output |
| `attack.py` (normal / `armed`) | 40/43, 41/44 | 42/44, 43/45: the stall check now passes. The two remaining FAILs are the script's own flaws named in the WP08b verification (the icacls substring; a client-side `BrokenPipeError` on the oversize send). The server survives; the next checks pass. |

### 4.3 R3 re-measurement: RC timing under a token-holding flood

**(a) The verifier's `timing.py`** (independent UDP tap plus the sender's own per-second stats; the real UI process attached; 20 s phases):

| Phase | WP08b code: tap p99 / max · self late | WP13 code, run 1: tap p99 / max · self p99 med / max / late | WP13 code, run 2 |
|---|---|---|---|
| sender only | 0.69 / 1.70 ms · 1 late | 0.44 / 1.11 ms · 0.42 / 0.75 ms / 0 | 0.87 / 3.87 ms · 0.74 / 4.96 ms / 3 |
| real UI attached | 0.53 / 1.15 ms · 0 | 0.33 / 0.74 ms · 0.36 / 0.81 ms / 0 | 0.90 / 3.66 ms · 0.72 / 3.90 ms / 3 |
| UI + flood client (tight `inputs` / `status` / `rtt_samples` loop + event stream + extra SSE) | **1.48 / 7.34 ms · 7 late**, 3 gaps > 6 ms | **0.47 / 0.99 ms · 0.45 / 1.00 ms / 0 late**, 0 gaps > 6 ms | 1.02 / 2.95 ms · 0.95 / 3.00 ms / 3 late (= its own baseline) |

All phases ran at 250.0 Hz. Run 2 ran on a noisier machine (its sender-only phase already had 3 late packets). In both runs, the WP13 flood phase is within the same run's baseline jitter. The WP08b flood phase was 2–3 × worse at p99, with 7 late packets.

**(b) Harsher test (`S\wp13run\flood_timing.py`):** phases idle / 1 flooding connection / 8 flooding connections (the connection cap), 2 rounds × 30 s, independent tap. Packet deviation from the 4 ms period:

| Phase | WP08b code | WP13 code |
|---|---|---|
| idle | p99 0.48 ms, p99.9 0.81, max 1.7, gaps > 6 ms: 0 | p99 0.83, p99.9 1.54, max 3.1, gaps > 6 ms: 1 |
| flood, 1 connection | 6,400 cmds/s executed; p99 0.54, max 4.0, gaps > 6 ms: 2 | 52/s executed + 48/s refused; p99 0.41, p99.9 1.42, max 7.6, gaps > 6 ms: 4 |
| flood, 8 connections | 2,900 cmds/s; **only 5,908 packets in 57 s (≈ 104 Hz)**, p99 11.1 ms, gaps > 6 ms: 5,649 | 154/s (server budget); 14,251 packets (250 Hz), p99 0.68, p99.9 3.0, max 7.0, gaps > 6 ms: 7 |

On this busy desktop (a browser and other agents running), idle phases of other runs also showed maxima of 8–12 ms. So the max column is dominated by system noise; p99 and p99.9 are the useful comparison.

**Intermediate results** (in `S\wp13run\f_after*.log`):

- With the per-connection limit alone, 8 connections still gave p99 3.8 ms.
- Adding one-at-a-time processing brought it to p99 0.87 ms.
- Adding the 150/s server budget brought it to 0.68 ms.

## 5. Deviations / contract issues

1. **Files outside the brief's R-list, all inside `gcs/**`:**
   - `sender.py` gets `begin_stop` and the start gates (R4), plus `accepted_seq`;
   - `runtime.py` changes one line (§5.2).
   - No contract changed. The C2 API is untouched; `regress.py` still shows the exact C2 keys, CORS, and 405 for POST/PUT/DELETE.
2. **Pre-existing flaky test fixed:** `test_runtime_e2e::test_run_rtt_telemetry_camera_and_failsafe` sometimes saw `start_timing.packets_sent` = 4.
   - **Cause:** the runtime read `sender.state().seq` in the `mode` event callback, which runs after the sender lock is released. The RC thread can send one packet in between.
   - **Fix:** `Sender._accept` records `_accepted_seq` under the lock, and the runtime uses `accepted_seq()` (`sender.py:399, :415`, `runtime.py:278`).
   - This only affects a diagnostic event, not what is sent.
   - **Result:** 20/20 passes, against 1/15 failures before (0/15 on the unmodified copy in that sample, so the race is rare, but it is real).
3. **R3 goes beyond "per connection":** the measurement showed that a per-connection limit alone does not keep timing within the normal jitter with several connections. I therefore added:
   - one-at-a-time request processing (`_work_lock`);
   - a server-wide read budget (150/s, back-pressure through the pipe).

   **Trade-off:** while somebody floods, the UI's own commands wait their turn and may be slower, but they are not lost. Without a flood nothing changes; the burst covers normal use.
4. **`rtt_samples`:** I suspected large replies, but RTT samples arrive at the bridge status rate (about 10 Hz, about 300 per 30 s), and the measured cost per command is about 10–40 µs. I left it unchanged.
5. **Private stdlib use:** `SecurePipeListener` subclasses `multiprocessing.connection.PipeListener` and overrides `_new_handle`. Both are undocumented internals of CPython 3.12. The project pins 3.12, and the frozen build bundles its own stdlib. The test reads the DACL back, so a stdlib change would be caught.

## 6. Notes for the verifier

- **R1:**
  - `test_control.py::test_pipe_dacl_is_user_only_and_remote_clients_are_rejected`.
  - Or run `python S\wp13run\wp13_attack.py <worktree>\gcs <workdir>`: lines 1–2 print the SDDL and the result of the remote open.
  - `attack2.py` prints the SDDL too.
- **R2:**
  - `attack.py` check "stalled unauthenticated client does not block a legit client" now PASSes.
  - `wp13_attack.py` line 3 prints the connect time while a client stalls.
- **R3:**
  - `wp13_attack.py` line 4 shows one connection's flood.
  - The sender console prints `control channel: more than 50 commands/s on one connection; N refused so far` (at most once per second).
  - Timing: rerun `S\verify\WP08b\timing.py <worktree>\gcs <workdir>`, and `S\wp13run\flood_timing.py <gcs> <workdir> 30 2` for 1 and 8 flooding connections. Run them on a quiet machine: maxima depend on system noise.
- **R4:**
  - `attack2.py` now stops with a `KeyError` at `prepare_resume` after the stop. This is expected: the reply has no `result`, because it is a refusal.
  - `wp13_attack.py` line 5 prints both refusals, and "'resume start' in sender output: False".
- **R5:** in the ELRS tab, Revert after a failed lock with the arm switch ARMED: the label shows `revert FAILED (...)` and Revert stays enabled.
- **R6/R7:** `test_video.py::test_gst_locator_caches_the_lookup`; the `video.py` docstring.
- **Windowed smoke, one failure:** in one `VTOLGCS_UI_SMOKE=1` full-suite run, `test_ui_smoke_with_spawned_sender` failed with `camera_reported_on` false.
  - The bridge-sim log of that run shows `client: ARMED`. The camera interlock correctly refuses camera ON while the client may be armed.
  - The smoke sender's fake controller is SAFE, so armed RC frames must have come from another test's runtime reaching a recycled ephemeral port. I could not confirm this.
  - It did not reproduce in 5 isolated runs on WP13 code, nor in 5 on the unmodified WP08b copy. Please re-run it.
