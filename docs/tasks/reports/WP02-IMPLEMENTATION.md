# WP02 — Implementation report (Coverage map: bug fixes, link model v2, live layer)

Branch `wp/02`, worktree `S\wt\WP02`. Commits: `ba123ec` (vendor Leaflet), `987a4a3` (RfModel, GcsClient, tests), `e5049d9` (map v2), `320bb35` (vegetation source restricted to Norgeskart).

## 1. Summary

- **Leaflet 1.9.4 is vendored** in `relay/vendor/leaflet/` (JS, CSS, images, LICENSE). The SRI hashes match leafletjs.com. `map.html` has no CDN script any more.
- **All pure maths now lives in `relay/rfmodel.js`** (global `RfModel`, Node-exportable):
  - geodesy, tile maths, FSPL and link budget per LinkProfile, Fresnel, Weissberger foliage loss
  - corrected `nedToBody`, antenna patterns
  - terrain LOS with `k·F1 + margin` clearance and "shadow re-acquired" segments
  - video / RC / operating-area and HM30 coverage, the orbit-sweep grid
  - mission parser and playback, and the live-data helpers
- **`relay/map.html` is rewritten on top of it.** It has:
  - three link profiles (from the C1 store, or C1-identical defaults) with a sidebar editor
  - the video polygon, the RC polygon, and their intersection "OPERATING AREA". A link with a missing (null) field is not drawn, and the legend shows the TBD.
  - client-height presets, orbit worst/best-case layers, a home marker, altitude labels per mode, and a header built from the profiles
  - no hard-coded site; GCS coverage only on demand
  - tile-policy-aware offline download
- **`js/gcs-client.js` implements the C2 client.** Health backoff is 0.5 → 3 s; SSE is used when connected, with 2 Hz `/status` polling as fallback; it never throws and never logs.
- **The live layer** shows carrier and client markers, a 5-minute client trail coloured by LQ, and a LIVE / NOT RUNNING indicator. Samples are logged to IndexedDB and feed a measured-LQ heatmap with a clear button.
- **38 unit tests** (`node --test test/`) and a jsdom smoke test (43 checks) pass.

## 2. Requirement table

