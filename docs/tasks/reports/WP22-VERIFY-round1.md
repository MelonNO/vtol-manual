VERDICT: REJECTED

# WP22 verification — round 1

- Branch `wp/22`: c4a4eb1 (work), 10ffe45 (report). Base `be7b8f0`.
- Verifier: independent agent, 2026-10-18.
- Throw-away material is under `S\verify\WP22\`:
  - `downloads\`: originals, API JSON, vendor pages
  - `run\`: an archive copy of 10ffe45, used for the tests and mutations
  - `merge\`: the trial-merge clone
  - `shots\`: renders at 360 px
  - `tools\`: the verifier's scripts

The licences, honesty, image processing, scope, merge and regression checks all pass. **One MAJOR finding blocks approval:** every attribution link uses the browser's default link blue on the dark theme. The credits that readers must be able to see are therefore barely legible (1.69:1 contrast).

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 Licences | PASS | A1: Commons API (`imageinfo`/`extmetadata`) for File:Dron-fpv.jpg returns Artist "Euflipo", Credit "Own work", "CC BY-SA 4.0", LicenseUrl `…/by-sa/4.0`. The wikitext has `{{self\|cc-by-sa-4.0}}` and there is one revision. Original 4000×3000, sha256 `86c13739…de7e5b`, which matches PHASE-A §3. A2: page footer "© Copyright 2024, ArduPilot Dev Team." with the CC BY-SA 3.0 badge (`…/by-sa/3.0/`). The `ArduPilot/ardupilot_wiki` LICENSE reads "CC3.0 BY SA (Attribution-ShareAlike 3.0 Unported)". The image commits are 0130ffa91e (Henry Wurzburg, 2023-01-19, "Add pitot tube page") and ae08b18073 (jpegoptim). GitHub and docs copies are byte-identical (sha256 `e24dcea0…2c6b`). The page has no "courtesy of" note or any third-party credit; I checked the full page text. The original's EXIF has only `Software = paint.net 5.0`, with no artist or copyright. | Repo files against the originals, resized: pHash distance 0 for all four files. dHash distance 0 for A1 and 1 for A2. Mean absolute pixel difference ≤ 1.3 per channel, so these are the same images. No crop, no edit, and the aspect ratio is kept. I viewed both images: no faces, no number plates, no house numbers (A1 shows only Foxeer and other brand marks). The README rows hold the source page, file URL, author, licence with link, and the date checked. |
| R2 Honesty | PASS | Both alt texts start "Representative image, not …" (`manual.html:1461`, `:1601`). Both captions start "Representative image:" and say "not a client drone of this system" or "not this aircraft's". The README alt-text rule (`img/README.md:10`) now has an explicit exception, and the Source rule (`:11`) lists the accepted licences. No contradiction is left. The pitot labels are ArduPilot's originals, credited "Photo and labels". | Q3 notes checked by a read-only fetch on 2026-10-18. Heewing ToS "SECTION 2 - GENERAL CONDITIONS" reads "You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of the Service, or access to the Service or any contact on the website … without express written permission by us." The README's quote is accurate, with a correct ellipsis. The SIYI footer reads "Copyright @ 2017-2026 SIYI Technology All Rights Reserved." (exact match). For `fpv_drone.jpg`, the Commons API gives user and Artist "Commanderbryce", Own work, CC BY-SA 4.0, upload timestamp 2016-03-14T19:41:32Z, and description "Minion 220 racing multirotor by RotorGeeks". Content SHA-1 `e504e5f4…` equals blob `b32c311`, the only `fpv_drone.jpg` blob in this repository. Its GPS IFD holds only tag 0 (GPSVersionID), with no position. Commit 3721cd4 came in with the WP04 merge 80a4c16. Every PM-required element is present. Serial check: I compared every digit run of length ≥ 6 and every alphanumeric run of length ≥ 8 from that blob's EXIF (including the maker note) against the WP22 diff, the commit messages, the report and PHASE-A.md. There are 0 matches, so no serial appears. Coordinates check: none of A1's Commons coordinates appear in the diff. |
| R3 Quality bar | PASS (see MINOR-3) | Two images, each at a spot it explains. All vendor images are kept unchanged (PM Q1 = no). | The candidate table (38 lines) is only in `S\wp22\PHASE-A.md` §2. |
| R4 Processing | PASS | README clean check: `rep_fpv_quad.jpg JPEG (1600, 1200) 0 [jfif…, progressive]`, `.webp WEBP (1600,1200) 0 [background, loop]`, `rep_pitot_tube.jpg JPEG (1600, 841) 0 […]`, `.webp WEBP (1600, 841) 0 […]`. Sizes are 134 101 / 53 794 / 53 593 / 25 068 B. The GPS IFD is empty, and the raw bytes contain no `Exif`, `GPS`, `xmp` or `ICC_PROFILE` marker. | ≤ 1600 px, ≤ 200 KB, `.webp` siblings present. |
| R5 Placement | PASS | `<picture>` has a webp `<source>` and a jpg `<img>`. `width`/`height` are 1600×1200 and 1600×841, which equal the real pixels. `loading="lazy"`, `class="contain"`, and an `onerror` hide as in the other figures. The pitot full-size link points to `img/rep_pitot_tube.webp`, which is in `sw-precache.js:38`. `sw.js` serves it from the cache on navigation (network-first with cache fallback). | Rendered at 360 px in headless Chrome inside a 360 px iframe: no overflow, no crop, and captions wrap. |
| R5 Credits | **FAIL (MAJOR-1)** | The section exists and routes correctly (jsdom: a direct load of `#abbrev/image-credits` makes `tab-abbrev` active and scrolls `#image-credits` into view; following the caption link from `#clients` does the same; the glossary filter hides none of the 5 credits rows). The README table has one row per file. The `.credit` CSS rule is present and its computed `text-transform` is `none`. | The attribution links are, in practice, not legible (see MAJOR-1). |
| R5 Offline cache | PASS | `gen-precache --check`: up to date (59 assets). New entries: `./img/rep_fpv_quad.webp`, `./img/rep_pitot_tube.webp`. | |
| R5 Must stay green | PASS | See "Tests run". | |
| R5 Report | PASS with MINOR-2 and MINOR-3 | `docs/tasks/reports/WP22-IMPLEMENTATION.md` | |
| R6 Shot list | PASS | `img/README.md:94`, `:103`, `:119` | |
| PM: A1 + A2 only, no Matek replacement | PASS | `matek_f405.*` is unchanged. The Image Credits row reads "Matek Systems vendor marketing image · licence not recorded · to be replaced with own photo". | |
| PM: credits at end of Abbreviations | PASS | `manual.html:1355-1366`, inside `#tab-abbrev` | |
| PM: Q3 notes on t2_vtol, t2_vtol2, siyi_hm30 | PASS | `img/README.md:80,81,83`; quotes verified | |
| PM: `.credit` CSS rule | PASS | `manual.html:70`, exact text | |
| PM: bare-tube pitot | PASS | `pitot.jpg` (not `pitotinstalled1.jpg`) | |
| PM: fpv_drone README line | PASS | `img/README.md:88` | No GPS; Commons "File:Racing Drone.jpg"; CC BY-SA 4.0; 2016-03-14; Commanderbryce; URL; WP04; kept by owner decision; no serial. |

