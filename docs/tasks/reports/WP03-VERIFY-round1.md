# WP03 verification — round 1
VERDICT: REJECTED

Verifier: independent verification agent. Worktree `S\wt\WP03`, branch `wp/03`, HEAD `5aea504`. Diff base `5a2377e` (`git merge-base main HEAD`). Date 2026-10-16.

One MAJOR finding (F1) blocks approval. Everything else is in good shape: every MUST requirement except R7 passes on its own merits, and the CRC, packing and decoder layouts were independently confirmed against primary sources.

## Scope

`git diff 5a2377e HEAD --stat` changes 15 files, all new.

**Owned files:**
- `protocol/README.md`, `protocol/test-vectors.json`
- `gcs/pyproject.toml`, `gcs/vtolgcs/{__init__,protocol,crsf}.py`
- `gcs/tools/bridge_sim.py`
- `gcs/tests/test_{protocol,crsf,bridge_sim}.py`
- `docs/tasks/reports/WP03-IMPLEMENTATION.md`

**Extra files, all justified in report §5 and minimal:**

| File | Size | Why it is needed |
|---|---|---|
| `gcs/tools/gen_test_vectors.py` | 407 lines | R6 says "generate them with the reference code". `--check` keeps the JSON in sync, and the firmware team needs it too |
| `gcs/conftest.py` | 12 lines | Puts `gcs/` and `gcs/tools` on `sys.path`, so `pytest gcs` works from the repo root without installing |
| `gcs/tests/_vectors.py` | 21 lines | Shared JSON loader |
| `gcs/.gitignore` | 6 lines | Keeps caches out of git; the root `.gitignore` covers only `relay/` |

Nothing outside `gcs/`, `protocol/` or the report is touched.

**Commits:**
- 2 commits, each with the `Co-Authored-By: Claude Opus 5.5` trailer.
- Each also has a `Claude-Session:` trailer, which the PM accepts.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 MUST | PASS | `protocol/README.md`: banner `:3`; ports/reply rules §1 `:16-28`; byte order §2 `:30-34`; CRCs with check values `:38-42` (0x29B1, 0xBC, 0xBA → 0x20); message tables §3 `:50-121`; state machine with T_hold §5 `:134-168`; versioning §6 `:185-191` ("ver ≠ 1 → ignore and count"); camera policies A `:203` and B `:211`, B flagged as PROPOSAL/Q12 and "which flies" left TBD `:222`; changelog §11 `:278` | Policy B matches plan §3.4-3 row for row. The 1 s mismatch alarm comes from plan §7.1 (`SOFTWARE-IMPROVEMENT-PLAN.md:540`). Every TBD is a `warn-val` span |
| R2 MUST | PASS | `protocol.py`: `crc16_ccitt_false` `:103`; `us_to_crsf`/`crsf_to_us` `:138/:153`; `pack_channels`/`unpack_channels` `:158/:178`; frozen dataclasses `RcUp` `:218`, `Status` `:279`, `CrsfFwd` `:387`, `CrsfPass` `:405`; `ProtocolError` and its subclasses `:77-98` | Struct `<2sBBBBHIIIIIIii` = 40 B. Offsets checked by hand against the C3 table: 0,2,3,4,5,6,8,12,16,20,24,28,32,36, crc at 40. `rc_up` crc at 34. Fuzzing 200 000 random or near-valid datagrams through `decode()` raised only `ProtocolError` |
| R3 MUST | PASS | `crsf.py`: parser `:232-284` (sync C8/EA/EE, len 2..62, CRC-8, resync); RC builder `:289`; ModelID builder `:298`; decoders 0x14 `:352`, 0x02 `:393`, 0x08 `:420`, 0x1E `:445`, 0x07 `:464`, 0x09 `:484`, 0x21 `:599`, 0x3A `:617`; citations with pinned commits `:3-28` | All cited sources were re-fetched at the pinned commits and spot-checked (see "Source spot-check"). 20 000 random chunks went through the parser with no exception and `pending` stayed < 64. 100 000 random CRC-valid frames of every decoded type raised only `CrsfError` |
| R4 MUST | PASS | `crsf.py:552-595` | Matches Betaflight `crsfFrameFlightMode` (`telemetry/crsf.c:610-662` @41a5b43): the suffix is written only when `!ARMED && !FAILSAFE_MODE`, and `!`/`?`/`*` take priority in that order. `armed = suffix is None and not failsafe` |
| R5 MUST | PASS | ping `:314`, read `:320`, write `:326`, `DeviceInfo` `:667`, `ParameterChunk` `:744`, `ParameterEntry`/`parse_parameter_entry` `:761/:818`, `ParameterAssembler` `:904` | Byte layout confirmed against ELRS `elrs.lua` (`parseParameterInfoMessage` data[2..4], `fieldIntLoad`, `fieldFloatLoad` with offsets +16/+17/+21, `fieldTextSelLoad`, `fieldCommandLoad`, `parseDeviceInfoMessage`) and `CRSFEndpoint.cpp` (0xFF folder terminator `:177`, `chunkMax = max − 6 − 2` `:240`). The gaps are honestly listed in report §5.9 |
| R6 MUST | PASS | `protocol/test-vectors.json`, 15 sections | Every UDP message type has vectors, plus 22 malformed cases (bad CRC, wrong version and truncated for `rc_up`, `status` and `crsf_fwd`). Every decoder has frames. External items carry their URLs. **My own independent implementation reproduced all of them** (see Tests). `gen_test_vectors.py --check` → `up to date` |
| R7 MUST | **FAIL (F1)** | `bridge_sim.py` | (a)–(f) are implemented and behave as documented in my smoke test. However, one CRC-valid `rc_up` carrying an 11-bit channel value outside 172..1811 crashes the simulator process. See F1 |
| R8 MUST | PASS (MINOR F2) | `test_protocol.py`, `test_crsf.py`, `test_bridge_sim.py`: 302 tests | The tests are substantive: fake-clock T_hold boundary, re-baseline, source filter, both camera policies, read-back faults, and UDP integration. One unexplained, non-reproducible failure burst was seen (F2) |
| R9 SHOULD | PASS | type hints throughout; `cd gcs && python -m vtolgcs.protocol --selftest` → 0x29B1 / 0xBC / 0x20, `SELFTEST OK` | The self-test needs `cwd=gcs` (no install). This is documented |

