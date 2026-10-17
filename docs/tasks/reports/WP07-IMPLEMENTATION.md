# WP07 — Implementation report (diagrams and graphics)

Branch `wp/07`, worktree `S\wt\WP07`, base `006001d`. Implementation commit `ee3a497`, plus this report.

## 1. Summary

- **16 standalone diagrams** in `img/diagrams/` (D1–D15 and D8b): `d01-system-overview.svg` … `d15-video-field-timing.svg`.
  - **Phone-native layout:** a 400-unit-wide viewBox, with text of at least 14 units. At a 360 px viewport (332 px content) that renders at ≥ 11.6 px, so no horizontal scroll is needed. Desktop caps them at 560 px.
  - **Accessibility and palette:** each file has `role="img"`, `<title>`, `<desc>` (a full text version of the diagram), a palette comment mapping every hex value to its CSS token, and a `Sources:` comment.
  - **Size:** each file is 6.6–14 KB.
- **`js/diagrams.js` (global `VtolDiagrams`, Node-exportable)** holds pure SVG generators: `batteryGauge`, `battTrend`, `battSparkline`, `windCompass`, `timeChart` and `gpsRescue`.
  - Colours come only from CSS variables.
  - Every inserted text is XML-escaped; null values are drawn as "TBD".
  - Battery thresholds come from `ToolsCore.packThresholds` and `minVoltLevel`.
- **`manual.html`:**
  - All 17 slots are filled (D5 appears twice). Each has a lazy `<img>` with width/height, a descriptive alt text, a caption, and a tap-to-open-full-size link.
  - The four remaining inline SVGs (motors, mission profile, line of sight, orbit) are redrawn with CSS variables, role/title/desc, text ≥ 13 units and a min-width scroll wrapper. The quad icon is one `<symbol>`.
  - The battery gauge (MAN-14) and the GPS Rescue trajectory are now generated from the profiles.
- **`index.html`:** the battery trend, sparkline, wind compass, `.bin` charts and session-log charts now come from `VtolDiagrams`. They show profile thresholds, y-axis ticks, date tooltips, the into-wind hint, a gust-spread arc, the mode-timeline overlay and transition / failsafe event markers.
- **R5b carry-overs** F1–F9 and the WP08b UDP 5600 note are done in `manual.html` and `data/content.js`.
- **Tests:** 21 new (3 files in `test/diagrams/`). `node --test test/` → **215/215 pass**.

## 2. Requirement table

