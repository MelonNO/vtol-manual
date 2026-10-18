# WP22 — Implementation report (openly licensed photos)

Branch `wp/22`, base `be7b8f0`. Implementation commit `c4a4eb1`. This report is a separate commit.

## 1. Summary

- **Phase A** (research, before this worktree existed) checked 38 candidate images. Sources: Wikimedia Commons (API, by keyword and by category), Openverse (Commons, Flickr and other CC sources), Unsplash, Pexels, the ArduPilot wiki (its pages and its GitHub image tree), the ExpressLRS docs, and the vendor sites of Heewing, SIYI, Matek and RadioMaster.
- **Images added (PM decisions on Phase A):** two representative photos.
  - `img/rep_fpv_quad.jpg/.webp`: an analog FPV quad (Euflipo, CC BY-SA 4.0, Wikimedia Commons), in *Aircraft ▾ Client Drones*.
  - `img/rep_pitot_tube.jpg/.webp`: a pitot-static tube whose inlet labels are ArduPilot's own (ArduPilot Dev Team, CC BY-SA 3.0, ArduPilot Plane docs), in *Planning ▾ Maintenance*, under "Carrier — Every 5 Flights".
- **Captions and attribution:** each figure has a "Representative image: …" caption, alt text starting "Representative image, not …", and a credit line (author, licence, links). A new visible **Image Credits** section sits at the end of *Reference ▾ Abbreviations* (`#abbrev/image-credits`).
- **Vendor images kept** (PM: Q1 = no, Q3 = keep): `t2_vtol.jpg`, `t2_vtol2.jpg`, `siyi_hm30.jpg` and `matek_f405.jpg`. No openly licensed replacement exists. The ArduPilot-hosted Matek photo was rejected because it rests only on "courtesy of mateksys.com".
- **`img/README.md` changes:**
  - The alt-text rule is amended for representative images.
  - The source rule now lists the accepted licences and the duty to show attribution.
  - The credits table now carries the full R1 data for each file.
  - The Heewing and SIYI rows carry a copyright note.
  - The `fpv_drone.jpg` entry is corrected (PM MUST).
  - Shot-list items 6 and 13 are marked as having a representative image.
