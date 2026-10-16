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
| R3 | DONE | `sender.py:539` `_run` (`deadline += period`, skips missed slots, never bursts), `timing_win.py:77` `Waiter` (`CreateWaitableTimerExW` + `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`, fallback `timeBeginPeriod(1)` + 0.5 ms spin), `sender.py:440` `_tick_locked` (RcUp, monotonic `seq`, `t_gcs_us`), `:196` `JitterWindow` p50/p99/max | Measured on this laptop: 250.0 Hz, jitter p99 0.33–0.61 ms with 3 SSE clients plus 100 status polls (session log). The thread runs at `THREAD_PRIORITY_HIGHEST`. The runtime lowers the GIL switch interval to 0.5 ms (`runtime.py` `GIL_SWITCH_INTERVAL_S`). *Corrected in rework round 1:* this reduces but does **not** prevent delays by other threads; see the rework section for the honest worst case |
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

## 7. Rework round 1

This answers `VERIFY-round1.md` (REJECTED: F1 and F2 MAJOR, F3–F10 MINOR) and the PM's instructions. Every finding is fixed.

`python -m pytest gcs` gives **548 passed**, green on 4 consecutive full runs (about 37 s each). Line numbers below refer to the rework commit.

### F1 (MAJOR) — carrier-only can disarm an airborne client

**Fixed.** Every route into carrier-only now goes through one guard: `sender.py:491` `_carrier_only_problems_locked`, used by `prepare_carrier_only` (`:503`) and again by `confirm_carrier_only` (`:518`).

| Rule | How |
|---|---|
| Never automatic, never from a launch flag alone | `request_mode('carrier_only')` **always** refuses with "carrier-only sends DISARM: it needs the NOCLIENT confirmation" (`sender.py:397`). `--mode carrier_only` and key `c` only open the dialog (`__main__.py:237` `carrier_only_dialog`). |
| Explicit, single-use "no client" confirmation, valid for a short time | Typed `NOCLIENT`. The preview token is single use (consumed even on refusal) and valid 15 s (`CONFIRM_S`, app default). |
| Refused while client telemetry was heard in the last 30 s | `CARRIER_ONLY_QUIET_S = 30` (`sender.py:82`). "Heard" means a client frame **or** link statistics with LQ > 0 (`telemetry.py:95` `heard_age_s`). Checked at the preview and again at the confirmation. |
| After any FPV/RESUME stream in this session, a second confirmation | Typed `LANDED` ("client is landed and disarmed"). `_fpv_this_session` is set whenever FPV is accepted on either path. |
| Only while nothing is being sent | Refused while any stream runs. Changing from one streaming mode to another always needs `idle` first. |
| Confirmations typed on an interactive console | See F3. |
| README hazard note | Modes table: carrier-only = **DISARM** hazard. A note says the preferred long-term fix is the firmware "camera ON until a client stream starts" policy (plan §3.4-3 / Q12, protocol README §7.2 policy B), which removes the need for carrier-only. |

Tests:

- **`test_sender.py`** (fake clock):
  - `request_mode` never enters carrier-only.
  - Preview and confirmation required; nothing is sent before; wrong flag; single use; expiry.
  - Refused while the client was heard, including a client appearing between preview and confirmation.
  - **The verifier's bypass** (`fpv` armed → `idle` → `c`): needs `LANDED`, and no DISARM packet goes out before it.
  - Suspended FPV → carrier-only needs `LANDED`.
  - Refused while streaming; carrier-only → fpv needs idle first.
- **`test_runtime_e2e.py`** (against `bridge_sim`):
  - The bypass is refused after a real FPV session with telemetry.
  - Carrier-only works only after the confirmation.
  - Dialog paths: piped input refused, wrong word cancels, `NOCLIENT`, and `NOCLIENT` + `LANDED`.
- **`test_main_cli.py`:** the verifier's launch probe `--headless --mode carrier_only` with piped `NOCLIENT` → **0 packets** reach a stand-in bridge.

### F2 (MAJOR) — `--sim` not confined to the simulator

