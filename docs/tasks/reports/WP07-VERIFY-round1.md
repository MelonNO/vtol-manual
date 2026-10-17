# WP07 verification — round 1
VERDICT: APPROVED

Worktree `S\wt\WP07`, branch `wp/07`, HEAD `d70cccf`. Diff base = `git merge-base main HEAD` = `006001d`. Commits: `ee3a497` (implementation), `6ed9885` (report), `d70cccf` (PM follow-ups). Current `main` is `4af34b8`.

## Scope (changed files)

| File | Status |
|---|---|
| `img/diagrams/d01…d15, d08b *.svg` (16) | Owned (R1) |
| `js/diagrams.js` | Owned (R4/R5) |
| `test/diagrams/{files,generators,regenerate}.test.js`, `test/diagrams/xml.js` | Owned (R6); `regenerate.test.js` is PM follow-up 2 |
| `docs/tasks/reports/WP07-IMPLEMENTATION.md` | Owned |
| `manual.html` | Owned for the slots and inline SVGs. The other edits are authorised. R5b text edits F1–F9 and the WP08b note. The Q_TILT_MAX row rewording is PM follow-up 1. Loading `tools-core.js` / `diagrams.js` and `renderDiagrams()` are needed for R4 / R3 (GPS Rescue) and are justified in report §5.4. |
| `data/content.js` | Allowed by R5b (F4, F6, F8, the WP08b note) |
| `index.html` | Owned for the chart generators. The call sites (`battSparkline(e,pack)`, `windCompassSVG(…,gusts)`, `binOverlay`, one `<script>` tag) are minimal and justified (§5.4). The swipe order derived from the nav is PM follow-up 4. |
| `scripts/diagrams/*` (build, lib, d1-3, d4-8, d9-15, inline, slots, README) | PM follow-up 2 |
| `img/README.md` (Diagrams section) | PM follow-up 3 |
| `test/tools/swipe-order.test.js` | PM follow-up 4 |

There are no unjustified changes.

