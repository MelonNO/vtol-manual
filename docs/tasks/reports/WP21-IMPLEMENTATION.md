# WP21 — Release 2.0.0 preparation: implementation report

Branch `wp/21`, base `be7b8f0`. Round 1: work `753949b`, report `d43f6a9`. Round 2: fixes `e83a543`, plus the
commit that updates this report. No push, no tag.

## 1. Summary

- **GCS app version 0.1.0 → 2.0.0** in its only two sources, `gcs/vtolgcs/__init__.py` and `gcs/pyproject.toml`.
  Everything else (the C2 `/health` and `/status`, the headless console line, the argparse description, the Tk
  window title, the session-log `session_start`, the control-channel `hello`) reads `vtolgcs.__version__`, so
  nothing else needed editing. There is no "About" dialog. The packaging, the build script and the workflows do not
  read the version: the release zip's name comes from the tag (`vtol-gcs-${GITHUB_REF_NAME}-windows-x64.zip`).
- A new test keeps `pyproject.toml` and `__version__` equal and checks the C2 `x.y.z` shape.
- **CHANGELOG 2.0.0** extended: WP17–WP19, WP22, the GCS app now at 2.0.0, and the owner's tag approval. The
  `fpv_drone.jpg` "EXIF GPS block" wording is corrected.
- **OPEN-ITEMS:** O-5 is CLOSED (keep in history, corrected facts, Commons author looked up, WP20 not applied). O-6
  is CLOSED (keep). O-16 says "CLOSED once tagged: GCS 2.0.0; tag `v2.0.0` to be pushed by the PM after WP21/WP22".
- **README "Tagging a release"** fixed. It now names both GCS version files and the desktop-only tests before a
  release, and tags exactly `origin/main`. It also fixes an inaccurate release-notes hint. No force-push exception.

## 2. Requirements

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `gcs/vtolgcs/__init__.py:24`, `gcs/pyproject.toml:7`, `gcs/tests/test_api.py:58` | Users of the version: `__main__.py:82,703`, `control.py:204,635`, `runtime.py:173,198,530`, `ui/app.py:203`, all through `__version__`. Tests `test_api.py:51,60` compare with `__version__`; `test_runtime_e2e.py:149,203` take the value from the response. **C2 holds:** `/health` → `{"ok":true,"app":"vtol-gcs","version":"2.0.0"}`, which is `x.y.z`. The C2 Status example `"app": {"version": "2.0.0", …}` in `02-CONTRACTS.md:144` and `gcs/tests/_c2.py:11` now matches the real value; `_c2.py` checks shape and types only. Web: `js/version.js` is already `'2.0.0'` (C4, the suite version, WP10). The pages show the GCS version only from live data (`index.html:2196` session log). `test/content/render.test.js:22` `fw_version: '0.1.0'` is the bridge firmware, not the GCS app. |
| R2 | DONE | `CHANGELOG.md:6-21` (versions, date 2026-10-18, GCS 2.0.0, tag approval, 22 WPs, WP20 cancelled); `:78-81` WP22 photos/credits; `:98-102` the WP18/WP19 product changes (GIL 0.5 → 1 ms, table-driven CRC, `rate_clock`); `:111` fpv_drone.jpg corrected; `:132-138` WP17–WP19 CI and test reliability | The WP22 bullet follows the WP22 brief (R2/R5/R6: "Representative image" captions/alt, credits table and visible "Image credits" section, shot list kept), because WP22 is not merged yet. **PM: check it against WP22's final result at merge.** |
| R3 | DONE | `docs/relay/OPEN-ITEMS.md:66` (O-5), `:67` (O-6), `:77` (O-16) | O-5: the Commons author comes from the read-only API, §5. The SHA-1 and size were checked locally against blob `b32c311`. O-16 is left for the PM to mark CLOSED after tagging. |
| R4 | DONE | `README.md:139-163` | §6 lists what was checked and fixed. No force-push exception; "Never move or re-push a published tag" was added. |
| R5 | DONE | §4 | `build.ps1` was not run: the packaging does not read the version (§4). |

## 3. Placeholders

None.

## 4. Tests

