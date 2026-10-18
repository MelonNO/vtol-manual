# WP27 — Coverage map and latency clock bodies (redesign wave 3)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md`**, `docs/design/README.md`, `CLAUDE.md`
(Architecture row of the map), `relay/map.html`, `tools/latency-clock.html`.

Worktree: `S/wt/WP27`, branch `wp/27`. WP25 and WP26 run in parallel with you.

## Files you own

- `relay/map.html` below the header: the side panel, overlays (attitude box, cursor bar, hints), controls and their
  page CSS. **Not** `relay/rfmodel.js` logic and not `relay/vendor/`.
- `tools/latency-clock.html` below the header.
- `test/map/*`.
- `sw-precache.js` (generated).
- `css/base.css` is frozen in wave 3: put requests in your report.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Side panel.**<br>- Sections (Simulation, Manual placement, link profiles, terrain, operating area, mission, live, …) become clear collapsible groups with one heading style.<br>- The most-used group is open by default; the open/closed state may be remembered under `vtol_map_state` (extend it, do not add a key).<br>- Use the base buttons: one primary action per group, the rest ghost, consistent sizes.<br>- Use the base form fields, and keep units next to inputs.<br>- Explanatory text goes into short helper lines; long notes go behind disclosures.<br>- No static inline styles (html-validate `no-inline-style` → 0 for both files). |
| R2 | MUST | **Phone layout** (390 px and 360 px). The panel must not permanently cover the map: use a toggleable bottom sheet or drawer with a clear handle or button. The map, the zoom controls and the cursor bar stay usable. |
| R3 | MUST | **Overlays.** The attitude box, the cursor / AMSL bar and the placement hint use one calm overlay style (surface, border, radius, readable sizes ≥ 12 px) and do not collide with each other or with the Leaflet controls at 1366 or 390 px. |
| R4 | MUST | **Latency clock.** Restyle it with the base components. The clock digits stay large, monospace and high-contrast. The test instructions read as a short numbered list. |
| R5 | MUST | **No logic changes.** RF model, map state, live layer and mission playback behave the same. Ids and functions are unchanged. `test/map/*` stays green. The copy rules (`04` §4) apply to any text change: run the safety-token diff for both files. |
| R6 | MUST | **Evidence.** Screenshots in `S/shots/WP27/` of the map (panel open and closed) and the clock at 1366 and 390 px, plus one sunlight-mode view. Map tiles do not load offline in headless mode, so judge the UI, not the tiles. Compare them with `S/baseline/map-*` and `latency-*`. |

## Report

`docs/tasks/reports/WP27-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus the safety-token output, the
screenshot list and `css/base.css` requests.
