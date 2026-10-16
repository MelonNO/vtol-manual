# WP06 — Implementation report (manual rewrite for the new relay)

Branch `wp/06`, worktree `S\wt\WP06`, base `ab6b875`. Implementation commit `4b94a9b`, plus this report.

## 1. Summary

- **`manual.html` rewritten** for the two-board relay PCB, the GCS companion app and the owner's decisions (plan §1.1). The carrier fails safe **only** on SIYI / GCS loss (RTL after 5 s, all modes). The 915 MHz Nomad is close-range backup, and losing it is expected.
- **Shared operational content is rendered from `data/content.js`** with `VtolRender`, never copied. That covers the design intent, the failsafe table, the client failsafe chain, the network table, all emergency cards and the 915 note (same ids as the Tools modal), the callouts and the viewer pipelines. Profile values (client, links, settings) come from `VtolStore`.
- **New tabs** under Aircraft ▾:
  - **Relay Electronics** (`relay`): boards, independence rule, P1–P5, CAM_ENABLE (current design + firmware request), bridge states, indicators, connectors, power, firmware versions, acceptance tests 1–9.
  - **Client Drones** (`clients`): requirements, profile table, telemetry, Reference client #1. `#fpv` still works as an alias.
- **Safety-relevant procedures:**
  - power-up order (8 steps, TBD until bench-tested)
  - the GCS app's two start paths: normal start for a client on the ground; **RESUME (client airborne)**, arm switch ARMED, typed confirmations, never DISARMED
  - the carrier-only DISARM hazard
  - the EdgeTX RF-off safety box
  - bind once, no per-flight bind
  - the camera protocol
  - the app alarm reference
- **Defects fixed:**
  - `Q_TRANS_FAIL_ACT` 0 = **QLand** (VERIFY) everywhere
  - 3 motors and `Q_FRAME_CLASS` 7 = Tri
  - REL instead of AGL
  - transition into wind; one number, 3 s, in the manual's own text
  - home is set at arming
  - captions and photos (`<picture>` webp + jpg; `client_drone.svg`)
  - pre-arm values flagged against the param file
  - header and footer revision from `VTOL_VERSION`
- **Navigation:** `#tab` and `#tab/anchor` deep links, last tab remembered, search opens the tab, scrolls to the match and highlights it, dropdowns close only after a scroll of more than 40 px. The old RC failsafe cascade SVG is deleted. Slots **D1–D15** are left for WP07.
- `data/content.js`: the one permitted edit (emerg-app memory item softened); no new keys.
- Tests: 24 new in `test/manual/`. `node --test test/` → **160/160 pass**. html-validate on `manual.html`: **0 errors** (main: 119). jsdom smoke: **102/102**.

## 2. Requirement table