| Run | Command | Result |
|---|---|---|
| CI mode ×1 | `S\wp21\run.py S\wt\WP21 S\wp21\ci1\run.txt ci`. This is a copy of the WP19 runner, except that it always sets `VTOLGCS_INTERACTIVE_TESTS=0`. Real Python 3.12, `CI=true GITHUB_ACTIONS=true`, stdin NUL, the gcs-build flags `-m "not interactive_desktop" -v -p no:cacheprovider -rfEs --tb=long` | **700 passed, 7 deselected**, 137.6 s, exit 0 (699 before + the new test). No LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR line. No Python process left from the run. Header: verified teardown recovery on pytest 9.1.1. |
| Node, all | `VTOL_JSDOM=S\jsenv\node_modules\jsdom VTOL_PYTHON=S\venv\Scripts\python.exe VTOLGCS_INTERACTIVE_TESTS=0 node --test test/` | **310 pass, 0 fail, 0 skipped** |
| Workflows | `node --test test/ci/workflows.test.js` (same env) | 7 pass, 0 fail |
| Checks | `check-links`, `check-images`, `check-colours`, `gen-precache --check`, `gen-params-reference --check`, `diagrams/build.js --check` | all exit 0 (57 precache assets, 1663 params, 16 diagrams, 35 images within budget) |
| html-validate | `npx --prefix S\jsenv html-validate *.html relay/*.html tools/*.html` | exit 0, 0 errors (169 accepted warnings; no page was touched) |
| API module | `pytest gcs/tests/test_api.py` | 29 passed |

**`gcs/packaging/build.ps1` dry run: not needed.** Neither the build script nor the spec reads the version. Nor
does `gcs-build.yml`, apart from `GITHUB_REF_NAME` for the zip name. The built exe gets the version only through
`vtolgcs.__version__`, which the tests above cover. `test_packaging.py` (static checks and the PowerShell parse of
`build.ps1`) passed in the CI-mode run.

## 5. O-5: the read-only Commons lookup

`GET https://commons.wikimedia.org/w/api.php?action=query&titles=File:Racing%20Drone.jpg&prop=imageinfo&iiprop=user|timestamp|size|sha1|url|extmetadata`
(2026-10-18, curl, read only):

- user/Artist **Commanderbryce**, Credit "Own work", LicenseShortName **CC BY-SA 4.0**, uploaded
  2016-03-14T19:41:32Z, ImageDescription "Minion 220 racing multirotor by RotorGeeks";
- size 4,157,983, 4928×3264, sha1 `e504e5f4aafeb0aea25e9a9cc8a6be91eec8bca1`.

The local check matches it:
- `git cat-file -s b32c311` = 4157983;
- `git cat-file blob b32c311 | sha1sum` = `e504e5f4…bca1`;
- Pillow: Make/Model NIKON D5100; GPS IFD keys `[0]` (GPSVersionID only, no position).

The serial value was not read or written.

`c65b4da` ("© sanaan") is older than this worktree's shallow boundary, so it could not be re-checked here. The O-5
text states it as given in the brief and in the WP20 verification (round 1, image scan). I left the Commons URL out
of the repo, because the WP20 verifier suggested the file title is enough. Only the title and the author are
recorded.

## 6. README "Releases and rollback": what I checked

Checked against `.github/workflows/gcs-build.yml`:
- the tag push triggers the workflow (`tags: ['v*']`);
- the zip name is `vtol-gcs-$GITHUB_REF_NAME-windows-x64.zip` = `vtol-gcs-v2.0.0-windows-x64.zip`, as the README
  says;
- the `release` job runs `gh release create "$TAG" --verify-tag` only if no release exists, then
  `gh release upload --clobber`.

Fixed:
1. **Step 1 named only `js/version.js`.** It now names the GCS `__version__`, `pyproject.toml` (kept equal by the
   new test) and the CHANGELOG entry, and says that for `v2.0.0` step 1 is done.
2. **The pre-release desktop test run was missing** from the steps. `gcs/README.md` and OPEN-ITEMS M-16 require it.
   It is step 2 now. The text points to gcs/README "Tests" and does not repeat the commands.
3. **The tag could be put on a stale local commit.** Added `git switch main && git pull --ff-only` and "CI green".
4. **"or create the release first with `gh release create v2.0.0 --notes-file`" was wrong.** Before the tag is
   pushed, `gh release create` creates the tag itself on the tip of `main`, and the later `git push origin v2.0.0`
   is then rejected. The text now says: create the release right after pushing the tag (`--verify-tag`), or edit
   the notes afterwards (`gh release edit`). It also says never to do it before the tag push.
5. Added: never move or re-push a published tag. Re-run failed jobs, or fix on `main` and tag the next version.
   This keeps the no-force-push rule.

## 7. Deviations / contract issues

- **New test in `gcs/tests/test_api.py`** (the brief owns "any test that asserts the GCS version"; that module
  already asserts it). It is version-agnostic, so a later GCS-only bump does not have to edit a test.
- **CHANGELOG `[2.0.0]` date changed from 2026-10-17 to 2026-10-18.** That is the owner approval date and the
  expected tag date. The PM may adjust it to the real tag date.
- **The CHANGELOG's "Removed" line about `fpv_drone.jpg` was corrected.** It said "(EXIF GPS block)". It is in a
  file I own and it contradicted the owner's corrected facts.
