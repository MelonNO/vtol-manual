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
| R1 Licences | DONE | `img/README.md:84-85` (new rows); `manual.html:1356-1369` (Image Credits) | Both images are CC BY-SA. Each row records the source page, direct file URL, author, licence with URL, and the date checked (2026-10-18). Each licence was verified by reading the source page: the Commons file page for A1; the ArduPilot page, the wiki repository LICENSE ("CC3.0 BY SA") and the commit history for A2. Neither image shows faces, plates or house numbers. |
| R2 Honesty | DONE | `manual.html:1462-1463`, `manual.html:1602-1603`; `img/README.md:10` | Both images are explicitly representative. The README alt-text rule now has the explicit exception, so it is no longer contradicted. No annotation was added: the pitot labels are ArduPilot's originals and are credited as "Photo and labels". Changes are resize and re-encode only, stated as "resized" in every credit. |
| R3 Quality bar | DONE | `S\wp22\PHASE-A.md` §2 (38 candidates, one line each) | Only two images, each at a spot it explains: what a client looks like, and the pitot check "tube clear … static port not blocked". All vendor images are kept (no equal or better licensed replacement), and their credits facts are unchanged. |
| R4 Processing | DONE | `S\wp22\tools\optimize-images.py` (byte-identical copy); `S\wp22\PHASE-A.md` §4 | Metadata stripped (the A1 original had EXIF GPS), at most 1600 px, 134 KB and 54 KB JPEGs, `.webp` siblings. The README clean check gives 0 EXIF tags and no exif/icc/xmp/comment keys for all four files. |
| R5 Placement | DONE | `manual.html:1461-1464`, `manual.html:1601-1604` | `<picture>` with webp and jpg, explicit `width`/`height`, `loading="lazy"`, `onerror` hide like the other figures, `class="contain"` so nothing is cropped. The pitot figure links to the full-size `.webp` so its labels are readable on a phone. |
| R5 Credits | DONE | `img/README.md:76-88`; `manual.html:1356-1369`; `manual.html:70-71` | Credits table: one row per file. Visible section in *Reference ▾ Abbreviations*, linked from both captions. CSS `.man-photo figcaption .credit{text-transform:none;letter-spacing:0;}` (Q4), with no colours. |
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
node scripts/check-images.mjs                → 39 images within budget (largest img/t2_vtol.jpg 199.0 KiB); base be7b8f0: 35 (round 2: corrected, see Round 2)
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
- **Full candidate table:** §7 below (copied from `S\wp22\PHASE-A.md` in round 2) lists all 38 candidates with reasons, the licence data and the full sha256 of the originals and of the committed files.

## 7. Phase A record (copied from `S\wp22\PHASE-A.md`, round 2, MINOR-3)

Copied verbatim except: headings demoted, and A3 marked as rejected by the PM. §7.3 lists the files as staged in Phase A; the two A1/A2 pairs in `img/` are byte-identical to them (the Matek pair was dropped). Full sha256 of the originals: `Dron-fpv.jpg` 86c1373934cf647e3903dd02164493c1bdec31288d60562992c89b6768de7e5b, `pitot.jpg` e24dcea07f05792548f4d044e1127880effd5ea36a4e462ca5d8679dbc282c6b, `matekf405-std.png` d0db0490a22f3353db8cffe537549fd974d874e505337988ece1a277f0b3d52a. Full sha256 of the files in `img/`: `rep_fpv_quad.jpg` 88440b202a78cd1aac475c9359f1cc6b72ee44bca78eec7b0da359b9a4914c65, `rep_fpv_quad.webp` 01fd08385a520e4356d2fd0955eada939ebf1bec9d39defdefcdee1c7fe43f3b, `rep_pitot_tube.jpg` 23f5fc7a99347ad3fbc29d9166228938aa354dee59a27dcb96cbd68ec4f22b1b, `rep_pitot_tube.webp` 1688d8771a507cf6dfdea88de2e6e5dfe1aeefc51c88c86255907455e5ae2902.

### 7.1 Candidate table (R3) — every candidate, accepted or rejected

**Exact-product candidates**