## Contract results (C3)

| Item | Result |
|---|---|
| Little-endian, packed | PASS. `rc_up` 36 B and `status` 42 B; layouts byte-identical to C3 (checked by independent packing) |
| CRC-16/CCITT-FALSE over all bytes before the CRC | PASS. Bit-serial independent implementation: "123456789" → 0x29B1, and every vector matches |
| CRSF CRC-8 poly 0xD5 over type + payload | PASS. Independent: 0xBC catalogue check; EdgeTX `TEST(Crossfire, crc8)` → F4; EdgeTX `droppedBytes2` timing frame → D7 |
| `crsf_fwd`/`crsf_pass` 6 + len | PASS |
| Port 5770 and reply to the source of the latest valid `rc_up` | PASS (`bridge_sim.py:198`, `:631-634`) |
| Channel scaling | PASS as written. C3's formula gives 988 µs → **173**, not the 172 in its own anchor table. The implementer kept the formula and documented this (README `:127-130`, report §5.1). **PM decision needed.** Note also that ELRS defines 1000 µs = 191 and 2000 µs = 1792 (`crsf_protocol.h:21,23`), while the C3 formula gives 192 / 1792 |
| `rx_bad_crc` meaning, `fw_ver` encoding, `x10us` units | Undefined in C3. Each is resolved as a clearly labelled PROPOSAL (README `:85`, `:89`, `:92`; open items §10) and none changes a byte layout. The 0.1 µs reading of `x10us` matches ELRS (`RequestedRCpacketInterval * 10`) and the relay design ("0.1 µs units") |
| Extensions | Each is marked PROPOSAL in the README, reasoned, and listed in §10. None contradicts a C3 byte layout. The 0x3A big-endian finding is correct (ELRS `crsf_sync_packet_t` "Big-Endian", `htobe32`; EdgeTX stream `00 00 9C 40` = 40000), and it concerns the inner CRSF frame only:<br>• extra `status` per state change (§5)<br>• `seq` re-baseline in WAIT_GCS only (§5.1)<br>• "consecutive" definition<br>• forwarding everything except 0x3A (§3.3, explicitly refining the relay design's "handle frames addressed to 0xEA")<br>• 0x3A big-endian (§8) |

### Source spot-check

I fetched the cited files myself at the pinned commits with `curl` (into `verify\WP03\src\`):
- Betaflight 41a5b43: `telemetry/crsf.c`, `rx/crsf.c`, `rx/crsf_protocol.h`
- ExpressLRS dd96654: `crsf_protocol.h`, `CRSFHandset.cpp`, `TXModuleEndpoint.cpp`, `CRSFEndpoint.cpp`, `elrs.lua`
- EdgeTX 65db64b: `pulses/crossfire.cpp`, `tests/crossfire.cpp`, `crc.cpp`

| Frame | Source | Matches code |
|---|---|---|
| 0x14 link stats | ELRS `crsfPayloadLinkstatistics_s` (u8,u8,u8,i8,u8,u8,u8,u8,u8,i8 [+u8 DL RSSI2]); BF TX power table {0,10,25,100,500,1000,2000,250,50} | yes |
| 0x02 GPS | BF `crsfFrameGps`: i32 lat, i32 lon BE; u16 (cm/s·36+50)/100 = km/h×10; u16 course×10 = deg×100; u16 m+1000; u8 sats | yes |
| 0x08 battery | BF `crsfFrameBatterySensor`: u16 0.1 V, u16 0.1 A, u24 mAh, u8 % | yes |
| 0x1E attitude | BF `crsfFrameAttitude`: i16 pitch, roll, yaw rad×10000 BE | yes |
| 0x21 flight mode | BF `crsfFrameFlightMode` | yes (R4) |
| 0x09 baro | BF 3 B (log-packed i8, Kl=100, Kr=0.026); ELRS struct 4 B (i16 cm/s) | yes; both handled |
| 0x3A timing | ELRS `sendSyncPacketToTX`: header EA, dest EA, origin EE, sub 0x10, `htobe32(interval*10)`, `htobe32(offset − margin)` | yes |
| ModelID | EdgeTX `createCrossfireModelIDFrame` (`crc8_BA(frame+2,6)`, `crc8(frame+2,7)`); ELRS reads `payload[2]` | yes. Independently: `EE 08 32 EE EA 10 05 00 DC 4D` |
| Sync bytes and length limits | ELRS `alignBufferToSync` (EE, C8), `totalLen` 4..64 | yes |

## Tests run (commands + results)

**Full suite** (`S\venv\Scripts\python.exe -m pytest gcs`, from the worktree root): `302 passed in 8.74s`. Re-run later: `302 passed in 8.72s`.

**Repeated runs of `gcs/tests/test_bridge_sim.py`** (about 70 runs in total):
- 4× sequential: 1 pass, then **3 × "1 failed, 35 passed in 12.6s"** (see F2).
- Since then, all green:
  - 6×
  - 12× (UDP subset)
  - 4× in parallel
  - 5×
  - 3× with all 28 cores saturated by busy loops
  - 30× in a background loop
  - 4× more repeating the original sequence exactly

**Other checks:**
- `python gcs/tools/gen_test_vectors.py --check` → `up to date`.
- `cd gcs && python -m vtolgcs.protocol --selftest` → `SELFTEST OK`.

**Independent cross-check** (`S\verify\WP03\indep.py`):
- It does not import `vtolgcs`. It uses a bit-serial CRC-16, a bit-serial CRC-8 and a bit-by-bit LSB-first 11-bit packer/unpacker.
- **101/101 checks OK**:
  - the CRC-16 check value 0x29B1
  - the CRC-8/0xD5 check 0xBC
  - EdgeTX crc8 F4
  - the EdgeTX packing gtest `ADA0885E…99D5`, computed from pulses `−1024+128·i` with C-truncating `992 + p·4/5`
  - every `channels`, `rc_up`, `status`, `crsf_fwd` and `crsf_pass` vector rebuilt byte-for-byte from its fields
  - every `crsf_frames` CRC and length
  - independent big-endian decoding of the GPS, battery, attitude, link, timing, flight-mode and vario vectors
- Extra independent checks: EdgeTX timing frame CRC D7 and BE decode (40000, 28), and ModelID inner/outer CRC DC/4D.

**Fuzz** (`S\verify\WP03\fuzz.py`): `bad = 0` (see R2/R3).

## Smoke tests (what I ran + result)

**Throw-away client** (`S\verify\WP03\client.py`, ~30 lines, `vtolgcs.protocol` only) against the simulator CLI: `bridge_sim.py --port 5781 --telemetry-hz 0 -v`.
- Sequence sent: 1 valid packet, a 300 ms gap, 3 packets, a 300 ms gap, then 400 packets at about 4.5 ms intervals, then stop.

| Policy / cam | Before stream | Stream | After stop |
|---|---|---|---|
| design, cam=1 | WAIT_GCS, cam False | START at rx_ok=9, RUN, cam True | FAILSAFE then WAIT_GCS, cam False |
| design, cam=0 | WAIT_GCS, cam False | RUN, cam False | WAIT_GCS, cam False |
| client-gated, cam=1 | WAIT_GCS, cam **True** | RUN, cam True | WAIT_GCS, cam False |
| client-gated, cam=0 | WAIT_GCS, cam **True** | RUN, cam False | WAIT_GCS, cam False |

- **START after exactly 5 stream packets.** START came at rx_ok = 1 + 3 + 5 = 9. This proves that a gap longer than T_hold restarts the "consecutive" count: without the restart, START would have come at rx_ok = 5.
- **ModelID ×3 logged:** `EE 08 32 EE EA 10 05 00 DC 4D`, then START → RUN.
- **FAILSAFE timing.** FAILSAFE came about 270 ms after the last packet (log: "no valid rc_up for 254 ms > T_hold"). Both the FAILSAFE status and the WAIT_GCS status were received.
- **RTT echo.** Median RTT was 4.8 ms with `--latency-ms 0` and 104.9 ms with `--latency-ms 100` (RUN statuses only), so the echo works.
- **Crash probe** for F1: 49 CRC-valid `rc_up` with CH1 = 2047 sent to `bridge_sim.py --port 5783`. The **simulator process exited** with `FieldError: channel 1 = 2047 outside 172..1811`; traceback in `S\verify\WP03\sim_crash.log`.

## Findings

1. **MAJOR: the simulator crashes on a valid-format `rc_up`.**
   - **Where:** `gcs/tools/bridge_sim.py:244` (via `crsf.py:295` → `protocol.py:171-173`).
   - **What is wrong:**
     - `BridgeCore.on_datagram` correctly accepts any CRC-valid `rc_up`, and `RcUp.unpack` returns raw 11-bit values 0..2047, as the README requires (`README.md:131`: "A receiver unpacks the raw 11-bit values 0 … 2047 without judging them").
     - In RUN, `_crsf_slot` rebuilds the CRSF frame with `build_rc_channels_frame(self.last_rc.channels)`. That calls the strict `pack_channels`, which raises `FieldError` for any value outside 172..1811.
     - Nothing catches it: `_receive`, `step` and `run` have no handler. The simulator thread (in tests) or the process (in the CLI) dies.
     - So a single 36-byte datagram from an allowed source kills the bridge model. Such values are legal CRSF: ELRS `crsf_protocol.h:20,24` notes min 0 / max 1984 with extended limits.
     - This contradicts README `:12` ("behaves as this document describes") and `:33` (the G0 "copies [the 22 bytes] straight into the CRSF frame"). It also goes beyond R7(b), which lists the checks as magic/ver/CRC/source/seq only.
   - **Expected:**
     - In RUN the simulator forwards the received 22 `ch` bytes unchanged into the `0x16` frame, as the G0 will. For example, keep the raw bytes in `BridgeCore`, or add a non-validating builder.
     - Out-of-range values never terminate the simulator.
     - Add a fake-clock test and a UDP test with channels 0 and 2047 in RUN.
     - Optionally, make the runner loop log and survive unexpected exceptions.

2. **MINOR: one unexplained burst of UDP test failures.**
   - **Where:** `gcs/tests/test_bridge_sim.py` (UDP section, `:383-629`).
   - **What happened:**
     - In my first 4 repeated runs, 3 consecutive runs each reported "1 failed, 35 passed" and took 12.6 s instead of 8.6 s. That is consistent with one `wait()` timing out.
     - I had piped through `tail -1`, so I did not capture which test failed.
     - The failure did not reproduce in about 65 later runs, including 28-core CPU saturation and 4 parallel suites.
     - The cause is probably environmental (concurrent activity on the host), but it is unconfirmed.
   - **Expected:** while doing the F1 rework, the implementer should give each UDP-test `wait()` assertion a message that dumps `cli.states()` and the last status, so any future failure is diagnosable. Re-check for flakiness.

3. **MINOR: `crsf_tx` does not count passthrough frames.**
   - **Where:** `bridge_sim.py:653-667`.
   - **What is wrong:** README `:91` says `crsf_tx` counts "RC + ModelID + passthrough", but `_on_crsf_pass` never increments `core.crsf_tx`.
   - **Expected:** increment it, or reword the README.

4. **MINOR: `-v` has no effect.**
   - **Where:** `bridge_sim.py:834-837`.
   - **What is wrong:** `basicConfig` already sets INFO unless `-vv` is given, so `if not args.verbose: setLevel(INFO)` is dead code. `-v` therefore behaves the same as no flag, although the report tells users to run with `-v`.
   - **Expected:** remove the dead lines, or make `-v` mean DEBUG.

5. **MINOR: `timing_locked` depends on the last `build_status()` call.**
   - **Where:** `bridge_sim.py:248-255`.
   - **What is wrong:** `timing_locked` and `_run_age()` read `_now_hint`, a class attribute that is only updated by `build_status()`. The property's value depends on when `build_status` was last called, which is a fragile hidden coupling.
   - **Expected:** pass `now` explicitly, or store it in `tick()`.

6. **MINOR: failsafe detection uses `startswith` instead of "contains".**
   - **Where:** `crsf.py:584`.
   - **What is wrong:** `failsafe` is detected with `startswith("!FS!")`, while plan §14.2 says "contains `!FS!`". The two are equivalent for Betaflight, which always emits `!FS!` as the whole base mode.
   - **Expected:** a one-line note, or use `in`.

7. **MINOR: em dash garbles the banner on Windows consoles.**
   - **Where:** `bridge_sim.py:839`.
   - **What is wrong:** the em dash in the startup banner is garbled on a cp1252 Windows console or log redirect. This is cosmetic.
   - **Expected:** use plain ASCII "-".

8. **MINOR: no truncated `crsf_pass` vector.**
   - **Where:** `protocol/test-vectors.json` `malformed`.
   - **What is wrong:** there is no truncated `crsf_pass` case. It shares its code path with `crsf_fwd`, which is covered, but firmware tests would benefit from one.
   - **Expected:** add one.

**Contract issues for the PM.** These are not WP03 defects; the implementer reported them correctly:
- 988 µs maps to 173 under the C3 formula, and 1000 µs maps to 192 where ELRS uses 191. Decide whether to keep the 1.6 slope (EdgeTX) or switch to ELRS `fmap(172..1811 ↔ 988..2012)`.
- Confirm `x10us` means 0.1 µs units.
- Accept the `rx_bad_crc`, `fw_ver`, re-baseline, extra-status and forwarding proposals for firmware agreement.

**Safety content:**
- No invented operational numbers. 250 ms, 5 packets, 4–5 ms, 1 s, 64 B and 40000/50000 are each traced to the relay design, the plan or the sources.
- Simulator constants are labelled test data.
- The unknowns (bridge IP, allowed source, ModelID, KSZ8795 registers, which camera policy flies, the `fw_ver` threshold) are visible `warn-val` TBDs.
- Nothing touches the carrier failsafe intent.
- Report note §5.10, that WP08 must not rely on `!FS!` arriving over telemetry, is a good, honest safety caveat.

**Report honesty:**
- Claims checked and accurate: line references (spot-checked), test counts, external cross-checks (reproduced independently), `--check` and self-test.
- The R7 "DONE" is accurate as far as features go. It misses the F1 robustness defect, but I do not consider that a false claim.

## Approval rationale

**REJECTED.** One MAJOR finding must be fixed:

- **F1:** `bridge_sim.py` must forward any CRC-valid `rc_up` channel payload, raw 11-bit values 0..2047, without crashing. Add tests for channels 0 and 2047 in RUN, both fake-clock and UDP.

Also recommended in the same rework round:
- F2: add diagnostics to the UDP waits and re-run the simulator suite repeatedly.
- F3 and F4: small fixes.

Everything else meets the brief and contract C3:
- the CRCs, 11-bit packing and every UDP layout are confirmed by an independent implementation;
- the CRSF layouts are confirmed against Betaflight, ExpressLRS and EdgeTX at the cited commits;
- the state machine and both camera policies behave as documented.

After F1 is fixed I expect to approve.