Line numbers refer to `manual.html` at `4b94a9b`.

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | Design intent first `:525` (rendered); failsafe table `:543`; D7 `:544`; SIYI-loss explanation `:545-552`; S-02a/b/c `:554-575`; S-03 `:577-589`; S-01a TBD test `:591-597`; client chain `:599` + D6 `:601`; mode table `:527-538` | The 3-position switch QHOVER / FBWB / AUTO and the left-button RTL are "usable only within close range". The S-02c procedure is MP Ctrl-F → MAVLink Inspector → RADIO_STATUS / remrssi, result TBD. S-03: `FS_SHORT_ACTN` 0 = CIRCLE / no change, not FBWA; FS_LONG_* are the GCS-failsafe action and delay. The RC cascade SVG is gone (test). |
| R2 | DONE | Overview `:299-349`: mission sentence, crew table, telemetry note, photos `:303`, `:307` | Carrier = T2 Cruza. FPV Pilot = GCS laptop + app + EdgeTX radio as USB joystick (RF OFF). The old "no telemetry visibility" alert is replaced by the CRSF-telemetry note ("callouts primary until proven"). `client_drone.svg` replaces `fpv_drone.jpg`; `<picture>` with webp + jpg and width/height everywhere. |
| R3 | DONE | RF & Comms `:352-519`: links table and D1 `:355`; RC / video / camera / MP / 915 chain strips `:366-455`; frequency table `:463` (rendered by `freqTable()` `:2160`); network `:469` + D3; bandwidth `:474`; latency `:485` | The chains carry live tokens (ELRS band, VTX channel, firmware) from the active client. Frequency table: carrier 915, client RC, client video, HM30, from the client and link profiles, with the column "Permitted in Norway" = **TBD — Nkom check (Q14)** on every row, plus the Nkom note. Co-site note: test 7 TBD; 25 MHz harmonics. Bandwidth: FPV mode / camera mode; the only known value is RC ≈ 100–130 kbit/s, the rest TBD (Q13). Latency: the relay-design tables, "estimate" labels, Measured column TBD (tests 1, 2, 6). |
| R4 | DONE | Relay tab `:609-772`: boards + independence `:613-626`; ports P1–P5 with VLAN / priority `:628-640`; camera `:642-667` (current design + **FIRMWARE REQUEST** variant); bridge states `:671-682`; video fields `:686-694`; indicators `:697-709`; connectors `:711-727`; power `:730-740`; firmware `:742-753`; tests 1–9 `:755-770` | N6 LEDs (heartbeat / decoder lock / Ethernet link, PG8/PG10/PG0); bridge LED patterns TBD (firmware). Connectors are the relay design's table. Power: 6–26 V; Nomad VBAT_TX 6–16.8 V; consumption TBD (test 8). Firmware: G0 `fw_ver` from the status packet (app / LINK tab), N6 via its console. "Measured" column TBD for all 9 tests. Slots D2, D4, D5, D8, D8b, D15, plus D11. |
| R5 | DONE | Power-up `:1032-1043` (8 steps, Nomad last, TBD marker); carrier-only note `:1046`; relay ops / app status bar duty `:1065-1072`; camera protocol `:1074-1080`; start paths `:1082-1093`; bind `:1095-1101`; EdgeTX RF-off box `:1103-1112` | **MAN-07:** one order, Nomad last. The pre-arm "RC failsafe on" fix now says "switch the Nomad on (step 8)" instead of "power TX before aircraft". The unsupported "reversing the sequence risks motor spin" is dropped. **MAN-06:** the manual's own text uses 3 s and "into wind" only. The rendered callout still says 2 s — see §5.1. |
| R6 | DONE | Clients tab `:1464-1622`: requirements `:1469`; profile table `:1482` (rendered by `clientTable()` `:2180`); Reference client #1 `:1499` with the BF tables and the GPS Rescue SVG; 25 mW note | `#fpv` → `clients` (`ManualCore.ALIASES`, tests and smoke). **MAN-09:** generic client chapter; size 7" vs 5" marked VERIFY; the "full charge 24.6 V" row is explained as BF `vbat_full_cell_voltage = 410` (the dump), next to LiPo 4.20 V/cell. **MAN-10:** "When the link returns, stick input above the threshold (30%) ends the rescue — only do so deliberately." |
| R7 | DONE | Emergency tab `:1126-1132`; `renderManual()` `:2230-2246` | `VtolRender.designIntent` + `VtolRender.emergencies(…, notes, ctx)` (full cards) + `emergencyPills`. The ids are identical to the Tools modal (jsdom compares both pages: design-intent, 8 cards, note-915-lost; identical IMMEDIATE text). `toggleCleanup` → `VtolCommon.toggleCleanup`; `emergJump` scrolls and writes `#emergency/<id>`. |
| R8 | DONE | Crew `:1395-1461` (GCS app, start paths, IP-video latency ≈ 200 ms+ estimate, failsafe practice by stopping the app, RESUME bench drill, D14); Callouts `:1759-1771` (rendered); Maintenance `:1625-1756` (relay items, connectors, Ethernet leads, CRSF, VRX, firmware log, periodic tests 5 and 9, "all 3" motors); Mission Planning `:1774+` (band-dependent guidance `:1809`, operating area = video ∩ RC + D13 `:1792-1794`, MAN-08, REL, into wind); Pre-Arm "Relay & GCS app" `:1176-1228` | Pre-Arm lists all 18 app alarm ids and texts (with condition and callout), the bridge / app states including UNREACHABLE, and app refusals and exit codes, plus D5 and D12. One filter covers all four tables. |
| R9 | DONE | Glossary `:1232-1392`; new "Relay, Video & GCS App" table `:1283` | All §6.1.1 terms (N6, G0, W5500, KSZ8795, RMII, BT.656, CVBS, PAL/NTSC, field vs frame, H.264, RTP, RTSP vs RTP, SDP, CRSF frame, ModelID, timing frame 0x3A, T_hold, LQ, RSSI dBm, packet rate, binding phrase, model match, QoS/802.1p), plus REL, VLAN, CAM_ENABLE, rc_up, Gemini, RESUME, sysid, MAVLink Mirror, Nkom, JST-GH, XT30. Reworded: CVBS (new chain), HDMI (not in the chain), ELRS (any band), FBWA (no failsafe use), MSL/AGL, QLAND, RTL, VTX/VRX, RTSP, UDP, MHz/GHz. |
| R10 | DONE | MAN-05 `:778`, `:786`; MAN-11 captions `:303-309`, `:869-875`, `:458-460`; MAN-12 nav code `:2268-2395` + `ManualCore` `:2024+`; MAN-13 `:1139` (+ VERIFY markers in rows); MAN-15 `:2234` (header) + footer; S-04 REL throughout; S-07 motors | No `\d m AGL` anywhere (test). AGL appears only in the glossary and the "REL ≠ AGL" note. MAN-14 (gauge) is untouched for WP07. |
| R11 | DONE | Scripts `:2019-2023`; `VtolCommon.escH` / `toggleCleanup`; tokens via `VtolRender.tokenValue` / `fmt` | Every dynamic text is escaped (XSS name check in the smoke test). There is no private `escH` copy (test) and no old-relay terms (test). There is no history note. Nav groups now include the new tabs; tap targets are ≥ 44 px (nav, dropdown, search, pills, clean-up buttons, filters); the header stacks below 600 px. |
| R11b | DONE | (a) Aircraft `:847`, Mission table + alert, Procedures alert `:1057`, Mission Planning step 3, glossary QLAND; emergency card and failsafe row from content. (b) Start paths `:1082-1093`; crew; Pre-Arm; carrier-only `:1046` | Every Q_TRANS_FAIL_ACT mention says QLand with a VERIFY marker (test). Airborne + DISARMED appears only as a prohibition: a static test runs per text block, and jsdom checks 17 rendered "airborne" blocks. |
| R12 | DONE | `test/manual/nav.test.js`, `test/manual/manual.test.js`, `test/manual/helpers.js` | Covered: forbidden-terms scan (history-note exclusion built in); every nav item → an existing panel and vice versa; search helper finds a term in a non-active tab and locates it exactly; hash parsing; plus content and structure checks. html-validate: 0 errors (main 119). |