**Merge check:** in a throw-away clone, `main` (`4af34b8`) was merged with `--no-ff` into `wp/07`. The merge is clean, with no conflicts; `main` touched only `gcs/`, the plan and the task docs. On the merged tree, `node --test test/` gives 220/220 and `build.js --check` reports up to date.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `img/diagrams/*.svg` (16 files, 6.6–14.3 KB) | **Visual check:** every file was opened and rendered with headless Edge at 400 px (`S\verify\WP07\shots\d*-400.png`). **Accessibility and palette:** each file has `role="img"`, `aria-labelledby`, `<title>`, a full-text `<desc>`, a palette-to-token comment (matches `:root` in `manual.html:9-13`, incl. `--dim #444`) and a `Sources:` comment. Text is 14 / 15 / 16 / 17 units in a 400-unit viewBox. **Content against the plan and relay design:** see "Content check" below; no invented values were found. |
| R2 | PASS | `manual.html:369, 485, 558, 615, 628, 682, 683, 697, 698, 709, 742, 847, 922, 1091, 1106, 1278, 1632` | **Slots:** 17 slots, D5 twice; every WP06 slot is filled with `<figure class="dg">`. **Image:** a lazy `<img>` with width/height and a descriptive alt, plus a caption. **jsdom:** 17/17 slots hold an image whose file exists; no slot is empty. |
| R3 | PASS | sprite `:233`; motors `:808`; mission `:874`; LOS `:1651`; orbit `:1661`; GPS Rescue `:1443` + `renderDiagrams()` `:1966`, `js/diagrams.js:347` | **All inline SVGs:** only `var(--…)` colours (jsdom: 0 hex in 6 inline SVGs), and role/title/desc on each. The quad is one `<symbol>` used 3×. Each SVG sits in an `overflow-x:auto` wrapper with a min-width. **Motors:** tilt axis, CW/CCW arcs marked TBD, and a side-view inset (0° VTOL, 80° `Q_TILT_MAX` transition, FW fully forward, 40°/s). **Mission:** REL 0–150 m scale with the template ranges (20–30 / 50–80 / 60–140 / 30–40 / 20–25 m); 100–200 m, 300 m+ and 400 m+ distances; corridor clear to 60 m; abort branch (3 s → QHOVER, 4 s QLand VERIFY); back-transition glide 100–130 m (10 s). All values match the existing manual. **LOS:** two links, the Fresnel ellipse, k = 0.6 (`relay/rfmodel.js:222`). **Orbit:** relabelled HM30 / client links, ≈70° beam, always-covered inner zone, body-shadow point, wind drift, clockwise. **GPS Rescue:** generated; delay and sats come from the ref-client profile; the other values match `docs/FPV_betaflight_dump.txt:666-684`. **Pusher comment** removed (F5). |
| R4 | PASS | `js/diagrams.js:67-147`; `manual.html:863`, `:1966-1990` | **Source:** `ToolsCore.packThresholds` and the settings. **Markers:** BATT_LOW only when the param file sets it, plus manual RTL 23.0, hard limit 22.5, BATT_CRT 22.2 and storage 22.8. **Zones (MAN-14):** the operating zone ends at the RTL voltage. **Other packs:** longevity floor; Li-Ion storage shown as TBD. **jsdom:** the gauge follows a settings change and a param-file `BATT_LOW_VOLT` on the `storage` event. **Tools page:** loads `js/diagrams.js` (`index.html:623`). Text-clipping issue: see MINOR 1. |
| R5 | PASS | `index.html:965, 981, 1786, 1791, 1896, 2321`; `js/diagrams.js:152-342` | **Trend:** profile threshold lines (MANUAL RTL / HARD LIMIT / BATT_CRT), y ticks, a `<title>` with the date on each point. **Sparkline:** a dashed threshold line, full/floor tick values, a date `<title>`. **Compass:** runway bar and chevron, "▲ INTO WIND 200° SSW", and a gust ring (full circle = `gustMaxMs`; mean and spread arcs; GO/CAUTION ticks). **.bin charts:** mode bands plus a strip (QHOVER / FBWB / RTL / LOITER_QLAND). Dashed markers for transition ("Transition done"), failsafe (GCS) and battery events, each with a `<title>`. **XSS:** escaped (jsdom, `__xss = 0`). |
| R5b | PASS | **F1:** `manual.html:903`, `:935` (amber VERIFY spans). **F2:** `:580`. **F3:** the RTT-rise row matches `gcs/README.md` (base and main, line 278 on main). **F4:** manual `:1066` = `data/content.js:411`. **F5:** no "pusher" anywhere (jsdom). **F6:** `:1429-1430`, crew row, `content.js:206`, rescue caption. **F7:** `:165-166`. **F8:** section C order: `gs-charged`, mast, Ethernet, HM30, IP, sleep, app (2), `fpv-battery` (3), `build-battery-power` (4), MP (5), video (6), camera (7); Nomad in D (8). That is plan §6.1.6; 51 ids unchanged, only the two moved. **F9:** `switchTab` / `manGoTo` string branch removed, no callers left in the manual. **WP08b:** MP 5600/5602/5601 is in manual `:426`, content `gs-client-video` note and `net-fanout`, D3 and D12. | All present. |
| R6 | PASS | `test/diagrams/xml.js`, `generators.test.js` (9), `files.test.js` (12) | **Well-formedness:** a custom XML checker (sanity-tested against broken markup). **Generators:** each returns `<title>`, no hex, font ≥ 11. **Files:** ≤ 60 KB, well-formed, palette-only hex. **Content:** the tests are real content checks against the plan, not trivial asserts. |

### Content check of every diagram (against plan §3, §4, §6.1, §9.2, §9.3, §13.1 and the relay design)

- **D1:**
  - all four links (HM30 IP, client RC ELRS 868/915/2.4/Gemini, client video with band per client and 5.8 default, 915 backup "close range only")
  - P1, P2, P3 (CAM_ENABLE), P4 and P5
  - HM30 band TBD
  - "Carrier failsafe: SIYI / GCS loss only"
- **D2:**
  - **Boards and ports:** both boards; KSZ8795 with P1 HM30 (transformer), P2 W5500 (capacitor-coupled), P3 camera JST-GH, P4 spare JST-GH and P5 N6 RMII via B2B.
  - **VLAN map:** P2↔P1 only; P3/P4 → P1 (and P5 if needed); broadcasts never reach the bridge.
  - **P1 egress priority:** RC status → client video → camera, rate-limited; "HM30 radio is the bottleneck".
  - **Power and buses:** VIN 6–26 V through fuse, reverse FET and TVS; 3.3V_RC and VBAT_TX bucks; SPI 32 MHz; CRSF single-wire at 400 kbaud.
  - **LEDs and independence:** N6 LEDs PG8 / PG10 / PG0 (heartbeat / decoder lock / Ethernet link, as plan §6.1.4); bridge LEDs TBD; the independence rule and test 5.
  - All of this matches the relay design.
