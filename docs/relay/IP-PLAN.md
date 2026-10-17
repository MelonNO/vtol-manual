# IP plan — HM30 network and GCS laptop

**Status: PROPOSAL — confirm before flight.** The final addresses of the N6 video board, the RC bridge and the GCS
laptop are **undecided (plan Q3)**. The working assumption below is the plan §3.3 proposal; decide and record the
final values at bring-up, then update this file, `data/content.js` (`network`), the GCS app default
(`gcs/vtolgcs/config.py`, `bridge.ip`) and diagram D3 together.

Sources: plan §3.3 and §7.4, contract C2/C3 (`docs/tasks/02-CONTRACTS.md`), relay design ("Ground station
software", "Firmware architecture"), `gcs/README.md`.

## HM30 subnet `192.168.144.0/24` (mask `255.255.255.0`)

| Device | IP | Port / protocol | Direction | Notes |
|---|---|---|---|---|
| GCS laptop | `192.168.144.X` | — | — | Static IP on the Ethernet adapter. **X must not clash** with any address below. Suggested `.100`; final: **TBD — decide at bring-up (Q3)** |
| HM30 air unit | `192.168.144.11` | — | — | Unchanged (current installation) |
| HM30 ground unit | `192.168.144.12` | UDP **19856** (MAVLink) | ↔ | Unchanged; Mission Planner connects with **UDPCI** |
| IP camera (carrier) | `192.168.144.26` | RTSP **8554** `/main.264` | camera → GCS | Behind relay switch **P3**; VLAN: reaches only P1. Passes traffic only while `CAM_ENABLE` = 1 in the GCS RC stream (relay design; see [`FIRMWARE-REQUESTS.md`](FIRMWARE-REQUESTS.md) FR-1). P3 ingress rate limit: **TBD — needs the measured HM30 capacity (Q13)** |
| Spare port | — | — | — | Switch **P4** (JST-GH); VLAN: reaches only P1. What may be connected and its bandwidth cap: **TBD** |
| N6 video board | **TBD — e.g. `.20` (Q3)** | sends RTP/UDP to the GCS on **5600** | carrier → GCS | Destination IP and port are stored in N6 flash (relay design): set them to the laptop's final address |
| RC bridge (W5500 + G0) | **TBD — e.g. `.21` (Q3)** | UDP **5770** at the bridge | GCS → carrier (`rc_up`, 36 B at 200–250 Hz); carrier → GCS (`status` 10 Hz, `crsf_fwd`) | Replies go to the source IP:port of the latest valid `rc_up` (C3). The GCS app default is `192.168.144.21` (`bridge.ip`), labelled as the proposal |
| ~~FPV video RTSP~~ | ~~`192.168.144.25`~~ | — | — | **Removed** (was the SIYI HDMI→IP encoder of the old relay chain) |

Open points:

- **Addresses the HM30 units use themselves:** the relay design says to check which addresses the HM30 air and
  ground units occupy before assigning `.20`/`.21`/`.100`. **TBD — check at bring-up.**
- **Multicast through the HM30** (one video stream to several receivers without the app's fan-out): **unknown (Q3)**.
  The design does not rely on it; the GCS app re-sends the video locally (below).
- **Source-IP check in the G0:** the relay design requires one, but gives no value. Allowed GCS source IP or subnet:
  **TBD — firmware setting** (protocol README §1).

## GCS laptop, local only (`127.0.0.1`)

Only one Windows process can normally bind UDP 5600, so the GCS app receives the video and re-sends it locally
(plan §3.3 "port conflict", §7.4; C3).

| Port | Protocol | From → to | Used by |
|---|---|---|---|
| **5600** | RTP/UDP | N6 → GCS app (video fan-out) | the fan-out process binds it. **Mission Planner must not listen on 5600 while the fan-out runs** |
| **5601** | RTP/UDP | fan-out → standalone viewer | GStreamer viewer / `client-video.sdp` |
| **5602** | RTP/UDP | fan-out → Mission Planner HUD | MP HUD GStreamer source (right-click HUD → Video → Set GStreamer Source) |
| **47800** | HTTP | GCS app → browser | read-only local API (`/api/v1/health`, `/status`, `/events`; contract C2) for the Tools **Link** tab and the coverage map |
| **14551** | MAVLink/UDP | Mission Planner "MAVLink Mirror" → GCS app | read-only carrier position; **untick "Write access"** in MP (S-02b) |
| **14560** | MAVLink/UDP | GCS app → Mission Planner (second connection) | display-only client vehicle, **sysid 2** (never 1 or 255, S-02b) |

The app's RC socket binds `0.0.0.0` (any free local port) and accepts only datagrams from the configured bridge
address. `gcs/scripts/firewall.ps1` (run as administrator) adds two inbound UDP rules for `vtol-gcs-sender.exe`
only (bridge status / CRSF replies, and the client video on 5600), on the **Private** profile and for the HM30
subnet `192.168.144.0/24` only.

## Rules

- **No other program may send MAVLink as GCS sysid 255** on this network (S-02b): it would keep the carrier's GCS
  failsafe from firing while Mission Planner is dead. The GCS app sends no MAVLink to the carrier.
- Mission Planner is the carrier's heartbeat: never close it in flight; laptop on mains, sleep and hibernate disabled
  (S-02a).
- If the link ever runs over another IP radio or LTE, carry the RC port only inside a VPN (WireGuard) and never expose
  it publicly (relay design).
