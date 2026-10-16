# WP08a — Implementation report

Branch `wp/08a` · Contract C2 (owner), C3 (consumer) · Date 2026-10-16

## 1. Summary

WP08a delivers the headless core of the Windows GCS companion app in `gcs/vtolgcs/`:

- **Config:** `%APPDATA%\vtol-gcs\config.json`, created with sourced defaults and validated strictly.
- **Controller:** pygame-ce input in its own thread, with an EdgeTX Classic mapping, C3 scaling and disconnect detection within 100 ms.
- **RC sender:** absolute deadlines on a high-resolution waitable timer. Interlocks; stop-on-controller-loss that never repeats values; idle / fpv / carrier-only modes.
- **Two start paths (PM amendment):** a *normal* start, and *RESUME (client airborne)* with a live-value preview and typed confirmation(s).
- **Receiver:** RTT, uplink loss and status age, plus client telemetry turned into the C2 `client` object.
- **Alarm engine:** hysteresis and 17 rules.
- **Read-only MAVLink input:** a mirror listener on a socket wrapper that has no send method.
- **C2 local API:** with SSE.
- **JSONL session log.**
- **CLI:** `python -m vtolgcs --headless [--sim] [--resume]` with a console status line and keys.

The flight-safety logic sits in one small, lock-protected decision in `sender.py`: `request_mode`, `prepare_resume`/`confirm_resume` and `_tick_locked`. It is covered by fake-clock unit tests, end-to-end tests against `bridge_sim`, and CLI tests that run the app as a real process.

**525 tests pass** (343 from WP03 + 182 new).

## 2. Requirement table

