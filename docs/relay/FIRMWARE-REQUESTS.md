# Firmware requests — G0 bridge and N6 video board

What the software side (pages, GCS app, protocol) asks of the relay firmware. None of this is implementable in this
repository: the firmware is not written yet. Each request says what is asked, why, what the software already does,
and what happens without it. Status values: **OPEN** (not agreed), **AGREED** (firmware will do it), **DONE**
(in a firmware release; record the `fw_ver`).

Sources: plan §3.4, §7.4, §7.7, §12 (Q7, Q12), §14.3; contract C3; [`protocol/README.md`](../../protocol/README.md)
(the normative v1 PROPOSAL, especially §10 "Open items to agree with the G0 firmware"); the relay design.

| # | Request | Board | Status | Plan ref. |
|---|---|---|---|---|
| FR-1 | Camera on only while needed: "client-gated" camera policy | G0 | OPEN | §3.4-3, Q12 |
| FR-2 | Q7a — CRSF passthrough GCS → TX module (`crsf_pass`) | G0 | OPEN | Q7a, §7.7, §14.3 |
| FR-3 | Q7b — N6 decoder lock and video standard in the bridge status | N6 + G0 | OPEN | Q7b, §7.4 |
| FR-4 | Bridge (and video-board) LED patterns | G0, N6 | OPEN | §6.1.4 |
| FR-5 | Agree relay UDP protocol v1 (status packet and the rest of C3) | G0 | OPEN | C3 |
| FR-6 | VRX channel control via the N6 — only if option (b) is chosen | N6 | OPEN (option) | §14.3 |

---

## FR-1 — Camera policy "camera ON until a client stream starts" (client-gated)

**Ask.** Implement camera policy B of [`protocol/README.md`](../../protocol/README.md) §7.2 in the G0:

| Bridge situation | Camera (switch port P3) |
|---|---|
| No valid GCS RC stream since boot (carrier-only flight, no client connected) | **ON** (at its P3 ingress cap) |
| RC stream running (START / RUN) | follows `CAM_ENABLE` (`rc_up.flags` bit 0) |
| RC stream lost after having run (client in failsafe) | **OFF** — protect the client's video during its RTH |
| New stream after loss | follows `CAM_ENABLE` again |

"Stream since boot" = START entered at least once since power-up. Keep the design rules common to both policies:
change within one packet, camera stays powered, the G0 **reads the switch register back** and reports the actual
state in `status.flags` bit 0.

**Why.** Owner decision (plan §1.1, Q12): camera gating is only needed while a client is connected. With the relay
design's policy A the camera is off from power-up until a GCS RC stream sets `CAM_ENABLE`, so a carrier-only flight
has no camera unless the GCS app streams RC.

**Software today.** The bridge simulator implements both policies (`--camera-policy design|client-gated`). The GCS app
shows the read-back state and alarms when requested ≠ reported for > 1 s. Without FR-1 the only way to get the
camera on a carrier-only flight is the app's **carrier-only mode**, which streams RC with the arm channel forced to
DISARMED and `CAM_ENABLE` = 1. That mode is a **DISARM hazard** if a client is in fact powered and bound, so it is
guarded by typed confirmations (`NOCLIENT`, plus `LANDED` after any FPV stream in the session) and a 30 s
no-telemetry check (`gcs/README.md`, "Modes and interlocks"). **FR-1 removes the need for carrier-only mode** — the
plan recommends the firmware change.

**Decision needed:** which policy flies (A or B). **TBD — agree with the G0 firmware.**

## FR-2 — Q7a: CRSF passthrough, GCS → TX module

**Ask.** Accept the `crsf_pass` message (`'R','P'`, same layout as `crsf_fwd`; protocol README §3.4) from the current
GCS only (the source of the latest valid `rc_up`), and send the enclosed CRSF frame to the TX module **in a free slot
between RC frames, without breaking the timing lock**. Forward the module's replies with `crsf_fwd`, which needs the
forwarding rule of FR-5 item 5 (forward everything except 0x3A timing frames, including the 0xEA-addressed extended
frames 0x29 / 0x2B / 0x2E). Count passthrough frames in `crsf_tx`.

**Why.** It enables, from the GCS, without a bench WiFi session:

- the ELRS parameter menu (packet rate, TX power, telemetry ratio, model match, Gemini; plan §7.7);
- **VTX Admin**: change the client VTX band/channel/power over the RC link (plan §14.3);
- with the Nomad's TX backpack and a VRX backpack, the relay VRX follows automatically (§14.3 option a).

