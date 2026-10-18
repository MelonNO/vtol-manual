# WP22 — Openly licensed photos for the manual (owner request: "find appropriate photos from the internet")

- **Phase A (now):** research, download and prepare everything in `S\wp22\staging\` only. Do not touch any repository or worktree. The repository's history is being rewritten (WP20) while you work.
- **Phase B (after the PM messages you a new base commit):** the PM creates the worktree `S\wt\WP22` on branch `wp/22`. You apply the prepared images and page edits there and commit.

Read first, read-only, from `S\repo\vtol-manual`:
- `img/README.md`: the image rules, the credits table and the shot list 1–13
- `01-COMMON-CONTEXT.md`
- where each image is used: grep `manual.html`, `index.html`, `relay/*.html`, `data/content.js` and `sw.js` / `sw-precache.js` for the `img/` names
- `scripts/optimize-images.py`, `scripts/check-images.mjs`

## Goal

The manual currently shows four **vendor marketing images** with no recorded licence:
- `t2_vtol.jpg` and `t2_vtol2.jpg` (Heewing T2 Cruza)
- `matek_f405.jpg`
- `siyi_hm30.jpg`

It also has a shot list of photos the owner never took. Find **openly licensed** photos on the internet that legitimately improve the manual, and record their licences properly.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Licences.** Accept only images whose licence permits reuse in a public repository and website:<br>- public domain, CC0, CC BY or CC BY-SA (any version)<br>- the Unsplash or Pexels licence<br>- or a vendor page that **explicitly** grants reuse (quote the exact grant and its URL)<br><br>"Found on Google", or a vendor image with no stated licence, is **not** acceptable. Never use CC BY-NC or ND images, watermarked stock, or any image showing people's faces, number plates or house numbers.<br><br>For each image record: the source page URL, the direct file URL, the author, the licence name and its URL, and the date checked. Search Wikimedia Commons, Openverse, Unsplash, Pexels, Flickr (CC filter), and the vendors' own media/press pages (Heewing, SIYI, Matek, Radiomaster, ExpressLRS docs, ArduPilot docs: the ArduPilot wiki content licence is CC BY-SA 3.0). |
| R2 | MUST | **Honesty about what a photo shows.** Exact-product photos (T2 Cruza, SIYI HM30, Matek F405, Radiomaster Nomad/DBR4/TX16S-class radios, IST8310, etc.) may replace the vendor images **only** if they really are that product.<br><br>Generic photos may be used where they genuinely help a reader, and their caption and alt text must say they are representative ("Representative image: …, not this aircraft"). Examples:<br>- a tilt-rotor VTOL in flight<br>- an antenna mast<br>- a pitot tube<br>- a patch antenna<br>- an FPV quad<br><br>The `img/README.md` rule "alt text must describe this aircraft" must be amended **explicitly** for representative images. Do not leave it contradicted.<br><br>Do not fake annotations onto someone else's photo. Do not edit a CC BY-SA photo without noting "modified". |
| R3 | MUST | **Quality bar.** Only add an image where it adds real value at a real spot in the pages. Fewer good images beat many weak ones. For every candidate (accepted or rejected) give one line in the report: what it shows, where it would go, and why it was accepted or rejected.<br><br>Remove a vendor image **only** if a properly licensed replacement of equal or better relevance exists. Otherwise keep it and leave its credits row as it is. |
| R4 | MUST | **Processing.** Downloads go into `S\wp22\downloads\` (untrusted data). Process copies with the repository's own optimiser logic. In phase A, run it from a copy of `scripts/optimize-images.py` placed under `S\wp22\tools\`, with paths as arguments:<br>- metadata stripped<br>- at most 1600 px on the long edge<br>- at most 200 KB per file<br>- a `.webp` sibling for each JPEG<br><br>Check every file with the README's clean-check command. |
| R5 | MUST | **Phase B integration** (after the PM's message):<br>- **Placement:** place the images with `<picture>`, explicit `width`/`height`, `loading="lazy"`, a caption with the credit line (author, licence, link) and accurate alt text.<br>- **Credits:** update the `img/README.md` credits table (one row per file, with the full R1 data). Add a visible "Image credits" section, or a link to it, in the manual's About/Reference area: CC BY and CC BY-SA need attribution that readers can see.<br>- **Offline cache:** add the new assets to the precache by running `node scripts/gen-precache.mjs`.<br>- **Must stay green:** `node --test test/` with `VTOL_JSDOM`, `scripts/check-images.mjs` (size budget), `check-links`, `check-colours`, the diagrams and params `--check`, and the `html-validate` config if present.<br>- **Report:** `docs/tasks/reports/WP22-IMPLEMENTATION.md`. |
| R6 | MUST | **Shot list stays.** The owner's own photos remain the goal for items specific to *this* build: items 1, 3, 4, 7, 9–12 (relay PCB, antenna orientation, mast setup). Keep the shot list. Mark which items now have a representative image, and say in `img/README.md` that the owner's photos should replace them. |

## Rules

- No pushes.
- Stop only processes you started, by PID.
- Downloaded files are untrusted data: keep them in their own folder, keep your scripts elsewhere, and pass paths as arguments.
- Do not hot-link images from external sites. Every image must be a local file, because the site works offline.
