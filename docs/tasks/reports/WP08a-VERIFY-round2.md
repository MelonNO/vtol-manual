# WP08a verification — round 2
VERDICT: APPROVED

Verifier: independent verification agent.

| Item | Value |
|---|---|
| Worktree | `S\wt\WP08a`, branch `wp/08a` |
| HEAD | `67643e1` (rework round 1 on top of `c9029d1`) |
| Main checked against | `65de3be` |
| Contracts | C2 + C2.1 from main |

Round 1 was rejected for F1 (carrier-only was an unguarded DISARM) and F2 (`--sim` was not confined to the simulator). Both are fixed. I re-attacked both and found no way past them. F3–F10 are fixed. No BLOCKER or MAJOR findings remain. Five MINOR observations are listed below.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 Config | PASS | `config.py`; `t_hold_ms` / `start_packets` now used (`runtime.py` `_on_bridge_state` → `failsafe_timing` / `start_timing`); arm/throttle mapping checked in `validate` | Probe: `failsafe_timing` observed 252 ms vs T_hold 250 ms; `start_timing` 5 packets vs expected 5 |
| R2 Controller | PASS | `controller.py` `map_inputs_with_mapping`, `ControllerSnapshot.mapped`; non-preferred device warning | An unmapped or missing arm or throttle input is never "safe" |
| R3 Sender timing | PASS | `sender.py` `_run`; `timing_win.Waiter` (HR timer, now also `timeBeginPeriod(1)`) | See the timing judgement below |
| R4 Interlocks + PM amendment | PASS | `sender.py` `_request_locked`, `prepare_resume` / `confirm_resume` (±50 µs band), `_tick_locked`, `check_alive` / `_mark_dead`; mutex with the CLI bypass removed | See probes |
| R5 Modes | PASS | carrier-only only via `prepare_carrier_only` / `confirm_carrier_only` (`sender.py` `_carrier_only_problems_locked`, `_confirm_co_locked`) | F1 fixed |
| R6 Camera | PASS | unchanged logic; camera ON on confirmed carrier-only, OFF on FPV entry | — |
| R7 Receiver | PASS | unchanged; `telemetry.heard_age_s` added (client frame or link statistics with LQ > 0) | — |
| R8 Alarms | PASS | new `rc_sender_dead` (crit); `send_jitter_high` = any packet > 2 ms late or any skipped slot | README table updated |
| R9 MAVLink read-only | PASS | unchanged; the only `sendto` in the package is still `runtime.py` `transmit` → bridge | S-02b holds |
| R10 API | PASS | SSE cap 4 (5th → 503, observed); status cache 100 ms; malformed Content-Length → 405 | — |
| R11 Session log | PASS | new records `carrier_only_preview`, `failsafe_timing`, `start_timing` (observed in the log), documented in the README | — |
| R12 CLI | PASS | `__main__.py` `sim_usage_error`, `make_sim_controller`, `initial_start`; interactive-only dialogs | F2 / F3 fixed |
| R13 Tests | PASS | 548 tests (+23), including the round-1 bypasses as regression tests | — |

## Contract results

**C2 + C2.1:**

- **Status keys:** my independent reference shape again shows **no missing and no extra keys**. `app.start_path` is `normal`, `resume` or `null`. Alarm items have exactly the four C2 keys.
- **Health:** `{"ok":true,"app":"vtol-gcs","version":"0.1.0"}`.
- **CORS:** reflected for `https://melonno.github.io`, `http://localhost:8080`, `http://127.0.0.1:5500` and `null`; denied for `https://evil.example`, `https://melonno.github.io.evil.com` and `http://localhost.evil.com`.
- **OPTIONS preflight:** 204 with Methods `GET`, Headers `*`, PNA `true`.
- **Other methods:** POST, PUT, DELETE, PATCH and HEAD return 405.
- **Caching:** `no-store` everywhere.
- **SSE:** 7 status events in about 1.2 s.

**C3:** unchanged.

## Tests run

- `S\venv\Scripts\python.exe -m pytest gcs`, **4 runs**: `548 passed` each time, in 36.6–37.1 s. No flakes.
- `git merge-tree --write-tree main wp/08a` against current main `65de3be`: clean (tree `4bb19dc…`).

## Smoke tests and probes