Line numbers refer to the commit that holds this report.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `config.py:55-199` schema, `:300` `validate`, `:389` `from_dict`, `:411` `load_config` (creates the file), `:216` `app_dir` (`%APPDATA%\vtol-gcs`) | All keys required by the brief are present: bridge IP/port (`192.168.144.21:5770`, with a `_note` marking it "proposal Q3"), rate 200–250 (default 250), T_hold 250, API 47800, alarm thresholds, channel map, arm channel and safe range, throttle channel and low threshold, camera default off, MAVLink port 14551. Unknown keys, wrong types and out-of-range values are all listed, with dotted paths. Exit code 2. Tests: `test_config.py` (27 cases) |
| R2 | DONE | `controller.py:65-115` mapping/scaling/device choice, `:179` `PygameController`, `:268` `poll_once` (handles `JOYDEVICEREMOVED`), `:118` `FakeController`, `:55` `Controller` protocol | EdgeTX Classic: axes → CH1–8, buttons → CH9–16. Axis min..max → 988..2012 µs, then `protocol.us_to_crsf` (C3). A disconnect is reported on the next 2 ms poll. In addition, the sender treats a snapshot older than `stale_ms` (≤ 100 ms) as a disconnect, which also covers a hung input thread. Device preference: RadioMaster > EdgeTX > Joystick > first device. Tests: `test_controller.py`, which includes a fake pygame module (hot-plug and removal) and the real pygame thread |
| R3 | DONE | `sender.py:539` `_run` (`deadline += period`, skips missed slots, never bursts), `timing_win.py:77` `Waiter` (`CreateWaitableTimerExW` + `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`, fallback `timeBeginPeriod(1)` + 0.5 ms spin), `sender.py:440` `_tick_locked` (RcUp, monotonic `seq`, `t_gcs_us`), `:196` `JitterWindow` p50/p99/max | Measured on this laptop: 250.0 Hz, jitter p99 0.33–0.61 ms with 3 SSE clients plus 100 status polls (session log). The thread runs at `THREAD_PRIORITY_HIGHEST`. The runtime lowers the GIL switch interval to 0.5 ms (`runtime.py` `GIL_SWITCH_INTERVAL_S`) so that other threads cannot delay a packet by 5 ms |
| R4 | DONE | Start interlock `sender.py:170`/`:288`; stop on controller loss `:440-452`; single instance `timing_win.py:197` (named mutex `Global\vtol-gcs-sender`); sleep `timing_win.py:151` (`ES_CONTINUOUS\|ES_SYSTEM_REQUIRED`, held by the sender thread while streaming, `sender.py:539`); power `timing_win.py:170` → alarms `gcs_on_battery` / `gcs_battery_saver`; focus independence (no UI thread; `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`, `controller.py` `_init`) | When the controller is lost, the next slot sends nothing and the stream stays suspended until an explicit restart. Console output and logging go through queues (`__main__.py:224`), so a frozen console (QuickEdit) cannot block the RC thread. **PM amendment:** see §5.1 |
| R5 | DONE | `sender.py:57` `Mode`, `:182` `carrier_only_channels`, `runtime.py:401` C2 `app.mode` | Carrier-only sends arm = `arm_safe_min_us` (988), throttle 988 and every other channel 1500, and needs no controller. `fpv → carrier_only` is refused unless the pilot has disarmed (interlock) and telemetry does not report ARMED |
| R6 | DONE | `sender.py` flag → `rc_up.flags` bit 0; `runtime.py:316` `set_camera` (optional interlock `camera.refuse_on_while_armed`, default **on** per plan Q13); C2 `bridge.camera.{requested,reported}` from status bit 0; alarm `camera_mismatch` raised after `alarms.camera_mismatch_s` = 1 s (`alarms.py:205`) | The default is off. Carrier-only requests the camera ON (plan §3.4-3). Entering FPV, by either start path, switches the request OFF when the interlock is on |
| R7 | DONE | `runtime.py` binds one UDP socket, used by both the sender (`sendto`) and `Receiver` (`receiver.py:125`). `receiver.py:180` validation and counters (`bad_magic/ver/len/crc/field/src`); `:80` RTT (`u32_diff`), uplink loss, status age; `telemetry.py:110` C2 `client` | Only datagrams from the configured bridge IP:port are accepted. Windows `SIO_UDP_CONNRESET` is disabled. RTT counts only echoes of our own packets that are newer than the last sample. Loss = 1 − Δrx_ok/Δseq-of-echo over about 2 s |
| R8 | DONE | `alarms.py:76` engine (raise/clear, severity, `since`, time hysteresis), `:174` `evaluate_rules`, `:215` `RttRiseDetector`; ids and texts in `gcs/README.md` "Alarms" | All rules from the brief are implemented. `client_telemetry_stale` (FPV TELEMETRY LOST) is documented as the **primary** client-loss alarm, because a real TX module may not forward `!FS!`. Extra alarm: `rc_stream_stopped`. A test checks that every id and text appears in the README |
| R9 | DONE | `mavlink_ro.py:104` v1/v2 parser (truncated payloads, signed frames, CRC_EXTRA 50/104), `:165` carrier filter (ArduPilot autopilot heartbeat or configured sysid; GCS and generic autopilots ignored), `:217` `ReceiveOnlySocket` (no send/sendto/sendall/sendmsg/connect; immutable) | README section "Carrier position from Mission Planner" covers MP MAVLink Mirror → UDP Client 127.0.0.1:14551 with **Write access unticked**. Tests prove that no `sendto` happens, three ways: a recording fake socket, the wrapper raising `PermissionError`, and a real UDP listener with `socket.socket.sendto` / `send` / `sendall` / `connect` monkeypatched |
| R10 | DONE | `api.py:94-240`: `ThreadingHTTPServer` on 127.0.0.1:47800; health, status, events (SSE status every 200 ms plus alarm events); CORS reflection regex `:35`; OPTIONS with Allow-Methods GET, Allow-Headers \*, Allow-Private-Network true; `no-store` on everything; every other method → 405 (`__getattr__` routes `do_*`) | A Host-header check (DNS-rebinding guard) was added. The API never emits invalid JSON (NaN → null). A busy port is reported and the RC path still runs |
| R11 | DONE | `session_log.py`; records written by `runtime.py`; schema in `gcs/README.md` "Session log schema" | Status samples at 5 Hz (the full C2 object), telemetry (every decoded frame), alarms, mode/start path, interlock refusals, resume previews, camera request/reason/refusal/read-back, bridge state changes, per-second sender stats, session start/end. A non-blocking queue feeds a writer thread |
| R12 | DONE | `__main__.py:248` | `--headless [--sim]` gives a console status line and event lines; keys f/c/i/r/R/k/q (and a/d with `--sim`). `--sim` uses the fake controller and `127.0.0.1:5770`, and does a normal FPV start. Exit codes 0/2/3/4/5 |
| R13 | DONE | `gcs/tests/` (11 new files) | e2e against `bridge_sim`: WAIT_GCS→RUN, RTT, telemetry → C2, camera read-back, FAILSAFE when sending stops (not before T_hold), controller disconnect stops sending, interlock refusal, RESUME after restart. Unit tests: alarm rules, API shape/CORS/PNA/405/SSE, MAVLink read-only, config validation. Clocks are injected wherever possible |
| R4 amendment (PM) | DONE | `sender.py:82` `ResumePreview`, `:347` `prepare_resume`, `:379` `confirm_resume`; `runtime.py:286-298`; `__main__.py:185` `resume_dialog`, CLI `--resume`, key `R`; C2 `app.start_path` (`runtime.py:401`) | See §5.1 |