Line numbers refer to `ee3a497`.

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `img/diagrams/*.svg` (16 files); content tests `test/diagrams/files.test.js` | **D1** is the §3.1 draft, laid out vertically: all four links, P1–P5, HM30 band TBD, and "carrier failsafe: SIYI / GCS loss only". **D2:** both boards; KSZ8795 P1 HM30 / P2 W5500 (capacitor-coupled) / P3 camera / P4 spare / P5 RMII N6; the VLAN map (P2↔P1 only, P3/P4→P1 and P5 if needed); P1 egress priority; power (VIN 6–26 V, fuse/FET/TVS, 3.3V_RC, VBAT_TX, VIN via the B2B connector); CRSF at 400 kbaud; SPI 32 MHz; CAM_ENABLE; LEDs PG8/PG10/PG0, bridge LEDs TBD. **D3:** every IP and port, including 5600/5601/5602/5770/19856/47800/8554, with the MP-not-on-5600 note. **D4:** relay-design RC latency table. **D5:** relay-design state table, watchdog, UNREACHABLE, LED pattern TBD per state. **D6:** chain with T_hold 250 ms, the module reaction and RX timeout TBD, and the total per cause TBD (test 6). **D7:** §4 / §6.1.5 matrix plus the SIYI-loss timeline, with QLand (VERIFY) on transition fail and no RC-loss action. **D8:** not to scale, values TBD (Q13). **D8b:** CAM_ENABLE path, read-back, the rules, and the firmware-request variant marked as not implemented. **D9–D15:** see §5. |
| R2 | DONE | `manual.html:369, 485, 558, 615, 628, 682, 683, 697, 698, 709, 742, 846, 921, 1090, 1105, 1277, 1631`; CSS `:177-196` | Each slot keeps `<div class="diagram-slot" data-diagram="Dx">` (the WP06 tests are unchanged) and holds `<figure class="dg"><a><img loading="lazy" decoding="async" width height alt></a><figcaption>`. The dashed placeholder style is removed. |
| R3 | DONE | Sprite `manual.html:233`; motors `:807`; mission `:873`; LOS `:1650`; orbit `:1660`; generated GPS Rescue `:1442` + `renderDiagrams()` `:1965`; `VtolDiagrams.gpsRescue` `js/diagrams.js:347` | **All diagrams:** CSS variables only; role/title/desc; min-width classes `.mw-560/600/780` keep text ≥ 11 px inside an overflow-x wrapper (tested); the quad icon is drawn once as `#sym-quad` and used three times. **Motors:** tilt axis, rotation arcs on M1/M2/M4 labelled **CW / CCW: TBD**, and a side-view inset (0° VTOL, 80° `Q_TILT_MAX`, fully forward in FW; rate 40°/s). **Mission:** REL m scale 0–150, the 7-WP template ranges, the 100–200 m / 300 m+ / 400 m+ distances, the corridor clear to 60 m, the abort branch (3 s → QHOVER, 4 s auto QLand VERIFY) and the back-transition glide ≈100–130 m (10 s). **LOS:** both links; the Fresnel ellipse (low: line clears but the zone is blocked; high: clear); the r1 formula and k = 0.6; bands from profile tokens. **Orbit:** new labels, ≈70° patch beam cone, always-covered inner zone, body-shadow point, wind drift, clockwise orbit. **GPS Rescue:** delay and minimum sats from the Reference client #1 profile, the other values from the BF dump. If another client is active, the caption names that client's failsafe. |
| R4 | DONE | `js/diagrams.js:67`; manual `#ac-batt-gauge` `:862` + `renderDiagrams()` `:1965` | Built from the pack profile and the settings. **Carrier markers:** BATT_LOW (only if set — read from an imported param file's `BATT_LOW_VOLT`, otherwise a "not set (0)" note), manual RTL, hard limit, BATT_CRT, storage. **Other packs:** longevity floor and storage; Li-Ion/LiFe storage is TBD. **MAN-14 zones:** below BATT_CRT / past the hard limit / RTL now / operate (this zone ends at the RTL voltage). Numbered markers are staggered, with a legend list. The manual uses the active carrier pack. The Tools page loads the generator too (`VtolDiagrams.batteryGauge`); no Tools UI uses it yet. |
| R5 | DONE | `index.html:965` (trend), `:981` (sparkline), `:1786` `binChart`, `:1791` `binOverlay`, `:1896` (charts with overlay), `:2321` (compass); generators `js/diagrams.js:152, 199, 236, 287` | **Trend:** profile threshold lines with stacked labels, y-axis ticks, date / flight / level in a `<title>` on each point. **Sparkline:** full / floor tick values, dashed profile threshold, `<title>` with date and values. **Compass:** runway bar and chevron toward the FROM direction plus the text "▲ INTO WIND 250° WSW"; the gust-spread arc is described in §5. **.bin charts** (voltage, altitude, airspeed): a mode-timeline strip and background bands (VTOL green, FW accent), plus dashed markers for transition / failsafe / battery events from `ToolsCore.binAnalyze` (MSG and mode reasons) with a `<title>`, and a key under the voltage chart. **Session-log charts** get the axes too. Every chart has a min-width inside an overflow-x wrapper. |
| R5b | DONE | See below | **F1:** amber VERIFY added to both QLand statements (`manual.html:902`, `:934`). **F2:** `:580` "never sends MAVLink to the carrier … display-only client stream to Mission Planner with its own sysid (never 1 or 255)". **F3:** `:1071` matches `gcs/README.md` (median of the last 5 s above the p99 of the 5 s before, or + `alarms.rtt_rise_ms`, TBD). **F4:** one wording in the manual (`:1065`) and in the content callout (`data/content.js:411`): "No client telemetry for > 2 s while the app streams RC in FPV mode". **F5:** the pusher comment is gone with the redraw (tested). **F6:** VERIFY on the Altitude mode / Return altitude rows (`:1429-1430`), the crew line, the content card `emerg-client-rc` (`data/content.js:206`) and the generated rescue caption. **F7:** `.emerg-pill` uses `var(--surface)` / `var(--text)` (`:165-166`). **F8:** see §5.3. **F9:** `switchTab()` and the `manGoTo` string branch removed (no callers). **WP08b:** MP holds UDP 5600; with the fan-out running MP must not listen on 5600 (HUD 5602, viewer 5601). Stated in the manual video section `:426`, content `gs-client-video` note `:87`, `net-fanout` `:371`, D3 and D12. |
| R6 | DONE | `test/diagrams/xml.js`, `generators.test.js`, `files.test.js` | See §4. |

## 3. Placeholders (TBD / VERIFY)

| Where | Placeholder | Why |
|---|---|---|
| D1, D9, LOS caption | HM30 band TBD | Link profile `freqMHz` is null (C1.3) |
| D2, D5, D12 | Bridge LED patterns TBD | Firmware (plan §6.1.4) |
| D3 | Laptop `.X` final, N6 / bridge IPs (e.g. .20 / .21), P4 use and cap | Q3, §3.3 |
| D4 | HM30 uplink latency; end-to-end RC latency | Not measured (UDP echo) |
| D6 | TX module reaction, client RX timeout, total per cause | Relay-design test 6 |
| D7 | Q-mode RTL behaviour; Q_TRANS_FAIL_ACT QLand VERIFY | S-02 SITL; R11b |
| D8 | N6 CBR, MAVLink, margin, P3 cap, HM30 capacity | Q13 |
| D8b | P3 ingress limit | Q13 |
| D9 | All antenna positions and separations; test 7 result | Not documented; own photos to follow (§9.1) |
| D10 | Screen assignment ("per crew agreement"), distances per site | Not specified in the sources |
| D11 | HM30 / camera / VRX supplies; Nomad peak current | Not in the relay design / plan |
| Motors SVG | Prop rotation CW / CCW: TBD — confirm on the airframe | No source (see §5.1) |
| Motors SVG | `Q_TILT_MAX` meaning VERIFY | See §5.1 |
| GPS Rescue | CURRENT_ALT vs the 100 m return altitude VERIFY | F6 |
| Gauge | BATT_LOW "not set"; non-LiPo storage TBD | Param file; `storageVoltPerCell` is a LiPo value |

## 4. Tests

New, in `test/diagrams/`:

- **`xml.js`:** a minimal XML well-formedness checker. It checks the root element, nesting, quoted unique attributes, entities, no `--` in comments and no stray `<` / `&`. It is not a test file itself.
- **`generators.test.js` (9 tests):**
  - the checker rejects broken markup
  - every generator returns well-formed SVG with role=img and a `<title>`, no hex colours, no NaN, and font-size ≥ 11
  - the gauge markers for carrier and client, BATT_LOW only when set, the MAN-14 zones, profile-driven values, null settings → TBD, XSS labels escaped
  - the trend: thresholds, ticks, a date in every `<title>`, the last 12 flights
  - the sparkline title and ticks
  - the compass into-wind hint and gust arc
  - `timeChart`: mode bands, coloured event markers, escaping, degenerate input
  - `gpsRescue`: values from the profile, null → TBD, `<use href="#sym-quad">`
- **`files.test.js` (12 tests):**
  - the exact 16 files: ≤ 60 KB, well-formed, role/title/desc, palette-only hex with the mapping comment, a sources comment
  - the readability rule (min font × 332 / viewBox width ≥ 11)
  - content checks for D1–D15 against the plan and the relay design (ports, states, failsafe intent, TBDs, no FBWA/1.5 s)
  - a forbidden-term scan
  - manual slots: 17 slots, image, alt, width/height, caption
  - the inline SVGs: well-formed, no hex, role/title/desc, the min-width rule, the symbol drawn once, the specific §9.2 fixes, generated containers, script order
  - the Tools chart wiring and no hex in the chart functions

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 215  ℹ pass 215  ℹ fail 0
```

Other checks:

- `npx --prefix S/jsenv html-validate manual.html` → exit 0, no errors.
- `index.html` has the same rule counts as the base.
- **WP07 jsdom smoke** `node S\wp07gen\smoke.js` → **30 pass / 0 fail**, no script errors. It checks:
  - manual: slots, gauge, rescue, no hex inline, SVG tokens, the gauge following a settings change and a param-file BATT_LOW, an escaped other active client, F2/F3/F4/F9, the WP08b note
  - Tools: trend and sparkline titles, compass, `binOverlay` classes, chart bands and markers
- Existing smoke scripts run against this tree:
  - `S\wp06\smoke.js` → 102/0
  - `S\verify\WP06\smoke.js` → 197/0
  - `S\wp11smoke\smoke.js` → 82/0
  - `S\wp05smoke\smoke.js` → 91/1. The single failure ("swipe order includes link and profiles") also fails on `main`: a stale check after WP11's new tabs.
- **Visual check:** every SVG and the affected manual tabs were rendered with headless Edge, and overlaps were fixed.

## 5. Deviations / contract issues — PM please read

### 5.1 Facts that could not be sourced (left TBD / VERIFY instead of invented)

- **Prop rotation directions.** Neither the plan, the relay design, the manual nor the ArduPilot / Heewing pages I could reach give the direction per motor. The diagram therefore shows rotation arcs labelled "CW / CCW: TBD — confirm on the airframe", plus ArduPilot's rule that the front pair must turn in opposite directions. **Owner input is needed.**
- **`Q_TILT_MAX` = 80°.** Plan §9.2 says "80° (cruise)", and the manual's Aircraft table row says "Maximum forward tilt angle".
  - The ArduPilot tilt-rotor guide says `Q_TILT_MAX` is the angle the rotors move to *during the transition while waiting for airspeed*; in fixed-wing flight they tilt fully forward.
  - The inset shows "80° Q_TILT_MAX — transition" and "FW: fully forward", with VERIFY.
  - **The Aircraft-table text (`manual.html` ~row `Q_TILT_MAX`) is outside the diagram scope and was not changed.** A content WP should reword it.
- **D9 antenna positions:** schematic only. The only modelled fact is the patch orientation from `relay/rfmodel.js`: one patch facing the right wing, one right + 45° down, which gives the plan's "90°/135°". That implies a clockwise orbit, which matches the existing orbit drawing.

### 5.2 Interpretations

- **Wind "gust-spread arc":** an outer ring around the compass. The full circle equals the gust no-go limit (`settings.gustMaxMs`); the solid arc is the mean wind, the light arc runs from mean to gust, and ticks mark the GO and CAUTION limits. Open-Meteo gives no direction spread.
- **D10:** one laptop plus a second screen over USB-C (checklist `gs-mp-connect`; the app and MP share `127.0.0.1`). Which screen shows what is left to the crew.
- **D7 battery values** are the documented defaults (22.2 / 23.0 / 22.5 V); the live values are on the generated gauge.

### 5.3 F8 checklist order (ids unchanged, section ids A–E unchanged)

- **B** is renamed "VTOL BUILD" and no longer contains the power-on.
- **C** "GROUND STATION & POWER-UP" now runs: `gs-charged`, mast (1), Ethernet, HM30 link, IP, sleep, app (2), **`fpv-battery`** (client powered, step 3, moved from E), **`build-battery-power`** (carrier battery, step 4, moved from B), MP (5), video (6), camera (7).
- **D** keeps the Nomad (8, `carrier-mode-cycle`).

### 5.4 Files touched outside the strict brief list (minimal)

- **`index.html` call sites:**
  - `battSparkline(e, pack)` now passes the entry, for the date tooltip.
  - `windCompassSVG(..., gusts)` now passes the gust.
  - In `renderBinResult`, `binOverlay(d)` is computed and passed to the three charts, and the airspeed colour `#60a5fa` became `var(--text)`.
  - One `<script src="js/diagrams.js">` was added.
- **`manual.html`:** `js/tools-core.js` and `js/diagrams.js` are added before the page code; `renderDiagrams()` was added; a hidden sprite SVG sits after `<body>`.

### 5.5 Notes for other WPs

- **WP09:** `sw.js` must precache `js/diagrams.js` and `img/diagrams/*.svg`. The manual now also loads `js/tools-core.js`, which is already precached. The diagram images are lazy and are cached only after first view until then.
- **WP10:** the generator scripts for the SVG files (`lib.js`, `d1-3.js`, `d4-8.js`, `d9-15.js`, `build.js`, plus `inline.js` for the manual's inline SVGs) are in `S\wp07gen\`, not in the repo, because `scripts/` is not WP07's. The SVGs are plain and hand-editable. If wanted, WP10 can move the generators to `scripts/diagrams/`. `img/README.md` (WP04) does not list `img/diagrams/` yet.
- **Search:** the manual search index still skips `.diagram-slot` (image diagrams are not text-searchable). Their full text is in the alt attributes.

## 6. Notes for the verifier

- **Tests and checks:**
  - `node --test test/`
  - `node S\wp07gen\smoke.js [worktree]` (needs `S\jsenv`)
  - `npx --prefix S/jsenv html-validate manual.html`
- **Open each SVG** in `img/diagrams/` directly in a browser. Each one's `<desc>` and `<!-- Sources -->` comment name the plan sections and relay-design tables it follows.
- **Manual:**
  - **Slots:** RF & Comms (D1, D3), Flight Modes (D7, D6), Relay Electronics (D2, D8b, D8, D5, D4, D15, D11), Aircraft (D9), Procedures (D10), Pre-Arm (D5, D12), Crew (D14), Mission Planning (D13).
  - **Inline diagrams:** Aircraft has the motors and the generated gauge; Mission has the profile; Mission Planning has LOS and orbit; Client Drones has the GPS Rescue diagram.
  - **Gauge:** change the carrier thresholds in Tools → PROFILES (or import a `.param` file with `BATT_LOW_VOLT`) and the gauge follows on the `storage` event.
- **Mobile:** at 360 px the image diagrams fit the width; the inline SVGs scroll sideways inside their frame.
- **Tools:**
  - **Battery Log:** at least 2 entries → trend with threshold lines and point tooltips; sparklines in the rows.
  - **Weather:** compass with ring and "INTO WIND".
  - **Telemetry:** `.bin` charts with the mode strip and event markers (the smoke script contains a synthetic overlay case).

## PM follow-ups

Done after the first hand-back, as the PM asked.

| # | Request | Change | Evidence |
|---|---|---|---|
| 1 | Reword the `Q_TILT_MAX` Aircraft-table row | The row now reads: "Tilt angle held during the forward transition until the transition airspeed is reached; in fixed-wing flight the tilt motors go fully forward (ArduPilot tilt-rotor guide)". It carries an amber **VERIFY — against the param file and firmware in use**, matching the motor diagram. An HTML comment above the row cites `https://ardupilot.org/plane/docs/guide-tilt-rotor.html`. "Maximum forward tilt angle" is gone. | `manual.html` Aircraft → Tilt-Rotor Configuration; test in `test/diagrams/files.test.js` (R3 test) |
| 2 | Generator in the repo, reproducible | `scripts/diagrams/` holds `lib.js`, `d1-3.js`, `d4-8.js`, `d9-15.js`, `inline.js`, `slots.js`, `build.js` and a `README.md`. They use plain Node with built-ins only (`fs`, `path`). `node scripts/diagrams/build.js` writes the 16 SVG files and updates the manual's diagram slots and four inline SVGs. `--check` compares only and exits 1 on any difference. `inline.js` and `slots.js` are now modules that rebuild the existing blocks in place: inline SVGs are found by their `aria-labelledby` ids, slots by `data-diagram`. | `node scripts/diagrams/build.js --check` → "diagrams up to date (16 SVG files, manual slots and inline SVGs)"; new `test/diagrams/regenerate.test.js` (3 tests: SVGs byte-for-byte, manual byte-for-byte, Node built-ins only). The comparison treats CRLF and LF alike. |
| 3 | `img/README.md` section | New "Diagrams — `img/diagrams/`" section: how the files are generated and checked, the file rules (≤ 60 KB, title/desc/sources, TBD/VERIFY), the palette table (hex → token), and the readability rule (fit-to-width 400-unit viewBox with ≥ 14-unit text, or scroll with a min-width). | `img/README.md` |
| 4 | Tools swipe-order regression | **Finding:** the hard-coded list in `index.html` already held all 10 tabs in nav order. The failing WP05 smoke check tested a stale literal (`'link','battlog','tlog','weather','profiles'`), which stopped matching when WP11 inserted `flights` and `params`. **Fix:** the swipe order is now read from the nav buttons by `navTabOrder()`, so it covers every tab in nav order and cannot drift again. `localStorage` access in the swipe handler is now wrapped in try/catch. The WP05 smoke script lives in the scratchpad, not the repo, and still checks for the literal; it should be updated or dropped. | `index.html` "SWIPE TAB NAVIGATION"; new `test/tools/swipe-order.test.js` (2 tests). The tests check that every tab panel has exactly one nav button, and they run the page's `navTabOrder()` against a stub DOM (no jsdom) to confirm it returns the nav order and that no literal list remains. |
| 5 | Propeller directions | Still TBD; the owner will supply them. | — |

Superseded statements in the report above:

- **§5.5 (WP10):** the generator is now in the repo under `scripts/diagrams/`, so that note no longer applies. WP09 still needs to precache `js/diagrams.js` and `img/diagrams/*.svg`.
- **§4:** the test count is now **220** (215 + 3 regenerate + 2 swipe order).

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 220  ℹ pass 220  ℹ fail 0
node scripts/diagrams/build.js --check   → diagrams up to date
npx --prefix S/jsenv html-validate manual.html → exit 0
node S\wp07gen\smoke.js → 30 pass, 0 fail
```
