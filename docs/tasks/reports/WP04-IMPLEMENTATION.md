# WP04 — Implementation report (images and repository hygiene)

Branch `wp/04`. Commits: `3721cd4` (images + optimiser + README + SVG), `2d68789` (PowerShell scripts), `e3a6302` (.gitignore / untrack), `d5e55fb` (archive banner), plus this report.

## 1. Summary

- New `scripts/optimize-images.py` (Pillow): strips all metadata, resizes to ≤ 1600 px, writes the JPEG under the same name plus a `.webp` sibling, aims for ≤ 200 KB (lowers quality, then steps the long edge down if needed), prints a before/after table, and skips files that are already clean.
- Ran it on `t2_vtol.jpg`, `t2_vtol2.jpg`, `matek_f405.jpg` and `siyi_hm30.jpg`. All are now real, metadata-free JPEGs and each has a `.webp`. `t2_vtol.jpg` went from 3.6 MB to 199 KB.
- `siyi_hm30.jpg` (a PNG in RGBA) is now a real JPEG, flattened onto white.
- Deleted `img/fpv_drone.jpg`. Added `img/client_drone.svg`, a neutral top-down quad drawing (1.9 KB).
- Added `img/README.md` with the image rules, how to run the optimiser, a credits/licence table and the owner's photo shot list.
- Rewrote `scripts/watch-push.ps1` (REP-01) and fixed `scripts/git-setup.ps1` (REP-02). Extended `.gitignore` and untracked `.claude/settings.local.json` (REP-04).
- Archive manual: added `noindex` and a fixed red OBSOLETE banner (REP-06).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `scripts/optimize-images.py:74-98` (metadata check / idempotence), `:100-133` (sRGB conversion, flatten, resize, metadata-free rebuild), `:136-164` (quality and size loop), `:211+` (table) | Drops EXIF/GPS, XMP, ICC (a non-sRGB profile is converted to sRGB first), comments, IPTC and Photoshop blocks. Writes the JPEG under the same filename plus `.webp`. A second run prints `skipped (clean)` for every file. |
| R2 | DONE | `img/t2_vtol.jpg`, `img/t2_vtol2.jpg`, `img/matek_f405.jpg` + `.webp` | Pillow check: 0 EXIF tags, no GPS IFD, no `exif`/`icc_profile`/`xmp`/`comment` keys, and a raw byte scan finds no `Exif`/`ICC_PROFILE`/`XMP`/`GPS`/`CREATOR` markers. Sizes are in §4. |
| R3 | DONE | `img/siyi_hm30.jpg` (JPEG RGB 640×640, 23 KB), `img/siyi_hm30.webp` (11 KB) | Flattened onto **white**: all 409,600 alpha values are 255 and the artwork has its own white backdrop, so the flatten colour changes nothing visible. White also keeps any future semi-transparent edge consistent with that backdrop. `#1a1a1a` would only add a dark fringe. The `--bg` option exists for other images. |
| R4 | DONE | `img/fpv_drone.jpg` deleted (`git rm`); `img/client_drone.svg` (1,934 bytes) | Accent lines `#f97316` on a transparent background, labels `#e8e8e8` and muted `#666666`. It has `<title>`, `<desc>`, `role="img"` and `aria-labelledby`, and parses as well-formed XML. A comment explains that hex values are used because a standalone SVG cannot read page variables. **WP06 must replace the two `img/fpv_drone.jpg` references in `manual.html` (lines 246 and 1097).** Until then the existing `onerror` hides those figures. |
| R5 | DONE | `img/README.md` (rules at the top, `## Optimiser` :14, `## Credits and licences` :35, `## Photo shot list (owner)` :47) | All four remaining photos are marked "Vendor marketing image — replace with own photo". The shot list covers top and side views with the relay PCB, HM30 antennas, VRX patches (inward), ELRS antenna, GPS, pitot, 915 RX and M1/M2/M4, plus the ground station/mast and the relay PCB connectors. |
| R6 | DONE | `scripts/watch-push.ps1:4-21` (header), `:24` (repo root), `:35-37` (include/exclude/deny), `:50-58` (timer, one recursive watcher), `:61-84` (handler filters and restarts the timer), `:108-114` (`git add -- $stage`, commit only those paths), `:146` (main loop waits on the timer event) | No `git add .`. Deny patterns are checked in the handler and again before staging. Paths that git ignores are skipped. A deleted tracked file stages its removal, and renames are handled. Files the user staged by hand are not swept into the auto-commit. Only Windows PowerShell 5.1 constructs are used. |
| R7 | DONE | `scripts/git-setup.ps1:2-8` (marked one-time), `:11-12` (user/repo variables kept), `:17` (repo root), `:42-74` (append missing lines only), `:88-99` (initial upload only if there are no commits) | The append list is the full current `.gitignore` set. A re-run reports ".gitignore already complete". |
| R8 | DONE | `.gitignore:10-19`; `git ls-files .claude` → empty; `git check-ignore -v .claude/settings.local.json` → `.gitignore:11` | Existing entries kept. The file is still on disk. |
| R9 | DONE | `archive/VTOL_Relay_Carrier_Operating_Manual.html:6` (`noindex`), `:629-632` (banner CSS; style block ends :633), `:636-637` (banner + spacer) | Fixed banner: `position: fixed`, `z-index: 1000` (above the old emergency modal at 999), `var(--red)`. It carries the exact required text and a link to `../manual.html`. A hidden in-flow copy (`visibility:hidden`, `aria-hidden`) reserves the banner's height at any width, so no JS is needed and the header is never covered. No other content changed. |

