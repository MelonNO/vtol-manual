# WP02 verification — round 1
VERDICT: REJECTED

Verifier: independent verification agent. Worktree `S\wt\WP02`, branch `wp/02`, HEAD `2e6253b`. Diff base = `git merge-base main HEAD` = `5a2377e`. Current main = `071d794` (WP04 and WP01 merged, C1.4 added).

**Why rejected:** one MAJOR finding (F1). WP02's fallback default profiles do not match `js/store.js` on main: 4 ids and 2 fields differ. Contract C1.4 is now normative and says "WP02's fallback must match them", and the brief requires the fallback to be "byte-for-byte the C1 default link/client profiles". Everything else passes.

## Scope

Changed files (`git diff --stat 5a2377e HEAD`):

| File | Owned per brief? |
|---|---|
| `relay/map.html` | yes |
| `relay/rfmodel.js` | yes (new) |
| `relay/vendor/leaflet/{leaflet.js, leaflet.css, LICENSE, images/*.png}` | yes (new) |
| `js/gcs-client.js` | yes (new, C2 owner) |
| `test/map/{live, mission, rfmodel-coverage, rfmodel-geo}.test.js` | yes |
| `test/fixtures/{template-7wp, frames-mixed}.waypoints` | yes |
| `docs/tasks/reports/WP02-IMPLEMENTATION.md` | yes |
| `test/index.js` | no; justified in report §5.1 (Node 24 needs a directory entry point) |

