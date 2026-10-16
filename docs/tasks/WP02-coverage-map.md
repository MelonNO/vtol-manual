# WP02 — Coverage map: bug fixes, link model v2, live layer

- **Worktree:** `S\wt\WP02`
- **Branch:** `wp/02`
- **Wave:** 1 (parallel with WP01, WP03, WP04)

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (you **consume C1**, **consume C2**, and **own** `js/gcs-client.js` from C2), and plan sections §5.3 (MAP-01…16), §8 (entire), §14.4/§14.5 (map parts), §3.3.

## Goal

Turn `relay/map.html` from a single 5.8 GHz polygon tool into a three-link planning tool:
- client video, client RC and the HM30 GCS link
- the **operating area** = video ∩ RC
- terrain/Fresnel-correct geometry
- correct mission playback
- offline-capable (vendored Leaflet)
- an optional live layer fed by the GCS companion app

Pure maths moves into a tested module.

## Files you own

- `relay/map.html`
- new: `relay/rfmodel.js` (global `RfModel`, Node-exportable), `relay/vendor/leaflet/` (Leaflet **1.9.4** JS, CSS, images, LICENSE — downloaded once from unpkg/cdnjs and committed), `js/gcs-client.js` (C2 client)
- new: `test/map/*.test.js`, `test/fixtures/*.waypoints`
- `docs/tasks/reports/WP02-IMPLEMENTATION.md`

`js/store.js` is created **in parallel by WP01** and does not exist in your worktree. Load it with `<script src="../js/store.js">` and code defensively:
- use `window.VtolStore` when present
- otherwise fall back to built-in defaults that are **byte-for-byte the C1 default link/client profiles** (keep them in `RfModel.DEFAULT_PROFILES`, with a comment that they mirror C1)