- **D3:** every IP and port from plan §3.3:
  - .11 / .12:19856
  - .26 RTSP 8554 `/main.264`
  - N6 / bridge TBD (e.g. .20 / .21)
  - 5600 / 5770
  - local fan-out 5601 / 5602, API 47800
  - the MP-not-on-5600 note
  - "proposed — confirm before flight"
- **D4:** the relay-design RC table:
  - controller 1–8 ms
  - send period 4–5 ms
  - HM30 uplink unknown
  - processing < 1 ms
  - CRSF slot ≤ 1 period
  - 26 B ≈ 0.65 ms
  - 1 ELRS interval
  - end-to-end TBD
- **D5:**
  - **States:** BOOT / WAIT_GCS / START / RUN / FAILSAFE, each with its "Sends CRSF" column and transitions (5 consecutive valid packets, ModelID ×3, T_hold 250 ms, FAILSAFE → WAIT_GCS immediately).
  - **Watchdog:** about 100 ms.
  - **LED pattern:** TBD for every state.
  - **UNREACHABLE (app side):** 300 ms, matching `gcs/README.md`.
- **D6:**
  - **Causes:** app stop, controller, HM30, G0 reset / watchdog.
  - **Chain:** T_hold start value 250 ms; TX module reaction TBD (test 6); RX timeout TBD; client FC per profile (Ref #1: 2.5 s = 1.5 + 1 s, from the existing manual and BF dump).
  - **Totals:** per cause, all TBD (test 6).
  - **Notes:** "only T_hold is designed"; with HM30 loss the carrier also RTLs and the camera is forced off.
- **D7 (owner intent):**
  - **SIYI / MP loss:** 5 s (`FS_LONG_TIMEOUT`) in all modes (`FS_GCS_ENABL = 2`) → RTL (`FS_LONG_ACTN = 1`); Q-mode RTL behaviour TBD (SITL).
  - **915 MHz loss:** **NONE**, RC ignored (`THR_FAILSAFE = 2`); close-in: take over in MP.
  - **Battery critical:** 22.2 V → Loiter → QLand.
  - **Battery low:** `BATT_LOW_VOLT = 0`, not set; manual RTL 23.0 V; 22.5 V hard limit.
  - **Transition fail:** 4 s → QLand (`Q_TRANS_FAIL_ACT = 0`) **VERIFY**, per plan §13.1; pilot QHOVER after 3 s.
  - **SIYI-loss timeline:** 0 s / 5 s RTL / climb to 120 m REL / back-transition per the Q settings, TBD.
  - No FBWA 1.5 s anywhere (also enforced by a test).
- **D8:**
  - not to scale
  - FPV vs camera mode
  - N6 CBR, MAVLink, margin, P3 cap and HM30 capacity: all TBD (Q13)
  - RC ≈ 100–130 kbit/s (relay design)
  - HM30 is the bottleneck
  - the test 9 rule
- **D8b:**
  - **Command path:** app key `k`, default OFF, refuses ON while the client is armed (`gcs/README.md`); `rc_up` flags bit 0; the G0 applies a change within one packet.
  - **P3 states:** ON capped at TBD; OFF = receive disabled or limit at minimum.
  - **Read-back:** in the 10 Hz status; MISMATCH alarm after > 1 s.
  - **Rules:** default off; forced off on stream loss.
  - **Firmware-request table:** marked "not implemented" (plan §3.4 #3).
- **D9:**
  - **Positions and separations:** all TBD, "schematic".
  - **VRX patches:** boresights 90° and 135° from `relay/rfmodel.js:150-153`, giving a clockwise orbit; cos^3.5 pattern.
  - **Co-site:** the harmonics note is from relay design :421.
- **D10:**
  - **Layout:** mast with HM30 (6S 3000), laptop with two screens, controller.
  - **Laptop power rules:** from the manual / content.
  - **Crew:** co-located, verbal only.
  - **Open items:** screen assignment and distances "per crew agreement / per site".
- **D11:**
  - **Power:** 6S 7000 pack; HM30, camera and VRX supplies TBD.
  - **Relay PCB:** XT30, VIN 6–26 V.
  - **Signal runs:** JST-GH runs and pinouts; CRSF connector pinout.
  - **Nomad:** 6–16.8 V; > 250 mW needs XT30 (plan §3.4 #4); peak current TBD.
  - **CVBS rule:** never parallel goggles.
- **D12:** RC and video trees use only existing alarm names and thresholds:
  - RC STREAM STOPPED / CONTROLLER DISCONNECTED / RC SENDER DEAD / NO BRIDGE STATUS / BRIDGE FAILSAFE
  - LQ < 70 % (`config.py:127`)
  - PG10 decoder LED
  - viewer 5601 / MP 5602
  - bridge LED patterns TBD
- **D13:** video ∩ RC = operating area; orbit-sweep inner zone (worst case) and outer zone (best case); "shapes illustrative — use the MAP".
- **D14:**
  - **Calls:** every call is in `data/content.js` callouts (incl. "ABORT ABORT ABORT", "RELAY SOLID", "ZONE CLEAR").
  - **Phases:** QHOVER → FBWB transition → AUTO, per the manual.
- **D15:**
  - **Field arrival:** PAL 288 × 64 µs = 18.4 ms; NTSC 15.3 ms.
  - **Encoding and packets:** slices of 32 lines (9 PAL / 7 NTSC); ≤ 2 ms per slice; ≤ 1400 B RTP; last packet ≤ 3 ms (test 1).
  - **Latency:** relay ≈ 20 ms; HM30 150–180 ms (estimate); GCS 10–50 ms.
  - **Supervisor:** 25 ms field resend; decoder reset after 1 s.
  - All from the relay design.

**Placeholders (TBD / VERIFY) where unsourced:**
- antenna positions (D9)
- supplies and peak current (D11)
- propeller directions (motors SVG, amber "CW / CCW: TBD — confirm on the airframe", and the caption)
- LED patterns
- HM30 band and capacity
- the test-6 times

**Q_TILT_MAX** (PM follow-up 1): the manual row (`:799`) now reads "Tilt angle held during the forward transition … in fixed-wing flight the tilt motors go fully forward (ArduPilot tilt-rotor guide)". It carries an amber `VERIFY — against the param file and firmware in use` and an HTML comment citing the source. This matches main's plan §13.1 row. The motor inset agrees.

## Contract results

- **C1 (store):** the manual and the gauge read `packs`, `settings` (battCrtVolt / manualRtlVolt / hardLimitVolt / storageVoltPerCell), `paramFile.params.BATT_LOW_VOLT` (C1.5), `clients` and `VtolStore.IDS.refClient`. Null values are drawn as TBD.
- **C1.4 wind limits:** `windGoMaxMs`, `windCautionMaxMs` and `gustMaxMs` are used by the compass ring through `wxLimits()`.
- **C3 ports:** 5600 / 5601 / 5602 / 5770 match everywhere.
- **C5 content:** item ids are stable. The `[[TBD]]` / `[[VERIFY]]` markup is used in `content.js:206`.
- **Convention §2.2:** `js/diagrams.js` follows the UMD pattern (global `VtolDiagrams`, Node `module.exports`). It requires `./tools-core.js` in Node.

All conform.

## Tests run (commands + results)

| Command | Result |
|---|---|
| `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/` (worktree) | **220 / 220 pass** |
| Same, on a merge of `main` into `wp/07` (throw-away clone) | 220 / 220 pass |
| `node scripts/diagrams/build.js --check` (throw-away clone `S\verify\WP07\clone`) | "diagrams up to date (16 SVG files, manual slots and inline SVGs)", exit 0 |
| `node scripts/diagrams/build.js` (write mode, clone) | `git status` stays clean, so the output is deterministic |
| Drift test: edited `5770` in d03 | `--check` → "DIFF img/diagrams/d03-network-map.svg differs", exit 1 |
| Drift test: broke one slot | `--check` throws "expected 17 diagram slots, found 16" with a stack trace, exit 1 (see MINOR 4) |
| Generator dependencies | only `fs`, `path` and local modules; no `package.json`; `regenerate.test.js` enforces this |
| `npx --prefix S/jsenv html-validate manual.html` | 0 errors (main: 0) |
| `npx --prefix S/jsenv html-validate index.html` | `{no-implicit-button-type:31, no-inline-style:95, prefer-tbody:1}`, identical to main, so no new errors |

**What the tests cover** (opened and read):
- **Generators:** gauge marker sets, BATT_LOW only when set, zones, escaping, trend thresholds and titles, compass hint and arc, timeChart bands and markers, rescue values from the profile.
- **Files:** port, state and failsafe content per diagram; readability; slot and inline-SVG structure.
- **Regenerate:** byte-for-byte comparison against the generator.
- **Swipe order:** runs the page's `navTabOrder()` against a stub DOM.

## Smoke tests (what you loaded/clicked + result)

**Own jsdom smoke**
- **Script and setup:** `S\verify\WP07\smoke.js` (log `smoke.log`). URL `https://melonno.github.io/vtol-manual/`, resources mapped to the worktree, GCS client stubbed. **69 pass / 1 fail.**
- **The one fail:** "Not implemented: Window's scrollTo()" on the manual. This is a jsdom limitation and is identical on `main`; not a script error.

**manual.html:**
- **Slots:** 17, all filled; every `src` exists; alt and caption present; lazy loading.
- **Gauge:** shows 23.0, 22.5, 22.2 and 22.8 V with "BATT_LOW_VOLT not set"; 4 zones with titles; no hex.
- **Live updates:**
  - setting `manualRtlVolt = 23.4` plus a param file with `BATT_LOW_VOLT = 23.6` → the gauge updates on `storage` and the "not set" note disappears
  - a GPS Rescue of 2.5 s / 8+ sats comes from the profile
  - an XSS-named active client is noted and escaped
- **Text checks:**
  - every inline SVG has role/title and no hex
  - symbol ×1 / use ×3
  - "pusher" absent; `switchTab` absent
  - the F2 wording and the WP08b 5600/5602 note are present
  - the Q_TILT_MAX row is reworded with an amber VERIFY

**index.html:**
- **Battery log:** no script errors. Three battery-log entries (one with an XSS flight name) produce:
  - a trend with 3 date tooltips, MANUAL RTL / HARD LIMIT / BATT_CRT lines and ticks
  - 3 sparklines with date titles
  - no XSS
- **Weather:** stubbed fetch, wind 200° → the compass shows "▲ INTO WIND 200° SSW" and a gust-spread arc.
- **.bin:** a synthetic log (WP11 builder plus a "Transition done" MSG) gives:
  - 2 charts with mode bands QHOVER / FBWB / RTL / LOITER_QLAND
  - markers for transition, GCS failsafe and battery failsafe
  - no hex, no XSS
- **Swipe:** `navTabOrder()` = preflight, turnaround, postflight, link, battlog, tlog, flights, params, weather, profiles (the nav order).

**Regression smokes from earlier verifications** (run on the WP07 tree and on `main`):

| Script | WP07 | main |
|---|---|---|
| `verify\WP06\smoke.js` | 197 / 0 | 197 / 0 |
| `verify\WP11\smoke-r2.js` | 103 / 0 | 103 / 0 |
| `verify\WP05\smoke-r2.js` | 30 / 1 | 30 / 1 |

The WP05 failure is a stale text check that fails identically on main. **WP05 / WP06 / WP11 behaviour is intact.**

**Readability (headless Edge, the manual in a 360 px iframe)**
- **Script and setup:** `measure-snippet.js` measured every diagram on every tab. Headless Edge reserves a 15 px scrollbar, so the layout width was 345 px.
- **Image diagrams (all 17 slots, i.e. all 16 files):**
  - 315 px wide → 14-unit text = 11.03 px
  - on a phone with overlay scrollbars (330 px) → 11.55 px
- **Inline SVGs** (each inside an `overflow-x:auto` wrapper; no page-level horizontal scroll, `scrollWidth` 345):

  | SVG | Smallest text |
  |---|---|
  | Motors | 11.38 px |
  | Mission | 11.27 px |
  | LOS | 11.14 px |
  | Orbit | 11.38 px |
  | GPS Rescue | 11.38 px |

- **Gauge:** 12 units at 360 → 10.5 px at the 345 px layout, 11.0 px at the real 330 px. That is at the limit (see MINOR 2).
- **Tools charts** (trend, timeChart): 12-unit text with a min-width of W × 11/12 inside an `overflow-x` wrapper, i.e. 11.0 px.
- **Result:** the rule is spot-checked on more than 5 diagrams and passes.

**Visual:** all 16 SVGs were rendered at 400 px, and the manual tabs at 820 px (motors, gauge, mission, LOS, orbit, rescue); see `S\verify\WP07\shots\`. No overlaps that hide content were found, except MINOR 1.

## Findings

1. **MINOR — `js/diagrams.js:113-115, :144` (battery gauge notes overflow the 360-unit viewBox).**
   - **Text:** "BATT_LOW_VOLT not set (0): no warning before BATT_CRT_VOLT" is about 57 characters at 12 units. Notes start at x = 18 and are not wrapped, so the text runs past the right edge and is clipped.
   - **Renders:** the manual shows "…before BATT_CRT"; with a generic monospace fallback it shows "…before BATT_CR".
   - **Non-LiPo packs:** "Storage voltage for Li-Ion: TBD (the setting is a LiPo value)" clips the same way. The TBD stays visible.
   - **Shots:** `shots\crop-gauge.png`, `shots\gauges330.png`.
   - **Expected:** wrap or shorten the notes, e.g. "BATT_LOW_VOLT = 0: no warning before BATT_CRT", or add a width estimate like `lib.js`'s layout warning to the generator test.
2. **MINOR — `js/diagrams.js:66-67` (gauge readability is at the limit).** At a 360 px viewport the gauge (360 units, 12-unit text, no min-width) renders at about 11.0 px with 330 px of content. That is exactly the limit, and it falls below it wherever a scrollbar takes width. A 13-unit minimum, or a min-width/scroll like the charts, would give margin.
3. **MINOR — `js/diagrams.js:81-84` (zone names are tooltip-only).** The MAN-14 zone names ("RTL now", "Operate — RTL at 23.0 V", …) exist only as `<title>` tooltips. On a phone the bar shows unlabeled colour bands, and the old gauge had visible zone labels. The numbered marker legend makes it usable, but a short visible zone legend would be clearer.
4. **MINOR — `scripts/diagrams/slots.js:59` (ungraceful `--check` failure).** When a slot is missing, `build.js --check` throws an uncaught exception with a stack trace instead of a DIFF line. It still exits non-zero, so CI semantics hold.
5. **MINOR — `manual.html:808` (motor SVG) (VERIFY markers not amber).** In the motor SVG the "VERIFY against the param file" note is `var(--muted)`, and in the mission profile the "QLand — VERIFY" is red. The project convention is amber VERIFY markers. The adjacent table row and the D7 file do use amber.
6. **MINOR (hand-off) — offline caching.** `sw.js` does not precache `js/diagrams.js` or `img/diagrams/*.svg`.
   - **Offline behaviour:** the JS is cached network-first after one online visit; images are cached only once viewed. Offline, before that, the gauge and rescue slots show their amber fallback text.
   - **Owner:** this is WP09's job (report §5.5), and it should be in the WP09 brief.
7. **MINOR — `img/README.md` "Readability rule" (332 px figure).** It cites 332 px of content at 360 px. The measured value is about 330 px. The conclusion (≥ 11.5 px) still holds.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

**APPROVED.** There are zero BLOCKER and zero MAJOR findings, and every MUST requirement (R1–R6, incl. R5b and the WP08b MP-port note) passes on independent evidence.

- **Diagram content:** all 16 standalone diagrams and the 5 inline / generated SVGs match the plan and the relay design: ports P1–P5, VLAN map and priority, bridge states, client failsafe chain with TBD times, and the carrier failsafe matrix.
- **Failsafe intent:** respected (SIYI loss → RTL after 5 s in all modes; 915 loss → none; transition fail → QLand VERIFY).
- **No invented values:** unknowns are TBD / VERIFY, including antenna positions, supplies and propeller directions.
- **Generator:** reproducible with Node built-ins only, and guarded by a byte-for-byte test.
- **Behaviour:** WP05 / WP06 / WP11 behaviour is unchanged versus main; html-validate shows no new errors.
- **Merge:** the branch merges cleanly into current main.
- **Out-of-list edits:** each was justified or authorised by the PM, and kept minimal.
- **MINORs:** findings 1–7 may remain; 1 and 2 are cheap to fix and recommended before the content freeze.
