# WP09 — Offline, PWA and field-use features

- **Worktree:** `S\wt\WP09`
- **Branch:** `wp/09`
- **Wave:** 5
- **Starts after:** WP02, WP05, WP06, WP07 and WP11 are merged

Read first: `01-COMMON-CONTEXT.md`, all earlier WP reports, and plan §5.5 (SW-01…04), §10.1 A-2, §10.2 (F-1…F-8).

## Files you own

- `sw.js`, new `manifest.webmanifest`, `icons/`, `fonts/`, `css/base.css`
- small hooks in `index.html`, `manual.html`, `relay/map.html` and `tools/latency-clock.html`: link tags, includes, mode toggles, CSP updates
- `test/pwa/*.test.js`
- `docs/tasks/reports/WP09-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Self-host fonts (SW-01):** Oswald (400/600/700) and Share Tech Mono as `woff2` from Google Fonts (OFL licence files included) in `fonts/`, with `@font-face` in `css/base.css`. Remove the Google Fonts `@import` from every page and from the CSPs. |
| R2 | MUST | **`css/base.css` (A-2):** the shared `:root` tokens and base element styles used by all pages. Pages include it, and duplicated token blocks are removed from the pages without visual change. Check by computed-style comparison in jsdom on 10 key elements. |
| R3 | MUST | **Service worker:**<br>- precache **every** same-origin asset the field needs: pages, `js/*`, `data/*`, `css/*`, `fonts/*`, `relay/*` incl. vendor, `img/*` (prefer `.webp`), `img/diagrams/*`, `tools/*`, icons and the manifest. Generate the list with a small script `scripts/gen-precache.mjs` (Node, no deps) that writes `sw-precache.js`, and add a test that fails if a referenced asset is missing from the list.<br>- **stale-while-revalidate** for same-origin assets, network-first for HTML.<br>- version-stamped cache name from `VTOL_VERSION.app`.<br>- deletion of old caches.<br>- **never** cache `http://127.0.0.1:47800`, Open-Meteo or Nominatim (Open-Meteo already has its own cache logic). |
| R4 | MUST | **Update prompt (SW-04 / F-3):** when a new service worker is waiting, show a toast "New version available — RELOAD" on all pages. The footer shows `VTOL_VERSION` app/content/param-file date (param-file date from `store.paramFile` if present). |
| R5 | MUST | **PWA (F-2):** `manifest.webmanifest` (name, short name, theme `#f97316`, background `#0f0f0f`, start_url `./index.html`, display standalone) and icons 192/512 + maskable, generated with Pillow from a simple vector design (orange chevron/aircraft on black). Linked from all pages. |
| R6 | MUST | **Wake lock (F-4)** while a checklist tab, the challenge–response mode or the emergency modal is open; released otherwise; feature-detected. |
| R7 | MUST | **Sunlight / high-contrast mode (F-5):** a toggle on all pages (persisted). Larger text, pure white on black, thicker lines. Implemented with token overrides in `css/base.css`. |
| R8 | MUST | **Print stylesheet (F-6):** pre-flight/turnaround checklists and emergency cards print as clean black-on-white kneeboard pages (one scenario per block, no nav). Verify with jsdom `print` media where possible, and with a description. |
| R9 | MUST | **Emergency-only mode (F-7):** `index.html#emergency-only` shows only the immediate actions, large buttons per scenario, no scrolling per card on a phone. |
| R10 | SHOULD | **QR (F-8):** vendor a small MIT-licensed QR generator (with licence) and show a QR of the live site URL in the Tools footer menu ("Share / kneeboard"). |
| R12 | MUST | **Carry-overs from the WP07 verification** (`docs/tasks/reports/WP07-VERIFY-round1.md`). Small edits permitted in `js/diagrams.js`, `scripts/diagrams/*` and the regenerated SVGs; keep `build.js --check` green.<br>(a) The battery-gauge notes ("BATT_LOW_VOLT not set …", the Li-Ion storage TBD) must not be clipped: wrap or reflow them.<br>(b) Gauge text needs margin above 11 px at a 360 px viewport.<br>(c) Gauge zone names must be visible text, not only tooltips.<br>(d) `build.js --check`: a missing slot gives a clean error message, not a stack trace (non-zero exit).<br>(e) VERIFY markers inside SVGs use the amber token.<br>(f) Precache `js/diagrams.js` and `img/diagrams/*.svg` (part of R3).<br>(g) Correct the content width in `img/README.md`.<br>(h) The sunlight/high-contrast mode (R7) must also apply to the inline SVG diagrams. |
| R11 | MUST | Offline test in jsdom/Node: a test simulates the precache list against the filesystem; a manual verification note in the report of an offline load in a real browser if available (otherwise say it was not possible). |
