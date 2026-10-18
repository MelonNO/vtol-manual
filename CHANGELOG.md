# Changelog

The procedures in this suite are safety documents, so every release that changes content is tagged (`vX.Y.Z`) and
listed here (plan Q-5). Format: newest first; each entry says what changed for the crew, then for developers.

Versions: the web suite's version is `VTOL_VERSION.app` in `js/version.js` (shown in every page footer, with the
content date and the parameter file). The GCS companion app has its own version (`gcs/vtolgcs/__init__.py` and
`gcs/pyproject.toml`; shown in the app's window title, its console and `/api/v1/health`).

## Unreleased — redesign (WP23–WP28)

No version bump: `js/version.js` still says `app: '2.0.0'`. The owner asked on 2026-10-18 for a cleaner, calmer and
more readable suite. **No procedure, value, parameter, IP or failsafe changed**: every number, mode, parameter name,
IP and TBD / VERIFY marker of the shared content is locked by a test (`test/content/wp28-safety-lock.test.js`).

### What looks different (crew-facing)

- **Calmer and easier to read everywhere.** Prose in a sans-serif font at 16 px; Oswald for headings and short labels;
  monospace only for values, parameters, IPs and timers. Orange now means "you can tap this" only; red is emergency,
  amber is warning / TBD / VERIFY, green is GO. Brighter grey for secondary text. Sunlight mode (☀) stays.
- **One slim app bar** on every page: page badge and title, a Tools · Manual · Map switcher and ☀. The strip of key
  values moved into the **Aircraft summary** under the bar (Tools and manual): closed by default, but warnings
  (DISABLED failsafes, "PARAMS not verified", TBD values) stay visible next to it.
- **Tools groups.** The ten tabs are now five groups: **Checklists** (Pre-flight · Turnaround · Post-flight),
  **Link**, **Logs** (Battery · Telemetry · Flights), **Weather** and **Setup** (Params · Profiles). On a phone the
  groups are the bottom nav and the sub-tabs stay at the top while you scroll a checklist.
- **Checklists.** One toolbar: title, progress, pre-flight timer with START; Expand all, Challenge–response and Reset
  are quiet buttons (a "More" menu on a phone; a tap outside it only closes it). Section names in normal case, rows at
  least 52 px high, the right end of a row opens the detail. Item texts are shorter and plainer; their checks and order
  are unchanged.
- **EMERGENCY** is one tap away on every Tools view: bottom right on a computer, a **full-width red bar just above the
  bottom nav** on a phone (it no longer covers the end of a checklist row). In the manual, ⚠ Emergency is always in
  the bar. Emergency cards are unchanged in content: IMMEDIATE steps first (word for word as before), clean-up below.
- **Link tab:** calm panels with readable labels; only the panel with a problem gets a red edge; values in monospace.
- **Manual:** grouped menu (Overview · Aircraft · Operations · Planning · Reference, a Menu sheet on phones and
  tablets), each chapter opens with a title and one line of intro, and an **On this page** list (a side list on a wide
  screen, a disclosure on a phone). Long callouts show a short lead with the rest behind "More". Diagrams were redrawn
  in the new palette with larger text.
- **Coverage map:** the controls are in collapsible groups (a bottom sheet on a phone); the live status is behind the
  **Status** button in the bar (inline on wide screens). **Latency clock:** same frame; the digits fit the screen width (they no longer overflow on a wide screen).

### For developers

- `css/base.css` is the design system (`docs/design/README.md`, `docs/design/styleguide.html`): tokens, self-hosted
  fonts, one definition of every shared component (section 4), sunlight mode, field components and the page shell
  (section 8). Page `<style>` blocks hold page-only rules; `test/design/` and `test/shell/` guard both.
- WP28 folded the wave-3 requests into the base components (callout paragraphs and "More" disclosure, chip cells,
  thin dark table scrollbars, `.btn-icon`, `.help`, section-title anchor offset, sunlight outlines for the map
  overlays) and removed the page overrides; `js/render-content.js` emits no inline styles (tables in `.tbl-wrap`, the
  checklist section colour as `--sec`).
- New test: `test/content/wp28-safety-lock.test.js` with its fixture — regenerate it only for a justified change.

## [2.0.0] — 2026-10-18

`js/version.js` says `app: '2.0.0'`, and the **GCS app version is now 2.0.0** too (was 0.1.0), matching the suite
release and the tag the GCS build attaches its zip to. The owner approved the tag `v2.0.0` on 2026-10-18; the PM
sets it on `main` (README "Tagging a release").

The whole suite was rewritten for the **new two-board relay** (the old Nomad 868 → DBR4 → Nomad 2.4 and
CVBS → HDMI → SIYI chain is removed), for the owner's **failsafe intent** (the carrier fails safe only on SIYI/GCS
link loss; the 915 MHz Nomad is close-range backup) and for the **carrier parameter file of 2026-10-17** (Rev C).
Source of every requirement: `docs/SOFTWARE-IMPROVEMENT-PLAN.md` (Rev B + §15 Rev C). Work was done in 22 work
packages (WP01–WP19, WP21, WP22; WP08 in two parts), each independently verified (`docs/tasks/`). WP20, a git
history rewrite, was prepared and verified, then cancelled (OPEN-ITEMS O-5).

