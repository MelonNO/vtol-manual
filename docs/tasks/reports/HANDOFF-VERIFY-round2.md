# HANDOFF verification — round 2

VERDICT: APPROVED

Subject: `docs/HANDOFF.md` at commit `5b94fd6` (rework of `78e0672`) on local `main`, not pushed.
Work folder: `V` = `...\scratchpad\verify\HANDOFF-r2`. Logs are in `V\logs\`.

## 1. Round 1 findings

| # | Sev. | Round 1 finding | Status | Evidence |
|---|---|---|---|---|
| 1 | MAJOR | `npm` / `html-validate` resolve to `.ps1` and are blocked by the default execution policy | **FIXED** | §2 now uses `npm.cmd install …` (line 51) and `..\vtol-tools\node_modules\.bin\html-validate.cmd …` (line 71), with a comment giving the reason. `.bin` contains `html-validate`, `html-validate.cmd` and `html-validate.ps1`. In a child `powershell -ExecutionPolicy Restricted` (effective policy: Restricted, `V\logs\restricted-policy.txt`): bare `npm --version` fails with "npm.ps1 cannot be loaded …"; `npm.cmd --version` gives 11.19.0, exit 0; the §2 `npm.cmd install` line (prefix `..\vtol-tools-restricted`) gives "added 48 packages", exit 0; bare `html-validate` fails (`.ps1`); the §2 `html-validate.cmd` line gives `✖ 169 problems (0 errors, 169 warnings)`, exit 0, from both installs. The other Node/Python commands in §2 are `.exe` files, which the policy does not affect. `node --test test/` starts PowerShell itself, but with `-ExecutionPolicy Bypass -File` (`test/ci/workflows.test.js:238`), so it does not depend on the user's policy either. |
| 2 | MINOR | The §2 venv lacks Pillow, which 01 §3 `S\venv` has | **FIXED** | Line 47 adds `Pillow`; the comment names `scripts/optimize-images.py` and `gen-icons.py`, both of which exist and import PIL. Installed: Pillow-13.0.0; `from PIL import Image` works. |
| 3 | MINOR | The CI list omits `vtolgcs.protocol --selftest` | **FIXED** | Line 70: `cd gcs; ..\..\vtol-venv\Scripts\python -m vtolgcs.protocol --selftest; cd ..`. This matches `ci.yml:114` (`cd gcs && python -m vtolgcs.protocol --selftest`). From `gcs`, `..\..\vtol-venv` is the right venv, and the line returns to the repository root, so the next line still works. Run: `SELFTEST OK`, exit 0. The heading now also says that CI runs the GCS suite five times. |
| 4 | MINOR | The relay-design path and the "Main repo" row of 01 are not mapped | **FIXED** | §3 "Paths on a new computer" now covers 01 §1 and §3: the main repo is the §2 clone; the relay design is wherever it was copied (e.g. `<S>\owner-docs\`), outside the repository; "Put the actual paths in each brief". §4 says "outside the repository, and give its path in every brief that cites it (§3)". The 01 pointer ("§2–§3") is still correct. |
| 5 | MINOR | "M-1…M-11 after the relay" is imprecise; M-13 and C-3 are not named | **FIXED** | §5 now has "Possible now, without the relay: M-1 and M-2 (SITL); M-3 (HM30 `RADIO_STATUS`); M-13 (local API with the app running); C-3 (VERIFY markers)" and "M-4…M-11: after H-1/H-2". OPEN-ITEMS rows confirm each: M-1 "SITL or bench (props off)" (l.38); M-2 "SITL" (l.39); M-3 "MP → Ctrl+F → MAVLink Inspector" (l.40); M-4 "After H-1/H-2" (l.41); M-13 "with the app running" (l.50); C-3 "Check against the firmware in use" (l.87). |
| 6 | MINOR | Where verifier reports go | **FIXED** | §3 step 3: the verifier writes `S\verify\WPnn\VERIFY-roundN.md` outside the repository, and the PM copies it into `docs/tasks/reports/` when merging. This matches 03 and the round 1 record (`docs/tasks/reports/HANDOFF-VERIFY-round1.md` was copied in exactly that way). |
| 7 | MINOR | The O-5 photo attribution is too broad | **FIXED** | §6: "Its 4.2 MB version is … Commanderbryce, CC BY-SA 4.0, credited in `img/README.md`. A smaller historical version carries a '© sanaan' notice. Details: OPEN-ITEMS O-5." OPEN-ITEMS l.67: 4.2 MB version (blob `b32c311`, 4,157,983 bytes) byte-identical to Commons, Commanderbryce, CC BY-SA 4.0; "The smaller version (blob `c65b4da`) carries a '© sanaan' copyright notice"; no GPS. All true. |
| 8 | MINOR | Session-only environment variables; `VTOLGCS_INTERACTIVE_TESTS=0` still set for the desktop run | **FIXED** | Lines 53–54: "Set these in every new PowerShell window … without VTOL_JSDOM the jsdom tests are skipped without failing". This is true: `ci.yml:53` "the jsdom-only tests report as skipped". Lines 80–81: `Remove-Item Env:VTOLGCS_INTERACTIVE_TESTS` "in the same window as the CI-mode run", then check that the header says `interactive_desktop tests RUN`. `gcs/conftest.py:175-177`: only an explicitly set value forces the result; once the variable is removed, an interactive desktop session is detected. `conftest.py:935` prints `vtolgcs: interactive_desktop tests {'RUN'|'SKIPPED'} (…)`, so the quoted text is exact. (`Remove-Item Env:` errors if the variable is not set; the text limits it to the same window, where it is set.) |
| 9 | MINOR | `python -m http.server` assumes `python` is on PATH | **FIXED** | Line 82: `..\vtol-venv\Scripts\python -m http.server 8000`, with the PATH note. The venv python exists (§2) and `http.server` is in the standard library. |
| 10 | MINOR | "Push to main" could be read as a standing licence | **FIXED (one gap, new finding N1)** | §3 step 4 now says: the PM pushes `main` without a pull request only after an APPROVED verification; it is an owner-approved exception to the CONTRIBUTING rule; it belongs to this PM process; anyone else, or a new PM, confirms it with the owner first. No force-push is in the standing rules (l.116). CONTRIBUTING:9 says "Branch from `main`; never commit straight to `main`, never force-push it", and step 4 mentions the pull request, so the paraphrase "branch, then open a pull request" is fair. The quoted approval ("Push to main", 2026-10-16) is not recorded in the repository and cannot be checked here. The date matches the first PM commits (`5a2377e`, 2026-10-16 20:23). |

## 2. Fresh clone, §2 followed literally (Windows PowerShell 5.1)

Setup:
- `git clone https://github.com/MelonNO/vtol-manual.git V\clone`
- `git fetch <local repo> main`, then `git checkout --detach FETCH_HEAD`
- HEAD = `5b94fd68bd64692f508048af06fe218bfe079c98`

