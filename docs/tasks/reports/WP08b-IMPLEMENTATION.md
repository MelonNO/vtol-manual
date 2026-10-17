# WP08b — Implementation report

Branch `wp/08b` · Contracts C2/C2.1 (owner, unchanged keys), C3 (consumer) · Date 2026-10-17

## 1. Summary

WP08b makes the GCS companion app usable in the field and keeps the RC sender's timing clean.

- **Process separation (R0).** The RC sender (`python -m vtolgcs --headless`, built as `vtol-gcs-sender.exe`) runs alone in its own process. The UI (`python -m vtolgcs`, `vtol-gcs.exe`) runs in a second process. The video fan-out runs in a third.
  - The UI reads state from the C2 API (SSE).
  - It sends commands through a new **local control channel**: a Windows named pipe with an HMAC token, plus a control file that only the current user can read.
  - Every guard stays in the sender. The UI forwards the typed RESUME / THROTTLE / NOCLIENT / LANDED / STOP words verbatim.
- **Tk UI (R1):** an always-on-top status bar and seven tabs (Flight, Controller, Client, Video, Mission Planner, ELRS, Tests). It includes the alarm sound with mute, a global F9 camera hotkey and a mapping/calibration wizard.
- **Features:**
  - video fan-out and PAL/NTSC pipelines (R2);
  - MAVLink client output with a sysid guard and inbound packets ignored (R3/R4);
  - ELRS menu over `crsf_pass`, with VTX Admin and VRX follow (R5/R6);
  - test tools (R7);
  - PyInstaller packaging and a firewall script (R8).
- **WP08a carry-overs (R8b):** m1, m2 and m4, plus the PM's CLI-test robustness fix.
- **Measured with the UI attached** (separate process, 21 one-second windows): 250 Hz, jitter p99 0.46 ms median and 0.62 ms worst, worst packet 0.83 ms, **0 late packets and 0 skipped slots**.

**647 tests pass, 1 skipped** (the opt-in windowed smoke test, which also passes when enabled).

## 2. Requirement table