## 3. Placeholders

None. No `TBD` was needed. The README credits table says "source URL and licence not recorded" for the vendor images, because that information is not in the repo.

## 4. Tests

**Optimiser run** (`S\venv\Scripts\python.exe scripts/optimize-images.py img/t2_vtol.jpg img/t2_vtol2.jpg img/matek_f405.jpg img/siyi_hm30.jpg`):

```
file                       before   before px     after px      jpg     webp  status
t2_vtol.jpg              3,678 KB   5184x2684     1280x662   199 KB   192 KB  optimised
t2_vtol2.jpg                66 KB   1120x1400    1120x1400    71 KB    37 KB  optimised
matek_f405.jpg             123 KB    1500x600     1500x600   114 KB    82 KB  optimised
siyi_hm30.jpg              102 KB     640x640      640x640    23 KB    11 KB  optimised
```

A second run with no arguments printed `skipped (clean)` for all four files.

**Metadata check** (Pillow `getexif()`, GPS IFD `0x8825`, `im.info` keys, raw byte scan). All 8 files have 0 EXIF tags, no GPS, and no metadata keys or markers:

| File | Format | Pixels | Bytes |
|---|---|---|---|
| t2_vtol.jpg / .webp | JPEG / WEBP | 1280×662 | 203,783 / 196,650 |
| t2_vtol2.jpg / .webp | JPEG / WEBP | 1120×1400 | 72,498 / 37,506 |
| matek_f405.jpg / .webp | JPEG / WEBP | 1500×600 | 116,896 / 84,116 |
| siyi_hm30.jpg / .webp | JPEG / WEBP | 640×640 | 23,684 / 11,006 |
| client_drone.svg | SVG | 400×400 viewBox | 1,934 |

**PowerShell parse** (`[System.Management.Automation.Language.Parser]::ParseFile`): `watch-push.ps1` 0 errors, `git-setup.ps1` 0 errors.

**watch-push functional test** (temporary repo with a local bare remote, script run in the background, then killed):
- Edits to `index.html` (twice within the debounce window) and to the nested `docs/sub/note.md` produced **one** commit containing only those two files, and it was pushed.
- `my_secret.md` and `mytoken.json` were refused ("Refusing to stage … (matches deny list)"). `node_modules/a.js`, `gcs/build/a.js`, `notes.txt`, `token.txt` and a git-ignored `debug.log` were not staged.
- Second round: a file staged by hand (`notes.txt`) stayed staged and was not committed. A delete plus a rename was committed correctly.

**git-setup functional test** (temporary repo, `.gitignore` with a BOM and a custom line): the custom line was kept and only the 15 missing lines were appended. A re-run reported "already complete". The initial upload was skipped because the repo already had commits.

**SVG and banner render**: checked visually in headless Edge (SVG on dark and white backgrounds, archive page at narrow width).

## 5. Deviations / contract issues

- **Size step-down:** at 1600 px, `t2_vtol.jpg` (fine asphalt texture) is still 239 KB at JPEG q58. Rather than crush the quality further, the optimiser steps the long edge down (1440 → 1280 → 1152 → 1024 px). This image ended at 1280×662, q≈74. Both outputs of an image always share one pixel size; the skip check relies on this.
- **`t2_vtol2.jpg` grew** from 66 to 71 KB. The re-encode is needed to strip the EXIF and ICC data, and the result is still far under the target.
- **`git-setup.ps1` initial commit:** the script still uses `git add .`, but now only for the very first commit of a brand-new repo (after the full `.gitignore` is written). On an existing repo it skips commit and push. This goes slightly beyond R7 but stays in the spirit of REP-01/02.
- **Privacy:** `fpv_drone.jpg` (with its EXIF GPS block) and the original full-size images **remain in git history**. Purging them needs a history rewrite and a force-push on `main`, which is outside WP04 and an owner decision.
- Scripts are kept ASCII-only, because Windows PowerShell 5.1 misreads UTF-8 without a BOM. `git-setup.ps1` previously had an em dash.

## 6. Notes for the verifier

- Metadata: `S\venv\Scripts\python.exe -c "from PIL import Image; import glob; [print(f, Image.open(f).format, len(Image.open(f).getexif()), sorted(Image.open(f).info)) for f in glob.glob('img/*.jpg')+glob.glob('img/*.webp')]"`
- Idempotence: run `S\venv\Scripts\python.exe scripts/optimize-images.py`. Every row should say `skipped (clean)` and `git status` should stay clean.
- SVG: open `img/client_drone.svg` in a browser.
- Archive: open `archive/VTOL_Relay_Carrier_Operating_Manual.html`. The red banner stays fixed while scrolling and links to `../manual.html`.
- Untracked: `git ls-files .claude` is empty, and the file still exists on disk.
- watch-push: logic is in `scripts/watch-push.ps1:62-120`. To try it, copy it into a scratch repo's `scripts/` folder (with a local bare remote) and edit files.
- `index.html`, `manual.html` and `relay/*` are untouched. `manual.html` still references `img/fpv_drone.jpg` (WP06).
