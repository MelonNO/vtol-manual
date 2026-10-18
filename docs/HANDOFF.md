# Handoff — picking the project up on any computer

State on **2026-10-18**. Read this first on a new computer or in a new Claude Code session. It covers:
- where things stand;
- how to set up a PC to work on the project;
- how the work is organised;
- which files live outside the repository;
- what is still open.

## 1. Where things stand

- **Release `v2.0.0`** is published at https://github.com/MelonNO/vtol-manual/releases/tag/v2.0.0.
  - The tag points at `3df2cd4`.
  - The Windows GCS app is attached as `vtol-gcs-v2.0.0-windows-x64.zip`.
  - The pages, the GCS app (`gcs/`) and `js/version.js` are all version 2.0.0. What changed is in `CHANGELOG.md`.
- **`main`** is the only branch on GitHub.
  - It holds release 2.0.0 plus PM record commits.
  - Every GitHub check is green: CI, GCS build and Pages.
  - There are no open pull requests or issues.
- **The pages** are live at https://melonno.github.io/vtol-manual/.
- **The improvement programme is finished:**
  - WP01–WP22 are implemented, independently verified and merged, except **WP20**, which was cancelled.
  - The status board is `docs/tasks/00-README.md`.
  - The plan behind it is `docs/SOFTWARE-IMPROVEMENT-PLAN.md`. Rev C is in §15 and overrides older values.
- **Everything needed to continue is in this repository**, except the owner's source documents listed in §4.
  - No work exists only on the old PC.
  - The old PC's scratch folders (worktrees, logs, backups) were deleted on 2026-10-18 (§7).

## 2. Set up a computer

You need:
- **Windows** for the GCS app and its tests;
- **Git**;
- **Node.js 24 LTS**;
- **Python 3.12** from python.org, with tkinter (the default install);
- optionally the **GitHub CLI** (`gh`).

The web pages and the Node tests also run on Linux or macOS.

```powershell
git clone https://github.com/MelonNO/vtol-manual.git
cd vtol-manual

# Python: a venv outside the repository, CI's packages (pytest is pinned, see gcs/README.md "Upgrading pytest")
# plus Pillow for the image scripts (scripts/optimize-images.py, gen-icons.py)
py -3.12 -m venv ..\vtol-venv
..\vtol-venv\Scripts\python -m pip install "pytest>=9.1,<9.2" pygame-ce Pillow

# Node test helpers: outside the repository, the versions CI uses (.github/workflows/ci.yml env).
# npm.cmd, not npm: Windows PowerShell's default execution policy blocks npm.ps1
npm.cmd install --no-save --prefix ..\vtol-tools jsdom@30.1.3 html-validate@11.16.2

# Set these in every new PowerShell window (they last only for that window; without VTOL_JSDOM the jsdom tests
# are skipped without failing)
$env:VTOL_JSDOM = (Resolve-Path ..\vtol-tools\node_modules\jsdom).Path
$env:VTOL_PYTHON = (Resolve-Path ..\vtol-venv\Scripts\python.exe).Path
```

Never add `node_modules`, a `package.json` or a venv to the repository.

**Run everything CI runs** (from the repository root; all must pass):

```powershell
node --test test/                               # with VTOL_JSDOM set: also the jsdom and page smoke tests, none skipped
node scripts/gen-precache.mjs --check
node scripts/diagrams/build.js --check
node scripts/gen-params-reference.mjs --check
node scripts/check-links.mjs; node scripts/check-images.mjs; node scripts/check-colours.mjs
..\vtol-venv\Scripts\python gcs/tools/gen_test_vectors.py --check
cd gcs; ..\..\vtol-venv\Scripts\python -m vtolgcs.protocol --selftest; cd ..
..\vtol-tools\node_modules\.bin\html-validate.cmd index.html manual.html relay/map.html tools/latency-clock.html

# GCS suite, CI mode (no windows, no console keys). CI runs it five times; once is enough locally.
$env:VTOLGCS_INTERACTIVE_TESTS = '0'; ..\vtol-venv\Scripts\python -m pytest gcs protocol -p no:cacheprovider
```

- **Desktop-only tests:** run the full GCS suite in interactive mode only on a logged-on desktop, in a normal terminal.
  - It opens Tk windows and sends keys to a real console.
  - It is required before each release (OPEN-ITEMS M-16; `gcs/README.md` "Tests").
  - In the same window as the CI-mode run, first clear the variable with `Remove-Item Env:VTOLGCS_INTERACTIVE_TESTS`.
  - Check that the pytest header says `interactive_desktop tests RUN`.
  - The commands are in `gcs/README.md` "Tests" and OPEN-ITEMS M-16, including the second run with `VTOLGCS_UI_SMOKE='1'`.