| # | Candidate (source) | What it shows | Where it would go | Decision and reason |
|---|---|---|---|---|
| 1 | ArduPilot wiki `matekf405-std.png` | Matek F405-STD, product photo on white | Clients ▸ Reference Client #1 (replaces `matek_f405.jpg`) | **REJECTED by the PM (Q1 = no):** "courtesy of mateksys.com" is permission given to ArduPilot, not a CC BY-SA relicence by Matek, and it is the same vendor photo the repo already has. Phase A had proposed it as conditional A3. It is the exact model and the same Matek photo as the current vendor image, without the spec text. The page carries the wiki's CC BY-SA 3.0 licence, but its credit reads "courtesy of mateksys.com". |
| 2 | ArduPilot wiki `MatekF405-STD.jpg` | Wiring diagram: F405-STD with gimbal, BN-880 GPS, telemetry and SBEC | — | Rejected. It shows an ArduPilot example wiring, not this client's, and would mislead. |
| 3 | ArduPilot wiki `matekf405-ctr.png` | Matek F405-CTR | — | Rejected. It is a different variant (R2). |
| 4 | Commons `MATEKSys F405-WSE FC.jpg` (SokilFPV, CC BY-SA 4.0) | Matek F405-WSE wing flight controller | — | Rejected. It is a different product (R2). |
| 5 | ArduPilot wiki `siyi-hm30.png` | HM30 ground unit only, 121 × 413 px | RF & Comms (backup link) | Rejected. It is too small, shows one unit only and is weaker than the current image. **Keep `siyi_hm30.jpg`.** |
| 6 | SIYI website (www.siyi.biz) | Product images | — | Rejected. The site says "Copyright @ 2017-2026 SIYI Technology All Rights Reserved." and grants no reuse. |
| 7 | Heewing website and ToS (heewing.com, /policies/terms-of-service) | T2 Cruza images | Overview, Aircraft | Rejected. ToS §2 says "You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service" without express written permission, so there is no grant. **Keep `t2_vtol*.jpg`** (see Q3). |
| 8 | Commons, Openverse, Flickr: "Heewing", "T2 Cruza", "SIYI HM30" | — | — | No results. |
| 9 | Matek website (mateksys.com) | Product images | — | Rejected. It shows "© Copyright - Matek Systems" and grants no reuse. |
| 10 | RadioMaster website; Commons and Openverse searches for "Radiomaster" and "TX16S" | Nomad, DBR4 and TX16S | Ground station, relay | Rejected. The site says "Copyright © 2026 RadioMaster All Rights Reserved." The open sources hold only a logo. |
| 11 | ExpressLRS docs (`ExpressLRS/Docs` repository) | Hardware-selection images | — | Rejected. The repository is GPL-3.0, which is not an R1 licence. Commons `Expresslrs Logo.png` is only a logo. |
| 12 | IST8310 or GPS-mast unit (Commons, Openverse) | — | Aircraft ▸ GPS & Compass | Nothing found. |

**Representative candidates**

