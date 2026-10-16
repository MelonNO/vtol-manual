# WP08a — GCS companion app: runtime (headless core)

- **Worktree:** `S\wt\WP08a`
- **Branch:** `wp/08a`
- **Wave:** 2
- **Starts after:** WP03 is merged

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (you **own C2**; you consume C3), `protocol/README.md`, the WP03 report, plan §7.1–7.3, §7.5, §7.6, §7.8, §4 (S-02b), §14.2, and the relay design "Ground station software".

## Goal

A robust, testable, **headless** core of the Windows GCS companion app:
- controller input
- the RC sender with precise timing and safety interlocks
- camera control
- the status/telemetry receiver
- alarms
- the read-only carrier position input
- the local API (C2)
- session logging

WP08b adds the UI, video, MP output and packaging on top. **This is a flight-safety path.** Prefer simple, explicit, well-tested code.

## Files you own

- `gcs/vtolgcs/` — new modules: `config.py`, `controller.py`, `sender.py`, `timing_win.py`, `receiver.py`, `telemetry.py`, `alarms.py`, `api.py`, `mavlink_ro.py`, `session_log.py`, `runtime.py`, `__main__.py`. Do not change WP03's `protocol.py`/`crsf.py` APIs; additive helpers are OK and must be reported.
- `gcs/tests/test_*.py` (new)
- `gcs/README.md` (runtime part)
- `docs/tasks/reports/WP08a-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Config:** JSON in `%APPDATA%\vtol-gcs\config.json`, created with defaults. Covers: bridge IP/port (default `192.168.144.21:5770`, marked "proposed, Q3"), rate (200–250 Hz, default 250), T_hold expectations, API port 47800, alarm thresholds, channel map, arm channel and safe range, throttle channel and low threshold, camera default, MAVLink mirror listen port (default 14551). Validated on load with clear errors. |
| R2 | MUST | **Controller** (pygame-ce joystick): enumerate devices, prefer names containing "RadioMaster"/"EdgeTX"/"Joystick", map up to 16 channels from axes/buttons per config (EdgeTX Classic: axes → CH1–8, buttons → CH9+), convert to µs and CRSF values (C3 scaling), and detect disconnects within ≤ 100 ms. Abstract it behind an interface so tests use a fake controller. |
| R3 | MUST | **Sender** (own thread): absolute-deadline scheduling (`next += period`) using a Windows high-resolution waitable timer via `ctypes` (`CreateWaitableTimerExW` with `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`), falling back to `timeBeginPeriod(1)` + a short spin. Builds `rc_up` via `vtolgcs.protocol`, with a monotonic `seq` and `t_gcs_us`. Records per-packet send jitter (p50/p99/max). |
| R4 | MUST | **Interlocks** (§7.3):<br>- streaming starts only if the arm channel is in the safe range **and** throttle is low<br>- on controller disconnect, **stop sending immediately** (never repeat last values) and raise an alarm<br>- single-instance lock (named mutex or lock file)<br>- prevent system sleep while streaming (`SetThreadExecutionState(ES_CONTINUOUS \| ES_SYSTEM_REQUIRED)`), and warn when the laptop is on battery or battery saver (`GetSystemPowerStatus`)<br>- the stream is not affected by window focus (thread is independent of any UI) |
| R5 | MUST | **Modes:** `idle`, `fpv` (normal streaming), `carrier_only` (streams with the arm channel forced to the safe value and all sticks centred/throttle low, so the camera can be enabled without a client; plan §3.4-3 interim). The current mode is visible in C2. |
| R6 | MUST | **Camera:** requested state → `flags` bit0; reported state from `status` read-back; an alarm if they differ for > 1 s; default off; optional interlock "refuse camera ON while client armed" (config). |
| R7 | MUST | **Receiver:** a UDP socket bound to the same local port the sender uses (the bridge replies to the source). Parse `status` and `crsf_fwd` (C3). Compute RTT from `t_gcs_us_echo`, uplink loss from seq/counters, status age. Feed CRSF frames to the `telemetry` module (link, GPS, battery, attitude, flight mode via WP03 decoders), producing the C2 `client` object. |
| R8 | MUST | **Alarms:** an engine with raise/clear, severity, `since` time, and hysteresis. Rules from plan §7.5 and §14.2: no status > 300 ms; bridge ≠ RUN while streaming; RTT > threshold; LQ < 70 %; client battery per-cell < threshold; sats < minSats; telemetry stale > 2 s; controller disconnected; jitter p99 > 2 ms; camera mismatch; RTT rising after camera on; client `!FS!` (FPV FAILSAFE); `RTH`; `rescue_not_ready` while disarmed. Ids and texts are documented in `gcs/README.md` (WP06 uses them in the Pre-Arm reference). |
| R9 | MUST | **Read-only carrier position** (`mavlink_ro.py`): listen on UDP (config port, default 14551) for a Mission Planner "MAVLink Mirror" stream, and parse MAVLink v1/v2 `HEARTBEAT` (autopilot only) and `GLOBAL_POSITION_INT` for `carrier` in C2. **The socket must never send** (enforce it in code, and test that no `sendto` happens). Document the MP mirror setup with "write access" **off**. This satisfies S-02b: the app never emits carrier-bound MAVLink. |
| R10 | MUST | **Local API** exactly per C2: `ThreadingHTTPServer` on 127.0.0.1:47800; `/api/v1/health`, `/api/v1/status`, `/api/v1/events` (SSE at 5 Hz + alarm events); CORS reflection for the allowed origins only; OPTIONS with `Access-Control-Allow-Private-Network: true`; `no-store`; read-only (every other method → 405). |
| R11 | MUST | **Session log:** JSONL in `%APPDATA%\vtol-gcs\logs\session-<UTC>.jsonl`. Records: status samples (5 Hz), telemetry, alarms, mode/camera changes, and per-second sender stats. The record schema is documented in `gcs/README.md` (WP11 builds a viewer for it). |
| R12 | MUST | `python -m vtolgcs --headless [--sim]` runs the runtime with a console status line. `--sim` uses a fake controller and expects `gcs/tools/bridge_sim.py` on localhost. |
| R13 | MUST | **Tests** (pytest; no flaky timing — inject clocks where possible):<br>- end-to-end against `bridge_sim` on localhost: WAIT_GCS→RUN, RTT computed, telemetry decoded into C2, camera read-back, failsafe when sending stops, controller-disconnect stop-sending<br>- interlock refusal<br>- alarm rules<br>- API: shape matches C2 keys exactly, CORS/PNA headers, 405 on POST<br>- MAVLink read-only: decodes a synthetic GLOBAL_POSITION_INT; no send<br>- config validation |

## Acceptance (verifier)

- `pytest gcs` passes.
- The verifier runs the simulator plus `python -m vtolgcs --headless --sim`, curls `/api/v1/status` and checks it against C2, kills the app, and observes the simulator reach FAILSAFE.
- Code review of the sender/interlock paths for safety.