Environment:
- PowerShell 5.1.26100.9711
- `py -3.12` → Python 3.12.10
- Node v24.20.0 and npm 11.19.0, with `C:\Program Files\nodejs` prepended to PATH for the shell only
- The tool shell runs with Process = Bypass. The Restricted check below was run in a child shell.
- I did not change any execution policy.

| # | Command (exactly as in HANDOFF §2) | Result |
|---|---|---|
| S1 | `py -3.12 -m venv ..\vtol-venv` | PASS, exit 0 |
| S2 | `..\vtol-venv\Scripts\python -m pip install "pytest>=9.1,<9.2" pygame-ce Pillow` | PASS, exit 0: `Successfully installed Pillow-13.0.0 … pygame-ce-2.5.8 … pytest-9.1.1` |
| S3 | `npm.cmd install --no-save --prefix ..\vtol-tools jsdom@30.1.3 html-validate@11.16.2` | PASS, exit 0: `added 48 packages` |
| S4 | `$env:VTOL_JSDOM = (Resolve-Path ..\vtol-tools\node_modules\jsdom).Path` | PASS: `V\vtol-tools\node_modules\jsdom` |
| S5 | `$env:VTOL_PYTHON = (Resolve-Path ..\vtol-venv\Scripts\python.exe).Path` | PASS: `V\vtol-venv\Scripts\python.exe` |
| C1 | `node --test test/` | PASS, exit 0: `tests 312, pass 312, fail 0, cancelled 0, skipped 0` |
| C2 | `node scripts/gen-precache.mjs --check` | PASS: `sw-precache.js up to date (59 assets)` |
| C3 | `node scripts/diagrams/build.js --check` | PASS: `diagrams up to date (16 SVG files, manual slots and inline SVGs)` |
| C4 | `node scripts/gen-params-reference.mjs --check` | PASS: `data/params-reference.js up to date (1663 parameters)` |
| C5 | `node scripts/check-links.mjs; node scripts/check-images.mjs; node scripts/check-colours.mjs` | PASS, all exit 0: `every internal link and asset resolves` / `39 images within budget (largest img/t2_vtol.jpg 199.0 KiB)` / `no hard-coded colours in inline SVG or inline styles` |
| C6 | `..\vtol-venv\Scripts\python gcs/tools/gen_test_vectors.py --check` | PASS: `up to date` |
| C7 | `cd gcs; ..\..\vtol-venv\Scripts\python -m vtolgcs.protocol --selftest; cd ..` | PASS, exit 0: `SELFTEST OK`; afterwards the working directory is the clone root again |
| C8 | `..\vtol-tools\node_modules\.bin\html-validate.cmd index.html manual.html relay/map.html tools/latency-clock.html` | PASS, exit 0: `✖ 169 problems (0 errors, 169 warnings)` (the same as round 1 and CI; the warnings are accepted in `.htmlvalidate.cjs`) |
| C9 | `$env:VTOLGCS_INTERACTIVE_TESTS = '0'; ..\vtol-venv\Scripts\python -m pytest gcs protocol -p no:cacheprovider` | PASS, exit 0: `700 passed, 7 skipped in 138.84s`; the header says `vtolgcs: interactive_desktop tests SKIPPED (VTOLGCS_INTERACTIVE_TESTS=0)` |
| R1 | Restricted child: `npm.cmd install --no-save --prefix ..\vtol-tools-restricted jsdom@30.1.3 html-validate@11.16.2` | PASS, exit 0: `added 48 packages` (bare `npm` fails: `npm.ps1 cannot be loaded`) |
| R2 | Restricted child: `..\vtol-tools\node_modules\.bin\html-validate.cmd index.html manual.html relay/map.html tools/latency-clock.html` | PASS, exit 0: `0 errors, 169 warnings` (bare `html-validate` fails: `html-validate.ps1 cannot be loaded`) |