| # | Candidate (source) | What it shows | Where it would go | Decision and reason |
|---|---|---|---|---|
| 13 | ArduPilot wiki `pitot.jpg` | Bare pitot-static tube; ArduPilot's own arrows mark the dynamic inlet and the static hole | Maintenance ▸ Carrier, every 5 flights (pitot row) | **ACCEPTED (A2).** It shows exactly what the "tube clear … static port not blocked" check refers to. The wiki is CC BY-SA 3.0 and the image has no third-party credit. |
| 14 | ArduPilot wiki `pitotinstalled1.jpg` | Pitot tube protruding from a white foam nose | Same spot | Rejected as redundant with #13, because one pitot image is enough. It is a valid alternative if the PM prefers an installed view (Q5). |
| 15 | ArduPilot wiki `ideal-pitot.jpg` | Long pitot ahead of a nose, a hand pointing, cluttered workshop | — | Rejected. The picture is cluttered, a hand is in frame, and placement advice is not part of the manual. |
| 16 | ArduPilot wiki `nonideal-pitot.jpg` | Fuselage-side pitot on a sport plane | — | Rejected. It is about placement, not inspection. |
| 17 | ArduPilot wiki `airspeed_full_assembly_800px.jpg` | Pitot, tubing and a 3DR-era digital sensor | Pre-Arm Ref, airspeed | Rejected. It shows a specific old sensor, not this aircraft's `ARSPD_TYPE` 4 setup, so its value is marginal. |
| 18 | ArduPilot wiki `BR-0004-03-2T1.jpg` | Bare MPXV7002 analog sensor | — | Rejected. That analog sensor is not used here. |
| 19 | Commons `JASDF UAV(1004) pitot tube … .jpg` (CC BY-SA 4.0) | Pitot on a military target drone, with Japanese placards | — | Rejected. It is a different aircraft class, and the text clutters it. |
| 20 | Commons `Dron-fpv.jpg` (Euflipo, CC BY-SA 4.0) | Complete analog FPV quad: Foxeer lollipop VTX antenna, receiver antenna tube, GPS module, FPV camera, action camera | Clients ▸ Client Drones | **ACCEPTED (A1).** It matches the client profile (analog VTX, external RX antenna, GPS for GPS Rescue). Its clean background has no people, plates or house numbers. The original carries EXIF GPS, which the optimiser strips. |
| 21 | Commons `XLabs Shrike V2 200 mm quadcopter frame with components.jpg` (Lucasbosch, CC BY-SA 3.0, Quality Image) | Studio shot of a race quad with an action camera | Same spot | Rejected. It has no GPS and the action camera dominates; #20 is closer to the client profile. |
| 22 | Commons `FPV Quadrocopter.jpg` (CC BY-SA 4.0) | Frame without props on a cluttered desk | — | Rejected. The aircraft is incomplete and the scene is cluttered. |
| 23 | Commons `Racing Drone.jpg` (Minion 220, CC BY-SA 4.0) | Race quad with action camera on a wooden table | — | Rejected. It is less representative than #20. |
| 24 | Commons `1 MQ250.jpg` (CC BY-SA 4.0) | Old 250-class racer, retail-style shot | — | Rejected. It is dated and less representative. |
| 25 | Commons `FPV Antennen.jpg` (Clicklabs, CC BY-SA 4.0) | TBS VTX board and a Triumph antenna | RF & Comms ▸ Video Downlink | Rejected. It is redundant with #20, and the carrier's VRX uses patch antennas, which it does not show. |
| 26 | Commons `5.8 GHz cloverleaf/helical antenna with SMA connector.jpg` (CC BY-SA 3.0) | Omni and helical FPV antennas | — | Rejected. The carrier does not use these antenna types. |
| 27 | Commons `Antenne patch 2.4 GHz.JPG` (CC BY-SA 3.0) | 16-element 2.4 GHz patch-array PCB | Aircraft ▸ D9 / VRX patches | Rejected. It looks nothing like a 5.8 GHz FPV patch and would mislead. No FPV patch photo was found anywhere. |
| 28 | Commons `Patch antenna w cutaway.gif`; Flickr/DLR `MASCOT Patch Antenna` | Patch-antenna diagram; spacecraft antenna | — | Rejected. Both would mislead. |
| 29 | Commons `DeltaQuad VTOL surveillance UAV.jpg` (CC BY-SA 4.0) | VTOL quadplane in flight, 1003 × 564 px | Overview or Procedures ▸ Transition | Rejected. It is not a tilt-rotor, its resolution is low, and the T2 images already show the real type. |
| 30 | Commons `Composite Tilt-Rotor UAV.jpg` (PD), `Bell TR911X Eagle Eye …` (CC BY-SA 4.0) | Large tilt-rotor UAVs | Aircraft ▸ Tilt-Rotor | Rejected. They are a different class and scale and add nothing beside the T2 images. |
| 31 | ArduPilot wiki `tiltrotor-setup.jpg` | Tilt servo endpoint diagram (`Q_TILT_YAW_ANGLE`, `Q_TILT_FIX_ANGLE`) | Aircraft ▸ Tilt-Rotor | Rejected. Its parameters are not in this manual, and the manual has its own motor SVG. |
| 32 | ArduPilot wiki `gps-mast.jpg` | Folding GPS mast, retail-style shot with Photoshop metadata | Aircraft ▸ GPS & Compass | Rejected. Its provenance is unclear, and the actual GPS-mast unit is not known. |
| 33 | ArduPilot wiki `GPS_sampleMoutning.jpg`, `GPS_TopAndSide.jpg` | 3DR GPS on a 3DR copter | — | Rejected. It is different hardware. |
| 34 | Commons `FrSky X9D Taranis plus …jpg` (CC BY-SA 3.0), `TBS Tango II.jpg` (CC BY 4.0) | Other brands' radios | Overview (EdgeTX radio as USB joystick) | Rejected. They are not RadioMaster, and the reader gains nothing. |
| 35 | Commons `"Wing GCS" Portable Ground Control Station …jpg` (CC BY-SA 4.0) | Commercial GCS case | — | Rejected. It is not this ground station (Windows laptop plus EdgeTX radio). |
| 36 | Commons and Openverse "portable antenna mast", "antenna tripod" | Broadcast and amateur-radio masts | RF & Comms ▸ backup link (HM30 mast) | Rejected. No portable UAV/FPV mast was found. The mast stays shot-list item 9. |
| 37 | Unsplash "fpv drone" | Camera drones, people; 5 of 20 are Unsplash+ (not free) | — | None suitable. |
| 38 | Pexels "fpv drone" | Camera drones; FPV shots show people (faces) | — | None suitable. |