**Fixed.** All three rules are enforced in `__main__.py`:

- `--sim` forces `127.0.0.1:5770`. `--bridge` with `--sim` may only name another **loopback** address; anything else is a hard error, exit 4, before anything starts (`:274` `sim_usage_error`). `--sim-armed` without `--sim` is also an error.
- The fake controller exists only with `--sim` **and** a loopback bridge (`:284` `make_sim_controller`). Without it the `a` / `d` keys do nothing.
- The `--sim` automatic normal start applies only with a loopback bridge (`:297` `initial_start`). Without `--sim` the app always starts idle.
- A second loopback check runs after the config overrides (defence in depth).

Tests (`test_main_cli.py`):

- non-loopback `--bridge` with `--sim` exits 4 (subprocess);
- usage rules;
- the fake controller and keys exist only with a loopback bridge;
- the auto-start happens only with a loopback bridge, and real use is always idle.

### Minor findings

| # | Finding | Resolution |
|---|---|---|
| F3 | Piped RESUME confirmation | Both dialogs refuse when `sys.stdin` is not a TTY: "needs a typed confirmation on an interactive console; piped or redirected input is refused - nothing sent" (`__main__.py:204`, `:395`). Tests: piped `--resume` sends nothing (subprocess); in-process dialog tests with `interactive=False` / `True`. The report's old piped-`RESUME` example is withdrawn. |
| F4 | Timing claim too strong; load | The claim is corrected (R3 row and "Timing limits" in the README). See "Timing under load" below for the changes and honest measurements. |
| F5 | Dead sender thread not detected | Exceptions in the sender loop are caught; the thread is marked dead (`sender.py:711` → `_mark_dead` `:608`). The monitor also checks liveness (`check_alive` `:602`, called at 20 Hz). C2 then shows `streaming: false`; the stream is suspended with `sender_thread_died`; a new **CRIT** alarm `rc_sender_dead` ("RC SENDER THREAD DEAD") is raised and logged; every start path is refused until restart. Test: a waiter that raises kills the thread; all of this is checked. |
| F6 | `t_hold_ms` / `start_packets` unused | Both are now used. After every stop the observed stop → FAILSAFE time is printed and logged next to `t_hold_ms` (`failsafe_timing` record; feeds relay-design test 6), with a warning if FAILSAFE comes earlier than T_hold. After every start the packets sent before START are compared with `start_packets` (`start_timing` record) (`runtime.py:270-295`). The README config table and the comments explain this. Tested in the e2e and CLI runs. |
| F7 | Unmapped arm/throttle counts as safe | `ControllerSnapshot.mapped` flags each channel that comes from a real input (`controller.py:53`, `:89`). An unmapped or missing arm/throttle input is never safe: `arm_switch_safe` / `throttle_low` return false; `input_problems` (`sender.py:211`) refuses the normal start **and** RESUME (otherwise a centred, unmapped arm channel would look "armed" to RESUME); losing the input while streaming suspends the stream. Config validation rejects an arm/throttle channel mapped to `none` or missing from the map (`config.py:364`). A non-preferred device logs a warning (`controller.py:293`). Tests for every path. |
| F8 | `--instance-name` bypasses the single-instance lock | The flag is removed (now an "unrecognized arguments" error, tested). Tests use the environment variable `VTOLGCS_TEST_INSTANCE_NAME`. The README says it must **never** be used operationally. |
| F9 | RESUME confirmation did not compare values with the preview | Refused if arm or throttle moved by more than 50 µs since the preview (`RESUME_VALUE_BAND_US`, app default; `sender.py:80`). Tested both ways. |
| F10 | Malformed `Content-Length` | Treated as 0, so the reply is still 405 (`api.py:174`). Tested. |

### Timing under load (F4 / PM)

**What changed:**