## 3. Placeholders (all amber `.warn-val`)

| Where | Placeholder | Why |
|---|---|---|
| RF & Comms 915 text; Flight Modes S-01a | QHOVER behaviour on 915 loss in a manual phase | S-01a / Q15 not tested |
| Flight Modes SIYI-loss card | RTL behaviour when triggered in a Q-mode | S-02 (Q_RTL_MODE / Q_OPTIONS + SITL) |
| Flight Modes S-02c | Whether the HM30 sends RADIO_STATUS | Q2 |
| Flight Modes VTOL assist; Aircraft Q_ASSIST_ALT | Altitude reference (VERIFY) | S-04; not in the plan's verified list |
| Aircraft Q_FRAME_TYPE | Meaning for frame class 7 (VERIFY) | Not re-verified (§13.1) |
| Aircraft / Mission / Procedures / Mission Planning / glossary | `Q_TRANS_FAIL_ACT` 0 = QLand — VERIFY against firmware | R11b(a) |
| RF & Comms frequency table | Nkom column (every row); 915 power; packet rate, HM30 band and powers (profile nulls) | Q14; C1 nulls |
| RF & Comms co-site | Test 7 result, cleanest channel | Not run |
| RF & Comms bandwidth | N6 CBR, MAVLink, margin, HM30 capacity, P3 cap | Q13 |
| RF & Comms latency | Measured column | Tests 1, 2, 6; HID / jitter on the target laptop |
| Relay tab | P3 ingress limit; P4 use and priority; bridge LED patterns (5 states + link LED); VBAT_TX peak current; DBR4-as-TX supply; consumption; endurance effect; firmware versions; min fw for status bits; tests 1–9 measured | Firmware not written; not measured |
| Procedures power-up | Final order — confirm by bench test | Plan §6.1.6 |
| Procedures relay ops; Pre-Arm | RTT alarm threshold (inactive until measured); RTT-rise threshold | §7.5 "X ms"; test 9 |
| Procedures bind | GCS-app CRSF parameter menu | Needs firmware passthrough Q7a |
| Clients | Total failsafe time through the relay; Reference client video standard; size 7" vs 5" (VERIFY); GPS Rescue `gps_rescue_landing_alt` meaning (VERIFY) | Test 6; C1 null; conflicting old manual; dump vs old text |
| Pre-Arm | Param-file check date (`VTOL_VERSION.paramFile`); ARSPD_TYPE, AHRS_GPS_MINSATS, ≥6 sats, HDOP (VERIFY) | MAN-13 |
| Maintenance | Interval for periodic tests 5 and 9; where the firmware log is kept; log row values | Not in the plan |

