# vtol-gcs — Windows GCS companion app

The companion app sends the FPV pilot's RC stream to the relay's RC bridge, shows the bridge and client
status, raises alarms, controls the carrier camera and serves a read-only local API for the Tools page and
the coverage map. It replaces `relay/app.py` and the Linux RC sender of the relay design.

> **The relay protocol is PROPOSAL v1** (`protocol/README.md`). Nothing here is flight-qualified until the
> G0 bridge firmware implements it and the relay design's bench tests pass.

This file covers the **headless runtime (WP08a)**. The windowed UI, video helper, Mission Planner client
output, ELRS menu and packaging follow in WP08b.

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

## Running

Python 3.12 with `pygame-ce` (controller input). Everything else is the standard library.

```
cd gcs
python -m vtolgcs --headless              # real controller, bridge from the config file
python -m vtolgcs --headless --sim        # fake controller, bridge_sim on 127.0.0.1:5770
```

For `--sim`, start the simulator first in a second console: `python gcs/tools/bridge_sim.py`.
With `--sim` the app starts in **FPV** mode (normal start), so the simulator goes WAIT_GCS → START → RUN.
Kill the app (or press `q`) and the simulator reports `RUN -> FAILSAFE` after T_hold (250 ms).

Without `--sim` the app always starts **idle** and never resumes by itself; the pilot picks a normal start
or RESUME (see "Modes and interlocks").

Options: `--config PATH`, `--bridge HOST:PORT`, `--api-port N`, `--no-api`, `--mavlink-port N`,
`--log-dir DIR`, `--no-log`, `--mode idle|fpv|carrier_only` (normal start), `--resume` (RESUME, client
airborne: shows the live arm/throttle values and waits for a typed `RESUME`, plus `THROTTLE` when the
throttle is at minimum), `--camera on|off`, `-v`; `--sim-armed` (with `--sim`: the fake arm switch starts
ARMED, throttle mid, to try `--resume`).
Exit codes: 0 normal, 2 configuration error, 3 another instance is running, 4 usage, 5 start-up
failure (e.g. the local UDP port is taken).

The console shows one status line (mode, bridge state, RTT, uplink loss, send-jitter p99, camera
requested/reported, controller, client LQ, battery, flight mode, active alarm ids) and prints every alarm,
refusal and state change on its own line. Keys:

| Key | Action |
|---|---|
| `f` | FPV mode, normal start (start interlock applies) |
| `c` | carrier-only mode |
| `i` | idle: stop streaming (the bridge goes to FAILSAFE after T_hold) |
| `r` | normal restart of a stopped stream (start interlock applies) |
| `R` | **RESUME (client airborne)**: prints the live arm/throttle values, then asks for a typed confirmation — see "Modes and interlocks" |
| `k` | toggle the carrier camera request |
| `q` | quit |
| `a`, `d` | `--sim` only: toggle the fake arm switch; fake controller disconnect/reconnect |

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
| `sender.t_hold_ms` | `250` | the bridge's T_hold the app expects (relay design: start at 250 ms) |
| `sender.start_packets` | `5` | packets the bridge needs to leave WAIT_GCS (relay design) |
| `controller.prefer_names` | `RadioMaster`, `EdgeTX`, `Joystick` | device chosen by name, in this order; else the first device |
| `controller.device_name` | `null` | exact device name to use instead |
| `controller.poll_hz`, `controller.stale_ms` | `500`, `100` | input poll rate; data older than `stale_ms` (≤ 100 ms) = disconnected |
| `controller.channel_map` | EdgeTX Classic | 16 entries `{src: axis\|button\|none, index, reverse, min, max}`; default axes 0–7 → CH1–8, buttons 0–7 → CH9–16 (plan §7.3) |
| `interlock.arm_channel` | `5` | ELRS takes the arm state from CH5 (protocol README §4) |
| `interlock.arm_safe_min_us` … `max_us` | `988` … `1699` | reference client: ARM on AUX1 = CH5 at 1700–2100 µs (`aux 0 0 0 1700 2100`, `docs/FPV_betaflight_dump.txt`) |
| `interlock.throttle_channel` | `3` | reference client `map AETR1234` |
| `interlock.throttle_low_max_us` | `1050` | reference client `min_check = 1050` |
| `camera.default_on` | `false` | plan §7.1: default off |
| `camera.refuse_on_while_armed` | `true` | plan §7.5 optional interlock; plan Q13: camera off while the client is armed until test 9 is done |
| `camera.on_in_carrier_only` | `true` | carrier-only mode requests the camera (plan §3.4-3) |
| `alarms.*` | see "Alarms" | thresholds |
| `client.profile_id` | `null` | client profile id (contract C1.3), shown in C2 |
| `client.cells`, `client.report_cell_voltage` | `6`, `false` | per-cell battery voltage = pack voltage / cells, or the value as sent when Betaflight `report_cell_voltage` is on |
| `mavlink.enabled`, `listen_ip`, `listen_port` | `true`, `127.0.0.1`, `14551` | Mission Planner MAVLink Mirror input (read-only) |
| `mavlink.carrier_sysid` | `null` | `null` = the first ArduPilot autopilot heartbeat |
| `mavlink.stale_s` | `5` | app default: older carrier position is reported as unknown |
| `api.enabled`, `api.port` | `true`, `47800` | contract C2 |
| `log.enabled`, `log.dir` | `true`, `null` | `null` = `%APPDATA%\vtol-gcs\logs` |
| `video.status_bits_min_fw_ver` | `null` | **TBD** — firmware version from which status bits 3/4 (decoder lock, NTSC) are valid; until then C2 `video.standard`/`decoder_lock` are `null` |

