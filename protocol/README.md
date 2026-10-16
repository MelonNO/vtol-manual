# Relay UDP protocol v1 (GCS ↔ RC bridge)

> ## ⚠ PROPOSAL v1 — agree with G0 firmware before flight
>
> This document fixes byte order, message layouts and behaviour that the relay design leaves open. It is a **proposal**. Nothing here is flight-qualified until the G0 bridge firmware implements it, passes `test-vectors.json`, and the bench tests in the relay design ("Bring-up and test plan") pass. Items marked **PROPOSAL** are new in this document; items marked **DESIGN** restate the relay design.

| | |
|---|---|
| Contract | C3 in `docs/tasks/02-CONTRACTS.md` (owner WP03) |
| Reference implementation | `gcs/vtolgcs/protocol.py`, `gcs/vtolgcs/crsf.py` (Python 3.12, standard library only) |
| Byte-exact examples | `protocol/test-vectors.json` (regenerate with `python gcs/tools/gen_test_vectors.py`) |
| Simulator | `gcs/tools/bridge_sim.py` (behaves as this document describes) |
| Tests | `python -m pytest gcs` |
| Self-test | `cd gcs && python -m vtolgcs.protocol --selftest` |

## 1. Participants, ports and addresses

| Endpoint | Listens on | Sends to |
|---|---|---|
| G0 bridge (W5500, RC socket) | UDP **5770** (DESIGN) | `status` and `crsf_fwd` → the **source IP:port of the latest valid `rc_up`** (PROPOSAL) |
| GCS app | any local port; it sends `rc_up` from the same socket it receives on | `rc_up` (and later `crsf_pass`) → bridge IP:5770 |
| N6 video board | — | RTP/H.264 → GCS **5600** (DESIGN) |
| GCS app (video fan-out) | 5600 | `127.0.0.1:5601` (standalone viewer), `127.0.0.1:5602` (Mission Planner HUD) (plan §7.4 option c) |

- IP addresses are in the HM30 subnet `192.168.144.x`. The bridge IP is <span class="warn-val">TBD — assign when the bridge firmware is configured (plan §3.3)</span>.
- The bridge accepts `rc_up` only from the configured GCS source (DESIGN: "accept only matching … source IP"). Which address or subnet is configured is <span class="warn-val">TBD — firmware configuration</span>. The simulator uses `--allow-src` (default `127.0.0.0/8`).
- Replies always go to the source of the **latest valid** `rc_up`, so a restarted GCS app on a new ephemeral port gets status again after its first valid packet. Before any valid packet has arrived the bridge sends nothing.
- Never expose port 5770 outside the HM30 subnet. Over LTE, use it only inside WireGuard (DESIGN).

## 2. Encoding rules

- **Byte order: little-endian** for every multi-byte field. Messages are packed, with no padding.
- **Exception:** the 22-byte `ch` field holds 16 × 11-bit CRSF channels, packed **LSB first**. This is identical to the payload of the CRSF `RC_CHANNELS_PACKED` (0x16) frame, so the G0 copies it straight into the CRSF frame.
- Raw CRSF frames inside `crsf_fwd` and `crsf_pass` keep CRSF's own byte order (big-endian fields).

### 2.1 CRCs

| CRC | Definition | Coverage | Check value |
|---|---|---|---|
| **CRC-16/CCITT-FALSE** (UDP messages) | poly `0x1021`, init `0xFFFF`, no input/output reflection, xorout `0x0000` | every byte before the `crc16` field | `"123456789"` → **`0x29B1`**; empty input → `0xFFFF` |
| **CRSF CRC-8** | poly `0xD5`, init `0x00`, no reflection, xorout `0x00` (= CRC-8/DVB-S2) | CRSF `type` + payload (not the sync/address byte and not `len`) | `"123456789"` → **`0xBC`** |
| CRSF command inner CRC-8 | poly `0xBA`, init `0x00`, no reflection | 0x32 command: `type` … last payload byte | `"123456789"` → `0x20` (computed; not a catalogued CRC) |

`crc16` is stored **little-endian** like every other field. For example, `rc_up` with all channels centred, `seq = 1`, `t_gcs_us = 0`, `flags = 0` ends in `91 9B` (CRC `0x9B91`).

## 3. Messages

`ver` = **1** for every message in this document. Offsets are in bytes.

