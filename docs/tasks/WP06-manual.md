# WP06 — Manual rewrite for the new relay

- **Worktree:** `S\wt\WP06`
- **Branch:** `wp/06`
- **Wave:** 3
- **Starts after:** WP04 and WP05 are merged

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (consume C1, C4, C5), the WP04 and WP05 reports, the relay design document (read-only), and plan §1.1, §3, §4, §5.2 (MAN-01…15), §6.1 (all), §9.1 (captions), §13.2, §13.3, §14 (for the client-telemetry mentions).

## Goal

Rewrite `manual.html` so that it accurately describes the system **as implemented with the new relay**, with the owner's decisions, and fix every manual defect. Operational content shared with the Tools page (emergencies, failsafe table, network table, callouts) is **rendered from `data/content.js`**, never duplicated.

## Files you own

- `manual.html`
- `data/content.js` — **additions only**: new keys for manual-only shared data if needed, without changing the existing structure; tell the verifier
- `test/manual/*.test.js`
- `docs/tasks/reports/WP06-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **§4 / §6.1.5 Flight Modes:** design-intent statement at the top; failsafe table and SIYI-loss explanation rendered from `VtolContent.failsafeTable`. Delete the RC failsafe cascade SVG; leave a `<div class="diagram-slot" data-diagram="D7">` (and `D6` for the client failsafe chain) for WP07. Document S-01a (as a TBD test), S-02a (MP is the heartbeat; never close MP; laptop must not sleep), S-02b (no other program as the primary GCS sysid), S-02c (RADIO_STATUS check procedure), S-03 (FS_SHORT_ACTN meaning). Mode table: 3-position switch QHOVER/FBWB/AUTO, left button RTL — usable only within close range. |
| R2 | MUST | **§6.1.2 Overview:** new mission sentence; crew table (FPV pilot at the GCS laptop with the EdgeTX radio as USB joystick); telemetry visibility note; T2 Cruza; client = any analog FPV; photos per WP04 (`client_drone.svg` replaces `fpv_drone.jpg`; use `<picture>` with `.webp` + jpg). |
| R3 | MUST | **§6.1.3 RF & Comms:** rewrite. Placeholder slot for D1; RC uplink, video downlink and carrier camera chains (HTML chain strips updated); 915 backup with the corrected text; frequency table from the active client/link profiles with the **Nkom compliance column = TBD (Q14)**; network table from `VtolContent.network`; bandwidth budget (FPV mode / camera mode, values TBD until measured, Q13); latency budget (relay-design estimates marked "estimate", measured = TBD). |
| R4 | MUST | **§6.1.4 new chapter "Relay Electronics"** under Aircraft ▾ (new tab id `relay`). It covers: boards and the independence rule; switch ports P1–P5 with VLAN and priority map; camera on/off (`CAM_ENABLE`), including the relay-design default **and** the proposed client-gated variant (firmware request, marked as such); indicators table (N6 LEDs: heartbeat/decoder lock/Ethernet link; bridge LED patterns = TBD firmware); connectors table (from the relay design); power (6–26 V input; Nomad VBAT_TX 6–16.8 V; consumption TBD); firmware versions (STM32G030 bridge, STM32N657 video) and where to read them; acceptance tests 1–9 table with a "measured" column = TBD; slots for D2, D4, D5, D8, D8b, D15. |
| R5 | MUST | **§6.1.6 Procedures:** new power-up sequence (8 steps per plan); the carrier-only note; relay operations with the camera protocol and callouts; the bind procedure (binding phrase/model match, no per-flight bind); the **EdgeTX radio RF-off safety box**; the "GCS app status bar" duty. Fix MAN-07 (one consistent power order; drop the unsupported claim) and MAN-06 (one number: 3 s; one transition-direction rule: into wind — S-08). |
| R6 | MUST | **§6.1.7 Client Drones** replaces the FPV Sub-Drone tab (id `clients`; keep the old id `fpv` working as an alias for deep links): generic requirements; a client profile table rendered from the store (C1); "Reference client #1" with the existing Betaflight parameter tables and the GPS Rescue diagram; the 25 mW range note; MAN-09; MAN-10 wording. |
| R7 | MUST | **§6.1.8 Emergency tab** rendered from `VtolContent.emergencies` with `VtolRender` (same content as the Tools modal). |
| R8 | MUST | **§6.1.9:** Crew Training (GCS app, IP-video latency, failsafe practice); Callouts (from `VtolContent.callouts`); Maintenance (relay PCB items, connectors, firmware log, periodic tests 5 and 9; fix "all 4" → 3 motors); Mission Planning (band-dependent altitude guidance, operating area = video ∩ RC, slot D13, MAN-08 home at arming, S-04 REL wording); Pre-Arm Ref (new "Relay & GCS app" section: alarm ids/texts from the plan §7.5/§14.2, bridge states). |
| R9 | MUST | **Glossary** additions per §6.1.1. Remove obsolete entries or reword them (CVBS/HDMI as in the new chain, ELRS bands any). |
| R10 | MUST | **Defect fixes:** MAN-05 (3 motors, `Q_FRAME_CLASS 7 = Tri`, no cruise motor); MAN-11 captions; MAN-12 (search scrolls to and highlights the match; `location.hash` deep links `#tab` and `#tab/anchor`; last tab persisted; dropdown closes only on scroll > 40 px); MAN-13 (pre-arm values flagged "verify against param file — TBD date"); MAN-14 is WP07's (leave the gauge); MAN-15 (header revision/date from `VTOL_VERSION`). S-04 REL wording everywhere; S-07; no "AGL" for home-relative values. |
| R11 | MUST | Use `VtolCommon` helpers; escape dynamic text; no old-relay terms outside a clearly marked "History: previous relay (removed)" note, if you add one (optional); TBD placeholders for unknowns. Mobile layout and nav groups updated for the new tab. |
| R11b | MUST | **PM corrections found during WP05/WP08a (safety-relevant):**<br>(a) `Q_TRANS_FAIL_ACT` = 0 means **QLand** in current ArduPlane (`quadplane.cpp`: "-1 Warn only, 0 QLand, 1 QRTL"), **not** QHOVER. Correct the Aircraft transition table, Mission/transition text and the emergency card (the card comes from `data/content.js`) with a "verify against firmware version" marker.<br>(b) **GCS app restart:** describe the two start paths from C2.1 (Normal start for a client on the ground; **RESUME (client airborne)** with the arm switch ARMED and typed confirmations). Never instruct DISARMED for an airborne client. |
| R12 | MUST | Tests: a forbidden-terms scan of `manual.html` (outside the optional history note); every nav item resolves to an existing tab; the search jump finds a term inside a non-active tab (pure helper function tested); hash parsing. `html-validate` must not add errors compared with `main`. |

## Acceptance (verifier)

- Tests pass.
- jsdom: the manual loads; every tab opens via nav and via `#hash`.
- The Emergency tab content equals the Tools modal content (same ids).
- The failsafe section matches plan §4 exactly in meaning.
- Spot-check 15 random technical statements against the plan and the relay design: there must be no invented values.