Line numbers refer to the commit that holds this report.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R0 | DONE | `control.py:221` `ControlServer`, `:504` `ControlClient`, `:554` `EventStream`, `:75` `_restrict_to_user`, `:123` `write_private_file`; `__main__.py:419` (the sender serves it), `:370` (no `--headless` → UI process); `ui/link.py:117` `RuntimeLink`, `:89` `spawn_sender` (own console window) | See §5.1. **Transport:** named pipe `\\.\pipe\vtol-gcs-ctl-<random>`, using `multiprocessing.connection` with an HMAC challenge on a 32-byte random token that is new for every session. It is not reachable from browsers: no HTTP, no CORS. **Control file:** `control.json` next to the config (`%APPDATA%\vtol-gcs\`). Its ACL is `D:P(A;;FA;;;<user SID>)`, checked with `icacls` in a test, and the file is deleted on exit. **Commands:** mode requests, both preview/confirm flows with the typed words checked **in the sender** (`control.py:418`, `:430`), camera, stop (typed `STOP` while streaming, `:446`), plus `inputs`, `rtt_samples`, `crsf_send`, `video_report`, `set_client_profile`, `log`. **Liveness:** the UI shows `RC SENDER DOWN` (red) when the sender is gone (`ui/link.py:184`, `:208`, `:230`). The sender keeps streaming when a UI process is killed (test). The protocol is documented in README "Control channel". Guard paths are tested through the channel (`test_control.py`, 18 tests) |
| R1 | DONE | `ui/app.py:99` `App` (tabs), `:229` status bar (topmost), `:62` `TypedDialog`, `:993` `MappingWizard`, `:53` sound; `ui/view.py` (status-bar fields per plan §7.5), `ui/profiles.py` (Tools export, C1), `ui/mapping.py` (wizard logic, validated save), `ui/hotkey.py` (`RegisterHotKey`, F9) | **Status bar:** mode, bridge state (colour), RTT, loss, jitter, LQ/RSSI, battery, video standard/lock, timing offset, **camera requested vs reported**, alarms. **Profile selector:** file picker, remembered in `ui.profiles_file` + `client.profile_id`; it also sends `set_client_profile` (C2 `client.profile_id`, battery-alarm cells). **Other parts:** channel monitor (10 Hz `inputs`); wizard (calibrate, detect by moving the control, save validated config); camera toggle with F9 (system-wide, Tk binding as fallback); mode buttons with confirmation; alarm list with `winsound` (crit repeats every 5 s) and Mute; *Open log folder*. The Tk thread never waits on the network (worker threads plus a queue) and runs in another process from the sender |
| R2 | DONE | `video.py:164` `UdpFanout`, `:291` `fanout_main` (helper process), `:328` `FanoutProcess`, `:60`/`:67` pipelines, `:80` SDP, `:93` `choose_standard`, `:119` `find_gst`, `:141` `launch_viewer`, `GST_INSTALL_HELP` | Fan-out 5600 → 127.0.0.1:5601/5602 with stats (kbps, packets/s, largest gap), reported to C2 `video.rx_kbps`. The pipelines are byte-identical to `data/content.js` (tested). Standard choice: bridge flag → profile → ask. `client-video.sdp` on port 5601. GStreamer is found via PATH, the installer's environment variable or the usual folders, with install help when it is missing. `d3d11h264dec` is an option (VERIFY latency) |
| R3 | DONE | `mp_output.py:79` `encode_frame` (refuses sysid 1/255), `:46` CRC_EXTRA, `:157` `SendOnlyUdp` (loopback only, `discard_inbound` `:194`), `:221` `MpOutput`, `:251` `frames_for`; `config.py:506` `mp_sysid_problems` | HEARTBEAT (quadrotor, generic autopilot), GLOBAL_POSITION_INT, ATTITUDE, SYS_STATUS (voltage) and STATUSTEXT on mode change. Default sysid **2**, port 14560. CRC_EXTRA 50/124/39/104/184/83 from common.xml; **the test recomputes each one from the message definition** and compares whole frames with an independent reference encoder. Inbound datagrams are read and dropped unparsed (test: MP sends 10 packets → counted, nothing arrives elsewhere). The sysid guard sits in three places: config, `MpOutput`, and the encoder itself |
| R4 | DONE | `mp_output.py` `adsb_payload`, `mode = "adsb"` | `ADSB_VEHICLE` (emitter UAV, callsign `FPV<sysid>`) plus a HEARTBEAT of type ADS-B / autopilot invalid. How Mission Planner shows it: **VERIFY on the laptop** (§5.4) |
| R5 | DONE | `crsf_menu.py:109` `CrsfMenu` (ping, chunked reads with per-chunk retries, write + re-read, commands incl. ASK_CONFIRM), `:53` `MenuTree`, `:293` `VtxAdmin`, `:382` `control_send`; `runtime.py:614` `send_crsf`; `bridge_sim.py:559` `ElrsModule` | Transport: `crsf_send` → `crsf_pass` (C3). Only ping/read/write frames from 0xEA to 0xEE pass, and only while streaming. **Writes are refused while the client may be armed** (app default, §5.3). Rate limit 50/s; the menu paces itself to 25/s. If the bridge does not answer: **"Not supported by bridge firmware (Q7a)"**. Tested against the extended simulator tree: nested folders, a 4-chunk entry, a hidden entry, commands, VTX folder |
| R6 | DONE | `crsf_menu.py:335` `VrxFollow`; `ui/app.py` VTX panel and *Revert*; `bridge_sim.py:765` `_vrx_follow` (`--no-vrx-follow`) | After *Apply + Send VTx* the UI shows "VRX follow: via backpack (automatic if fitted) / via N6 (firmware TBD)". With decoder-lock reporting it waits for the lock and offers a revert after `crsf_menu.vrx_lock_timeout_s` (10 s, app default). The e2e test: lock lost → `no_lock` → revert → lock back |
| R7 | DONE | `testtools.py:90` `RttTest`, `:133` `FailsafeTimer`, `:264` `CameraTest`, `:193` `InterfaceCounter`, `:43` `Results` (CSV), `:375` `g2g_text`; UI Tests tab | **RTT:** min/mean/p99/max with the video note and the mean video rate. **Failsafe timer:** stop the stream (or mark another cause), then time until `!FS!` in telemetry or the F8 stop key; it also records the bridge FAILSAFE time, all on the sender clock. **Camera test:** RTT and video packets per phase, reported ON/OFF times, and the time until camera traffic stops, measured with the network-interface byte counters. **Glass-to-glass:** a 96-pt millisecond clock. Every result goes to the session log (`test_*` via the control channel) and to CSV |
| R8 | DONE | `packaging/vtol-gcs.spec`, `packaging/entry_ui.py`, `packaging/entry_sender.py`, `packaging/build.ps1`, `scripts/firewall.ps1`; README "User guide" | **Build:** one folder `gcs/dist/vtol-gcs/` with two programs: windowed UI and console sender. **Built and run on this laptop:** see §4. **`firewall.ps1`:** two inbound UDP rules (status/CRSF, video 5600), Private profile only, remote 192.168.144.0/24, idempotent, `-Uninstall`. **User guide covers:** install, first run, EdgeTX GCS-RELAY, MP mirror (write off) + second link + HUD, GStreamer, firewall, troubleshooting |
| R8b m1 | DONE | `sender.py:150` (wording), `:516` (refusal) | **Wording:** the carrier-only preview says client telemetry is "UNKNOWN since app start (nothing heard; the bridge forwards client telemetry only while this app streams)". It no longer says "never". **Refusal:** carrier-only is refused while a connected, fresh, mapped radio arm switch is ARMED, at the preview **and** at the confirmation. Tests in `test_sender.py` and `test_control.py`. The WP08a bypass test was updated: it now also needs the switch to be SAFE |
| R8b m4 | DONE | `config.py:526` `migrate`, `load_config` (backup `config.pre-migration.json`, rewrite, notices); `__main__.py:379` | `alarms.jitter_p99_max_ms` → `send_late_max_ms`, with a `CONFIG MIGRATED` notice (stderr + log). If both keys are present, the new one wins. An invalid old value produces an error that names the migration, and the file is not rewritten. Tests: `test_config.py` (3), `test_main_cli.py` (process) |
| R8b m2 | DONE | `sender.py:180`, `:263` (`late_count` per window), `alarms.py:206`, `config.py:137` `send_late_count` | `SEND JITTER HIGH` = at least `send_late_count` (3, app default) packets > 2 ms late in a 1 s window, **or any skipped slot**. Every stall longer than two periods skips slots, so real stalls still raise at once. A single 2–8 ms packet (latency only) no longer does. `late_count` is in the session-log `sender` record. Documented in README "Alarms" and "Timing" |
| PM: CLI test | DONE | `tests/test_main_cli.py` `test_headless_sim_streams_then_failsafe_on_exit` | The fixed 5 s wait is replaced by polling with a 15 s deadline. On timeout the test prints diagnostics: sim state, transitions, rx_ok, age of the last valid `rc_up`, sim thread alive, app stdout/stderr tails |
| R9 | DONE | `test_mp_output.py` (21), `test_crsf_menu.py` (7), `test_video.py` (12), `test_ui.py` (8 + 1 opt-in), `test_control.py` (18), `test_testtools.py` (9), `test_packaging.py` (6), additions in `test_config.py`, `test_alarms.py`, `test_sender.py`, `test_main_cli.py` | Covers: MAVLink encoding, CRSF menu vs simulator, PAL/NTSC pipeline strings, fan-out on localhost, UI importable headless (subprocess, no Tk root), and the sysid guard |

## 3. Placeholders (TBD / VERIFY)

| Where | What | Why |
|---|---|---|
| README "Mission Planner", `mp_output` ADS-B mode | VERIFY on the laptop: MP's UDP connection naming, and how MP shows an ADS-B-only link | Not testable without Mission Planner; MP 1.3.x names are used, as in WP08a |
| `video.decoder = d3d11h264dec` pipelines | VERIFY latency and pipeline on the laptop | Plan §7.4 says "compare latency" |
| Camera test "traffic stop" criterion | App default: back below baseline + 25 % of the camera increment, 20 ms samples, 100 ms window | Measured at the GCS, so it includes HM30 buffering; it cannot reach the relay design's "within one RC packet" (that is a P1 measurement) |
| `crsf_menu.vrx_lock_timeout_s = 10`, `timeout_ms = 500`, `retries = 3`, `send_late_count = 3`, `CRSF_PASS_MAX_PER_S = 50`, `MIN_INTERVAL_S = 0.04`, MP output freshness 3 s (`FRESH_S`), C2 `video.rx_kbps` freshness 3 s | App defaults, documented as such | No source value exists |
| VTX Admin field names ("VTX Administrator", "Band", "Channel", "Pwr Lvl", "Pitmode", "Send VTx") | Matched by part of the name | Names as in the ELRS TX Lua menu; check against a real module when Q7a exists |
| Inherited TBDs | `alarms.rtt_max_ms`, `rtt_rise_ms`, `video.status_bits_min_fw_ver`, bridge IP (Q3) | Unchanged from WP08a |

## 4. Tests

Command, from the worktree root:

```
C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\venv\Scripts\python.exe -m pytest gcs
```

Result: **`647 passed, 1 skipped in ~56 s`** (Windows 11, Python 3.12.10). The skipped test is `test_ui_smoke_with_spawned_sender`. It opens windows, so it is opt-in: `VTOLGCS_UI_SMOKE=1` → passed.

Additional manual checks:

- **Windowed smoke runs** (`python -m vtolgcs --sim ... --run-seconds N --ui-smoke-out F`, hidden test flags):
  - the UI spawned the sender in its own console, and the bridge reached RUN;
  - the camera toggle went from requested to **reported ON**;
  - the stop over the control channel → bridge FAILSAFE after 252 ms.
- **Every UI action driven programmatically** (dialogs auto-answered; driver script in the scratchpad, not in the repo): FPV, idle, camera, ELRS menu load (7 top-level rows), fan-out, viewer (GStreamer missing → help shown), SDP, failsafe timer, RTT test (20 samples, mean 3.49 ms), MP sysid 255 refused, RESUME / carrier-only refusals shown. **0 Tk callback errors.**
- **`build.ps1` with the venv Python:** PyInstaller 6 build succeeded. The **frozen** `vtol-gcs.exe` spawned `vtol-gcs-sender.exe`, reached RUN, the camera round trip worked, and the stop led to FAILSAFE.
- **Timing with the UI attached:** see §1.
- **`%APPDATA%\vtol-gcs` was never created.** All runs used temporary configs; the control file follows the config folder.

New test files: `test_control.py`, `test_mp_output.py`, `test_video.py`, `test_crsf_menu.py`, `test_testtools.py`, `test_ui.py`, `test_packaging.py`.

## 5. Deviations / contract issues

### 5.1 Process model (R0)

| Process | Runs |
|---|---|
| Sender | WP08a runtime plus `ControlServer` |
| UI | Tk, `RuntimeLink`, Mission Planner output, ELRS menu, test tools |
| Fan-out | its own process; it keeps forwarding video if the UI dies |

- **Built version:** two programs, so the sender has a console (status line, keys, interactive dialogs) and the UI has none.
- **When the UI dies, the sender keeps streaming.** A new UI attaches through the control file.
- **The control channel adds no route around a guard:**
  - `carrier_only` is still refused as a plain mode request;
  - typed words are compared in the sender, and a mismatch is logged as `interlock_refused` with `"via": "control"`;
  - every `confirm_*` call goes through the same sender methods as the console.

### 5.2 Files outside the brief's list (all small and additive)

| File | Change | Why |
|---|---|---|
| `vtolgcs/control.py` | new | Needed by R0. It is the only new module that is not in the brief's list |
| `runtime.py` | the hooks at the end of `Runtime` (`send_crsf`, `inputs`, `report_video`, `set_client_profile`, `log_record`, `rtt_samples`, `add_crsf_listener`); `client_flight_mode` event; C2 `video.rx_kbps` filled; `late_count` in the `sender` record | As allowed by the brief |
| `sender.py`, `alarms.py`, `config.py` | R8b changes; WP08b config sections `video.*`, `mp_output`, `crsf_menu`, `ui` | As allowed by the brief |
| `controller.py` | `PygameController.raw` (raw axes/buttons for the wizard) | Additive |
| `__main__.py` | UI dispatch, `--video-fanout`, `--control-file`, `--no-control`, `--attach-only`, hidden `--ui-smoke-out`, migration notices | Additive |
| `tools/bridge_sim.py` | additive: `ElrsModule`, `--module elrs`, `--no-vrx-follow`, `decoder_lock_override` | The default behaviour is unchanged |
| `pyproject.toml` | `vtolgcs.ui` package, `packaging` extra | Needed for the new package |
| `__init__.py` | docstring | — |

`protocol.py` and `crsf.py` are unchanged.

### 5.3 Design decisions to note

- **ELRS writes are refused while the client may be armed** (`crsf_menu.allow_write_while_armed`, default false). Bind or a packet-rate change drops the link. Reads always work. Changing TX power in flight therefore needs the option set. The PM may prefer a typed confirmation instead.
- **The ELRS menu needs a running stream:** the bridge answers only the current GCS (C3). The UI says so.
- **`crsf_pass` frames are restricted** to ping/read/write from the handset to the module, at most 50/s. Plan §7.7 asks the bridge to fit them into free slots.
- **MP output altitude:** CRSF GPS has no home reference, so `relative_alt` = GPS altitude.
- **The control-channel `log` command accepts `test_*` record types only.** No other record can be forged.
- **Typed words are compared after stripping surrounding white space**, case-sensitive, as on the console.

### 5.4 For the PM

- **Mission Planner on this laptop holds UDP 5600** (its default HUD source `udpsrc port=5600`), so the fan-out could not bind 5600 while MP ran. The UI reports it clearly, and the README troubleshooting says to switch MP's HUD source to the 5602 pipeline. The manual / Tools content (WP05/WP06) should say the same: **MP must use port 5602, never 5600, when the app's fan-out runs.**
- **C2:** no key changes. `video.rx_kbps` is now filled when the fan-out runs. Event-stream consumers in the same machine: the UI uses one SSE slot of the 4.
- **Contract suggestion (C2.2, optional):** document the control channel as an app-internal interface, not a public contract (the web pages must never use it).

## 6. Notes for the verifier

**Acceptance run:**

1. `python gcs\tools\bridge_sim.py --crsf-pass --module elrs --report-video PAL`
2. `cd gcs`, then `python -m vtolgcs --sim --config %TEMP%\v.json --log-dir %TEMP%` (or `gcs\dist\vtol-gcs\vtol-gcs.exe --sim ...` after `build.ps1`).
   - The sender opens in its own console and the status bar shows `BRIDGE RUN` in green.
   - Press **F9**, or *Camera ON/OFF*: the status bar shows `CAM req ON / rep ON`.
3. Close the UI: the sender keeps streaming. Start the UI again: it attaches.
4. Close the sender's console: the UI shows `RC SENDER DOWN` in red.

**Guards through the UI:**

- RESUME needs the typed `RESUME` (`--sim-armed` to try it).
- CARRIER-ONLY needs `NOCLIENT` / `LANDED`, and is refused with the radio ARMED.
- Stopping a streaming sender needs `STOP`.

**Code review pointers:**

| What | Where |
|---|---|
| Sysid guard | `mp_output.py:79` `encode_frame`; `config.py:506` `mp_sysid_problems`; `MpOutput.__init__` |
| Inbound-ignore path | `mp_output.py:157`–`:205` `SendOnlyUdp`: no method returns received data |
| Typed-word checks | `control.py:418`–`:458` |
| crsf_pass guard | `runtime.py:614` |

**ELRS:** *Load ELRS menu* with the simulator started with `--crsf-pass --module elrs`. Without `--crsf-pass` the menu shows "Not supported by bridge firmware (Q7a)".

**Build:** `powershell -ExecutionPolicy Bypass -File gcs\packaging\build.ps1 -Python <venv>\Scripts\python.exe`. `firewall.ps1` needs an administrator console.

**Opt-in windowed test:** `set VTOLGCS_UI_SMOKE=1` and run pytest.