I ran no desktop-only tests and opened no UI windows. After all runs, `git status --short` in the clone is clean (only ignored `__pycache__` folders), and HEAD is still `5b94fd6`. None of the processes I started is still running.

## 3. New claims in the rework, and §7

| Claim | Result | Evidence |
|---|---|---|
| (a) "Kept only the PM's clone, its Python venv and the jsdom tools, in the session's Windows Temp folder" | TRUE | The scratchpad holds `jsenv`, `repo`, `venv` and `verify`. `verify` holds only my `HANDOFF-r2`; round 1's `verify\HANDOFF` is gone. Beside the scratchpad are `tasks` (the harness's own) and `images\1.png` (a pasted screenshot, 2026-10-17; also the harness's own). Neither is a project folder. |
| (b) "Deleted a stray file that a WP20 agent had left in the owner's `.local\bin` folder" | TRUE (state) | `Test-Path C:\Users\Simulator\.local\bin\mine-old.txt` = False. The folder holds only `.claude`, `claude.exe`, a `claude.exe.old.*`, `easyeda2kicad.exe` and `uv*.exe`, none of them project files. That the file came from a WP20 agent, and that the owner approved, cannot be checked from here. |
| (c) No extra worktrees or `wp/*` branches, no `pm/*` refs, nothing unmerged | TRUE | `git worktree list`: one entry, `repo\vtol-manual 5b94fd6 [main]`. `git branch -a`: `main`, `origin/HEAD`, `origin/main`. `for-each-ref refs/remotes/pm` is empty. `branch --no-merged main` is empty. `stash list` is empty. The only remote is `origin`. `status`: clean, `ahead 2` (78e0672 and 5b94fd6). |
| "Stopped leftover helper processes, by PID" | Consistent | No python or node process from the old work is running. The only ones are my own pytest run and an unrelated `kisync`. |
| "With the owner's approval, deleted the scratch working folders" | Consistent (approval not checkable here) | The folders are gone, as stated. The PM brief says the owner approved. |
| §1: GitHub state, unchanged text | Still TRUE | API: branches = `main` only; 0 open PRs and 0 open issues. Release v2.0.0: not draft, not prerelease, asset `vtol-gcs-v2.0.0-windows-x64.zip`. `v2.0.0^{commit}` = `3df2cd4…`. Runs on 0d752a9 (CI, GCS build, pages-build-deployment) all success. The Pages URL returns HTTP 200. |
| Rest of the document | Unchanged where round 1 found it true | `git diff 78e0672 5b94fd6` touches only `docs/HANDOFF.md` (the hunks above) and adds the round 1 report. CLAUDE.md, README.md, 00-README.md and 01-COMMON-CONTEXT.md are unchanged since round 1. |

## 4. Pointer edits and tests

The pointer edits are unchanged since round 1:
- CLAUDE.md l.7–8;
- README "Open items";
- 00-README "Update (2026-10-18)";
- 01 §3 lead-in.

`node --test test/` with `VTOL_JSDOM` set: 312/312 pass, 0 skipped (C1).

## 5. Fresh-reader test (CLAUDE.md → HANDOFF.md → 00-README.md)

- **Start.** CLAUDE.md l.7 sends the reader to HANDOFF first.
- **State.** HANDOFF §1 gives the state.
- **Setup.** §2 now works as written on a default-policy Windows PC.
- **Process.** §3 explains the PM process, the push exception and how to map paths.
- **Next steps.** §5 says what to do next.
- **Status board.** 00-README's "Update (2026-10-18)" points back to HANDOFF and names WP23.
- **Safety.** Nothing invites a force-push, invented values or skipped verification:
  - §3 standing rules: no force-push or history rewrite, `TBD` never invented, separate verifier, APPROVED before merge or push;
  - the push exception is now explicitly limited and must be confirmed by a new PM.
- **Small points.** These are new findings N1–N4.

## 6. New findings

All four are MINOR. None of them makes the setup fail or invites unsafe action.

1. **N1 — MINOR — HANDOFF §3 step 4 (line 98).**
   - **What is wrong:** "The PM pushes `main` itself … only after an APPROVED verification" covers merges of verified WPs. It does not cover the PM's own record commits, which go straight to `main` and are pushed without a WP verification. Examples are `0d752a9 PM: close O-16`, `3df2cd4 PM: record WP21 verification …`, and the handoff commits themselves. Read literally, a new PM may not push them, or must guess. Round 1's expected text named "PM record commits".
   - **Expected:** add "and the PM's own record commits (status board, reports, OPEN-ITEMS); never with force".
2. **N2 — MINOR — `docs/tasks/00-README.md:3` and `01-COMMON-CONTEXT.md` §1 table (fresh-reader).**
   - **What is wrong:** both still call the plan "(Rev B)". HANDOFF §1 and CLAUDE.md say that Rev C in §15 overrides older values. The documents were already like this before the rework, and HANDOFF states the correct rule, but a reader going CLAUDE → HANDOFF → 00-README sees the two disagree.
   - **Expected:** "Rev B, amended by Rev C (§15)" in both places, or leave it, since HANDOFF settles it.
3. **N3 — MINOR — HANDOFF §2 "Desktop-only tests" (lines 77–81).**
   - **What is wrong:** HANDOFF gives no command; it points to `gcs/README.md` "Tests". The commands there (`gcs/README.md:551-552`) use bare `python`, which HANDOFF line 82 itself says is not on PATH by default. M-16 also needs the second command (`$env:VTOLGCS_UI_SMOKE='1'; … -m interactive_desktop`, "7 passed, none skipped"), and HANDOFF does not mention it. CLAUDE.md:45/69 and CONTRIBUTING:10/19 also use bare `python`. A new reader can work this out, but it is the same PATH trap that finding 9 fixed for `http.server`.
   - **Expected:** one line, "in commands from other documents, use `..\vtol-venv\Scripts\python` for `python`", or the two M-16 commands written out with the venv python.
4. **N4 — MINOR — HANDOFF §3 "Paths on a new computer" and 01 §3 "JS test helpers".**
   - **What is wrong:** 01 §3 tells agents to run `npx --prefix S/jsenv html-validate <file>`. In Windows PowerShell under the default policy, `npx` resolves to `npx.ps1` and is blocked, the same problem as round 1 finding 1. In Git Bash, which agents mostly use, it works.
   - **Expected:** the §3 mapping says "in PowerShell use `npx.cmd`, or `..\vtol-tools\node_modules\.bin\html-validate.cmd`".

## 7. Rationale

- **Round 1 findings:**
  - The MAJOR finding (1) is fixed correctly. The `.cmd` shims exist.
  - In a real `-ExecutionPolicy Restricted` child shell, both §2 lines work, while the bare `npm` and `html-validate` still fail. So the fix is needed, and it works.
  - Every other command in §2 is a native `.exe`.
  - The one script that `node --test` starts passes `-ExecutionPolicy Bypass` itself.
- **MINOR findings 2–10:**
  - All are fixed, and I checked each fix against the code and CI:
    - the selftest command and its working directory match `ci.yml:114` and pass;
    - the header text is exactly what `gcs/conftest.py:935` prints;
    - `Remove-Item Env:` gives the auto-detection that `conftest.py:175` expects;
    - the O-5, M-1/M-2/M-3/M-4/M-13 and C-3 facts match OPEN-ITEMS;
    - the CONTRIBUTING paraphrase is fair.
  - The push exception is now limited and must be confirmed by a new PM. Recording PM commits under it is still a small gap (N1).
- **Fresh clone of 5b94fd6, §2 followed literally in Windows PowerShell 5.1:** every setup and CI command passed:
  - Node tests: 312/312, 0 skipped;
  - all `--check` and lint scripts;
  - selftest OK;
  - html-validate: 0 errors;
  - GCS suite in CI mode: 700 passed, 7 skipped.
- **New claims in §7:** each one matches what is on disk and in git:
  - the scratchpad holds only repo, venv and jsenv;
  - `mine-old.txt` is gone;
  - one worktree, no `wp/*` branches, no `pm/*` refs, nothing unmerged, no stash.
- **What I could not check:** the owner's approvals (the 2026-10-16 "Push to main" and the cleanup), because nothing records them here. Nothing contradicts them.
- **The rest of the document:** unchanged since round 1 and still true; the GitHub state was re-checked.
- **New findings:** all MINOR wording or consistency points (N1–N4). None is a false claim that could mislead into unsafe action, and none is a failing setup command.
- **Verdict:** both conditions hold, so the verdict is APPROVED. Push 78e0672 and 5b94fd6, then check that CI is green on the new head, as §1 "every check is green" requires.

Process note: I wrote nothing outside V, apart from what pip and npm wrote into V (`V\vtol-venv`, `V\vtol-tools`, `V\vtol-tools-restricted`), and `__pycache__` folders in `V\clone`. I only read the local repository and GitHub. I did not change any execution policy or system setting. The only things I stopped were my own two background monitors, by task ID.
