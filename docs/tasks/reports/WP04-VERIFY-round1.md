# WP04 verification — round 1
VERDICT: APPROVED

Worktree `S\wt\WP04`, branch `wp/04`, HEAD `a1d9b23`, base `main` (`5bbe386`).

## Scope

`git diff main...HEAD --stat` gives 18 files. All of them are in the brief's "Files you own" list or are required by it:

| File | Owned / justified |
|---|---|
| `.claude/settings.local.json` (deleted from index) | R8 requires `git rm --cached`. The file is still on disk. |
| `.gitignore` | owned |
| `archive/VTOL_Relay_Carrier_Operating_Manual.html` | owned (banner + meta only: +7 lines, see R9) |
| `docs/tasks/reports/WP04-IMPLEMENTATION.md` | owned |
| `img/README.md`, `img/client_drone.svg` (new) | owned |
| `img/fpv_drone.jpg` (deleted) | R4 |
| `img/{t2_vtol,t2_vtol2,matek_f405,siyi_hm30}.jpg` + 4 new `.webp` | owned |
| `scripts/watch-push.ps1`, `scripts/git-setup.ps1`, `scripts/optimize-images.py` (new) | owned |

`index.html`, `manual.html`, `relay/*` and `sw.js` are untouched. The working tree is clean.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `scripts/optimize-images.py:115-133` (exif_transpose, sRGB conversion, flatten, resize to ≤1600, rebuild from raw pixels with `info={}`); `:136-164` (quality loop, then edge step-down, target 200 KiB); `:167-171` (atomic write, same filename for `.jpg`, `.webp` sibling at `:177`); `:81-97` (idempotence check); `:227-232` (before/after table) | I ran it on copies of the **main** originals, including `fpv_drone.jpg` with its GPS IFD. All outputs had 0 EXIF and no GPS, ICC, XMP or COM. The outputs are **byte-identical** to the committed files. A second run printed `skipped (clean)` for every file and left all md5 sums unchanged. |
| R2 | PASS | My own Pillow + raw-segment check (script `verify\WP04\imgcheck.py`) | All 8 raster files have `getexif()` = 0 tags and an empty GPS IFD (0x8825). `info` holds only jfif/progressive keys (JPEG) or background/loop (WebP). The JPEG APP segments are only APP0 (JFIF), DQT, SOF2, DHT. The WebP files contain only a `VP8 ` chunk (no EXIF/XMP/ICCP). The raw byte scan found no `Exif`/`ICC_PROFILE`/`XMP`/`GPS`/`8BIM`/`CREATOR` markers. The sizes match the report (table below). |
| R3 | PASS | `img/siyi_hm30.jpg`: JPEG RGB 640x640, 23,684 B; `.webp` 11,006 B | The main original is a PNG in RGBA. I checked that alpha extrema = (255,255) and the corner pixels are white, so flattening onto white is visually lossless and the choice is explained correctly (report §2 R3). |
| R4 | PASS | `img/fpv_drone.jpg` is gone from HEAD's tree; `img/client_drone.svg` is 1,934 B | The SVG is well-formed (ElementTree parse OK). It has `<title>` and `<desc>` plus `role="img"`/`aria-labelledby`. The drawing uses `#f97316` strokes with no background rect (transparent) and `#e8e8e8` and `#666666` labels, which match `--text`/`--muted` in `index.html:11`. A comment explains why hex values are used. The report notes that WP06 must replace `manual.html:246` and `:1097`. I confirmed both lines, and the existing `onerror` hides those figures. `sw.js` does not precache images, so the deletion cannot break SW install. |
| R5 | PASS | `img/README.md:3-12` rules (size, format, EXIF, alt text, own photos only), `:14-33` optimiser usage, `:35-45` credits table, `:47-74` shot list | All 4 vendor images are marked "Vendor marketing image — replace with own photo". The shot list covers everything the brief asks for: top/side views with relay PCB, HM30 antennas, VRX patches (inward), ELRS antenna, GPS, pitot, 915 RX, mast/ground station, relay PCB connectors. It invents no numbers. |
| R6 | PASS | `scripts/watch-push.ps1:4-6` (deliberate commits preferred), `:24` (repo root = parent of `scripts\`), `:35-37` (include list, exclude regex, deny list), `:55-59` (one recursive watcher, Filter `*`), `:62-84` (filtering in the handler, timer restart, no sleep, no git), `:49-53,141,146` (one-shot `System.Timers.Timer` debounce, Elapsed queued and handled by the main loop), `:98-108` (re-check deny list, ignore-check, `git add -- $stage`), `:114` (`git commit -- $stage`) | No `git add .` anywhere. The script is ASCII-only, and the PS 5.1 parser reports 0 errors. **Functional test** (my own run in a scratch repo with a bare remote, Windows PowerShell 5.1.26100): two edits to `index.html` 1 s apart plus a nested `docs/deep/n.md` gave **one** commit with exactly those 2 files, which was pushed. `api_TOKEN.json` and `docs/secret-notes.md` were refused (case-insensitive). `node_modules/`, `gcs/build/`, `gcs/dist/`, `venv/`, `notes.txt`, `relay.env` and the git-ignored `debug.log` were not staged. In round 2, a hand-staged `manual.txt` stayed staged and was not committed, and a delete plus a rename were committed correctly. |
| R7 | PASS | `scripts/git-setup.ps1:2-7` (marked ONE-TIME), `:11-12` (variables kept), `:17` (repo root), `:42-74` (append missing lines only), `:87-99` | **Functional test**: I used a `.gitignore` with a BOM, a custom line and no trailing newline. The custom line was kept, a newline was inserted, the 14 missing lines were appended, and no second BOM was written. A re-run printed ".gitignore already complete". On a repo with commits, the initial upload was skipped. |
| R8 | PASS | `.gitignore:1-8` (original entries kept), `:10-19` (all 9 required entries) | `git ls-files .claude` is empty. `git check-ignore -v` → `.gitignore:11`. The file still exists on disk (211 B). |
| R9 | PASS | `archive/...html:6` `<meta name="robots" content="noindex">`; `:629-632` CSS; `:636` banner | jsdom: the banner is the first body child, with `role="alert"` and the exact required text. The link `../manual.html` resolves to `/vtol-manual/manual.html`. There are 0 script errors (also 0 on main). The banner uses `position:fixed; z-index:1000`. No sticky header exists that it could cover, and an in-flow hidden spacer reserves its height. The diff is +7 lines with no other content change. |

## Contract results

The brief references no contract in `02-CONTRACTS.md`, so N/A. Page references stay valid because the JPEG filenames are unchanged.

## Tests run (commands + results)

- `venv\Scripts\python.exe -I verify\WP04\imgcheck.py <wt>`: all images clean (see R2).
  | File | Format | px | Bytes |
  |---|---|---|---|
  | t2_vtol.jpg / .webp | JPEG / WEBP | 1280x662 | 203,783 / 196,650 |
  | t2_vtol2.jpg / .webp | JPEG / WEBP | 1120x1400 | 72,498 / 37,506 |
  | matek_f405.jpg / .webp | JPEG / WEBP | 1500x600 | 116,896 / 84,116 |
  | siyi_hm30.jpg / .webp | JPEG / WEBP | 640x640 | 23,684 / 11,006 |
  | client_drone.svg | SVG | 400x400 | 1,934 |
- Optimiser, run on main originals copied to `verify\WP04\opt\orig`: 5 rows `optimised`. The outputs are byte-identical to the committed files (`cmp`). A second run gave 5x `skipped (clean)`.
- Optimiser, run on copies of the committed images: 4x `skipped (clean)`, md5 unchanged.
- `[System.Management.Automation.Language.Parser]::ParseFile`: `watch-push.ps1` 0 errors, `git-setup.ps1` 0 errors. Both files have 0 non-ASCII bytes.
- watch-push and git-setup functional runs: see R6 and R7.
- `npx --prefix S/jsenv html-validate` on the archive: 63 errors on branch and 63 on main, the same rule set, so **no new errors**.
- No JS or Python unit tests are defined by this brief (no `test/` changes).

## Smoke tests

- jsdom (`runScripts:'dangerously'`) on `archive/VTOL_Relay_Carrier_Operating_Manual.html`: no uncaught errors. Found 2 `.obsolete-banner` elements (the visible one plus an `aria-hidden` spacer). Robots meta = `noindex`. The link href is correct.
- `client_drone.svg`: XML parse OK. I reviewed the geometry: the labels do not overlap the prop discs.

## Findings

1. **MINOR**, commit hygiene. `.claude/settings.local.json` was untracked in commit `3721cd4` ("Optimise images…"), while `e3a6302`'s message claims the untracking and only touches `.gitignore`. The end state is correct.
2. **MINOR**, `img/t2_vtol.jpg` is 203,783 B. That is ≤ 200 KiB, which the script's `TARGET_BYTES = 200*1024` uses, but just over 200,000 decimal bytes. Acceptable under "where quality allows". The report's "199 KB" is in KiB.
3. **MINOR**, `scripts/optimize-images.py:16-17`. The docstring says a file is skipped when "within the size limits", but `is_clean` (`:81-97`) deliberately does not check the byte size (see the comment at `:95`). The docstring should say "within the pixel limit".
4. **MINOR**, `scripts/watch-push.ps1:59`. The NotifyFilter has no `DirectoryName`, so a renamed or moved folder of tracked files is not picked up. This is an edge case and can be left for a deliberate commit.
5. **MINOR**, `scripts/git-setup.ps1:96`. `git add .` remains for the very first commit of a brand-new repo, after the full `.gitignore` is in place. It is documented in report §5. Acceptable.
6. **MINOR**, `scripts/git-setup.ps1:71`. `Add-Content` appends CRLF lines to an LF `.gitignore`, giving mixed line endings. Git handles this. Cosmetic.
7. **MINOR / info**, `archive/...html:630-631` hard-codes `#fff`. The archive has no white token, and the page already uses `#fff` on red in the same way (`:51`, `:133`). Consistent with the existing style.
8. **Info**: the original images, including the fpv GPS EXIF, remain in git history. Purging them is an owner decision and is documented in report §5 and `img/README.md:45`.

## Approval rationale

All MUST requirements R1–R9 pass on my own evidence: Pillow and raw-segment checks, a reproduction of the optimiser output from main, live functional runs of both PowerShell scripts under PS 5.1, jsdom and html-validate. Scope is clean and no pages were touched. The report's claims match reality: the sizes, the line references and the `fpv_drone.jpg` references at `manual.html:246/1097`. There are no BLOCKER or MAJOR findings. Only the MINOR items above remain, and they can be fixed opportunistically.