Line numbers refer to HEAD `320bb35`.

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 MAP-06 | DONE | `relay/map.html:7-8`; `relay/vendor/leaflet/{leaflet.js,leaflet.css,images/*.png,LICENSE}` | Vendored from unpkg 1.9.4. SRI: js `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`, css `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` (identical to leafletjs.com; byte-exact since rework round 1). `grep unpkg relay/map.html` → nothing. |
| R2 | DONE | `relay/rfmodel.js` throughout: geodesy :54-77, tiles :80-101, FSPL/budget/range :104-128, patch/`antennaFactor` :184, `nedToBody` :165, terrain LOS `traceRay` :221, Fresnel :130, foliage :143, mission parse :453, sim stepping :514 | The page keeps only DOM, Leaflet and fetching code. Each function family is tested in `test/map/*.test.js`. |
| R3 MAP-03 | DONE | `rfmodel.js:165-172` | `x2 = x1·cθ − z1·sθ`, `z2 = x1·sθ + z1·cθ`. Tests cover θ = +10° (level target ahead → body z = sin 10° > 0), nose-down, target below, yaw and roll vectors (`rfmodel-coverage.test.js`). |
| R4 MAP-04 | DONE | `rfmodel.js:311` (`dep = hAsl − targetAsl`, with `targetAsl = terrain(d) + clientAgl` at each evaluated point) | Depression is evaluated per bearing and per sample distance. A test checks that coverage depends only on the height above local terrain: 620 m ASL over 500 m terrain equals 120 m over 0 m. |
| R5 MAP-05 | DONE | `rfmodel.js:221-287`; spacing `demStep` :290; UI `map.html:411` (k), margin input; `computeClient` :823 | Clearance = `k·F1(d1,d2,f)` (k = 0.6, editable) + user margin (default 0). The 25 m constant is removed. Spacing equals the true z11 pixel size at the highest latitude reached by the ray (38 m at 60°N), and 8× that only where no terrain data exists. The ray stops at the first obstruction. "Shadow re-acquired" intervals are returned and drawn as muted dotted radials (`map.html:1084`), not as coverage, with a per-ray evaluation budget. An exact O(1) pre-test keeps it fast; a test shows it equals a brute-force reference on 40 random terrains. |
| R6 MAP-01/14 | DONE | `rfmodel.js:446-495` (NAV list 16, 17, 18, 19, 21, 22, 31, 82, 84, 85; frames 0/5 AMSL, 3/6 REL, 10/11 terrain; whitespace split; home = seq 0), playback :500-571; UI `map.html:262` (speed min 11), list documented in the panel | Playback: altitude interpolated along legs; LOITER_TO_ALT orbits until the altitude is reached at 5 m/s; LOITER_TURNS does N turns (sign = direction); LOITER_TIME holds N s; LOITER_UNLIM never ends; VTOL takeoff/land are vertical at 5 m/s. Fixture `test/fixtures/template-7wp.waypoints` → 7 items. |
| R7 MAP-02 §8.2-1 | DONE | `map.html:597` `loadProfiles` (store → `vtol_map_state.links` → `RfModel.DEFAULT_PROFILES`); editor HTML :365-405, `saveProfileForm` :1893, `persistLink` :623; VTX slider :340 (0–33 dBm), `vtxFromProfiles` :1245 | The editor covers name, freq, TX power, TX/RX gain, RX sensitivity, margin, antenna and notes for the active video, RC and GCS profile, plus "copy". Empty field = null (TBD). Saves go to `VtolStore.update` when present, else to `vtol_map_state`. The VTX default comes from the active client profile's `vtx.powerMw` (25 mW → 14.0 dBm). |
| R8 §8.1/8.2 | DONE | `rfmodel.js:302-345` (`linkRadials`, `intersectRanges`, `clientCoverage`); draw `map.html:1046-1086`; legend notes :481, `tbdText` | Video = dual patch at the carrier, client omni. RC = carrier antenna per profile (default dipole), client omni. Operating area = per-bearing min of the two star polygons, labelled "OPERATING AREA". A profile with any null budget field → no polygon, and the legend reads e.g. "RC link: TBD — set TX power, TX gain, RX gain, sensitivity in profile". Tested on a synthetic case; jsdom confirms the RC polygon is absent with null sensitivity and drawn once filled. |
| R9 §8.2-4 MAP-16 | DONE | `rfmodel.js:135-147` (formula + source), used in `linkRadials` :316-320 and `gcsCoverage` :354-389; GCS UI `map.html:1783` | Weissberger's modified exponential decay model, cited (ESD-TR-81-101, 1982). It is frequency dependent and applies to client links (client below canopy) and to the GCS (antenna below canopy). The GCS polygon uses the HM30 budget when complete; otherwise geometry only, with the note "HM30 link budget TBD — geometry only (set …)". |
| R10 §8.2-7 | DONE | `map.html:346-351` (`m-cagl` + Ground 3 / Hover 30 / Cruise 100), `setClientAgl` | Persisted in `vtol_map_state.model.clientAgl`. |
| R11 §8.2-8 | DONE | `rfmodel.js:392-438` (grid, scan-line fill, worst/best runs); `map.html:1094-1135` (`startSweep`/`sweepAdd`/`drawSweep`), toggles :282-283, legend | Accumulates the operating area (or the video polygon, labelled "video only (RC TBD)", when RC is TBD) over exactly one full orbit, then freezes. Worst case = cells inside every snapshot, best case = inside any. Two toggleable layers with legend entries. Unit-tested on overlapping squares. |
| R12 §8.3 §14.4 | DONE | `js/gcs-client.js` (BASE :20, backoff :21/:79, SSE :83-99, 2 Hz poll :101); `map.html:1926-2006` | Carrier marker from `status.carrier`; client marker from `status.client.gps`, coloured by `lq_pct` (≥ 70 % green, < 70 % red: "FPV LINK WEAK" threshold from the manual); 5-min trail coloured per LQ class; header and panel "GCS APP: LIVE / NOT RUNNING". Optional "coverage follows live carrier", and a toggle to stop polling. When the app is absent: no throws and no logging of our own (the browser itself may still show network-error lines); backoff capped at 3 s; health polling pauses while the tab is hidden. |
| R13 §14.5 (SHOULD) | DONE (partial scope) | `map.html:2009-2048` (IndexedDB `vtol-livelog-v1/samples`), `RfModel.binSamples` :582 | Logs at 1 Hz: t, client lat/lon/alt, lq, rssi, carrier lat/lon/alt_rel. The "Measured LQ heatmap" layer uses 25 m cells of mean LQ; "✕ Clear log" and a sample count are provided. Heatmap cells are by absolute client position (not relative to the carrier). The §14.5 "observed edge" markers are not implemented. |
| R14 MAP-07/13/12/11 | DONE | MAP-07 `map.html:938`; MAP-13 `scheduleRecompute` :854 (150 ms; tile loads and sliders all go through it); MAP-12 `testApi`/`updateCacheInfo`/interval removed; MAP-11 key `RM.tileKey` "z/x/y" everywhere, retry `VEG_MAX_FAILS = 3` :1605 with `_fetchVegTile` :1636, colour range `rfmodel.js:599-614` | Forest colour was measured on real Norgeskart z13 tiles (documented in the comment). Only Norgeskart is sampled (see §5). Stalled vegetation tiles time out after 8 s. Terrain-tile failures are retried after 30 s instead of every 2 s. |
| R15 MAP-08 | DONE | policy comment `map.html:692-707`; `LAYERS` :960 (`bulk` flag); `updateOfflineUi` :2074; guard in `downloadMapArea` :2115 | OSM, OpenTopoMap, ESRI and CARTO: button disabled, with a UI note citing the policy. Kartverket: allowed (CC BY 4.0), with a fair-use TBD note. Terrain (AWS Terrain Tiles, open data) stays downloadable; attribution added to the map. |
| R16 MAP-09 | DONE | `map.html:973` (last view or `[20,0]` z2); start-up :2166-2190 | Restores the view, aircraft, home, GCS marker, layer and model from `vtol_map_state`; otherwise a world view with the hint "Click map or use My Location…". GCS coverage is never computed on load (`gcsState.computed` is set only by Compute, :1828). `61.22` is gone. |
| R17 MAP-10/15 | DONE | header `map.html:1151`; `altText` :669 (REL · AGL · AMSL); `computeRasl` :657 (REL = HOME, no longer GCS terrain); facing `RfModel.antennaFacing` + `map.html:1194`, arrow derived in `patchArrow`; home `setHome` :1298, pick button :356 | The header reads e.g. "RELAY COVERAGE — video 5.8 GHz · RC 2.44 GHz", from the active profiles. "Patches face right · E (90°)" comes from the boresight vectors. The home marker (from mission line 0, or user-set) has a tooltip explaining that it is the REL reference. |
| R18 | DONE | `escH` `map.html:566` (tooltips with file, profile, flight-mode strings; `<option>`s and statuses via `textContent`); `cssVar` :571; new variables in `:root` line 19 | No new CDN. All Leaflet colours come from `getComputedStyle` lookups of CSS variables; inline SVG uses `var(--…)`. New variables `--blue --purple --rose --teal --grey` reuse the Tools page section colours. jsdom checks that a `<b>` file name and an `<img onerror>` flight-mode string are inert. |
| R19 | DONE | `test/map/*.test.js`, `test/fixtures/*.waypoints`, `test/index.js` | 38 tests covering R2–R6, R8 (synthetic intersection), R9, R11 and C2. See §4. |

