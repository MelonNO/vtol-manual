# HANDOFF verification — round 1

VERDICT: REJECTED

Subject: commit `78e0672` on local `main` (not pushed). It adds `docs/HANDOFF.md` and pointer edits to `CLAUDE.md`,
`README.md`, `docs/tasks/00-README.md` and `docs/tasks/01-COMMON-CONTEXT.md`.
Work folder: `V` = `...\scratchpad\verify\HANDOFF`, logs in `V\logs\`.

The document is accurate. Every factual claim I checked is true, and every §2 command passed on this machine.
I am rejecting it for one reason: on a new Windows computer with the default PowerShell execution policy, two of
the §2 commands (`npm install …` and `..\vtol-tools\node_modules\.bin\html-validate …`) fail in Windows PowerShell
5.1. See finding 1. The fix is small.

## 1. New-computer simulation (§2)

Setup:
- `git clone https://github.com/MelonNO/vtol-manual.git V\clone`
- `git fetch <local repo> main`, then `git checkout --detach FETCH_HEAD`
- HEAD = `78e0672c9fe4c751587fa8dc456964451a127c75`

Fresh venv and tools, created exactly as written. Because the commands run from `V\clone`, `..\vtol-venv` and
`..\vtol-tools` resolve to `V\vtol-venv` and `V\vtol-tools`, so the document's layout works unchanged. I did not
reuse the old `scratchpad\venv` or `scratchpad\jsenv`.

Environment:
- Windows PowerShell 5.1.26100
- `py -3.12` → Python 3.12.10
- Node v24.20.0 and npm 11.19.0, with `C:\Program Files\nodejs` prepended to PATH for the session only
- Process execution policy here is Bypass; CurrentUser and LocalMachine are RemoteSigned. See finding 1.

| # | Command (as in HANDOFF §2) | Result |
|---|---|---|
| S1 | `py -3.12 -m venv ..\vtol-venv` | PASS (exit 0) |
| S2 | `..\vtol-venv\Scripts\python -m pip install "pytest>=9.1,<9.2" pygame-ce` | PASS. Installed pytest-9.1.1, pygame-ce-2.5.8 |
| S3 | `npm install --no-save --prefix ..\vtol-tools jsdom@30.1.3 html-validate@11.16.2` | PASS ("added 48 packages"). Fails under the default Restricted policy (finding 1) |
| S4 | `$env:VTOL_JSDOM = (Resolve-Path ..\vtol-tools\node_modules\jsdom).Path` / `$env:VTOL_PYTHON = …` | PASS (both resolve) |
| C1 | `node --test test/` (VTOL_JSDOM set) | PASS: `tests 312, pass 312, fail 0, cancelled 0, skipped 0` |
| C2 | `node scripts/gen-precache.mjs --check` | PASS: `sw-precache.js up to date (59 assets)` |
| C3 | `node scripts/diagrams/build.js --check` | PASS: `diagrams up to date (16 SVG files, manual slots and inline SVGs)` |
| C4 | `node scripts/gen-params-reference.mjs --check` | PASS: `data/params-reference.js up to date (1663 parameters)` |
| C5 | `node scripts/check-links.mjs; node scripts/check-images.mjs; node scripts/check-colours.mjs` | PASS, all three. `every internal link and asset resolves` / `39 images within budget` / `no hard-coded colours` |
| C6 | `..\vtol-venv\Scripts\python gcs/tools/gen_test_vectors.py --check` | PASS: `up to date` |
| C7 | `..\vtol-tools\node_modules\.bin\html-validate index.html manual.html relay/map.html tools/latency-clock.html` | PASS: `✖ 169 problems (0 errors, 169 warnings)`, exit 0. Resolves to `html-validate.ps1` (finding 1) |
| C8 | `$env:VTOLGCS_INTERACTIVE_TESTS = '0'; ..\vtol-venv\Scripts\python -m pytest gcs protocol -p no:cacheprovider` | PASS: `700 passed, 7 skipped in 138.85s`. The header says `interactive_desktop tests SKIPPED (VTOLGCS_INTERACTIVE_TESTS=0)` |
| extra | the CI step `cd gcs; python -m vtolgcs.protocol --selftest` (not in HANDOFF, finding 3) | PASS: `SELFTEST OK` |

