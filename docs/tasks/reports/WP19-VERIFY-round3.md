VERDICT: REJECTED

# WP19 verification — round 3

Verifier: independent agent. Branch `wp/19` at 3a233ad (round 3: 3658b44 pin, drift test and README; 3a233ad OPEN-ITEMS and report §12). Base `main` 786acae.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.

**Where my files are.** Everything is under `S\verify\WP19\`:
- round-3 tools: `vrun3.py` (round 1's `vrun.py`, with `VTOLGCS_INTERACTIVE_TESTS=0` set explicitly), `mut3.py` (drift mutants), `mut2r3.py` (round-2 mutants re-pointed at the round-3 tree), `yamlcheck.py`, `yamldiff.py`, `upgrade3.sh`;
- logs: `logs3\`;
- throw-away copies and venvs: `scratch3\`:
  - `full` = `git archive 3a233ad`
  - `mut\*` = the mutants
  - `merge` = the trial-merge clone
  - `upgrade` = the README procedure experiment
  - `inst_bash`, `inst_ps_*` = the install-line venvs
  - `venv_yaml` = PyYAML 6.0.3

The worktree and the main repo are untouched: `git status` is clean in both, and the HEADs are 3a233ad and 786acae.

## Summary

**The round-2 MAJOR is fixed in CI.**
- pytest is pinned at all four places.
- The YAML is valid, and the quoting is right in both shells.
- The drift test catches every one-sided change I tried, and passes a joint bump.
- Every regression run is green.

**I reject on one new MAJOR finding: the upgrade procedure the round-2 MAJOR asked for does not work.**
- `gcs/README.md` "Upgrading pytest", M-18 and report §12 all say: install the new release, run the self-test, and raise the pins only if it passes.
- On any release not yet listed in `PYTEST_VERIFIED`, the conftest deliberately takes the hard exit, so the self-test **always fails**.
- I proved this with a real pytest 9.0.3 (Finding 1).
- So whoever follows the procedure is always told to "stay on the old pin": the conftest "needs a developer first".
- That conclusion is false. With the release listed first, the same self-test passes on 9.0.3.
- The fix is a one-step reordering plus text.

## Requirement results (round-3 claims)

| Claim | Result | Evidence | Note |
|---|---|---|---|
| **Pin** `"pytest>=9.1,<9.2"` at `ci.yml:105`, `:129`, `gcs-build.yml:49` and the `dev` extra | **PASS** | grep; `gcs/pyproject.toml:14` | — |
| YAML still valid; quoting right for each step's shell | **PASS** | PyYAML parse (below) | — |
| No other pytest install line; all consistent | **PASS** (one stale docstring: Finding 2) | grep of the whole tree | — |
| Drift test `test_the_pytest_pin_and_the_verified_release_agree` | **PASS** | 13 mutants (below) | — |
| §11 corrected | **PASS** | report `:256-261` | — |
| M-15 counts and the 30-repeat figure | **PASS** | WP17 report `:24`, `:86`; `S\wp19\r3\` | — |
| Upgrade procedure (README, M-18, §12): correct, complete, understandable | **FAIL** | experiment (Finding 1) | MAJOR |
| Regression | **PASS** | below | — |
| Round-1/2 items intact | **PASS** | mutants (below) | — |

### 1. The pin

**Scope.** Trial merge into 786acae: clean, 12 files, +800/−60. Every file is in "Files you own" or in the PM's round-3 extension. `control.py` was justified in round 1, and `test/ci/**` is unchanged.

**PyYAML parse** (`yamlcheck.py`, `yamldiff.py`).
- Both workflows parse, on wp/19 and on main.
- A structural diff of the parsed documents (main → wp/19) shows only the three `run` values changing. The trailing `# pinned: …` text is a YAML comment and does not reach the shell.

| Job (runs-on) | Shell (no `shell:` key and no `defaults`, so GitHub's default) | Parsed `run` |
|---|---|---|
| `python-portable` (ubuntu-24.04) | bash | `python -m pip install "pytest>=9.1,<9.2"` |
| `python-windows` (windows-2025) | pwsh | `python -m pip install "pytest>=9.1,<9.2" pygame-ce` |
| `build` in gcs-build (windows-2025) | pwsh | `python -m pip install "pytest>=9.1,<9.2" pygame-ce "pyinstaller>=6"` |

**Each line run verbatim**, in a fresh venv, from an empty working directory:

| Line | Shell | Result |
|---|---|---|
| `ci.yml:105` | `bash -e -c '<line>'` (Git Bash) | exit 0, **pytest 9.1.1** installed. The working directory is still empty: no file named `9.2` or `=9.1` |
| `ci.yml:129` | the line in a `.ps1`, run as `powershell -NoProfile -Command ". '<file>'"` (Windows PowerShell 5.1; pwsh 7 is not installed) | exit 0, **pytest 9.1.1** and pygame-ce 2.5.8. No stray files |
| `gcs-build.yml:49` | the same | pytest 9.1.1 and pygame-ce installed. Then pip failed writing a pyinstaller-hooks file: `[Errno 2] … hook-sklearn.externals.array_api_compat.cupy.py`, a Windows MAX_PATH limit caused by my long scratch path, not by the line. The same line plus `--dry-run` exits 0 and pip reports `pytest<9.2,>=9.1 … (9.1.1)` (the specifier arrived intact), `Would install pyinstaller-6.22.3`. No stray files |

**pwsh 7.** The quoted argument has no spaces and no embedded quotes, so every pwsh native-argument mode (Legacy, Standard, Windows) passes it unchanged. `workflows.test.js` runs the gcs-build pwsh step under 5.1 too ("pwsh (PowerShell 7) not installed").

**Other install instructions.** A grep of the whole tree for `pip install`, `[dev]` and `requirements` finds no other place that installs pytest.
- The only remaining hits are the three workflow lines and the `dev` extra.
- `gcs/README.md:576` (`pip install pygame-ce`, running from source) and `build.ps1:37` (pyinstaller, pygame-ce) do not install pytest.
- The version test's message points to `pip install -e gcs[dev]`. I ran it in a venv that had pytest 9.0.3, and it brought back **9.1.1**. It works.

### 2. Drift test, by mutation (`mut3.py`, `logs3\mut_*.txt`)

Each mutant is a copy of the 3a233ad tree, run with the venv's pytest 9.1.1:

| Mutant | Drift test | Version test |
|---|---|---|
| none | PASS | PASS |
| `ci.yml:105` raised to 9.2 alone | **FAIL** | PASS |
| `ci.yml:129` raised alone | **FAIL** | PASS |
| `gcs-build.yml:49` raised alone | **FAIL** | PASS |
| `dev` extra raised alone | **FAIL** | PASS |
| `(9, 2)` added to `PYTEST_VERIFIED` alone | **FAIL** | PASS |
| pin removed (`pip install pytest`) at `ci.yml:105`, `ci.yml:129`, `gcs-build.yml:49`, or in `dev` (4 mutants) | **FAIL** (all 4) | PASS |
| pytest dropped from `ci.yml:129` | **FAIL** (`len(installs) == 3`) | PASS |
| **joint bump**: all four pins to `"pytest>=9.2,<9.3"`, `PYTEST_VERIFIED = ((9, 1), (9, 2))` | **PASS** | PASS (9.1 is still listed) |
| **joint bump**, `PYTEST_VERIFIED = ((9, 2),)` | **PASS** | **FAIL** on 9.1.1, as expected: "this venv has pytest 9.1.1, CI uses the pinned release ((9, 2),): install that one …" |

**Note (not a finding).** The drift test scans only `ci.yml` and `gcs-build.yml`. A pytest install added to a new, third workflow would not be checked. That is acceptable today, with two workflows.

### 3. Documentation accuracy

| Statement | Source | Result |
|---|---|---|
| M-15 / §5: stalled-handshake "1 time in 50 isolated runs" plus "failed once in WP17's full CI-like run" | WP17 `:86` (1/20 + 0/30), `:24`, R4 c | true |
| M-15 / §5: rate-limit "0 failures in 30 isolated repeats under 4-CPU affinity", for both forms | `S\wp19\r3\`: 30 logs, written 01:41 (after 7956133 at 01:23). `test_control.py` and `control.py` are unchanged from 7956133 to 3a233ad. Every log has `restricted to 4 logical CPU(s)` and `1 passed`, and `SUMMARY.txt` says 30/30. Round-1 form: verified in round 1 | true |
| §11: the "one red CI run" claim withdrawn, and the true consequence stated | report `:256-261` | true |
| §12: mutations in `S\wp19\mut5` | `ci_drift`, `verified_alone` exist; I reproduced both | true |
| §12: CI mode 699 passed; Node 310; workflows 7/7; checks green | my reruns (below) | true |
| §12 note: YAML not parsed; "the first GitHub run will confirm it" | honest. I have now parsed it: valid | — |
| README / M-18: "the four pins" named | ci.yml twice, gcs-build once, the `dev` extra | true |
| README "Upgrading pytest" steps 2–3; M-18 and §12 MUST 3, the same procedure | — | **false** (Finding 1) |
| README / M-18: "A new pytest release on PyPI therefore changes nothing … Nothing breaks on its own" | `>=9.1,<9.2` still takes a new **9.1.x** patch automatically | slight overstatement (Finding 3) |
| `test_test_guards.py:720` docstring: "pytest is not pinned" | the pin now exists | stale (Finding 2) |

### 4. Regression

| Run | Command | Result |
|---|---|---|
| CI mode ×1 | `vrun3.py scratch3\full logs3\ci1 ci`: real Python 3.12.10, venv site-packages on PYTHONPATH, `CI=true GITHUB_ACTIONS=true VTOLGCS_INTERACTIVE_TESTS=0`, stdin NUL, own APPDATA, `-m "not interactive_desktop" --tb=long` | **699 passed, 7 deselected**, 138.2 s, exit 0. No `+++ LEAKED`, `TIMEOUT`, `FAILED`, `ERROR` or INTERNALERROR line, and no new python process alive afterwards (pytest PID 20244 exited by itself). The header shows `(pytest 9.1.1, verified)`, and the pin, version and R2 self-tests passed |
| Desktop | — | none run |
| Node | `VTOL_JSDOM=… VTOL_PYTHON=… node --test test/` | 310 pass, 0 fail, 0 skipped |
| Workflows | `VTOL_REQUIRE_WORKFLOW_TEST=1 node --test test/ci/workflows.test.js` | 7/7 (Windows PowerShell 5.1) |
| Checks | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0, SELFTEST OK (`logs3\checks.txt`) |
| Trial merge | clone of `S\repo\vtol-manual` at 786acae, `git merge --no-ff wp19` | clean, 12 files, +800/−60 |

**Round-1/2 spot checks** (`mut2r3.py`, `logs3\mut_r2_*`). All are still killed:

| Mutant | Result |
|---|---|
| `rate_25` | FAIL, `assert (25.0 > 30)` |
| refused but executed through `handle` | FAIL, the `handled` list |
| refused but executed directly | FAIL, `SenderState(mode=FPV, streaming=True…)` |
| refused, ok reply | FAIL |
| no refusal pause | FAIL, 0.0019 s |
| finaliser lists copied | FAIL, `node-fin` ran twice |
| `verified_90` | FAIL, R2 self-test and version test |
| skipped finalisers not run | FAIL, stale fixtures |

The guard self-tests (`test_test_guards.py`, all 19) passed in the CI run.

## Contract results

No contract was changed. Round 3 changed no product code, and the control-channel wire behaviour is unchanged. C3 failsafe intent: untouched.

## Smoke tests

This is not a web WP. The behavioural checks are the install-line runs, the mutants and the upgrade experiment.

## Findings

### 1. MAJOR: the documented pytest upgrade procedure can never succeed

Files: `gcs/README.md:512-523` (steps 2–3); `docs/relay/OPEN-ITEMS.md` M-18 ("the self-test must pass, else stay on the old pin"); report §12, MUST 3 row.

**What is wrong.**
- Step 2 says: with the new release installed, run `-k "stale_fixture or verified_for"`. "The version test fails at this point, as expected … The self-test must pass. If it fails, stay on the old pin: the conftest's teardown recovery needs a developer first." Step 3 lists the release in `PYTEST_VERIFIED` only "if it passed".
- But `_finish_teardown` (`gcs/conftest.py:857-859`) deliberately refuses the recovery on any release not in `PYTEST_VERIFIED`, and takes the hard exit.
- The self-test copies that conftest (`_run_tree`) and asserts `"hard exit (status 1)" not in out`.
- So on any unlisted release, which is every release one would upgrade to, the self-test fails by construction. This says nothing about pytest's internals.

**Evidence** (`upgrade3.sh`, `logs3\upgrade_step2*.txt`). A fresh venv with real **pytest 9.0.3** stands in for "a release not listed" (9.2 is not on PyPI yet), on a copy of 3a233ad. I followed step 2 verbatim:
- `test_a_hung_teardown_leaves_no_stale_fixture_for_later_tests` **FAILED**: `… the finalisers pytest skipped cannot be run safely (pytest 9.0.3 is not a release this recovery was verified for (PYTEST_VERIFIED ((9, 1),)))`, then `assert … "hard exit (status 1)" not in out`.
- The version test also FAILED.
- Same venv, with only `(9, 0)` added to `PYTEST_VERIFIED` first: **2 passed**. The recovery works on 9.0.3, yet the documented procedure would have told the owner to stay on the old pin and call a developer.

**Why it is MAJOR.**
- The procedure is part of the round-2 MAJOR's required fix (item 3), and it is written for a non-developer, who cannot see through it.
- It fails safe: CI stays green on the old pin.
- But every attempt to upgrade ends with the wrong diagnosis ("the conftest's teardown recovery needs a developer first").
- The same wrong statement appears in three owner-facing places (README, M-18, report §12).
- Protocol item 8: the claims must match reality.

**Expected.**
- Reorder the steps:
  1. Install the new release.
  2. Add it to `PYTEST_VERIFIED` in `gcs/conftest.py`, in the working copy.
  3. Run the self-test. It must pass; then the version test passes too.
  4. If the self-test passes, raise the four pins in the same commit, and run the drift test and the whole suite.
  5. If the self-test fails, revert the `PYTEST_VERIFIED` edit and stay on the old pin.
- Correct M-18 and §12 to match.
- Optionally add an environment override for the guard, used only by this check; but listing the release first is simpler.
- Optional: in step 1, use `pip install -e gcs[dev]` and then the new pytest, so the venv is the documented dev setup.

### 2. MINOR: stale docstring says pytest is not pinned

`gcs/tests/test_test_guards.py:720`, `test_the_teardown_recovery_was_verified_for_this_pytest`: "WP19 round 2 (verify F2): pytest is not pinned. … this test fails until someone re-checks it". This now contradicts the pin. The conftest comment at `:802-809` was updated, and this docstring should say the same: CI is pinned, and this test catches local venvs on another release.

### 3. MINOR: "a new pytest release changes nothing" is slightly overstated

`gcs/README.md:512` ("A new pytest release on PyPI therefore changes nothing … Nothing breaks on its own") and M-18 ("A new pytest on PyPI therefore changes nothing").
- `"pytest>=9.1,<9.2"` still takes a new **9.1.x** patch release on the next CI run.
- The remaining gap that the README watchdog row and the conftest docstring state elsewhere still applies: a behaviour change within a listed release is caught only by the self-test, on CI.
- **Expected:** "a new pytest **minor** release changes nothing; 9.1.x patch releases are still installed, and the R2 self-test checks them on every CI run".

## Approval rationale / items to fix

**Fixed or sound:**
- The pin is correct and in all four places. The YAML is valid, and the lines install 9.1.1 in bash and PowerShell without stray files.
- The drift test kills every one-sided change, and passes a legitimate joint bump. If the bump also drops `(9, 1)`, the version test fails on 9.1.1, as expected.
- §11 is corrected. The M-15 counts and the repeat figures are accurate and backed by logs.
- Every regression run and every round-1/2 mutant is as before.

**To fix for approval:**
- **Finding 1 (MAJOR):** reorder the upgrade procedure so the new release is listed in `PYTEST_VERIFIED` before the self-test runs, and correct the README, M-18 and §12 to match.
- **Findings 2 and 3 (MINOR):** one docstring and one phrase; recommended.

## Leftover processes

None.
- A `Win32_Process` search for command lines containing `verify\WP19` or `scratch3` returns nothing, and no python or node process is running.
- Every run ended by itself (the CI-mode pytest PID 20244 included). I stopped no process.

No elevation, no push, no desktop run. The only network use was reads and downloads from PyPI into throw-away venvs under `scratch3`.

Report: `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\verify\WP19\VERIFY-round3.md`