### 7.2 Accepted set — full licence data (R1)

#### A1 — `img/rep_fpv_quad.jpg` / `.webp` (representative)

| Field | Value |
|---|---|
| Shows | An analog FPV quadcopter from above and behind: Foxeer lollipop (circular-polarised) VTX antenna and a receiver antenna tube at the rear, GPS module, small FPV camera at the front, action camera in a blue mount. **Not** a client drone of this system. |
| Source page | https://commons.wikimedia.org/wiki/File:Dron-fpv.jpg |
| File URL | https://upload.wikimedia.org/wikipedia/commons/c/ce/Dron-fpv.jpg (4000 × 3000, 2 332 830 B, sha256 `86c13739…de7e5b`) |
| Author | Euflipo (own work, 8 November 2018) |
| Licence | CC BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/ ("I, the copyright holder of this work, hereby publish it under the following license") |
| Changes | Resized to 1600 × 1200 and re-encoded. Metadata stripped: **the original EXIF had a GPS position**, as the Commons page also shows. No crop and no edit. |
| Checked | 2026-10-18 (Commons API extmetadata and WebFetch of the file page) |

#### A2 — `img/rep_pitot_tube.jpg` / `.webp` (representative)

| Field | Value |
|---|---|
| Shows | A bare pitot-static tube on white. ArduPilot's own arrows and labels mark the "Dynamic Pressure Inlet" (tip) and the "Static Pressure Inlet" (side hole). **Not** this aircraft's pitot. The labels are original, not added by us. |
| Source page | https://ardupilot.org/plane/docs/common-pitot-considerations.html ("Pitot Tube Considerations"; the image follows "Usually, these ports are placed on a single pitot tube.") |
| File URL | https://ardupilot.org/plane/_images/pitot.jpg (2284 × 1200, 272 884 B, sha256 `e24dcea0…2c6b`; identical to `ArduPilot/ardupilot_wiki` `images/pitot.jpg`, added 2023-01-19 by Henry Wurzburg in "Add pitot tube page") |
| Author | ArduPilot Dev Team (ArduPilot wiki contributors) |
| Licence | CC BY-SA 3.0 — https://creativecommons.org/licenses/by-sa/3.0/. The page footer reads "© Copyright 2024, ArduPilot Dev Team." with a CC BY-SA 3.0 badge. The repository LICENSE reads "CC3.0 BY SA (Attribution-ShareAlike 3.0 Unported)". The page has no third-party credit. |
| Changes | Resized to 1600 × 841 and re-encoded, metadata stripped. No crop and no edit. |
| Checked | 2026-10-18 (WebFetch of the page, GitHub commit history, repository LICENSE) |

#### A3 — `matekf405-std.png` (REJECTED by the PM, Q1 = no; not in the repository; data kept as research record)

