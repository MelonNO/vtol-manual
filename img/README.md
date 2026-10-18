# img/ — images for the manual and Flight Tools

## Rules

| Rule | Detail |
|---|---|
| Size | Max **1600 px** on the long edge. Target **≤ 200 KB** per file. |
| Format | Photos: **JPEG** (fallback, the name the pages reference) **plus a `.webp` sibling** with the same base name. Line art: **SVG** (≤ 10 KB, `<title>` and `<desc>`, project palette hex values). Never give a PNG a `.jpg` name. |
| Metadata | **Strip all metadata** (EXIF incl. GPS position and camera serial, XMP, ICC, comments) before committing. The optimiser below does this. |
| Alt text | Must describe **this** aircraft / **this** setup, e.g. "Heewing T2 Cruza relay carrier, top view, relay PCB bay open" — not a generic product name. **Exception — representative images:** an openly licensed photo of *similar* equipment, used only where it genuinely helps the reader. Its alt text must start "Representative image, not …" (this aircraft / a client drone of this system / this setup) and describe what is actually shown; its caption must start "Representative image:" and say the same. Never add annotations to someone else's photo; a CC BY-SA image changed beyond resizing / re-encoding must be marked "modified". |
| Source | **Own photos**, or images whose licence is recorded in the credits table below. Accepted licences: public domain, CC0, CC BY, CC BY-SA (any version), the Unsplash or Pexels licence, or a vendor page that **explicitly** grants reuse (quote the grant and its URL). Not accepted: NC / ND licences, "found on the web", vendor images without a stated licence, watermarked stock, images showing faces, number plates or house numbers. CC BY / CC BY-SA need visible attribution: a credit line in the figure caption **and** a row in the manual's *Reference ▾ Abbreviations → Image Credits* (`manual.html#abbrev/image-credits`). Vendor marketing images without a licence are temporary and must be replaced. |
| Pages | Give `<img>` explicit `width`/`height`, `loading="lazy"`, and serve the `.webp` via `<picture>` with the `.jpg` as fallback. Add new images to the precache with `node scripts/gen-precache.mjs` (writes `sw-precache.js`). |

## Diagrams — `img/diagrams/`

The manual's diagrams D1–D15 (plus D8b) are standalone SVG files, `d01-system-overview.svg` … `d15-video-field-timing.svg`. Plan §9.3 lists what each one shows.

**How they are made**

- They are **generated** by `scripts/diagrams/` with plain Node and no npm packages. Edit the definition in `scripts/diagrams/d*.js`, then run `node scripts/diagrams/build.js`.
- The same run updates the diagram slots in `manual.html` (image, size, alt text, caption) and the four inline SVGs of the manual.
- `node scripts/diagrams/build.js --check` (also run by `node --test test/`) fails when a committed file differs from the generator output.
- Do not hand-edit a generated file without changing the generator too. See `scripts/diagrams/README.md`.

**File rules** (tested in `test/diagrams/files.test.js`)

- `role="img"`, `<title>` and a full-text `<desc>`; a `<!-- Sources: … -->` comment naming the plan sections and relay-design tables used.
- **≤ 60 KB** per file. This is the limit for diagrams; the 10 KB rule above is for simple line art.
- No invented values: an unknown value is written as **TBD**, a value still to be confirmed as **VERIFY**.

**Palette**