- **SSE clients capped at 4** (`api.py:35`). The 5th gets 503 (tested).
- **`/status` is cheap:** the API and SSE share one status object rebuilt at most every 100 ms (`runtime.py:58` `STATUS_CACHE_S`, `status(max_age_s)`; tested). The session log and in-process callers still get a fresh one.
- **`SEND JITTER HIGH` now fires when the sender misses a deadline by more than 2 ms.** The rule is now: any packet more than `alarms.send_late_max_ms` (2 ms, renamed from `jitter_p99_max_ms`) late in the last 1 s window, **or** any skipped slot. Previously it fired only on the p99.
- **`timeBeginPeriod(1)` is now held in high-resolution-timer mode too** (`timing_win.py:93`). Without it, CPython's GIL hand-over timed waits run at the 15.6 ms system tick. Measured effect: the p99 median under load improved; the worst case did not.

**Measurements** (this laptop, `--sim` app plus a separate `bridge_sim`, 12 one-second windows per run; the machine was shared with other agents' test runs during measurement, so the maxima are pessimistic):

| Load | Rate | p99 median / worst window | Worst single packet | Skipped |
|---|---|---|---|---|
| No API clients | 249.9–250.1 Hz | 0.60 / 0.88 ms | 1.8 ms | 0 |
| 2 SSE + ~30 Hz `/status` polling | 249.9–250.1 Hz | 0.94 / 1.74 ms | 4.6 ms | 0 |
| 4 SSE (cap) + ~30 Hz polling, 2 runs | 249.9–250.1 Hz | 0.78–0.84 / 2.3–3.7 ms | 4.6–9.0 ms | 0 |
| 4 SSE, no polling | 249.9–250.1 Hz | 0.58 / 1.67 ms | 5.6 ms | 0 |
| Verifier: 2 CPU-bound Python threads in the process | 200 Hz | — | 14 ms | 344 / 8 s |

**Honest conclusion:**

- **Normal operation:** the p99 stays around 1 ms and no slots are skipped.
- **With API clients connected:** single packets are occasionally 4–9 ms late, and `SEND JITTER HIGH` (warn) then fires, as the PM asked.
- **Why:** an in-process breakdown shows the delay arises *after* the timer wakes, while the RC thread waits to get the GIL back. It is Python's single interpreter lock, not the timer.
- **What it means for the bridge:** a few ms of lateness is far below the bridge's T_hold (250 ms) and only adds RC latency. CPU-bound work in the process does cause real loss of rate (the verifier's 200 Hz).

**What WP08b must not do** (also in the `runtime.py` docstring and the README):

- no rendering, video handling, file parsing or other heavy or CPU-bound Python work in the runtime process's threads, or in runtime listeners and callbacks;
- no polling of `Runtime.status()` faster than needed (use `status(STATUS_CACHE_S)`);
- no extra SSE consumers inside the process.

Put the tkinter UI's heavy parts and the video fan-out in a separate process, or in code that releases the GIL. If field measurements show `SEND JITTER HIGH` with the real UI, move the RC loop into a small native helper (plan §7.2).

### Other changes in this round

- **Normal start path:** it now refuses while another stream runs; the operator goes to `idle` first.
- **Controller loss:** a lost arm or throttle input now suspends the stream, like a controller loss.
- **Docs:** the C2 notes in the README name C2.1. The README documents the new log records (`carrier_only_preview`, `failsafe_timing`, `start_timing`), the new suspend reason and the new alarm.
- **`Runtime` docstring:** says a UI must show the preview and get an explicit operator confirmation before calling any `confirm_*` method, and must never call one by itself.

### Verifier re-check hints

- `python -m vtolgcs --headless --mode carrier_only` with a joystick or none:
  - prints the DISARM warning and waits for `NOCLIENT`;
  - piped input is refused;
  - after an FPV stream, `LANDED` is also required;
  - with the simulator streaming client telemetry, it is refused for 30 s after the last telemetry.
- `python -m vtolgcs --headless --sim --bridge 192.168.144.21:5770` exits 4 at once.
- `python -m vtolgcs --headless --sim` (loopback) still does the acceptance run (RUN, then FAILSAFE on kill). The console also prints `bridge START after N packets (expected 5)` and, after the stop, `bridge FAILSAFE … ms after the stop (expected T_hold 250 ms)`.
