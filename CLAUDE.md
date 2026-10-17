# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is the
single source for the project's architecture and conventions (plan REP-03). The notes in `docs/history/` are
historical and partly outdated — never take values from them.

## Project overview

Field software for a VTOL FPV relay system (release 2.0.0):

- **Carrier:** Heewing T2 **Cruza** VTOL, ArduPlane QuadPlane, 3 motors (see "Aircraft configuration").
- **Relay:** a two-board PCB on the carrier — **video board** (STM32N657, CVBS → H.264 → RTP/UDP 5600) and
  **net/RC board** (KSZ8795 5-port switch; W5500 + STM32G030 bridge: UDP 5770 RC in → CRSF to an ELRS TX module of
  any band). Switch ports: P1 HM30 · P2 W5500 · P3 IP camera (switched by `CAM_ENABLE`) · P4 spare · P5 N6.
- **Client:** any analog FPV drone ("client profile"; the Matek F405 / Betaflight quad is Reference client #1).
- **Links:** the SIYI HM30 is the only ground ↔ carrier link. The 915 MHz Nomad is the carrier's **close-range
  backup only**.
- **Ground station:** Windows only — Mission Planner plus the **GCS companion app** in `gcs/`.

Pages are hosted on GitHub Pages at **https://melonno.github.io/vtol-manual/** (repo `MelonNO/vtol-manual`) and work
fully offline via `sw.js`. No build step, no frameworks, no npm runtime dependencies — plain HTML/CSS/JS.

**Sources of truth:** `docs/SOFTWARE-IMPROVEMENT-PLAN.md` (requirements; §1.1 owner decisions, §4 safety, **§15 Rev C
values supersede older values**), `docs/reference/carrier-params-2026-10-17.param` (the carrier's parameters),
`docs/tasks/02-CONTRACTS.md` (interfaces between modules), `protocol/README.md` (relay UDP protocol, PROPOSAL), the
relay design document (owner's, not in the repo; see `docs/relay/README.md`).

## Owner decisions that must never be contradicted

- **The carrier fails safe only on SIYI/GCS link loss.** `THR_FAILSAFE = 2` (RC loss detected, **no failsafe
  action**) and `FS_GCS_ENABL = 2` (GCS failsafe in **all** modes) are intentional. Losing the 915 MHz link out of
  range is expected and harmless.
- Mission Planner is the heartbeat: never close it in flight. **No other program may send MAVLink as sysid 255**
  (S-02b). The GCS app never sends MAVLink to the carrier; its display-only client stream to MP uses sysid 2.
- An airborne client must never receive a DISARMED start: after a GCS-app failure the only way back is
  **RESUME (client airborne)** (arm switch ARMED, typed confirmation). The app never auto-resumes.
- Camera gating is only needed while a client is connected; ELRS band any; VRX band per client; PAL **and** NTSC.
- Gist sync is removed (keep EXPORT / IMPORT / LINK FILE). The Flask app (`relay/app.py`) is retired and deleted.

## Working on this project

No build step. Serve the repo root (`python -m http.server 8000`) and edit files directly. Work on a branch; commit
deliberately (`scripts/watch-push.ps1` exists — it auto-commits an allow-list of tracked paths and pushes — but
prefer normal commits and pull requests). Never force-push `main`; roll back with `git revert` or by restoring a tag
in a new commit (README "Releases and rollback").

**After changing anything the field needs** (a page, `js/`, `data/`, `css/`, `fonts/`, `img/`, `icons/`, the map,
`tools/`, the manifest), run `node scripts/gen-precache.mjs` and commit `sw-precache.js`. The service-worker cache name
is derived from `VTOL_VERSION.app` and the content hash, so there is **no `CACHE` constant to bump** any more; a test
fails while the precache list is stale.

Other generators (each has `--check`; CI runs them):

| Command | Regenerates |
|---|---|
| `node scripts/diagrams/build.js` | `img/diagrams/*.svg` (D1–D15 + D8b), the manual's diagram slots and its inline SVGs, from `scripts/diagrams/*.js` |
| `node scripts/gen-params-reference.mjs` | `data/params-reference.js` from `docs/reference/carrier-params-*.param` |
| `python gcs/tools/gen_test_vectors.py` | `protocol/test-vectors.json` |

Tests and checks (all must stay green):

```bash
node --test test/                                        # Node 24 (test/index.js loads every *.test.js)
VTOL_JSDOM=<path>/node_modules/jsdom node --test test/   # + the jsdom tests and test/smoke/ page smoke tests
node scripts/check-links.mjs ; node scripts/check-images.mjs ; node scripts/check-colours.mjs
python -m pytest gcs protocol                            # Python 3.12, pytest, pygame-ce
```

jsdom and html-validate are installed outside the repo (never add `node_modules` or a `package.json`). CI:
`.github/workflows/ci.yml` (tests, jsdom smoke, html-validate with `.htmlvalidate.cjs`, links, image budget, colour
lint, generated files, GCS suite ×5 on Windows) and `.github/workflows/gcs-build.yml` (Windows build, release zip).
Tests that read repo files as text use `test/repo-files.js` (`readText`, LF-normalised); `.gitattributes` forces LF.

## Architecture

| File / folder | Purpose |
|---|---|
| `index.html` | **Flight Tools**: checklists, emergency modal, Link (GCS app status), Battery Log, Telemetry (`.tlog`/`.bin`/session log), Flights (records, maintenance), Params (import/compare), Weather, Profiles |
| `manual.html` | **Operations manual**: grouped dropdown nav, all chapters, Parameters tab, Emergency tab |
| `relay/map.html` + `relay/rfmodel.js` | **Coverage map** (static, no server): link profiles, terrain LOS, Fresnel, foliage, operating area, orbit sweep, mission playback, live layer. Leaflet vendored in `relay/vendor/leaflet/` (byte-exact, `-text`) |
| `tools/latency-clock.html` | Millisecond clock for the glass-to-glass test |
| `data/content.js` | `VtolContent` — **single source** of checklists, post-flight, emergency cards and notes, failsafe table, client failsafe chain, network table, callouts, GStreamer pipelines, SDP, failsafe copy block (contract C5) |
| `data/params-reference.js` | `VtolParamsRef` — generated from the reference `.param` file (C1.6) |
| `js/version.js` | `VTOL_VERSION = { app, content, paramFile }` (C4) |
| `js/common.js` | `VtolCommon`: `escH`, `fmtTime`, `fmtDuration`, `toggleCleanup`, `copyToClipboard` (C4) |
| `js/store.js` | `VtolStore`: the versioned shared data store `localStorage.vtol_store` (C1): packs, clients, links, battery log, archive, favourites, flights, maintenance, `paramFile`, settings; validation, merge-by-id import, tombstones, Rev C migration, one-time notices |
| `js/tools-core.js` | `ToolsCore`: pure Tools logic — battery maths and thresholds, `effectiveSettings` / `contentForFailsafes` (imported param file precedence, DISABLED failsafes), `.tlog`/`.bin`/session-log parsers and analysis, weather, sun, checklist sessions, param-file parse/compare |
| `js/render-content.js` | `VtolRender`: HTML renderers for `VtolContent` (checklists, emergency cards, tables, callouts, Link view); escapes everything, fills `{tokens}` from the profiles/settings, renders `[[TBD — …]]` / `[[VERIFY — …]]` amber |
| `js/diagrams.js` | `VtolDiagrams`: generated SVG (battery gauge, trend, sparkline, wind compass, time charts, GPS-Rescue trajectory) — CSS variables only |
| `js/gcs-client.js` | `GcsClient`: the C2 client for the GCS app API (`http://127.0.0.1:47800`), health polling, SSE, never throws |
| `js/field.js`, `js/emergency-only.js` | `VtolField`: SW registration + RELOAD toast, version footer, sunlight mode, wake lock, QR, print kneeboard; emergency-only phone mode (`index.html#emergency-only`) |
| `css/base.css`, `css/print.css`, `fonts/` | Shared tokens and base styles, `@font-face` (self-hosted Oswald, Share Tech Mono); print/kneeboard styles |
| `sw.js`, `sw-precache.js` | Service worker: precache from the generated list; pages/JS/CSS network-first (4 s timeout), other assets stale-while-revalidate; cross-origin never intercepted |
| `gcs/` | Windows GCS companion app (`vtolgcs` package), tests, `tools/bridge_sim.py`, packaging (see `gcs/README.md`) |
| `protocol/` | Relay UDP protocol v1 (PROPOSAL) and test vectors (C3) |
| `docs/` | Plan, contracts and work-package records (`docs/tasks/`), parameter reference, `docs/relay/` (IP plan, firmware requests, open items, test results), `docs/history/` (old notes) |
| `archive/` | The obsolete single-file manual (OBSOLETE banner, `noindex`; not maintained) |

Shared JS files work in the browser **and** in Node tests with this wrapper (pick a clear global name):

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToolsCore = api;
})(typeof self !== 'undefined' ? self : this, function () { /* ... */ return { fnA, fnB }; });
```

All pages share one origin, so they share `localStorage`. Every store write fires the window event
`vtol-store-changed`; Tools (`vtolRefreshAll()`), the manual (`renderManual()`) and the map listen to it and
re-render every surface (safety values must never be stale after an import or a settings edit).

**localStorage keys:**

| Key | Contents |
|---|---|
| `vtol_store` | The shared store (C1). Legacy keys `vtol_battlog`, `vtol_pf_archive`, `vtol_wx_fav`, `vtol_batt_type` are migrated into it once; `vtol_gh_*` / `vtol_last_sync` (Gist) are deleted |
| `vtol_cl_preflight`, `vtol_cl_turnaround` | Checklist sessions `{session:{id,startedAt}, items:{id:{checked,ts}}}`, 6 h expiry (`vtol_cl2`/`vtol_cl3` are legacy) |
| `vtol_store_notices` | One-time notices (e.g. the Rev C threshold migration) until dismissed |
| `vtol_active_tab`, `vtol_bl_pack`, `vtol_manual_tab`, `vtol_map_state`, `vtol_sunlight`, `vtol_wx_cache`, `vtol_latency_samples` | Per-device UI state and caches |

## Aircraft configuration

**Heewing T2 Cruza — 3 motors (not 4):**
- **M1, M2** — wing-mounted tilt motors: VTOL lift and fixed-wing propulsion. `Q_TILT_MASK = 3`. `Q_TILT_MAX = 80`
  is the tilt held during the forward transition while airspeed builds; in fixed-wing flight they tilt fully forward
  (ArduPilot tilt-rotor guide; marked VERIFY in the manual). Tilt rate 45°/s.
- **M4** — tail-mounted vertical lift motor, VTOL only; stops once the transition is complete.

Do not confuse with quad layouts: ArduPlane tricopter naming (M1/M2/M4, no M3), `Q_FRAME_CLASS = 7`.
Compass: external **IST8310** on the GPS mast only (`COMPASS_EXTERNAL = 2`, internal AK09916 disabled) — no backup
compass, no arming without the mast unit. No geofence. Altitudes are **REL (above home)**, not AGL.

## manual.html tab structure

Grouped dropdown navigation (`#nav`), every item a `[data-tab]` button:

| Nav item | Tab ids |
|---|---|
| Overview | `overview` (direct) |
| Aircraft ▾ | `aircraft`, `flightmodes`, `relay` (Relay Electronics), `clients` (Client Drones; `#fpv` is an alias) |
| Operations ▾ | `procedures`, `mission`, `callouts` |
| Planning ▾ | `missionplan`, `crew`, `maintenance` |
| Reference ▾ | `comms`, `prearm`, `abbrev`, `params` (all parameters of the reference file) |
| ⚠ Emergency | `emergency` (direct, always red) |

Key functions: `showTab(name, anchor, opts)` (every tab switch; updates the hash `#tab/anchor` and `vtol_manual_tab`),
`selectNavItem(name, btn, e)`, `toggleNavGroup(btn)`, `manGoTo(k)` (search hit → opens the tab, scrolls and
highlights), `renderManual()` (renders the shared content, tokens and diagrams; runs on load and on store changes),
`fillFailsafePhrases()` (a `data-fs` phrase becomes a red DISABLED statement when the imported param file disables
that failsafe). The pure helpers are in the inline `<script id="manual-core">` (`ManualCore`, tested from Node).

## index.html — checklist system

Checklists come from `VtolContent.checklists.preflight` / `.turnaround` (sections A–E / T1–T3) and are rendered by
`VtolRender.checklist(list, state, ctx, { colors: SEC_COLORS, prefix })`. Item shape:

```js
{ id: 'stable-id',        // key of the saved state — never reuse or renumber; a changed meaning gets a new id
  s: 'short title ≤5 words', t: 'full detail text', n: 'note text',
  w: true,                // amber warning flag (left border + ! dot)
  copy: true,             // note is a copyable block;  extras: [{label, val}] multiple copyable values
  auto: 'rule-id' }       // live AUTO ✓/✗ hint from the GCS app status (the pilot still ticks)
```

Text markup in content: `` `code` ``, `**bold**`, `[[MODE]]` badge, `[[TBD — …]]` / `[[VERIFY — …]]` amber,
`{client.…}` / `{settings.…}` / `{clientPack.…}` tokens (null → TBD). Rows split 50/50: the left half ticks, the
right half opens the detail (mobile tap targets). Key functions: `renderContent()`, `toggleCI(el, e)`,
`toggleDetail(key, r, e)`, `crOpen(name)` (challenge–response), `openEmerg()` / `emergJump(id)`, `vtolRefreshAll()`.
Section accents `SEC_COLORS`: A `#60a5fa`, B `#f97316`, C `#22c55e`, D `#a78bfa`, E `#f43f5e`, T1–T3 orange /
purple / rose (hex with alpha suffixes, pre-existing).

## Emergency procedures structure

One source (`VtolContent.emergencies`, `emergencyNotes`) for the Tools modal, the manual Emergency tab, the print
kneeboard and the emergency-only mode. Two tiers per scenario:

1. **IMMEDIATE** — `.emerg-imm`: short memory items, always visible, no explanations.
2. **CLEAN-UP** — `.emerg-cleanup`: collapsible amber section read from the screen once stable
   (`toggleCleanup(btn)`).

CSS: `.emerg-imm`, `.emerg-imm-badge`, `.emerg-imm-step`, `.emerg-cleanup-btn`, `.emerg-cleanup`, `.emerg-cu-label`,
`.emerg-cu-step`. The 915 MHz backup-link loss is a **note**, never an emergency card.

## Battery chemistry thresholds

`ToolsCore.BATT_CHEM` — per-cell voltages:

```js
lipo:  { full:4.20, nominal:3.70, low:3.35, critical:3.10, name:'LiPo' },
liion: { full:4.20, nominal:3.60, low:3.20, critical:2.90, name:'Li-Ion' },
life:  { full:3.65, nominal:3.30, low:3.00, critical:2.70, name:'LiFe' }
```

- `critical 3.10` is deep in the SEI damage zone (the hard floor, not the damage point itself); `low 3.35` is the
  longevity floor; `full 4.20` theoretical (typical charge ends at 4.15–4.18).
- **Sag vs resting:** under-load dips are I × R_internal and recover at once; judge pack health by the resting voltage
  after flight.
- Pack thresholds come from the pack profile and the settings: `ToolsCore.packThresholds(pack, settings)`.
  Health classes (avgMin/cells): CRITICAL < critical + 0.05, LOW < low + 0.05, MARGINAL < low + 0.10, else HEALTHY.

## Carrier voltage ladder (6S 7000 mAh LiPo) — plan §15.3, reference param file 2026-10-17

| Threshold | Pack V | V/cell | What happens |
|---|---|---|---|
| Full charge | 25.2 | 4.20 | — |
| Arming minimum (`BATT_ARM_VOLT`) | 24.6 | 4.10 | arming refused below (a part-used pack cannot be flown) |
| Manual RTL trigger (pilot, OSD raw) | 23.0 | 3.83 | pilot initiates RTL |
| Hard RTL limit (pilot discipline) | 22.5 | 3.75 | RTL must be active |
| `BATT_LOW_VOLT` | 22.0 | 3.67 | **automatic RTL** after `BATT_LOW_TIMER` 10 s (`BATT_FS_LOW_ACT = 1`): home at 120 m, automatic VTOL landing at home |
| `BATT_CRT_VOLT` | 21.0 | 3.50 | **automatic Loiter → QLand at the current position, not home** (`BATT_FS_CRT_ACT = 6`) |
| Storage | 22.8 | 3.80 | — |
| Hard floor | 18.6 | 3.10 | — |

The failsafes read a **sag-compensated** (resting) estimate (`BATT_FS_VOLTSRC = 1`); the pilot reads **raw** voltage
on the OSD / Mission Planner, which is lower under load — so the pilot's 23.0 V call comes well before the automatic
22.0 V. If the low-battery RTL fires during a manual QHOVER landing, the aircraft switches to RTL (fixed-wing return,
climb to 120 m); the pilot reselects QHOVER on the Nomad switch to finish. It does not interrupt QLAND, QRTL or an AUTO
VTOL landing. Store defaults (C1.6): `battCrtVolt 21.0`, `battLowVolt 22.0`, `battArmVolt 24.6`, `manualRtlVolt 23.0`,
`hardLimitVolt 22.5`; an imported param file's `BATT_*_VOLT` values take precedence (`ToolsCore.effectiveSettings`).

**Storage voltage: 22.8 V (3.80 V/cell) for 6S** — optimal storage state of charge is 40–60 % ≈ 3.80–3.85 V/cell.
`BATT_CRT_VOLT` (21.0 V) and `BATT_LOW_VOLT` (22.0 V) are operational failsafe thresholds, **not** storage targets.

**Battery-log recommendation (plan §15.4):** the Tools battery analysis **no longer recommends a `BATT_LOW_VOLT`**.
`BATT_LOW_VOLT` is a deliberate 22.0 V RTL failsafe on sag-compensated voltage; raising it from landing voltages would
turn it into an early RTL at 23 V or more. The output is "**Suggested manual RTL trigger (pilot, OSD raw voltage)**":
`ToolsCore.suggestManualRtl` = average landing (minimum) voltage + 0.8 V return margin (`RETURN_MARGIN_V`), floored
at the manual RTL trigger `settings.manualRtlVolt` (23.0 V). It shows the margins to the configured 22.0 V / 21.0 V
failsafes as fixed values and never suggests changing them.

## Key failsafe and transition behaviour (plan §15.2)

| Event | Behaviour |
|---|---|
| 915 MHz RC loss | **No action** (`THR_FAILSAFE = 2`); in QHOVER the aircraft holds with centred sticks and drifts with the wind (S-01a: VERIFY by SITL/bench) |
| SIYI/GCS loss | All modes, after `FS_LONG_TIMEOUT` 5 s (or HM30 `remrssi = 0` if reported): fixed-wing modes → **RTL**; VTOL modes → **QRTL** (`Q_OPTIONS = 426016`, bit 5) |
| Transition timeout | At **8 s** (`Q_TRANS_FAIL`) the transition is cancelled → **QRTL home** (`Q_TRANS_FAIL_ACT = 1`; never QHOVER). The pilot may still select QHOVER at 2–3 s |
| RTL (any trigger) | Home in fixed-wing at `RTL_ALTITUDE` 120 m (REL), loiter down, **automatic VTOL landing at home** (`Q_RTL_MODE = 2`): keep the home landing zone clear |
| Battery low / critical | 22.0 V → RTL; 21.0 V → QLand at the current position |

Other Rev C values: `AIRSPEED_CRUISE` 12 m/s, `AIRSPEED_MIN` 10 m/s, `Q_TRANSITION_MS` 3500, `Q_BACKTRANS_MS` 8000
(≈ 100 m), `Q_RTL_ALT` 50 m, `TRIM_THROTTLE` 30 %, `Q_M_THST_HOVER` 0.35 (learned, drifts), `FLTMODE2` = 11 (RTL, not
on the 3-position switch: QHOVER / FBWB / AUTO).

## Known issues / gaps

1. **No geofence configured** — `FENCE_ENABLE = 0`, `FENCE_TYPE = 0`, `FENCE_TOTAL = 0`; the leftover
   `FENCE_ALT_MAX = 100` / `FENCE_RADIUS = 300` do nothing. If a fence is ever enabled, document first: ALT_MAX 100 <
   `RTL_ALTITUDE` 120, and RADIUS 300 < the planning distances.
2. **`BATT_FS_CRT_ACT = 6`** — critical battery (21.0 V) fires Loiter → QLand at the **current position**, not RTL
   home.
3. **RC loss triggers no action** (`THR_FAILSAFE = 2`) — by design: the 915 MHz link is close-range backup.
4. **Transition timeout 8 s → QRTL home** (`Q_TRANS_FAIL_ACT = 1`, `Q_OPTIONS = 426016`): keep the route from WP2 back
   to home clear — it is the QRTL path.

(`BATT_LOW_VOLT` is now set — 22.0 V, automatic RTL — and is no longer a known issue.) Everything not yet measured or
decided (relay firmware, HM30 capacity, S-01a, IPs, Nkom, photos, …): `docs/relay/OPEN-ITEMS.md`.

## Client drones — Reference client #1 (Betaflight)

Profile values from `docs/FPV_betaflight_dump.txt` (store default client): Matek F405 STD (clone), Betaflight 4.5.2,
6S 1300 mAh LiPo, VTX Raceband R5 5806 MHz 25 mW, ELRS 2.4 GHz CRSF, failsafe **GPS Rescue** (8+ sats, 2.5 s delay).
Bind once per client (binding phrase / model match) — there is **no per-flight bind** with the new relay. Unknown
profile fields (video standard, packet rate, model id, telemetry ratio) are `null` and render as TBD.

## GCS companion app (`gcs/`)

Python 3.12, standard library + `pygame-ce` (joystick), `pytest`, `pyinstaller`. Separate processes: the **RC
sender** (`python -m vtolgcs --headless`, `vtol-gcs-sender.exe`), the **Tk UI** (`python -m vtolgcs`,
`vtol-gcs.exe`) and the **video fan-out**. Every flight-safety guard lives in the sender (`sender.py`); the UI talks
to it through a user-only named pipe with typed words. Config `%APPDATA%\vtol-gcs\config.json` (tests must use
temporary folders — never the real one). Details: `gcs/README.md`. Simulator: `gcs/tools/bridge_sim.py`.

## Style conventions

All colours via the CSS variables in `:root` of `css/base.css` — never hard-code new colours in page CSS or inline
SVG (inline SVG uses `fill="var(--accent)"`; `scripts/check-colours.mjs` fails on hex in inline SVG or inline styles).
Standalone `.svg` files cannot read page variables: they use the same hex values with a palette comment
(`img/README.md`).

| Variable | Value | Use |
|---|---|---|
| `--accent` | `#f97316` | Orange — primary accent |
| `--red` | `#ef4444` | Danger / emergency |
| `--green` | `#22c55e` | GO / healthy |
| `--amber` | `#facc15` | Warning / caution, TBD and VERIFY markers (`.warn-val`) |

Fonts: `Oswald` (headings), `Share Tech Mono` (body), self-hosted in `fonts/`. Base 15 px. Mobile first: works at
360 px width, tap targets ≥ 44 px, checklist rows 50 px min-height, checkboxes 24 × 24 px; on mobile (≤ 600 px)
`index.html` uses a fixed bottom nav. Escape every dynamic text inserted with `innerHTML` (`VtolCommon.escH()` or
`textContent`). Offline first: no CDN dependencies.

**Safety-critical content:** every parameter value, threshold, IP or procedure must come from the plan, the relay
design, the reference parameter file or the existing manual. Unknown → a visible amber `TBD — <what is needed>`; to be
confirmed → `VERIFY — <against what>`. Never invent numbers. Review checklist: `CONTRIBUTING.md`.

## Key network addresses / copyable strings

Keep consistent with `data/content.js` (`network`, `pipelines`, `sdp`) and `docs/relay/IP-PLAN.md`:

- Mission Planner: **UDPCI** · IP `192.168.144.12` · port `19856` (HM30 ground unit)
- HM30 air unit `192.168.144.11`; subnet `192.168.144.X / 255.255.255.0`; laptop `.X` suggested `.100` (TBD, Q3)
- Client video: RTP/UDP **5600** from the N6 → GCS app fan-out → `127.0.0.1:5601` (viewer), `:5602` (MP HUD). The
  old FPV RTSP stream `rtsp://192.168.144.25:8554/main.264` is **removed**.
- Carrier camera RTSP: `rtsp://192.168.144.26:8554/main.264` (behind switch P3, `CAM_ENABLE`)
- RC bridge: UDP **5770** at the bridge (IP TBD, proposal `.21`); N6 IP TBD (proposal `.20`)
- GCS app local API `http://127.0.0.1:47800/api/v1/…`; MP mirror in `127.0.0.1:14551`; client vehicle out
  `127.0.0.1:14560` (sysid 2)
- GStreamer pipelines (PAL/NTSC viewer and MP HUD, carrier camera) live in `VtolContent.pipelines` — copy from there