To use the reference client's critical cell voltage instead of its warning level, set
`alarms.cell_min_v` to `3.30` (`vbat_min_cell_voltage = 330`).

## Modes and interlocks (flight-safety path)

| Mode | What is sent |
|---|---|
| `idle` | nothing |
| `fpv` | the controller's 16 channels, every 4 ms (250 Hz) |
| `carrier_only` | arm channel at `arm_safe_min_us` (988 µs), throttle 988 µs, every other channel 1500 µs; no controller needed. Lets the carrier camera run without a client (plan §3.4-3 interim, until the "camera on until a client stream starts" firmware change) |

Rules (`vtolgcs/sender.py`):

1. **Start interlock.** Entering `fpv` (and leaving `fpv` for `carrier_only`) needs: controller connected,
   its data fresh, arm channel inside the safe range **and** throttle low. A refusal lists the reasons
   and nothing is sent. `fpv → carrier_only` is also refused while client telemetry reports ARMED, because
   carrier-only sends "disarmed".
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
4. Before a RESUME the controller must be connected; the values sent are then exactly the pilot's.
5. `idle` is always allowed (the operator's deliberate stop).
6. An unexpected error while building a packet stops the stream (`RC STREAM STOPPED`); silence is the
   fail-safe output.
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
  slots instead of bursting. Per-packet lateness gives the p50/p99/max send jitter.
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
| `rc_stream_stopped` | crit | RC STREAM STOPPED | the stream was stopped by a fault (controller lost, internal error) and not resumed | 0 / 0 s |
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
| `send_jitter_high` | warn | SEND JITTER HIGH | streaming and send-jitter p99 (last 1 s) > `alarms.jitter_p99_max_ms` (2 ms, plan §7.5) | 0 / 2 s |
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
  `"active": true|false` on every raise and clear (contract addition, see the WP08a report)
- CORS: `Origin` reflected for `https://melonno.github.io`, `http://localhost[:port]`,
  `http://127.0.0.1[:port]` and `null`; `OPTIONS` answers `Access-Control-Allow-Methods: GET`,
  `Access-Control-Allow-Headers: *`, `Access-Control-Allow-Private-Network: true`.
  Every response has `Cache-Control: no-store`. Every other method → 405.
- A `Host` header other than `127.0.0.1`/`localhost` is rejected (DNS-rebinding guard).

C2 fields that the runtime cannot fill yet are `null`: `video.rx_kbps` (WP08b fan-out),
`video.standard`/`decoder_lock` (needs the firmware threshold above), `client.profile_id` unless configured.
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
| `sender` | `sent`, `rate_hz`, `send_errors`, `skipped_slots`, `jitter_p50_ms`, `jitter_p99_ms`, `jitter_max_ms`, `waiter` (`high-res-timer` \| `timeBeginPeriod` \| `sleep`) | every second while sending |
| `telemetry` | `kind` + the decoded fields: `link` (`rssi1_dbm`, `rssi2_dbm`, `lq_pct`, `snr_db`, `active_antenna`, `rf_mode`, `tx_power_index`, `tx_power_mw`, `dl_rssi_dbm`, `dl_lq_pct`, `dl_snr_db`, `dl_rssi2_dbm`), `gps` (`lat_deg`, `lon_deg`, `gspd_kmh`, `hdg_deg`, `alt_m`, `sats`), `battery` (`voltage_v`, `current_a`, `used_mah`, `remaining_pct`), `attitude` (`pitch_rad`, `roll_rad`, `yaw_rad`), `flight_mode` (`raw`, `failsafe`, `armed`, `rescue_not_ready`), `vario` (`vspd_ms`), `baro` (`alt_m`, `vspd_ms`, `vspd_format`) | every decoded client CRSF frame |
| `bridge_state` | `from`, `to` (state names), `fw_version`, `rx_ok`, `rx_bad_crc`, `rx_bad_seq` | the reported bridge state changed |
| `mode` | `mode`, `from`, `resumed` (a stopped stream was restarted), `start_path` (`normal` \| `resume` \| `null` for idle), `arm_us`, `throttle_us` (live values at the start; absent when no controller is involved) | a mode change was accepted |
| `resume_preview` | `ok`, `arm_us`, `throttle_us`, `throttle_at_min`, `problems` | RESUME step 1: the live values shown to the pilot |
| `interlock_refused` | `requested` (`fpv` \| `carrier_only` \| `idle` \| `resume`), `from`, `reasons` (list of text) | a start or mode request was refused |
| `suspended` | `reason` (`controller_disconnected` \| `internal_error`), `detail`, `mode` | the stream was stopped by a fault |
| `camera` | `requested` | the camera request changed |
| `camera_reason` | `requested`, `reason` | why the request changed (operator, carrier-only, entering FPV) |
| `camera_refused` | `requested`, `reasons` | camera ON was refused (client may be armed) |
| `camera_readback` | `reported` | the bridge's reported camera state changed |
| `alarm` | `id`, `severity`, `text`, `since`, `active` | an alarm was raised (`active: true`) or cleared |
| `session_end` | `dropped` (records lost to a full queue), `packets_sent`, `rx` (receiver counters) | last line |

Writers append new record types or fields only; readers must ignore what they do not know.

## Tests

```
python -m pytest gcs                 # from the repository root
```

The end-to-end tests start `bridge_sim` in-process on a free localhost port and run the real runtime
against it (WAIT_GCS → RUN, RTT, telemetry, camera read-back, FAILSAFE when sending stops, controller
disconnect). `test_main_cli.py` runs `python -m vtolgcs --headless --sim` as a separate process.
