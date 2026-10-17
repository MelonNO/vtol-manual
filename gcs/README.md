# vtol-gcs — Windows GCS companion app

The companion app sends the FPV pilot's RC stream to the relay's RC bridge, shows the bridge and client
status, raises alarms, controls the carrier camera and serves a read-only local API for the Tools page and
the coverage map. It replaces `relay/app.py` and the Linux RC sender of the relay design.

> **The relay protocol is PROPOSAL v1** (`protocol/README.md`). Nothing here is flight-qualified until the
> G0 bridge firmware implements it and the relay design's bench tests pass.

This file covers the RC sender runtime (WP08a) and the windowed UI, video helper, Mission Planner client
output, ELRS menu, test tools and packaging (WP08b). **Field users: start with the [User guide](#user-guide).**

## Two processes (WP08b R0)

| Process | Program | Does |
|---|---|---|
| **RC sender** | `vtol-gcs-sender.exe` (built) / `python -m vtolgcs --headless` | controller, `rc_up` at 250 Hz, every interlock, bridge status, alarms, C2 API, session log, **control channel** |
| **UI** | `vtol-gcs.exe` / `python -m vtolgcs` | status bar and main window, typed confirmations, Mission Planner client output, ELRS menu, test tools; starts the **video fan-out** helper process |

Python work in the same process delays RC packets through the interpreter lock (WP08a report, "Timing under
load"), so the UI never runs inside the RC sender. The UI reads state from the C2 API (read-only) and sends
operator commands through the local control channel ("Control channel" below). The RC sender keeps every
safety check; the UI can only ask. **If the UI dies, the RC sender keeps streaming** (start a new UI: it
attaches). **If the RC sender dies, the UI shows `RC SENDER DOWN` in red** (status bar and main window).

| Part | Module |
|---|---|
| Configuration (`%APPDATA%\vtol-gcs\config.json`) | `vtolgcs/config.py` |
| Controller input (pygame-ce joystick) | `vtolgcs/controller.py` |
| RC sender, interlocks, modes | `vtolgcs/sender.py` |
| Precise waits, power, single instance (Windows) | `vtolgcs/timing_win.py` |
| Bridge receiver (status, RTT, loss) | `vtolgcs/receiver.py` |
| Client telemetry → C2 `client` | `vtolgcs/telemetry.py` |
| Alarms | `vtolgcs/alarms.py` |
| Read-only carrier position (MAVLink mirror) | `vtolgcs/mavlink_ro.py` |
| Local API (contract C2) | `vtolgcs/api.py` |
| Session log (JSONL) | `vtolgcs/session_log.py` |
| Runtime wiring | `vtolgcs/runtime.py`, `vtolgcs/__main__.py` |
| Protocol / CRSF (WP03) | `vtolgcs/protocol.py`, `vtolgcs/crsf.py` |
| Control channel (UI <-> RC sender) | `vtolgcs/control.py` |
| Windowed UI (tkinter) | `vtolgcs/ui/` (`app.py`, `link.py`, `view.py`, `profiles.py`, `mapping.py`, `hotkey.py`) |
| Video fan-out, GStreamer pipelines, SDP | `vtolgcs/video.py` |
| Mission Planner client output (MAVLink) | `vtolgcs/mp_output.py` |
| ELRS parameter menu, VTX Admin, VRX follow | `vtolgcs/crsf_menu.py` |
| Test tools (RTT, failsafe timer, camera test, g2g clock) | `vtolgcs/testtools.py` |
| Packaging | `packaging/vtol-gcs.spec`, `packaging/build.ps1`, `scripts/firewall.ps1` |

## Running

Python 3.12 with `pygame-ce` (controller input). Everything else is the standard library.

```
cd gcs
python -m vtolgcs                         # the UI; it starts the RC sender in its own console window
python -m vtolgcs --sim                   # the UI with a simulated sender (bridge_sim on 127.0.0.1:5770)
python -m vtolgcs --headless              # the RC sender alone: real controller, bridge from the config file
python -m vtolgcs --headless --sim        # the RC sender alone: fake controller, bridge_sim on 127.0.0.1:5770
```

The UI passes its options (`--sim`, `--config`, `--bridge`, ...) on to the RC sender it starts. If an RC
sender is already running (its control file answers), the UI attaches instead (`--attach-only`: never start
one).

For `--sim`, start the simulator first in a second console: `python gcs/tools/bridge_sim.py`.
With `--sim` the app starts in **FPV** mode (normal start), so the simulator goes WAIT_GCS → START → RUN.
Kill the app (or press `q`) and the simulator reports `RUN -> FAILSAFE` after T_hold (250 ms).

**`--sim` is confined to a simulator on a loopback address.** It sets the bridge to `127.0.0.1:5770`;
`--bridge` may only change that to another loopback address. A non-loopback `--bridge` with `--sim` is a
hard error (exit 4). The fake controller, its keyboard arm switch (`a`) and the automatic FPV start exist
only with a loopback bridge, so they can never reach real hardware.

Without `--sim` the app always starts **idle** and never starts or resumes by itself. Every start that can
reach an airborne client with a non-pilot value needs a **typed confirmation on an interactive console**
(piped or redirected input is refused):

- `--resume` / key `R`: RESUME (client airborne) — `RESUME`, plus `THROTTLE` with the throttle at minimum;
- `--mode carrier_only` / key `c`: carrier-only — `NOCLIENT`, plus `LANDED` after an FPV stream in this
  session (see "Modes and interlocks").

Options: `--config PATH`, `--bridge HOST:PORT`, `--api-port N`, `--no-api`, `--mavlink-port N`,
`--log-dir DIR`, `--no-log`, `--mode idle|fpv|carrier_only`, `--resume`, `--camera on|off`, `-v`,
`--control-file PATH` (default: `control.json` next to the config file), `--no-control` (sender: no UI can
attach), `--attach-only` (UI);
`--sim-armed` (with `--sim` only: the fake arm switch starts ARMED, throttle mid, to try RESUME).
Exit codes: 0 normal, 2 configuration error or bad argument, 3 another instance is running, 4 usage
(including `--sim` with a non-loopback bridge), 5 start-up failure (e.g. the local UDP port is taken).

The test suites run several runtimes at once and give each its own single-instance mutex through the
environment variable `VTOLGCS_TEST_INSTANCE_NAME`. **Never set it operationally**: it lets two senders run
at the same time.

The console shows one status line (mode, bridge state, RTT, uplink loss, send-jitter p99, camera
requested/reported, controller, client LQ, battery, flight mode, active alarm ids) and prints every alarm,
refusal and state change on its own line. Keys:

| Key | Action |
|---|---|
| `f` | FPV mode, normal start (start interlock applies) |
| `c` | carrier-only: shows what it sends, then asks for the typed `NOCLIENT` (and `LANDED`) confirmation |
| `i` | idle: stop streaming (the bridge goes to FAILSAFE after T_hold) |
| `r` | normal restart of a stopped stream (start interlock applies) |
| `R` | **RESUME (client airborne)**: prints the live arm/throttle values, then asks for a typed confirmation — see "Modes and interlocks" |
| `k` | toggle the carrier camera request |
| `q` | quit |
| `a`, `d` | `--sim` with a loopback bridge only: toggle the fake arm switch; fake controller disconnect/reconnect |

## Configuration

`%APPDATA%\vtol-gcs\config.json` is created with the defaults on first run. It is validated on every
load: wrong types, out-of-range values and **unknown keys** (usually typos) are errors, and the app lists
every problem and exits with code 2. Keys missing from the file take the default. Keys starting with
`_` are comments.

| Key | Default | Source / meaning |
|---|---|---|
| `bridge.ip`, `bridge.port` | `192.168.144.21`, `5770` | IP is the plan §3.3 **proposal — open question Q3, confirm at bring-up**; port from the relay design |
| `bridge.local_port` | `0` | local UDP port of the RC socket (0 = any). The bridge replies to it |
| `sender.rate_hz` | `250` | 200–250 Hz allowed (relay design: every 4–5 ms) |
| `sender.t_hold_ms` | `250` | the bridge's T_hold the app expects (relay design: start at 250 ms). After every stop the observed stop → FAILSAFE time is printed and logged next to it (`failsafe_timing`; relay-design test 6) and a FAILSAFE earlier than T_hold is warned about |
| `sender.start_packets` | `5` | packets the bridge needs to leave WAIT_GCS (relay design). At every start the packets sent before START was reported are printed and logged next to it (`start_timing`); fewer than expected is warned about |
| `controller.prefer_names` | `RadioMaster`, `EdgeTX`, `Joystick` | device chosen by name, in this order; else the first device |
| `controller.device_name` | `null` | exact device name to use instead |
| `controller.poll_hz`, `controller.stale_ms` | `500`, `100` | input poll rate; data older than `stale_ms` (≤ 100 ms) = disconnected |
| `controller.channel_map` | EdgeTX Classic | 16 entries `{src: axis\|button\|none, index, reverse, min, max}`; default axes 0–7 → CH1–8, buttons 0–7 → CH9–16 (plan §7.3). The arm and throttle channels **must** be mapped (config error otherwise); a device that lacks the mapped axis/button for them refuses every start |
| `interlock.arm_channel` | `5` | ELRS takes the arm state from CH5 (protocol README §4) |
| `interlock.arm_safe_min_us` … `max_us` | `988` … `1699` | reference client: ARM on AUX1 = CH5 at 1700–2100 µs (`aux 0 0 0 1700 2100`, `docs/FPV_betaflight_dump.txt`) |
| `interlock.throttle_channel` | `3` | reference client `map AETR1234` |
| `interlock.throttle_low_max_us` | `1050` | reference client `min_check = 1050` |
| `camera.default_on` | `false` | plan §7.1: default off |
| `camera.refuse_on_while_armed` | `true` | plan §7.5 optional interlock; plan Q13: camera off while the client is armed until test 9 is done |
| `camera.on_in_carrier_only` | `true` | carrier-only mode requests the camera (plan §3.4-3) |
| `alarms.*` | see "Alarms" | thresholds |
| `alarms.send_late_count` | `3` | app default (WP08a verification m2): `SEND JITTER HIGH` needs this many packets later than `alarms.send_late_max_ms` in one 1 s window (any skipped slot raises it at once) |
| `client.profile_id` | `null` | client profile id (contract C1.3), shown in C2 |
| `client.cells`, `client.report_cell_voltage` | `6`, `false` | per-cell battery voltage = pack voltage / cells, or the value as sent when Betaflight `report_cell_voltage` is on |
| `mavlink.enabled`, `listen_ip`, `listen_port` | `true`, `127.0.0.1`, `14551` | Mission Planner MAVLink Mirror input (read-only) |
| `mavlink.carrier_sysid` | `null` | `null` = the first ArduPilot autopilot heartbeat |
| `mavlink.stale_s` | `5` | app default: older carrier position is reported as unknown |
| `api.enabled`, `api.port` | `true`, `47800` | contract C2 |
| `log.enabled`, `log.dir` | `true`, `null` | `null` = `%APPDATA%\vtol-gcs\logs` |
| `video.status_bits_min_fw_ver` | `null` | **TBD** — firmware version from which status bits 3/4 (decoder lock, NTSC) are valid; until then C2 `video.standard`/`decoder_lock` are `null` |
| `video.listen_port`, `video.fanout_ports` | `5600`, `[5601, 5602]` | contract C3: N6 video in; fan-out to the viewer (5601) and the Mission Planner HUD (5602) |
| `video.gst_launch_path` | `null` | `gst-launch-1.0.exe`; `null` = PATH, `GSTREAMER_1_0_ROOT_MSVC_X86_64`, the usual install folders |
| `video.decoder` | `avdec_h264` | or `d3d11h264dec` (plan §7.4 hardware option; compare latency first) |
| `mp_output.enabled`, `host`, `port` | `true`, `127.0.0.1`, `14560` | client vehicle for Mission Planner's second link; **loopback only** (config error otherwise) |
| `mp_output.sysid`, `compid` | `2`, `1` | plan §14.4 example sysid; **1 and 255 are refused** (S-02b), and it must differ from `mavlink.carrier_sysid` |
| `mp_output.mode` | `vehicle` | or `adsb` (an `ADSB_VEHICLE` traffic icon, brief R4); `adsb_icao` (`null` = sysid), `callsign` (`null` = `FPV<sysid>`) |
| `crsf_menu.timeout_ms`, `retries` | `500`, `3` | app defaults for the ELRS menu requests |
| `crsf_menu.allow_write_while_armed` | `false` | app default: parameter writes are refused while the client is or may be armed (a bind or packet-rate change drops the link) |
| `crsf_menu.vrx_lock_timeout_s` | `10` | app default: VRX follow offers a revert when no decoder lock is reported within this time |
| `ui.profiles_file` | `null` | the Tools-page profiles export the UI last opened (remembered) |
| `ui.camera_hotkey`, `ui.global_hotkey` | `F9`, `true` | camera toggle; system-wide so it works while the video viewer has the focus |
| `ui.status_bar`, `ui.sound` | `true`, `true` | always-on-top status bar; alarm sounds (`winsound`; mute in the UI) |

**Config migration (release note).** Old key names are renamed when the file is loaded: today only
`alarms.jitter_p99_max_ms` → `alarms.send_late_max_ms` (WP08a rework 1). The sender prints
`CONFIG MIGRATED: ...` and logs it, keeps the old file as `config.pre-migration.json`, and saves the migrated
file. A value that is invalid after the migration is reported as a config error that names the migration;
the file is then not rewritten.

To use the reference client's critical cell voltage instead of its warning level, set
`alarms.cell_min_v` to `3.30` (`vbat_min_cell_voltage = 330`).

## Modes and interlocks (flight-safety path)

| Mode | What is sent |
|---|---|
| `idle` | nothing |
| `fpv` | the controller's 16 channels, every 4 ms (250 Hz) |
| `carrier_only` | arm channel at `arm_safe_min_us` (988 µs) = **DISARM**, throttle 988 µs, every other channel 1500 µs; no controller needed. Lets the carrier camera run without a client (plan §3.4-3 interim). **Hazard:** it would disarm any client bound to the TX module, including one flying in failsafe or GPS Rescue — see rule 4 |

> **Preferred long-term fix:** the bridge firmware policy "camera ON until a client stream starts"
> (plan §3.4-3, owner decision Q12, protocol README §7.2 policy B) gives the carrier camera without any RC
> stream, so carrier-only mode — and its DISARM hazard — is no longer needed. Carrier-only is an interim
> measure until that firmware change.

Rules (`vtolgcs/sender.py`):

1. **Start interlock.** A normal `fpv` start needs: controller connected, its data fresh, the arm and
   throttle channels coming from real inputs of the device (an unmapped channel reads 1500 µs and is
   never treated as safe), arm channel inside the safe range **and** throttle low. A refusal lists the
   reasons and nothing is sent. Changing from one streaming mode to another needs `idle` first.
2. **Controller lost** (USB unplug event, or no fresh data for `controller.stale_ms` ≤ 100 ms) in `fpv`:
   the very next 4 ms slot sends **nothing**. The last values are **never** repeated. The stream stays
   stopped (`RC STREAM STOPPED`, mode still `fpv`, `app.streaming = false`) even when the controller comes
   back. The bridge's T_hold fires and the client goes to its own failsafe.
3. **Never auto-resume.** The app starts idle, and a stopped stream stays stopped, until the pilot picks one
   of the two start paths for `fpv`:
   - **Normal start** (`f`, `r`, `--mode fpv`): the start interlock of rule 1.
   - **RESUME (client airborne)** (`R`, `--resume`): for a client that may be flying — in failsafe or GPS
     Rescue after the bridge went silent, or after the app crashed or was restarted. Its pilot holds the arm
     switch ARMED; the normal interlock would force the switch to DISARM first, and the **first packet would
     then disarm the client in mid-air**. RESUME:
     1. shows the **live** arm and throttle channel values first (nothing is sent);
     2. needs the arm switch **ARMED** (with the switch SAFE it is refused: use a normal start);
     3. starts only after an explicit, typed confirmation of that preview (`RESUME`; a single-use preview,
        valid 15 s);
     4. with the throttle at minimum (≤ `throttle_low_max_us`) needs a **second** confirmation (`THROTTLE`),
        because an airborne client would get minimum throttle;
     5. re-checks the live values at the confirmation, and is possible only while nothing is being sent.

   The start path of the current stream is in C2 as `app.start_path` (`normal` | `resume`; `null` when
   idle) and in the session log (`mode` record).
   RESUME also refuses when the arm or throttle value moved by more than 50 µs (app default) between the
   preview and the confirmation, and when the arm or throttle channel has no input on the device.
4. **Carrier-only guard** (it sends DISARM). The only way in is "show what it does, then confirm"
   (`c` / `--mode carrier_only`; `prepare_carrier_only` + `confirm_carrier_only`); every other route,
   including `idle` then `c`, is refused:
   1. it never starts automatically or from a launch flag alone;
   2. the operator types `NOCLIENT` — no client is powered or bound (single use, valid 15 s);
   3. it is refused while any client telemetry was heard in the last **30 s** (a client frame, or link
      statistics with LQ > 0), checked at the preview and again at the confirmation. When nothing was heard
      since the app started, the preview says client telemetry is **"UNKNOWN since app start"**: the bridge
      forwards telemetry only to a GCS that streams, so silence after a restart proves nothing;
   4. it is refused while a connected radio's arm switch is **ARMED** (outside the safe range), at the
      preview and at the confirmation (WP08a verification m1). Without a radio it is still possible;
   5. after any FPV stream (normal or RESUME) in this app session a second confirmation, `LANDED` — the
      client is landed and disarmed — is required;
   6. it is possible only while nothing is being sent.
5. `idle` is always allowed (the operator's deliberate stop).
6. An unexpected error while building a packet stops the stream (`RC STREAM STOPPED`); silence is the
   fail-safe output. If the sender thread itself dies (caught in the thread, plus a liveness check by the
   monitor), C2 shows `streaming: false`, `RC SENDER THREAD DEAD` (crit) is raised and logged, and nothing
   can start until the app is restarted.
7. Camera: switching ON is refused while the client is or may be armed (telemetry says ARMED, the arm
   switch is outside the safe range in `fpv`, or the `fpv` stream is stopped), if
   `camera.refuse_on_while_armed`. Entering `fpv` (normal start or RESUME) with that option set switches
   the request OFF. The app
   shows the **reported** state from the bridge status, and alarms if it differs from the request for > 1 s.

Other protections:

- **Single instance:** a named mutex (`Global\vtol-gcs-sender`); a second copy exits with code 3, so two
  senders can never fight.
- **Timing:** the sender thread runs at `THREAD_PRIORITY_HIGHEST` on absolute deadlines (`next += period`)
  with a high-resolution waitable timer (`CreateWaitableTimerExW`, `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`)
  and a 0.3 ms spin; fallback `timeBeginPeriod(1)` + sleep + 0.5 ms spin. After a stall it skips missed
  slots instead of bursting. Per-packet lateness gives the p50/p99/max send jitter; any packet more than
  2 ms late in one second (`alarms.send_late_count`, 3), or any skipped slot, raises `SEND JITTER HIGH`.
  A single late packet only adds latency (WP08a verification m2); every stall longer than two send periods
  skips slots and still raises the alarm at once.
- **Timing limits (Python):** the RC thread shares the interpreter (GIL) with every other thread of the
  process. The runtime keeps its own work small (switch interval 0.5 ms, status built at most every
  100 ms for the API, at most 4 event-stream clients), but **CPU-bound Python work in the same process
  delays packets** (verifier measurement: 2 busy threads → 200 Hz and 14 ms lateness). Anything heavy
  (UI rendering, video, file parsing) belongs in another process or in code that releases the GIL; if
  that is not enough, move the RC loop into a small native helper (plan §7.2). See the WP08a report.
- **Sleep:** while streaming the sender thread holds `SetThreadExecutionState(ES_CONTINUOUS |
  ES_SYSTEM_REQUIRED)`. This does **not** cover closing the lid: set the laptop's lid action to "Do nothing"
  and use a mains power plan (plan S-02a).
- **Power:** `GetSystemPowerStatus` every 5 s → alarms when on battery or with battery saver on.
- **Focus:** no thread depends on a window; pygame runs with `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`.
- The UDP socket ignores Windows "ICMP port unreachable" resets and accepts datagrams only from the
  configured bridge address.

## Alarms

Ids and texts are stable (the manual's Pre-Arm reference uses them). Hysteresis: a condition must hold
for *raise after* to raise and be false for *clear after* to clear (app defaults, chosen to stop flicker).
"Streaming" means packets are going out.

| Id | Severity | Text | Condition | Raise / clear after |
|---|---|---|---|---|
| `rc_sender_dead` | crit | RC SENDER THREAD DEAD | the RC sender thread died; nothing is sent; restart the app | 0 / 0 s |
| `rc_stream_stopped` | crit | RC STREAM STOPPED | the stream was stopped by a fault (controller lost or unusable, internal error, thread death) and not restarted | 0 / 0 s |
| `controller_disconnected` | crit | CONTROLLER DISCONNECTED | controller not connected or its data older than `controller.stale_ms` (not in carrier-only) | 0 / 0.5 s |
| `bridge_no_status` | crit | NO BRIDGE STATUS | streaming and no bridge status for > `alarms.status_timeout_ms` (300 ms, plan §7.5) | 0 / 1 s |
| `bridge_not_run` | crit | BRIDGE NOT RUN | streaming and the bridge reports a state ≠ RUN (plan §7.5) | 0.5 / 1 s |
| `client_failsafe` | crit | FPV FAILSAFE | client flight mode contains `!FS!` (plan §14.2) | 0 / 1 s |
| `client_rth` | crit | FPV RTH | client flight mode `RTH` (plan §14.2) | 0 / 1 s |
| `client_telemetry_stale` | crit | FPV TELEMETRY LOST | in `fpv`, no client telemetry for > `alarms.telemetry_stale_s` (2 s, plan §14.2) | 0 / 1 s |
| `client_link_weak` | warn | FPV LINK WEAK | uplink LQ < `alarms.lq_min_pct` (70 %, plan §7.5/§14.2) | 1 / 2 s |
| `client_batt_low` | warn | FPV BATT LOW | client per-cell voltage < `alarms.cell_min_v` (3.50 V, reference client `vbat_warning_cell_voltage`) | 2 / 5 s |
| `client_sats_low` | warn | FPV SATS LOW | client satellites < `alarms.min_sats` (8, reference client `gps_rescue_min_sats`) | 1 / 2 s |
| `client_rescue_not_ready` | warn | FPV RESCUE NOT READY | disarmed flight-mode suffix `?` (GPS Rescue configured, no fix; plan §14.2) | 0 / 1 s |
| `rtt_high` | warn | RC RTT HIGH | streaming and RTT > `alarms.rtt_max_ms` — **TBD: `null` (inactive) until the HM30 RTT is measured** (relay-design "UDP echo" test) | 1 / 2 s |
| `rtt_rising_camera` | warn | RTT RISING - CAMERA ON | camera reported ON and the median RTT of the last `rtt_rise_window_s` (5 s) since then is above the 99th percentile of the 5 s before it (or above that median + `alarms.rtt_rise_ms` when set; **TBD after relay-design test 9**) | 0 / 2 s |
| `camera_mismatch` | warn | CAMERA STATE MISMATCH | bridge in START/RUN and camera requested ≠ reported | `alarms.camera_mismatch_s` (1 s, plan §7.1) / 0.5 s |
| `send_jitter_high` | warn | SEND JITTER HIGH | streaming and, in the last 1 s window, at least `alarms.send_late_count` (3, app default) packets sent more than `alarms.send_late_max_ms` (2 ms, plan §7.5) after their deadline, or any skipped slot | 0 / 2 s |
| `gcs_on_battery` | warn | GCS LAPTOP ON BATTERY | `GetSystemPowerStatus`: AC offline | 0 / 5 s |
| `gcs_battery_saver` | warn | GCS BATTERY SAVER ON | `GetSystemPowerStatus`: battery saver on | 0 / 5 s |

Notes:

- Client telemetry alarms use the last known values while in `fpv` (they stay latched if telemetry stops;
  `FPV TELEMETRY LOST` then tells you the values are old). Outside `fpv` they only use fresh telemetry.
- **`FPV TELEMETRY LOST` is the primary client-loss alarm.** The simulator keeps client telemetry flowing
  after the bridge's FAILSAFE, so `!FS!` and `RTH` are visible there. A real ELRS TX module may stop
  telemetry when its handset input stops; then `FPV FAILSAFE` never arrives (WP03 report, relay-design
  risk table). Link statistics come from the TX module itself and do not count as client telemetry.
- RTT is `(now − t_gcs_us_echo)` of the newest packet the bridge had accepted. It includes up to one send
  period (4 ms) of waiting in the bridge.

## Local API (contract C2)

`http://127.0.0.1:47800`, **read-only**, bound to 127.0.0.1 only.

- `GET /api/v1/health` → `{"ok": true, "app": "vtol-gcs", "version": "…"}`
- `GET /api/v1/status` → the C2 Status object (exact keys; unknown values are `null`), plus the additive
  `app.start_path` (`"normal"` | `"resume"` | `null`), see the WP08a report
- `GET /api/v1/events` → SSE: `event: status` every 200 ms; `event: alarm` with the C2 Alarm object plus
  `"active": true|false` on every raise and clear (C2.1). At most **4** event-stream clients (503 after
  that); the status object is rebuilt at most every 100 ms and shared by all API clients, so API load
  stays small next to the RC thread.
- CORS: `Origin` reflected for `https://melonno.github.io`, `http://localhost[:port]`,
  `http://127.0.0.1[:port]` and `null`; `OPTIONS` answers `Access-Control-Allow-Methods: GET`,
  `Access-Control-Allow-Headers: *`, `Access-Control-Allow-Private-Network: true`.
  Every response has `Cache-Control: no-store`. Every other method → 405.
- A `Host` header other than `127.0.0.1`/`localhost` is rejected (DNS-rebinding guard).

C2 fields that the runtime cannot fill yet are `null`: `video.rx_kbps` while no video fan-out reports
(WP08b; the fan-out reports through the control channel, values older than 3 s are dropped),
`video.standard`/`decoder_lock` (needs the firmware threshold above), `client.profile_id` until a profile is
chosen in the UI or configured.
`bridge.state` is `UNREACHABLE` when no status arrived within 300 ms — which is always the case before
streaming, because the bridge only answers a GCS that streams.

## Carrier position from Mission Planner (read-only, S-02b)

The app **never sends MAVLink** (plan S-02b). It only listens for a copy of Mission Planner's stream.
`vtolgcs/mavlink_ro.py` wraps the socket so that no send method exists, and a test checks that no
`sendto` happens.

Mission Planner set-up (names as in Mission Planner 1.3.x; verify on the laptop):

1. Connect Mission Planner to the carrier as usual (HM30, UDP 19856).
2. Press **Ctrl+F** → **MAVLink Mirror**.
3. Choose **UDP Client**, host `127.0.0.1`, port `14551` (`mavlink.listen_port`).
4. **Untick "Write access".** With write access off, nothing that arrives on the mirror port is forwarded to
   the carrier. The app sends nothing anyway; this is the second barrier.
5. Connect. The status `carrier.source` becomes `mavlink-readonly`.

Only `HEARTBEAT` from an ArduPilot autopilot (or the configured `mavlink.carrier_sysid`) and
`GLOBAL_POSITION_INT` from that system are used.

## Session log schema

One file per run: `%APPDATA%\vtol-gcs\logs\session-YYYYMMDDTHHMMSSZ.jsonl` (UTC; `-1`, `-2`… if the name
exists). One JSON object per line. Every record has:

| Field | Meaning |
|---|---|
| `t` | ISO-8601 UTC time with milliseconds, e.g. `2026-10-16T19:52:00.404Z` |
| `mono_s` | seconds since the session started (monotonic clock; use it for intervals) |
| `type` | record type (below) |

| `type` | Fields | When |
|---|---|---|
| `session_start` | `schema` (`vtol-gcs-session/1`), `version`, `config` (the full config) | first line |
| `status` | `status`: the full C2 Status object (same shape as `/api/v1/status`) | 5 Hz |
| `sender` | `sent`, `rate_hz`, `send_errors`, `skipped_slots`, `jitter_p50_ms`, `jitter_p99_ms`, `jitter_max_ms`, `late_count` (packets later than `alarms.send_late_max_ms`), `waiter` (`high-res-timer` \| `timeBeginPeriod` \| `sleep`) | every second while sending |
| `telemetry` | `kind` + the decoded fields: `link` (`rssi1_dbm`, `rssi2_dbm`, `lq_pct`, `snr_db`, `active_antenna`, `rf_mode`, `tx_power_index`, `tx_power_mw`, `dl_rssi_dbm`, `dl_lq_pct`, `dl_snr_db`, `dl_rssi2_dbm`), `gps` (`lat_deg`, `lon_deg`, `gspd_kmh`, `hdg_deg`, `alt_m`, `sats`), `battery` (`voltage_v`, `current_a`, `used_mah`, `remaining_pct`), `attitude` (`pitch_rad`, `roll_rad`, `yaw_rad`), `flight_mode` (`raw`, `failsafe`, `armed`, `rescue_not_ready`), `vario` (`vspd_ms`), `baro` (`alt_m`, `vspd_ms`, `vspd_format`) | every decoded client CRSF frame |
| `bridge_state` | `from`, `to` (state names), `fw_version`, `rx_ok`, `rx_bad_crc`, `rx_bad_seq` | the reported bridge state changed |
| `mode` | `mode`, `from`, `resumed` (a stopped stream was restarted), `start_path` (`normal` \| `resume` \| `null` for idle), `arm_us`, `throttle_us` (live values at the start; absent when no controller is involved) | a mode change was accepted |
| `resume_preview` | `ok`, `arm_us`, `throttle_us`, `throttle_at_min`, `problems` | RESUME step 1: the live values shown to the pilot |
| `carrier_only_preview` | `ok`, `client_heard_s` (seconds since client telemetry, `null` = never), `fpv_this_session`, `problems` | carrier-only step 1 |
| `failsafe_timing` | `expected_t_hold_ms`, `observed_ms`, `note` | the bridge reported FAILSAFE after a stop (stop → FAILSAFE status at the GCS) |
| `start_timing` | `expected_start_packets`, `packets_sent` | the bridge reported START after a start |
| `interlock_refused` | `requested` (`fpv` \| `carrier_only` \| `idle` \| `resume`), `from`, `reasons` (list of text) | a start or mode request was refused |
| `suspended` | `reason` (`controller_disconnected` \| `internal_error` \| `sender_thread_died`), `detail`, `mode` | the stream was stopped by a fault |
| `camera` | `requested` | the camera request changed |
| `camera_reason` | `requested`, `reason` | why the request changed (operator, carrier-only, entering FPV) |
| `camera_refused` | `requested`, `reasons` | camera ON was refused (client may be armed) |
| `camera_readback` | `reported` | the bridge's reported camera state changed |
| `alarm` | `id`, `severity`, `text`, `since`, `active` | an alarm was raised (`active: true`) or cleared |
| `client_profile` | `profile_id`, `cells` | a client profile was chosen in the UI |
| `crsf_write` | `frame` (hex), `param` | an ELRS parameter write went out through `crsf_pass` |
| `crsf_pass_refused` | `frame` (hex), `reasons` | a `crsf_pass` frame was refused (not streaming, client may be armed, type, rate) |
| `control_stop` | `streaming` | the UI asked the RC sender to stop |
| `test_rtt`, `test_failsafe`, `test_camera` | the test-tool result row (see "Test tools") | a test finished in the UI |

`interlock_refused` records from the control channel carry `"via": "control"` (for example a typed word that
did not match).
| `session_end` | `dropped` (records lost to a full queue), `packets_sent`, `rx` (receiver counters) | last line |

Writers append new record types or fields only; readers must ignore what they do not know.

## Tests

```
python -m pytest gcs                 # from the repository root
```

The end-to-end tests start `bridge_sim` in-process on a free localhost port and run the real runtime
against it (WAIT_GCS → RUN, RTT, telemetry, camera read-back, FAILSAFE when sending stops, controller
disconnect). `test_main_cli.py` runs `python -m vtolgcs --headless --sim` as a separate process.

WP08b tests: `test_control.py` (every guard path through the control channel, user-only control file, wrong
token), `test_mp_output.py` (byte-exact MAVLink against an independent reference, CRC_EXTRA computed from the
message definitions, sysid guard, inbound ignored), `test_video.py` (PAL/NTSC pipelines, SDP, fan-out on
localhost, helper process), `test_crsf_menu.py` (menu against the extended `bridge_sim` tree through the real
path), `test_testtools.py`, `test_ui.py` (UI importable without a display; RC SENDER DOWN; the sender keeps
streaming when a UI process dies), `test_packaging.py`. A windowed smoke run (UI + spawned sender + simulator,
camera round trip) runs with `VTOLGCS_UI_SMOKE=1`.

---

## User guide

### Install

**Built version (recommended):** copy the folder `vtol-gcs\` (from a GitHub Release, or built with
`gcs\packaging\build.ps1`) to the laptop, for example `C:\vtol-gcs\`. It contains:

| File | What |
|---|---|
| `vtol-gcs.exe` | the UI (start this one) |
| `vtol-gcs-sender.exe` | the RC sender; the UI starts it in its own console window. Also runs the video fan-out |
| `scripts\firewall.ps1` | firewall rules (below) |
| `README.md` | this guide |

**From source:** Python 3.12 (64-bit) and `pip install pygame-ce`; run `python -m vtolgcs` in `gcs\`.

**Build:** `powershell -ExecutionPolicy Bypass -File gcs\packaging\build.ps1 [-Python path\to\python.exe]`.
It installs PyInstaller and pygame-ce into that Python, builds `gcs\dist\vtol-gcs\` and checks that the
sender starts. Never commit `gcs\dist` or `gcs\build`. Antivirus programs sometimes flag PyInstaller builds:
whitelist the folder rather than disabling protection.

Laptop settings (plan S-02a): mains power plan, lid action "Do nothing", no sleep. The app warns on battery
and battery saver.

### First run

1. Run the firewall script once (below) and set the HM30 network adapter to **Private**.
2. Plug in the RadioMaster radio with the **GCS-RELAY** model (next section).
3. Start `vtol-gcs.exe`. The first start creates `%APPDATA%\vtol-gcs\config.json` with the defaults.
   The RC sender opens in its own console window; the status bar (always on top) and the main window open.
   The sender starts **idle** and sends nothing.
4. **Client tab:** *Open profiles file* → the profiles JSON exported from the Tools page (EXPORT) → select the
   client → *Use this client*. This sets the client id in C2, the cell count of the battery alarm and the
   video standard (if the profile has one). The file and the choice are remembered.
5. **Controller tab:** check the channel monitor: sticks move CH1-4, the arm switch moves CH5 between SAFE
   (≤ 1699 µs) and ARMED, throttle low is ≤ 1050 µs. Use the wizard only if the channels are wrong.
6. Check the bridge IP (`bridge.ip`, plan §3.3 proposal, **open question Q3**) in the config file.
7. **Flight tab:** *FPV - normal start* with the arm switch SAFE and the throttle low. The status bar shows
   `BRIDGE RUN` in green.

To try everything without hardware: `python gcs\tools\bridge_sim.py --crsf-pass --module elrs
--report-video PAL --video-kbps 2000` in one console, then `python -m vtolgcs --sim` (`vtol-gcs.exe --sim`).

### EdgeTX "GCS-RELAY" model (plan §7.3)

1. On the RadioMaster radio create a model **GCS-RELAY**.
2. **Internal RF: OFF. External RF: OFF.** The radio must never transmit; the relay's TX module flies the
   client. (It also makes the joystick mixer faster.)
3. USB mode **Joystick**, **Classic** (channels 1-8 → axes, 9+ → buttons). Unplug and replug USB after
   changing joystick settings. On Windows the radio may show up only as "Joystick": that is expected.
4. Mixer: AETR on CH1-4, the **arm switch on CH5** (ELRS takes the arm state from CH5), modes and beeper on
   CH6-8. The app passes the channels straight through, so the client's channel order is set here.
5. The arm switch must give ≤ 1699 µs when SAFE and ≥ 1700 µs when ARMED (reference client `aux 0 0 0 1700
   2100`); throttle low must read ≤ 1050 µs (`min_check`). Check both in the channel monitor.
6. Measure the HID update interval on the laptop when possible (relay design: 1-8 ms estimate).

### Mission Planner

**Carrier position for the app (read-only mirror):** see "Carrier position from Mission Planner" above:
Ctrl+F → MAVLink Mirror → UDP Client `127.0.0.1:14551`, **Write access unticked**.

**Client drone in Mission Planner (second link):** the UI sends the client's CRSF telemetry as a small
MAVLink stream (sysid 2, never 1 or 255) to `127.0.0.1:14560`. In Mission Planner open a **second
connection**: connection type **UDP**, *Connect*, port **14560** (names as in Mission Planner 1.3.x; verify on
the laptop). The client appears as its own vehicle (quadrotor), or as a traffic icon when
*Mission Planner tab → ADS-B traffic icon* is chosen. Whatever Mission Planner sends back on that link is
dropped; the app never forwards anything to the bridge or the carrier.

**Video in the HUD:** right-click the HUD → Video → Set GStreamer Source → paste the *Mission Planner HUD*
pipeline from the Video tab (it reads port 5602 from the fan-out).

### GStreamer

The standalone viewer needs GStreamer for Windows:

1. Download the **runtime** installer, **MSVC 64-bit**, from https://gstreamer.freedesktop.org/download/
2. Install with **Complete** (the viewer needs the libav plugin for `avdec_h264`).
3. Log off and on (the installer sets `GSTREAMER_1_0_ROOT_MSVC_X86_64`), or set `video.gst_launch_path` to
   `...\gstreamer\1.0\msvc_x86_64\bin\gst-launch-1.0.exe`.

The Video tab shows whether GStreamer was found and explains this when it was not. Mission Planner's HUD uses
its own GStreamer and only needs the pipeline text.

### Firewall

Run once, as administrator, from the install folder:

```
powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1             # add the rules
powershell -ExecutionPolicy Bypass -File scripts\firewall.ps1 -Uninstall  # remove them
```

It adds two inbound UDP rules (group `vtol-gcs`) for `vtol-gcs-sender.exe`, **Private profile only**, remote
addresses `192.168.144.0/24` (the HM30 subnet): bridge status / CRSF, and client video on UDP 5600. Everything
else the app uses is loopback. Then set the HM30 adapter to Private (`Get-NetConnectionProfile`;
`Set-NetConnectionProfile -InterfaceAlias "<HM30 adapter>" -NetworkCategory Private`). For source runs pass
`-Program <path to python.exe>`. Never expose port 5770 outside the HM30 subnet (relay design).

### Troubleshooting

| Symptom | Check |
|---|---|
| `RC SENDER DOWN` (red) | The RC sender process is gone or not answering. Flight tab → *Start sender*; look at its console window and the session log. A client in the air goes to its own failsafe after T_hold; use **RESUME (client airborne)** after restarting. |
| Sender console: `NOT STARTED: another GCS runtime is running` | A sender is already running (single instance). Start the UI: it attaches. |
| `CONFIG ERROR` / `CONFIG MIGRATED` | The sender lists every problem with its key; a migration notice names the renamed key and the backup file. |
| Bridge `UNREACHABLE` while idle | Normal: the bridge only answers a GCS that streams. While streaming: bridge IP (Q3), HM30 link, firewall rule and **Private** network profile. |
| `NO BRIDGE STATUS` / `BRIDGE NOT RUN` | HM30 link, bridge power, bridge IP; the console prints `bridge START after N packets` at each start. |
| `SEND JITTER HIGH` | Close CPU-heavy programs and use mains power; see "Timing limits". The sender does not depend on window focus, so minimising its console is fine. |
| `CONTROLLER DISCONNECTED` | USB cable; radio in Joystick mode with the GCS-RELAY model; `controller.prefer_names` / `device_name`. |
| ELRS tab: `Not supported by bridge firmware (Q7a)` | The bridge does not implement `crsf_pass` yet (future firmware feature). |
| ELRS tab: `no RC stream` | The menu works only while streaming (the bridge answers the current GCS only). |
| ELRS write refused "client may be armed" | Writes are refused while the client is or may be armed (`crsf_menu.allow_write_while_armed`). |
| Video fan-out: `cannot listen on UDP 5600` | Another program (an old viewer, or a fan-out left running) holds 5600. Viewers must read 5601, MP 5602. |
| The client does not appear in Mission Planner | Second connection on UDP 14560; client telemetry must be arriving (FPV streaming); `mp_output.enabled`. |
| F9 does nothing in the viewer | Another program took F9: set `ui.camera_hotkey` (F1-F24). |
| Camera stays off | `CAMERA ON refused`: the client is or may be armed (`camera.refuse_on_while_armed`, plan Q13). |

---

## The UI (`vtol-gcs.exe`)

- **Status bar** (always on top): mode, bridge state (colour), RTT, uplink loss, send jitter p99, client LQ
  and RSSI, client battery, video standard and decoder lock (when reported), timing offset, **camera requested
  vs reported** with the toggle, alarm count. `RC SENDER DOWN` in red when the sender is gone.
- **Flight:** IDLE, FPV normal start, RESUME (client airborne), CARRIER-ONLY, camera; sender process
  start/stop; status; alarm list with sound (`winsound`, critical alarms repeat every 5 s) and *Mute*; events;
  *Open log folder*.
- **Controller:** channel monitor (what the sender would send, arm/throttle marked), mapping/calibration
  wizard (calibrate the travel, assign a channel by moving the control, save `controller.channel_map`; the
  config is validated before it is written; the sender uses it after its next start, while idle).
- **Client:** profiles from the Tools page export (file picker, remembered).
- **Video:** fan-out, PAL/NTSC choice, pipelines with *Copy*, *Launch viewer*, `client-video.sdp`.
- **Mission Planner:** client output on/off, vehicle or ADS-B, sysid, port.
- **ELRS:** parameter tree, edit/write, commands, VTX Admin panel, VRX follow.
- **Tests:** RTT test, failsafe timer, camera test, glass-to-glass clock, results and CSV export.

**Confirmations.** Mode buttons ask before they act. RESUME asks for the typed word `RESUME` (and `THROTTLE`
with the throttle at minimum), carrier-only for `NOCLIENT` (and `LANDED` after an FPV stream), stopping a
streaming sender for `STOP`. The UI forwards what was typed **verbatim**; the RC sender compares it with the
exact word and re-checks every interlock, so a UI bug cannot start a stream that the console would refuse.
The previews show the live values the sender read (`CH5 arm = ... us`, "client telemetry UNKNOWN since app
start", ...).

## Control channel (UI ↔ RC sender, WP08b R0)

- **Transport:** a Windows named pipe `\\.\pipe\vtol-gcs-ctl-<random>` (127.0.0.1 TCP on other systems, for the
  tests) via `multiprocessing.connection`, authenticated with an HMAC challenge on a random **32-byte token**
  that is new for every sender start. Browsers cannot open named pipes and nothing here speaks HTTP: the channel
  is not reachable from web pages (no CORS). The C2 API stays read-only.
- **Control file:** `control.json` next to the config file (default `%APPDATA%\vtol-gcs\control.json`):
  `app`, `control_version` (1), `family`, `address`, `token`, `pid`, `api` (the C2 base URL), `version`. It is
  created with an ACL that gives the current user (only) access, and deleted when the sender stops.
- **Messages:** one JSON object per message. Request `{"id": n, "cmd": "...", ...}` → reply `{"id": n, "ok":
  true|false, "result": {...}, "reasons": [...], "error": "..."}`. After `{"cmd": "subscribe"}` a connection
  carries only events `{"event": kind, "t": <sender clock, s>, "data": {...}}` (a `keepalive` every second).

| Command | Parameters | Result / notes |
|---|---|---|
| `hello` | — | `app`, `version`, `control_version`, `pid`, `t`, `api`, `bridge` |
| `ping` | — | `t` (sender clock; the failsafe timer uses it) |
| `status` | — | the C2 status object (when the HTTP API is off) |
| `request_mode` | `mode`: `fpv` \| `idle` | normal start with the interlock, or stop. `carrier_only` is always refused here |
| `prepare_resume` | — | preview: `token`, `ok`, `problems`, `text`, `arm_us`, `throttle_us`, `needs_throttle_confirm` (sends nothing) |
| `confirm_resume` | `token`, `typed` (must be `RESUME`), `throttle_typed` (`THROTTLE` when the throttle is at minimum) | mode result |
| `prepare_carrier_only` | — | preview: `token`, `ok`, `problems`, `text`, `client_heard_s`, `needs_landed_confirm` (sends nothing) |
| `confirm_carrier_only` | `token`, `typed` (must be `NOCLIENT`), `landed_typed` (`LANDED` after an FPV stream) | mode result |
| `set_camera` | `on` | refused while the client may be armed (camera interlock) |
| `stop` | `typed` (`STOP` while streaming) | stops the sender process |
| `inputs` | — | controller snapshot, raw axes/buttons, device names |
| `rtt_samples` | `since` | `t`, `samples` `[[t, ms], ...]` of the last 30 s |
| `crsf_send` | `frame` (hex) | `crsf_pass` to the bridge: ping / parameter read / write from 0xEA to 0xEE only; only while streaming; writes refused while the client may be armed; at most 50 frames/s |
| `video_report` | `rx_kbps` | from the video fan-out; fills C2 `video.rx_kbps` for 3 s |
| `set_client_profile` | `profile_id`, `cells` | C2 `client.profile_id`, battery-alarm cell count |
| `log` | `type` (`test_*` only), `fields` | appends a test result to the session log |
| `subscribe` | — | event stream: `mode`, `suspended`, `interlock_refused`, `resume_preview`, `carrier_only_preview`, `camera`, `camera_refused`, `alarm`, `bridge_state`, `failsafe_timing`, `start_timing`, `client_flight_mode`, `crsf` (forwarded extended CRSF frames, hex), `error` |

Words are compared after stripping surrounding white space, case-sensitive. A wrong word is logged as
`interlock_refused` (`"via": "control"`) and nothing is sent.

## Video helper (plan §7.4)

The **fan-out** is its own process (`vtol-gcs-sender.exe --video-fanout` / `python -m vtolgcs --video-fanout
--listen 5600 --out 5601,5602 [--control-file F]`), started from the Video tab. It receives the N6's RTP on
UDP 5600 and re-sends every datagram to `127.0.0.1:5601` (viewer) and `127.0.0.1:5602` (Mission Planner HUD),
contract C3. It prints one stats line per second (packets, kbps, packets/s, largest gap) and reports `rx_kbps`
to the RC sender (C2 `video.rx_kbps`). **It keeps forwarding if the UI dies** (the pilot keeps the picture);
closing the UI normally asks whether to stop it.

**Pipelines** (identical to `data/content.js`; no `rtpjitterbuffer`): PAL fields are scaled to 768x576, NTSC
to 640x480. The standard comes from the bridge status flag when the firmware reports it (C2 `video.standard`),
else from the client profile, else the operator chooses (a mismatch between the bridge and the profile is
shown as a warning). The decoder can be switched to `d3d11h264dec` (`video.decoder`, plan §7.4 hardware
option: **verify latency on the laptop first**). `client-video.sdp` (port 5601) is written next to the config
for mpv; verify its latency against GStreamer before relying on it.

## Mission Planner client output (plan §14.4, S-02b)

`vtolgcs/mp_output.py`, in the UI process, about 5 Hz from the C2 status: `HEARTBEAT` (1 Hz; type quadrotor,
autopilot generic; armed flag and state from the client flight mode), `GLOBAL_POSITION_INT` (lat/lon; the CRSF
GPS altitude is used for both `alt` and `relative_alt` because CRSF has no home reference; velocity from
ground speed and course), `ATTITUDE`, `SYS_STATUS` (battery voltage, current, remaining) and `STATUSTEXT` on
every flight-mode change (critical for `!FS!`). In ADS-B mode: `HEARTBEAT` (type ADS-B, autopilot invalid) and
`ADSB_VEHICLE` (callsign `FPV2`, emitter UAV). Position/attitude older than 3 s is not sent.

Hand-written MAVLink 2 (CRC_EXTRA: HEARTBEAT 50, SYS_STATUS 124, ATTITUDE 39, GLOBAL_POSITION_INT 104,
ADSB_VEHICLE 184, STATUSTEXT 83 from `common.xml`; the tests recompute them from the field definitions).
**Guards:** the frame encoder itself refuses sysid 1 and 255; the config allows 2-254 only, never the carrier
sysid, and a loopback destination only; inbound datagrams are read and dropped unparsed.

## ELRS menu (plan §7.7, §14.3)

The ELRS tab speaks the CRSF parameter protocol of the ELRS Lua script through `crsf_pass` (C3, **future bridge
firmware feature Q7a**): ping → device info → parameters `1..field_count` (multi-chunk entries joined) → a
folder tree; edit and write values (re-read after the write); run commands (with the module's confirmation
step). Without Q7a in the bridge the tab says **"Not supported by bridge firmware (Q7a)"**. It needs a running
RC stream, and writes are refused while the client may be armed.

**VTX Admin** panel: the module's *VTX Administrator* folder (Band, Channel, Pwr Lvl, Send VTx). After *Apply*
the tab shows **"VRX follow: via backpack (automatic if fitted) / via N6 (firmware TBD)"**. When the bridge
reports decoder lock (status bit 3, needs `video.status_bits_min_fw_ver`), it waits for the lock and offers
*Revert* after `crsf_menu.vrx_lock_timeout_s` (10 s, app default) without it.

The simulator has a matching tree: `bridge_sim.py --crsf-pass --module elrs [--report-video PAL
--no-vrx-follow]`.

## Test tools (plan §7.8)

| Tool | What it records (session-log `test_*` record and CSV row) |
|---|---|
| **RTT test** | min / mean / p99 / max RTT over N s, with the operator's video note (`video off`, `video full bitrate`, `camera on`) and the mean video rate. RTT includes up to one send period of waiting in the bridge |
| **Failsafe timer** (relay-design test 6) | *Stop stream now + time* (cause "GCS app: stream stopped"), or *Start timer* for another cause (HM30 unplugged, G0 reset) at the moment you cause it; ends at the first client telemetry `!FS!` or the *STOP key* (F8, when the client's OSD shows failsafe). Records the cause, the time to client failsafe and to the bridge's FAILSAFE (sender clock) |
| **Camera test** (relay-design test 9) | 5 s camera off, camera ON, 5 s camera on, camera OFF: RTT and client-video packets/s and largest gap per phase; time until the bridge reports ON and OFF; time until camera traffic stops at the laptop's network interface (`GetIfEntry` of the interface that routes to the bridge; rate back below baseline + 25 % of the camera's increment, app default; 20 ms samples, 100 ms window). Measured at the GCS, so it includes HM30 buffering |
| **Glass-to-glass clock** (relay-design test 2) | a large `HH:MM:SS.mmm` clock window for the 240 fps camera |

*Export CSV* writes all results of the session.
