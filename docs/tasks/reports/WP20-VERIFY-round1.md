VERDICT: REJECTED

# WP20 verification, round 1 (history purge of img/fpv_drone.jpg)

Date: 2026-10-18. Verifier work: `S\verify\WP20\` only. No push to GitHub. `S\wp20\`, `S\repo\vtol-manual` and `S\wt\*` were not modified: only read-only commands were used there, with `GIT_OPTIONAL_LOCKS=0`. The camera serial's value is not written anywhere. It was read only in memory, inside the scanning process.

## Verdict in one paragraph

**The rewrite itself is correct and safe.** I reproduced it bit for bit: my own `git filter-repo` install, run on a fresh mirror of the backup bundle with the two blob ids, gives the same `main` `623bcf4` and a byte-identical commit map. Every content, metadata, purge, tag and lease check passes. There are **no MAJOR findings**.

I reject anyway, for three reasons:

- One explicit wording requirement fails: the new README sentence calls the photo "GPS-tagged" (F1).
- The push plan's local re-sync section makes a wrong claim and leaves out the PM repo's real state (F2).
- The plan does not deal with the GitHub-side references to the photo commits (F3).

All three fixes are confined to the R5 commit and `PUSH-PLAN.md`. **No new filter-repo run is needed.** Amend `5957652` on top of the unchanged `623bcf4`, update the plan with the new hash, and round 2 only has to re-check the R5 commit and the plan.

## Findings

| ID | Grade | Finding | Evidence | Fix |
|---|---|---|---|---|
| F1 | MINOR | **The README "Releases and rollback" sentence makes a GPS claim.** It reads: "a one-time `git filter-repo` purge of an old **GPS-tagged** photo". The photo carried no GPS position. Its GPS IFD holds only tag 0 (GPSVersionID). The reasons were the camera body serial (b32c311) and a third-party copyright notice (c65b4da). The sentence also contradicts O-5 ("a GPS block without a position") and img/README. The implementer's report §11 admits "GPS-tagged" is inaccurate, but it then wrote the phrase into new README text. | `git diff 623bcf4 5957652 -- README.md`. My scan: b32c311 GPS IFD keys = `[0]`, no tags 1–4 | Reword, for example: "a one-time `git filter-repo` purge of an old photo (a camera body serial number in one version, a third-party copyright notice in the other)". Optional: the report title and the O-5 title keep "GPS-tagged" from the brief. That is acceptable as a quoted title, but "old photo" would be cleaner |
| F2 | MINOR | **PUSH-PLAN §5 (PM repo re-sync) is incomplete, and step 4 claims something false.** (a) `S\repo\vtol-manual` is a **shallow** clone: `is-shallow-repository` = true, shallow boundary `7376503`, 159 commits. The plan does not say so. (b) The repo has a stale `refs/remotes/pm/main` (`d10dca7`, old history, no `pm` remote configured). It keeps `b32c311` reachable. Step 4's `reflog expire` + `gc --prune=now` "to drop the old blobs locally" will **not** drop them while that ref, any `wp/*` branch or any worktree HEAD exists. (c) "Delete or rebuild the stale `wp/*` branches and worktrees" gives no commands. After the reset, `git branch -d` refuses (the branches are not merged into the *new* main), so the PM will need `-D`. That is safe only because of the check below; the plan should contain that check. | `git rev-parse --is-shallow-repository` → true; `.git/shallow` = 7376503…; `git rev-list --all --objects` in the PM repo still lists `b32c311` | Add exact commands, in this order: (1) a pre-check loop `for b in $(git for-each-ref --format='%(refname:short)' refs/heads/wp); do git rev-list --count 6804c62c94e28c71e6ef2d6ec846c5fd11cd5f76..$b; done`, which must print 0 for every branch; (2) `git worktree remove S/wt/WPxx` for each worktree (it refuses if the worktree is dirty, which is good); (3) `git branch -D wp/…`; (4) `git update-ref -d refs/remotes/pm/main`; (5) fetch and reset; (6) only then reflog expire and gc. Note the shallow state. A fresh non-shallow re-clone of the PM repo is the simplest alternative |
| F3 | MINOR | **GitHub-side references to the photo commits are not addressed** (my task item 8, "Pages deployments"). GitHub holds **5 `github-pages` deployment records** and **5 "pages build and deployment" workflow runs** on commits whose tree contains `img/fpv_drone.jpg`. That is 9 deployments and 17 runs on rewritten commits overall. They keep links to the old commits on GitHub after the push. Their artifacts have already expired: only 13 artifacts exist, all built on commits after `3721cd4`, none containing the photo. There are 0 Actions caches. | Public API, read-only: `/deployments`, `/actions/runs`, `/actions/artifacts`, `/actions/caches`. Table below | Add an optional plan step: after the push, delete those 5 runs and the 5 deployment records (set each deployment inactive, then DELETE it, via UI or API). Mention them in the Support request. Also set expectations: GitHub docs say "GitHub Support won't remove non-sensitive data" and that Support only helps when rotating credentials can't mitigate the risk. The request may be declined, especially for the copyright-only blob c65b4da (the report already notes this for c65b4da) |
| F4 | MINOR (nits) | **Small accuracy issues in the evidence.** (a) Report §4 presents a cleaned-up excerpt as "Output (`S\wp20\filter-repo.log`)". The real log also contains the `git remote` "Note: A branch outside the refs/remotes/ hierarchy was not removed…" lines, the "Parsed 198 commits" progress line and "Repacking your repo…". (b) R2 table: `dfec6fd` (`img/matek_f405.jpg`) is listed with metadata "none", but it has a JPEG COM segment "CREATOR: gd-jpeg v1.0 (using IJG JPEG v62), quality = 82". It is harmless, but "none" is wrong. (c) `S\wp20\msg-changed.txt` is a stale leftover from attempt 1 (`782847c → 16d68d0`); the correct value is `6678855`, which the report states. (d) `S\wp20\attempt1\vtol-manual.git` is a second rewritten mirror (main `35f684a`) that **still contains c65b4da**. The plan pins the right directory and pre-checks `main = 5957652`, so the risk is low, but it should be deleted after the push | `cat -A S\wp20\filter-repo.log`; my metadata dump | Label the excerpt as abridged, or paste the log verbatim; fix the dfec6fd row; delete or annotate the leftovers |

GitHub references to commits whose tree contains the photo:

| Old commit | Blob in tree | Deployment id | Pages run id |
|---|---|---|---|
| c70e4b0 | c65b4da | 5101784488 | 27724725333 |
| 32f56bb | c65b4da | 5101836170 | 27724995217 |
| 7376503 | b32c311 | 5112072250 | 27773346011 |
| 8609004 | b32c311 | 7124918486 | 38937128912 |
| 924d0a8 | b32c311 | 7125805114 | 38942732665 |

## Checks performed (all independent; the implementer's proofs and scripts were not used)

Clones in `S\verify\WP20\`:

- `gh.git`: a fresh `clone --mirror` of GitHub.
- `bundle.git`: from the backup bundle.
- `new.git`: from the rewritten mirror.
- `repro.git`: my own filter-repo run.
- `co`: a checkout of 5957652.
- `lease\`: the stand-in remotes.

My scripts are in `scripts\` (`compare.py`, `scan.py`, `detail.py`).

### 1. Remote state: PASS
- `git ls-remote` (start and end of the session, identical):
  - `main` and `HEAD` = 6804c62c94e28c71e6ef2d6ec846c5fd11cd5f76;
  - `v1.0.0` = 32ace907… (peeled 35db23b…);
  - `v1.1.0` = 12782e92… (peeled 301b65d…).
- `git bundle verify`: OK, "complete history".
- Bundle versus GitHub clone: identical refs, symbolic HEAD and object types. The full reachable object set is identical: 2112 objects each, `diff` empty. The `cat-file --batch-all-objects` listings also hash identically.

### 2. Content identity: PASS
- `623bcf4^{tree}` = `6804c62^{tree}` = 52f073635902b37591a1af7b8b6e1aeb5bf4fa26.
- `compare.py` paired all 321 commits through the commit map and then proved the map:
  - it is a bijection between the old and new commit sets;
  - topo-order pairing agrees;
  - each new commit's parents = map(old parents), in order.
- For **every** commit: `ls-tree -r --full-tree` of the new commit = the old one minus only `img/fpv_drone.jpg`.
  - 19 commits had that path; exactly those 19 tree ids changed.
  - 0 mismatches in any other file.
- **Independent reproduction:** git-filter-repo `a40bce548d2c` in my own venv, `--strip-blobs-with-ids` with both ids on a fresh bundle mirror, gives main 623bcf4, identical tags, and a commit map byte-identical to the mirror's (`cmp`).

### 3. Metadata: PASS
- 321 commits both sides, same topo order, 22 merges preserved.
- Every raw header line other than tree and parent is byte-identical: author and committer names, emails, dates and time zones.
- No `gpgsig` headers existed, so filter-repo dropped no signatures.
- Messages are identical except **one** filter-repo short-hash update:
  - old `782847c` → new `6678855`;
  - "…first green GitHub run (35affa1)" → "(2180cfb)";
  - correct: map(35affa1…) = 2180cfba….
- `35affa1` is the only hex token in any message that prefixes a rewritten commit.

### 4. Purge completeness: PASS
- My clone of the mirror, after `reflog expire --expire=now --all` and `gc --prune=now`:
  - `cat-file -e` exits 1 for both blob ids;
  - neither id is in `--batch-all-objects`;
  - `rev-list --all --objects` shows 0 hits for either id or for `fpv_drone`;
  - `log --all -- img/fpv_drone.jpg` is empty;
  - `fsck --full` is clean.
- The physical `S\wp20\vtol-manual.git` also lacks both blobs.
- Pushing the mirror's main into an empty bare repo transfers neither blob.
- **Image scan** (`scan.py`): every reachable blob was checked by magic bytes, not only by extension. For each image, Pillow read EXIF IFD0, the Exif IFD, the GPS IFD, 0xA431, 0xA435, the maker note (Nikon type 3 parsed for 0x001D and 0x00A0), and XMP/PNG text. Raw bytes were also searched for SerialNumber and GPSLatitude/GPSLongitude.
  - Old history: 25 image blobs. Only b32c311 is flagged: NIKON D5100, maker-note serial, GPS IFD = {0} (no position). c65b4da carries "© sanaan" (EXIF Copyright and Photoshop IRB) and no GPS or serial.
  - New history: 23 image blobs, **0 flagged**, no GPS IFD in any of them.
- **Serial grep:** I read the serial from b32c311's maker note tag 0x001D in the backup (ASCII, 7 digits, never printed or stored). I searched it in all 2126 objects of the new history (blobs, trees, commits, tags): **0 occurrences**. In the old history it occurs only in b32c311.

### 5. Tags and untouched commits: PASS
- `v1.0.0` and `v1.1.0`: same object ids, and the raw tag object bytes are identical (md5).
- The 160 commits with unchanged hashes are exactly the commits that are not c70e4b0 or its descendants. The 161 rewritten commits are exactly c70e4b0 plus `--ancestry-path c70e4b0..6804c62`. All 160 exist unchanged in the mirror.

### 6. R5 commit 5957652: PASS, except F1 (wording) and F4b (report row)
- `diff --name-status 623bcf4 5957652` shows exactly the 8 allowed files:
  - the brief, byte-identical to the PM's (untracked) copy;
  - the status row `| WP20 | done (pending verification) | | |`;
  - COMMIT-MAP.md;
  - the img/README line;
  - the O-5 and O-6 rows;
  - the README sentence;
  - the docs/history/README row;
  - the report.
- **COMMIT-MAP:** I checked **all 161 rows**, not just 20. Each old hash resolves uniquely in the bundle, each new hash resolves uniquely in the mirror, the pair matches the commit map, and subject and author date match. The only difference is the 782847c subject, which shows the updated hash, as expected.
- **Wording:**
  - Both blobs are named, each with its correct reason, in O-5, img/README, COMMIT-MAP and the commit message.
  - The GitHub cache caveat and the docs link are in O-5 and the report.
  - O-6 is CLOSED, keep.
  - Exception: the README "GPS-tagged" (F1).
- **Trailers:** `interpret-trailers --parse` shows Co-Authored-By: Claude Opus 5.5 and Claude-Session (01-COMMON-CONTEXT convention). Author and committer MelonNO, 2026-10-18 03:17 +02:00.
- **Tests on a checkout of 5957652** (Node 24.20.0, `VTOL_JSDOM` set):
  - `node --test test/`: 310 tests, 310 pass, 0 fail, 0 skipped.
  - `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gcs/tools/gen_test_vectors.py --check` and `vtolgcs.protocol --selftest`: all exit 0.

### 7. Push plan: the push part PASSES; the re-sync part fails (F2)
- **The lease.** `--force-with-lease=main:6804c62…` with an explicit URL is correct here. The mirror has no remote, so no remote-tracking ref exists. The explicit `<expect>` value is therefore the only way to state a lease.
  - Git compares `<expect>` with the value the server advertises for `refs/heads/main`, and refuses with "stale info" if they differ.
  - It then sends that old value in the update command, and receive-pack applies it as an atomic compare-and-swap under the ref lock.
  - So it protects against anyone having pushed to, rewound or force-pushed GitHub's main since the clone, including a race between the plan's `ls-remote` pre-check and the push. Without it, a plain `--force` would silently discard such commits.
- **Tested** against local bare stand-ins built from the bundle, pushing from a copy of the mirror:
  - remote at 6804c62 → `+ 6804c62...5957652 (forced update)`, exit 0;
  - remote moved forward one commit → `[rejected] (stale info)`, exit 1, remote unchanged;
  - remote rewound to `6804c62^` → rejected, stale info;
  - re-run when the remote is already at 5957652 → `[up to date]`.
  - The implicit forms (`--force-with-lease` with no value, or `=main`) are **rejected even in the good case**, because no tracking ref exists. That confirms the explicit value is required.
- **No tags pushed:** `main:main` only. No `push.followTags` or other push config exists, globally or in the mirror. The stand-in's tags were untouched.
- **Branch protection on GitHub main:** off (API), so the force-push is not blocked.
- **Post-push verification steps:** I ran them against the stand-in. They give main 5957652, `main^^{tree}` = 52f07363…, both blobs absent, grep count 0, count 322, tags unchanged, fsck clean. The steps are correct.
- **PM repo safety:**
  - Every `wp/*` branch (wp/01 … wp/19, 20 branches) has **0 commits outside 6804c62**.
  - All worktrees `S\wt\*` are clean (no porcelain status output); there are no stashes.
  - The only untracked file in the PM repo is the WP20 brief, and it is byte-identical to the copy in R5. `reset --hard` will replace it with identical content, so nothing is lost.
  - So deleting the branches and worktrees loses no work, but the plan should contain the check (F2).

### 8. GitHub docs, "Removing sensitive data from a repository" (fetched 2026-10-18)
- After a force push, data may still be reachable "in any clones or forks", "directly via their SHA-1 hashes in cached views on GitHub", and "through any pull requests that reference them". Here there are 0 forks and 0 PRs (state=all), and `filter-repo/changed-refs` has no `refs/pull/*`.
- **Support request content:**
  - owner/repo;
  - the number of affected PRs, counted with `grep -c '^refs/pull/.*/head$' .git/filter-repo/changed-refs` (here 0);
  - "the First Changed Commit(s) reported by git-filter-repo" (c70e4b0…, from `filter-repo/first-changed-commits`);
  - the LFS-orphan file, if any (none here).
  - The plan's §4 matches this.