Scripts are in `S\verify\WP08a\`.

### 1. `acceptance.py`

- Ran bridge_sim, then `python -m vtolgcs --headless --sim --config <tmp>`.
- `/status`: `fpv / streaming / start_path normal`, bridge `RUN`, RTT 2.51 ms, jitter p99 0.49 ms, loss 0 %. C2 diff: **none**.
- **Kill test:** killed with TerminateProcess at .870; the simulator logged `RUN -> FAILSAFE` at .121 (**251 ms**). **PASS.**
- **`--sim --sim-armed`:** comes up idle and sends nothing.
- **Piped `--resume`:** now refused ("needs a typed confirmation on an interactive console"); the simulator stayed in WAIT_GCS. **PASS** (F3).
- `%APPDATA%\vtol-gcs` was not touched.

### 2. `safety_probe2.py` (fake clock)

**Carrier-only:**

| Case | Result |
|---|---|
| A. `request_mode(carrier_only)` from idle | refused; nothing sent |
| B. NOCLIENT not given | refused |
| C. Fresh session + NOCLIENT | accepted |
| D. `fpv(armed) → carrier_only` directly | refused |
| E. **Round-1 bypass** `fpv(armed) → idle → c` with NOCLIENT only | refused: "FPV streamed in this session: confirm … LANDED"; **nothing sent** |
| F. Same, with NOCLIENT + LANDED | accepted |
| G. Suspended FPV → c | needs LANDED |
| H. Telemetry heard 29 s ago | preview refused |
| I. Heard 31 s at preview, client appears before confirmation | refused at the confirmation (re-check works) |
| J. Same token reused after a refusal | refused (single use even on refusal) |
| K. Expired after 16 s | refused |
| L. Link statistics with LQ > 0 | count as "heard"; refused |

**RESUME value band:**

| Case | Result |
|---|---|
| M. Throttle +40 µs since preview | accepted |
| N. Throttle +60 µs | refused: "values changed since the preview … show it again" |
| O. Arm −60 µs (still armed) | refused |

**Unmapped inputs:**

| Case | Result |
|---|---|
| P. Normal start, arm unmapped | refused |
| Q. RESUME, arm unmapped | refused |
| R. Throttle input lost mid-stream | the next slot sends nothing (suspended) |
| S. Config with arm mapped to `none` | validation error |
| T. Config with a 4-entry map | validation error |

**Other:**

- **U. Hung input thread:** 24 packets, then stop (≤ 100 ms, unchanged and within R2).
- **V. Real thread, waiter raises after 20 waits:**
  - `check_alive() = False`;
  - `streaming false`, `suspended sender_thread_died`, `thread_dead true`;
  - normal start, RESUME preview and carrier-only preview are all refused.

  **PASS** (F5).

### 3. `launch_probe2.py` (UDP listener as the bridge, no operator input)

| Command | Result |
|---|---|
| `--mode carrier_only` + piped `NOCLIENT` | **0 packets**, "piped … refused" |
| `--mode carrier_only`, no input | 0 packets |
| `--resume` + piped `RESUME` | 0 packets |
| `--sim --bridge 192.168.144.21` | exit 4, 0 packets |
| `--sim --bridge 0.0.0.0` | exit 4, 0 packets |
| `--sim --bridge localhost` | exit 4, 0 packets |
| `--sim --bridge 127.0.0.2:5997` (loopback, allowed) | streams safe channels (CH5 988, CH3 988) |
| `--sim-armed` without `--sim` | exit 4 |
| `--sim --sim-armed --resume` + piped `RESUME` | 0 packets |
| `--instance-name x` | exit 2 "unrecognized arguments" (F8) |
| No mode | 0 packets |

### 4. `runtime_probe2.py` (in-process Runtime against a real bridge_sim; dialogs called with `interactive=True`)

1. **Normal FPV start** → RUN. The fake switch is then armed.
2. **`i → c` with NOCLIENT and LANDED typed:** refused, "client telemetry heard 0 s ago (< 30 s): a client is bound". The 30 s window works end to end.
3. **RESUME dialog** (switch ARMED, throttle at minimum): needed `RESUME` **and** `THROTTLE`, then `fpv / resume / RUN`.
4. **New Runtime ("restart")** with the switch ARMED: comes up idle. Carrier-only then needs only `NOCLIENT` (see m1).
5. **Timing records:** `start_timing` (5 / 5 packets) and `failsafe_timing` (252 ms vs 250) were emitted and logged.

### 5. Timing re-measurement

`load*.py` runs the full runtime and simulator; values come from the session log, 12–13 one-second windows each. `jitter.py` runs the sender thread alone.

| Load | Rate | p99 per window | Worst packet | Skipped | `send_jitter_high` |
|---|---|---|---|---|---|
| No API clients | 248.8–250.1 Hz | 0.37–0.72 ms | 1.78 ms | 0 | never |
| 2 SSE | 248.8–250.1 Hz | 0.35–1.42 ms | 2.53 ms | 0 | raised once (one 2.5 ms packet) |
| 4 SSE (5th got **503**) + ~30 Hz polling | 248.8–250.1 Hz | 0.46–3.19 ms (median ≈ 0.75) | 7.2 ms | 0 | raised / cleared / raised |
| `jitter.py`, sender alone, idle (HR / fallback) | 250 Hz | own p99 0.67 / 0.56 ms | — | 0 | — |
| `jitter.py`, 2 CPU-bound Python threads | ~206 Hz | lateness p99 ~14 ms | — | 215 / 6 s | — |

The CPU-bound case is unchanged and is now documented as a limit.

**Timing judgement: acceptable for WP08a.**

- **The brief is met.** R3 asks for absolute-deadline scheduling, the high-resolution waitable timer with a fallback, and per-packet p50/p99/max. All are in place and measured, and under realistic load (≤ 2 SSE consumers) p99 stays ≤ 1.4 ms at 250 Hz.
- **Single late packets have little effect.** The 4–9 ms late packets under heavy API load reproduce what the implementer reported. They add RC latency only: no slot was skipped, the rate held at 250 Hz, and the lateness is about 30× below T_hold (250 ms). The bridge cannot reach FAILSAFE from them.
- **The plan's escape hatch remains.** Plan §7.2 explicitly accepts Python for the prototype and bench tests, with "move the RC timing loop to a small native helper if jitter measurements demand it".
- **The condition is visible:** the alarm now fires on any packet more than 2 ms late or any skipped slot (plan §7.5).
- **The structural risk is assigned to WP08b.** That risk is CPU-bound Python in the same process. The limit is documented in the README "Timing limits" section and the `runtime.py` docstring, and main now carries the PM's WP08b R0 process-separation requirement.

## Findings

Round-1 findings:

| # | Severity (round 1) | Status | Evidence |
|---|---|---|---|
| F1 | MAJOR | **Fixed** | Probes 2A–L, 3 and 4 |
| F2 | MAJOR | **Fixed** | Probe 3. Non-loopback and `localhost` are refused with exit 4 before start-up; fake controller, keys and auto-start exist only with a loopback bridge |
| F3 | MINOR | Fixed | Both dialogs refuse non-TTY stdin |
| F4 | MINOR | Fixed | Claim corrected; SSE cap, status cache, `timeBeginPeriod`, alarm on max / skipped |
| F5 | MINOR | Fixed | Probe 2V |
| F6 | MINOR | Fixed | `t_hold_ms` / `start_packets` used |
| F7 | MINOR | Fixed | Probe 2P–T |
| F8 | MINOR | Fixed | Flag removed; test-only env var |
| F9 | MINOR | Fixed | Probe 2M–O |
| F10 | MINOR | Fixed | — |

New observations (all MINOR; none blocks approval):

- **m1 — MINOR — carrier-only after an app restart rests on the typed NOCLIENT alone.** Code: `sender.py` `CarrierOnlyPreview.text`, `_carrier_only_problems_locked`.
  - After a restart, `fpv_this_session` is false. The app cannot have heard telemetry, because the bridge only answers a streaming GCS. So only `NOCLIENT` is asked, and the preview says "Client telemetry last heard: **never**", which reads like evidence of no client.
  - Probe 4 showed this even with the connected controller's arm switch **ARMED**, which is a strong hint that the pilot thinks a client is armed.
  - The typed statement "NO client drone is powered or bound" is the explicit confirmation round 1 asked for, so this is not MAJOR.
  - Recommended:
    - word it "unknown — nothing heard since app start (no stream yet)";
    - refuse, or require `LANDED`, when a connected controller's arm switch is outside the safe range;
    - WP08b's UI should keep this wording.
- **m2 — MINOR — the sharper alarm can be noisy.** `send_jitter_high` fires on a single packet more than 2 ms late. With 2 SSE clients it was raised once in 12 s. It is warn-level with a 2 s clear, but may cause alarm fatigue. Review the threshold after field measurement (relay-design tests).
- **m3 — MINOR (documented limit) — CPU-bound threads cost rate.** CPU-bound Python threads in the process still cut the rate to about 206 Hz and skip slots. It is now alarmed (skipped slots) and documented; WP08b R0 must keep heavy work out of the process.
- **m4 — MINOR — config key rename.** The rename `alarms.jitter_p99_max_ms` → `send_late_max_ms` makes an older config file fail validation (clear message, exit 2), with no migration. Acceptable before the first release; mention it in the WP08b release notes if any config files are already in use.
- **m5 — MINOR — test-only lock bypass remains.** `VTOLGCS_TEST_INSTANCE_NAME` still lets two senders run. It is test-only and documented "never operationally". Acceptable.

**Scope:** the rework touches only files in the brief's list plus the already-justified extras (`tests/_c2.py` untouched). No `protocol.py` or `crsf.py` changes.

**Report honesty:** the "Rework round 1" claims match the code and my probes. That includes the timing table: I reproduced the 4–9 ms worst-case packets under capped API load and the ≈ 1 ms p99 under normal load.

## Approval rationale

**APPROVED.**

- **Findings:** zero BLOCKER and zero MAJOR findings. Every MUST requirement (R1–R13 and the PM's R4 amendment) passes.
- **C2 + C2.1:** conformance verified against a live instance.
- **Tests:** 548 pass on 4 consecutive runs.
- **Acceptance run:** reproduced, ending in FAILSAFE 251 ms after the kill.
- **Merge:** clean into current main.

MINOR m1–m5 may remain. m1 (restart wording and arm-switch hint for carrier-only) is recommended for WP08b's UI or a follow-up.