### Safety content (crew-facing)

- **Failsafe documentation corrected** (S-01…S-03, plan §15.2): 915 MHz RC loss → **no action**
  (`THR_FAILSAFE` = 2; in QHOVER the aircraft holds with centred sticks and drifts with the wind). SIYI/GCS loss →
  after 5 s, **RTL** in fixed-wing modes and **QRTL** in VTOL modes (`FS_GCS_ENABL` = 2, all modes;
  `Q_OPTIONS` = 426016). Every RTL ends with an **automatic VTOL landing at home** (`Q_RTL_MODE` = 2): keep the home
  landing zone clear for the whole flight. The 915 MHz "RC Link Loss" emergency card became a "backup link lost"
  note. Mission Planner is the heartbeat: never close it in flight; no other program may send as sysid 255 (S-02a/b).
- **Battery failsafes (Rev C):** `BATT_LOW_VOLT` **22.0 V → automatic RTL** (10 s, sag-compensated voltage,
  `BATT_FS_VOLTSRC` = 1), `BATT_CRT_VOLT` **21.0 V → QLand at the current position**, `BATT_ARM_VOLT` **24.6 V**. The
  voltage ladder (25.2 / 24.6 / 23.0 / 22.5 / 22.0 / 21.0 / storage 22.8 / floor 18.6 V) is the same on every page.
  The Tools battery analysis no longer recommends a `BATT_LOW_VOLT`; it suggests the pilot's manual RTL trigger (OSD
  raw voltage) and shows the configured failsafes as fixed.
- **Other Rev C values:** cruise 12 m/s, minimum 10 m/s, `Q_TRANSITION_MS` 3500, transition timeout **8 s → QRTL
  home** (`Q_TRANS_FAIL_ACT` = 1), back-transition 8 s ≈ 100 m, `Q_RTL_ALT` 50 m, `TRIM_THROTTLE` 30 %,
  `Q_M_THST_HOVER` 0.35 (learned), tilt rate 45°/s, `FLTMODE2` = 11 (RTL; the "QLOITER" label was wrong).
  **No geofence** is configured (the "configured but disabled" fence never existed). Compass: external IST8310 only,
  with a new calibration procedure and four-direction check.
- **Airframe facts:** Heewing T2 **Cruza**, **3 motors** (M1/M2 tilt, M4 tail). Altitudes are **REL (above home)**,
  not AGL. Transition **into wind**.
- **Checklists** expire after 6 h, record the time of every tick, and were rewritten for the relay (camera state,
  GCS app start paths, laptop sleep disabled, home landing zone clear, compass check). The pre-flight
  "Failsafe params verified" copy block is the owner's exact list.
- **Emergency cards** (one source for the Tools modal, the manual, the kneeboard print and the emergency-only phone
  mode): SIYI/GCS loss first, relay PCB, video loss, camera, GCS app/controller failure with the **RESUME (client
  airborne)** path, client RC loss, battery ladder, transition.
- **Imported parameter files:** a file that disables a battery failsafe shows a red DISABLED statement on every
  surface (header, banner, cards, checklists, analysis, manual) — never a silent fallback to the reference value.

### Pages

- **Flight Tools (`index.html`):** shared versioned data store (`js/store.js`) for the battery log
  per pack, preflight archive, weather favourites, profiles (clients, packs, links), flights, maintenance and the
  imported param file; EXPORT / IMPORT / LINK FILE cover all of it and merge by id. **Gist sync removed** (and the
  stored GitHub token with it). New tabs: Link (live GCS-app status), Flights (maintenance tracker, flight records),
  Params (import, comparison against the reference file), Profiles. Battery margin measured to `BATT_CRT_VOLT`
  (was understated by about 3.6 V). `.tlog`/`.bin` parsing fixed and extended (transitions, events, current per
  phase, battery entry), GCS session-log viewer, wind at relay altitude (80/120/180 m), cloud and visibility,
  verified Norwegian airspace/NOTAM links, challenge–response checklist mode, accessibility work, CSP, escaping.