### 3.1 `rc_up` — GCS → bridge, 36 bytes, every 4–5 ms (200–250 Hz, DESIGN)

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | `u8[2]` | magic | `'R','C'` = `52 43` |
| 2 | `u8` | `ver` | 1 |
| 3 | `u8` | `flags` | bit 0 `CAM_ENABLE` (DESIGN). Bits 1–7 are reserved: send 0, and receivers ignore them |
| 4 | `u32` | `seq` | monotonic; +1 per packet; wraps at 2³² |
| 8 | `u32` | `t_gcs_us` | GCS clock in µs (wrapping); the bridge echoes it in `status` |
| 12 | `u8[22]` | `ch` | 16 × 11 bit, CRSF packing (§4) |
| 34 | `u16` | `crc16` | over bytes 0…33 |

C view (matches the relay design's struct, now with the byte order fixed):

```c
struct __attribute__((packed)) rc_up {      /* all fields little-endian */
  uint8_t  magic[2];   /* 'R','C' */
  uint8_t  ver;        /* 1 */
  uint8_t  flags;      /* bit0 CAM_ENABLE, bits1..7 = 0 */
  uint32_t seq;
  uint32_t t_gcs_us;
  uint8_t  ch[22];     /* CRSF 16 x 11 bit, LSB first */
  uint16_t crc16;      /* CRC-16/CCITT-FALSE over bytes 0..33 */
};
```

### 3.2 `status` — bridge → GCS, 42 bytes, 10 Hz plus one per state change

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | `u8[2]` | magic | `'R','S'` = `52 53` |
| 2 | `u8` | `ver` | 1 |
| 3 | `u8` | `state` | 0 BOOT, 1 WAIT_GCS, 2 START, 3 RUN, 4 FAILSAFE (§5). Other values are invalid in v1 |
| 4 | `u8` | `flags` | bit 0 `camera_on_readback` · bit 1 `timing_locked` · bit 2 `p2_link_100fd` · bit 3 `decoder_lock`\* · bit 4 `std_ntsc`\* · bits 5–7 reserved (0, ignored) |
| 5 | `u8` | reserved | 0 |
| 6 | `u16` | `fw_ver` | PROPOSAL: `(major << 8) \| minor` |
| 8 | `u32` | `seq` | status sequence number, +1 per status |
| 12 | `u32` | `t_gcs_us_echo` | `t_gcs_us` of the latest valid `rc_up` (0 before the first) |
| 16 | `u32` | `rx_ok` | valid `rc_up` accepted |
| 20 | `u32` | `rx_bad_crc` | `rc_up` rejected by the format checks: length, magic, version **or** CRC (§6) |
| 24 | `u32` | `rx_bad_seq` | `rc_up` rejected because `seq` did not increase |
| 28 | `u32` | `crsf_tx` | CRSF frames sent to the TX module (RC + ModelID + passthrough) |
| 32 | `i32` | `sync_period_x10us` | ELRS packet period in **0.1 µs** units (µs × 10), from the 0x3A timing frame; 0 = no timing frame yet |
| 36 | `i32` | `sync_offset_x10us` | current timing offset in 0.1 µs, signed |
| 40 | `u16` | `crc16` | over bytes 0…39 |

\* Bits 3 and 4 need the N6 to report through the bridge. This is a future firmware request. **Consumers treat them as unknown** unless `fw_ver` ≥ <span class="warn-val">TBD — firmware version that first reports N6 decoder lock / standard</span>.

**RTT.** `rtt = (t_gcs_now_us − t_gcs_us_echo) mod 2³²`. The echoed value belongs to the newest `rc_up` the bridge had accepted when it built the status. The estimate therefore includes up to one RC send period (4–5 ms) of waiting time.

**Units check.** The ELRS module sends the timing period as `RequestedRCpacketInterval * 10` (ExpressLRS `CRSFHandset.cpp`). So at 250 Hz `sync_period_x10us` = 40000 and at 200 Hz it is 50000, which matches the relay design's "check: at 200 Hz the rate should read about 50000".

### 3.3 `crsf_fwd` — bridge → GCS, 6 + len bytes

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0 | `u8[2]` | magic | `'R','F'` |
| 2 | `u8` | `ver` | 1 |
| 3 | `u8` | `len` | 4 … 64: length of the raw CRSF frame |
| 4 | `u8[len]` | frame | one complete CRSF frame as received from the module: sync/address … CRC-8 |
| 4+len | `u16` | `crc16` | over bytes 0 … 3+len |

- One CRSF frame per datagram. The bridge forwards only frames whose CRSF CRC-8 is valid. The frame's own length byte must equal `len − 2`, and receivers reject the datagram otherwise.
- **Which frames are forwarded (PROPOSAL, refines the relay design):** every valid frame from the module **except the 0x3A timing frames** (sub-type 0x10). The G0 consumes those itself and reports them through `sync_*`.
  - This deliberately includes extended frames addressed to the handset (0xEA), such as 0x29 device info, 0x2B parameter entries and 0x2E ELRS status. The GCS needs them for the ELRS parameter menu (plan §7.7), which the relay design's "handle frames addressed to 0xEA" would otherwise swallow.

### 3.4 `crsf_pass` — GCS → bridge, 6 + len bytes (Q7a, **future firmware feature**)

The layout is the same as `crsf_fwd`, with magic `'R','P'`. The bridge sends the enclosed frame to the TX module **in a free slot between RC frames, without breaking the timing lock** (plan §7.7).

- The bridge should accept it only from the current GCS, i.e. the source of the latest valid `rc_up`.
- Until the firmware implements it, the bridge ignores `crsf_pass`. The simulator only answers it with `--crsf-pass`.

## 4. Channels

- 16 channels, 11 bits each. Channel 1 sits in bits 0–10 of the little-endian 176-bit field, channel 2 in bits 11–21, and so on. This is the same as Betaflight `crsfPayloadRcChannelsPacked_s` and EdgeTX `createCrossfireChannelsFrame`.
- Scaling (DESIGN, ELRS `crsf_protocol.h`): **172 = 988 µs, 992 = 1500 µs, 1811 = 2012 µs.**
- Conversion from µs (contract C3): `crsf = round((us − 1500) × 1.6 + 992)`, clamped to 172 … 1811.
  - The 1.6 slope is the one EdgeTX uses (`992 + pulses × 4/5`).
  - With it, 988 µs gives **173**. The nominal 172 is reached at 987.5 µs. The 1-count difference (≈ 0.6 µs) is far below stick resolution.
  - The GCS should send 172 / 1811 directly for "full low/high" switch positions.
- `pack_channels` rejects values outside 172 … 1811. A receiver unpacks the raw 11-bit values 0 … 2047 without judging them.
- With the 24-byte RC frame (`EE 18 16 …`, no ELRS status byte) ExpressLRS takes the **arm state from CH5** (`TXModuleEndpoint.cpp`). The client's arm switch must therefore be on CH5.

## 5. Bridge state machine (DESIGN + PROPOSAL details)

```
            peripherals + W5500 up
   BOOT ───────────────────────────► WAIT_GCS ◄─────────────────────┐
                                        │ 5 consecutive valid rc_up │ immediately
                                        ▼                           │
                                      START ── ModelID ×3 ──► RUN ──┴─► FAILSAFE
                                                              no valid rc_up for T_hold
```

| State | Sends CRSF | Leaves when |
|---|---|---|
| BOOT | no | peripherals and W5500 up → WAIT_GCS. `rc_up` received in BOOT is ignored |
| WAIT_GCS | no | `start_packets` = **5** consecutive valid `rc_up` → START |
| START | ModelID ×3, one per CRSF slot | 3 sent → RUN |
| RUN | one RC frame per CRSF slot (TIM2 tick), built from the latest valid `rc_up` | no valid `rc_up` for **T_hold** → FAILSAFE |
| FAILSAFE | no (silent) | immediately → WAIT_GCS |

- **T_hold** starts at **250 ms** (DESIGN) and must be measured as part of the total time to client failsafe (relay design test 6). The simulator's `--t-hold-ms` sets it.
- **"Consecutive" (PROPOSAL).** The run of valid packets counted in WAIT_GCS restarts at 0 when:
  - a packet is rejected (format or seq), or
  - more than T_hold passes between valid packets.
- **ModelID frame (DESIGN, confirmed against EdgeTX `createCrossfireModelIDFrame`):** `EE 08 32 EE EA 10 05 <id> <crc8_BA> <crc8_D5>`.
  - The model ID comes from the client profile (`elrs.modelId`). While it is unknown it is <span class="warn-val">TBD — per client profile</span>; the simulator uses `--model-id` (default 0).
  - EdgeTX starts this frame with `0xC8` instead of `0xEE`. ELRS accepts either (`CRSFHandset::alignBufferToSync`).
- **Extra status per state change (PROPOSAL).** Besides the 10 Hz cadence, the bridge sends one `status` immediately on every state it enters, including the instantaneous FAILSAFE. This gives the GCS a timestamp for each transition, which the failsafe-timing test needs.

### 5.1 Sequence rule

A valid packet needs `(int32_t)(seq − last_seq) > 0` (DESIGN). Gaps are allowed (UDP loss).

**Re-baseline (PROPOSAL).** In WAIT_GCS, while the consecutive count is 0, the next packet that passes the format checks is accepted whatever its `seq`, and it becomes the new baseline.
- Without this, a restarted GCS app (seq starting again at 0) would be rejected for up to 2³¹ packets.
- The rule cannot resurrect an old stream in RUN, because it applies only in WAIT_GCS. The 5-packet rule still applies after the re-baseline.

## 6. Validation order, counting and versioning

**The bridge validates every `rc_up` in this order:**
1. Source IP. Rejects are not counted in v1 status; the bridge logs them.
2. Length ≥ 3.
3. Magic.
4. `ver`.
5. Exact length (36).
6. CRC-16.
7. `seq`.

Failures in steps 2–6 increment **`rx_bad_crc`**, which in v1 means "rejected by format checks". Step 7 increments `rx_bad_seq`.

**The GCS validates `status` / `crsf_fwd`** the same way and keeps its own counters, at least `bad_magic`, `bad_ver`, `bad_len` and `bad_crc`.

**Versioning:**
- `ver` is checked **before** the length, because another version may have another size.
- A receiver that gets `ver ≠ 1` **ignores the message and counts it** (bridge: `rx_bad_crc`; GCS: `bad_ver`). It must never try to interpret it.
- Any change to a layout or to the meaning of a field increments `ver`.
- Reserved bits and bytes are sent as 0 and ignored on receipt. A later version may define them only together with a `ver` increment or a documented `fw_ver` threshold.
- New message types get a new magic. Unknown magics are ignored and counted.
- The GCS logs `fw_ver` and shows it in its status UI.

In the Python reference code, every failure raises a specific subclass of `ProtocolError`: `LengthError`, `MagicError`, `VersionError`, `CrcError` or `FieldError`.

## 7. Carrier camera (P3) — `CAM_ENABLE`

**Common to both policies (DESIGN):**
- The G0 applies a change **within one packet**.
- The camera stays powered.
- The G0 writes the switch register, **reads it back**, and reports the read-back value in `status.flags` bit 0. The GCS shows that value, not the commanded one.
- The KSZ8795 register names for this are <span class="warn-val">TBD — confirm in the KSZ8795 register map (relay design)</span>.

### 7.1 Policy A — relay design (default)

| Bridge situation | Camera |
|---|---|
| Power-up / BOOT / WAIT_GCS | **OFF** |
| START / RUN | follows `CAM_ENABLE` of the latest valid `rc_up` |
| Stream lost (FAILSAFE and after) | **OFF** |

### 7.2 Policy B — "camera ON until a client stream starts" (plan §3.4-3, **PROPOSAL / firmware request, owner decision Q12**)

| Bridge situation | Camera (P3) |
|---|---|
| No valid GCS RC stream since boot (carrier-only flight, no client connected) | **ON** (at its P3 ingress cap) |
| RC stream running (START / RUN) | follows `CAM_ENABLE` (app default: off while the client is armed) |
| RC stream lost after having run (client in failsafe) | **OFF**, to protect the client's video during its RTH |
| New stream after loss | follows `CAM_ENABLE` again |

- "Stream since boot" means START has been entered at least once since power-up.
- Without this firmware change, the alternative is an app "carrier-only mode" that streams RC with the arm channel forced to disarmed and `CAM_ENABLE = 1` (plan §3.4-3). The plan recommends the firmware change.
- Which policy flies is <span class="warn-val">TBD — agree with the G0 firmware</span>. The simulator implements both: `--camera-policy design|client-gated`.

The GCS raises an alarm if the requested and reported states differ for more than 1 s (plan §7.1). The simulator's `--cam-fault stuck-on|stuck-off` exercises this.

## 8. CRSF details used by the bridge and the GCS

The authoritative layouts, with sources, are in the docstrings of `gcs/vtolgcs/crsf.py`. In summary:

| Frame | Layout (big-endian fields) | Primary source |
|---|---|---|
| any | `<sync/addr> <len> <type> <payload> <crc8>`; `len` = payload + 2; sync `0xC8`, `0xEA` or `0xEE` | Betaflight `telemetry/crsf.c` header comment; ELRS `crsf_protocol.h` |
| extended (0x28–0x96) | payload starts with `<dest> <origin>` | ELRS `crsf_ext_header_t` |
| 0x16 RC | 22 B channels (+ optional ELRS status byte) | ELRS `TXModuleEndpoint.cpp`; EdgeTX `crossfire.cpp` |
| 0x14 link stats | u8 RSSI1 (−dBm), u8 RSSI2 (−dBm), u8 LQ %, i8 SNR, u8 antenna, u8 RF mode, u8 TX-power enum, u8 DL RSSI (−dBm), u8 DL LQ, i8 DL SNR [, u8 DL RSSI2] | ELRS `crsfPayloadLinkstatistics_s`; Betaflight `rx/crsf.c` |
| 0x02 GPS | i32 lat ×1e7, i32 lon ×1e7, u16 km/h ×10, u16 deg ×100, u16 m + 1000, u8 sats | Betaflight `crsfFrameGps` |
| 0x08 battery | u16 0.1 V, u16 0.1 A, u24 mAh, u8 % | Betaflight `crsfFrameBatterySensor` |
| 0x1E attitude | i16 pitch, roll, yaw in rad ×10000 | Betaflight `crsfFrameAttitude` |
| 0x21 flight mode | NUL-terminated string; suffix `*` / `!` / `?` while disarmed and not in failsafe | Betaflight `crsfFrameFlightMode` |
| 0x07 vario | i16 cm/s | Betaflight `crsfFrameVarioSensor` |
| 0x09 baro altitude | u16 altitude (MSB 0: dm + 10000; MSB 1: m), then **i8 log-packed** vertical speed (Betaflight, 3 B) **or** i16 cm/s (ELRS struct, 4 B) | Betaflight `crsfFrameAltitude`; ELRS `crsf_sensor_baro_vario_s` |
| 0x3A timing | `EA 0D 3A EA EE 10 <rate i32> <offset i32> crc`: rate = interval × 10 (0.1 µs); offset signed 0.1 µs, already minus ELRS's 100 µs margin | ELRS `CRSFHandset::sendSyncPacketToTX` |
| 0x28 / 0x29 / 0x2B / 0x2C / 0x2D | ping, device info, parameter entry chunks, read `<param> <chunk>`, write `<param> <value BE>` | ELRS `CRSFEndpoint.cpp`, `elrs.lua` |

The relay design believed the timing frame was "signed 32-bit rate and offset, in 0.1 µs units". The ELRS source confirms the units and shows that **both fields are big-endian** (`htobe32`).

## 9. Test vectors

`test-vectors.json` holds byte-exact hex (uppercase, no separators) for:

- every UDP message: several flag and state combinations, full-scale and centred channels, counter and sequence extremes;
- malformed datagrams: bad CRC, wrong version, truncated, too long, bad magic, length mismatch, unknown state;
- every CRSF decoder;
- the outbound CRSF builders;
- parameter entries of every common type, including a multi-chunk one;
- CRSF parser streams with garbage, corrupt or truncated frames and split buffers;
- the flight-mode interpretation table.

Items marked `"external": true` come from third-party sources, not from the reference code. Each carries its source URL. They provide the independent cross-check:
- EdgeTX's channel-packing gtest bytes;
- EdgeTX CRC-8 and parser test streams;
- the CRC catalogue check values.

**Firmware tests should load the same file.**

## 10. Open items to agree with the G0 firmware

1. Byte order (little-endian), CRC-16 variant and placement — all of §2–3.
2. `status` layout, `fw_ver` encoding, units of `sync_*`, and the meaning of `rx_bad_crc`. A v2 might split it into per-cause counters and add `rx_bad_src` and the age of the echoed `t_gcs_us`.
3. Re-baseline of `seq` in WAIT_GCS (§5.1), and the definition of "consecutive".
4. Extra status per state change (§5).
5. Forwarding rule: everything except 0x3A timing frames (§3.3).
6. Camera policy A or B (§7).
7. `crsf_pass` (Q7a) and its slot arbitration.
8. ModelID start byte (`0xEE` per the relay design vs `0xC8` per EdgeTX): both are accepted by ELRS, so pick one and test it on a real module.
9. Status bits 3/4: the N6 → bridge path and the `fw_ver` threshold.

## 11. Changelog

| Version | Date | Change |
|---|---|---|
| v1 PROPOSAL | 2026-10-16 | First issue (WP03). Fixes little-endian byte order, CRC-16/CCITT-FALSE, the `status` / `crsf_fwd` / `crsf_pass` layouts, the validation order and versioning rules, the seq re-baseline, the extra status per state change, the forwarding rule and both camera policies. Reference code, simulator and test vectors added. |
