# WP06 verification — round 1
VERDICT: APPROVED

Worktree `S\wt\WP06`, branch `wp/06`, HEAD `4a66df3`, merge-base `ab6b875` (main is now `65de3be`; the only main change since the base is in `docs/tasks/`).
Verifier: independent; nothing was changed in the worktree. Line numbers are `manual.html` / `data/content.js` at `4a66df3`.

## Scope (changed files)

| File | In brief? | Judgement |
|---|---|---|
| `manual.html` | owned | OK |
| `data/content.js` | owned ("additions only") | 4 edits, all PM-authorised: emerg-app memory item softened (:255), callout "within 3 s" (:396), `build-battery-power` power-up order (:74), GPS Rescue "landing phase from 4 m" + VERIFY (:206). No structural change, no new keys. |
| `test/manual/{helpers,manual,nav,amendments}.test.js` | owned | OK |
| `docs/tasks/reports/WP06-IMPLEMENTATION.md` | owned | OK |
| `test/content/content.test.js` | **not owned** | One regex (line 107) changed from `/RESUME — ARM SWITCH ARMED/` to `/IF TAKING OVER: RESUME ONLY — ARM SWITCH ARMED/`. Required by the permitted softening of the emerg-app immediate item; every other F1 assertion (NEVER NORMAL START, airborne blocks never instruct DISARMED) is unchanged. Minimal, justified in the report §4/§5.6. **Accepted.** |

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `#fm-intent` first in Flight Modes :524-525 (rendered `designIntent`, re-id'd `fm-design-intent` :2238); failsafe table rendered :543/:2239; D7 :544; SIYI-loss card :545-551; S-02a/b/c :554-575; S-03 table :577-589; S-01a TBD test :591-597; client chain rendered :600 + D6 :601; mode table :527-539 "usable only within close range" | Old RC cascade SVG gone (test + grep). Semantics match plan §4/§6.1.5 exactly. |
| R2 | PASS | Overview :299-349: mission sentence :313 (verbatim plan §6.1.2), crew table :329-344 (EdgeTX as USB joystick, RF OFF), telemetry note :345, T2 Cruza, `client_drone.svg` :307, `<picture>` webp+jpg :303/:458/:869/:873/:1507 | All referenced images exist. |
| R3 | PASS | RF & Comms :352-519: links table + D1 :355; RC/video/camera/MP/915 chain strips :366-455; freq table rendered `freqTable()` :2160 with "Permitted in Norway" = `TBD — Nkom check (Q14)` on every row (jsdom: 4/4); network from `VtolContent.network` :2241; bandwidth FPV/camera mode TBD (Q13) :474-483; latency tables = relay-design tables with "Estimate" basis and Measured TBD :485-517 | 915 text corrected (expected, no action; close-in → MP QLOITER/QLAND; S-01a TBD). |
| R4 | PASS | Relay tab :609-772 under Aircraft ▾ (nav :251): boards + independence :613-626; P1–P5 VLAN/priority :628-640; CAM_ENABLE current design :643-653 **and** FIRMWARE REQUEST variant :654-667; indicators :697-709 (PG8/PG10/PG0; bridge LEDs TBD); connectors :711-727 (= relay design table); power 6–26 V, VBAT_TX 6–16.8 V, consumption TBD :730-740; firmware versions :742-753; tests 1–9 with Measured TBD :755-770; slots D2 :614, D4 :684, D5 :683, D8 :669, D8b :668, D15 :695 | |
| R5 | PASS | Power-up 8 steps :1032-1043 (plan §6.1.6 order, Nomad last, TBD bench test); carrier-only note incl. DISARM hazard :1046; relay ops + app status bar duty :1065-1072; camera protocol + callouts :1074-1080; start paths :1082-1093; bind once :1095-1101; EdgeTX RF-off safety box :1103-1112 | MAN-07: pre-arm "RC failsafe on" now "switch the 915 Nomad on (power-up step 8)" :1159; "reversing the sequence" dropped. MAN-06: 3 s and "into wind" only (manual + content callout :396). |
| R6 | PASS | Clients tab :1464-1622 (id `clients`; `ManualCore.ALIASES = {fpv:'clients'}` :2052; jsdom `#fpv` → clients); requirements :1469-1480; profile table rendered from store `clientTable()` :2180; Reference client #1 BF tables :1499-1563 + GPS Rescue SVG :1566-1605; 25 mW / 0.7 km note :1485 | MAN-09: size 7" vs 5" VERIFY :1517; 24.6 V explained as BF `vbat_full_cell_voltage = 410` :1536. MAN-10 wording :1562 exact. |
| R7 | PASS | Emergency tab :1126-1131 rendered by `VtolRender.designIntent` + `emergencies` + `emergencyPills` :2245-2248 | jsdom: manual and Tools modal have identical `#emerg-list [id]` lists (design-intent, 8 cards, note-915-lost) and identical IMMEDIATE texts; same pills. |
| R8 | PASS | Crew :1395-1461 (GCS app, two start paths, IP latency ≈200 ms estimate, failsafe practice, RESUME drill, D14); Callouts rendered :1769/:2249; Maintenance :1625-1756 (relay PCB items, connectors, Ethernet leads, CRSF/antenna, VRX, firmware log, periodic tests 5 and 9, "all 3" motors); Mission Planning :1774-2013 (band-dependent guidance :1809, video ∩ RC + D13 :1792-1794, MAN-08 :1959/:1964/:2003, REL, into wind :1978); Pre-Arm "Relay & GCS app" :1176-1228 (18 alarm ids/texts, bridge states incl. UNREACHABLE, refusals, exit codes, D5, D12) | |
| R9 | PASS | Glossary :1232-1391; all §6.1.1 terms present in "Relay, Video & GCS App" :1283-1326; CVBS/HDMI/ELRS/FBWA/RTL/QLAND reworded | |
| R10 | PASS | MAN-05 :778/:786 (3 motors, `7 = Tri`, no forward-thrust motor); MAN-11 captions :304/:308/:459/:870/:874; MAN-12 nav :2253-2393 + ManualCore :2024-2127; MAN-13 :1139 + VERIFY in rows; MAN-14 untouched (gauge :895-929, WP07); MAN-15 header/footer from `VTOL_VERSION` :2234/:2236 | No "m AGL" anywhere; AGL only in glossary / REL≠AGL notes. |
| R11 | PASS | Scripts :2019-2023; `VtolCommon.escH`/`toggleCleanup` :2132/:2151; all dynamic text escaped (jsdom XSS client-name test); no history note, no old-relay terms (grep + test); nav groups updated; tap targets ≥ 44 px (`nav button{min-height:44px}` covers dropdown items) | See MINOR F7 (two copied hex colours). |
| R11b (a) | PASS | Q_TRANS_FAIL_ACT = 0 → QLand in Aircraft :847 (VERIFY), Mission table :1016 (VERIFY), Mission alert :1025, Procedures alert :1057 ("VERIFY against the firmware"), Mission Planning :1980 (VERIFY), glossary :1279 (VERIFY), emergency card + failsafe row from content (VERIFY) | jsdom: every rendered Q_TRANS_FAIL_ACT sentence says QLand; none says → QHOVER. See MINOR F1. |
| R11b (b) | PASS | Start paths card :1082-1093; crew :1432/:1445; Pre-Arm :1181-1182/:1219; carrier-only :1046; emerg-app card (content) | jsdom: no rendered block combining airborne/mid-air/flying with DISARMED except as a prohibition. |
| R12 | PASS | `test/manual/manual.test.js` (forbidden-terms scan, nav↔panels, ids, content-not-duplicated, safety facts), `nav.test.js` (hash parsing, aliases, initialTab, 40 px rule, search helper finds term in non-active tab with exact start/length), `amendments.test.js` | html-validate: 0 errors (main: 119). |

All MUST requirements pass.

## Contract results

- **C1 / C1.4:** profiles read via `VtolStore.load()` and `VtolRender.ctxFrom()`; `null` → amber TBD (`tv`/`lv` :2144-2148); tombstoned records filtered (`live()` :2141); default profile values shown match C1.3 (R5 · 5806 MHz · 25 mW · 2.4 · GPS Rescue 8 sats / 2.5 s). Storage event re-renders (jsdom: band 868 / 5732 MHz followed). PASS.
- **C2 / C2.1:** manual describes `app.start_path` normal/resume, never auto-resume, RESUME for "GCS app failure" recovery (:1082-1093), port 47800 read-only API (glossary :1320, network row). PASS.
- **C4:** `VTOL_VERSION` drives header/footer/param-file markers; `VtolCommon` helpers used; no private `escH`. PASS.
- **C5 / C5.1:** `designIntent`, `failsafeTable`, `clientFailsafeChain`, `network`, `emergencies`, `emergencyNotes`, `callouts`, `pipelines`, `sdp` all rendered with `VtolRender`; no raw `[[…]]`, `{token}` or `**` markup in rendered text (jsdom). PASS.

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/        → tests 163, pass 163, fail 0
npx --prefix S/jsenv html-validate manual.html                        → no errors (exit 0)
npx --prefix S/jsenv html-validate <main:manual.html>                 → no-implicit-button-type 24, no-inline-style 46, no-raw-characters 9, prefer-tbody 40 (=119)
git merge-tree --write-tree main HEAD                                  → ea73e8e…, exit 0 (clean merge into current main 65de3be)
node S\verify\WP06\smoke.js S\wt\WP06                                  → PASS 197 FAIL 0
```

The new tests exercise real logic (pure `ManualCore` loaded from the page; static safety scans; PM amendment checks over every content string), not trivial asserts.

## Smoke tests (own script `S\verify\WP06\smoke.js`, jsdom 30.1.3, scripts served from the worktree via a request interceptor, URL `https://melonno.github.io/vtol-manual/manual.html` and `index.html`)

- Load: no script errors (only the blocked Google-Fonts stylesheet is ignored); header `DOC-RC-001 · REV 2.0.0-dev · 2026-10-16 · …`, footer `PARAM FILE TBD`; default tab Overview; all 10 rendered blocks non-empty.
- Nav: all 15 nav items clicked (dropdown opens, tab activates, exactly one active panel, `#hash` written, `vtol_manual_tab` stored, dropdown closes, group button active).
- Hash: `hashchange` for all 15 tabs; `#fpv` → Client Drones; `#relay/relay-ports` and `#emergency/emerg-app` scroll to the anchor; invalid hash ignored; initial `#procedures/gcs-app-start`; stored tab restored; hash beats stored tab.
- Search: `KSZ8795` from Overview → result click opens the non-active tab, wraps the match in `mark.search-hit`, scrolls to it, closes results; "Restart the MP UDPCI" opens the closed emergency clean-up and clears the previous mark; `<img onerror>` query escaped; SVG text found.
- Dropdown: still open after 30 px scroll, closed after 45 px.
- Slots D1–D15 (incl. D8b) present.
- Safety on rendered text: ≥ 4 Q_TRANS_FAIL_ACT sentences, all QLand; no "m AGL", no 4 motors / cruise motor / T2 Ranger, `7 = Tri` present, no "FBWA (1.5 s)" / "AUTO only" / 2 s transition; failsafe table semantics (RTL, all modes, THR_FAILSAFE None); 915 note present and not primary.
- Emergency tab vs Tools modal: identical id lists and IMMEDIATE texts (8 cards), identical pills; pill jump writes `#emergency/<id>`; clean-up toggles. `index.html` loads without errors.
- Profiles: XSS client name rendered as text only; header band, frequency table follow a `storage` event; Nkom TBD on all 4 frequency rows.

## WP08a cross-check (committed `gcs/README.md` at `wp/08a` HEAD `67643e1`; identical to the working copy)

Matches: all 18 alarm ids, texts, severities and default conditions (300 ms, 100 ms stale, 2 s telemetry, LQ 70 %, 3.50 V/cell, 8 sats, 2 ms jitter / skipped slot, 1 s camera mismatch, RTT threshold TBD/inactive); start paths and keys (`f`, `r`, `--mode fpv`; `R`, `--resume`, typed `RESUME` within 15 s, `THROTTLE` at minimum, refused with arm SAFE, values moved, already sending); carrier-only guard (`NOCLIENT`, 30 s client-telemetry window, `LANDED` after an FPV stream, DISARM hazard); exit codes 2/3/4/5; `SetThreadExecutionState` / lid; MAVLink Mirror with write access off; `failsafe_timing`; `video.status_bits_min_fw_ver`; UNREACHABLE before streaming; camera key `k` and refuse-while-armed default. No contradiction found; only the under-specifications in F3.

## Technical spot-check (35 statements → source)

| # | Statement (manual / rendered) | Source | OK |
|---|---|---|---|
| 1 | SIYI loss → RTL after 5 s, all modes (FS_GCS_ENABL 2, FS_LONG_TIMEOUT 5, FS_LONG_ACTN 1) | plan §4 S-02, §13.1 | ✓ |
| 2 | 915 loss: no action, THR_FAILSAFE = 2 | plan §4 S-01, §13.1 | ✓ |
| 3 | FS_SHORT_ACTN 0 = CIRCLE/no change, FBWA = 2 | plan §13.1 | ✓ |
| 4 | Q_TRANS_FAIL_ACT 0 = QLand (-1 warn, 1 QRTL), VERIFY | plan §13.1, brief R11b | ✓ |
| 5 | Q_TRANS_FAIL 4 s, Q_TRANSITION_MS 3000, Q_BACKTRANS_MS 10000 | main manual :530-533 | ✓ |
| 6 | Q_FRAME_CLASS 7 = Tri, M1/M2 tilt + M4 tail | plan §4 S-07, MAN-05 | ✓ |
| 7 | RTL_ALTITUDE 120 m above home (REL); Q_RTL_ALT 70, MIN 35 | plan §13.1; main manual | ✓ |
| 8 | BATT_CRT_VOLT 22.2 V → Loiter→QLand; manual RTL 23.0; hard 22.5 | plan §6.1.5; C1 settings | ✓ |
| 9 | Q_ASSIST_SPEED 9 m/s, Q_ASSIST_ALT 25 m (reference VERIFY) | main manual | ✓ |
| 10 | THR_FS_VALUE 950 | main manual | ✓ |
| 11 | AIRSPEED_CRUISE 13 / MIN 11 / MAX 22 m/s, TRIM_THROTTLE 35 % | main manual | ✓ |
| 12 | rc_up 36 B, 200–250 Hz, UDP 5770 | relay design §Firmware; plan §3.3 | ✓ |
| 13 | Bridge: no CRSF until 5 consecutive valid packets; ModelID ×3 | relay design state table | ✓ |
| 14 | T_hold start 250 ms → FAILSAFE → WAIT_GCS | relay design | ✓ |
| 15 | G0 watchdog about 100 ms | relay design | ✓ |
| 16 | CRSF 400 kbaud; RC frame 26 B ≈ 0.65 ms | relay design | ✓ |
| 17 | P1 HM30 · P2 W5500 · P3 camera · P4 spare · P5 N6 RMII; VLANs; egress RC→video→camera | relay design §Ethernet; plan §3.4 | ✓ |
| 18 | CAM_ENABLE bit 0, applied within one packet, default off, forced off on stream loss, read-back in 10 Hz status | relay design; plan §3.4 | ✓ |
| 19 | Client-gated camera table (firmware request) | plan §3.4 item 3 | ✓ |
| 20 | N6 LEDs PG8 / PG10 / PG0 | relay design pin map; plan §6.1.4 | ✓ |
| 21 | Connectors table (XT30, JST-GH 4-pin pinouts, SMA + JST-GH 2-pin, STDC14, SWD, 8-pin spares, boot jumpers) | relay design §Connectors | ✓ |
| 22 | VIN 6–26 V (full 6S 25.2 V) | relay design; plan §3.4 | ✓ |
| 23 | Nomad XT30 6–16.8 V; > 250 mW needs XT30 (2S–4S) | plan §3.4 item 4 | ✓ |
| 24 | Acceptance tests 1–9 with pass criteria | relay design §Bring-up | ✓ (verbatim) |
| 25 | PAL 704×288, 9 slices, 50 Hz, 18.4 ms; NTSC 704×224/240, 7 slices, 59.94 Hz, 15.3 ms | relay design | ✓ |
| 26 | Resend last field after 25 ms; decoder reset after > 1 s | relay design | ✓ |
| 27 | Latency rows (18.4 ms, 0.5 ms, 0.8–2.4 ms, 150–180 ms est., 10–50 ms, 1–8 ms, 4–5 ms, < 1 ms) | relay design §Latency | ✓ |
| 28 | RC uplink ≈ 100–130 kbit/s (64 B × 200–250 Hz) | relay design | ✓ |
| 29 | 25 MHz harmonics on 5800 MHz and near GPS L1 1575.42 MHz | relay design §Layout | ✓ |
| 30 | UDP 5600 single listener → fan-out 127.0.0.1:5601 / 5602 | plan §7.4; C3 | ✓ |
| 31 | MP UDPCI 192.168.144.12 : 19856; camera rtsp .26:8554/main.264 | plan §3.3 | ✓ |
| 32 | IP-video latency ≈ 200 ms or more (estimate) | plan §6.1.9 | ✓ |
| 33 | 25 mW VTX ≈ 0.7 km at boresight | plan §6.1.7 | ✓ |
| 34 | App alarms: 300 ms status, LQ < 70 %, 2 s telemetry, 2 ms jitter, 1 s camera mismatch, 3.50 V/cell, 8 sats | plan §7.1/§7.5/§14.2; WP08a README; BF dump `vbat_warning_cell_voltage = 350`, `gps_rescue_min_sats = 8` | ✓ |
| 35 | Arm on CH5 (AUX1, 1700–2100) | BF dump `aux 0 0 0 1700 2100`; README `interlock.arm_channel = 5` | ✓ |
| 36 | GPS Rescue: 30 m climb, 100 m, 7.5 m/s, 20 m descent dist, 1.5 m/s, landing 4 m (VERIFY), 15 m min dist, throttle 1100–1700/1300, stick threshold 30 % | BF dump :666-684, :600; main manual | ✓ (see F6) |
| 37 | Reference client battery 21.0 V warn (3.5), 19.8 V min (3.3), BF full 24.6 V (4.10) | BF dump :606-608 | ✓ |
| 38 | Wind 5 / 8 / gust 10 m/s | C1.4 settings; main manual | ✓ |
| 39 | Mission planning values (WP1 20–30 m, WP2 50–80 m / 100–200 m / 300 m+, WP5 400 m+, 5 m zone, ±2 m, 60 m corridor, orbit 150–250 m, relay-altitude table) | main manual (relabelled REL) | ✓ |
| 40 | Maintenance values (1 mm nick, ~2° slop, 0.05 V / 0.1 V, 6000 mAh, 1C 7 A, 22.8 V storage) | main manual | ✓ |

No invented numbers found. Unknowns are amber TBD/VERIFY.

## Findings

1. **MINOR** — `manual.html:1025` (Mission tab alert): "The automatic action at 4s is **QLand at the current position**" carries no VERIFY marker, and the Procedures alert `:1057` has "(VERIFY against the firmware)" only as plain text, not the amber `.warn-val` style used elsewhere. R11b(a) asks for a visible marker on each correction. Expected: add `<span class="warn-val">VERIFY</span>` in both places (the table row `:1016` already has one).
2. **MINOR** — `manual.html:566` (S-02b card): "The GCS companion app **never sends MAVLink**". True for the WP08a headless runtime and identical to its README, but plan §14.4 / WP08b plan a display-only client MAVLink output to Mission Planner with its own sysid. Expected: phrase the rule as the safety invariant ("never sends carrier-bound MAVLink and never uses sysid 255"), so it stays true after WP08b.
3. **MINOR** — `manual.html:1194` (`rtt_rising_camera`): described as "RTT rising compared with before (threshold TBD)", which reads as inactive; the committed WP08a README defines an active default rule (median of the last 5 s above the p99 of the 5 s before; `alarms.rtt_rise_ms` optional, TBD). Also trivial omissions: `rc_stream_stopped` cause omits thread death (`:1182`); RESUME-refused list omits "arm/throttle channel has no input" (`:1219`). Not contradictions; align with the README when WP08a/b settle.
4. **MINOR** — Telemetry-stale condition is shown two ways: rendered callout `co-telemetry-lost` (content.js:411) "while the bridge is in RUN" (plan §14.2) vs Pre-Arm `:1188` "In FPV mode" (README). Harmonise via the content owner.
5. **MINOR** — `manual.html:800`: stale SVG comment "Tail pod (wider, houses pusher motor mount)" contradicts "no separate forward-thrust motor" (not visible; WP07 redraws).
6. **MINOR** — `manual.html:1552-1553`, SVG `:1601`, crew `:1435`, content `emerg-client-rc`: "Altitude mode CURRENT_ALT" together with "Return altitude 100m — cruises home at 100m above the launch point". Carried over from the existing manual and the dump (so not invented), but in Betaflight 4.5 `gps_rescue_return_alt` applies to FIXED_ALT, not CURRENT_ALT. Expected: add a VERIFY marker like the landing-phase row, since it affects the client's terrain clearance.
7. **MINOR** — `manual.html:165-166`: `.emerg-pill` CSS hard-codes `#1f0a0a` and `#fff` (copied from `index.html` so the shared renderer output looks identical). Acceptable for consistency; move to variables when the CSS is shared (WP10).
8. **MINOR (observation, outside WP06 files)** — Tools checklist `build-battery-power` (section B) now says "connect at step 4", but section C (HM30, GCS app) comes after B in the checklist order. PM-accepted; consider reordering in a content WP.
9. **MINOR (nit)** — `manual.html:2285` `switchTab()` "kept for old links / bookmarks in other pages" and the string branch of `manGoTo()` `:2380` have no caller in the repo. Harmless, small dead code.

No BLOCKER or MAJOR findings.

## Approval rationale

Every MUST requirement R1–R12 incl. R11b passes with code evidence; contracts C1/C1.4, C2/C2.1, C4, C5/C5.1 are respected. The safety content matches the owner's intent (carrier fails safe only on SIYI/GCS loss, RTL after 5 s in all modes; 915 loss beyond close range is a note, with the close-in MP take-over case), Q_TRANS_FAIL_ACT 0 = QLand everywhere (never QHOVER as an automatic action), an airborne client is only ever taken over by RESUME with the arm switch ARMED, REL replaces AGL, 3 motors / Q_FRAME_CLASS 7 = Tri / T2 Cruza. 40 technical statements traced to the plan, relay design, previous manual, BF dump or WP08a README; no invented values. Emergency tab equals the Tools modal (ids and immediate actions). Navigation features work in jsdom; tests 163/163; html-validate 0 errors (main 119); clean merge into current main. The out-of-list test change is minimal and required. The report's claims match reality. Minor findings 1–9 may be addressed later.