- **Operations manual (`manual.html`):** rewritten for the relay. New chapters Relay Electronics, Client Drones
  (any analog FPV drone; the Matek/Betaflight quad is "Reference client #1"), and **Reference ▾ Parameters** (all
  1663 parameters of the reference file, searchable). Deep links (`manual.html#tab/anchor`), search that opens the
  tab and highlights the hit, 16 standalone diagrams **D1–D15 + D8b**, battery gauge and GPS-Rescue trajectory drawn
  from the profiles.
- **Coverage map (`relay/map.html`):** link model v2 — video, RC and HM30 link profiles with per-link budgets,
  Fresnel clearance, foliage loss, the video ∩ RC **operating area**, orbit sweep (worst/best case), correct
  geometry (rotation and depression fixes), mission playback for the project's own template (`VTOL_TAKEOFF`,
  `LOITER_TO_ALT`, `VTOL_LAND`), live carrier/client layer from the GCS app, measured-LQ heatmap. Leaflet 1.9.4 is
  vendored; no hard-coded site; tile-download policy respected.
- **New `tools/latency-clock.html`** for the glass-to-glass test.
- **Offline / field use:** self-hosted fonts, shared `css/base.css`, a generated precache list (`sw-precache.js`)
  covering every page, script, image and diagram, network-first code with a 4 s timeout, a "NEW VERSION AVAILABLE —
  RELOAD" prompt, installable web app (manifest, icons), screen wake lock, sunlight/high-contrast mode, print
  kneeboard, emergency-only mode (`index.html#emergency-only`), QR code to the suite. Footers show the app version,
  the content date and the parameter file.
- **Photos (WP22):** two openly licensed representative photos, both CC BY-SA: an analog FPV quad in Client Drones
  (Wikimedia Commons) and a pitot-static tube in Maintenance (ArduPilot docs). Their caption and alt text say
  "Representative image", and the caption carries a credit line (author, licence, source link). The manual has a
  visible "Image Credits" section (Reference ▾ Abbreviations, `manual.html#abbrev/image-credits`) with a row for
  every photo it uses, and `img/README.md` has a credits table (author, licence, source page, file URL, date
  checked). The four vendor marketing images (`t2_vtol`, `t2_vtol2`, `matek_f405`, `siyi_hm30`) stay, captioned as
  vendor images, with their licence marked "not recorded", until the owner's own photos (shot list in
  `img/README.md`) replace them.

### GCS companion app (new, `gcs/`)

- Windows app in Python 3.12 (standard library + `pygame-ce`): RC sender at 250 Hz on absolute deadlines, interlocks
  and the two start paths (**normal**: arm switch safe and throttle low; **RESUME (client airborne)**: arm switch
  ARMED, live preview, typed `RESUME`/`THROTTLE`; never automatic), carrier-only mode behind typed `NOCLIENT`/`LANDED`
  confirmations, camera control with read-back, client telemetry and 18 alarm rules, read-only MAVLink input (never
  sends MAVLink to the carrier), local read-only API (`127.0.0.1:47800`, contract C2), JSONL session log.
- Tk UI in its own process, video fan-out process (UDP 5600 → 5601 viewer / 5602 Mission Planner HUD), display-only
  client vehicle for Mission Planner (sysid 2), ELRS parameter menu and VTX Admin (needs bridge firmware Q7a), test
  tools (RTT, failsafe timer, camera test, glass-to-glass clock), PyInstaller packaging and a firewall script.
- Hardened local control channel (user-only pipe, per-connection and server rate limits, final stop), a sender
  without a console window when the UI starts it, and typed confirmations for every console action that changes the
  RC stream.
- **Relay UDP protocol v1** (`protocol/README.md`, **PROPOSAL — agree with the G0 firmware before flight**),
  byte-exact test vectors, CRSF reference code with cited sources, and a bridge simulator.
- **Late product changes (WP18, WP19):** the runtime's GIL switch interval went from 0.5 ms to **1 ms**. Below 1 ms
  Windows polls for the GIL, which starved the 250 Hz RC sender on 2–4 CPUs, as on a small laptop or a CI runner.
  At 1 ms it holds 250 Hz with a p99 lateness of about 0.6 ms. CRC-16 is now table-driven, with the same results
  and about 8× faster. The control channel's rate limiter takes an injectable clock (`ControlServer(rate_clock=…)`,
  default `perf_counter`), so its tests are exact; the limits themselves are unchanged.