## Contract results

No contract is referenced. `#abbrev/image-credits` passes through `ManualCore.parseHash` → `{tab:'abbrev', anchor:'image-credits'}`, and `check-links` accepts it.

## Tests run (commands + results)

The run copy is an archive of 10ffe45, with `VTOL_JSDOM` and `VTOL_PYTHON` set.

| Command | Result |
|---|---|
| `node --test test/` | tests 311, pass 311, fail 0, skipped 0 |
| `node scripts/gen-precache.mjs --check` | exit 0, up to date (59 assets) |
| `node scripts/diagrams/build.js --check` | exit 0 |
| `node scripts/gen-params-reference.mjs --check` | exit 0 (1663 parameters) |
| `node scripts/check-links.mjs` | exit 0 |
| `node scripts/check-images.mjs` | exit 0; **39** images within budget (base be7b8f0: 35) |
| `node scripts/check-colours.mjs` | exit 0 |
| `html-validate manual.html index.html relay/map.html tools/latency-clock.html` (`S/jsenv`, `.htmlvalidate.cjs`) | 0 errors, 169 warnings. Identical to base, so no new warnings. `manual.html` alone is clean. |

**Mutation tests** of the new test in `test/manual/manual.test.js`. Each mutation was applied to the `run\` copy, `node --test test/manual/manual.test.js` was run, and the copy was reset afterwards. Where it fails, the failing test is "image credits: …".

| Mutation | Result |
|---|---|
| README row `rep_fpv_quad` removed | fails ✔ |
| README row `rep_pitot_tube` removed | fails ✔ |
| README row `t2_vtol2` removed | fails ✔ |
| manual credits row FPV (Euflipo) removed | fails ✔ |
| manual credits row pitot removed | fails ✔ |
| FPV alt "Representative " dropped | fails ✔ |
| pitot alt "Representative " dropped | fails ✔ |
| FPV caption credit span removed | fails ✔ |
| pitot caption credit span removed | fails ✔ |
| FPV caption "Representative image:" dropped | fails ✔ |
| manual credits rows Matek / Heewing / SIYI removed | **pass** (survive), see MINOR-1 |
| FPV caption author name removed (licence kept) | **pass** (survives), see MINOR-1 |

**Scope.**
- Changed files: `img/README.md`, `img/rep_fpv_quad.{jpg,webp}`, `img/rep_pitot_tube.{jpg,webp}`, `manual.html`, `sw-precache.js`, `test/manual/manual.test.js`, and `docs/tasks/reports/WP22-IMPLEMENTATION.md`. All are within WP22.
- None of WP21's files are touched (GCS version files, CHANGELOG, README, OPEN-ITEMS).

**Trial merge**, in the throw-away clone `S\verify\WP22\merge`:
- `be7b8f0` + `wp/22`: clean.
- Then + `wp/21` (d43f6a9, now present): clean, with zero overlapping files.
- On the combined tree: `node --test test/` passes 311/311, and all six check scripts exit 0.

## Smoke tests (what you loaded/clicked + result)

**jsdom** (`S\verify\WP22\tools\smoke.js`, page scripts inlined, fetch stubbed offline):
- `manual.html#abbrev/image-credits`: 0 errors; `tab-abbrev` active; `scrollIntoView` on `image-credits`; 5 credits rows.
- `#clients`: 0 errors; the FPV figure is in `tab-clients`. Setting the hash to the caption's `#abbrev/image-credits` link switches to `tab-abbrev` and scrolls to the section.
- The pitot figure is in `tab-maintenance`, its link goes to `img/rep_pitot_tube.webp`, it is 1600×841 and lazy.
- Computed `.credit` style: `text-transform: none`, `letter-spacing: 0px`; the figcaption stays `uppercase`.

