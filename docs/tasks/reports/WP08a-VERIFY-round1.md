# WP08a verification — round 1
VERDICT: REJECTED

Verifier: independent verification agent. Worktree `S\wt\WP08a`, branch `wp/08a`, HEAD `c9029d1`, merge-base `d10dca7`.
Contracts checked against the **current main** copy of `02-CONTRACTS.md` (with C2.1).

The core of the work is good. The sender, the stop on controller loss, the RESUME path, the receiver, the alarms, read-only MAVLink and the C2 API are well built and well tested. The acceptance run passes.

The work is rejected for **two MAJOR flight-safety gaps**, both outside the fpv/RESUME logic:

- **F1:** carrier-only mode sends DISARM. It can be started from idle, or at launch, with no check and no confirmation. That bypasses the guard the implementer put on fpv → carrier_only.
- **F2:** the `--sim` exception is not limited to the simulator.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 Config | PASS | `config.py:54-193` schema, `:300-386` validate, `:411-429` load/create, `:216-219` `%APPDATA%\vtol-gcs` | Every key the brief requires is present. Q3 note on `bridge`. Unknown keys and range errors are listed and give exit 2. `sender.t_hold_ms` / `start_packets` are validated but never used (MINOR F6). |
| R2 Controller | PASS | `controller.py:55-60` interface, `:65-95` mapping and C3 scaling, `:98-113` device preference, `:268-289` poll (JOYDEVICEREMOVED → drop), stale ≤ 100 ms (`config.py:332`) | Background events are enabled. Fake controller for tests. Probe: a frozen input thread stops the stream after 24 packets (≤ 100 ms). |
| R3 Sender timing | PASS | `sender.py:539-566` (`deadline += period`, skip without burst), `timing_win.py:77-132` (`CreateWaitableTimerExW` + HIGH_RESOLUTION, fallback `timeBeginPeriod(1)` + spin), `sender.py:452-456` monotonic seq / t_gcs_us, `:196-228` p50/p99/max | Own measurements below. It meets the ≤ 2 ms p99 target under realistic load. It degrades under CPU-bound Python threads (MINOR F4). |
| R4 Interlocks | PASS (fpv path) / see F1 | Normal-start interlock `sender.py:321-344`; stop on loss `:440-448` (next slot sends nothing, no repeat, no auto-restart); mutex `timing_win.py:197-221`; keep-awake held by the sender thread `sender.py:552-555`; power status `timing_win.py:170-188` → alarms; no UI thread | The **carrier_only** start bypasses every interlock from idle and at launch (F1). |
| R4 PM amendment (two start paths) | PASS | `sender.py:347-413`, `runtime.py:286-297`, `__main__.py:185-208`, C2 `app.start_path` `runtime.py:416-417`; logging `mode` / `resume_preview` / `interlock_refused` | Preview first, nothing sent before confirmation (probe 4b, e2e test, acceptance run 3). Single-use token, 15 s expiry, second THROTTLE confirmation, re-check at confirm. A fresh sender is always idle. Typed confirmation can be piped (MINOR F8). |
| R5 Modes | PASS with F1 | `sender.py:57-60`, `:182-187`; C2 `app.mode` | Carrier-only output is correct: arm 988, throttle 988, rest 1500, camera ON. Its start is unguarded (F1). |
| R6 Camera | PASS | flags bit0 `sender.py:454`; read-back `runtime.py:434-435`; mismatch > 1 s `alarms.py:196-197,205-208`; default off `config.py:114`; optional interlock (default on, plan Q13) `runtime.py:316-328` | Acceptance run: `cam` requested/reported in C2. |
| R7 Receiver | PASS | same socket `runtime.py:140-157`; source filter `receiver.py:182`; RTT only for own echoes `:88-93`; loss `:96-117`; status age; telemetry → C2 `telemetry.py:110-143` | Acceptance: RTT 2.41 ms, loss 0.0 %, telemetry decoded. |
| R8 Alarms | PASS | `alarms.py:41-59` (17 ids), `:76-139` engine with hysteresis, `:174-202` rules; README table | Every rule in the brief is present. `client_telemetry_stale` is the primary client-loss alarm (README lines 197-200). Plan §14.2 says "while the bridge is in RUN"; the code uses "in fpv", which is stricter and documented. |
| R9 MAVLink read-only | PASS | `mavlink_ro.py:217-247` `ReceiveOnlySocket` (no send/sendto/sendall/sendmsg/connect, immutable); the only `sendto` in the package is `runtime.py:147` (rc_up to the bridge) | MP mirror set-up with Write access unticked (README lines 230-237). The app emits no MAVLink. S-02b satisfied. |
| R10 Local API | PASS | `api.py:94-250` | See the contract results. Host-header guard added. |
| R11 Session log | PASS | `session_log.py`; records in `runtime.py`; schema in README lines 242-271 | Observed types: session_start, status, sender (1 Hz), telemetry, mode, bridge_state, camera_readback, alarm. |
| R12 CLI | PASS with F2 | `__main__.py:248-331` | `--headless --sim` works and the status line is shown. `--sim` is not confined to the simulator (F2). |
| R13 Tests | PASS | 11 new test files, 182 new tests | The tests exercise real logic: fake clocks, real bridge_sim e2e, a CLI subprocess, real UDP no-send. They miss F1 and F2. |