## 3. Placeholders (TBD)

| Where | Text | Why |
|---|---|---|
| Legend / attitude panel / header (`lg-rc-note`, `r-rc`, `h-cov`, amber) | "RC link: TBD — set TX power, TX gain, RX gain, sensitivity in profile"; RC range / OP AREA "TBD" | The C1 default "ELRS RC (set me)" has null TX power, gains and sensitivity. ELRS sensitivity depends on band and packet rate (ExpressLRS docs). |
| GCS panel and legend (`g-note`, `lg-gcs-note`) | "HM30 link budget TBD — geometry only (set frequency, TX power, TX gain, RX gain, sensitivity)"; "Fresnel clearance not applied — HM30 frequency TBD"; "GCS below canopy: foliage loss not applied (budget TBD)" | The C1 HM30 profile is all null except the margin. |
| Profile editor status (`pf-status`) | "Profile: TBD — set … in profile" | Any incomplete profile. |
| Offline panel (`off-map-policy`) and policy comment | "Kartverket … Service fair-use limits TBD" | Kartverket's licence is CC BY 4.0, but no published rate/volume limits for the cache service were found. |
| `mis-status` toast | "Terrain-frame items without terrain data use home altitude" | Frame-10 items whose terrain tile has not loaded. |

No safety-critical numbers were invented. Values used come from:
- **Manual:** AIRSPEED_MIN 11, AIRSPEED_CRUISE 13 (sim default), TECS climb/sink 5 m/s, LQ < 70 % "FPV LINK WEAK", orbit radius default 200 m (inside the manual's 150–250 m)
- **Brief / plan:** k = 0.6, margin 0, presets 3/30/100, 150 ms, 5-min trail, Weissberger
- **C1:** all profile values
- **Existing code:** dual-patch model, 15 m canopy, 0.03 elevation floor

Purely technical constants are documented in code:

| Constant | Purpose |
|---|---|
| 8 s | vegetation tile timeout |
| 30 s | terrain retry interval |
| 20 km | auto terrain-prefetch radius |
| 8× | step where no terrain data exists |
| 200 | shadow-scan evaluation budget |
| ~160 | orbit grid cells across |
| 25 m | heatmap cell size |
| 1 Hz | trail / log rate |

The VTOL climb and descent phases of the playback reuse the 5 m/s TECS figure as an approximation; the Q_ climb rates are not in the manual. This is noted in `rfmodel.js:498-499`.

## 4. Tests

Added:

- **`test/map/rfmodel-geo.test.js`**
  - geodesy round-trip; tile index, pixel and bounds; pixel size (76.4 m equator, 38.2 m at 60°N); Terrarium decode
  - FSPL, budget and range: default video 25 mW → ≈ 732 m (plan MAP-02 ≈ 0.7 km); null → no budget
  - Fresnel: 6.8 m at 5.8 GHz and 17.6 m at 868 MHz over 3.6 km (plan figures)
  - Weissberger branches, continuity, frequency ordering, clamp
  - forest colour classification
- **`test/map/rfmodel-coverage.test.js`**
  - `nedToBody` known vectors (R3); antenna patterns and facing text
  - LOS: flat terrain, ridge with shadow re-acquired, Fresnel and margin shortening, `k = 0` equals geometric, no-data
  - R4 terrain-offset invariance
  - video behind-patch null; RC TBD vs filled; synthetic operating-area intersection (R8); canopy loss (R9)
  - GCS geometry-only vs budget vs forest
  - orbit-sweep worst/best areas (R11)
  - fast path equals brute force on 40 random terrains; 8× coarse sampling without terrain
- **`test/map/mission.test.js`**
  - the 7-WP fixture → 7 items (exact command sequence)
  - mixed fixture: space-separated, frames 0/3/10, two non-NAV lines ignored, 0,0 → current position, CRLF
  - AMSL resolution; full 7-WP playback; interpolated altitude
  - LOITER_TO_ALT climb time = Δalt / 5 m/s; LOITER_TURNS (2 turns), LOITER_TIME (30 s), LOITER_UNLIM, CCW
- **`test/map/live.test.js`** (GcsClient with injected fetch/EventSource/timers, plus live helpers)
  - absent app → backoff 500/1000/2000/3000 (capped), no throw; `stop()` halts
  - connect + 2 Hz `/status`; disconnect → back to health polling
  - SSE `status`/`alarm`, malformed frame ignored, `onerror` → polling
  - consumer exceptions contained
  - LQ class, trail pruning, heatmap binning
- **Fixtures:** `test/fixtures/template-7wp.waypoints`, `test/fixtures/frames-mixed.waypoints`.
- **`test/index.js`:** see §5.1.

Command and result:

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 38   ℹ pass 38   ℹ fail 0
```

(`node --test "test/**/*.test.js"` gives the same 38/38.)

Smoke test, kept outside the repo: `S\smoke\map-smoke.js`. Run it with `node S/smoke/map-smoke.js S/wt/WP02 S/jsenv/node_modules/jsdom`. It loads `relay/map.html` in jsdom at `http://localhost/relay/map.html`, inlines the local scripts (`../js/store.js` is missing = 404), and stubs `fetch` to return 404. Result: **43 ok, 0 fail, zero uncaught errors**. It checks:

- header text, hint, no default site, VTX 14.0 dBm · 25 mW, slider ranges
- per-layer download policy
- placement → video polygon; RC not drawn plus TBD legend; RC drawn once filled via the editor, with the operating area
- `vtol_map_state` persistence
- 7-WP mission load (escaped file name, home from line 0, playback)
- orbit sweep complete with worst/best layers and toggle
- GCS polygon only after Compute, with TBD note
- live markers, escaping and removal
- the GcsClient health polls
- a second load with a stub `VtolStore` (editor saves through `VtolStore.update`)

html-validate:

| Rule | main | wp/02 |
|---|---|---|
| total | 85 | 94 |
| `no-implicit-button-type` | 22 | 0 (`type="button"` added to every button) |
| `no-inline-style` | 40 | 56 |
| `void-style` (`<input/>`) | 19 | 34 |
| `multiple-labeled-controls` | 1 | 1 (pre-existing) |

There are no new rule categories. The extra errors are new controls written in the file's existing markup style (self-closing inputs, small inline layout styles).

## 5. Deviations / contract issues

1. **`node --test test/` does not work on Node 24 with a directory argument.** Node resolves it as a module path and fails with "Cannot find module …\test". I added `test/index.js`, which loads every `*.test.js` below `test/`. This file is not in my "Files you own" list. WP01 may hit the same problem and add a similar file, so the PM should keep one copy at merge (the content is generic). Alternative: change the documented command to `node --test "test/**/*.test.js"`.
2. **C1 default profile ids** *(superseded in rework round 1)*: round 1 chose its own ids and fields. Since contract C1.4, `RfModel.DEFAULT_PROFILES` copies `VtolStore.IDS` / `defaults()` exactly, and `test/map/defaults.test.js` asserts deep equality against `js/store.js`. See §7.
3. **The brief's "z11 ≈ 76 m at 60°N" is the equator value.** At 60°N a z11 pixel is ≈ 38 m. The code samples at the true pixel size (`demStep`), which satisfies "≤ DEM pixel" with margin.
4. **C2 client details:**
   - `start()` reports `onConnection(false)` immediately, so pages can show "NOT RUNNING" from the start.
   - An optional second argument injects fetch/EventSource/timers for tests.
   - On an SSE error the client closes the stream and polls `/status` at 2 Hz until that fails, then returns to health polling. It does not try SSE again within the same connection.
   - Health counts as up when `ok === true`.
   - Mixed content: the HTTPS page fetching `http://127.0.0.1` relies on browsers treating loopback as potentially trustworthy, plus WP08's `Access-Control-Allow-Private-Network`. WP08 should verify this in Chrome, Edge and Firefox.
5. **Tile policies:**
   - The OpenTopoMap "about" page could not be fetched from this environment, so OpenTopoMap is treated like OSM (no bulk download).
   - Kartverket is allowed on the strength of its CC BY 4.0 open-data licence (Geonorge / data.norge.no); its service fair-use limits are TBD. The owner may prefer to disable it.
   - For the same reason, **vegetation sampling now uses only Norgeskart**. The previous OpenTopoMap and Stadia fallbacks fetched off-screen tiles, and Stadia also needs an API key. Outside Norway, forest comes only from manual zones. The measured OpenTopoMap forest range is recorded here in case tiles are self-hosted later: G−R 21…27, G−B 73…82, G 210…253, ≈ RGB(217,241,164). Note: the old classifier rejected most OpenTopoMap forest anyway, because its G is above 235.
6. **Automatic prefetch radius is capped at 20 km.** A filled ELRS profile can give ~100 km of free-space range, which would mean hundreds of terrain tiles. RC rays beyond 20 km are shown as "no terrain data (RF only)". GCS coverage still fetches its whole range, on demand. Vegetation tiles are prefetched only within the video range, which bounds the operating area.
7. **Forest zones, home, GCS position, layer, model, active profile ids and live toggles** are also persisted in `vtol_map_state`, beyond the "last view and positions" the brief asked for.
8. **R13 scope:** the heatmap is by absolute client position, and the §14.5 "observed edge" markers are not done (R13 is a SHOULD).
9. **Leaflet text files** *(corrected in rework round 1)*: in round 1, git normalised the CRLF in `leaflet.css` and `LICENSE`, so only `leaflet.js` matched its SRI. Now `.gitattributes` (`relay/vendor/** -text`) keeps the vendored files byte-exact, and the committed `leaflet.css` hashes to the official `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`.

## 6. Notes for the verifier

- **Tests:** `node --test test/` (or the glob form).
- **Brute-force equivalence:** to check the LOS fast path yourself, see the test "traceRay fast path gives exactly the brute-force edge on random terrain".
- **Smoke:** `S\smoke\map-smoke.js` (see §4). Note that jsdom gives `file://` pages an opaque origin, where `localStorage` throws. The page tolerates this, but load it under an `http://localhost/` URL to test persistence.

To see each feature in a browser (serve the repo root, e.g. `python -m http.server`, open `/relay/map.html`):

1. **Fresh load:** world view, hint, header "RELAY COVERAGE — video 5.8 GHz · RC 2.44 GHz", GCS APP NOT RUNNING. There should be no console errors except the browser's own refused-connection lines for 127.0.0.1:47800, at most one every 3 s.
2. **Click the map:** blue video polygon, patches face right, amber legend note "RC link: TBD — …".
3. **Link Profiles → RC:** enter TX power 20, TX gain 0, RX gain 0, RX sens −100 → Save. The teal RC polygon and the green "OPERATING AREA" appear.
4. **Client height presets** change the footprint. The **VTX slider** runs 0–33 dBm and starts at 14.0 dBm · 25 mW.
5. **Simulation → Orbit:** set the centre, Start. After one orbit the panel says "complete"; the green worst-case and amber best-case layers can be toggled.
6. **Simulation → Mission:** load `test/fixtures/template-7wp.waypoints` → "7 NAV items", a home marker with tooltip, and a dashed path. Start → status "Item n/7 …"; altitude changes smoothly; LOITER_TO_ALT circles while climbing.
7. **GCS:** pick a position → nothing is computed until ▶ Compute; then the purple polygon and the TBD note appear.
8. **Map layer:** OSM/Topo/ESRI/Dark → "↓ Cache Map Tiles" is disabled with a policy note; Norgeskart → enabled.
9. **Live layer:** without the WP08 app, call `onLiveConnection(true); onLiveStatus({...C2 status...})` in the console. You get a carrier marker, a client marker coloured by LQ, a trail and logged samples; then "Measured LQ heatmap" and "✕ Clear log".


## 7. Rework round 1

Input: `Serify\WP02\VERIFY-round1.md` (REJECTED, F1 MAJOR, F2–F7 MINOR). The PM merged `main` into `wp/02` first, which brought in `js/store.js` and C1.4. Every finding is fixed.

| Finding | Fix | Evidence |
|---|---|---|
| **F1 (MAJOR)** fallback defaults ≠ `js/store.js` | `RfModel.DEFAULT_PROFILES` now copies `VtolStore.IDS` / `defaults()` exactly: ids `pack-client-ref-6s-1300`, `link-client-video-58`, `link-elrs-rc`, `link-siyi-hm30`; client `sizeIn: 7`; HM30 `notes: null`. New drift guard `test/map/defaults.test.js` `require`s `js/store.js` and asserts `deepStrictEqual` for packs, clients and links, plus the id mapping to `VtolStore.IDS`. `map.html` hard-codes no profile ids (grep for the old ids finds nothing). | `relay/rfmodel.js:20-51`, `test/map/defaults.test.js` |
| F2 `leaflet.css` bytes / report claim | Added `.gitattributes` with `relay/vendor/** -text` and re-committed `leaflet.css` and `LICENSE` byte-exact from the upstream download (both had CRLF). Blob hashes: `leaflet.css` `sha256-p4NxAoJB…BMY=`, `leaflet.js` `sha256-20nQCchB…BZo=` (official SRI). The report's §1 and §5.9 wording is corrected. | `.gitattributes`, `relay/vendor/leaflet/` |
| F3 store save result ignored | `persistLink` now does `VtolStore.load()` → edit → `VtolStore.save()` and checks the result (`false` = storage full or blocked). On failure the edit is kept in memory for the session only, and the user gets a 6 s toast plus a red notice in the editor: "⚠ Profile NOT saved — browser storage full or blocked (kept for this session only)". | `relay/map.html` `persistLink`, `saveNotice` |
| F4 dead `live.status` | Removed. | `relay/map.html` `live` object, `onLiveStatus` |
| F5 8× step could skip known terrain | The long step is taken only if its far end is still without data; otherwise the ray steps at full resolution. Tiles are 256 px, so only a < 8 px corner clip can still be passed over. New test: a ridge just after a data gap is found. The pre-fix code returned `nodata` to 3 km; it now returns `terrain` at 1150 m. | `relay/rfmodel.js` `traceRay` (adaptive spacing block), test "coarse steps never jump into a loaded tile" |
| F6 jump onto loiter circle | When the aircraft is more than one step inside the circle, it flies outward along the radial (start heading if at the centre). It joins the orbit only within one step of the circle, so the largest per-step move is ≤ 2 steps. LOITER_TO_ALT holds altitude while flying out. Tests now time loiters from orbit entry, and a new test checks there are no jumps. | `relay/rfmodel.js` `missionStep` loiter branch; `test/map/mission.test.js` |
| F7 html-validate | All self-closing void tags (`<input/>`, `<meta/>`, `<link/>`) are now plain void tags, and the 17 legend swatch styles moved into `.c-*` classes. **wp/02: 40 errors** (39 `no-inline-style`, 1 `multiple-labeled-controls`) vs **main: 85**. Every category is now at or below main. The remaining inline styles are layout tweaks on the existing panels; the label error is the existing altitude-mode label that wraps three buttons. | `relay/map.html` head/CSS |

Tests after the rework:

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 103   ℹ pass 103   ℹ fail 0      (WP01 + WP04 + WP02 tests)
```

The jsdom smoke test (`S\smoke\map-smoke.js`) now runs twice: once with `js/store.js` not served, once with the real `js/store.js`. **47 ok, 0 fail, no uncaught errors.** New checks:
- the store ids are used
- a GCS profile edit lands in place in `vtol_store`
- with `localStorage.setItem` throwing, the "NOT saved" notice appears
