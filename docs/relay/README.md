# docs/relay — the relay: design, IP plan, firmware requests, open items, test results

The relay is the two-board PCB on the carrier (Heewing T2 Cruza) that turns the client drone's analog video into
H.264 over IP and turns RC packets from the GCS into CRSF for an ELRS TX module. This folder collects everything the
software project knows, needs or still waits for about it.

| File | What it holds |
|---|---|
| [`IP-PLAN.md`](IP-PLAN.md) | Addresses and ports on the HM30 network and on the GCS laptop (plan §3.3; Q3 still open) |
| [`FIRMWARE-REQUESTS.md`](FIRMWARE-REQUESTS.md) | What the software asks of the G0 bridge and N6 video firmware (camera policy, Q7a, Q7b, LEDs, protocol v1 agreement, VRX control) |
| [`OPEN-ITEMS.md`](OPEN-ITEMS.md) | Everything not implementable in software or not yet decided: hardware, firmware, measurements, owner decisions, photos, deferred features, known minor follow-ups |
| [`TEST-RESULTS.md`](TEST-RESULTS.md) | Template for the measured results: relay-design tests 1–9, S-01a, S-02 / S-02c, HM30 capacity, failsafe times per cause, glass-to-glass latency |

## The relay design document

The hardware and firmware source of truth is the relay design: *Analog Video to IP Relay with Drone TX Control —
Technical Solution* (owner's document, 2026-10-14). **It is not in this repository.** The owner keeps it; whether to
publish a copy here is an owner decision (see [`OPEN-ITEMS.md`](OPEN-ITEMS.md), O-9). Every relay claim in the pages
and in these files must cite it (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)).

In short (from the relay design):

- **Two boards, one stack.** The **video board** (STM32N657 "N6") encodes CVBS (PAL or NTSC) to H.264 and sends
  RTP/UDP to the GCS on port **5600**. The **net/RC board** carries a **KSZ8795** 5-port switch and the RC bridge
  (**W5500 + STM32G030** "G0"), which receives `rc_up` packets on UDP **5770** and drives the ELRS TX module over
  single-wire CRSF. A video-board fault never stops the RC path.
- **Switch ports:** P1 HM30 air unit · P2 W5500 (RC bridge) · P3 IP camera (switched by `CAM_ENABLE`) · P4 spare ·
  P5 RMII to the N6.
- **Bridge states:** BOOT → WAIT_GCS → (5 valid packets) START (ModelID × 3) → RUN → (no valid packet for T_hold,
  start at 250 ms) FAILSAFE → WAIT_GCS. In FAILSAFE the bridge is silent, so the ELRS module and then the client go
  to failsafe.

## Where the software implements or documents it

| Topic | Where |
|---|---|
| UDP protocol v1 (PROPOSAL — agree with the G0 firmware before flight) | [`protocol/README.md`](../../protocol/README.md), test vectors [`protocol/test-vectors.json`](../../protocol/test-vectors.json) |
| Python reference implementation, bridge simulator | `gcs/vtolgcs/protocol.py`, `gcs/vtolgcs/crsf.py`, [`gcs/tools/bridge_sim.py`](../../gcs/tools/bridge_sim.py) |
| GCS companion app (RC sender, status, alarms, video fan-out, ELRS menu, test tools) | [`gcs/README.md`](../../gcs/README.md) |
| Manual chapters | `manual.html#relay` (Relay Electronics), `#comms` (RF & Comms), `#procedures`, `#emergency` |
| Diagrams | [`img/diagrams/`](../../img/diagrams/d02-relay-electronics.svg): D1 system, D2 relay electronics, D3 network map, D4 RC path timeline, D5 bridge states, D6 client failsafe, D8/D8b bandwidth and camera logic, D11 wiring |
| Shared content (network table, emergency cards, checklists) | `data/content.js` |