**Headless Chrome** at 360 px CSS width (iframe wrapper, `S\verify\WP22\shots\`):
- Client Drones figure, pitot figure, and the Image Credits table: no horizontal overflow, images not cropped, the table wraps inside `.tbl-wrap`.
- **Defect:** every link renders in the browser's default `#0000EE` on `#222` (MAJOR-1). See `shots\clients_caption_zoom.png`, `shots\x_maintenance_xpit.png` and `shots\w_abbrev_image-credits_c.png`.

**Print** (`css/print.css`, by review):
- `figure` has `break-inside:avoid`, `img` has `max-width:100%`, and every colour is forced to ink on paper, so the credits print in black.
- Nothing breaks.
- Link URLs are not printed, but the visible text names the author, the licence and the source.

## Findings

1. **MAJOR-1: attribution links are illegible in both themes.**
   - **Where:** `manual.html:1462` and `:1602` (caption credit links: "Euflipo", "CC BY-SA 4.0", "ArduPilot Plane docs", "CC BY-SA 3.0", "Image credits") and `manual.html:1360-1361` (Image Credits table links).
   - **Cause:** before WP22 the manual had no plain text links (only `.pr-table a{color:var(--accent);}` at `manual.html:212`, and links that wrap diagram images). Neither `manual.html` nor `css/base.css` styles `a`, so the new credit links get the UA default `#0000EE`, or `#551A8B` once visited.
   - **Measurement:** on the dark theme's `--surface2` `#222` caption background, the rendered link pixels are (0,0,238) on (34,34,34). That is a contrast of **1.69:1** (WCAG AA needs 4.5:1). Sunlight mode is no better: `#111` or `#000` backgrounds.
   - **Why it matters:** for A1 the author's name exists only as link text, so the author name and licence are barely readable. The attribution that CC BY-SA needs and R5 requires ("attribution that readers can see") is effectively not visible on a phone in the field.
   - **Expected:** give these links a token colour, for example `.man-photo figcaption a, #tab-abbrev .tbl-wrap a{color:var(--accent);}`, which follows the existing `.pr-table a` pattern and keeps `check-colours` green. Re-render to confirm.
2. **MINOR-1: the new test does not protect everything.** `test/manual/manual.test.js:199-213` gives no protection against:
   - removing the Matek, Heewing or SIYI rows from the manual's Image Credits table. It only checks for `Euflipo … ArduPilot Dev Team` in the Abbreviations panel.
   - removing the author name from a caption credit. It only checks for `CC BY-SA` and the credits link.

   Those mutations survive. The mutations the brief requires (a README credits row, the CC rows, "Representative" in the alt text, the caption credit span) are all caught. Suggested fix: assert one credits-table row per photo file, and assert the author name in each caption.
3. **MINOR-2: report honesty.** The report (§4) states `check-images → 35 images within budget`. On the branch the script reports **39** images; 35 is the base count. The quoted output was therefore taken before the new files were tracked, or is stale. The actual result passes. Please correct the line.
4. **MINOR-3: R3 record not in the repository.** The R3 candidate table (38 lines) and the §3 licence data (the originals' sha256 and file sizes) exist only in `S\wp22\PHASE-A.md`, outside the repository. The in-repo report only points to that file, although the Phase A plan §6.8 says to "Write the report … with the §2 table and §3 data". Copy them into `docs/tasks/reports/WP22-IMPLEMENTATION.md` so that the licence evidence survives.

**Notes, not findings:**
- **A2 provenance.** The base photo looks like a studio product shot. Its origin cannot be traced further: the wiki commit only adds it, and the EXIF shows only paint.net. It is covered by the wiki-wide CC BY-SA 3.0 licence, and neither the image nor the page carries any third-party credit. The PM accepted it. This is a residual risk only.
- **Resize and re-encode.** I do not consider them a modification. CC BY-SA 4.0 §2(a)(4) says technical format changes never produce Adapted Material, and under 3.0 resizing is not a derivative. The credits nevertheless say "resized", which is harmless and transparent.
- **WP21's OPEN-ITEMS O-5** mentions a second `fpv_drone` blob, `c65b4da` ("© sanaan"). That blob is not present in this repository: `git cat-file` fails and `rev-list --all` shows only `b32c311`. WP22's README wording, "the copy in git history", is therefore accurate. Any discrepancy belongs to WP21 and the PM.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

REJECTED. The only item that must be fixed is **MAJOR-1**: give the caption credit links and the Image Credits table links a legible token colour, then re-verify. MINOR-1 to MINOR-3 should be addressed in the same round; they are cheap. Everything else passes, including the licences (independently confirmed), honesty, the PM decisions, image processing, scope, the trial merges and the regression checks.
