VERDICT: APPROVED

# WP21 verification — round 2

Verifier: independent agent. Branch `wp/21` at `5b14437`:
- `e83a543`: the fixes;
- `7011902`, `5b14437`: report text.

The checks are against local main `7e1f262` (be7b8f0 + wp/22 2b61a98 + the PM commit with M-20).

Nothing in the worktrees or the main repo was modified. The merge and the test runs used a throw-away clone,
`S\verify\WP21\merge2\`. No push, no tag, no network. The camera serial was read in memory only and counted, never
printed.

## Round-1 findings

| # | Result | Evidence |
|---|---|---|
| F1 MAJOR, CHANGELOG WP22 bullet | **FIXED** | `CHANGELOG.md:78-85` (the sentence-by-sentence check is below) |
| F2 MINOR, CRC "6×" | **FIXED** | `CHANGELOG.md:105` and `gcs/vtolgcs/protocol.py:113` say "about 8x" (measured 7.9× / 8.2× / 8.5×). The protocol.py diff is one line inside a `#:` comment block, with no code change. `_CRC16_TABLE` and the functions are unchanged, and `test_crc16_*` passes. No other "6×" claim remains (`git grep`) |
| F3 MINOR, `docs/history/README.md:31-33` | **FIXED** | "The owner decided on 2026-10-18 to keep it as it is: no deletion, no history purge (OPEN-ITEMS O-6, closed)". This matches O-6 and owner decision 4 |

### F1: each sentence checked against main 7e1f262

| Sentence in the CHANGELOG | Main 7e1f262 | Result |
|---|---|---|
| "two openly licensed representative photos, both CC BY-SA" | `img/README.md` credits: `rep_fpv_quad` CC BY-SA 4.0 and `rep_pitot_tube` CC BY-SA 3.0. These are the only two `rep_*` images | ✔ |
| "an analog FPV quad in Client Drones (Wikimedia Commons)" | Euflipo, `commons.wikimedia.org/wiki/File:Dron-fpv.jpg`; figure in the Client Drones section | ✔ |
| "a pitot-static tube in Maintenance (ArduPilot docs)" | ArduPilot Dev Team, `ardupilot.org/plane/docs/common-pitot-considerations.html`; figure in Maintenance | ✔ |
| "Their caption and alt text say 'Representative image'" | Both alts start "Representative image, not …"; both captions start "Representative image:" | ✔ |
| "the caption carries a credit line (author, licence, source link)" | FPV: "Photo: Euflipo (linked to the Commons page), CC BY-SA 4.0 (licence link)". Pitot: "ArduPilot Dev Team, ArduPilot Plane docs (link), CC BY-SA 3.0 (link)" | ✔ |
| "visible 'Image Credits' section (Reference ▾ Abbreviations, `manual.html#abbrev/image-credits`)" | `manual.html:1356` `id="image-credits"` inside the `abbrev` tab; the nav "Reference ▾" group has the `data-tab="abbrev"` button (`:312,316`) | ✔ |
| "with a row for every photo it uses" | The manual uses 6 photos: t2_vtol, t2_vtol2, matek_f405, siyi_hm30, rep_fpv_quad, rep_pitot_tube. All 6 are covered by the 5 `data-img` rows (`:1361-1365`) | ✔ |
| "`img/README.md` has a credits table (author, licence, source page, file URL, date checked)" | The columns are File, Content, Author, Licence, Source page, File URL, Checked, Status | ✔ |
| "The four vendor marketing images (…) stay, captioned as vendor images" | Captions `manual.html:344` "(vendor image — …)", `:501` "vendor image", `:871` "(vendor image)", `:875` "vendor render", `:1505` "(vendor image)" | ✔ |
| "with their licence marked 'not recorded'" | Credits table: licence "Not recorded" (t2 and siyi rows add the vendor's terms or footer quote). Manual credits rows: "licence not recorded" | ✔ |
| "until the owner's own photos (shot list in `img/README.md`) replace them" | Status "replace with own photo"; the shot list is present | ✔ |

The two false round-1 statements are gone.

## Scope (round 2)

`git diff d43f6a9 5b14437` changes 4 files:
- `CHANGELOG.md`;
- `docs/history/README.md`;
- `gcs/vtolgcs/protocol.py` (one comment line);
- `docs/tasks/reports/WP21-IMPLEMENTATION.md`.

All four are within the extended scope. The whole branch diff, `be7b8f0..5b14437`, has 9 files: the round-1 seven plus
`docs/history/README.md` and `protocol.py`. None of them is a WP22 file.

## Report

The round-2 section (`WP21-IMPLEMENTATION.md:119-141`) now has correct paths:
- `S\verify\WP21\VERIFY-round1.md`;
- `S\wp21\run.py`;
- `S\wp21\r2ci\run.txt`;
- `S\wp21\r2-node.txt`;
- `S\wp21\trialmerge`;
- `S\wp21\r2-merge-node.txt`.

There are no control characters left in the file, and `5b14437` changes only those path strings. The report's claims
match what I found.

## Trial merge: wp/21 (5b14437) into main 7e1f262

`git merge --no-ff` applied cleanly with **no conflicts**. OPEN-ITEMS.md auto-merged:
- the O-5, O-6 and O-16 rows are byte-identical to wp/21's;
- the PM's M-20 row is byte-identical to 7e1f262's;
- the merged diff against 7e1f262 touches only O-5, O-6 and O-16.

The working tree stayed clean after every run.

## Tests run on the merged tree

| Run | Result |
|---|---|
| `node --test test/` (VTOL_JSDOM, VTOL_PYTHON, VTOLGCS_INTERACTIVE_TESTS=0) | **312 pass**, 0 fail, 0 skipped, 0 cancelled |
| `node --test test/ci/workflows.test.js` | 7/7 |
| `check-links`, `check-images` (39 images), `check-colours`, `gen-precache --check` (59 assets), `gen-params-reference --check` (1663), `scripts/diagrams/build.js --check` (16), `gcs/tools/gen_test_vectors.py --check` | all exit 0 |
| CI-mode `pytest gcs protocol` ×1 (`cirun.py`: real Python 3.12 with the venv site-packages, `CI=true GITHUB_ACTIONS=true VTOLGCS_INTERACTIVE_TESTS=0`, stdin NUL, `-m "not interactive_desktop" -v -p no:cacheprovider -rfEs --tb=long`) | **700 passed, 7 deselected**, 138.1 s, exit 0. 0 LEAKED / TIMEOUT / FAILED / ERROR / INTERNALERROR lines. `test_health`, `test_version_is_x_y_z_and_matches_pyproject` and `test_crc16_*` PASSED. 0 python.exe left |
| Serial scan (counts only) of the full `be7b8f0..5b14437` diff and the merged CHANGELOG, README, OPEN-ITEMS, history README, WP21 report and protocol.py | 0 occurrences |

## Requirement results (unchanged from round 1 unless noted)

| ID | Result |
|---|---|
| R1 version 2.0.0, C2, test | PASS (re-run green on the merged tree) |
| R2 CHANGELOG | **PASS** (F1 and F2 fixed) |
| R3 O-5 / O-6 / O-16 | PASS (the rows survive the merge with M-20 intact) |
| R4 README tagging | PASS (not changed in round 2) |
| R5 all green | PASS |

## Findings

None open. There are no BLOCKER, MAJOR or MINOR findings.

## Approval rationale

All round-1 findings are fixed and accurate against main 7e1f262. The round-2 diff stays within the extended scope.
wp/21 merges into 7e1f262 without conflicts, and the merged tree is fully green. Every MUST requirement passes.