### Removed / retired

- **The Flask app is retired** (plan A-5, APP-01…07): `relay/app.py`, `relay/templates/`, `relay/start.sh` and
  `relay/requirements.txt` are deleted. Its MAVLink feature sent heartbeats as sysid 255 — the same id as Mission
  Planner — which could mask the SIYI failsafe (S-02b). The static map and the GCS companion app replace it; the
  last version is in the git history before this release.
- Gist cloud sync (and its stored GitHub token), the old RC-failsafe timeline graphic, the obsolete relay-chain
  content, `img/fpv_drone.jpg` (it showed a different aircraft; it stays in the git history, OPEN-ITEMS O-5). The
  archived single-file manual carries an OBSOLETE banner and
  `noindex`.
- The `ai/` working notes moved to `docs/history/` (historical, partly outdated; `PROJECT_CONTEXT.txt` starts with a
  note pointing to the reference parameter file and plan §15).

### Developer-facing

- Shared modules with Node exports (`js/common.js`, `js/store.js`, `js/tools-core.js`, `js/render-content.js`,
  `js/diagrams.js`, `js/field.js`, `relay/rfmodel.js`, `data/content.js`, `data/params-reference.js`); no build step,
  no frameworks, no npm runtime dependencies.
- Reference parameter file `docs/reference/carrier-params-2026-10-17.param` (byte-exact) and its generator
  `scripts/gen-params-reference.mjs`; diagram generator `scripts/diagrams/`; precache generator
  `scripts/gen-precache.mjs` — each with `--check`.
- Tests: `node --test test/` (unit, rendering, offline simulation, jsdom smoke) and `pytest gcs protocol`.
- **CI** (`.github/workflows/ci.yml`): unit and jsdom tests, html-validate (accepted rules in `.htmlvalidate.cjs`),
  internal link check, image-size budget, inline-SVG colour lint, generated-file checks, the full GCS suite five
  times on Windows, keeping the full log of every run as an artifact. **GCS build** (`.github/workflows/gcs-build.yml`): Windows build, artifact, zip attached to the
  GitHub Release on `v*` tags. `.nojekyll` for GitHub Pages.
- Line endings forced to LF (`.gitattributes`); `watch-push.ps1` and `git-setup.ps1` fixed; images stripped of
  metadata and optimised.
- **CI and test reliability (WP17–WP19):** every GCS test has a hard timeout with a stack dump. A hang that holds the
  GIL ends through faulthandler, and a hang at interpreter exit has its own guard. Failures are written as they
  happen and annotated by test id. A leaked thread fails its test; processes a test started are stopped by PID.
  Tests that need a real desktop are marked `interactive_desktop` and run before each release (OPEN-ITEMS M-16).
  The racy or few-ms-margin tests (stalled handshakes, rate limit, FAILSAFE timing, sender rate) are race-free or
  run on a fake clock. After a teardown timeout, later tests still get fresh fixtures. pytest is pinned to
  `>=9.1,<9.2` (`gcs/README.md` "Upgrading pytest").
- Docs: `README.md`, `CLAUDE.md`, `CONTRIBUTING.md` (content-review checklist), this changelog, `docs/relay/` (IP
  plan, firmware requests, open items, test-results template).

### Known open items

Not implementable in software or not yet decided: the relay PCB and its firmware, KSZ8795 register names, the
measurements (HM30 capacity/latency, failsafe times, glass-to-glass, co-site RF, S-01a), owner decisions Q3/Q13/Q14,
own photos, and more — see [`docs/relay/OPEN-ITEMS.md`](docs/relay/OPEN-ITEMS.md) and
[`docs/relay/FIRMWARE-REQUESTS.md`](docs/relay/FIRMWARE-REQUESTS.md). The pages show each as an amber TBD/VERIFY.

**Upgrade notes:** stored browser data migrates automatically (legacy keys → `vtol_store`; settings that were never
edited move to the Rev C thresholds, with a one-time notice). An older GCS-app `config.json` that still uses
`alarms.jitter_p99_max_ms` fails validation with a clear message: rename the key to `alarms.send_late_max_ms`.

## [1.x] — before 2026-10

The single-file manual, then the two-page suite (Flight Tools + Operations Manual) with the coverage map and the
Raspberry Pi Flask backend, for the old relay chain. See the GitHub Releases and the git history; the working notes
of that period are in `docs/history/`.
