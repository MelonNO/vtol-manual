VERDICT: REJECTED

# WP20 verification, round 2

Date: 2026-10-18. This round covers the amended R5 commit `e587cae3aa4c65f826d77b78a6bc6f426efce25f` (on the unchanged `623bcf4`), `S\wp20\PUSH-PLAN.md`, report §13 and `S\wp20\photo-copies.txt`.

Rules followed:

- no push;
- no POST, PATCH or DELETE to GitHub, only public read-only GETs;
- `S\wp20`, `S\repo` and `S\wt` were not modified (read-only commands, `GIT_OPTIONAL_LOCKS=0`);
- the serial value was read in memory only and is written nowhere.

## Verdict in one paragraph

**The push itself is safe.** e587cae is correct, and the round-1 findings F1, F3 and F4 are fixed. The F2 re-sync procedure is exact, correctly ordered and safe.

I reject on two new MINOR findings. Both come from my own scan of `S\`:

- **R2-1:** the scratch-copy deletion list is **not complete**. It also states, wrongly, that `wp22/` holds no copy.
- **R2-2:** the purged 4.2 MB blob is **byte-identical to a public Wikimedia Commons file** that still carries its full EXIF. That changes the Support expectation and contradicts one sentence of the committed report.

**Fixing R2-1 is a PUSH-PLAN text edit only.** Fixing R2-2 needs one sentence in report §6, which means amending e587cae again on top of `623bcf4`, plus one line in PUSH-PLAN §5. No rewrite is needed. Round 3 only has to re-read those passages and re-check the new R5 hash.

If the PM prefers, R2-2's report sentence could instead be corrected in a normal follow-up commit after the push. Then R2-1 alone, a plan-only fix, would stand between this round and approval.

## New findings

| ID | Grade | Finding | Evidence | Fix |
|---|---|---|---|---|
| R2-1 | MINOR | **The PUSH-PLAN §7 deletion list is incomplete.** `wp22/downloads/preview/p3.jpg` (960×636 JPEG, 120,532 B, no EXIF, no serial) is **the same picture as b32c311**: dHash-256 distance 0, crop-tolerant distance 0, same aspect ratio 1.509. It is an untrusted web preview that WP22 downloaded at 03:11. §7 says "`wp22/` is unrelated to WP20. It holds no copy, so leave it alone", which is wrong. The finder `find_photo_copies.sh` detects derived copies only by the name `fpv_drone*` or by the exact sizes 4157983 and 227438, so it can never find a renamed or resized copy. Its clean result at the end of §7 therefore does not prove that no copy remains. Minor nit: §7 says "53 old clones" for `verify/WP02…WP19`; the list has 52. | `scripts\findcopies.py` and `scripts\simcheck.py` output below | Add `wp22/downloads/preview/p3.jpg` to the table. It holds no serial, so it is only "the photo as a whole"; deleting it is the WP22 owner's call. Tell WP22 never to use it: its staged `rep_fpv_quad.*` is a **different** picture (distance about 110–134, no match). Say that the finder is name/size-based, or add a similarity check. Correct 53 → 52. Also add my round-2 stand-ins `verify/WP20/lease2/r-ok.git` and `lease2/r-moved.git` (both blobs) to the `verify/WP20` row |
| R2-2 | MINOR | **b32c311 is a public Wikimedia Commons file.** Its content SHA-1 `e504e5f4aafeb0aea25e9a9cc8a6be91eec8bca1` and size 4,157,983 B equal those of Commons `File:Racing Drone.jpg`: 4928×3264, uploaded 2016-03-14, "Own work", CC BY-SA 4.0 (Commons API `imageinfo`, read-only). WP22's own search log lists it too (`wp22/research/commons1.txt:45`). Commons serves the original file with its full EXIF, including the maker-note serial. Consequences: (a) the purge removes the project's copy but **does not make the serial non-public**; the owner should know this. (b) Report §6, committed in e587cae, says "Support may treat the copyright-only version (`c65b4da`) as non-sensitive. The serial-bearing `b32c311` is the clear case." That is no longer accurate: data that is publicly published elsewhere, under an open licence, is the least likely case for GitHub Support. PUSH-PLAN §5 has the same "especially for c65b4da" slant. | Commons API response; `git cat-file blob b32c311… \| sha1sum` | Report §6 and PUSH-PLAN §5: state that b32c311 is byte-identical to a public CC BY-SA 4.0 Commons file, so Support will very likely decline for both blobs and the purge is the owner's housekeeping, not a secrecy measure. Keep the Commons URL out of the repo if preferred; the file title is enough for the PM. Optionally tell the owner. No wording elsewhere in R5 is wrong: it says "camera body serial number" and never claims the serial is private or the owner's |

## Round-1 findings: re-check

| ID | Status | Evidence |
|---|---|---|
| F1 | **FIXED** | README now reads "a one-time `git filter-repo` purge of an old photo (a camera body serial number in one version, a third-party copyright notice in the other)". I grepped every added line of `git diff 623bcf4 e587cae` for gps, geotag, location and position. The only remaining "GPS-tagged" is the verbatim brief copy (title and the "carries an EXIF GPS block" fact), which is allowed. All other hits say the GPS block has no position, or are inspection columns, or one unrelated COMMIT-MAP subject ("GPS Rescue landing phase"). The O-5 title and the report title now say "old photo". img/README: "an empty EXIF GPS block with no position" |
| F2 | **FIXED (procedure)**, list incomplete, see R2-1 | Details below |
| F3 | **FIXED** | REST calls checked against GitHub docs; the Support caveat is present in §5 (but see R2-2) |
| F4 | **FIXED** | Report §4 now labels the output a "cleaned excerpt" and names the omitted lines. The `dfec6fd` row shows its COM comment. `S\wp20\msg-changed.txt` is gone. `attempt1/` is in the delete list with "Never push it" |

### F2 in detail: the re-sync procedure (PUSH-PLAN §6)

- **Order:** push (§2) → verify (§3) → fresh full clone at `S\repo\vtol-manual-v2` and verify it (§6.1, a stop point while the old repo is still intact) → read-only pre-checks (§6.2) → `git worktree remove` without `--force` (§6.3, the loop stops at the first refusal) → `rmdir "$S/wt"` (fails safely if not empty) → `rm -rf "$S/repo/vtol-manual"`. Correct and safe. Nothing is reset in place.
- **§6.1 commands:** correct. `HEAD^^{tree}` is the tree of HEAD's parent. I checked the same command set against a stand-in remote in round 1.
- **§6.2 pre-checks:** I ran them exactly as written (read-only). Results:
  - `refname:short` gives `pm/main`, which resolves.
  - The output is 21 lines: wp/01 … wp/19 (including wp/08a and wp/08b) and pm/main, **all 0**.
  - 0 stashes; the only untracked file is the WP20 brief, which is byte-identical to the copy in e587cae.
  - All 20 worktrees are clean; none is locked or prunable.
  - Ignored files: exactly `WP04/.claude/`, `WP08b/gcs/build/` and `WP08b/gcs/dist/`, as the plan says. The old main working tree has none.
- **Nothing local is lost by re-cloning:**
  - The old repo's config holds only `origin` (a single-branch fetch refspec) and `branch.main`.
  - There are no hooks other than samples and no custom excludes.
  - Its only other refs are `origin/*` and the stale `pm/main`.
- **`git worktree remove` semantics, tested in a throw-away repo (`verify\WP20\wttest`):**
  - a worktree whose only extra files are ignored → removed, exit 0, **ignored files deleted** (this is why the plan lists them first; correct);
  - untracked file → refused, exit 128;
  - modified tracked file → refused, exit 128;
  - clean → removed.
- **Bundle-deletion timing (§7):** correct. The bundle goes last, only after §3, §6.1, green CI and Pages, and owner acceptance with a margin of days. Until then it stays in `S\wp20`, is never pushed, and is never cloned into a folder with a GitHub remote. `orig-check.git`, `gh.git` and `bundle.git` are equivalent rollback sources; deleting them "after §3" while the bundle stays is fine. Rollback text: fine (optional, owner's instruction only).

### F3 in detail: the REST calls (GitHub REST docs, fetched 2026-10-18; nothing was run except GETs)

| Plan call | Docs | Status |
|---|---|---|
| `GET /repos/{o}/{r}/deployments/{id}` | Get a deployment → 200 | OK. I ran the plan's 4a GETs unauthenticated. The `grep -E '^  "(id\|sha\|environment\|created_at)"'` patterns match GitHub's 2-space pretty JSON. Deployment 5101784488 → sha c70e4b0…, latest state `inactive`. **7125805114 → sha 924d0a8…, latest state `success`**, so the plan's "set inactive first" step is really needed. Runs 27724725333 and 38942732665 → `pages build and deployment`, head_sha as in the table |
| `GET …/deployments/{id}/statuses?per_page=1` | List deployment statuses → 200, `per_page` max 100 | OK (newest first) |
| `POST …/deployments/{id}/statuses` `{"state":"inactive"}` | Create a deployment status → **201**; `state` required, `inactive` is an allowed value; classic `repo_deployment` (or `repo`), fine-grained **Deployments: write** | OK. Using curl `-d` without a Content-Type header is accepted by the API |
| `DELETE /repos/{o}/{r}/deployments/{id}` | → **204**; "if the repository has more than one deployment, you can only delete inactive deployments"; classic `repo` or `repo_deployment`; fine-grained Deployments: write | OK, the order is inactive → delete |
| `DELETE /repos/{o}/{r}/actions/runs/{run_id}` | Delete a workflow run → **204**; write access; fine-grained **Actions: write** | OK |
| 4c re-check expects 404 | Get endpoints return 404 when the resource is not found (I confirmed with a nonexistent id: 404) | OK |
| Headers | Examples use `Accept: application/vnd.github+json`, Bearer auth. The docs' current version is `2026-03-10`; the plan's `2022-11-28` is **supported until 2028-03-10** (API versions page) | OK |
| Token | `git credential fill`, not echoed, then `unset TOKEN` | OK. If no credential is stored, Git Credential Manager will prompt; that is acceptable |

## Base checks (all PASS)

- **GitHub:** `git ls-remote` is unchanged: main = 6804c62c94e28c71e6ef2d6ec846c5fd11cd5f76, v1.0.0 = 32ace907…, v1.1.0 = 12782e92….
- **Mirror refs:** main = e587cae…, tags = 32ace907… and 12782e92… (peeled 35db23b… and 301b65d…). There are no other refs.
- **Parent:** `e587cae^` = 623bcf4c9b92d298a3d17032934f810c7a966ff4, the rewrite I reproduced byte for byte in round 1, with an identical commit map.
- **R5 diff:** `git diff --name-status 623bcf4 e587cae` = the same 8 files (README.md, docs/history/COMMIT-MAP.md, docs/history/README.md, docs/relay/OPEN-ITEMS.md, docs/tasks/00-README.md, docs/tasks/WP20-history-purge.md, docs/tasks/reports/WP20-IMPLEMENTATION.md, img/README.md). Round-1 → round-2 differences are limited to README, OPEN-ITEMS, the report and img/README.
- **Trailers:** Co-Authored-By: Claude Opus 5.5 and Claude-Session (`interpret-trailers --parse`). The author date is kept; the committer date is the amend time.
- **Purge, on a fresh clone of the mirror after reflog expire and `gc --prune=now`:**
  - both blobs absent (`cat-file -e` exits 1);
  - `fsck --full` clean;
  - 322 commits;
  - image scan: 23 image blobs, 0 with GPS or serial;
  - the serial occurs in **0 of 2126 objects**.
- **Tests on a checkout of e587cae:**
  - `node --test test/` (Node 24.20.0, `VTOL_JSDOM` set): 310 tests, 310 pass, 0 fail, 0 skipped;
  - `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours` and `gen_test_vectors.py --check`: exit 0;
  - `vtolgcs.protocol --selftest`: OK.
- **Lease for e587cae**, pushing from a copy of the mirror into bundle-based local stand-ins (`verify\WP20\lease2`):
  - remote at 6804c62 → `+ 6804c62...e587cae (forced update)`, exit 0;
  - remote moved forward → `[rejected] (stale info)`, exit 1, remote unchanged;
  - tags untouched in both cases.
  - The command in §2 is unchanged and correct.

## My scan of S (for R2-1)

Method (`verify\WP20\scripts\findcopies.py`), reading every regular file under `S\`:

- 113,520 files read; git `objects/` directories are queried through git instead of being read.
- Files are compared by git-blob SHA-1 with both ids.
- Members of zip files are checked the same way (including `ci-logs/*.zip`).
- `data:image/*;base64` URIs in any file are decoded and checked.
- Every image (by magic bytes) is compared by dHash-256; 7,471 images.
- The bytes of every file are searched for the serial (paths reported, value never printed).
- All 85 git object stores are queried with `cat-file -e` for both ids.

A second, crop-tolerant pass (`simall.py`, every image of at least 200 px against centre and offset crops of both photos) is reported below.

Results:

- **Git stores containing a blob: 70.** These are exactly the stores in `photo-copies.txt`, plus my two round-2 stand-ins `verify/WP20/lease2/r-ok.git` and `lease2/r-moved.git`.
- **Files byte-identical to a blob:** `wp20/blobs/b32c311….jpg`, `wp20/blobs/c65b4da….jpg`, `wt/WP01/img/fpv_drone.jpg` and `wt/WP03/img/fpv_drone.jpg` (all in the plan).
- **Visually identical copies:**
  - `verify/WP04/opt/orig/img/fpv_drone.jpg` and `.webp` (1600×1060; in the plan);
  - **`wp22/downloads/preview/p3.jpg`** (960×636; **not in the plan**, R2-1).
  - No visual copy of c65b4da exists anywhere other than its blob file.
- **Image data URIs:** none in any file.
- **The serial:** found only in the three b32c311 byte copies (`wp20/blobs/…`, `wt/WP01`, `wt/WP03`). It is in no text file, report or log.
- **Non-zip archives** (PyInstaller `.pkg`/`.pyz` under `verify/WP08b/mergeclone/gcs/build|dist`) were not unpacked. They package the GCS Python code, and their plain `_internal/` data files were scanned.
- Only `S\` was scanned, as asked.

### The crop-tolerant pass (supplementary) and the scan's limits

**Complete passes:** every file under `S\` was checked by git-blob hash, for the serial, and by a full-image dHash-256 (7,471 images); all 85 git stores were queried; zip members and data URIs were checked. These passes **finished**: 39 s, `findcopies-out.txt`.

**The crop-tolerant pass** (every image of at least 200 px against 108 crops of each photo) is slow on the 4928 px images. It ran in several timed slices (`simall-out.txt`, `simrest-out.txt`, `simrest3-out.txt`).

- **Covered:**
  - everything in `S\` alphabetically up to and including `verify\WP09`;
  - `verify\WP10`–`WP20`, with site-packages and node_modules skipped;
  - `wp06`–`wp19`;
  - `wp20`;
  - `wp22\downloads\` top level;
  - `wp22\downloads\preview` (separate run).
- **Not covered** (the last slice was stopped by PID at the PM's request): the rest of `wp22` (`originals`, `staging`, `dropped`, `research`, `tools`) and `wt\*`. I compared `wp22\staging\rep_fpv_quad.jpg/.webp` and `wp22\downloads\originals\commons_Dron-fpv.jpg` individually: no match (crop-tolerant distance 110–112). `wt\*` holds the repo's own images and the two b32c311 byte copies that the hash pass found.
- **Hits:**
  - true hits: only the copies already listed above (WP04 opt, `wp20/blobs`, `wp22/.../p3.jpg`);
  - **false positives:** c65b4da at distance 19–44 against near-blank pages and diagrams (`verify\WP09\shots\kneeboard-p9/p10/p11.png`, `manual-emergency-p1.png`, a pygame docs diagram, `wp22\downloads\ap_gps-mast.jpg`). I inspected kneeboard-p11 visually: an almost empty page header, which matches a plain background crop of the photo. No real crop of c65b4da exists anywhere.

**Other limits:**

- Only `S\` was scanned.
- PyInstaller `.pkg`/`.pyz` archives were not unpacked.
- The dHash similarity would miss heavily edited derivatives (recoloured, rotated, composited).

While viewing the result I made one temporary thumbnail of c65b4da in `verify\WP20\`. I deleted it straight away.

## What round 3 needs

1. PUSH-PLAN §7: add `wp22/downloads/preview/p3.jpg`, remove the claim that wp22 holds no copy, describe the finder's limit, fix 53 → 52, and add `verify/WP20/lease2/*.git` (R2-1).
2. Report §6 (amend R5 on `623bcf4` again) and PUSH-PLAN §5: b32c311 is a public CC BY-SA Commons file with its EXIF intact, so Support will very likely decline (R2-2). Update the new main hash in PUSH-PLAN.
3. Nothing else changes. Everything below R5 and the rest of R5 are verified.