- **Support's scope:**
  - It removes cached views, dereferences PRs and runs server GC only once all non-PR references are cleaned and no fork holds the data.
  - It "won't remove non-sensitive data", and helps only when rotating credentials can't mitigate the risk. That is relevant here: a camera serial and a copyright notice are not credentials (F3).
- **Collaborators** must rebase, not merge, branches from the old history. The plan says re-clone, which is stronger.
- The docs suggest `git push --force --mirror origin`. The plan's single-ref push with a lease is the safer choice for this repository, and it is fine.
- The docs mention branch protection (off here) and that filter-repo strips signatures (none existed).
- The docs say nothing about Pages, Actions artifacts, caches, deployments or releases. I checked those myself:
  - Releases v1.0.0 and v1.1.0 are attached to the unchanged tags, with 0 assets.
  - 0 caches.
  - The artifacts are all from after the photo was deleted.
  - Deployment records and runs on the photo commits remain (F3).

## What round 2 needs
1. Amend the R5 commit on `623bcf4`: README wording (F1), the dfec6fd row and the log label (F4).
2. Update PUSH-PLAN.md with the new main hash, the re-sync commands (F2) and the GitHub-side cleanup with Support expectations (F3).
3. Leave `623bcf4` and the tags as they are. Everything below R5 is verified and reproducible.
