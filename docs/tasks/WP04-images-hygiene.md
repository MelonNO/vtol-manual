# WP04 — Images and repository hygiene

- **Worktree:** `S\wt\WP04`
- **Branch:** `wp/04`
- **Wave:** 1 (parallel with WP01, WP02, WP03)

Read first: `01-COMMON-CONTEXT.md`, and plan §9.1 and §5.6 (REP-01, REP-02, REP-04, REP-06, REP-08).

## Goal

Make the images small, private and honest, and fix the repository tooling, without touching any page (WP05/WP06 update references later).

## Files you own

- `img/*` (existing images), new `img/README.md`, new `img/client_drone.svg`
- `scripts/watch-push.ps1`, `scripts/git-setup.ps1`, new `scripts/optimize-images.py`
- `.gitignore`
- `archive/VTOL_Relay_Carrier_Operating_Manual.html` (banner and meta only)
- `docs/tasks/reports/WP04-IMPLEMENTATION.md`

**Do not edit** `index.html`, `manual.html` or `relay/*`.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | `scripts/optimize-images.py` (Pillow, run with `S\venv\Scripts\python.exe`): strips **all** metadata (EXIF incl. GPS, XMP, ICC unless needed), resizes to ≤ 1600 px long edge, writes optimised JPEG at the **same filename** (to keep page references valid) plus a `.webp` sibling, targets ≤ 200 KB each where quality allows, and prints a before/after table. Idempotent. |
| R2 | MUST | Run it on `img/t2_vtol.jpg`, `img/t2_vtol2.jpg`, `img/matek_f405.jpg`. Verify afterwards (with Pillow) that **no EXIF/GPS data remains**, and record sizes in the report. |
| R3 | MUST | `img/siyi_hm30.jpg` is really a PNG (RGBA). Re-encode it as a real JPEG (flattened onto the page background `#1a1a1a` or white, whichever looks right on the dark page; explain the choice) under the same name, plus `.webp`. |
| R4 | MUST | `img/fpv_drone.jpg` shows a different aircraft and contains an EXIF GPS block. **Delete it from the repo.** Add `img/client_drone.svg`: a clean, neutral top-down line drawing of a generic quad ("client drone"), using the project palette (`#f97316` accent lines on transparent, `#e8e8e8` labels optional), with `<title>`/`<desc>`, ≤ 10 KB. Note in the report that WP06 must replace the two `fpv_drone.jpg` references. |
| R5 | MUST | `img/README.md`: image rules (size, format, EXIF stripping, alt text, own photos only), a **credits/licence table** for every remaining image (mark vendor images "vendor marketing image — replace with own photo"), and a **photo shot list** for the owner: annotated top and side views of the T2 Cruza with the relay PCB, HM30 antennas, VRX patches (inward), ELRS module antenna, GPS, pitot, 915 RX; the ground station/mast; the relay PCB connectors. Explain how to run the optimiser. |
| R6 | MUST | **REP-01** `scripts/watch-push.ps1`: watch the **repo root** (parent of `scripts/`) recursively; include only `*.html,*.js,*.css,*.json,*.md,*.svg,*.webp,*.jpg,*.png,*.webmanifest`; exclude `.git/`, `node_modules/`, `gcs/build/`, `gcs/dist/`, `venv/`; one FileSystemWatcher with proper filtering in the handler; a debounce implemented with a timer (not sleeping inside the event action); stage **only** the changed allow-listed paths (`git add -- <paths>`), never `git add .`; refuse to stage files matching `*token*`, `*.env`, `*secret*`. Header comment says deliberate commits are preferred. PowerShell 5.1 compatible. |
| R7 | MUST | **REP-02** `scripts/git-setup.ps1`: operate on the repo root (parent of `scripts/`); **append** missing `.gitignore` lines instead of overwriting; mark it one-time; keep the user/repo variables. |
| R8 | MUST | **REP-04** `.gitignore`: keep the existing entries; add `.claude/settings.local.json`, `node_modules/`, `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `gcs/build/`, `gcs/dist/`, `.pytest_cache/`. Run `git rm --cached .claude/settings.local.json` so it stops being tracked (the file stays on disk). |
| R9 | MUST | **REP-06** archive page: add `<meta name="robots" content="noindex">` and a prominent fixed red banner at the top: "OBSOLETE — superseded by the current manual. Contains outdated and incorrect safety information. Do not use for operations." with a link to `../manual.html`. No other content changes. |

## Acceptance (verifier)

- Pillow check: no EXIF in any image; sizes reported.
- `fpv_drone.jpg` is gone and `client_drone.svg` is valid and small.
- The PowerShell scripts parse: `powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('<path>',[ref]$null,[ref]$e); $e"` → no errors. Review their logic.
- `.claude/settings.local.json` is untracked.
- The archive banner is present.