- **Plain `python` and `npx`.** Wherever `CLAUDE.md`, `CONTRIBUTING.md`, `gcs/README.md` or a brief writes `python`, use `..\vtol-venv\Scripts\python`. In Windows PowerShell, write `npx.cmd`, not `npx`; the same execution-policy rule applies as for `npm`. Git Bash needs neither change.
- **Viewing the pages:** run `..\vtol-venv\Scripts\python -m http.server 8000` in the repository root, then open http://localhost:8000/. The python.org installer does not put `python` on PATH by default.
- **Conventions and architecture:** `CLAUDE.md`. Content review rules: `CONTRIBUTING.md`.

## 3. How the work is organised

The programme was run by a **project manager (PM) who does not implement anything**. The owner set this rule, and it still applies. For each change:

1. **Brief.** The PM writes `docs/tasks/WPnn-<name>.md`: the context, the files the WP owns, MUST/SHOULD requirements and rules. The next free number is **WP23**.
2. **Implementation.** An implementation agent works in its own git worktree on branch `wp/nn`.
   - It follows `docs/tasks/01-COMMON-CONTEXT.md` (conventions, git rules, report format) and `02-CONTRACTS.md`.
   - It commits and writes `docs/tasks/reports/WPnn-IMPLEMENTATION.md`.
3. **Verification.** A **separate verification agent** checks the work against `docs/tasks/03-VERIFICATION-PROTOCOL.md`.
   - It must not approve work that is not implemented as required and in a sensible way.
   - Rework continues until it gives **APPROVED**.
   - It writes each report outside the repository, to `S\verify\WPnn\VERIFY-roundN.md`. The PM copies it into `docs/tasks/reports/WPnn-VERIFY-roundN.md` when merging.
4. **Merge and push.** The PM merges into `main` (`--no-ff`), runs the full check list in §2 and updates the status board.
   - The PM pushes `main` itself, without a pull request. A push holds only work with an APPROVED verification, or the PM's own record commits (status board, OPEN-ITEMS rows, reports, this file). It is never forced.
   - This is an owner-approved exception ("Push to main", 2026-10-16) to the normal contributor rule in `CONTRIBUTING.md`: branch, then open a pull request.
   - The exception belongs to this PM process. Anyone else, or a new person taking the PM role, confirms it with the owner first.
   - The PM watches the GitHub runs until they are green.

