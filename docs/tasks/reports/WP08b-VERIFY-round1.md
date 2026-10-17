# WP08b verification — round 1
VERDICT: APPROVED

Verifier: independent verification agent. Worktree `S\wt\WP08b`, branch `wp/08b` at `512f105`. Diff base `git merge-base main HEAD` = `5cf0ad3`.
The worktree was used read-only (`git status` is clean after all runs). Builds, merges and helper scripts ran under `S\verify\WP08b\`.
`%APPDATA%\vtol-gcs` was checked before and after every run and was never created.

## Scope (39 files changed)

All files are either in the brief's "Files you own" list or are justified in report §5.2:

- **New modules:** `ui/*`, `video.py`, `mp_output.py`, `crsf_menu.py`, `testtools.py`.
- **Packaging:** `packaging/*`, `scripts/firewall.ps1`.
- **Other:** `gcs/README.md`, `tests/*`, the report.
- `bridge_sim.py`: additive only. `ElrsModule`, `--module elrs` and `--no-vrx-follow` are new, and the defaults are unchanged (diff reviewed).

Files outside the list, each judged:

| File | Change | Judgement |
|---|---|---|
| `vtolgcs/control.py` (new, 597 lines) | the local control channel | Needed by R0. The brief requires a channel but names no module. **Accepted** |
| `runtime.py` | small hooks at the end of `Runtime`: `send_crsf`, `inputs`, `report_video`, `set_client_profile`, `log_record`, `rtt_samples`, `add_crsf_listener`, `now`; a `client_flight_mode` event; `video.rx_kbps`; `late_count` | The brief allows additive hooks if they are reported, and they are. Every hook validates its input. `send_crsf` keeps the guards in the sender. **Accepted** |
| `sender.py`, `alarms.py`, `config.py` | R8b m1/m2/m4; new config sections | Allowed by R8b. **Accepted** |
| `controller.py` | `PygameController.raw` (3 lines) | Additive, for the wizard. **Accepted** |
| `__main__.py` | UI dispatch, `--video-fanout`, control flags, hidden `--ui-smoke-out`, migration notices | Needed for R0. The UI path never builds a `Runtime`, which a test checks. **Accepted** |
| `pyproject.toml` | `vtolgcs.ui` package, `packaging` extra | Needed. **Accepted** |
| `tests/test_main_cli.py` | The old `test_without_headless_is_a_usage_error` is replaced by `test_without_headless_starts_the_ui_process`. Two new tests: control file served/removed, and config migration. Plus the PM add-on | The old behaviour was the WP08a placeholder. The replacement asserts that no `Runtime` is ever built in the UI process. **Accepted** |
| `__init__.py` | docstring | **Accepted** |

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R0 process separation | PASS | `__main__.py:369-371` (no `--headless` → UI, never a `Runtime`), `:415-423` (the sender serves the channel); `ui/link.py:89-96` (`spawn_sender`, `CREATE_NEW_CONSOLE`); `video.py:291` (fan-out in its own process) | Measured with real processes (see Smoke tests §3). **Transport:** AF_PIPE `\\.\pipe\vtol-gcs-ctl-<64-bit random>` with an HMAC-SHA256 challenge on a 32-byte token (`control.py:233,246,249`). **Pipe properties:** first-instance flag set; no HTTP, so not reachable from browsers. **Token file:** ACL checked by me with `icacls`: exactly one entry, `<user>:(F)`, protected DACL (`control.py:113`); the file is deleted on a clean exit. **Typed words:** checked in the sender (`control.py:418-454`). My own pipe client could not bypass any guard. **UI kill:** the sender keeps streaming. **Sender kill:** the UI goes to `down` and shows **RC SENDER DOWN** in red (`ui/view.py:46-48`, `ui/app.py:919-923`). Documented in README "Control channel". Pipe-hardening remarks: findings 1 and 2 (MINOR) |
| R1 UI | PASS | `ui/app.py:229-242` (topmost status bar with CAM toggle), `ui/view.py:44-72` (§7.5 fields, req vs rep camera), `:245-280` (mode buttons with confirmation, alarm list, Mute, log folder), `:282-320` (channel monitor), `:993-1091` (wizard → validated `save_channel_map`), `ui/hotkey.py` (F9 `RegisterHotKey`, Tk fallback), `ui/profiles.py` (C1 `clients`/`packs`, `videoStandard`) | The Tk thread only consumes a queue, and the network runs in worker threads. The sender runs in another process. UI smoke run (real windows): camera toggled → `camera_reported_on: true`; bridge RUN |
| R2 video helper | PASS | `video.py:164-264` (fan-out with kbps/pps/gap stats), `:60-71` (pipelines), `:80-90` (SDP 5601), `:93-100` (bridge > profile > ask), `:119-145` (`find_gst`, configurable path, launch), `GST_INSTALL_HELP`; `ui/app.py:417-471` | I compared the 4 pipelines and the SDP **byte-for-byte** against `data/content.js` in Node: all identical, and still identical on current `main`. No `rtpjitterbuffer` |
| R3 MP output | PASS | `mp_output.py:46-47` (CRC_EXTRA), `:79-86` (encoder refuses 1/255 and anything outside 2..254), `:157-206` (`SendOnlyUdp`: loopback only, `discard_inbound`, no API returns data), `:221-228` (object guard); `config.py:470-478,506-515` (config guard, loopback host) | **Independent check against common.xml/standard.xml/minimal.xml fetched from mavlink/master:** CRC_EXTRA recomputed by my own script = 50/124/39/104/184/83 (all match). One full frame per message (HEARTBEAT, SYS_STATUS, ATTITUDE, GLOBAL_POSITION_INT, ADSB_VEHICLE, STATUSTEXT), built by my own XML-driven encoder: byte-identical. **Sysid 1/255/0/256/bool/str refused** at the encoder, at `MpOutput`, and in config validation. **Destinations** `192.168.144.12` and `0.0.0.0` refused. **Live check:** 10 inbound packets from an "MP" socket → `inbound_ignored = 10`, nothing forwarded. The UI process has no bridge socket; its only path to the bridge is `crsf_send`, which the MP output never feeds |
| R4 ADSB (SHOULD) | PASS | `mp_output.py:133-148`, `frames_for` adsb branch | ADSB_VEHICLE frame verified byte-exact against my reference |
| R5 CRSF menu | PASS | `crsf_menu.py:109-275`, `:34` NOT_SUPPORTED, `:293-330` VtxAdmin; `runtime.py:614-653` | **End-to-end with real processes (my script):** without `--crsf-pass` → "Not supported by bridge firmware (Q7a)" after about 2 s. With `--module elrs` → full tree of 15 fields, hidden entry skipped, VTX folder found, writes and Send VTx work. **Writes refused while the client may be armed:** checked by me after a RESUME with the switch ARMED: write refused, read allowed. **crsf_pass guard:** RC_CHANNELS (0x16), other extended types (0x32) and a wrong origin are all refused |
| R6 VRX follow (SHOULD) | PASS | `crsf_menu.py:335-375`; `ui/app.py:666-695` | With status bits trusted (`video.status_bits_min_fw_ver=0`, sim `--no-vrx-follow`): VTX change → `no_lock` after 3 s, `offer_revert` → revert → lock back. With the default TBD config: "decoder lock not reported: check the picture" (correct) |
| R7 test tools | PASS | `testtools.py` (`RttTest`, `FailsafeTimer`, `CameraTest`, `InterfaceCounter`, `Results.export_csv`, `g2g_text`); `ui/app.py:697-797`; session log via `log` (`test_*` only, `runtime.py:655`) | Logic tests in `test_testtools.py` exercise real behaviour. The `log` command refuses non-`test_*` types and a `type` override (tried) |
| R8 packaging | PASS | `packaging/vtol-gcs.spec`, `build.ps1`, `entry_*.py`, `scripts/firewall.ps1`; README "User guide" | **`build.ps1`:** ran with PyInstaller 6.22.3 in a throw-away clone → `gcs\dist\vtol-gcs\{vtol-gcs.exe, vtol-gcs-sender.exe}`. The **frozen** UI spawned the frozen sender: bridge RUN, camera reported ON, STOP → `control_stop`. **`firewall.ps1` (reviewed):** `#Requires -RunAsAdministrator`, Private profile only, inbound UDP only, scoped to the sender program **and** 192.168.144.0/24 (a plan §3.3 source), group-based, idempotent, `-Uninstall` removes the group. `gcs/dist` and `gcs/build` are git-ignored. **User guide covers:** install, first run, EdgeTX GCS-RELAY (RF off, Classic joystick), MP mirror (write off) + second link + HUD 5602, GStreamer, firewall, troubleshooting |
| R8b m1 | PASS | `sender.py:146-153` (wording), `:513-518` (refusal at preview and at confirm through `_confirm_co_locked` → `_carrier_only_problems_locked`) | Through my pipe client with `--sim-armed`: preview text "UNKNOWN since app start (…)"; carrier-only refused with "the connected radio's arm switch is ARMED (CH5 = 2012 us)" |
| R8b m2 | PASS | `alarms.py:204-206`, `sender.py:283-293`, `config.py:137`, `:725-728` (stall > 2 periods skips slots → alarm at once); README "Alarms"/"Timing" | Sensible: a single 2–8 ms stall gives 1–2 late packets (no alarm); 3 per second or any skip raises it. Documented as an app default |
| R8b m4 | PASS | `config.py:520-541` `RENAMED_KEYS`, `migrate`, `load_config:588-607` (backup, rewrite, notices, error names the migration); `__main__.py:374-379` | Tests for the migrate path, the new-wins case and the invalid old value, plus a process test with `CONFIG MIGRATED` on stderr |
| PM add-on: robust CLI test | PASS | `test_main_cli.py:81-98` | Polling with a 15 s monotonic deadline and full diagnostics on timeout. Ran the CLI/control/UI tests 3 extra times: all pass |
| R9 tests | PASS | `test_mp_output.py`, `test_crsf_menu.py`, `test_video.py`, `test_ui.py`, `test_control.py`, `test_testtools.py`, `test_packaging.py` + additions | **Coverage of the new logic is real:** CRC_EXTRA computed in-test from field definitions; a real `Runtime` against `bridge_sim` for every guard path; fan-out on localhost; a UI import in a subprocess with no Tk root |

## Contract results

- **C2/C2.1:** live `/api/v1/status` from the wp/08b sender. Top-level and second-level keys match C2 exactly. `app.start_path` is `normal` / `resume` as C2.1 says. `alarms[]` keeps the 4 keys.
  - CORS reflects `https://melonno.github.io`, not `https://evil.example`.
  - `OPTIONS` → 204, `GET`, PNA `true`. `Cache-Control: no-store`.
  - POST/PUT/DELETE → 405 (still read-only).
  - `video.rx_kbps` is now filled from the fan-out report (it expires after 3 s).
- **C3:** fan-out 5600 → 127.0.0.1:5601/5602. `crsf_pass` uses `protocol.CrsfPass` (`runtime.py:647`). `protocol.py` and `crsf.py` are unchanged.
- **C1 (consumer):** `ui/profiles.py` reads `clients[]`, `packs[]` (cells) and `videoStandard` as C1.2 defines them.

## Tests run (commands + results)

`S\venv\Scripts\python.exe -m pytest gcs`, run from the worktree unless noted:

| Run | Where | Result |
|---|---|---|
| 1 | worktree | 647 passed, 1 skipped (56 s) |
| 2 | worktree, `VTOLGCS_UI_SMOKE=1` (display available) | **648 passed** (67 s); the windowed smoke test passes |
| 3 | throw-away merge of `wp/08b` into current `main` (`006001d`), `pytest gcs protocol` | 647 passed, 1 skipped |
| 4 | worktree | 647 passed, 1 skipped; then `test_main_cli.py test_control.py test_ui.py` ×3: 41 passed, 1 skipped each time |

On the merged tree, `node --test test/` gives 194 passed.

**Merge:** `wp/08b` merges into current `main` with no conflicts. `main` gained WP11 and PM edits since the base. They touch only `data/content.js` text outside the pipelines, plus contract C1.5. The pipelines are unchanged.

## Smoke tests (what I ran + result)

Scripts under `S\verify\WP08b\`: `attack.py`, `attack2.py`, `timing.py`, `mav_check.py`, `menu_e2e.py`, `regress.py`.

1. **Control-channel attack** (`bridge_sim` and the headless sender as separate processes; my own `multiprocessing.connection` and raw `CreateFileW` clients).
   - **Refused at authentication:** wrong token, empty token, token minus one char, and a client without authkey (it only ever receives the challenge).
   - **Refused or rejected through the channel:**
     - `request_mode carrier_only`;
     - `confirm_*` without a preview, with a superseded token, with a replayed token, with `bool` or `list` typed values, and with lower-case words;
     - carrier-only without LANDED after FPV;
     - `stop` without or with lower-case `STOP` while streaming;
     - private methods (`_refused`);
     - forged `log` records, and non-bool camera values.
   - **Accepted:** RESUME with `" RESUME "` (stripped, as on the console) → `start_path: resume`. A replay of it is refused.
   - **Camera ON while ARMED:** refused (camera interlock).
   - **Robustness:**
     - Oversize (> 64 KiB) and garbage messages: the connection is closed or gets an error reply; new clients still work.
     - A 9th concurrent connection is refused and recovers after the others close.
   - **UI kill:** a subscribed "UI" process killed with `taskkill /F` → the sender stays RUN/streaming and a new client attaches. 40/43 and 41/44 checks passed. The three "fails" were my own script's flawed assertions (an icacls substring that matched the path; the client-side oversize error), plus the handshake stall in finding 2.
2. **Pipe DACL** (via `GetSecurityInfo`): `O:<user> D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<user>)(A;;FR;;;WD)(A;;FR;;;AN)`. This is the default pipe DACL: only SYSTEM, Administrators and the user can write (so only they can complete a handshake); Everyone/Anonymous have read access. See findings 1–2.
3. **Timing with the real UI process attached** (`timing.py`). An independent UDP tap between sender and sim timestamps every `rc_up`; the sender's own `sender` records are compared. Second, clean run (a stray sim from the first run was removed):

| Phase (20 s each) | Tap: rate / deviation p99 / max | Sender self: p99 median / max / late / skipped |
|---|---|---|
| sender only | 250.0 Hz / 0.36 ms / 0.62 ms | 0.36 ms / (start-up window) / 2 / 0 |
| **real UI attached** (SSE, ping, MP output) | 250.0 Hz / 0.38 ms / 1.21 ms | **0.39 ms / 1.31 ms / 0 / 0** |
| UI + flood client (tight loop `inputs`/`status`/`rtt_samples` + extra SSE) | 250.0 Hz / 0.59 ms / 3.33 ms | 0.61 ms / 3.51 ms / 1 / 0 |

   The first, noisier run showed the same pattern: the UI phase was no worse than the baseline, and the flood had a worst packet of 10.7 ms. **The UI process does not degrade RC timing.** An authenticated flood can (finding 3).
   - **UI kill:** after `taskkill /F /T` of the UI, the bridge stays RUN with 750 `rc_up` per 3 s.
   - **Sender kill:** after `taskkill /F` of the sender, the second UI's `link_states` go `up → down` and end `down` ("RC SENDER DOWN"). Its camera toggle round-tripped first (`camera_reported_on: true`).
4. **WP08a regression** (`regress.py`): C2 keys, CORS, read-only methods and health are OK. `taskkill /F` of the sender → sim RUN → FAILSAFE at T_hold ("No valid rc_up for 252 ms").
5. **MAVLink** (`mav_check.py`): see R3. **ELRS menu** (`menu_e2e.py`): see R5 and R6. **Frozen build:** see R8.

## Findings

1. **MINOR — the pipe has the default DACL and accepts remote clients.** Where: `control.py:246-249`, through `multiprocessing.connection.PipeListener`.
   - **What is wrong:** the pipe is created with the default security descriptor (Everyone and Anonymous: read) and without `PIPE_REJECT_REMOTE_CLIENTS`. On a Private network with file sharing on, authenticated SMB clients could open it.
   - **Why only MINOR:** no command is possible without the token, and the token file *is* user-only, which is what R0 requires.
   - **Expected (hardening):** an explicit user-only DACL on the pipe and `PIPE_REJECT_REMOTE_CLIENTS`, for example with a small custom listener. Or document why the default is acceptable.
2. **MINOR — one stalled handshake blocks every new connection.** Where: `control.py:307-325`.
   - **What is wrong:** the HMAC handshake runs inside `Listener.accept()` on the single accept thread, with no timeout. Any principal that can open the pipe, even read-only, can stall it. I reproduced this: while it is stalled, no new client (UI re-attach, fan-out reporter) can connect, and a restarted UI would show "RC SENDER DOWN" for a sender that is streaming. It recovered as soon as the stalled handle closed. RC streaming and existing connections are not affected.
   - **Expected:** run the handshake per connection, in its own thread with a timeout.
3. **MINOR — the control channel has no rate limit.** Where: `control.py:327-346`.
   - **What is wrong:** an authenticated client in a tight request loop delayed RC packets by up to 3.5 ms in the clean run and 10.7 ms in a noisier one. The legitimate UI load has no measurable effect.
   - **Expected:** a simple per-connection request-rate cap, or at least a note in README "Timing limits".
4. **MINOR — commands still run after a stop is accepted.** Where: `control.py:446-454` with `__main__.py:447-455`.
   - **What is wrong:** after `stop` is accepted (no word needed while idle), the server keeps executing commands until the 50 ms main loop notices. I reproduced it: `stop` while idle, then an immediate RESUME, was accepted. The sender then streamed briefly and exited, so the client failsafe follows without the `STOP` confirmation. It is practically unreachable from one UI because of the modal typed dialogs, but reachable with two clients.
   - **Expected:** once `stop` is accepted, refuse every later state-changing command.
5. **MINOR — the Revert label can be wrong.** Where: `ui/app.py:690-695`. `revert_vtx` sets `follow.state = "reverted"` before the writes finish. If the revert is refused (for example, the client may be armed), the label still says "- reverted" and only an error box shows the failure. **Expected:** set the state from the result.
6. **MINOR — GStreamer lookup in the redraw loop.** Where: `ui/app.py:435`. `_render_video` calls `find_gst()` (a PATH scan and file checks) on every 100 ms UI poll. It only costs CPU in the UI process. **Expected:** cache it, and refresh on demand.
7. **MINOR — the fan-out docstring overstates what a new UI can do.** Where: `video.py:9-10`. It says an orphaned fan-out (UI died) can be stopped "from a new UI", but a new UI has no handle on it. Its *Start fan-out* only reports "cannot listen on UDP 5600", and the README troubleshooting covers that. **Expected:** fix the wording, or let a new UI find and stop or adopt the helper.

## Approval rationale

- There are zero BLOCKER and zero MAJOR findings, and every MUST requirement (R0, R1, R2, R3, R5, R7, R8, R8b m1/m2/m4, R9) passes. The SHOULD items R4 and R6 are also implemented and pass.
- **Flight-safety:** I checked the sender-side guards myself with an independent pipe client. Nothing in the channel lets a client, authenticated or not, start a stream, enter carrier-only, resume, stop a running stream, or send RC or other CRSF frames past the sender's interlocks.
- **MAVLink output:** the encoding is independently verified against common.xml. Sysid 1 and 255 are refused at all three layers, destinations are loopback only, and inbound packets are dropped.
- **Timing:** sender timing with the real UI attached matches the sender alone.
- The suite is stable over 4 full runs plus 3 targeted repeats, the frozen build works, and the branch merges cleanly into current `main`.
- The seven MINOR findings above are recommended hardening and clean-up for a later round. Findings 1, 2 and 4 matter most.