## 4. Tests

New:

- `test/manual/nav.test.js` (9 tests): tab list and aliases (`fpv` → `clients`, prototype keys rejected); `parseHash` for `#tab` / `#tab/anchor` / encoded / invalid / unsafe anchors; `hashFor` round trip; `initialTab` precedence (hash > stored tab > default); the dropdown 40 px rule; **search finds a term in a non-active tab** with the exact start/length, empty query, limit 25, de-duplication, snippet bounds, regex characters literal; tab labels.
- `test/manual/manual.test.js` (15 tests):
  - forbidden-terms scan, about 45 patterns, outside `<section id="history-previous-relay">`
  - nav ↔ panels ↔ `ManualCore.TABS`, with no hard-coded inline tab handlers
  - unique static ids, with no clash with rendered ids
  - shared scripts loaded in order; no private escH
  - shared content rendered, not duplicated (emergency texts, callout rows, network rows)
  - Flight Modes (intent first, D6/D7, S-01a / S-02a/b/c / S-03, cascade gone)
  - Q_TRANS_FAIL_ACT = QLand everywhere
  - start paths, and airborne + DISARMED only as a prohibition
  - the Relay tab (P1–P5, tests 1–9 TBD, slots)
  - D1–D15 slots
  - RF & Comms
  - Clients / Overview / photos / defects
  - Pre-Arm alarms and states
  - Procedures (8 steps, Nomad last, RF-off box)
  - the glossary
- `test/manual/helpers.js`: loads `script#manual-core` from `manual.html` in the test's own realm.

Changed: `test/content/content.test.js` line 107. The regex now expects the softened memory item; the other F1 assertions are unchanged.

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 160  ℹ pass 160  ℹ fail 0
```

```
npx --prefix S/jsenv html-validate manual.html   → no errors (exit 0)
main (ab6b875): no-implicit-button-type 24, no-inline-style 46, no-raw-characters 9, prefer-tbody 40
```

**jsdom smoke test** (outside the repo): `node S\wp06\smoke.js [worktree]`. It loads `manual.html` (and `index.html` for comparison) at `https://melonno.github.io/vtol-manual/…`, with the scripts inlined. Result: **102 pass, 0 fail**, no script errors. It checks:

- the header and footer from `VTOL_VERSION`
- every rendered block, with no raw `[[ ]]` / `{client.}` markup
- the Emergency tab against the Tools modal (same id list, identical IMMEDIATE texts, full cards with summaries, softened item)
- every nav item: tab, hash, active state, dropdown closed
- the last tab persisted
- hashchange for all 15 tabs, `#emergency/emerg-app`, the `#fpv` alias, an initial `#relay/relay-ports`, and an invalid hash falling back to the stored tab
- search into a non-active tab: mark, scroll, a hit inside a closed clean-up opens it, the previous mark is cleared, query escaped
- the dropdown at 30 px vs 45 px scroll
- filters, the clean-up toggle and the pill jump with its hash
- a `storage` event with an XSS client name and a new VTX/band: escaped, and the tables and header follow
- slots D1–D15, images, forbidden terms in the rendered text, and airborne + DISARMED per text block

## 5. Deviations / contract issues — PM please read

