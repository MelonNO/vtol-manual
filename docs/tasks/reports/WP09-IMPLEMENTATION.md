# WP09 — Implementation report (offline, PWA and field-use features)

Branch `wp/09`, worktree `S\wt\WP09`. Base `86a28db`. Implementation commit `fc59571` (+ this report).
`main` has moved to `7e56547` since the base, but only in `docs/` (plan Rev C, C1.6, WP14 brief), so the branch merges without conflicts.

## 1. Summary

- **Fonts (R1):** Oswald (one variable `woff2` per subset, latin + latin-ext, covering 400/600/700) and Share Tech Mono (latin) are self-hosted in `fonts/`. The folder also holds the OFL licences and a README with the sources and SHA-256 values. Google Fonts is gone from every page and every CSP. `manual.html` and `relay/map.html` had no CSP before; both now have a tight one.
- **`css/base.css` (R2):** holds the `@font-face` rules, the shared `:root` tokens and the base element styles. Every page links it. The duplicated token blocks are removed.
  - **No visual change:** a jsdom computed-style comparison on 10–11 key elements per page × 14 properties (630 values) is identical to a snapshot taken before WP09.
- **Service worker (R3):** `sw.js` is rewritten.
  - **Precache:** the list comes from `scripts/gen-precache.mjs` → `sw-precache.js` (56 assets plus a content hash).
  - **Cache name:** `vtol-manual-<VTOL_VERSION.app>-<hash>`. Older `vtol-manual-*` caches are deleted on activate.
  - **Strategies:** pages and page code (`.js` / `.css`) are network-first with a 4 s timeout. Every other asset is stale-while-revalidate. Cross-origin requests (GCS API, Open-Meteo, Nominatim, tiles) are never intercepted.
- **`js/field.js` (new, shared by all four pages):**
  - SW registration and the "NEW VERSION AVAILABLE — RELOAD" toast (R4)
  - footer version line: app · content · param file (`store.paramFile` name + date)
  - sunlight toggle (R7), wake lock (R6), QR (R10), print kneeboard (R8)
- **Other new pieces:**
  - **`manifest.webmanifest`** and icons generated with Pillow (R5).
  - **`css/print.css`** (R8): print and kneeboard stylesheet.
  - **`js/emergency-only.js`** (R9): `index.html#emergency-only`.
  - **QR library:** vendored `qrcode-generator` 1.4.4 (MIT, R10).
- **R12 carry-overs:**
  - battery gauge: wrapped notes, 14-unit text, visible zone legend
  - `build.js --check`: clean error message
  - amber VERIFY markers in the inline SVGs
  - corrected `img/README.md` width
  - diagrams precached
  - sunlight mode on the inline SVGs
- **Tests:** 42 new tests in `test/pwa/` (8 files) give 262 tests in total. They include a full service-worker simulation in a Node `vm`, where every page and referenced asset is served offline from the cache.
- **Real browser:** an offline load and the update flow were also verified in headless Edge 155 (§6).