## Contract results

**C2 (owner), checked against main's C2 + C2.1:**

- **Status keys:** my independent reference shape (typed from the contract, not from `tests/_c2.py`) shows **no missing and no extra keys**. `app.start_path` is present (C2.1).
- **Alarms:** `alarms[]` items have exactly `id`, `severity`, `text` and `since`. The SSE alarm event adds `active` (C2.1).
- **Health:** `{"ok":true,"app":"vtol-gcs","version":"0.1.0"}`.
- **CORS:** `Origin` is reflected for `https://melonno.github.io`, `http://localhost:8080`, `http://127.0.0.1:5500` and `null`. It is **not** reflected for `https://evil.example`, `https://melonno.github.io.evil.com` or `http://localhost.evil.com`.
- **OPTIONS preflight** (allowed origin): 204 with `Access-Control-Allow-Methods: GET`, `Access-Control-Allow-Headers: *`, `Access-Control-Allow-Private-Network: true` and `no-store`. A disallowed origin gets no CORS headers.
- **Other methods:** POST, PUT, DELETE, PATCH and HEAD all return 405 with `no-store`.
- **Caching:** `Cache-Control: no-store` on every response.
- **SSE:** 7 status events in about 1.2 s (≈ 5 Hz).
- **Consumer check:** the WP02 `js/gcs-client.js` on main uses `/api/v1/events` with `status` / `alarm`. Compatible.

**C3 (consumer):**

- Uses `protocol.RcUp`, `decode` and `us_to_crsf` unchanged; `protocol.py` and `crsf.py` are untouched.
- Sending clamps 172…1811.
- RTT uses `u32_diff`.
- An app restart relies on the WP03 seq re-baseline proposal (protocol README §5.1). Verified against the same simulator: app1 RUN → kill → FAILSAFE → app2 RESUME → RUN.

## Tests run (commands + results)

- `S\venv\Scripts\python.exe -m pytest gcs` was run **5 times**: `525 passed` each time, in 36.6–37.4 s. No flakes.
- `… -m pytest gcs protocol`: `525 passed`.
- `git merge-tree --write-tree main wp/08a` in `S\repo\vtol-manual` merges cleanly (tree `c3296d6…`).

## Smoke tests (what I ran + result)