## 3. Placeholders (TBD)

| Where | TBD | Why |
|---|---|---|
| `config.alarms.rtt_max_ms` = `null` | RTT alarm threshold ("RTT > X ms", plan §7.5) | The HM30 uplink latency is unmeasured (relay design: "unknown — measure with the UDP echo test"). The `rtt_high` rule is inactive until it is set, and the runtime logs a warning at start. README alarm table |
| `config.alarms.rtt_rise_ms` = `null` | Size of the "RTT rising after camera on" rise | Unknown until relay-design test 9. Meanwhile a parameter-free rule applies: median after ON > p99 of the 5 s before ON |
| `config.video.status_bits_min_fw_ver` = `null` | fw_ver from which status bits 3/4 are valid | Future firmware request (C3 footnote). C2 `video.standard` / `decoder_lock` stay `null` |
| `bridge.ip` `_note` | Bridge IP is the plan §3.3 proposal (Q3) | Final IPs are undecided |

App defaults that are **not** from the sources are documented as such in the README:
- alarm hysteresis times;
- `mavlink.stale_s` 5 s;
- RTT-rise window 5 s;
- RESUME preview validity 15 s;
- spin margins 0.3 / 0.5 ms.

All operational thresholds come from plan §7.5 / §14.2 or from the reference client's Betaflight dump:
- `aux 0 0 0 1700 2100` → arm safe range ≤ 1699 µs on CH5;
- `map AETR1234` → throttle on CH3;
- `min_check = 1050` → throttle low ≤ 1050 µs;
- `vbat_warning_cell_voltage = 350` → client battery alarm 3.50 V/cell;
- `gps_rescue_min_sats = 8` → minimum sats 8.

## 4. Tests

Command, from the worktree root:

```
C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\venv\Scripts\python.exe -m pytest gcs
```

Result: **`525 passed in ~37 s`** (Windows 11, Python 3.12.10, pygame-ce 2.5.8). The full suite ran green on 5 consecutive runs; after fixing one test race (the carrier-only test now waits for the 0.5 s alarm hysteresis) the e2e file ran green 5 more times.

New test files:

| File | Covers |
|---|---|
| `test_config.py` | defaults and their sources, file creation, APPDATA path, partial files, 20 validation errors, invalid JSON |
| `test_controller.py` | axis/button mapping, calibration, C3 conversion, device preference, fake pygame hot-plug/removal, real pygame thread |
| `test_sender.py` | normal-start interlock (arm/throttle edges, no or stale controller); stop on disconnect, never repeating, no auto-restart; stale data stops within 100 ms; **RESUME path** (preview first, nothing sent before confirmation, token single use and expiry, throttle-at-minimum second confirmation, refused with switch SAFE or while streaming, after controller loss, a fresh sender never auto-resumes); carrier-only; camera flag; send errors; internal error; seq wrap; jitter stats; real thread at 250 Hz, silent at once on stop |
| `test_timing_win.py` | waiter never early (both methods), single-instance mutex, power/keep-awake/priority calls |
| `test_receiver.py` | counters per failure type, source filter, state changes, RTT (own echoes only, u32 wrap), loss, status age, telemetry → C2 client, link stats do not refresh client age, CRSF listeners, per-cell voltage |
| `test_alarms.py` | every rule (one at a time), strict thresholds, inactive cases, hysteresis and flicker, ordering, configured camera delay, README documents every id/text, RTT-rise detector |
| `test_api.py` | real runtime: health, **exact C2 keys**, CORS allow/deny lists, preflight with PNA, 405 for POST/PUT/DELETE/PATCH/HEAD/TRACE/FOO, 404, Host guard, SSE status + alarm events, NaN-safe JSON, port in use |
| `test_mavlink_ro.py` | CRC_EXTRA computed from the field lists, X.25 check value, GLOBAL_POSITION_INT v1/v2/signed/truncated, carrier filter, bad CRC/garbage, staleness, **no send** (three ways) |
| `test_session_log.py` | file name, JSON cleaning, records, close, same-second files |
| `test_runtime_e2e.py` | against `bridge_sim`: RUN, RTT, loss, jitter, telemetry, camera ON/OFF read-back, API over HTTP, FAILSAFE ≥ T_hold after stop; controller-disconnect stop/no-repeat/alarms/explicit restart; interlock refusal sends nothing; client `!FS!`/`RTH` alarms and camera/carrier-only refusals while armed; RESUME after restart; carrier-only; camera mismatch; session-log content |
| `test_main_cli.py` | the real process with `--headless --sim`: streams, simulator reaches FAILSAFE after exit, config created, log written. Also: restart with switch armed comes up idle; `--resume` with typed `RESUME` (live values printed before "RESUME started"); cancelled resume sends nothing; resume refused with switch SAFE; exit codes 2/3/4 |

## 5. Deviations / contract issues

### 5.1 PM amendment to R4 — two start paths (implemented)

1. **Normal start** (`request_mode('fpv')`, key `f`/`r`, `--mode fpv`) keeps the R4 interlock: arm safe and throttle low. With the switch armed, the refusal says "if the client is airborne use RESUME (client airborne)".
2. **RESUME (client airborne)** is a separate two-step action: `prepare_resume()` → `confirm_resume(token, throttle_min_confirmed=…)`.
   - **Preview:** reads and returns the live arm and throttle values (`ResumePreview.text()`, e.g. `CH5 arm = 2012 us (ARMED), CH3 throttle = 1500 us`). It sends nothing.
   - **Confirmation:** needs the token of the latest valid preview (single use, valid 15 s).
   - **Arm switch:** RESUME requires the switch ARMED. With the switch SAFE it is refused: resuming would disarm the client, so use a normal start.
   - **Throttle at minimum** (≤ `throttle_low_max_us`): refused unless `throttle_min_confirmed`, a second confirmation.
   - **Re-check:** the live values are checked again at confirmation.
   - **When allowed:** only while nothing is being sent (idle or a suspended stream).
   - **Headless:** key `R` or `--resume` prints the live values, then asks for a typed `RESUME`, and with the throttle at minimum also `THROTTLE`. Anything else cancels and nothing is sent.
3. **Never auto-resume.** The sender starts idle and a suspended stream stays silent until the pilot picks a path. Tests cover a fresh `Sender`, `--sim-armed` without `--resume` and controller reconnect.
   - Exception: `--sim` alone does a *normal* start for the verifier's acceptance run. That is simulator-only and still goes through the interlock.