After all runs, `git status --short` in the clone is clean; only ignored `__pycache__` directories were added. I
ran no desktop-only tests and opened no UI windows.

Execution-policy check: I ran a child `powershell.exe -ExecutionPolicy Restricted` from the clone, logged to
`V\logs\restricted-policy.txt`. Restricted is the Windows client default. In that shell:
- `npm --version` fails with "npm.ps1 cannot be loaded because running scripts is disabled on this system";
- `..\vtol-tools\node_modules\.bin\html-validate …` fails the same way (`html-validate.ps1`);
- `npm.cmd --version` works (11.19.0).

## 2. Claim-by-claim table

| § | Claim | Result | Evidence |
|---|---|---|---|
| 1 | Release v2.0.0 is published at …/releases/tag/v2.0.0 | TRUE | API `releases/tags/v2.0.0`: draft false, prerelease false, published 2026-10-18T12:35:22Z; the page returns HTTP 200 |
| 1 | The tag points at `3df2cd4` | TRUE | Annotated tag object `cd581bf` → commit `3df2cd48b49e…`; local `git rev-parse v2.0.0^{commit}` gives the same |
| 1 | Asset `vtol-gcs-v2.0.0-windows-x64.zip` | TRUE | Release assets: that one name, 23,268,772 bytes, state uploaded |
| 1 | Pages, GCS app and `js/version.js` are all 2.0.0 | TRUE | `js/version.js:4` `app: '2.0.0'`; `gcs/vtolgcs/__init__.py:24` `__version__ = "2.0.0"`; `gcs/pyproject.toml:7` `version = "2.0.0"` |
| 1 | `main` is the only branch on GitHub | TRUE | API `branches`: only `main` (0d752a9) |
| 1 | Every check is green (CI, GCS build, Pages) | TRUE | API runs on main: 0d752a9 has CI, GCS build and pages-build-deployment, all success; 3df2cd4 (and the v2.0.0 tag runs) all success. 78e0672 is not pushed yet, so this must be re-checked after the push |
| 1 | No open PRs or issues | TRUE | API `pulls?state=open` = 0, `issues?state=open` = 0, repo `open_issues_count` 0 |
| 1 | Pages are live at melonno.github.io/vtol-manual/ | TRUE | HTTP 200 |
| 1 | WP01–WP22 are implemented, verified and merged, except WP20 (cancelled); the board is `00-README.md` | TRUE | Status board rows WP01…WP22 (08a/08b); WP20 "cancelled … no"; 22 WP merge commits on main |
| 1 | The plan's Rev C is in §15 and overrides older values | TRUE | `SOFTWARE-IMPROVEMENT-PLAN.md:11` and `:1166` |
| 1 | No work exists only on the old PC | TRUE once 78e0672 is pushed | Local `main` is 1 ahead of `origin/main` (this commit); there are no other branches, stashes or worktrees |
| 2 | Node 24, Python 3.12, jsdom 30.1.3, html-validate 11.16.2, pytest pin `>=9.1,<9.2` match ci.yml | TRUE | `ci.yml` env block and the `pip install` lines |
| 2 | The three `--check` commands, the link/image/colour checks and the vectors `--check` match CI | TRUE | ci.yml web job and python-portable job. CI also runs `vtolgcs.protocol --selftest`, which the list omits (finding 3) |
| 2 | The html-validate page list matches CI | TRUE | ci.yml: `index.html manual.html relay/map.html tools/latency-clock.html` |
| 2 | pytest pin rationale is in gcs/README.md "Upgrading pytest" | TRUE | `gcs/README.md:512` |
| 2 | Desktop-only tests are required before each release (M-16; gcs/README "Tests") | TRUE | OPEN-ITEMS M-16; `gcs/README.md:434`, `:469` |
| 2 | Pages and Node tests run on Linux/macOS | TRUE (Linux shown by CI) | The ci.yml web job runs on ubuntu-24.04 |
| 2 | Every command in the setup and CI blocks works | TRUE here; FALSE on a default-policy PC | §1 table; finding 1 |
| 3 | The process (brief → worktree impl → separate verifier → rework to APPROVED → PM `--no-ff` merge) | TRUE | `00-README.md` process 1–5; `01-COMMON-CONTEXT.md` §4–§6; `03-VERIFICATION-PROTOCOL.md`; merge commits on main |
| 3 | The next free number is WP23 | TRUE | Briefs and reports go up to WP22; no WP23+ anywhere; no `wp/*` branches locally or on GitHub |
| 3 | Verifier reports go in `docs/tasks/reports/WPnn-VERIFY-roundN.md` | TRUE (final place) | 03 has the verifier write to `S\verify\<WPxx>\` and the PM copy it in (finding 6) |
| 3 | Standing rules (PID only, no elevation, agents never push, no force-push, untrusted downloads, no serial, TBD not invented) | TRUE | 01 §2.8, §4; CLAUDE.md "Never force-push `main`"; CONTRIBUTING:9; README "Releases and rollback" |
| 3 | `S\venv` / `S\jsenv` map to `vtol-venv` / `vtol-tools` | Partly | 01 §3 says S\venv has **Pillow**; the §2 venv does not (finding 2) |
| 3 | GitHub job logs and artifacts need a login | TRUE | API `/actions/runs/<id>/logs` returns 403 without auth |
| 3 | README has "Tagging a release" and "Rolling back" | TRUE | `README.md:140`, `:166` |
| 4 | Relay design `.md` + `.pdf` in `Downloads\Docs\` | TRUE | Both files present (dated 2026-10-16); plan line 8 "latest revision received 2026-10-16" |
| 4 | *VTOL Manual Changes Needed…* `.md` + `.pdf` in `Downloads\docs2\` | TRUE | Both present |
| 4 | `params.param` is byte-identical to `docs/reference/carrier-params-2026-10-17.param` | TRUE | `cmp` identical, both in the working tree and against the git blob; SHA-256 `2eb324cc…9e460` for both |
| 4 | `T2_20250809_VTOL_PNP_FC.param` is in `Downloads\Docs\` and not needed | TRUE | Present; nothing in the repo cites it |
| 4 | No other out-of-repo file that a requirement source cites is missing | TRUE | `git grep` for Downloads, `C:\Users`, `.param`: only the relay design (01, CLAUDE, CONTRIBUTING), docs2 `.md` (WP10 brief) and `params.param` (WP14 brief); all are in §4. Ignoring `S\...` scratch paths |
| 5 | C-1: the four vendor images; Heewing terms and SIYI "All Rights Reserved"; no open replacement (WP22) | TRUE | OPEN-ITEMS C-1; `img/README.md:80-83`; WP22 report line 12 |
| 5 | O-9, O-10, O-1/O-2, O-3, O-4, O-7, O-8, O-11, O-13–O-15, O-17 are open, with matching meanings | TRUE | OPEN-ITEMS rows 63–79. O-5, O-6, O-12 and O-16 are closed or resolved and correctly not listed as open |
| 5 | M-12 items, and the GIL switch interval went from 0.5 ms to 1 ms in WP18 (`runtime.py`) | TRUE | M-12 row; `runtime.py:68` `GIL_SWITCH_INTERVAL_S = 0.001`; `git log -G`: fabbbfb (WP18) changed `0.0005` → `0.001`; applied at `:184` |
| 5 | M-16, M-19, M-20, the "Known minor follow-ups" table, D-1…D-6 | TRUE | OPEN-ITEMS rows 53, 56, 57, §6, §5 |
| 5 | M-1…M-11 come "after the relay is built (H-1, H-2)" | Imprecise | M-1/M-2 are SITL and M-3 needs only the HM30; they can be done now (finding 5) |
| 5 | Nothing that matters is missing | Mostly | M-13 (browser ↔ local API on the target laptop) and C-3 (VERIFY markers) are open and doable now but not named (finding 5) |
| 6 | O-5: the photo stays in history, no rewrite, no GPS, Commons / Commanderbryce / CC BY-SA 4.0, credited in img/README | TRUE (simplified) | OPEN-ITEMS O-5; `img/README.md:88`. O-5 also notes that a smaller historical version carries a "© sanaan" notice (finding 7) |
| 6 | O-6: `CONVERSATION_LOG.txt` is kept | TRUE | OPEN-ITEMS O-6 |
| 6 | Release number v2.0.0, with the GCS app versioned together with the pages | TRUE | WP21 brief line 16; CHANGELOG:12 |
| 6 | Internet images: openly licensed only, marked "Representative image" | TRUE | `img/README.md:10`, `:84-85`, `:94` |
| 6 | Flight-safety intent (fails safe only on SIYI/GCS loss; 915 = backup; never auto-resumes) | TRUE | CLAUDE.md "Owner decisions…"; plan §1.1 |
| 7 | No worktrees other than the main one | TRUE | `git worktree list`: one entry, `repo\vtol-manual 78e0672 [main]` |
| 7 | No local `wp/*` branches | TRUE | `git branch -a`: `main`, `origin/main`, `origin/HEAD` |
| 7 | No `refs/remotes/pm/*` (stale `pm/main` removed) | TRUE | `for-each-ref refs/remotes/pm` is empty; only remote is `origin` |
| 7 | Every former `wp/*` commit is in `main`; nothing lost | TRUE | `git branch --no-merged main` empty; 22 WP merge commits on main (`log --merges`). A read-only `fsck --unreachable --no-reflogs` finds 3 unreachable commits, all superseded: `800e211` (amended 22 s later into `cbc4ce9`, which is on main and fixes the same lines correctly) and a dropped 2026-10-17 stash "WIP on wp/07" (`6356fbc`/`4995998`), whose three file versions are blobs in WP07 commits `ee3a497`/`d70cccf`, both on main |

## 3. Pointer edits

- **CLAUDE.md** (+3 lines): a bold lead-in paragraph after the intro, in the file's style. Accurate and minimal.
- **README.md** (one sentence in "Open items"): accurate. It might sit better under "Development", but that is a
  wording preference.
- **docs/tasks/00-README.md** ("Update (2026-10-18)" paragraph): matches the existing "Final state" paragraph's
  style. Accurate: WP17–WP22, WP20 cancelled, tag on 3df2cd4, zip attached, next WP23.
- **docs/tasks/01-COMMON-CONTEXT.md** (2 lines before the §3 table): accurate. However, the path mapping it points
  to does not cover two things: the Pillow difference (finding 2) and the relay-design path in 01 §1 (finding 4).
- `node --test test/` still passes with all of these edits: 312/312, 0 skipped.

## 4. Fresh-reader test (CLAUDE.md → HANDOFF.md → 00-README.md)

- **What to do next.** Clear enough. The programme is finished. There are owner decisions to raise (C-1 first),
  field checks for the owner, and a WP23 bundle of small follow-ups. The "Resuming with Claude Code" prompt is a good
  start. 78e0672 itself still has to be pushed, and the handoff assumes it will be.
- **How to run the PM process.** Clear. §3 summarises 00/01/03 correctly and gives the worktree command and the path
  mapping. The standing rules forbid force-push, inventing values and skipping verification. I found nothing that
  encourages unsafe behaviour.
- **Missing files and where they are.** Clear. The §4 table names each file, its folder on the owner's PC and
  whether it is needed. One gap: 01 §1 still points at the absolute `C:\Users\Simulator\Downloads\Docs\…` path, and
  nothing tells the PM where the copied relay design should go or that briefs must give its new path (finding 4).
- **Where a new person would stumble.** The default PowerShell execution policy (finding 1). The session-only
  environment variables, and `$env:VTOLGCS_INTERACTIVE_TESTS = '0'` still being set if the desktop-only run follows
  in the same window (finding 8). `python -m http.server` when python.org's installer did not add `python` to PATH
  (finding 9).

## 5. Findings

1. **MAJOR — HANDOFF §2, setup block (`npm install …`) and CI block (`..\vtol-tools\node_modules\.bin\html-validate …`).**
   - **What is wrong:** in Windows PowerShell 5.1 these resolve to `npm.ps1` and `html-validate.ps1`. On a new
     Windows client the default execution policy is Restricted, so both fail with "cannot be loaded because running
     scripts is disabled on this system". I reproduced this in `V\logs\restricted-policy.txt`. They pass on this
     machine only because CurrentUser/LocalMachine are RemoteSigned and the tool shell is Bypass. On a new computer,
     the first setup command that touches Node fails.
   - **Expected:** use `npm.cmd install …` and `..\vtol-tools\node_modules\.bin\html-validate.cmd …`. These work
     under any policy; I verified `npm.cmd`. Alternatively, add a one-line note that Windows PowerShell needs
     `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` first.

2. **MINOR — HANDOFF §2 venv and §3 "Paths on a new computer".**
   - **What is wrong:** §3 says `S\venv` is the §2 `vtol-venv`. 01 §3 describes `S\venv` as having Pillow, pytest and
     pygame-ce, but the §2 venv installs only pytest and pygame-ce. Pillow is needed by `scripts/optimize-images.py`,
     `scripts/gen-icons.py` and the img/README EXIF check, i.e. exactly the C-1 own-photos work.
   - **Expected:** add `Pillow` to the §2 `pip install` line, with a note that CI does not need it, or say so in §3.

3. **MINOR — HANDOFF §2 "Run everything CI runs".**
   - **What is wrong:** CI also runs `cd gcs; python -m vtolgcs.protocol --selftest`, which is missing from the list.
     It passed here. CI also runs the GCS suite ×5 and the workflow test with `VTOL_REQUIRE_WORKFLOW_TEST=1`.
   - **Expected:** add the selftest line, or reword the heading to "the CI checks (once each)".

4. **MINOR — HANDOFF §3/§4 and the 01 pointer.**
   - **What is wrong:** the relay-design path in 01 §1 (`C:\Users\Simulator\Downloads\Docs\…`) and the
     "Main repo `S\repo\vtol-manual`" row are not mapped. §4 says "Copy it to the new computer" but not where, and
     not that each brief must give its new path. The 01 pointer says §2–§3 cover the mapping.
   - **Expected:** one sentence in §3: the main repo is the §2 clone, and the relay design goes wherever the owner
     copies it; the PM writes both paths into every brief.

5. **MINOR — HANDOFF §5 "Field and bench checks".**
   - **What is wrong:** "M-1…M-11 … after the relay is built (H-1, H-2)" is imprecise. M-1 (S-01a, safety-relevant)
     and M-2 are SITL and M-3 needs only the HM30, so all can be done now. M-13 (browser access to the local API on
     the target laptop, with the app running) is open, doable now and not named. C-3 (VERIFY markers) is also not
     named.
   - **Expected:** split the line into "M-1–M-3: SITL/HM30, possible now" and "M-4–M-11: after H-1/H-2", and add M-13
     next to M-12.

6. **MINOR — HANDOFF §3 step 3.**
   - **What is wrong:** "Its reports go in `docs/tasks/reports/WPnn-VERIFY-roundN.md`". Per 03 the verifier writes
     `S\verify\<WPxx>\VERIFY-round<N>.md` outside the repo, and the PM copies it in after merging.
   - **Expected:** say both, so that a new PM does not ask the verifier to write into the worktree.

7. **MINOR — HANDOFF §6 O-5.**
   - **What is wrong:** "It is Wikimedia Commons *Racing Drone.jpg* by Commanderbryce" is true of the 4.2 MB
     version. O-5 records that a smaller historical version (blob `c65b4da`) carries a "© sanaan" notice.
   - **Expected:** "its 4.2 MB version is …", or a pointer to O-5 for the details.

8. **MINOR — HANDOFF §2 environment and desktop-only note.**
   - **What is wrong:** `$env:VTOL_JSDOM`, `$env:VTOL_PYTHON` and `$env:VTOLGCS_INTERACTIVE_TESTS` last only for the
     session. In a new window the jsdom tests are silently skipped. In the same window, the desktop-only run
     ("without `VTOLGCS_INTERACTIVE_TESTS=0`") still has it set to 0. M-16's header check catches this, but HANDOFF
     does not mention it.
   - **Expected:** a note "re-set in each new PowerShell window"; for the desktop run, `Remove-Item Env:VTOLGCS_INTERACTIVE_TESTS`
     and check that the header says `interactive_desktop tests RUN`.

9. **MINOR — HANDOFF §2 "Viewing the pages".**
   - **What is wrong:** `python -m http.server 8000` relies on `python` being on PATH. python.org's installer does
     not add it by default; §2 itself uses `py -3.12`.
   - **Expected:** `py -3.12 -m http.server 8000` or `..\vtol-venv\Scripts\python -m http.server 8000`.

10. **MINOR — HANDOFF §3 step 4, "owner approval: 'Push to main'".**
    - **What is wrong:** a new session could read this as a standing licence to push. It sits next to CONTRIBUTING:9
      ("never commit straight to `main`") and CLAUDE.md ("prefer normal commits and pull requests") without
      explaining the PM exception.
    - **Expected:** say whether the approval is standing for PM merges after verification, and that it covers only
      `--no-ff` merges plus PM record commits (never force).

## 6. Rationale

- Every factual claim in HANDOFF.md that I could check is true:
  - GitHub state: tag, release, asset, branches, PRs/issues, CI;
  - versions;
  - the status board and the WP23 number;
  - the files outside the repo and the `params.param` byte identity;
  - the open-item IDs and statuses, and the WP18 switch interval;
  - the decisions;
  - the §7 cleanup state.
- Unreachable objects exist in the local repo, but nothing of value was lost; every one is superseded by content
  on main.
- On a fresh clone, all §2 commands passed: 312/312 Node tests with 0 skipped, all `--check`s, all checks,
  html-validate with 0 errors, and the GCS suite at 700 passed / 7 skipped in CI mode.
- The pointer edits are accurate and minimal, and the tests still pass.
- Finding 1 means that, on a new Windows computer with the default execution policy, the document's own setup
  command (`npm install`) and the html-validate check fail in Windows PowerShell 5.1. The brief requires a reject on
  any setup command that fails, and this is exactly the new-computer case the document is for. Finding 1 is
  therefore MAJOR and the verdict is REJECTED.
- Fixing finding 1 (`npm.cmd`, `html-validate.cmd`, or an execution-policy note) is enough for approval.
- Findings 2–10 are MINOR and do not block. Findings 2, 4 and 5 are worth fixing at the same time.

Process note: one throw-away temp file was accidentally written to Git Bash `/tmp` (an empty grep redirect) and
deleted straight away. Nothing else was written outside V. The local repository and GitHub were only read. I ran
`git fsck` without `--lost-found`, which writes nothing.
