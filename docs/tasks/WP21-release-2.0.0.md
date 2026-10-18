# WP21 — Release 2.0.0 preparation (owner decisions 2026-10-18)

- **Worktree:** `S\wt\WP21`
- **Branch:** `wp/21`
- **Files you own:**
  - `gcs/vtolgcs/__init__.py`, `gcs/pyproject.toml` (version only)
  - any test that asserts the GCS version
  - `CHANGELOG.md`, `README.md` (release section only)
  - `docs/relay/OPEN-ITEMS.md` (rows O-5, O-6, O-16)
  - `docs/tasks/reports/WP21-IMPLEMENTATION.md`
- **Not yours:** `img/README.md` (WP22 runs in parallel and owns it).

## Owner decisions

1. **Release tag `v2.0.0`: approved.** The PM creates and pushes the tag after this WP and WP22 are merged. Do not tag.
2. **GCS app version: PM decision `2.0.0`,** so it matches the suite release and the tag that the GCS build attaches its zip to.
3. **O-5: keep the old photo in the git history.** No rewrite. WP20 (history purge) was prepared and verified, then **cancelled**, because the facts in O-5 were wrong:
   - `img/fpv_drone.jpg` never carried a GPS position: its EXIF GPS block was empty.
   - The 4.2 MB version (blob `b32c311`) is byte-identical to the public Wikimedia Commons file `File:Racing Drone.jpg` (CC BY-SA 4.0, uploaded 2016-03-14, "Own work"). The camera serial in its EXIF belongs to that photographer and is public on Commons.
   - The smaller version (blob `c65b4da`) carries a "© sanaan" notice.
   - The photo was removed from the site in WP04 and remains only in old commits.
4. **O-6: keep `docs/history/CONVERSATION_LOG.txt`** as it is.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Version 2.0.0.** Set the GCS version to `2.0.0` in `gcs/vtolgcs/__init__.py` and `gcs/pyproject.toml`. Find every other place the GCS version is used or asserted: the UI "About" text, API `/health` or status, the build scripts, the packaging, and the tests. Make them consistent. Contract C2 must still hold: check `docs/tasks/02-CONTRACTS.md` for any version field. |
| R2 | MUST | **CHANGELOG.** The 2.0.0 entry covers WP17–WP19 (CI and test reliability; the runtime GIL switch interval going from 0.5 ms to 1 ms, a product change; the table-driven CRC; the rate-limit clock injection) and WP22 (image credits; representative photos). Mention that the GCS app version is now 2.0.0. Keep it short and factual. |
| R3 | MUST | **OPEN-ITEMS.**<br>- **O-5:** CLOSED. Owner decision 2026-10-18: keep it in the history. Give the corrected facts above, look up and record the Commons author with the Commons API (read-only), and say that WP20's verified rewrite was not applied.<br>- **O-6:** CLOSED, keep.<br>- **O-16:** CLOSED once tagged. Write "GCS 2.0.0; tag `v2.0.0` to be pushed by the PM after WP21/WP22". The PM updates it after tagging. |
| R4 | MUST | **README "Releases and rollback".** Check that the steps for tagging and for the release zip (gcs-build `release` job) are accurate for `v2.0.0`. Fix them if they are not. Do not add any force-push exception. |
| R5 | MUST | **All green:**<br>- CI mode `pytest gcs protocol` ×1<br>- `node --test test/` with `VTOL_JSDOM` and `VTOL_PYTHON`<br>- `workflows.test.js`<br>- all `--check` scripts<br>- if the packaging reads the version, a dry run of `gcs/packaging/build.ps1` (or explain why it can't run locally) |

Rules: stop processes only by PID; no pushes; no desktop runs; commit with the trailers.