`test/index.js` is the **same blob** as main's (`47892fc6…` on both). All scope checks pass.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 MUST (MAP-06) | PASS | `map.html:7-8`; `relay/vendor/leaflet/*` | Leaflet 1.9.4 is vendored with its BSD-2 LICENSE. `leaflet.js` blob SHA-256 = `20nQCchB…BZo=`, the official SRI. jsdom shows `L.version === '1.9.4'`. There is no `unpkg` and no other new CDN; the Google Fonts import was already there. The CSS blob is LF-normalised (see F2). |
| R2 MUST | PASS | `rfmodel.js` sections :53-627 | Geodesy, tiles, FSPL/budget/range, Fresnel, Weissberger, `nedToBody`, antenna, `traceRay`, coverage, sweep grid, mission parse/step and live helpers are all pure and Node-exportable. `map.html` keeps only DOM, Leaflet and fetch code. Each function family has tests in `test/map/`. |
| R3 MUST (MAP-03) | PASS | `rfmodel.js:165-172` | Checked against my own DCM product R1(φ)·R2(θ)·R3(ψ) on 2000 random cases: max error 2.2e-16. θ = +10° with a level target ahead gives body (0.985, 0, +0.174), so z > 0 (below the nose). A target 10° below the horizon at θ = +10° comes out 20° below the nose. |
| R4 MUST (MAP-04) | PASS | `rfmodel.js:311` (`dep = hAsl − inf.targetAsl`), `:256` (`targetAsl = g + targetAgl` per sample) | Own check: 620 m ASL over a 500 m plateau gives the same coverage as 120 m over 0 m. 620 m over 0 m gives a different result. |
| R5 MUST (MAP-05) | PASS | `rfmodel.js:221-287` (clearance `k·F1 + mg` :239), `demStep` :290; UI `map.html:410-414` | Clearance has k = 0.6 (editable) plus a margin (default 0); the fixed 25 m is gone. Spacing is the z11 pixel at the ray's highest latitude: 38.2 m at 60°N. The brief's "76 m" is the equator value, so the implementer's correction is right. On a ridge, `traceRay` matches my own brute-force LOS exactly (2040 m, terrain). Shadow-re-acquired segments are drawn as muted dotted lines (`map.html:1073-1085`). See F5 for the 8× spacing across missing data. |
| R6 MUST (MAP-01/14) | PASS | `rfmodel.js:446-570`; `map.html:262` (min 11), `:294` (list documented) | My own file (VTOL_TAKEOFF 84 at 0/0, WAYPOINT 16, LOITER_TO_ALT 31 AMSL r150, DO_CHANGE_SPEED 178, WAYPOINT frame 10, LOITER_TO_ALT r−200, WAYPOINT, VTOL_LAND 85; mixed tabs/spaces; CRLF) parses to **7 items**: 84,16,31,16,31,16,85, with 1 line ignored. Frames resolve to rel/amsl/terrain correctly (AMSL 290,330,400,400,310,300,250). Playback: LOITER_TO_ALT climb time = Δh / 5 m/s; negative radius loiters CCW; altitude never jumps; LOITER_TURNS 2 × r100 takes 96.7 s (= 2·2π·100/13). |
| R7 MUST (MAP-02, §8.2-1) | PASS | `map.html:366-405`, `loadProfiles` :597, `persistLink` :623, `saveProfileForm` :1893; VTX `:340` 0–33, `vtxFromProfiles` :1245 | All LinkProfile fields are editable. With main's `store.js`, a save goes into `vtol_store` and edits the record in place (jsdom). Without the store, it goes to `vtol_map_state`. The VTX default is 14.0 dBm · 25 mW, from the client `vtx.powerMw`. |
| R8 MUST (§8.1/8.2) | PASS | `rfmodel.js:302-342`; `map.html:1046-1086`, legend :478-482, `tbdText` :1143 | jsdom: with null sensitivity there is no RC polygon and no operating area, and the legend reads "RC link: TBD — set TX power, TX gain, RX gain, sensitivity in profile". Once the profile is filled, the RC polygon and the "OPERATING AREA" polygon appear. op = per-bearing min(video, RC) is checked on every bearing. Own synthetic test: `intersectRanges` gives a correct per-bearing minimum. |
| R9 MUST (§8.2-4, MAP-16) | PASS | `rfmodel.js:135-147`; used at :315-319 (client) and :376-379 (GCS); notes :368-370 | The formula matches Weissberger's modified exponential decay (0.45·f^0.284·d for d ≤ 14 m; 1.33·f^0.284·d^0.588 for 14 < d ≤ 400 m; f in GHz), source ESD-TR-81-101 (1982). It was re-computed for 5 cases plus the clamp. GCS without an HM30 budget = geometry only, with a TBD note (jsdom). |
| R10 MUST (§8.2-7) | PASS | `map.html:345-352`, `setClientAgl` :1250 | Ground 3 / Hover 30 / Cruise 100; persisted. |
| R11 MUST (§8.2-8) | PASS | `rfmodel.js:392-441`; `map.html:1088-1133`, toggles :282-283, legend :490-491 | jsdom orbit (r 150 m, 22 m/s): one full orbit gives "complete" with worst 255 cells ⊆ best 5784 cells, and both toggles work. Own grid test on two overlapping squares: worst = 1 unit, best = 7 units (exact). |
| R12 MUST (§8.3/§14.4) | PASS | `js/gcs-client.js`; `map.html:1921-2005` | C2 shape: `start/stop/BASE`, health backoff 0.5→3 s (capped), SSE when connected, 2 Hz `/status` on SSE error, never throws or logs. jsdom with every fetch returning 404: 9 health polls, "NOT RUNNING", no console output. Simulated status: carrier and client markers appear, LQ 55 → red, a 5-min trail, "LIVE"; disconnect removes the markers. With `gcs-client.js` missing (404): no errors. |
| R13 SHOULD (§14.5) | PARTIAL (accepted) | `map.html:2007-2050`, `binSamples` `rfmodel.js:582` | IndexedDB log at 1 Hz (carrier pos, client pos, LQ, RSSI), heatmap and clear button are done. Not done: binning relative to the carrier, and "observed edge" markers. Acceptable for a SHOULD; the report says so honestly. |
| R14 MUST (MAP-07/13/12/11) | PASS | revoke `map.html:938`; debounce :853-857; `testApi`/`updateCacheInfo` gone; key `RM.tileKey` everywhere; `VEG_MAX_FAILS = 3` :1605/:1636-1655; colour range `rfmodel.js:599-614` | I downloaded the two Kartverket z13 tiles cited. The dominant forest colour is RGB(210,224,150), 66 % and 84 % of the tiles fall in the range, and water (224,254,254) is excluded. The comment's measurement holds. Kartverket sends `Access-Control-Allow-Origin: *`, so canvas sampling works. |
| R15 MUST (MAP-08) | PASS | policy comment `map.html:692-708`; `LAYERS.bulk` :960-971; `updateOfflineUi` :2074; guard :2115 | OSM, OpenTopoMap, ESRI and CARTO are disabled, with a UI note (jsdom). Kartverket is allowed with "fair-use TBD". Terrain stays downloadable and has attribution. |
| R16 MUST (MAP-09) | PASS | `map.html:972-974`, start-up :2166-2191 | jsdom: world view at z2, a hint, no aircraft, and no terrain fetch until a position is set. GCS is not computed when its position is set, only on Compute. There is no `61.22` or `10.768` in the repo files changed. |
| R17 MUST (MAP-10/15) | PASS | `altText` :669, `computeRasl` :657, header :1151, facing :1194/`patchArrow` :1016, `setHome` :1298 | Header: "RELAY COVERAGE — video 5.8 GHz · RC 2.44 GHz". The label shows REL · AGL · AMSL, with REL taken from HOME. The home marker has an explanatory tooltip and is set from mission line 0. |
| R18 MUST | PASS | `escH` :566; `cssVar` :571; new vars `:root` :19 | jsdom: a profile name `<img onerror>`, a file name `mine<b>x</b>` and a flight-mode `<img onerror>` all stay inert. Added lines contain no hex/rgb outside `:root`; the page went from 54 colour literals to 14, all pre-existing or `:root`. |
| R19 MUST | PASS | `test/map/*.test.js` (38 tests) | The tests exercise the real logic: brute-force LOS equivalence on 40 random terrains, DCM vectors, synthetic intersection, sweep, the mission state machine, and GcsClient with injected timers. |