**Software today.** Built and tested against the simulator (`bridge_sim.py --crsf-pass --module elrs`): the app's
ELRS tab and the VTX Admin panel (with lock wait and *Revert* once FR-3 reports decoder lock). Without Q7a in the
bridge the tab says "Not supported by bridge firmware (Q7a)". The app limits passthrough to device-ping,
parameter-read and parameter-write frames, at most 50 per second, and refuses writes while the client may be armed
(`crsf_menu.allow_write_while_armed`, default false). Without FR-2 the ELRS module must be configured on the bench
through its WiFi UI, and VTX Admin from the GCS is impossible.

**To verify on a real module once FR-2 exists:** the VTX Admin field names (matched by part of the name today), and
the byte order of 16-bit parameters (the Lua reader is followed; ELRS `int16ParameterToArray` copies host-order
values).

## FR-3 — Q7b: N6 decoder lock and video standard in the bridge status

**Ask.** Make the N6's decoder state reach the GCS through the bridge status: `status.flags` **bit 3
`decoder_lock`** and **bit 4 `std_ntsc`** (contract C3, protocol README §3.2), and publish the first `fw_ver` that
reports them (the GCS trusts the bits only from that version: `video.status_bits_min_fw_ver`, today **TBD**).

**Design question for the firmware:** the N6 and the G0 share only VIN and the RMII link through the switch, and the
relay design's VLANs let P2 (the bridge) talk only to P1. A path from the N6 to the G0 (a VLAN exception for one
status packet P5 → P2, or another channel) has to be chosen. **TBD.**

**Why.** Runtime PAL/NTSC detection per client (owner decision: both standards, plan §7.4), the VRX-follow lock
confirmation (§14.3), a channel-scan helper (co-site test 7), and the Link status. Today the app shows
`video.standard` / `decoder_lock` as **unknown** (null), and after a VTX Admin change it cannot wait for lock and
offer the automatic revert: the pilot judges the picture in the viewer.

## FR-4 — LED patterns

**Ask.** Define, and document for the manual, the LED patterns of the **RC bridge** — one per bridge state (BOOT,
WAIT_GCS, START, RUN, FAILSAFE) plus the link LED — and of the **video board** (decoder lock / no signal / encoder
fault, if it has LEDs).

**Why.** The ground crew diagnoses the relay from the LEDs (Relay PCB emergency card, troubleshooting diagram D12,
bridge-state diagram D5, relay chapter). Today every place shows **"TBD — bridge LED patterns"**.

## FR-5 — Agree relay UDP protocol v1 (C3 PROPOSAL)

**Ask.** Review and agree, or change, the v1 PROPOSAL in [`protocol/README.md`](../../protocol/README.md) **before
flight**; then mark it agreed there and add the firmware's own tests against
[`protocol/test-vectors.json`](../../protocol/test-vectors.json) (byte-exact vectors for every message). The items
(protocol README §10):

1. Byte order (little-endian), CRC-16/CCITT-FALSE and its placement.
2. The `status` packet layout (42 bytes, 10 Hz plus one per state change), the `fw_ver` encoding
   (`(major << 8) | minor`), the units of `sync_period_x10us` / `sync_offset_x10us` (0.1 µs), and the meaning of
   `rx_bad_crc` (all format rejects). A v2 might add per-cause counters and `rx_bad_src`.
3. Re-baseline of `seq` in WAIT_GCS (so a restarted GCS app is accepted), and the definition of "consecutive".
4. An extra status packet on every state change (so FAILSAFE is visible at once).
5. The forwarding rule: every valid frame except the 0x3A timing frames (see FR-2).
6. The camera policy (FR-1).
7. `crsf_pass` and its slot arbitration (FR-2).
8. The ModelID start byte: `0xEE` (relay design) or `0xC8` (EdgeTX); ELRS accepts both — pick one and test it on a
   real module.
9. Status bits 3/4 and their `fw_ver` threshold (FR-3).

Also to fix in the firmware configuration: the **allowed GCS source IP or subnet** (the relay design requires a
source check; value **TBD**), and the bridge IP ([`IP-PLAN.md`](IP-PLAN.md), Q3).

**Channel scaling** is already decided (PM, WP03): `crsf = 172 + round((us − 988) × 1639 / 1024)`, clamped on the
sending side only; receivers accept any 11-bit value and the bridge forwards the `ch` bytes unchanged.

## FR-6 — VRX channel control via the N6 (only if option b is chosen)

**Ask (conditional).** If the band-agnostic VRX is not followed through an ELRS VRX backpack (plan §14.3 option a,
which needs no relay firmware), then: the N6 drives the VRX's control interface from a spare UART/GPIO (SP1–SP6), on a
new "VRX channel" command from the GCS (a new message; not in protocol v1), and confirms with decoder lock (FR-3).

**Decision needed:** option (a) ELRS backpack or option (b) N6 control. **TBD — depends on the chosen VRX** (check
the ExpressLRS Backpack wiki for that VRX type).
