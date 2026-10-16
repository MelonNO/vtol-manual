# WP08b — GCS companion app: UI, video helper, Mission Planner output, CRSF menu, test tools, packaging

- **Worktree:** `S\wt\WP08b`
- **Branch:** `wp/08b`
- **Wave:** 3
- **Starts after:** WP08a is merged

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md`, `protocol/README.md`, `gcs/README.md`, the WP03 and WP08a reports, plan §7.4, §7.5, §7.7, §7.8, §14.3, §14.4, and the relay design "Ground station software".

## Goal

Make the app usable in the field on Windows, and finish the features that sit on top of the runtime.

## Files you own

- `gcs/vtolgcs/` — new modules: `ui/` (tkinter), `video.py`, `mp_output.py`, `crsf_menu.py`, `testtools.py`. Small additive hooks in `runtime.py` are allowed; report them.
- `gcs/tools/bridge_sim.py` — **additive** extension only: a minimal emulated ELRS parameter tree and `crsf_pass` handling, for testing R5/R6
- `gcs/packaging/` (PyInstaller spec, `build.ps1`), `gcs/scripts/firewall.ps1`
- `gcs/README.md` (user guide sections), `gcs/tests/`
- `docs/tasks/reports/WP08b-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **UI (tkinter, stdlib).**<br>- An **always-on-top compact status bar** (plan §7.5 fields) plus a main window: client profile selector (reads a profiles JSON exported from the Tools page, via a file picker; remembered), controller status and a **channel monitor**, a mapping/calibration wizard that writes config, the camera toggle with hotkey (F9 default) showing **requested vs reported**, mode buttons (Idle / FPV / Carrier-only) with confirmation, an alarm list with sound (`winsound`) and mute, and a log-folder link.<br>- The UI must never block the sender (runtime threads are independent; the UI polls state). |
| R2 | MUST | **Video helper** (plan §7.4):<br>- UDP fan-out 5600 → 127.0.0.1:5601 and :5602 (C3), with throughput stats<br>- generate the GStreamer viewer pipeline for PAL and NTSC (pick from the bridge status flag when present, else the client profile, else ask)<br>- launch `gst-launch-1.0` if found (configurable path), and show copyable pipelines for the MP HUD (port 5602)<br>- write `client-video.sdp` (port 5601) for the mpv alternative<br>- detect a missing GStreamer and explain how to install it |
| R3 | MUST | **Mission Planner client display** (§14.4): convert client telemetry to MAVLink v2 `HEARTBEAT` (type quadrotor, autopilot generic), `GLOBAL_POSITION_INT`, `ATTITUDE`, `SYS_STATUS` (voltage) and `STATUSTEXT` on mode change. Sysid configurable, default **2**; **reject 1 and 255** (S-02b). Sent to a UDP port (default 14560) that MP connects to as a second link. Hand-written MAVLink encoding with correct CRC_EXTRA per message (cite the values from the MAVLink common.xml / generated headers). **Inbound packets are ignored**, never forwarded to the bridge or carrier. Tests: byte-exact frames against known-good values (compute CRC_EXTRA in the test from the message definition, or cite pymavlink output). |
| R4 | SHOULD | **ADSB alternative:** option to emit `ADSB_VEHICLE` instead (traffic icon in MP). |
| R5 | MUST | **CRSF parameter menu** (§7.7): device ping → device info → read the parameter tree → display a folder tree; edit/write values; covers VTX Admin (band/channel/power) as a quick panel. Transport: `crsf_pass` (C3, future firmware feature Q7a). When the bridge doesn't support it (no response), show "Not supported by bridge firmware (Q7a)". Test against the extended `bridge_sim` emulated tree. |
| R6 | SHOULD | **VRX follow (§14.3):** after a VTX Admin write, show a "VRX follow: via backpack (automatic if fitted) / via N6 (firmware TBD)" status. If the bridge status reports decoder lock, wait for lock and offer revert after N s without lock. |
| R7 | MUST | **Test tools** (§7.8): UDP RTT test (min/mean/p99 with video on/off notes), failsafe timer (stop stream on key → timestamp until client telemetry shows `!FS!` or a manual stop key; log per cause), camera on/off test (RTT before/after and the time until camera traffic stops, using throughput stats), glass-to-glass millisecond clock window (large font, high refresh). Results are appended to the session log and exported as CSV. |
| R8 | MUST | **Packaging:** PyInstaller spec plus `build.ps1` producing a single-folder build in `gcs/dist/` (not committed). `firewall.ps1` adds inbound UDP rules for the app on the private profile only, with an uninstall switch. `gcs/README.md` user guide: install, first run, EdgeTX "GCS-RELAY" model setup (RF off, Classic joystick), MP MAVLink Mirror (write off) and the second link, GStreamer install, firewall, troubleshooting. |
| R9 | MUST | Tests: MAVLink encoding, CRSF menu against the simulator, video pipeline strings for PAL/NTSC, fan-out forwarding on localhost, the UI module importable headless (no display needed for the test), and the sysid guard. |

## Acceptance (verifier)

- `pytest gcs` passes.
- `build.ps1` runs: the verifier may skip the actual build if PyInstaller install fails, but the script must be correct; review it.
- The verifier runs `bridge_sim` and the app with UI briefly, if a display is available, to check that the status bar shows RUN and the camera toggle round-trips.
- Code review of the MAVLink sysid guard and the inbound-ignore path.