## Contract results

- **C1 (consumer): FAIL — see F1.**
  - When `VtolStore` is present the map uses it correctly:
    - `load()` → `links` / `clients` / `settings.activeClientId`, tombstones filtered
    - saves through `update()` with `updatedAt`, new ids from `uid()`
    - reloads on the `storage` event for `VtolStore.KEY`
  - Verified on the trial-merged tree: the store's ids `link-client-video-58`, `link-elrs-rc` and `link-siyi-hm30` are the ones in use, and the RC edit landed on `link-elrs-rc` with no duplicate.
  - The fallback (store absent) uses different ids and fields:

    | Record | `RfModel.DEFAULT_PROFILES` (rfmodel.js:22-51) | `js/store.js` on main (`IDS` / `defaults()`) |
    |---|---|---|
    | client pack id (and client `packId`) | `pack-ref-client-6s-1300` | `pack-client-ref-6s-1300` |
    | video link id | `link-video-5800` | `link-client-video-58` |
    | RC link id | `link-rc-elrs` | `link-elrs-rc` |
    | GCS link id | `link-gcs-hm30` | `link-siyi-hm30` |
    | client `sizeIn` | `null` | `7` |
    | HM30 `notes` | `''` | `null` |

    Every other field is identical (`verify\WP02\profdiff.js`, log in `profdiff.log`).
- **C2 (consumer + owner of `js/gcs-client.js`): PASS.**
  - BASE `http://127.0.0.1:47800`; `start({onStatus,onAlarm,onConnection})`, `stop()`, `BASE`.
  - Health polling ≤ 3 s; SSE `status` / `alarm`; 2 Hz `/status` fallback; graceful "NOT RUNNING"; never throws.
  - Fields used: `status.carrier.{lat,lon,hdg_deg,alt_rel_m}`, `status.client.gps.{lat,lon,alt_m,sats}`, `status.client.link.{lq_pct,rssi1_dbm}`, `status.client.flight_mode.raw`. All match C2.
- **C4: N/A for WP02.**
  - `js/common.js` did not exist in the worktree, so a local `escH` is used.
  - After the merge it could switch to `VtolCommon.escH` (WP05/WP09 clean-up, not required here).

## Tests run (commands + results)

