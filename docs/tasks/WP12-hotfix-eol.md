# WP12 — Hotfix: line-ending robustness

- **Worktree:** `S\wt\WP12`
- **Branch:** `wp/12`
- **Priority:** immediate. It blocks a green `main`.

## Problem

`main` (in the Windows clone, `core.autocrlf=true`) checks text files out with **CRLF** line endings. After merging WP06, `node --test test/` fails 9 tests in `test/manual/`. They extract sections of `manual.html` with patterns that assume LF. In the WP06 worktree the files happened to be LF, so all tests passed there. GitHub Actions (Linux) and GitHub Pages use LF.

## Files you own

- `.gitattributes` — keep the existing `relay/vendor/** -text` rule exactly
- `test/**` — only as needed for robustness
- `docs/tasks/reports/WP12-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | Add a repo-wide rule so text files are stored **and checked out** with LF (`* text=auto eol=lf`), keeping binary files (images, fonts, woff2, ico, zip, pdf) and `relay/vendor/**` byte-exact (`-text` / `binary`). PowerShell scripts in `scripts/` and `gcs/scripts/`: decide between CRLF and LF from what Windows PowerShell 5.1 needs, and justify it. Renormalise the repository (`git add --renormalize .`), so the commit contains only line-ending changes plus `.gitattributes`. |
| R2 | MUST | Make every test that reads repository files line-ending agnostic: normalise `\r\n` → `\n` in a shared test helper, used by all tests that read HTML/JS/MD files (`test/manual/*`, `test/content/*`, and any others that use regexes over file text). |
| R3 | MUST | Prove it: `node --test test/` passes (a) in a fresh clone with `core.autocrlf=true`, and (b) with `core.autocrlf=false`. Also run `pytest gcs`. Report the commands and results. |
| R4 | MUST | No content or behaviour changes to pages or app code. |