1. **MAN-06 is not fully fixable inside my permissions.** The callout `co-transition-fail` in `data/content.js` says "No airspeed build after **2s**". The manual renders it from content, so the Callouts tab shows 2 s while every manual text says 3 s. Proposed one-line content edit (outside my permitted edit): `trigger: 'No airspeed build within 3s'`. This is the "2 s vs 3 s" item carried over from WP05.
2. **Power-up order vs the Tools checklist.** The manual uses the plan §6.1.6 order (carrier at step 4, Nomad last), marked TBD until bench-tested. `content.js` `build-battery-power` still says "power on the carrier early for GPS". It carries its own TBD for the final order. The two should be reconciled after the bench test.
3. **GPS Rescue "motor cut at 4m".** The content card `emerg-client-rc` (from the old manual) says this. The dump has `gps_rescue_landing_alt = 4`, whose meaning I have marked VERIFY in the manual's own table. The shared card is unchanged.
4. **WP08a `gcs/README.md` was read from the WP08a working copy, which has uncommitted rework.** I used its current content:
   - the new alarm `rc_sender_dead`
   - the carrier-only guard (`NOCLIENT` / `LANDED`, 30 s telemetry check — it sends DISARM)
   - the `send_jitter_high` definition (> 2 ms late or a skipped slot)
   - RESUME details (15 s preview)
   - exit codes

   If the rework changes before merge, re-check Pre-Arm `:1176-1228`, the carrier-only note `:1046` and the start-paths card.
5. **`ManualCore` is an inline `<script id="manual-core">` in `manual.html`, not a `js/` file.** The brief's owned files do not include a new `js/` file, and a new script would also need a `sw.js` precache entry. The tests extract the block from `manual.html`. WP09/WP10 may move it to `js/manual-core.js`.
6. **Touched outside my list:** `test/content/content.test.js` (one regex line, required by the permitted content edit). No other files outside the brief were changed: no `sw.js`, no `index.html`, no new `data/content.js` keys.
7. **Not precached (WP09):** `img/*.webp` and `img/client_drone.svg`. `sw.js` was not changed.
8. **New localStorage key `vtol_manual_tab`** (per-device last tab; try/catch around all access). Not part of `vtol_store`.
9. **`CLAUDE.md`** still describes the old manual tab structure and emergency layout (docs are WP10).
10. **Duplicate id avoided.** The Emergency tab keeps the Tools modal's `design-intent` id. The Flight Modes copy is re-id'd to `fm-design-intent`.
11. **Content judgements to review** (each derived from the sources, nothing numeric invented):
    - **Camera protocol vs the app default.** The plan says "FPV pilot confirms the client is in a stable hover or landed", but the app refuses camera ON while the client may be armed. The manual says that in practice this means "landed and disarmed" until test 9.
    - **Battery rows.** Reference client: "LiPo full 25.2 V / 4.20 V" plus "BF full detection 24.6 V" (from `vbat_full_cell_voltage = 410`), instead of a single "full 24.6 V".
    - **Relay-altitude table.** Values kept from the old manual, relabelled "REL over flat ground", with the terrain note. The band paragraph adds "the more demanding link sets the altitude".
    - **REL labels.** `Q_RTL_ALT` / `Q_RTL_ALT_MIN` are marked REL (S-04).
    - **Frequency table.** It shows the first link profile of each kind and names it.

## 6. Notes for the verifier

- **Run:** `node --test test/`; `node S\wp06\smoke.js S\wt\WP06` (needs `S\jsenv`); `npx --prefix S/jsenv html-validate manual.html`.
- **The page was generated** by `S\wp06\build.js`. It concatenates `S\wp06\head.html, part1–4.html, tail.html` and splices the six existing inline SVGs from `ab6b875:manual.html`. In those SVGs the root `style` became a class, GPS Rescue "100m AGL" became "100m REL", the orbit labels were relabelled, and one comment was fixed. Edit `manual.html` directly from now on.
- **Deep links:** `manual.html#relay/relay-ports`, `#emergency/emerg-app`, `#fpv` (→ `#clients`), `#flightmodes/gcs-heartbeat`.
- **Emergency = Tools modal:** compare `[...document.querySelectorAll('#emerg-list [id]')].map(e=>e.id)` on both pages.
- **Profile-driven parts:** change the active client in Tools → PROFILES (other window). The manual re-renders on the `storage` event: the header, the frequency table, the chain tokens, the client table and the emergency tokens.
- **Search:** type `KSZ8795` on the Overview tab → click a result → the Relay or Glossary tab opens with the match highlighted. Typing `Restart the MP UDPCI` opens the SIYI card's clean-up.
- **Spot-check sources:**
  - relay design: ports, connectors, power, states, tests 1–9, latency tables, field timing, LEDs
  - plan: §3.3/§3.4, §4, §6.1.x, §7.3/§7.5, §13.1, §14.2
  - `gcs/README.md` (WP08a working copy): alarms, start paths, carrier-only, keys and exit codes
  - `docs/FPV_betaflight_dump.txt`: BF values