A standalone SVG cannot read the page CSS variables. It therefore uses the same hex values as the `:root` tokens in `css/base.css` (`--muted` is the manual's own `#777`), and each file carries this mapping as a comment:

| Hex | Token | Hex | Token |
|---|---|---|---|
| `#0f0f0f` | `--bg` | `#e8e8e8` | `--text` |
| `#1a1a1a` | `--surface` | `#777777` | `--muted` |
| `#222222` | `--surface2` | `#f97316` | `--accent` |
| `#2a2a2a` | `--border` | `#facc15` | `--amber` |
| `#333333` | `--border2` | `#ef4444` | `--red` |
| `#444444` | `--dim` | `#22c55e` | `--green` |

Inline SVG and the generated charts (`js/diagrams.js`) use `var(--…)` instead and never hex.

**Readability rule (plan §9.2)**

Text must be **≥ 11 CSS px when the page is 360 px wide**. The manual's content is 332 px wide there (14 px padding each side) and a figure's image 330 px (its 1 px border each side); about 315 px when a desktop-style scrollbar takes 15 px. There are two ways to meet it:

- **Fit to width** (all `img/diagrams/` files): a viewBox 400 units wide with text ≥ 14 units gives 14 × 330 / 400 ≈ 11.55 px. Desktop caps the image at 560 px.
- **Scroll** (the manual's inline SVGs and the Tools charts): text ≥ 13 units (charts ≥ 12) plus a `min-width` class (`.mw-560`, `.mw-600`, `.mw-780`) inside an `overflow-x:auto` frame, with min-width ≥ viewBox width × 11 / smallest font.

## Optimiser

`scripts/optimize-images.py` (needs Python 3 and Pillow: `pip install Pillow`).

```
python scripts/optimize-images.py                 # every img/*.jpg, *.jpeg, *.png
python scripts/optimize-images.py img/new.jpg     # selected files
python scripts/optimize-images.py --bg 1a1a1a img/logo.png   # flatten transparency onto a colour
python scripts/optimize-images.py --force img/x.jpg          # re-encode a file that is already clean
```

It applies the EXIF rotation, strips all metadata (converts a non-sRGB ICC profile to sRGB first), flattens transparency (default white), resizes to ≤ 1600 px, and overwrites the JPEG **under the same name** plus writes a `.webp` sibling. It lowers quality until both files are ≤ 200 KB; if that is not enough it steps the long edge down (1440 → 1280 → 1152 → 1024 px). It prints a before/after table. Running it again skips files that are already clean (no generation loss). A `.png` input becomes `<name>.jpg` + `<name>.webp`; delete the PNG yourself.

Check that a file is clean:

```
python -c "from PIL import Image; im=Image.open('img/x.jpg'); print(im.format, im.size, len(im.getexif()), sorted(im.info))"
```

`0` EXIF tags and no `exif` / `icc_profile` / `xmp` / `comment` key means clean.

## Credits and licences

One row per file. Licence checks are dated; re-check a source if its row is old.

| File | Content | Author | Licence | Source page | File URL | Checked | Status |
|---|---|---|---|---|---|---|---|
| `t2_vtol.jpg` / `.webp` | Heewing T2 Cruza with transport box, "T2 Cruza VTOL PNP" text | Heewing, vendor marketing image | Not recorded. Heewing's terms forbid reproduction without written permission: section 2 of https://www.heewing.com/policies/terms-of-service reads "You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service … without express written permission" | Not recorded | Not recorded | 2026-10-18 (terms) | **Vendor marketing image — replace with own photo** |
| `t2_vtol2.jpg` / `.webp` | Heewing T2 render on white | Heewing, vendor marketing image | Not recorded. Heewing's terms forbid reproduction without written permission (same terms page and quote as `t2_vtol.jpg`) | Not recorded | Not recorded | 2026-10-18 (terms) | **Vendor marketing image — replace with own photo** |
| `matek_f405.jpg` / `.webp` | Matek F405 flight controller with spec text | Matek Systems, vendor marketing image | Not recorded | Not recorded | Not recorded | — | **Vendor marketing image — replace with own photo** (reference client #1 only) |
| `siyi_hm30.jpg` / `.webp` | SIYI HM30 ground and air units, SIYI logo | SIYI, vendor marketing image | Not recorded. SIYI marks its site "All Rights Reserved": the footer of https://www.siyi.biz/en/ reads "Copyright @ 2017-2026 SIYI Technology All Rights Reserved." | Not recorded | Not recorded | 2026-10-18 (footer) | **Vendor marketing image — replace with own photo** (of your mast setup) |
| `rep_fpv_quad.jpg` / `.webp` | **Representative image:** analog FPV quad (lollipop VTX antenna, receiver antenna, GPS module, FPV camera, action camera) — not a client drone of this system. Used in Client Drones. | Euflipo (own work, 2018-11-08) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | https://commons.wikimedia.org/wiki/File:Dron-fpv.jpg | https://upload.wikimedia.org/wikipedia/commons/c/ce/Dron-fpv.jpg | 2026-10-18 | Resized to 1600 px and re-encoded, metadata stripped (the original's EXIF held a GPS position); no other change. Replace with own photo (shot list 13). |
| `rep_pitot_tube.jpg` / `.webp` | **Representative image:** bare pitot-static tube; arrows and labels "Dynamic Pressure Inlet" / "Static Pressure Inlet" are ArduPilot's own — not this aircraft's pitot. Used in Maintenance. | ArduPilot Dev Team (ArduPilot wiki) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (wiki licence; the page has no third-party credit) | https://ardupilot.org/plane/docs/common-pitot-considerations.html | https://ardupilot.org/plane/_images/pitot.jpg | 2026-10-18 | Resized to 1600 px and re-encoded, metadata stripped; no other change. Replace with own photo (shot list 6). |
| `client_drone.svg` | Generic quad, top view, line drawing | Drawn for this project | Same licence as the repository | — | — | — | Keep (neutral placeholder for any client drone) |

**Removed: `fpv_drone.jpg`.** It showed a different aircraft (a Minion 220 racing multirotor by RotorGeeks), not a client of this system. It was removed from the site in WP04 (commit `3721cd4`) and is kept in git history by owner decision (2026-10-18). Its EXIF GPS block was empty: it never carried a GPS position. Attribution for the copy in git history: Wikimedia Commons file "File:Racing Drone.jpg", author **Commanderbryce** (own work, uploaded 2016-03-14), licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), https://commons.wikimedia.org/wiki/File:Racing_Drone.jpg (checked 2026-10-18 through the Commons API).

## Photo shot list (owner)

Shoot on a plain, uncluttered background, even light, no people, no number plates or house numbers in frame. Turn off location tagging on the camera/phone (the optimiser strips it anyway). Then annotate (labels/arrows) in an editor and run the optimiser.

Items marked *(representative image in the manual)* currently show an openly licensed photo of **similar** equipment (see the credits table); the owner's own photo should replace it. Items 1, 3, 4, 7 and 9–12 are specific to this build and have no substitute.

**Heewing T2 Cruza relay carrier — annotated top view and side view**, showing and labelling:

1. Relay PCB (video board + Net/RC board) in its bay, cover open
2. SIYI HM30 air-unit antennas (position and orientation)
3. VRX patch antennas — show that they point **inward**
4. ELRS TX module and its antenna (Nomad or DBR4)
5. GPS / compass module
6. Pitot tube *(representative image in the manual: `rep_pitot_tube.jpg`, Maintenance — replace with own photo)*
7. 915 MHz backup RX and antenna
8. Motors M1 / M2 (tilt) and M4 (tail lift)

**Ground station**

9. Mast with the HM30 ground unit, antennas and cabling
10. Whole ground station: Windows laptop, EdgeTX radio (USB joystick), power

**Relay PCB close-ups**

11. Video board connectors (CVBS in, power, Ethernet to the switch)
12. Net/RC board connectors (switch ports P1–P5, ELRS TX/CRSF, IP camera, power), with port labels readable

**Per client drone profile (optional)**

13. Each client drone, top view, with its VTX antenna visible *(representative image in the manual: `rep_fpv_quad.jpg`, Client Drones — replace with own photo)*