- **Not touched (WP22 owns it):** `img/README.md:84` still says "carried an EXIF GPS position". That is wrong by the
  corrected O-5 facts. **WP22 or the PM should reword it**, e.g. "an empty EXIF GPS block with no position; it
  remains in the git history (OPEN-ITEMS O-5)".
- No contract change. C2's `"version": "x.y.z"` and the C4 web `app: '2.0.0'` are both satisfied.

## 8. Notes for the verifier

- `git diff be7b8f0 753949b`: six files.
- `git grep -n "0\.1\.0" -- gcs` must return nothing.
- Run `python -c "import sys; sys.path.insert(0,'gcs'); import vtolgcs; print(vtolgcs.__version__)"`; it prints
  `2.0.0`.
- The live value: the headless console line `vtol-gcs {__version__} headless …` (`__main__.py:703`), the window
  title (`ui/app.py:203`), and `/api/v1/health` (covered by `test_api.py::test_health`). I did not start the app
  (no desktop runs).
- Repeat the Commons call in §5; it is read-only.
- Logs: `S\wp21\ci1\run.txt`, `S\wp21\node-all.txt`, `S\wp21\workflows.txt`, `S\wp21\hv.txt`.

## Rework round 2

Verification round 1 (`Serify\WP21\VERIFY-round1.md`) rejected the work on F1. The scope was extended to
`docs/history/README.md` and the `gcs/vtolgcs/protocol.py:113` comment. Fix commit: `e83a543`.

| # | Fix | Where |
|---|---|---|
| F1 (MAJOR) | I rewrote the "Photos (WP22)" bullet against wp/22 **2b61a98** (`manual.html`, `img/README.md`, WP22 report). Each sentence was checked against that tree: two representative photos, both CC BY-SA (`rep_fpv_quad`, Euflipo, CC BY-SA 4.0, Wikimedia Commons, Client Drones; `rep_pitot_tube`, ArduPilot Dev Team, CC BY-SA 3.0, ArduPilot docs, Maintenance); caption and alt text say "Representative image"; the caption carries a credit line with a source link (`manual.html` 1463, 1603); the visible "Image Credits" section is in Reference ▾ Abbreviations (`#abbrev/image-credits`) and has a `data-img` row for every photo the manual uses (6 photos in 5 rows; `client_drone.svg` is a drawing); the `img/README.md` credits table has author, licence, source page, file URL and date checked; the four vendor images stay, captioned as vendor images (manual 344, 501, 871, 875 "vendor render", 1505), with their licence "not recorded". The old claims ("every image's author, licence and source"; "every photo of non-own hardware says Representative") are gone. | `CHANGELOG.md:78-85` |
| F2 (MINOR) | CRC speed-up "about 6×" → "about 8×" (WP18 7.9×, verifiers 8.2× and 8.5×), in the CHANGELOG and in the `protocol.py:113` comment (comment only, no code). No other "6×" mention in the repository. | `CHANGELOG.md:105`, `gcs/vtolgcs/protocol.py:113` |
| F3 (MINOR) | The privacy note now records the owner decision: kept as it is, no deletion, no history purge (OPEN-ITEMS O-6, closed). | `docs/history/README.md:31-33` |

§7's note about `img/README.md:84` is obsolete: wp/22 2b61a98 rewrote that line ("Its EXIF GPS block was empty: it
never carried a GPS position", with the Commons attribution). Nothing is left for the PM there.

**Tests (round 2, on `e83a543`):**

| Run | Result |
|---|---|
| CI-mode `pytest gcs protocol` ×1 (`S\wp21un.py … ci`, as in §4; `protocol.py` changed, even if only a comment) | **700 passed, 7 deselected**, 138.2 s, exit 0. No LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR line, no process left (`S\wp212ciun.txt`) |
| `node --test test/` (VTOL_JSDOM, VTOL_PYTHON, VTOLGCS_INTERACTIVE_TESTS=0) | 310 pass, 0 fail, 0 skipped (`S\wp212-node.txt`) |
| `check-links`, `check-images`, `check-colours`, `gen-precache --check`, `gen-params-reference --check`, `diagrams/build.js --check`, `gcs/tools/gen_test_vectors.py --check` | all exit 0 |
| **Trial merge** in a throw-away clone (`S\wp21	rialmerge`): `e83a543` + `git merge --no-ff 2b61a98` | no conflicts (disjoint files), clean tree. `node --test test/`: **312 pass, 0 fail, 0 skipped** (`S\wp212-merge-node.txt`). All six Node checks exit 0 (59 precache assets, 39 images). Git maintenance printed "failed to write commit-graph" because the clone's source is shallow; the merge was not affected. |