| Field | Value |
|---|---|
| Shows | Matek F405-STD flight controller, top view (STM32F405, silk-screened pad labels). This is the model of reference client #1's FC; the client uses a clone of this board. |
| Source page | https://ardupilot.org/plane/docs/common-matekf405.html ("Mateksys F405-STD and variants") |
| File URL | https://ardupilot.org/plane/_images/matekf405-std.png (723 × 555 PNG, 449 084 B, sha256 `d0db0490…3d52a`; wiki repository `images/matekf405-std.png`, added 2018-11-18 by vierfuffzig) |
| Author | Matek Systems (mateksys.com). The page states verbatim: "the above images and some content courtesy of mateksys.com" (linking http://www.mateksys.com/?portfolio=f405-std). |
| Licence | CC BY-SA 3.0, the wiki-wide licence — https://creativecommons.org/licenses/by-sa/3.0/. The wiki editing guide says: "All content on this wiki is licensed under the terms of the Creative Commons Attribution-ShareAlike 3.0 Unported." and asks contributors who use others' images to "seek permission for reuse". |
| Caveat | Matek's own site states no licence. The CC BY-SA grant rests on the ArduPilot wiki's licence plus the "courtesy" note, not on a statement by Matek. See Q1. |
| Changes | PNG converted to JPEG and WebP (same 723 × 555), metadata stripped. No crop and no edit. |
| Checked | 2026-10-18 (WebFetch of the page and of the wiki editing guide, page source `.rst`, repository LICENSE) |

### 7.3 Staged files (`S\wp22\staging\`) and clean check

Command: `venv\Scripts\python.exe -I tools\optimize-images.py staging\rep_fpv_quad.jpg staging\rep_pitot_tube.jpg staging\matek_f405.png`. The PNG source was then deleted. Clean check: the README one-liner on each file.

| File | Pixels | Bytes | Clean check (`format, size, EXIF tags, info keys`) | sha256 |
|---|---|---|---|---|
| `rep_fpv_quad.jpg` | 1600 × 1200 | 134 101 | `JPEG (1600, 1200) 0 [jfif…, progressive]` | `88440b20…14c65` |
| `rep_fpv_quad.webp` | 1600 × 1200 | 53 794 | `WEBP (1600, 1200) 0 [background, loop]` | `01fd0838…43f3b` |
| `rep_pitot_tube.jpg` | 1600 × 841 | 53 593 | `JPEG (1600, 841) 0 [jfif…, progressive]` | `23f5fc7a…22b1b` |
| `rep_pitot_tube.webp` | 1600 × 841 | 25 068 | `WEBP (1600, 841) 0 [background, loop]` | `1688d877…e2902` |
| `matek_f405.jpg` | 723 × 555 | 83 949 | `JPEG (723, 555) 0 [jfif…, progressive]` | `07a551b2…2eb0` |
| `matek_f405.webp` | 723 × 555 | 60 956 | `WEBP (723, 555) 0 [background, loop]` | `dd844414…a134` |

All files are ≤ 200 KB and ≤ 1600 px, with 0 EXIF tags and no `exif`, `icc_profile`, `xmp` or `comment` key. All are well under the 250 KiB `check-images` budget.

Folders: `downloads\` (untrusted: originals in `downloads\originals\`, other candidates, previews in `downloads\preview\`); `tools\` (scripts: `commons_search.py`, `openverse_search.py`, `contact_sheet.py`, the optimiser copy); `research\` (search logs, contact sheets, wiki tree); `venv\` (throw-away, Pillow 13.0.0).

## Round 2 — rework after verification round 1 (REJECTED: MAJOR-1, MINOR-1 to MINOR-3)

### MAJOR-1: attribution links unreadable → fixed

**Cause.** Neither `manual.html` nor `css/base.css` styles `a`. The caption credit links and the Image Credits table links therefore used the UA default blue: `#0000EE` on `#222` is 1.69:1.

**Fix.**
- `manual.html:71` adds `.man-photo figcaption a,#image-credits-table a{color:var(--accent);}`. It follows the existing `.pr-table a{color:var(--accent);}` and uses no hex, so `check-colours` stays green.
- The credits table gets an id, `<table id="image-credits-table">` (`manual.html:1358`), so the rule targets only that table and not the glossary tables of the same tab.
- The links keep the UA underline, so they do not rely on colour alone.
- The rule also applies to visited links: an author `a{color}` rule overrides the UA `:visited` colour.

**Contrast**, computed from the `css/base.css` token values with WCAG 2.x relative luminance. `--accent` is `#f97316` in both themes, because `:root[data-sun]` does not override it.

| Theme | Where | Background | Ratio |
|---|---|---|---|
| Normal | Caption (`.man-photo`) | `--surface2` `#222` | **5.68:1** |
| Normal | Credits table (page) | `--bg` `#0f0f0f` | **6.84:1** |
| Sunlight (`data-sun`) | Caption | `--surface2` `#111` | **6.74:1** |
| Sunlight (`data-sun`) | Credits table | `--bg` `#000` | **7.49:1** |
| Before the fix | Caption | `#222` | 1.69:1 (UA `#0000EE`) |

All four are ≥ 4.5:1 (WCAG AA for normal text).

**Rendered check, headless Chrome**, on a throw-away copy of the branch with a probe script injected; the repository is not changed:
- `getComputedStyle` reports `rgb(249, 115, 22)` for all 10 attribution links: 6 in captions, 4 in the table.
- The nearest backgrounds are `rgb(34, 34, 34)` (caption, normal), `rgb(15, 15, 15)` (table, normal), `rgb(17, 17, 17)` (caption, sunlight) and `rgb(0, 0, 0)` (table, sunlight). These match the table above.
- Screenshots in `S\wp22\shots\`: `r2_credits_normal.png`, `r2_credits_sun.png`, `r2_clients_sun.png`, `r2_clients_sun_caption.png` and `clients.png` (normal theme).

**Test** (`test/manual/manual.test.js:226`), "image credits: attribution links are legible — token colour, contrast ≥ 4.5:1 in normal and sunlight mode". It:
- finds a `<style>` rule whose selector list contains both `.man-photo figcaption a` and `#image-credits-table a` with `color:var(--token)`;
- reads the token values from `css/base.css` (`:root`, plus the `:root[data-sun]` overrides);
- asserts contrast ≥ 4.5:1 against `--surface2` (captions) and `--bg` (table) in both themes.

### MINOR-1: test gaps → closed

The test at `test/manual/manual.test.js:199` now also checks two things.
- **Credits table coverage.** The manual's Image Credits table must have a row for **every** photo the manual uses, vendor images included. Each row names its files in `data-img`: `rep_fpv_quad`, `rep_pitot_tube`, `matek_f405`, `t2_vtol t2_vtol2`, `siyi_hm30`.
- **Author and licence.** For each `rep_*` image, the **author** and **licence** recorded in the image's `img/README.md` row must appear in both its caption credit span and its credits-table row. The `#abbrev/image-credits` link must also be in the caption credit.

**Mutations** (`S\wp22\tools\mutate.mjs`, run on a throw-away copy `S\wp22\mut\`; each file is restored after its run):

| Mutation | Result |
|---|---|
| Manual credits row Matek removed | caught (image credits: every photo has a credits row …) |
| Manual credits row Heewing removed | caught (same test) |
| Manual credits row SIYI removed | caught (same test) |
| Manual credits row FPV removed | caught (same test) |
| FPV caption author "Euflipo" removed, licence kept | caught (same test) |
| Pitot caption author "ArduPilot Dev Team" removed | caught (same test) |
| FPV credits-row author removed | caught (same test) |
| FPV caption licence removed | caught (same test) |
| Link colour rule removed | caught (attribution links are legible …) |
| Link colour rule without the table selector | caught (same test) |
| Link colour set to a dark token (`--dim`) | caught (same test) |
| README row `rep_pitot_tube` removed | caught (every photo has a credits row …) |

After the mutation run, the unmutated copy passes 17 of 17 tests in `test/manual/manual.test.js`.

### MINOR-2: check-images count → corrected

§4 now says **39** images (the branch); the base `be7b8f0` has 35. My round-1 figure came from a run before the new files were tracked.

### MINOR-3: Phase A record → now in the repository

§7 above copies the full 38-candidate table, the licence data of the accepted (and the PM-rejected) images, the staged-file clean-check table and the full sha256 of the originals and of the committed files.

### Round 2 checks (all passing)

```
VTOL_JSDOM=<S>/jsenv/node_modules/jsdom node --test test/   → tests 312, pass 312, fail 0, skipped 0
node scripts/gen-precache.mjs --check        → sw-precache.js up to date (59 assets)   (hash regenerated: manual.html changed)
node scripts/diagrams/build.js --check       → diagrams up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-params-reference.mjs --check → data/params-reference.js up to date (1663 parameters)
node scripts/check-links.mjs                 → every internal link and asset resolves
node scripts/check-images.mjs                → 39 images within budget (largest img/t2_vtol.jpg 199.0 KiB)
node scripts/check-colours.mjs               → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors, 169 warnings (same as base); manual.html alone clean
```

### Note, not in scope

The pre-existing `Tools` link in *Client Drones ▸ Client Profiles* ("edit in Tools → PROFILES") also renders in the UA link blue. It predates WP22 and is not an attribution link, so I left it for the PM to decide.