| Command | Result |
|---|---|
| `export PATH="/c/Program Files/nodejs:$PATH"; node --test test/` in `S\wt\WP02` (Node v24.20.0) | tests 38, pass 38, fail 0 |
| Trial merge: throw-away clone of main at `S\verify\WP02\merge`, `git merge --no-ff wp02` (also `git merge-tree --write-tree main wp/02` → clean, exit 0) | No conflicts. `test/index.js` is the same blob on both sides. |
| `node --test test/` on the trial-merged tree | tests 99, pass 99, fail 0 (WP01 + WP04 + WP02) |
| `node S/verify/WP02/maths.js <wt>` and `<merge>` (own independent maths) | ALL OK on both: DCM, Fresnel, FSPL vs 20·log10(4πdf/c) (constant −147.55 vs exact −147.552, 0.002 dB), budget 105 dB → 731 m, Weissberger, intersection, grid, own 7-WP parse and playback, brute-force LOS, R4 |
| `node S/verify/WP02/profdiff.js <merge>` | 6 mismatches (F1) |
| `npx --prefix S/jsenv html-validate` on base vs WP02 `relay/map.html` | 85 → 94 errors, no new rule categories (details below) |

html-validate breakdown:

| Rule | base | WP02 |
|---|---|---|
| `void-style` | 22 | 37 |
| `no-inline-style` | 40 | 56 |
| `no-implicit-button-type` | 22 | 0 |
| `multiple-labeled-controls` | 1 | 1 |

## Smoke tests (what you loaded/clicked + result)

Script: `S\verify\WP02\smoke.js`, my own.
- jsdom 30 with a `requestInterceptor` serving repo files at `https://melonno.github.io/vtol-manual/…`; anything else returns 404.
- `window.fetch` is stubbed so every request returns 404. That covers terrain tiles and the GCS app.
- Uncaught errors are captured through window `error`, `unhandledrejection`, `jsdomError` and `console.error`.

Three runs, all passing:

1. **Trial-merged tree, real `js/store.js`** (`smoke-merged.log`): ALL OK.
   - No uncaught errors.
   - Header correct; neutral view; no fetch on load.
   - VTX 14.0 dBm; "GCS APP: NOT RUNNING".
   - Placement draws the video polygon; RC is absent and the TBD legend shows. The terrain 404 is handled ("unavailable").
   - RC filled via the editor: RC polygon and OPERATING AREA appear, and the store record is edited in place.
   - Mission: own 7-WP file → "7 NAV items … 1 other lines ignored"; the HTML-ish file name stays inert; home marker; playback "Item 1/7 VTOL_TAKEOFF · vtol climb".
   - Orbit sweep complete, with worst ⊆ best and working toggles.
   - GCS computed only on Compute, with a TBD note.
   - Live markers, LQ colouring, escaping, disconnect cleanup.
   - Zero page console output.
2. **WP02 worktree alone, `store.js` 404** (`smoke-wt.log`): ALL OK. The fallback is used and the save goes to `vtol_map_state`.
3. **Merged tree with `js/gcs-client.js` 404** (`smoke-nogcs.log`): ALL OK. The live layer is harmless without the client.

## Findings

1. **MAJOR — `relay/rfmodel.js:22-51` (`DEFAULT_PROFILES`).** The fallback defaults do not match main's `js/store.js` `IDS` / `defaults()`: 4 ids, client `sizeIn` and HM30 `notes` differ (table under Contract results).
   - Rules broken: C1.4 ("consumers must use these ids; WP02's fallback must match them") and the brief ("byte-for-byte the C1 default link/client profiles").
   - Practical effect: profiles saved while the store is absent, and `vtol_map_state.active.*`, carry ids the store does not know, so they silently fall back to "first of kind".
   - **Expected:**
     - Copy the ids and field values exactly from `VtolStore.IDS` / `defaults()`: `pack-client-ref-6s-1300`, `link-client-video-58`, `link-elrs-rc`, `link-siyi-hm30`, `sizeIn: 7`, HM30 `notes: null`.
     - Add a unit test (e.g. `test/map/rfmodel-geo.test.js`) that `require`s `js/store.js` and asserts `deepStrictEqual(RfModel.DEFAULT_PROFILES.{packs,clients,links}, VtolStore.defaults().{…})`, so the two can never drift again.
     - Rebase or merge `main` into `wp/02` first so `js/store.js` is in the tree.
     - Update report §5.2.
