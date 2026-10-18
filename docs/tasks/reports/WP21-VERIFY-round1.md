VERDICT: REJECTED

# WP21 verification — round 1

Verifier: independent agent. Branch `wp/21` (753949b work, d43f6a9 report), base `be7b8f0`. Cross-check: `wp/22` at `10ffe45`.
Worktrees, the main repo and wp/22 were not modified. All mutation, merge and test runs were in throw-away clones under
`S\verify\WP21\` (`mut\`, `merge\`, `tagtest\`). No push, no tag. Network: one read-only Commons API GET and two
WebFetch reads of the gh manual. The camera serial was read in memory only (`serialgrep.py` prints counts, never the
value).

## Summary

The version change, the new test, OPEN-ITEMS O-5/O-6/O-16 and the README tagging steps are correct, and everything is
green. I reject on one MAJOR finding. The CHANGELOG's WP22 bullet makes two statements that are false against wp/22's
actual result at 10ffe45. R2 requires the entry to be factual. There is also one MINOR inaccuracy (the CRC speed-up).

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 version 2.0.0 | **PASS** | `gcs/vtolgcs/__init__.py:24`, `gcs/pyproject.toml:7`; `git grep 0\.1\.0` finds only history and reports, plus `test/content/render.test.js:22` `fw_version` (the bridge firmware) | Every user reads `__version__`: `__main__.py:82,703`, `control.py:204,635`, `runtime.py:173,198,530`, `ui/app.py:203`, `api.py:152` (passed in). There is no About dialog. `vtol-gcs.spec`, `build.ps1` and `gcs-build.yml` do not read the version; the zip name comes from `GITHUB_REF_NAME`. The web pages show the GCS version only from session data (`index.html:2196`). |
| R1 C2 | **PASS** | `test_api.py::test_health` starts the runtime and asserts `/api/v1/health` == `{"ok":true,"app":"vtol-gcs","version":__version__}`; it passed in my CI run. The new test checks `x.y.z`. `02-CONTRACTS.md:123,144` | — |
| R1 mutation | **PASS** | pyproject `2.0.1`: `test_version_is_x_y_z_and_matches_pyproject` FAILED (`assert '2.0.1' == '2.0.0'`). `__init__` `2.0.0-rc1`: FAILED at the regex. Restored: 2 passed | The test resolves `gcs/pyproject.toml` from `__file__`, so it works from the repo root and from `gcs/` |
| R2 CHANGELOG | **FAIL** | `CHANGELOG.md:78-81` (WP22 bullet): see F1. WP17–WP19 content checked against the reports: accurate except F2. "Removed" line `:110-111`: accurate. No GPS statement added (the only GPS hit, `:65` "GPS-Rescue trajectory", is old and unrelated) | — |
| R3 O-5 | **PASS** | `OPEN-ITEMS.md:66` | Every fact matches WP20-VERIFY r1 (`:89-92`: b32c311 NIKON D5100, maker-note serial, GPS IFD = {0}; c65b4da "© sanaan", no GPS or serial; no other blob flagged) and r2 (`:32`: SHA-1, size, Commons). Commons API (mine, 2026-10-18): `File:Racing Drone.jpg`, user/Artist **Commanderbryce**, Credit "Own work", **CC BY-SA 4.0**, 2016-03-14T19:41:32Z, 4157983 B, 4928×3264, sha1 `e504e5f4aafeb0aea25e9a9cc8a6be91eec8bca1`, description "Minion 220 racing multirotor by RotorGeeks". Main repo (read-only, `GIT_OPTIONAL_LOCKS=0`): `cat-file -s b32c311` = 4157983, `cat-file blob b32c311 \| sha1sum` = e504e5f4…bca1. `3721cd4` deletes `img/fpv_drone.jpg` (4157983 → 0). c65b4da lies behind the shallow boundary and cannot be checked locally; the O-5 text matches WP20 r1. States that WP20 was not applied. |
| R3 serial | **PASS** | `serialgrep.py`: one candidate (Nikon 0x001D, 7 digits). Its count is 0 in the wp/21 diff, in the wp/21 commit messages, in `git grep` over both trees (d43f6a9 and 10ffe45), in the wp/22 diff, in the four changed docs, and in the implementer's `S\wp21\*` logs | Value never printed or stored |
| R3 O-6 | **PASS** | `OPEN-ITEMS.md:67`: "CLOSED … keep … as it is" | Matches owner decision 4 |
| R3 O-16 | **PASS** | `OPEN-ITEMS.md:77`: "CLOSED once tagged: GCS 2.0.0; tag `v2.0.0` to be pushed by the PM after WP21/WP22" | Required wording present verbatim |
| R4 README | **PASS** | `README.md:139-163` | See "README check" below |
| R5 all green | **PASS** | See "Tests run" | `build.ps1` dry run not needed: no packaging file reads the version (confirmed) |
| Scope | **PASS** | 7 files: CHANGELOG, README (Tagging section only), OPEN-ITEMS (O-5, O-6, O-16 only), WP21 report, pyproject, `test_api.py`, `__init__.py` | All are owned files. No WP22 file is touched (img/README.md, manual.html, img/*, sw-precache.js, test/manual) |

## README check ("Tagging a release")

Checked against `gcs-build.yml`:
- trigger `tags: ['v*']`;
- zip `vtol-gcs-$GITHUB_REF_NAME-windows-x64.zip`, which is `vtol-gcs-v2.0.0-windows-x64.zip`;
- the `release` job runs only when `ref_type == tag`. It runs `gh release create "$TAG" --verify-tag` only if `gh release view` fails, then `gh release upload --clobber`.

Checked against the gh manual (WebFetch):
- `gh release create`: "If a matching git tag does not yet exist, one will automatically get created from the latest state of the default branch".
- `--verify-tag`: "Abort in case the git tag doesn't already exist in the remote repository".
- `gh release upload --clobber`: "Delete and re-upload existing assets of the same name".

All README statements match.

**The claim "a release created before the tag push makes the tag on main, and the later push is rejected" is correct.** I tested it locally with a bare remote holding a lightweight `v2.0.0`, which is what the API creates, and a local `git tag -a v2.0.0` on the same commit. `git push origin v2.0.0` gives `! [rejected] v2.0.0 -> v2.0.0 (already exists)`, exit 1. If the PM pulled the tag first, `git tag -a` would fail instead, so either way the process stops. The README's own suggested command carries `--verify-tag`, so it cannot create the tag.

There is no force-push exception: README `:137` "Never rewrite `main`'s history", plus the new "Never move or re-push a published tag". O-5's right-hand column says the same.

The steps are correct for the PM tagging v2.0.0 right after the WP21 and WP22 merges:
- step 1 is done;
- `gen-precache --check` passes on the merged tree, so step 3 regenerates nothing;
- step 4 tags the pulled `main`.

## Tests run (commands + results)

| Run | Tree | Result |
|---|---|---|
| CI-mode `pytest gcs protocol` ×1 (`cirun.py`): real Python 3.12 with the venv's site-packages on PYTHONPATH, `CI=true GITHUB_ACTIONS=true VTOLGCS_INTERACTIVE_TESTS=0`, stdin NUL, `-m "not interactive_desktop" -v -p no:cacheprovider -rfEs --tb=long` | clean clone of d43f6a9 | **700 passed, 7 deselected**, 138.2 s, exit 0. 0 `+++ LEAKED/TIMEOUT/FAILED/ERROR` or INTERNALERROR lines. `test_health` and the new test PASSED. 0 python.exe left afterwards |
| `node --test test/` (VTOL_JSDOM, VTOL_PYTHON, VTOLGCS_INTERACTIVE_TESTS=0) | d43f6a9 | 310 pass, 0 fail, 0 skipped |
| `node --test test/` | **trial merge** be7b8f0 + wp/21 + wp/22 (74aa4f1) | 311 pass, 0 fail, 0 skipped |
| `node --test test/ci/workflows.test.js` | both | 7/7 each |
| `check-links`, `check-images`, `check-colours`, `gen-precache --check`, `gen-params-reference --check`, `scripts/diagrams/build.js --check`, `gcs/tools/gen_test_vectors.py --check` | both | all exit 0 |
| Mutations (pyproject ≠ `__init__`; `__init__` not x.y.z) | clone | both fail the new test, as they should |

**Trial merge:** both merges (`--no-ff`) applied cleanly with **no conflicts**. The file sets are disjoint. The
working tree was clean afterwards.

## Smoke tests

Not a web WP. The live `/api/v1/health` value is covered by `test_health`, which runs the real runtime and HTTP server.

## Findings

| # | Severity | Where | What is wrong | Expected |
|---|---|---|---|---|
| F1 | **MAJOR** (R2 MUST, "factual") | `CHANGELOG.md:78-81`, the "Photos (WP22)" bullet, against wp/22 @ 10ffe45 | Two statements are false against WP22's actual result. **(a)** "Every image's author, licence and source are in the credits table in `img/README.md`": the rows for `t2_vtol`, `t2_vtol2`, `matek_f405` and `siyi_hm30` record Licence, Source page and File URL as **"Not recorded"** (10ffe45 `img/README.md`, credits table). The manual's Image Credits table says "licence not recorded". For Heewing, it also quotes terms that forbid reproduction. The sentence claims licence records that do not exist. **(b)** "A photo that does not show this build's own hardware says 'Representative image' in its caption and alt text": the four vendor marketing images show vendor units, not this build's hardware. They are captioned "vendor image" (10ffe45 `manual.html:342,499-500,869,873,1503-1504`), not "Representative image". WP22's rule labels photos of *similar* equipment, not the same product. The implementer wrote the bullet from the WP22 brief and asked the PM to re-check it at merge (report §2); at 10ffe45 it does not match | Reword to match 10ffe45, for example: "**Photos (WP22):** two openly licensed representative photos (CC BY-SA): an analog FPV quad in Client Drones and a pitot-static tube in Maintenance. Their caption and alt text say 'Representative image', with a credit line. `img/README.md` has a credits table (author, licence, source, date checked), and the manual has a visible 'Image Credits' section. The four vendor marketing images stay, with their licence recorded as unknown, until the owner's own photos (shot list) replace them." |
| F2 | MINOR | `CHANGELOG.md:101` "CRC-16 is now table-driven, with the same results and about 6× faster" | The measured factor is about 8×, not 6×: WP18 report §6: 16.5 → 2.1 µs (7.9×); WP18 verify r1: 15.5 → 1.9 µs (8.2×); my run on 34 random bytes: 15.97 → 1.88 µs (8.5×). The "6×" comes from the WP18 code comment `gcs/vtolgcs/protocol.py:113` (not WP21's file) | "about 8× faster", or drop the factor. The PM may also correct the `protocol.py:113` comment in a later WP |
| F3 | MINOR (observation, not WP21's file; for the PM) | `docs/history/README.md:31-33` | It still says whether to delete or purge `CONVERSATION_LOG.txt` "is an owner decision" and points to OPEN-ITEMS. O-6 now records the decision ("keep"). The sentence is not false, because it points to the decision, but it is stale | Optional PM follow-up: "kept by owner decision (OPEN-ITEMS O-6)" |

No BLOCKER. F1 is MAJOR.

## Approval rationale / items that must be fixed

**REJECTED** because of F1. R2 is a MUST ("short and factual"), and the WP22 bullet states two things that do not
match wp/22 at 10ffe45. Fix F1, preferably with F2 too. Everything else is correct: the version change and its test,
C2, O-5/O-6/O-16, the README tagging steps, the absent serial, the scope, the clean trial merge and every regression
run. Round 2 needs only a re-check of the reworded CHANGELOG lines and a fresh `node --test` plus the checks.