4. **Logging:** the `mode` record carries `start_path`, `arm_us` and `throttle_us`. New `resume_preview` record. Refusals are `interlock_refused` with `requested: "resume"`.
5. **C2 (additive):** `app.start_path` = `"normal"` | `"resume"` | `null` (idle). **The PM should add this to contract C2.** Consumers (WP02 `GcsClient`) ignore unknown keys.
6. This replaces my earlier, narrower "armed resume", which only worked after a fault in the same process. That API no longer exists.

### 5.2 Other contract notes

- **C2 SSE `alarm` event:** C2 says "an Alarm object when an alarm is raised or cleared" but has no field to tell the two apart. I added `"active": true|false` to the event only. The `alarms` list in `/status` keeps exactly the four C2 keys. **The PM should add `active` to C2.**
- **C2 `bridge.state = "UNREACHABLE"`** means no status within 300 ms. Before streaming this is always the case, because the bridge only replies to a sender (C3).
- **C2 `controller` fields** are `null` (not `false`) for `arm_switch_safe` / `throttle_low` while the controller is disconnected.
- **C3:** consumed unchanged; no changes to `protocol.py` or `crsf.py`.

### 5.3 Files outside the brief's list (minimal)

- `gcs/vtolgcs/__init__.py`: docstring only (it said "currently holds the protocol layer").
- `gcs/pyproject.toml`: description, plus an optional `controller = ["pygame-ce"]` extra (pygame-ce is an allowed dependency).
- `gcs/tests/_c2.py`: a shared C2 reference shape for the tests, like WP03's `_vectors.py`.
- No new runtime modules beyond the brief's list. The Windows helpers (power, priority, mutex) live in `timing_win.py`.

### 5.4 Design decisions to note

- **Telemetry age** counts only client-originated frames (flight mode, GPS, battery, attitude, vario, baro). Link statistics come from the TX module and would hide a lost client.
- **Telemetry alarm values:** they stay latched in `fpv` while telemetry is stale (FPV TELEMETRY LOST explains why). Outside `fpv` only fresh values count.
- **`controller_disconnected`** is also raised in idle (preflight hint), but not in carrier-only.
- **Camera interlock default on** (`refuse_on_while_armed: true`), per plan Q13 ("until then: camera off while the client is armed").
- **Socket binding:** the RC socket binds `0.0.0.0` and filters datagrams by the bridge source address. The firewall rule (WP08b `firewall.ps1`) should restrict UDP to the HM30 interface.

## 6. Notes for the verifier

- **Acceptance run** (two consoles):
  1. `python gcs/tools/bridge_sim.py`
  2. `cd gcs` then `python -m vtolgcs --headless --sim`. The status line shows `FPV  bridge RUN  rtt …`.
  3. `curl http://127.0.0.1:47800/api/v1/status` gives C2. `curl -N http://127.0.0.1:47800/api/v1/events` gives SSE.
  4. Kill the app (close the console or Ctrl-C). The simulator logs `RUN -> FAILSAFE` about 250 ms later.
  5. Note: `--sim` reads and creates your real `%APPDATA%\vtol-gcs\config.json`. Use `--config <tmp>.json` to avoid that.
- **Interlock and RESUME by hand:**
  - `python -m vtolgcs --headless --sim --sim-armed` comes up idle and sends nothing. `f` is refused ("arm switch not safe … use RESUME").
  - `R` prints the live values and waits for `RESUME`.
  - Or non-interactively: `echo RESUME | python -m vtolgcs --headless --sim --sim-armed --resume`.
- **Controller loss:** in `--sim`, press `d`. The stream stops at once (`RC STREAM STOPPED`, alarms), and the simulator goes to FAILSAFE. Press `d` again: still silent. Then `r` (normal restart; arm is safe in the default sim).
- **Camera:** press `k`. The status line shows `cam ON/ON` once the bridge reads it back.
- **Sender code review:** `sender.py` lines 288–413 (request / resume decisions) and 440–456 (per-packet decision).
- **Session log:** `%APPDATA%\vtol-gcs\logs\session-*.jsonl`, or `--log-dir`.