Scripts are in `S\verify\WP08a\`. Each run used a temp `--config` and `--log-dir`. `%APPDATA%\vtol-gcs` did not exist before or after.

1. **`acceptance.py`.** I ran `bridge_sim.py -v`, then `python -m vtolgcs --headless --sim --config <tmp>`.
   - After 4 s, `/api/v1/status` gave `mode fpv, streaming true, start_path normal, bridge RUN`, RTT 2.41 ms, jitter p99 0.48 ms, loss 0 %.
   - Client flight mode was `ANGL?` with alarms `client_sats_low` and `client_rescue_not_ready`. Both are correct for the sim's GPS fix delay.
   - **Kill test:** I killed the app with TerminateProcess at 22:21:03.070. The simulator logged `no valid rc_up for 252 ms > T_hold: FAILSAFE` and `RUN -> FAILSAFE` at 22:21:03.325. **PASS.**
   - **`--sim --sim-armed`:** comes up `idle`, `start_path null`, bridge UNREACHABLE. The simulator never left WAIT_GCS, so nothing was sent. **PASS.**
   - **`--sim --sim-armed --resume`:** the preview `CH5 arm = 2012 us (ARMED), CH3 throttle = 1500 us` was printed. The simulator stayed in WAIT_GCS until I typed `RESUME`. Then `fpv / resume / RUN`. **PASS.**
   - **Wrong word typed (`resume`, lower case):** cancelled, nothing sent. **PASS.**
2. **`restart_resume.py`.** Same simulator throughout: normal run → kill → FAILSAFE → new process with `--resume` + `RESUME` → RUN with `start_path resume`. **PASS.**
3. **`jitter.py`** (sender thread, real waiter, real UDP socket, 8 s each):

   | Case | Rate | Interval p50/p99/max | Sender's own p99 (worst 1 s window) | Skipped |
   |---|---|---|---|---|
   | HR timer, idle | 249.99 Hz | 4.000 / 4.314 / 5.712 ms | 0.53 ms | 0 |
   | Fallback timeBeginPeriod, idle | 250.00 Hz | 3.999 / 4.110 / 4.865 ms | 0.19 ms | 0 |
   | HR timer + 2 CPU-bound Python threads | **200 Hz** | 5.13 / 8.48 / 10.3 ms | **14.5 ms** | 344 |
   | Fallback + 2 CPU-bound threads | 208 Hz | 5.21 / 8.99 / 10.3 ms | 14.0 ms | 294 |

4. **`load.py` / `load2.py`** (full runtime against the simulator, timings from the session log):
   - 2 SSE clients: p99 0.36–0.51 ms per second, rate 249–250 Hz, 0 skipped. Confirms the report's figures.
   - 5 SSE clients plus ~29 Hz status polling: p99 up to **3.0 ms** and max 8.2 ms. `SEND JITTER HIGH` would fire.
5. **`safety_probe.py`** (sender decisions with a fake clock):
   - Disconnect: the next slot sends nothing; nothing is sent after reconnect.
   - RESUME: preview first, single-use token, expiry, THROTTLE second confirmation, and a refusal when the switch is SAFE.
   - Hung input thread: 24 packets, then stop (≤ 100 ms).
   - **Carrier-only can start from idle with no controller, and via `fpv(suspended or armed) → idle → carrier_only`. It then sends CH5 = 988 µs (DISARM) and CH3 = 988 µs** (F1).
6. **`launch_probe.py`** (a UDP listener stands in for the bridge; no operator input):

   | Command | Result |
   |---|---|
   | `--headless --mode carrier_only` (real mode, **no joystick**) | **695 rc_up in 3 s, CH5 = 988 (disarm), cam ON** |
   | `--headless --mode fpv` without a joystick | refused, nothing sent (correct) |
   | `--headless --sim --bridge 127.0.0.1:5993` (any non-sim address) | **721 rc_up auto-sent from the fake controller** |
   | `--headless` with no mode | nothing sent (correct) |

## Findings

1. **MAJOR — carrier-only start is an unguarded DISARM command.** Code: `sender.py:329-330`, `__main__.py:160-161`, `__main__.py:310-312`, README lines 116-119.
   - **What is wrong:**
     - `idle → carrier_only` is accepted with no check at all. Carrier-only forces the arm channel to 988 µs, which is disarm for the reference client (`aux 0 0 0 1700 2100`).
     - The implementer refuses `fpv → carrier_only` while the arm switch is ARMED or telemetry says ARMED (README: "because carrier-only sends 'disarmed'"). Pressing `i` then `c` bypasses that guard (probe 5).
     - `--mode carrier_only` at launch starts streaming at once, with no controller and no confirmation (probe 6). A shortcut or restart with that flag does **not** "come up idle".
     - After an app crash or restart, or after a stopped FPV stream, the client may be airborne in failsafe or GPS Rescue. The first carrier-only packets bring the ELRS link back with the arm switch at DISARM. That is exactly the mid-air disarm the PM's R4 amendment and C2.1 are written to prevent ("so an app restart never disarms an airborne client").
   - **Expected:**
     - Starting carrier-only must never be a silent one-key or launch-flag action. Require an explicit confirmation that no client is powered or airborne. Refuse it, or require that confirmation, whenever this process has had an FPV stream that was stopped or ended (client state unknown).
     - Treat `--mode carrier_only` at launch the same way (no streaming before confirmation), so a restart always comes up idle.
     - Add tests for the `i → c` bypass and the launch flag.
     - Document the hazard in the README's modes table.

2. **MAJOR — the `--sim` exception is not confined to the simulator.** Code: `__main__.py:262-265`, `:280-286`, `:310`, `:170-181`.
   - **What is wrong:**
     - `--sim` sets the bridge to `127.0.0.1:5770`, but `--bridge` is applied afterwards and overrides it.
     - `--sim --bridge <any address>` therefore auto-starts FPV at launch and streams the **fake controller** to that address (probe 6: 721 packets with no operator action).
     - The `a` / `d` keys then act as a keyboard arm switch and controller for real hardware. The `a` key sets CH5 to 2012 µs, which arms a real client.
     - The auto-start exception itself (normal start through the interlock, only without `--sim-armed`) is fine as long as the target really is the simulator. It is not enforced.
   - **Expected:** with `--sim`, reject `--bridge` (and any non-loopback bridge), or at least disable the auto-start and the `a` / `d` keys unless the bridge is loopback. Add a test.

3. **MINOR — `--resume` confirmation can be piped.** Code: `__main__.py:194`, `:201`, `:306-308`.
   - `echo RESUME | python -m vtolgcs --headless --resume` (README and report §6 show this for `--sim`) works without `--sim` too. A wrapper script can therefore turn every restart into an automatic RESUME.
   - Suggest requiring an interactive console (`sys.stdin.isatty()`) for the typed confirmation outside `--sim`.

4. **MINOR — the timing claim is too strong.** Report R3 / `runtime.py:48-50` says the 0.5 ms GIL switch interval means "other threads cannot delay a packet by 5 ms".
   - With CPU-bound Python threads in the same process I measured 200 Hz, p99 lateness 14 ms and 344 skipped slots per 8 s. With 5 SSE clients plus polling, p99 reached 3 ms.
   - Realistic load is fine (p99 ≈ 0.5 ms).
   - Correct the claim, and add a note for WP08b: keep UI and video work out of this process or off the GIL, or move the RC loop to a native helper as plan §7.2 allows. The `SEND JITTER HIGH` alarm does catch the condition.

5. **MINOR — a dead sender thread is not detected.** Code: `sender.py:539-566`.
   - An exception outside `send_slot` (e.g. in `waiter.wait_until`) ends the thread silently. Silence is safe, but C2 keeps reporting `streaming: true` and `mode: fpv`, with no `rc_stream_stopped`. Only `bridge_no_status` fires.
   - Suggest catching it in `_run` → `fault()`, or a liveness check in the monitor.

6. **MINOR — unused config.** Code: `config.py:66-69`.
   - `sender.t_hold_ms` and `sender.start_packets` are validated but used nowhere. The comment says "Used for checks and display".
   - Either use them (e.g. show them, or check that FAILSAFE arrives about T_hold after a stop) or fix the comment.

7. **MINOR — the interlock can be satisfied by an unmapped channel.** Code: `controller.py:81-90`, `:98-113`, `config.py:333-344`.
   - An arm or throttle channel mapped to `none`, or missing on a device with fewer axes, becomes 1500 µs. That counts as "arm safe", and `validate()` accepts the map (probe 8).
   - The fallback "first device" can pick a non-EdgeTX gamepad.
   - Suggest a validation error when the arm or throttle channel is unmapped, and a warning or alarm when the chosen device is not a preferred name or has fewer axes than mapped (plan §7.3 item 3).

8. **MINOR — the single-instance lock has a bypass.** Code: `__main__.py:71`.
   - The hidden production flag `--instance-name` (for tests) lets two senders run with different mutex names. That defeats "two senders can never fight".
   - Suggest an environment variable or a test-only hook instead.

9. **MINOR — confirmation does not compare values with the preview.** Code: `sender.py:402-413`.
   - `confirm_resume` re-checks only "switch ARMED" and "throttle at minimum". It does not check that the values still match what the pilot confirmed: a throttle that moved from 1500 to 1100 between preview and confirmation is accepted. The values actually sent are printed afterwards.
   - Acceptable, but consider refusing when the throttle moved by more than a small band.

10. **MINOR — malformed `Content-Length`.** Code: `api.py:172`.
    - A malformed `Content-Length` on a non-GET request raises `ValueError`, and the client gets no response instead of a 405. Cosmetic.

**Scope:** every changed file is in the brief's list or justified in report §5.3.

| Extra file | Verdict |
|---|---|
| `gcs/vtolgcs/__init__.py` | docstring only; fine |
| `gcs/pyproject.toml` | optional `controller` extra and `dev` extra with pygame-ce, an allowed dependency; fine |
| `gcs/tests/_c2.py` | shared C2 reference shape, mirroring WP03's `_vectors.py`; fine |

There are no changes to `protocol.py` or `crsf.py`.

**Thresholds:** all defaults are sourced.

| Default | Source |
|---|---|
| Arm safe range ≤ 1699 µs on CH5 | `docs/FPV_betaflight_dump.txt:387` `aux 0 0 0 1700 2100`; CH5 per protocol README :138 |
| Throttle on CH3 | dump :282 `map AETR1234` |
| Throttle low ≤ 1050 µs | dump :527 `min_check = 1050` |
| Client battery 3.50 V/cell | dump :608 `vbat_warning_cell_voltage = 350` |
| Minimum sats 8 | dump :684 `gps_rescue_min_sats = 8` |
| 6 cells | C1 default client pack |
| 300 ms, 70 %, 2 s, 2 ms, 1 s | plan §7.5 / §14.2 / §7.1 |
| Rate 200–250 Hz, T_hold 250 ms, 5 start packets | relay design |

- The RTT thresholds and the status-bit firmware version are `null` / TBD, with a start-up warning.
- App defaults (hysteresis times, 5 s MAVLink stale, 5 s RTT-rise window, 15 s RESUME validity, spin margins) are labelled as app defaults.
- No invented safety values.

**Report honesty:**

- The requirement table and line references match the code.
- Test counts are correct.
- The jitter figures were reproduced under realistic load.
- The GIL claim is overstated (F4).
- The R5 claim "fpv → carrier_only is refused unless the pilot has disarmed" is literally true, but it reads as a protection that two key presses bypass (F1).

## Approval rationale / items that must be fixed

**REJECTED.** Two MAJOR findings must be fixed:

- **F1:** carrier-only must not start, from idle, from a stopped FPV stream, or from the `--mode carrier_only` launch flag, without an explicit "no client airborne" confirmation, so a restart can never disarm an airborne client. Add tests.
- **F2:** `--sim` must be confined to a loopback simulator. Either reject `--bridge` with `--sim`, or disable the auto-start and the `a` / `d` keys for non-loopback bridges. Add a test.

MINOR findings F3–F10 should be fixed or answered in the rework report. F3 (piped RESUME) and F4 (timing claim and WP08b note) are the most relevant. Everything else (fpv interlock, stop on loss, RESUME path, no auto-resume, S-02b, C2/C2.1 conformance, alarms, sourced thresholds, tests, clean merge) is approved as it stands.