## 2. Requirement table

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `fonts/*.woff2`, `fonts/OFL-*.txt`, `fonts/README.md`; `css/base.css:7-16`; CSPs `index.html:6`, `manual.html:6`, `relay/map.html:7`, `tools/latency-clock.html:6` | **Fonts:**<br>- Oswald is served by Google as a variable font: the 400/600/700 `@font-face` rules all point at the same file, so one `font-weight:200 700` face per subset.<br>- latin-ext is included; cyrillic and vietnamese are not needed.<br>- Files are unmodified (sources and SHA-256 in the README).<br>**Google Fonts removed:** the `@import` is gone from all four pages, and `fonts.googleapis` / `gstatic` from every CSP. Every CSP now has `font-src 'self'`.<br>**New CSPs:**<br>- `manual.html`: `connect-src 'self'`.<br>- `relay/map.html`: `img-src` / `connect-src` list exactly the tile and terrain hosts of `LAYERS` / `TERR_URL` / `VEG_SRCS`, plus `blob:` (offline tiles) and `http://127.0.0.1:47800`. A test parses the hosts out of the page and checks them against the CSP.<br>**Browser result:** headless Edge loads the 4 pages with zero CSP violations; map tiles load. |
| R2 | DONE | `css/base.css:18-29`; heads of the 4 pages; `test/pwa/base-css.test.js`, `test/pwa/computed-style.js`, `test/pwa/fixtures/computed-before.json` | **Tokens in `base.css`:** the shared `:root` tokens use exactly the old index/map values. New tokens: `--paper` / `--ink` (print, QR) and `--vf-zoom`.<br>**Kept in the pages (page-only values, not duplicates):**<br>- manual: `--muted:#777`, `line-height:1.65`<br>- map: link colours and its old 16px / normal body metrics<br>- latency clock: `--clock-*` and its font fallback stacks<br>**jsdom comparison:** 11 + 11 + 11 + 11 elements × 14 properties, all equal to the pre-WP09 snapshot (`VTOL_JSDOM=… node --test test/`).<br>**Visual check:** before/after screenshots in Edge are identical apart from the new ☀ button. |
| R3 | DONE (see §5.1) | `sw.js` (whole file; `:12` importScripts, `:15` cache name, `:24-31` activate, `:62-75` network-first, `:78-84` SWR, `:18`/`:87-96` never-cache); `scripts/gen-precache.mjs`; `sw-precache.js` | **Precache list (56 assets):** `./`, pages, `js/**`, `data/*`, `css/*`, `fonts/*.woff2`, `relay/map.html` + `rfmodel.js` + Leaflet vendor, `img/*.webp` + `.svg` (`.jpg` only where there is no `.webp`), `img/diagrams/*.svg`, `tools/*.html`, icons, manifest.<br>**Content hash:** any change to a listed file changes `sw-precache.js`, so the browser installs a new worker and the toast appears.<br>**Tests:**<br>- the list is up to date (byte-exact against the generator);<br>- every entry exists;<br>- every reference from pages, CSS, manifest and scripts is listed;<br>- `gen-precache.mjs --check` for CI.<br>**Deviation:** JS/CSS are network-first, not SWR (§5.1). |
| R4 | DONE | `js/field.js:84-127` (toast, registration, `updateViaCache:'none'`, `reg.update()` on visibility + every 30 min); `sw.js:33-35`; version line `js/field.js:44-87`; footers `index.html:632`, `manual.html:1727`, `relay/map.html:569`, `tools/latency-clock.html:99` | **Toast:** the text is "NEW VERSION AVAILABLE — RELOAD / LATER", shown when a new worker is installed and waiting. RELOAD posts `SKIP_WAITING`, and the page reloads on `controllerchange` (only after the user asked).<br>**Footer:** every page shows `APP 2.0.0-dev · CONTENT 2026-10-16 · PARAM FILE <name> <YYYY-MM-DD>`.<br>- The param file comes from `store.paramFile` (read without side effects).<br>- Without a param file the footer shows `TBD` in amber.<br>- The line updates on `storage` / `vtol-store-changed`.<br>**Browser test:** a new deployment shows the toast; RELOAD activates the new cache and deletes the old one. |
| R5 | DONE | `manifest.webmanifest`; `icons/*.png`; `scripts/gen-icons.py`; links in all 4 heads | **Manifest:** name, short_name "VTOL Relay", theme `#f97316`, background `#0f0f0f`, `start_url ./index.html`, `scope ./`, standalone. Shortcuts: Emergency only / Manual / Map.<br>**Icons:**<br>- 192, 512, maskable 192/512 (glyph inside the 80 % safe circle) and apple-touch 180.<br>- The design is an orange delta-wing chevron on black.<br>- Output is deterministic (re-running gives the same bytes).<br>**Links on every page:** manifest, theme-color, icon. |
| R6 | DONE | `js/field.js:128-151`; `index.html:676-682` (`wakeSync`), calls in `switchTab`, `openEmerg`, `closeEmerg`, `crOpen`, `crClose`, tab restore, emergency-only `onChange` | **When held:** while a checklist tab (pre-flight, turnaround, post-flight), challenge–response, the emergency modal or emergency-only mode is open.<br>**When released:** otherwise.<br>**Other behaviour:**<br>- Re-requested when the page becomes visible again.<br>- A release while a request is pending is handled.<br>- Feature-detected: no API means no error.<br>**Tests:** Node vm unit test, and Edge with a fake `navigator.wakeLock` (sequence `preflight=1 battlog=0 modal=1 … eo=1 eo-exit=0`). |
| R7 | DONE | `css/base.css:31-50`; `js/field.js:35-43`; ☀ toggle on every page (`index.html:287` + emergency-only bar `:355`, `manual.html:246`, `relay/map.html:252`, `tools/latency-clock.html:58`) | **Mechanism:** `<html data-sun>` overrides the tokens: pure white on black (`--bg/--surface #000`, `--text #fff`, `--muted #ececec`, brighter borders). The setting is persisted in `localStorage['vtol_sunlight']`, applied in `<head>` before the first paint, and synced across tabs.<br>**Larger text:** `zoom:1.15` on the content containers (`.vf-zoom`), not on the nav or the map canvas.<br>**Thicker lines:**<br>- 2 px table, card and input borders;<br>- thin SVG strokes become 2–2.5;<br>- the standalone diagram `<img>` files get a contrast filter.<br>**Browser check at 360 px:** white on black on all 4 pages, and no horizontal page scroll on any Tools or manual tab. |
| R8 | DONE | `css/print.css`; `js/field.js:186-194`; button `index.html:641` | **Every print:** black on white (tokens → ink/paper; `html:root` outranks the manual's own `:root`), no nav, buttons, FAB or toast. Clean-up sections are expanded, tables and cards never split, and the dark diagram files are inverted.<br>**Kneeboard (PRINT KNEEBOARD):**<br>- the emergency cards (immediate + clean-up), one scenario per block, never split, design-intent card left out;<br>- then blank pre-flight and turnaround checklists (ticked rows print unticked), each on a new page.<br>**Verification:** Edge with `Emulation.setEmulatedMedia(print)` — computed checks pass (§4). `Page.printToPDF` gave an 11-page A4 kneeboard. jsdom cannot evaluate print media, so a real browser was used. |
| R9 | DONE | `js/emergency-only.js`; `index.html:351-358` (view), `:1459-1464` (mount); CSS `css/base.css:87-111` | **List screen (`#emergency-only`):** 9 full-width buttons (8 cards + the 915 note), filling the screen with no scrolling. Each button is ≥ 44 px (55 px at 360×640).<br>**Scenario screen (`#emergency-only/<id>`):**<br>- the IMMEDIATE steps only, through `VtolRender.fmt` (tokens resolved, mode badges, TBD markers);<br>- the font is binary-searched so the card never scrolls: 23–32 px at 360×640, checked in Edge for all 9 scenarios, normal and sunlight;<br>- ◀ ALL / NEXT ▶ / EXIT, and the browser Back button works.<br>**Rest of the page:** everything else is hidden. The wake lock is held and swipes are ignored.<br>**Entry points:** links from the emergency modal and the footer, plus a manifest shortcut. |
| R10 | DONE | `js/vendor/qrcode-generator/{qrcode.js,LICENSE,README.md}`; `js/field.js:153-185`; footer menu `index.html:633-645` | **QR code:** `qrcode-generator` 1.4.4 (MIT, unmodified, SHA-256 recorded) draws an SVG QR of `https://melonno.github.io/vtol-manual/` in `var(--ink)` on `var(--paper)`.<br>**Where:** in the Tools footer "SHARE / KNEEBOARD" menu, which also holds PRINT KNEEBOARD and EMERGENCY ONLY.<br>**Checks:** the module matrix equals the library's (unit test). The rendered QR was decoded with OpenCV from an Edge screenshot and gave the live URL. |
| R11 | DONE | `test/pwa/sw-sim.js`, `test/pwa/sw.test.js`, `test/pwa/precache.test.js`; real-browser run §6 | **Node simulation:** `sw.js` runs in a vm with a fake CacheStorage and fetch.<br>- Install precaches all 56 entries.<br>- Offline, every page and every referenced asset answers 200 from the cache (including `index.html?query`).<br>- An uncached page gives a 503 offline page.<br>**Real browser:** headless Edge with the server stopped — all pages load offline with fonts (§6). |
| R12 | DONE | see below | (a)–(h) |
| R12(a) | DONE | `js/diagrams.js:62-75` (`wrapText`), `:83-179` | Notes, zone legend, marker labels and the footnote are word-wrapped to the viewBox (monospace ≤ 0.6 em). A long pack label is cut with "…" (full text in `<title>`). A test checks that every `<text>` of 5 gauge variants fits in 0…360. |
| R12(b) | DONE | same | All gauge text ≥ 14 units: ≥ 12.25 px at 315 px (360 viewport with a scrollbar) and 12.8 px at 330 px. |
| R12(c) | DONE | `js/diagrams.js:138-142`, `:167-170` | A visible zone legend (swatch + "22.5–23.0 V RTL now" …) under the bar; the `<title>` tooltips are kept. |
| R12(d) | DONE | `scripts/diagrams/build.js:34-45` | `main()` catches and prints `ERROR expected 17 diagram slots, found 16` plus a hint, exit 1, with no stack trace. Tested on a temporary copy. |
| R12(e) | DONE | `scripts/diagrams/inline.js:47`, `:80`; `manual.html` regenerated | The motor "VERIFY against the param file" line and the mission "(4 s: automatic QLand — VERIFY)" now use `var(--amber)`. A test checks every VERIFY `<text>` in the manual's inline SVGs. |
| R12(f) | DONE | `sw-precache.js` | `js/diagrams.js` and all 16 `img/diagrams/*.svg` are precached (tested). |
| R12(g) | DONE | `img/README.md` readability section; `test/diagrams/files.test.js:22` | 332 px content → 330 px figure image (1 px border), about 315 px with a scrollbar; 14 × 330 / 400 ≈ 11.55 px. The test constant follows. |
| R12(h) | DONE | `css/base.css:34-50` | The inline SVGs use only `var(--…)`, so the sunlight tokens recolour them. Thin strokes are thickened and text is bold. In Edge: muted SVG text → rgb(236,236,236), unspecified stroke → 2 px. |

## 3. Placeholders

No new `TBD` values. The footer shows `PARAM FILE TBD` (amber) when no param file has been imported; this comes from `VTOL_VERSION.paramFile` per C4. No safety numbers were added or changed. The gauge still uses the store and `ToolsCore` thresholds; only its layout changed.

## 4. Tests

New, in `test/pwa/`:

| File | Tests | Covers |
|---|---|---|
| `precache.test.js` | 6 | list up to date (byte-exact against the generator), entries exist, required categories, R12(f), every page / CSS / manifest / script reference listed, `--check` |
| `sw.test.js` (+ `sw-sim.js`) | 8 | install into the version-stamped cache, activate deletes old caches, `SKIP_WAITING`, **offline**: all pages + references, network-first (fresh / timeout / server error), SWR, never-cached hosts and non-GET |
| `field.test.js` | 6 | version line (+ escaping), sunlight toggle and persistence (vm), wake lock (vm), Tools wake hooks, QR (matrix = library, tokens only, licence) |
| `emergency-only.test.js` | 5 | routes, list buttons, immediate-only cards with resolved tokens, `fitText`, page wiring |
| `pages.test.js` | 8 | no Google Fonts, `@font-face` / WOFF2 / OFL, CSPs (map hosts derived from the page), base.css linked + no duplicate tokens, manifest + PNG sizes, field.js / toggles / version lines, sunlight CSS, print CSS |
| `base-css.test.js` (+ `computed-style.js`, fixture) | 2 | token values; computed-style equality in jsdom (skipped when jsdom is not available) |
| `r12-carryover.test.js` | 7 | R12 (a)(b)(c)(d)(e)(g)(h) |

Commands:

```
export PATH="/c/Program Files/nodejs:$PATH"
node --test test/                                           → tests 262, pass 261, fail 0, skipped 1 (jsdom check)
VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/     → tests 262, pass 262, fail 0
node scripts/gen-precache.mjs --check                       → sw-precache.js up to date (56 assets)
node scripts/diagrams/build.js --check                      → diagrams up to date (16 SVG files, manual slots and inline SVGs)
```

The same results were obtained in a fresh `git clone` of `wp/09`.

**Regression checks** (earlier verifiers' smoke scripts in `S\verify\`, run on the base tree and on WP09):

| Script | Base | WP09 |
|---|---|---|
| WP07 | 69 / 1 | 69 / 1 |
| WP11 r2 | 103 / 0 | 103 / 0 |
| WP05 r2 | 30 / 1 | 30 / 1 |
| WP06 | 197 / 0 | 194 / 3, or 197 / 0 when the harness serves `.css` |

The two remaining failures (WP07, WP05) also occur on the base tree: jsdom's missing `scrollTo` and a stale text check. The WP06 harness returns 404 for every `.css` and only ignores "Could not load style/img" errors, so the new `<link>` shows up as a "Could not load link" error. With a copy of that harness that also serves `.css` (`S\tmp09\wp06-smoke-css.js`), the result is 197 / 0.

**html-validate** (rule counts, base → WP09):
- `index.html`: 31 / 95 / 1 → identical
- `manual.html`: 0 → 0
- `map.html`: 39 / 1 → identical
- `tools/latency-clock.html`: 2 → 2

No new findings.

## 5. Deviations / contract issues

1. **R3, page code network-first (not stale-while-revalidate).**
   - **What:** `.js` and `.css` are treated like HTML: network-first with a 4 s timeout, then the cache. SWR applies to every other same-origin asset (images, diagrams, fonts, icons, manifest, Leaflet images).
   - **Why:** with SWR, the first online visit after a deploy gets the new `index.html` (network-first) together with the old `tools-core.js` / `render-content.js` from the cache. The page can then call functions that are not there yet. WP01 hit exactly this (WP01 report §5.6), and it was accepted.
   - **Offline and field effect:** none. Offline everything comes from the cache, and with a weak signal the timeout falls back to it.
   - **If the PM wants SWR for code:** it is a one-line change in `sw.js` (`isCode` branch).
2. **Files outside "Files you own"** (all small and needed):
   - **New field-use code** (the brief's "includes"): `js/field.js`, `js/emergency-only.js`, `js/vendor/qrcode-generator/*`, `css/print.css`.
   - **Generators** (the brief asks for the precache generator): `scripts/gen-precache.mjs`, `scripts/gen-icons.py`, `sw-precache.js`.
   - **Test helpers:** `test/pwa/*.js` and the fixture.
   - **R12:** `js/diagrams.js`, `scripts/diagrams/{build,inline,lib}.js`, the 16 regenerated SVGs and `img/README.md`.
     - The SVG change is the palette-comment line only: it now points at `css/base.css`, because the tokens moved there.
     - `test/diagrams/files.test.js`: the `PHONE_CONTENT_PX` constant goes from 332 to 330, matching R12(g); every diagram still passes.
   - **`index.html`:** beyond the head, footer and header hooks, small hooks for wake, emergency-only and swipe. The swipe change ignores swipes in emergency-only mode.
   - **`tools/latency-clock.html`:** on a phone the title takes its own line (one more button). The clock is set to `12vw` at ≤ 600 px: it was already clipped at 360 px on main (`min(15vw,180px)`). Desktop is unchanged.
3. **CSPs added** to `manual.html` and `relay/map.html`, which had none (plan §10.7). Keep the map CSP in step with `LAYERS` / `TERR_URL` / `VEG_SRCS`: a comment says so, and `pages.test.js` fails if a tile host in the page is not allowed.
4. **Manual footer** now reads `DOC-RC-001 · APP 2.0.0-dev · CONTENT … · PARAM FILE <store.paramFile or TBD> · …`. It used to read `REV … · PARAM FILE TBD` from `VTOL_VERSION`.
5. **Kneeboard order:** emergency cards first, then the checklists. This is the DOM order (the modal precedes `.content`), and it puts the most critical page first.
6. **Sunlight "larger text"** uses CSS `zoom` on the content containers: the page CSS is in fixed px, so a font-size token would not scale it. `zoom` is supported by Chrome / Edge / Safari and Firefox ≥ 126. Without it, colours and lines still apply.
7. **Pre-existing bug found, not mine:**
   - **Symptom:** in a real browser with the GCS app absent, `js/gcs-client.js` (`Session.schedule`, line 42) logs "Uncaught (in promise)" on the Tools page and the map. It happens identically on main.
   - **Owner:** WP02 code (GcsClient).
8. **Contract C1.6 (on main, not in my base):**
   - WP14 adds `data/params-reference.js`. The precache test will then fail until `node scripts/gen-precache.mjs` is re-run. This is intended: the generator picks the file up by rule.
   - If WP14 wants the footer to show the reference param-file date, `VtolField.paramFileText(pf, fallback)` takes the fallback.
9. **Maintenance rule (for WP10 docs):**
   - **Rule:** after changing any page, script, CSS, image or diagram, run `node scripts/gen-precache.mjs` and commit `sw-precache.js`. The test fails otherwise.
   - **Stale docs:** `CLAUDE.md` still says "bump CACHE in sw.js", which is no longer how versions work. WP10 owns `CLAUDE.md` / `README.md`.

## 6. Notes for the verifier

**Real-browser checks** (scratch tools, not in the repo; `S = …\scratchpad`, Node 24, headless Edge 155):
- `S\tmp09\cdp.mjs` is a minimal CDP client.
- `serve.mjs` is a stoppable static server.
- `sync.sh <dir>` copies the site files.
- Screenshots and PDFs go to `S\tmp09\shots\`.

**`node S/tmp09/offline.mjs <site copy> <shots>`** — R3 / R4 / R11, 17 PASS:
- SW controls the page after the first visit.
- One cache `vtol-manual-2.0.0-dev-<hash>` holds all 56 entries and no cross-origin entries.
- **Server stopped:** `index.html`, `./`, `manual.html` (gauge + 17 diagram images), `relay/map.html` (Leaflet), `tools/latency-clock.html` and `index.html#emergency-only` all render, and Oswald / Share Tech Mono load from the cache.
- Every precache entry fetches OK; an uncached page gives 503; the GCS API is not cached.
- **New deployment** (hash changed, server restarted): `reg.update()` → the toast appears (fits 360 px) → RELOAD → the new cache is the only one and the toast is gone.

**`node S/tmp09/features.mjs <site copy> <shots>`** — R6 / R7 / R8 / R9 / R10 / R12(h), 43 PASS:
- **Sunlight on all 4 pages:** black / white / zoom 1.15 / `aria-pressed`, no horizontal scroll on every Tools and manual tab at 360 px, manual inline SVG recoloured, persistence and turning it off.
- **Emergency-only:** list fit and every scenario fit (normal and sunlight).
- **Wake lock:** the bookkeeping sequence, and the no-API case.
- **QR:** present in the footer menu.
- **Print media:** kneeboard and ordinary print computed checks; manual Emergency tab print.

**Screenshots and PDFs worth a look** (in `S\tmp09\shots\`):

| What | Files |
|---|---|
| Emergency-only | `eo-list.png`, `eo-emerg-gcs.png`, `eo-emerg-batt-sun.png`, `eo-note-915-lost.png` |
| Update toast | `update-toast.png` (final version: message + RELOAD on one line at 360 px, LATER below) |
| Sunlight | `sun2-manual-motors.png`, `sun2-manual-gauge.png`, `sun2-map.png`, `sun-index_html.png` |
| Print | `print-kb-1..4.png` (kneeboard, print media at A4 width), `kneeboard.pdf`, `print-manual-aircraft.png`, `print-manual-relay.png` (inverted diagram) |
| QR | `share-qr.png` (decodes to the live URL: `S\tmp09\qrvenv` + OpenCV) |

**Manual check in a browser:**
1. Serve the worktree with `python -m http.server 8000`, open `http://localhost:8000/index.html` once, then stop the server and reload: everything still works.
2. ☀ in the header toggles sunlight mode on every page.
3. Footer → SHARE / KNEEBOARD shows the QR, PRINT KNEEBOARD and EMERGENCY ONLY.
4. `#emergency-only` on a phone-sized window.
5. Edit any asset, run `node scripts/gen-precache.mjs` and reload: the RELOAD toast appears.

**R2 snapshot:** `test/pwa/fixtures/computed-before.json` was written from the unmodified base tree with `node test/pwa/computed-style.js <tree> <out.json>`. To re-create it from main: `git archive 86a28db | tar -x -C <dir>`, then run the script on `<dir>`.
