# Test results — relay, links and failsafes

**Template — no test has been run yet.** Fill in one row per run; never overwrite an earlier result (add a row with
the new date). Every measured value here is the source the manual, the checklists, the map and the GCS app thresholds
may later quote — until then they show **TBD**.

For every run record: date, who, carrier and relay hardware revision, **G0 / N6 firmware version** (`fw_ver` from the
bridge status), GCS app version, ELRS TX module and band/packet rate, client profile, and where the raw data is
(GCS app session log `session-*.jsonl`, test-tool CSV export, video file, `.bin` log). The GCS app's **Tests** tab
records most of these (`gcs/README.md`, "Test tools"); `tools/latency-clock.html` is the stopwatch page for test 2.

Sources: relay design ("Bring-up and test plan", "Risks"), plan §4 (S-01a, S-02, S-02c), §12 (Q2, Q13, Q15), §7.8.

## 1. Relay-design system tests (acceptance)

| # | Test | Pass criterion (relay design) | Date | FW G0 / N6 | Result (measured) | Pass? | By | Data |
|---|---|---|---|---|---|---|---|---|
| 1 | Video device latency: scope on decoder VSYNC and the latency-marker GPIO | Last packet ≤ 3 ms after the last active line | | | TBD | | | |
| 2 | Glass-to-glass video: stopwatch (`tools/latency-clock.html`) filmed at 240 fps with the GCS screen, 20 samples | Record mean and worst case (see §6) | | | TBD | | | |
| 3 | Encoder stability, 30 minutes clean signal | Zero FUSE_ERROR, zero missing fields | | | TBD | | | |
| 4 | Noise bench: VTX → step attenuator → VRX, down to full snow; both decoders | No stall or freeze; recovery ≤ 100 ms after signal returns | | | TBD | | | |
| 5 | Independence: N6 held in reset, reflashed, video domain power-cycled, P3 flooded with broadcast traffic | Zero dropped CRSF frames | | | TBD | | | |
| 6 | Failsafe: kill the GCS app, unplug the HM30, reset the G0 | Client reaches its failsafe; time recorded for each case (see §5) | | | TBD | | | |
| 7 | Co-site RF: VRX picture and RSSI with HM30, TX module and Ethernet at full power | No visible degradation; note the cleanest analog channel | | | TBD — cleanest channel: | | | |
| 8 | Power and thermal: 30 minutes in a closed box | Total under the aircraft budget; MCU case below 85 °C | | | TBD — consumption W, max °C: | | | |
| 9 | Camera on/off: camera streaming at its cap, toggle `CAM_ENABLE` from the GCS, repeat test 1 with the camera on | FPV latency unchanged with the camera on; camera traffic on P1 stops within one RC packet of switching off | | | TBD | | | |

Also from bring-up (net/RC board checklist): VBAT_TX output voltage (must be inside the fitted module's input range;
Nomad XT30 6–16.8 V) and **peak current** at the module's highest power: **TBD — measure**.

## 2. S-01a — QHOVER when the 915 MHz link drops in a manual phase (plan §4, Q15)

Bench (props **off**) or SITL: QHOVER, armed; switch the Nomad off; record what Mission Planner shows (mode,
throttle and attitude targets) for at least 30 s. Expected from the parameters (plan §15.2, `THR_FAILSAFE` = 2): no
failsafe action, RC input ignored, the aircraft holds with centred sticks and drifts with the wind — **to be
confirmed**. The manual carries a VERIFY marker until this row is filled.

| Date | Bench / SITL (version) | Mode after loss | Throttle / attitude targets | Drift observed | Pilot action confirmed | By | Data |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 3. S-02 / S-02c — GCS (SIYI) failsafe

**S-02, Q-mode case (SITL):** with `FS_GCS_ENABL` = 2, `Q_OPTIONS` = 426016 (bit 5) and `Q_RTL_MODE` = 2, a GCS loss in
a VTOL mode should give **QRTL** and in a fixed-wing mode **RTL** with an automatic VTOL landing at home (plan §15.2).
Confirm in SITL; the content carries a VERIFY marker until then.