**Paths on a new computer.** The paths in `01-COMMON-CONTEXT.md` §1 and §3 are from the first PC. On a new computer:
- `S` (the scratchpad) is any scratch folder outside the repository.
- "Main repo `S\repo\vtol-manual`" is your clone from §2, which the PM uses for merges.
- `S\venv` and `S\jsenv` are the `vtol-venv` and `vtol-tools` folders from §2.
- Worktrees are made with `git worktree add <S>\wt\WPnn -b wp/nn main`.
- The relay design (`C:\Users\Simulator\Downloads\Docs\…` in §1) is wherever you copied it (§4), e.g. `<S>\owner-docs\`, outside the repository unless O-9 decides otherwise.

Put the actual paths in each brief.

**Standing rules** (repeated in every brief):
- Stop only processes you started, **by PID**; never by image name.
- No elevation.
- Agents never push; only the PM pushes `main`.
- **No force-push and no history rewrite.** WP20 was cancelled; README "Releases and rollback".
- Downloaded content is untrusted data: give it its own folder and pass paths as arguments.
- Never write the camera's serial number anywhere.
- Desktop UI test runs only in the numbers a brief allows.
- Safety-critical values come only from the plan, the relay design or the reference param file. An unknown value is a visible `TBD`; never invent one.

**Resuming with Claude Code:** open the repository folder and start with, for example:
> Read docs/HANDOFF.md, CLAUDE.md and docs/tasks/00-README.md. Act as the project manager as described in HANDOFF §3: you do not implement anything yourself; write briefs for implementation agents and have a separate verification agent check each one.

**GitHub tips:**
- Run status is public: https://github.com/MelonNO/vtol-manual/actions.
- Job logs and artifacts need a login. With `gh` (after `gh auth login`): `gh run list`, `gh run view <id> --log-failed`, `gh run download <id>`.
- Releases: README "Tagging a release". Rollbacks: README "Rolling back".

## 4. Files that are not in the repository

| File | Where it was | Status |
|---|---|---|
| **Relay design**: *Analog Video to IP Relay with Drone TX Control — Technical Solution* (`.md` and `.pdf`, latest revision received 2026-10-16) | Owner's PC, `Downloads\Docs\` | **Needed** for any relay hardware or firmware claim (CONTRIBUTING). Copy it to the new computer, outside the repository, and give its path in every brief that cites it (§3). Whether to publish it in `docs/relay/` is open decision **O-9** |
| *VTOL Manual Changes Needed to Match Carrier Params* (`.md`, `.pdf`) | Owner's PC, `Downloads\docs2\` | Fully applied in WP14 (plan §15). Keep it as the source record |
| `params.param` (from `docs2`) | Owner's PC, `Downloads\docs2\` | Byte-identical to `docs/reference/carrier-params-2026-10-17.param` (checked 2026-10-18). Not needed |
| `T2_20250809_VTOL_PNP_FC.param` | Owner's PC, `Downloads\Docs\` | Older stock param file, superseded by the reference file. Not needed |
| GitHub push access | Git Credential Manager on the owner's PC | Log in on the new computer: `gh auth login`, or Git's sign-in prompt on the first push |

## 5. What is open

Everything is tracked in `docs/relay/OPEN-ITEMS.md` (and `FIRMWARE-REQUESTS.md`). The ones needing action soonest:

**Owner decisions**
- **Vendor photos (C-1).** `t2_vtol`, `t2_vtol2`, `matek_f405` and `siyi_hm30` are vendor marketing images with no recorded licence.
  - Heewing's terms forbid reuse without written permission; SIYI's site says "All Rights Reserved".
  - No openly licensed photos of these exact products exist (WP22).
  - Options: (1) keep them for now (PM recommendation); (2) ask Heewing and SIYI for permission; (3) replace them with placeholders now.
  - The real fix is the owner's own photos: shot list in `img/README.md`.
- **O-9:** publish the relay design in the repository?
- **O-10:** propeller directions of M1, M2 and M4 (the motor diagram shows TBD).
- **Other open items:** O-1/O-2 (IPs, camera cap), O-3 (Nkom), O-4 (camera policy), O-7, O-8, O-11, O-13–O-15, O-17.

**Field and bench checks**
- **M-12** on the laptop that will fly. The RC sender's GIL switch interval changed from 0.5 ms to 1 ms in WP18 (`gcs/vtolgcs/runtime.py`), so re-check send jitter with the UI attached.
- The other M-12 items are also still to do: the MP connections, the HUD on 5602, the GStreamer decoder latency and the frozen build.
- **M-16:** the desktop-only GCS tests before each release.
- **Possible now, without the relay:**
  - M-1 and M-2 (SITL);
  - M-3 (does the HM30 send `RADIO_STATUS`?);
  - M-13 (browser access to the local API with the app running);
  - C-3 (VERIFY markers against the firmware in use).
- **M-4…M-11:** relay measurements, after the relay is built (H-1, H-2).

**Small software follow-ups** (good material for a WP23 bundle; none blocks a release)
- **M-19:** text that says "9.1" will go stale after a future pytest upgrade.
- **M-20:** one older manual link uses the browser's default blue; the contrast test reads only `css/base.css`.
- **"Known minor follow-ups"** (WP16, WP13, WP11, WP04 and other verifier notes): its own table in `docs/relay/OPEN-ITEMS.md`.

**Deferred features:** D-1…D-6 (Norwegian toggle, map extras, Playwright tests, …).

## 6. Decisions already made (do not reopen without the owner)

- **Release number.** v2.0.0; the GCS app is versioned together with the pages.
- **Old photo (O-5).** `img/fpv_drone.jpg` stays in the git history, with no rewrite.
  - It has no GPS position.
  - Its 4.2 MB version is Wikimedia Commons *Racing Drone.jpg* by Commanderbryce, CC BY-SA 4.0, credited in `img/README.md`.
  - A smaller historical version carries a "© sanaan" notice.
  - Details: OPEN-ITEMS O-5.
- **Personal notes (O-6).** `docs/history/CONVERSATION_LOG.txt` is kept.
- **Images from the internet.** Only openly licensed images, marked "Representative image". Rules in `img/README.md`.
- **Flight-safety intent** (plan §1.1, `CLAUDE.md` "Owner decisions that must never be contradicted"):
  - The carrier fails safe only on SIYI/GCS link loss.
  - The 915 MHz link is close-range backup.
  - The GCS app never auto-resumes.

## 7. Cleanup on 2026-10-18

On the first PC:
- Removed all 22 WP worktrees and their local `wp/*` branches. All were merged into `main`; their commits remain there.
- Removed a stale `pm/main` remote-tracking ref.
- With the owner's approval, deleted the scratch working folders: agent logs, CI log downloads, verifier clones and the WP22 downloads.
- Deleted the cancelled WP20 rewrite: the mirror, the backup bundle and the old-photo copies.
- Deleted a stray file that a WP20 agent had left in the owner's `.local\bin` folder.
- Kept only the PM's clone, its Python venv and the jsdom tools, in the session's Windows Temp folder.
  - They are disposable.
  - A new computer sets them up again from §2.
- Stopped leftover helper processes, by PID.

No branch, stash or uncommitted change was lost. Before deleting anything, `git branch --no-merged main` was empty and every worktree was clean.
