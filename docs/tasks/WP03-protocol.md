# WP03 — Relay protocol spec, Python reference implementation, bridge simulator

- **Worktree:** `S\wt\WP03`
- **Branch:** `wp/03`
- **Wave:** 1 (parallel with WP01, WP02, WP04)

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (you **own C3**), the relay design document (sections "Control output to the TX module", "Camera on/off", "Firmware architecture", "Ground station software", "Bring-up and test plan"), and plan §3.4 item 3, §7.3, §7.7, §14.2, §14.3.

## Goal

Create the single source of truth for the GCS↔bridge protocol and for CRSF handling, plus a realistic **bridge simulator**. WP08 then builds and tests the whole GCS app without hardware. This code is the foundation of a flight-safety path: correctness and tests matter more than features.

## Files you own

- new: `protocol/README.md`, `protocol/test-vectors.json`
- new: `gcs/pyproject.toml` (package `vtolgcs`, Python ≥ 3.12, deps: none for runtime of these modules; `pytest` dev)
- new: `gcs/vtolgcs/__init__.py`, `gcs/vtolgcs/protocol.py`, `gcs/vtolgcs/crsf.py`
- new: `gcs/tools/bridge_sim.py`
- new: `gcs/tests/test_protocol.py`, `gcs/tests/test_crsf.py`, `gcs/tests/test_bridge_sim.py`
- `docs/tasks/reports/WP03-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | `protocol/README.md` documents C3 completely: a **"PROPOSAL v1 — agree with G0 firmware before flight"** banner, message tables, byte order, CRC definitions with check values (CRC-16/CCITT-FALSE of `"123456789"` = 0x29B1; CRSF CRC-8 poly 0xD5), the state machine (BOOT/WAIT_GCS/START/RUN/FAILSAFE with T_hold), the camera rules (relay design default **plus** the plan §3.4-3 proposed "camera ON until a client stream starts" variant, both described and flagged), the port/reply rules, versioning rules (`ver` mismatch → ignore and count), and a changelog. |
| R2 | MUST | `vtolgcs.protocol`: `crc16_ccitt_false`, pack/unpack for `rc_up`, `status`, `crsf_fwd`, `crsf_pass` (dataclasses), `us_to_crsf` / `crsf_to_us`, `pack_channels(list[16 ints 172..1811]) → 22 bytes` and the inverse, using CRSF 11-bit LSB-first packing. Validation errors raise a specific `ProtocolError`. |
| R3 | MUST | `vtolgcs.crsf`: a streaming frame parser (sync bytes 0xC8/0xEA/0xEE, length, type, CRC-8) that resyncs on garbage, plus builders for an RC channels frame (0x16) and the ModelID command in the relay design. Decoders for 0x14 link statistics, 0x02 GPS, 0x08 battery, 0x1E attitude, 0x21 flight mode, 0x07 vario, 0x09 baro altitude, and 0x3A radio-ID/timing (rate/offset, signed). **Field layouts and endianness must come from a primary source:** read the Betaflight `src/main/telemetry/crsf.c` and/or the ExpressLRS CRSF headers on GitHub, and cite file + commit/URL in code comments and the report. |
| R4 | MUST | Flight-mode interpretation per the Betaflight docs (plan §14.2): `!FS!` → `failsafe=True`; disarmed suffixes `*` (ready), `!` (arming disabled), `?` (`rescue_not_ready=True`); `armed = no suffix and not failsafe`. Return a small dataclass. |
| R5 | MUST | Extended-frame support (0x28–0x96 with destination/origin): build a device ping (0x28) and parameter read (0x2C) and write (0x2D) request; parse device info (0x29) and parameter entry chunks (0x2B) into a structure (parameter number, chunks remaining, parent folder, type, name, value fields for the common types). Primary source: the ExpressLRS Lua/CRSF parameter code, cited. If a detail can't be confirmed from source, implement the documented part and list the gap in the report. |
| R6 | MUST | `protocol/test-vectors.json`: byte-exact hex vectors for each UDP message (several flag/state combinations, a full-scale channel set, centred sticks), CRSF frames for every decoder, and malformed cases (bad CRC, wrong version, truncated). The Python tests load and verify **all** vectors. Generate them with the reference code, then **independently cross-check at least the CRC and channel packing against an external known example** (e.g. a CRSF RC frame example from Betaflight/ELRS tests or docs, cited). |
| R7 | MUST | `gcs/tools/bridge_sim.py` (CLI, argparse): a UDP bridge simulator on configurable host:port (default 127.0.0.1:5770). It must: (a) implement the state machine — 5 consecutive valid packets → START (logs ModelID ×3) → RUN; no valid packet for T_hold (default 250 ms) → FAILSAFE → WAIT_GCS; (b) validate magic/ver/CRC/source IP/seq increment per the relay design; (c) apply `CAM_ENABLE` with read-back state; camera policy selectable `--camera-policy design|client-gated`; (d) send `status` at 10 Hz to the last valid sender, echoing `t_gcs_us`, with an optional artificial delay/jitter/loss (`--latency-ms`, `--loss-pct`) for RTT tests; (e) simulate a client: GPS on a circle, battery sag, LQ falling with distance, flight-mode string (`ANGL*` disarmed → `ANGL` when CH5 high → `!FS!` some seconds after bridge FAILSAFE → `RTH`), emitted as `crsf_fwd` frames at a configurable telemetry rate; (f) optionally a fake RTP/H.264-less "video" UDP stream to 5600 (just payload bytes at a CBR) for throughput tests, off by default. |
| R8 | MUST | Tests (`S\venv\Scripts\python.exe -m pytest gcs`): CRC check values; round-trip pack/unpack for every message; channel packing edge values; all vectors; CRSF parser resync with garbage and split buffers; each decoder; flight-mode interpretation; simulator state transitions driven by a test client over localhost UDP (WAIT_GCS→RUN after 5 packets, FAILSAFE after T_hold, camera read-back under both policies, status RTT echo). Tests must not be timing-flaky: use generous margins or inject a clock. |
| R9 | SHOULD | Type hints throughout; `python -m vtolgcs.protocol --selftest` prints the CRC check values. |

## Out of scope

The GCS app itself (controller input, sender loop, UI, API): WP08a/b.

## Acceptance (verifier)

- All pytest tests pass.
- The vectors cover every message type and every decoder.
- Every CRSF field layout has a cited primary source.
- Run the simulator plus a 20-line throw-away client: confirm the state machine and the camera policies behave as documented.