- **Other repo changes:** precache regenerated; one new test.
- **Phase A working files** (outside the repository): research table, licence records, staged files and scripts, under `S\wp22\` (`PHASE-A.md`).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 Licences | DONE | `img/README.md:84-85` (new rows); `manual.html:1355-1368` (Image Credits) | Both images are CC BY-SA. Each row records the source page, direct file URL, author, licence with URL, and the date checked (2026-10-18). Each licence was verified by reading the source page: the Commons file page for A1; the ArduPilot page, the wiki repository LICENSE ("CC3.0 BY SA") and the commit history for A2. Neither image shows faces, plates or house numbers. |
| R2 Honesty | DONE | `manual.html:1461-1462`, `manual.html:1601-1602`; `img/README.md:10` | Both images are explicitly representative. The README alt-text rule now has the explicit exception, so it is no longer contradicted. No annotation was added: the pitot labels are ArduPilot's originals and are credited as "Photo and labels". Changes are resize and re-encode only, stated as "resized" in every credit. |
| R3 Quality bar | DONE | `S\wp22\PHASE-A.md` §2 (38 candidates, one line each) | Only two images, each at a spot it explains: what a client looks like, and the pitot check "tube clear … static port not blocked". All vendor images are kept (no equal or better licensed replacement), and their credits facts are unchanged. |
| R4 Processing | DONE | `S\wp22\tools\optimize-images.py` (byte-identical copy); `S\wp22\PHASE-A.md` §4 | Metadata stripped (the A1 original had EXIF GPS), at most 1600 px, 134 KB and 54 KB JPEGs, `.webp` siblings. The README clean check gives 0 EXIF tags and no exif/icc/xmp/comment keys for all four files. |
| R5 Placement | DONE | `manual.html:1460-1463`, `manual.html:1600-1603` | `<picture>` with webp and jpg, explicit `width`/`height`, `loading="lazy"`, `onerror` hide like the other figures, `class="contain"` so nothing is cropped. The pitot figure links to the full-size `.webp` so its labels are readable on a phone. |
| R5 Credits | DONE | `img/README.md:76-88`; `manual.html:1355-1368`; `manual.html:70` | Credits table: one row per file. Visible section in *Reference ▾ Abbreviations*, linked from both captions. CSS `.man-photo figcaption .credit{text-transform:none;letter-spacing:0;}` (Q4), with no colours. |
| R5 Offline cache | DONE | `sw-precache.js:37-38`, new hash | `node scripts/gen-precache.mjs` was run; `--check` is up to date (59 assets). |
| R5 Must stay green | DONE | §4 | Everything passes. |
| R5 Report | DONE | this file | |
| R6 Shot list | DONE | `img/README.md:94`, `:103`, `:119` | The list is kept. Items 6 and 13 are marked "representative image in the manual … replace with own photo". It now says items 1, 3, 4, 7 and 9–12 are build-specific and have no substitute. |
| PM Q3 (vendor notes) | DONE | `img/README.md:80-81`, `:83` | The Heewing ToS §2 quote is cited with https://www.heewing.com/policies/terms-of-service. The SIYI footer "All Rights Reserved" is cited with https://www.siyi.biz/en/. Both were checked on 2026-10-18. The images are kept. |
| PM MUST (`fpv_drone.jpg`) | DONE | `img/README.md:88` | Corrected: no GPS position (the EXIF GPS block was empty). It is Commons "File:Racing Drone.jpg", author Commanderbryce (own work), CC BY-SA 4.0, uploaded 2016-03-14, looked up read-only through the Commons API. It was removed from the site in WP04 (`3721cd4`) and is kept in git history by owner decision (2026-10-18). No camera serial is mentioned. |

## 3. Placeholders

None added.

## 4. Tests

**New test:** `test/manual/manual.test.js:199`, "image credits: every photo has a credits row; representative images say so". It checks that:
- every `img/*.jpg` used by `manual.html` has a row in the `img/README.md` credits table;
- every `rep_*` image's alt text starts "Representative image, not ";
- both representative captions start "Representative image:" and contain a `.credit` span with a CC BY-SA credit and the `#abbrev/image-credits` link;
- the Image Credits section exists in the Abbreviations tab.

**Commands** (run in the worktree, all passing):

```
VTOL_JSDOM=<S>/jsenv/node_modules/jsdom node --test test/   → tests 311, pass 311, fail 0, skipped 0
node scripts/gen-precache.mjs --check        → sw-precache.js up to date (59 assets)
node scripts/diagrams/build.js --check       → diagrams up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-params-reference.mjs --check → data/params-reference.js up to date (1663 parameters)
node scripts/check-links.mjs                 → every internal link and asset resolves
node scripts/check-images.mjs                → 35 images within budget (largest img/t2_vtol.jpg 199.0 KiB)
node scripts/check-colours.mjs               → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors
                                               (pre-existing warnings only; manual.html alone: clean)
```

**One fix during the run:** the first suite run failed `test/pwa/sw.test.js` R3 and R11 (offline). The cause was that the pitot figure's full-size link pointed to the `.jpg`, which is not precached when a `.webp` exists. The link now points to `img/rep_pitot_tube.webp`, and both tests pass.

## 5. Deviations and contract issues

- **Matek replacement (A3) not done** (PM Q1 = no). `matek_f405.*` and its facts are unchanged. The row only moved into the widened table.
- **Full-size link uses the `.webp`, not the `.jpg`,** so that it works offline (see §4).
- **README `Pages` rule:** "Add new images to the `sw.js` precache list" is now "… with `node scripts/gen-precache.mjs` (writes `sw-precache.js`)". The old wording predates the generated precache (WP09).
- **Image Credits table** also lists the four kept vendor images with "licence not recorded", so readers see their status too.
- I did not touch any WP21 files.

## 6. Notes for the verifier

- **Client Drones:** open `manual.html#clients`. The photo is under the intro paragraph. Its caption reads "Representative image: …", and the credit line keeps its case.
- **Maintenance:** open `manual.html#maintenance`. The pitot figure is under "Carrier — Every 5 Flights". Tap it to open the full-size `.webp`.
- **Image Credits:** "Image credits" in either caption leads to `#abbrev/image-credits`, the last section of *Reference ▾ Abbreviations*.
- **Image check:** `python -c "from PIL import Image; im=Image.open('img/rep_fpv_quad.jpg'); print(im.format, im.size, len(im.getexif()), sorted(im.info))"` should print `JPEG (1600, 1200) 0 [...jfif..., progressive]`. Repeat it for `rep_pitot_tube.jpg` (1600 × 841).
- **Licence sources:**
  - https://commons.wikimedia.org/wiki/File:Dron-fpv.jpg
  - https://ardupilot.org/plane/docs/common-pitot-considerations.html
  - https://commons.wikimedia.org/wiki/File:Racing_Drone.jpg (the corrected `fpv_drone.jpg` entry)
- **Full candidate table:** `S\wp22\PHASE-A.md` §2 lists all 38 candidates with reasons. §3 has the sha256 of the originals and of the staged files. The files in `img/` are identical to the staged ones.