2. **MINOR — `relay/vendor/leaflet/leaflet.css` and report §1 / §5.9.** The upstream `leaflet.css` has CRLF line endings. Git (autocrlf) stored it as LF, so the committed and served blob hashes to `M3v8pcq9…IwM=`, not the official SRI `p4NxAoJB…BMY=`. The content is identical apart from line endings and there is no functional impact; the report's claim "The blobs match the official SRI" is true only for `leaflet.js`. **Expected:** correct the report sentence, or add a `.gitattributes` entry (`relay/vendor/** -text`) and re-commit the byte-exact file.
3. **MINOR — `relay/map.html:623-635` (`persistLink`).** `VtolStore.update()` ignores the result of `save()`, and C1.4 says `save()` returns true/false. When storage is full or blocked the map still toasts "saved to shared store". **Expected:** use `VtolStore.load()` + `VtolStore.save()` and check the return value (fall back to `vtol_map_state` or warn).
4. **MINOR — `relay/map.html:1950`.** `live.status` is written but never read: dead state. Remove it.
5. **MINOR — `relay/rfmodel.js:249`.** After a sample without terrain data, the next step is 8 × step. Where a missing tile is followed by a loaded one, up to 7 DEM pixels of known terrain can go unsampled. This only happens with partial tile loads, and the ray is then flagged `nodata` anyway. **Expected (optional):** cap the coarse step at the next tile boundary, or note the limitation in the comment.
6. **MINOR — `relay/rfmodel.js:545-550` (mission playback).** When the aircraft is already within R + step of a loiter centre (e.g. a loiter at the take-off point), the simulated position jumps up to R metres onto the circle in one step. This is cosmetic.
7. **MINOR — html-validate.** 85 → 94 errors (`void-style` +15, `no-inline-style` +16, `no-implicit-button-type` −22). There are no new rule categories, and the additions follow the file's existing markup style. Acceptable; listed for the record.

## Deviations judged

| Deviation | Judgement | Why |
|---|---|---|
| Auto terrain prefetch capped at 20 km | Acceptable | Documented (`map.html:860-863`, report §5.6). Rays beyond it are drawn distinctly as "no terrain data (RF only)". The operating area is bounded by the video range (0.7 km default; ~6.5 km even at 33 dBm), so it stays terrain-checked. GCS coverage fetches its whole range on demand. |
| Forest detection limited to Kartverket | Acceptable and well reasoned | Sampling off-screen OpenTopoMap or Stadia tiles would breach their tile policies (MAP-08). The UI says "Norway only", and manual zones remain. Colour range independently confirmed. Kartverket returns a 200 blank tile outside Norway, so other sites do not trip the 3-failure disable. |
| R13 (SHOULD) partial | Acceptable | Log, heatmap and clear are done. Carrier-relative binning and observed-edge markers are not, and this is disclosed. |
| html-validate 85 → 94 | Acceptable | No new categories (MINOR 7). |
| "≈76 m at 60°N" corrected to ~38 m | Correct | A z11 pixel is 76.4 m at the equator and 38.2 m at 60°N (verified). The implementation samples at the true size, which meets the brief's "≤ DEM pixel". |

Safety content: no invented numbers. Every constant is sourced:
- manual: AIRSPEED_MIN 11, AIRSPEED_CRUISE 13, TECS 5 m/s, LQ < 70 % "FPV LINK WEAK"
- brief: k 0.6, presets 3/30/100, 150 ms
- C1: profile values, which are `null` → TBD where unknown

Unknowns are visible amber TBD notes. The design does not touch failsafe intent.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

All MUST requirements are functionally implemented and independently verified. The trial merge into current main is clean, and 99/99 tests pass on the merged tree. One item must be fixed before approval:

- **F1 (MAJOR):** align `RfModel.DEFAULT_PROFILES` ids and fields exactly with `VtolStore.IDS` / `defaults()` on main, add a drift-guard test against `js/store.js`, and update the report.

MINOR findings F2–F7 may remain, but F2's report wording and F4 are trivial and should be fixed in the same round.
