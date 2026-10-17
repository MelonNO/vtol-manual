# WP09 verification — round 1
VERDICT: APPROVED

Worktree `S\wt\WP09`, branch `wp/09`, HEAD `c1b7dc7`, base (`merge-base main HEAD`) `86a28db`. I worked read-only on the worktree; its status was clean before and after. Everything I ran used throw-away copies under `S\verify\WP09\`:
- `wp09/` and `base/`: clones
- `site/` and `base-site/`: `git archive` exports that were served
- `mergeclone/`: the merge test
- `tools/`: my own scripts
- `shots/`: screenshots and PDFs

PM decisions applied:
- **R3 deviation (JS/CSS network-first with a 4 s timeout):** accepted. I checked the implementation, and it is correct.
- **gcs-client "Illegal invocation / Uncaught (in promise)":** pre-existing. It reproduces identically on the base tree and belongs to WP14, so it is not a WP09 finding.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 fonts | PASS | `fonts/*.woff2`, `fonts/OFL-*.txt`, `fonts/README.md`, `css/base.css:8-16`, CSPs `index.html:6`, `manual.html:6`, `relay/map.html:7`, `tools/latency-clock.html:6` | **Fonts match upstream:** I re-downloaded the Google Fonts CSS and woff2 files. All 3 SHA-256 hashes are byte-identical to the README, and the `unicode-range` values are identical to Google's CSS (latin, latin-ext).<br>**Licences:** both OFL texts are byte-identical to google/fonts `main` (LF-normalised).<br>**No Google Fonts left:** `@import` and `fonts.googleapis` / `gstatic` are gone from all 4 pages and all CSPs. The only remaining hits are `archive/` (old archived manual, never served or precached), docs and tests.<br>**Edge, offline:** Oswald and Share Tech Mono load from cache on every page. |
| R1 CSPs | PASS | `tools/offline.mjs`, `tools/gcs-csp.mjs` | In headless Edge 155, with `securitypolicyviolation` listeners and console capture, there were **0 CSP violations on all 4 pages**:<br>- **Tools:** Open-Meteo weather (200) and Nominatim (200) were fetched by the page's own `fetchWeather()`. The MP button `fetchVoltage()` to `localhost:20199` reached the network (ERR_CONNECTION_REFUSED, not blocked).<br>- **Map:** I switched through all 5 layers: OpenTopoMap, Kartverket, ESRI, OSM and Carto all returned 200. Terrain via `_fetchTile` (s3 terrarium) was OK, and the vegetation tile pixels (Kartverket) were OK.<br>- **GCS API `127.0.0.1:47800`:** I ran a fake GCS server. A fetch from index and from map returned HTTP 200 under the CSP. The page's own GcsClient never fetches, because of the WP14 bug, which is identical on base. |
| R2 base.css | PASS | `css/base.css:19-29`; `test/pwa/base-css.test.js` | **Their jsdom check, re-run by me:** the snapshot from my own run on the pre-WP09 tree equals their fixture byte-for-byte. The WP09 tree gives 0 diffs in 616 values. The report says "630"; the true count is 44 × 14 = 616, see F6.<br>**My real-browser check (Edge):** every element of all 4 pages at 1280 px and at 360 px, 22 properties each, 308,704 values. The only diffs are:<br>- geometry from the added ☀ button / version line (header widths, the map's `#att` panel height);<br>- `.hdr-main padding-right:50px` at ≤ 600 px;<br>- the latency clock, which now really gets Share Tech Mono (before, it used a system fallback because that page never loaded Google Fonts), and its deliberate `12vw` clock at ≤ 600 px.<br>No colour, font-size, weight, letter-spacing or border change on any existing element. |
| R3 SW | PASS | `sw.js:12-96`, `scripts/gen-precache.mjs`, `sw-precache.js` | **Precache:**<br>- `--check` OK (56 assets).<br>- My own scan of every `src`/`href`/`srcset`/`url()`/manifest/script reference: everything is listed, except the `<picture>` jpg fallbacks (the webp is precached, which the brief prefers).<br>- Mutation tests: a stale list or a changed content fails the test and `--check`.<br>**Cache name and lifecycle:**<br>- The cache name `vtol-manual-<VTOL_VERSION.app>-<hash>` is used, and old `vtol-manual-*` caches (incl. the live `vtol-manual-v12`) are deleted on activate.<br>- Cross-origin requests are never intercepted. After the weather, map tiles and terrain were exercised, the cache held only same-origin URLs.<br>**Strategies:**<br>- Navigation fallback: `./`, `index.html?x=1` and the cached pages work offline, and an unknown page gives the 503 "OFFLINE" page.<br>- Network-first with a 4 s timeout for HTML/JS/CSS, SWR for other assets (code read, plus the sw.test simulation). |
| R4 toast/footer | PASS | `js/field.js:49-126`; footers `index.html:632`, `manual.html:1727`, `relay/map.html:569`, `tools/latency-clock.html:99` | **Edge, new deploy:** after a hash change, the toast "NEW VERSION AVAILABLE — RELOAD / LATER" appears on **all 4 pages**, fitting 360 px. RELOAD leaves exactly one cache, the new one, with the new worker `activated`, the footer showing the new content date and the toast gone.<br>**Upgrade from the live pre-WP09 worker (v12):** the toast appears and RELOAD deletes v12. Offline works afterwards.<br>**Footer:** `APP · CONTENT · PARAM FILE` on all 4 pages, TBD in amber. With `store.paramFile` set, it shows the name and import date, HTML-escaped, on all 4 pages, and it updates on `vtol-store-changed`. |
| R5 manifest/icons | PASS | `manifest.webmanifest`, `icons/*`, `scripts/gen-icons.py` | **Fields:** all required fields and values are present.<br>**Edge:** `Page.getAppManifest` gives no errors on all 4 pages, and `getInstallabilityErrors` gives none.<br>**Icons:** 192/512/maskable/180 at the correct sizes. Re-running `gen-icons.py` gives identical bytes. The maskable glyph is at r ≤ 0.34 of the icon, inside the 0.4 safe circle. The icon was inspected visually. |
| R6 wake lock | PASS | `js/field.js:128-149`, `index.html:676-682` | **Edge with a fake `navigator.wakeLock`:**<br>- held on preflight / turnaround / postflight, the modal, challenge–response and emergency-only;<br>- released on battlog, weather, modal close, C-R close and EO exit;<br>- never held twice.<br>**No API:** no errors. |
| R7 sunlight | PASS | `css/base.css:34-50`, `js/field.js:35-47` | **Edge at 360 px, on all 4 pages:** the ☀ button (≥ 44 px) gives `#000` / `#fff`, zoom 1.15 and `aria-pressed`. The setting is persisted, carries over to the next page, and turns off cleanly.<br>**No horizontal scroll** on any Tools or manual tab.<br>**Inline SVGs:** muted text becomes `#ececec` bold, background fills become black, unspecified strokes become 2 px. |
| R8 print | PASS | `css/print.css`, `js/field.js:186-194` | **Print media in Edge:** no nav, FAB or share menu; white background, black text.<br>**Kneeboard (`html.vf-kb`):**<br>- pre-flight and turnaround shown, other tabs hidden;<br>- 8 emergency cards with clean-up, `break-inside: avoid`.<br>**`Page.printToPDF`:**<br>- kneeboard: 11 pages, inspected (`shots/kneeboard-p*.png`), clean black on white, 1 scenario per block;<br>- manual Emergency tab: 9 pages.<br>The last kneeboard page holds only the footer (F2). |
| R9 emergency-only | PASS | `js/emergency-only.js`, `index.html:351-358,1459-1464`, `css/base.css:87-112` | **Edge at 360×640, normal and sunlight:**<br>- **List screen:** 9 buttons (8 cards + the 915 note), each ≥ 54.9 px, last bottom at 630, no document or list scroll, nothing else visible.<br>- **Each of the 9 scenarios:** no scroll, nav buttons in view, step count = `immediate.length`, no raw `{token}` / `[[…]]` markup, font 23.7–32.4 px.<br>- **EXIT:** restores the page. |
| R10 QR | PASS | `js/vendor/qrcode-generator/*`, `js/field.js:151-185` | `qrcode.js` SHA-256 equals unpkg `qrcode-generator@1.4.4`, and the MIT LICENSE is present.<br>**Decode:** I captured the Edge QR and decoded it with OpenCV (my own venv): it gives `https://melonno.github.io/vtol-manual/`. |
| R11 offline test | PASS | `test/pwa/sw.test.js`, `sw-sim.js`, `precache.test.js`; report §6 | **Their simulation:** the vm sim runs every page and every reference offline.<br>**My real-browser run** (`python -m http.server`, server killed, HTTP cache disabled):<br>- `index.html`, `./`, `index.html?x=1`, `manual.html` (all 24 images via webp), `relay/map.html` (Leaflet runs), the latency clock and `#emergency-only` all render, with both fonts loaded from cache;<br>- every precache entry gives 200 via the SW. |
| R12(a) | PASS | `js/diagrams.js:62-75,83-182` | Edge at 360 px: no `<text>` bbox outside the viewBox in 8 gauge variants: long label, Li-Ion, LiFe, mast, with and without BATT_LOW. The notes are wrapped. |
| R12(b) | PASS | same | The minimum rendered gauge text is **12.83 px** (gauge 330 px wide), ≈ 12.25 px with a 15 px scrollbar. |
| R12(c) | PASS | `js/diagrams.js:138-142,167-170` | The visible zone legend text is present (screenshot `shots/gauge-360.png`). |
| R12(d) | PASS | `scripts/diagrams/build.js:35-43` | With the D3 slot removed: `ERROR expected 17 diagram slots, found 16` plus a hint, no stack trace, rc = 1, both with `--check` and without. |
| R12(e) | PASS | `scripts/diagrams/inline.js:47,80`; `manual.html` | Both inline VERIFY texts use `var(--amber)`. The standalone d07 VERIFY is `#facc15`. |
| R12(f) | PASS | `sw-precache.js` | `js/diagrams.js` and all 16 diagram SVGs are listed and served offline. |
| R12(g) | PASS | `img/README.md` | 330 px matches the measured figure width. |
| R12(h) | PASS | `css/base.css:46-50` | Measured in Edge, see R7. |
| `build.js --check` / `gen-precache --check` | PASS | | Both are green on the branch and on the merge with main. |

## Contract results

- **C4 (`VTOL_VERSION`):** consumed read-only. `field.js` falls back to `VTOL_VERSION.paramFile`.
- **C1 / C1.5 (`store.paramFile`):** read from `localStorage['vtol_store']` without side effects. It uses the `name` / `importedAt` fields per C1. An invalid date shows TBD.
- **C5 (`VtolContent.emergencies` / `emergencyNotes`, `VtolRender.fmt`):** the emergency-only mode renders through `VtolRender.fmt`, with tokens resolved and TBD markers kept.
- No contract was changed.

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"
node --test test/                                   → tests 262, pass 261, fail 0, skipped 1 (jsdom)
VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/  → tests 262, pass 262, fail 0
node scripts/gen-precache.mjs --check               → up to date (56 assets)
node scripts/diagrams/build.js --check              → up to date
merge of wp/09 into current main (fd73ea9) in a throw-away clone: clean, no conflicts;
  on the merged tree: 262/262 pass, both --check commands green
html-validate (base → WP09, per rule): index 127→127, manual 0→0, map 40→40, latency clock 2→2 (identical by rule)
```

The new tests exercise real logic: a vm SW simulation (install, activate, offline, network-first timeout, SWR, never-cache), byte-exact generator comparison, a reference scan, a computed-style fixture and gauge bboxes. My mutations confirmed that the precache tests fail on a stale list or content.

## Smoke tests (what you loaded/clicked + result)

**Real browser (headless Edge 155, CDP, my scripts in `S\verify\WP09\tools\`):**
- **`offline.mjs` — 55 PASS / 2 FAIL.** The 2 failures were "GCS polled": the page's GcsClient never polls because of the pre-existing WP14 bug. `gcs-csp.mjs` covers the same check with a fake server: 2/2 PASS.
- **`features.mjs` — 35/35 PASS:** manifest, version line, sunlight, EO, wake lock, QR, print.
- **`upgrade.mjs` — 5/5 PASS:** upgrade from v12 to WP09.
- **`compare-styles.mjs`:** 308,704 computed values compared; diffs only as described under R2.
- **`gauge.mjs`:** R12 (a)–(c), described above.
- **`qr.mjs`:** QR decode, described above.
- **`mapshots.mjs`:** map and clock comparison at 360 px.

**jsdom:**
- **My `jsdom-smoke.js` — 40/40 PASS:**
  - index, manual and latency clock load without errors;
  - ☀ toggles, the version line and the param-file update (escaped) work;
  - checklist tick, tab switch and emergency modal still work;
  - the QR renders and PRINT KNEEBOARD calls `print()` with `.vf-kb`;
  - the emergency-only route, scenario, raw-markup check and EXIT pass.
- **Earlier verifier smokes, base → WP09:**

  | Smoke | Base | WP09 |
  |---|---|---|
  | WP07 | 69/1 | 69/1 (same pre-existing failure) |
  | WP11 r2 (map) | 103/0 | 103/0 |
  | WP05 r2 | 30/1 | 30/1 (same pre-existing failure) |
  | WP06 | 197/0 | 194/3 |

  The 3 WP06 failures are all "Could not load link … css/base.css": that harness answers 404 for CSS. A copy that also ignores link-load errors (`tools/wp06-smoke-link.js`) gives 197/0 on both trees.

**Out-of-list files, judged:** all are justified and minimal.
- **Needed by the brief:** `css/print.css` (R8), `js/field.js`, `js/emergency-only.js` and `js/vendor/qrcode-generator/*` (the features' "includes"). The brief explicitly asks for `scripts/gen-precache.mjs`, `sw-precache.js` and `scripts/gen-icons.py`.
- **Test helpers and fixture:** under `test/pwa/`.
- **R12-permitted:** `js/diagrams.js`, `scripts/diagrams/{build,inline,lib}.js`, the 16 SVGs (palette comment line only) and `img/README.md`.
- **Test constant:** `test/diagrams/files.test.js` 332→330, which follows R12(g).
- **`tools/latency-clock.html`:** the 12vw clock at ≤ 600 px. I verified that the clock was clipped on base at 360 px (scrollWidth 380 > clientWidth 324) and fits now (324/324).

## Findings

1. **MINOR** — `relay/map.html:252` (☀ button in `.nav-btns`): on a 360 px phone the map header grows from 170 to 218 px, and the map area shrinks from 470 to 422 px at 360×640 (−10 %).
   - The ☀ button squeezes the title to 105 px, which wraps to 4 lines.
   - The version line also adds 37 px to the attitude panel that overlays the map.
   - Expected: keep the phone header height, for example by placing the toggle like the other pages do (absolute top-right corner) or shortening the title on narrow screens.
2. **MINOR** — `css/print.css:58` (`break-after:page` on `#tab-turnaround`): the kneeboard PDF ends with an 11th page that holds only the footer line, which wastes a sheet. Expected: no page break after the last kneeboard block, or the footer kept with it.
3. **MINOR** — `css/print.css:78`: the comment says the emergency cards come "after the checklists", but they print first (as the file header and the report §5.5 say). The comment is stale.
4. **MINOR** — `test/pwa/assets.js:25-29`: the `<picture>`-fallback detection is keyed by the `src` string. A plain `<img src="img/x.jpg">` elsewhere on a page that also has a `<picture>` with the same jpg would not be reported as un-precached. I checked this with a mutation: the test stays green. There is no such case today.
5. **MINOR** — `css/base.css:67`: the toast `box-shadow` uses `rgba(0,0,0,.6)` instead of a token. This is negligible, but it is a hard-coded colour in shared CSS.
6. **MINOR (report accuracy)** — `docs/tasks/reports/WP09-IMPLEMENTATION.md:10` says "630 values". The jsdom comparison compares 44 elements × 14 = 616 values. The substance of the claim (all equal) is true.

Observations (no findings):
- `NEVER_CACHE` in `sw.js:18/91` is unreachable after the cross-origin return. It is kept as explicit documentation of R3.
- `archive/VTOL_Relay_Carrier_Operating_Manual.html` still has a Google Fonts import. It is not served or precached, and it is out of scope.
- `CLAUDE.md` still says "bump CACHE in sw.js". The report flags this for WP10.

## Approval rationale

- **Requirements:** every MUST requirement (R1–R9, R11, R12 a–h) and the SHOULD R10 pass on independent evidence, much of it from a real browser:
  - the offline load with fonts, the new-deploy toast, RELOAD and cache switch;
  - the upgrade from the live v12 worker;
  - zero CSP violations with all external endpoints exercised;
  - emergency-only fit at 360×640;
  - the kneeboard PDF and the decoded QR.
- **R3 deviation:** implemented correctly, and accepted per the PM.
- **Regressions:** no regression in the Tools, manual or map behaviour (earlier smokes are unchanged, and html-validate counts are identical).
- **Visuals:** no visual change beyond the deliberate additions.
- **Content:** no new safety numbers.
- **Merge:** a clean merge into current main (fd73ea9), with all tests green.

Zero BLOCKER and zero MAJOR findings, so the verdict is APPROVED. MINOR items 1–6 can be fixed in a follow-up; item 1 (the map header on a phone) is the one worth doing soon.
