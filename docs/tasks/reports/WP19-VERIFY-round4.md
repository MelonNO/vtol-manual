VERDICT: APPROVED

# WP19 verification — round 4

Verifier: independent agent. Branch `wp/19` at cbc4ce9 (round 4: 851d3ad docs fixes, cbc4ce9 report paths). Round 3 head 3a233ad. Base `main` 786acae.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.

**Where my files are** (all under `S\verify\WP19\`):
- tool: `vrun4.py` (one pytest run in CI mode: `CI=true GITHUB_ACTIONS=true VTOLGCS_INTERACTIVE_TESTS=0`, stdin NUL, own APPDATA; lists python processes left alive, kills nothing);
- logs: `logs4\`;
- throw-away git clones of wp/19 and venvs: `scratch4\`:
  - `A` = the README procedure, literally, with pytest 9.0.3 as the unlisted release (venv `A\pytest-upgrade`)
  - `B` = a full forward upgrade 9.0 → 9.1.1 including the pin raise (baseline commit in the clone rewrites all pins to 9.0 and `PYTEST_VERIFIED = ((9, 0),)`)
  - `C` = joint bump to 9.2 (drift test)
  - `F` = the failure path (venv `F\pytest-upgrade` with its pytest altered)
  - `D` = clean clone for the regression runs; `merge` = trial merge.

The worktree and the main repo are untouched: `git status` is clean in both, and HEADs are cbc4ce9 and 786acae.

## Summary

The round-3 MAJOR (F1) is fixed. I followed the new "Upgrading pytest (WP19)" steps literally in Windows PowerShell, from a repository root, with real releases:
- **Success path:** works as written, for both the 9.0.3 stand-in and a full upgrade that includes raising the pins.
- **Failure path:** the undo instructions are correct and complete.

F2 and F3 are fixed and accurate. Every regression run is green. Two MINOR findings remain (below).

## Requirement results (round-4 claims)

| Claim | Result | Evidence |
|---|---|---|
| F1: the corrected upgrade procedure works (README, M-18, §12/§13) | **PASS** | experiments A, B, C, F (below) |
| F1: README, M-18 and §13 say the same thing | **PASS** | same 5 steps and order: install in a separate venv, list in `PYTEST_VERIFIED` first, run self-test + version test, raise the four pins together and run the suite, else undo. §12 MUST 3 is marked superseded and points to §13 |
| F1: `..\pytest-upgrade` is a safe location | **PASS** | It is a sibling of the repo folder, so it is outside the work tree. In A, B and F, `git status --untracked-files=all` never lists it. §13's remark that `.venv-new` would not be ignored is true (`.gitignore` has only `.venv/` and `venv/`) |
| F2: docstring `test_test_guards.py:720` | **PASS** | It says CI is pinned to the release in `PYTEST_VERIFIED`, that the test catches a local venv on another release, and that you upgrade by listing the release first. All true (`conftest.py:810`, `:815`, `:857-859`) |
| F3: "a new minor (9.2+) changes nothing; 9.1.x patches taken automatically; the teardown self-test checks them on every CI run" | **PASS** | below |
| Round 4 changed docs only (4 files) | **PASS** | `git show --stat 851d3ad cbc4ce9`: README, OPEN-ITEMS, report, one docstring |
| Regression | **PASS** | below |

### F1 experiments: following the README literally

**A: 9.0.3 as the unlisted release** (`scratch4\A`; PowerShell, cwd = the repo root of a git clone of wp/19 that includes `data/`)

| Step | Command as written | Result |
|---|---|---|
| 1 | `python -m venv ..\pytest-upgrade`, then `..\pytest-upgrade\Scripts\python -m pip install "pytest>=9.0,<9.1" pygame-ce` | Both exit 0, and pytest 9.0.3 is installed. `python` on PATH is the real 3.12.10. The venv sits next to `vtol-manual`, and `git status` is clean |
| (control) | Step 3 run without the step-2 edit | 2 failed (hard exit, "not a release this recovery was verified for"), as the README now explains (`logs4\A_control_unlisted.txt`). `-k` selects exactly the 2 tests (17 deselected) |
| 2 | `PYTEST_VERIFIED = ((9, 1), (9, 0))`, in the README's example form | 1-line diff |
| 3 | `..\pytest-upgrade\Scripts\python -m pytest gcs/tests/test_test_guards.py -k "stale_fixture or verified_for" -v` | **2 PASSED**, exit 0. Header: `(pytest 9.0.3, verified)` (`logs4\A_step3.txt`) |
| 4 (suite) | `…\python -m pytest gcs protocol` (CI env, stdin NUL; no desktop run) | **699 passed, 7 skipped**, exit 0, 140 s. No +++/INTERNALERROR line, and no process left (`logs4\A_suite\run.txt`). Afterwards `git status --ignored` shows only `M gcs/conftest.py`. `gcs/.pytest_cache` and `__pycache__` are ignored |

**B: a full forward upgrade, 9.0 → 9.1.1** (it exercises step 4's pin raise and the drift test with real releases)

| Step | Result |
|---|---|
| 1 | `"pytest>=9.1,<9.2"` installs 9.1.1 |
| 2–3 | `PYTEST_VERIFIED = ((9, 0), (9, 1))`, then the two checks: 2 PASSED (`logs4\B_step3.txt`) |
| (control) | With the pins not yet raised, `test_the_pytest_pin_and_the_verified_release_agree` FAILS and names the three workflow lines. So a forgotten pin is caught |
| 4 | Raise the four pins (`ci.yml` ×2, `gcs-build.yml`, `dev` extra; they are exactly the four the README names). The diff is exactly 5 lines. Whole suite with the venv: **699 passed, 7 skipped**, exit 0, drift test passed (`logs4\B_suite\run.txt`). `git add -A --dry-run` stages only the 4 intended files |

**C: joint bump to 9.2** on wp/19. All four pins set to `"pytest>=9.2,<9.3"` and `PYTEST_VERIFIED = ((9, 1), (9, 2))`. The drift test and the version test both PASS (on 9.1.1).

**F: failure path.**
- Setup: a throw-away 9.0.3 venv whose `_pytest/runner.py` `teardown_exact` iterates a copy instead of popping. This stands in for a release that changed what `_finish_teardown` relies on.
- After step 2, step 3 gives: the self-test **FAILED** (`['mod-2','mod-3','node-fin','node-fin',…]`, so a finaliser ran twice), and the version test PASSED (`logs4\F_step3.txt`). That is the README's "first check failed" case.
- Step 5, done by hand (the `PYTEST_VERIFIED` line restored):
  - `git status --untracked-files=all` is empty, and `git diff HEAD` is empty;
  - no pin was touched (step 4 is not reached);
  - the pinned 9.1.1 venv passes the self-test, the version test and the drift test (3 passed).

  "CI stays on the old pin and keeps working" is therefore true. The instructions are complete.

### F3

- `ci.yml` runs `on: push / pull_request / workflow_dispatch` with no path filter, and `python-windows` has no `if:`.
- Its install line `"pytest>=9.1,<9.2"` has no cache or lock, so it takes the newest 9.1.x.
- The job runs `pytest gcs protocol` (×5), which includes `test_test_guards.py`. The self-test is `skipif(sys.platform != "win32")`, so it runs on this Windows job.
- The Linux job runs only the protocol and CRSF tests, but it is the Windows job of every CI run that checks.
- `PYTEST_VERIFIED` matches (major, minor), so a 9.1.x patch counts as "verified", and the self-test checks its behaviour.

The wording is accurate.

## Contract results

No contract changed. Round 4 is documentation only. The C3 failsafe intent is untouched.

## Tests run (regression, clone `scratch4\D` at cbc4ce9)

| Run | Result |
|---|---|
| CI mode ×1: `vrun4.py … REAL gcs protocol -v -p no:cacheprovider -rfEs --durations=10 --tb=long -m "not interactive_desktop"`, with real Python 3.12.10 and the S venv's site-packages | **699 passed, 7 deselected**, 138.8 s, exit 0. pytest PID 21388 exited by itself, and no python process was left. No `+++ LEAKED/TIMEOUT/FAILED/ERROR` or INTERNALERROR line. The header says `(pytest 9.1.1, verified)` (`logs4\ci1\run.txt`) |
| Guard self-tests | all 19 in `test_test_guards.py` PASSED in that run |
| `node --test test/` with `VTOL_JSDOM`, `VTOL_PYTHON` | 310 pass, 0 fail, 0 skipped (`logs4\node.txt`) |
| `VTOL_REQUIRE_WORKFLOW_TEST=1 node --test test/ci/workflows.test.js` | 7/7 (Windows PowerShell 5.1; pwsh 7 is not installed) |
| `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0, SELFTEST OK (`logs4\checks.txt`) |
| Trial merge (clone of `S\repo\vtol-manual`, 786acae, `git merge --no-ff wp19`) | clean, 12 files, +846/−60 (round 3 +800, plus the round-4 docs) |
| Desktop | none run |

## Smoke tests

This is not a web WP. The behavioural checks are the upgrade experiments A, B, C and F.

## Findings

### 1. MINOR: after an upgrade, the prose that names 9.1 goes stale, and the procedure does not say so

Step 4 raises "the four pins" and `PYTEST_VERIFIED`. These texts still say 9.1 afterwards:
- `gcs/README.md:512`: "pinned to `"pytest>=9.1,<9.2"`", and "keep using 9.1";
- the README watchdog row: "relies on how pytest 9.1 tears down … pinned to 9.1";
- `gcs/conftest.py:803-806`: "pytest 9.1.1: `runner.py`…", and `"pytest>=9.1,<9.2"`;
- OPEN-ITEMS M-18.

Nothing checks these texts. In experiment B they were stale after a correct upgrade. This does not affect CI, the release build or the procedure itself.

**Expected (optional):** a line in step 4 such as "also update the version named in this section, the watchdog row and the `PYTEST_VERIFIED` comment". Or word those texts without a version ("the pinned release").

### 2. MINOR: one §13 evidence row cites a log that does not contain the figure

- §13, step-4 row: "With `data/` added, `test_video.py` plus the drift test gave 14 passed … (`new_order_suite.txt`)".
- That log holds only the run with "1 failed, 698 passed, 7 skipped". The 14-passed rerun is not recorded there.
- The conclusion is right: my run A on 9.0.3, with `data/`, gave 699 passed.

### Notes (not findings)

- **A failing version test alone** (step 3) would mean the step-2 edit does not name the installed release, e.g. a typo. Step 5 only covers "the first check failed". In practice, a wrong edit also makes the first check fail, and the version test's message names the installed release, so the cause is visible.
- **Step 4 on the owner's desktop** runs the `interactive_desktop` tests too. That was not exercised here (no desktop runs were allowed). Every non-interactive test passed on 9.0.3 and 9.1.1 with the upgrade venv.
- **§11 is history.** It quotes the round-2 failure message ("re-verify … then add it to PYTEST_VERIFIED"), which round 3 replaced. It is labelled as round 2, so this is acceptable.

## Approval rationale

- **F1 fixed.** The procedure lists the release before the self-test, and every command, path, file name and the `PYTEST_VERIFIED` edit work as written.
  - Success path: both checks pass, the whole suite passes, and the drift test enforces the joint bump.
  - Failure path: the undo restores the exact HEAD tree.
  - `..\pytest-upgrade` is outside the repo and is never staged.
  - The README, M-18 and §12/§13 agree.
- **F2 and F3 fixed and accurate.** I found no false or overstated claim in the docs or the report beyond the two MINOR findings.
- **Regression all green.** The scope is unchanged since round 3 (only the 4 documentation files changed in round 4), and the trial merge is clean.
- Zero BLOCKER and zero MAJOR findings, and every MUST requirement passes.

## Leftover processes

None of mine. Every run ended by itself (pytest PIDs 22440, 21980 and 21388 included), and I stopped no process. A `Win32_Process` search after all runs found only two `pythonw.exe -m kisync --minimized` processes (PIDs 5456 and 5660). They are the user's and were not started by me.

No elevation, no push, no desktop run, and `VTOLGCS_INTERACTIVE_TESTS=0` throughout. The only network use was PyPI downloads into the throw-away venvs under `scratch4`. The mutated pytest exists only in `scratch4\F\pytest-upgrade`.

Report: `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\verify\WP19\VERIFY-round4.md`