Persist map-only UI state under `localStorage['vtol_map_state']`.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **MAP-06:** use vendored Leaflet from `relay/vendor/leaflet/` (no unpkg). Keep its licence file. |
| R2 | MUST | Move all pure maths into `relay/rfmodel.js`: geodesy (dest, dist, bearing), tile maths, FSPL, link range from a LinkProfile, patch-antenna gain, `nedToBody`, terrain LOS, Fresnel, foliage attenuation, mission parsing and simulation stepping. Unit-test each in `test/map/`. |
| R3 | MUST | **MAP-03:** fix the pitch sign in `nedToBody` (nose-up positive): `x2 = x1·cθ − z1·sθ`, `z2 = x1·sθ + z1·cθ`. Test with known vectors, e.g. θ = +10°, level target ahead → body z > 0 (below the nose). |
| R4 | MUST | **MAP-04:** the depression angle per bearing and distance comes from real ASL heights (`rAsl − (terrain + clientHeight)`) at the evaluated point, not from the entered altitude. |
| R5 | MUST | **MAP-05:** clearance = `k × F1(d1, d2, f)` (k default 0.6, user-editable) + an optional user margin (default 0). Replace the fixed 25 m. Sample spacing ≤ the DEM pixel size at the sample latitude (z11 ≈ 76 m at 60°N), or adaptive with an equivalent guarantee. The ray stops at the first obstruction as today; additionally mark "shadow re-acquired" segments as a separate, non-coverage style when that's cheap enough. |
| R6 | MUST | **MAP-01 / MAP-14:** the mission parser accepts every NAV command with coordinates: 16, 17, 18, 19, 21, 22, 31, 82, 84, 85 (document the list). It honours the frame column (0 = AMSL, 3 = REL to home, 10 = terrain AGL; home = first line idx 0), splits on whitespace, and ignores non-NAV commands. The simulation: interpolates altitude; LOITER_TO_ALT orbits until altitude is reached (at the TECS climb/sink 5 m/s from the manual); LOITER_TURNS does N turns; LOITER_TIME holds for N s; LOITER_UNLIM orbits until stopped. Speed slider minimum 11 m/s. Test fixture: the manual's 7-WP template (VTOL_TAKEOFF, WAYPOINT, LOITER_TO_ALT, WAYPOINT, LOITER_TO_ALT, WAYPOINT, VTOL_LAND) → 7 parsed items. |
| R7 | MUST | **MAP-02 / §8.2-1:** link profiles from the store (C1 `links`) or defaults. The sidebar has a **profile editor** for the active video, RC and GCS link: all LinkProfile fields; saves to the store when present, else to `vtol_map_state`. VTX power control range 0–33 dBm, default from the active **client profile's** `vtx.powerMw` (25 mW → 14 dBm). |
| R8 | MUST | **§8.1/§8.2:** compute and draw the **video polygon** (existing dual-patch model, carrier receives), the **RC polygon** (carrier ELRS TX → client, antenna per profile), and their **intersection** labelled "OPERATING AREA". Any profile with a required `null` field (e.g. `rxSensDbm`) → that polygon is not drawn and the legend shows "RC link: TBD — set sensitivity in profile". |
| R9 | MUST | **§8.2-4 / MAP-16:** frequency-dependent foliage loss using a cited model (e.g. Weissberger's modified exponential decay, with the formula and source in a comment). Used for the GCS link and the client links. The GCS polygon uses the HM30 link profile's budget when complete, else geometry only, with a "TBD" note. |
| R10 | MUST | **§8.2-7:** a "client height AGL" control with presets (ground 3 m / hover 30 m / cruise 100 m). |
| R11 | MUST | **§8.2-8:** in the orbit simulation, accumulate the **worst-case** (intersection over one full orbit) and **best-case** (union) operating area, shown as two toggleable layers with a legend. |
| R12 | MUST | **§8.3 / §14.4:** a live layer via `js/gcs-client.js` (C2). Carrier marker from `status.carrier`, client marker from `status.client.gps`, a client trail (last 5 min) coloured by `lq_pct`, a connection indicator "GCS APP: LIVE / NOT RUNNING". It must be fully harmless when the app is absent: no console spam, exponential backoff ≤ 3 s per C2. |
| R13 | SHOULD | **§14.5:** log live samples (carrier pos, client pos, lq, rssi) into IndexedDB and offer a "measured LQ" heatmap layer and a "clear log" button. |
| R14 | MUST | **MAP-07:** revoke object URLs. **MAP-13:** debounce recompute (~150 ms). **MAP-12:** remove dead diagnostics. **MAP-11:** one veg-tile key format, retry a failed source up to 3× before disabling it, restrict the forest-colour classification to the topo source's known forest colour range (document it). |
| R15 | MUST | **MAP-08:** offline *map-tile* download only for sources whose terms allow it. Check and cite each layer's tile policy in a code comment. OSM/OpenTopoMap/ESRI/Carto: disable bulk download, with a UI note. Terrain tiles (AWS Terrarium, open data) remain downloadable. |
| R16 | MUST | **MAP-09:** no hard-coded site coordinates. Start from `vtol_map_state` (last view and positions), else a neutral world view with "click map or use My Location". No automatic heavy computation on load (GCS coverage only on demand). |
| R17 | MUST | **MAP-10 / MAP-15:** correct altitude labels per mode; the header shows "RELAY COVERAGE — video <band> · RC <band>" from the profiles; "patches face" text derived from the antenna model. Show a "home" marker (the REL reference) and explain it in a tooltip. |
| R18 | MUST | Escape all dynamic strings (file names, profile names). No new CDN. Colours via CSS variables (Leaflet path options may use `getComputedStyle` lookups of the CSS variables). |
| R19 | MUST | `node --test test/` passes, with meaningful tests for R2–R6, R8 (polygon intersection on a synthetic case), R9 and R11. |

## Out of scope

- Service-worker precache entries: WP09. Just make sure everything is same-origin.
- The Tools page and the manual.

## Acceptance (verifier)

- `node --test test/` passes.
- jsdom load of `relay/map.html` with stubbed `fetch` (terrain tiles 404): no uncaught errors.
- The parser yields 7 items for the 7-WP fixture.
- The RC polygon is not drawn with a null-sensitivity profile, and is drawn when filled.
- `grep unpkg relay/map.html` → nothing.
- No coordinates `61.22` remain.