| Date | SITL version | Mode at loss | Result after `FS_LONG_TIMEOUT` (5 s) | Landing | By | Data |
|---|---|---|---|---|---|---|
| | | QHOVER | TBD | | | |
| | | FBWB | TBD | | | |
| | | AUTO | TBD | | | |

**S-02c / Q2 — does the HM30 send MAVLink `RADIO_STATUS`?** Mission Planner → Ctrl+F → MAVLink Inspector, with the
HM30 link up. If it does, `FS_GCS_ENABL` = 2 also fails safe on `remrssi` = 0; if not, it behaves like 1 (heartbeat
only). Either is consistent with the design intent.

| Date | HM30 firmware | `RADIO_STATUS` seen? | `remrssi` values | By |
|---|---|---|---|---|
| | | TBD | | |

## 4. HM30 capacity and latency (Q13)

UDP echo / RTT with the GCS app's **RTT test**, then a throughput ceiling. The result sets the N6 encoder bitrate
(CBR), the **P3 ingress rate limit** of the camera, the bandwidth-budget diagram D8, and the app's RTT alarm
thresholds (`alarms.rtt_max_ms` and `alarms.rtt_rise_ms`, today TBD and inactive).

| Date | Condition | RTT min / mean / p99 / max (ms) | Uplink loss % | Throughput ceiling (Mbit/s) | By | Data |
|---|---|---|---|---|---|---|
| | Video off, camera off | | | | | |
| | Video at full bitrate | | | | | |
| | Video + camera at its cap | | | | | |

Derived values (fill in after the rows above):

| Value | Result | Used in |
|---|---|---|
| N6 constant bitrate | TBD | N6 flash setting, D8 |
| P3 ingress limit (camera cap) | TBD | KSZ8795 setting, network table, D8/D8b |
| RTT alarm threshold `rtt_max_ms` | TBD | `config.json` → `alarms` |
| RTT-rise threshold `rtt_rise_ms` (camera on) | TBD | `config.json` → `alarms` |

## 5. Failsafe times per cause

Time from the cause to the client's failsafe (its OSD or telemetry `!FS!`), and to the bridge's FAILSAFE. Use the GCS
app's **Failsafe timer** (Tests tab); the session log's `failsafe_timing` record gives the stop → bridge FAILSAFE time
next to `t_hold_ms` (250 ms). Expected total = T_hold (250 ms) + the ELRS TX module's reaction to a silent handset +
the client receiver's failsafe timeout (relay design) — **measure**.

| Date | Cause | Bridge FAILSAFE after (ms) | Client failsafe after (ms) | Client behaviour (e.g. GPS Rescue) | FW G0 | Module / packet rate | By |
|---|---|---|---|---|---|---|---|
| | GCS app stopped / killed | | | | | | |
| | HM30 unplugged | | | | | | |
| | G0 reset | | | | | | |
| | FPV controller unplugged (app suspends the stream) | | | | | | |

Carrier (for comparison, from the parameters): SIYI / GCS loss → RTL (fixed-wing modes) or QRTL (VTOL modes) after
`FS_LONG_TIMEOUT` = 5 s; 915 MHz loss → no action.

| Date | Cause | Carrier reaction | Time (s) | By |
|---|---|---|---|---|
| | Mission Planner closed (heartbeat lost) | TBD | | |
| | HM30 ground unit unplugged | TBD | | |

## 6. Glass-to-glass latency

Relay-design test 2 in detail: 20 samples per configuration.

| Date | Standard (PAL/NTSC) | Viewer (standalone 5601 / MP HUD 5602) | Decoder (`avdec_h264` / `d3d11h264dec`) | Mean (ms) | Worst (ms) | Samples | By |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 7. GCS laptop timing (RC sender)

The app logs a `sender` record every second (rate, jitter p50/p99/max, skipped slots). Record one flight-like session
on the target laptop, with the UI attached.

| Date | Laptop / power plan | Rate (Hz) | Jitter p99 (ms) | Max (ms) | Skipped slots | `SEND JITTER HIGH` alarms | By |
|---|---|---|---|---|---|---|---|
| | | | | | | | |
