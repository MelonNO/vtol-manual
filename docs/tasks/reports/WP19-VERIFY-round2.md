VERDICT: REJECTED

# WP19 verification — round 2

Verifier: independent agent. Branch `wp/19` at 843b490 (round 2: 7956133 code F2/F3, 843b490 docs F1), base `main` 786acae.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.

**Where my files are.** Everything is under `S\verify\WP19\`:
- round-2 tools: `mut2.py`, `probes2.py`, `repeat2.py`, plus round 1's `vrun.py`;
- logs: `logs2\`;
- throw-away copies: `scratch2\` (`base` and `full` = `git archive` of 843b490; `merge` = the trial-merge clone).

The worktree and the main repo are untouched: `git status` is clean in both, and the HEADs are 843b490 and 786acae.

## Summary

**The round-1 MAJOR is fixed.**
- M-15 and report §1, §2 and §5 now name both candidates.
- Every substantive statement checks out against WP17, WP18 and git (one count is slightly off: Finding 2).

**The code is good.**
- Every round-2 mutation I ran is killed.
- The probes and the round-1 spot checks are unchanged.
- Every regression run is green.

**I reject on one MAJOR finding: the F2 rework creates a CI time bomb, and the report understates it.**
- CI installs an unpinned pytest. The new version test fails on any pytest minor other than 9.1.
- So the day pytest 9.2 is published, every Windows CI run goes red with no code change, and so does every tagged GCS release build.
- The report calls this "one red CI run per new pytest minor release". In fact it is every run, until someone re-verifies.
- No owner-facing document says what to do.
- The fix is small: a pin in the three workflow install lines (outside WP19's files: a PM decision) plus corrected text.

## Requirement results (round-2 claims)

| Claim | Result | Evidence | Note |
|---|---|---|---|
| **F1:** M-15 and report §1/§2/§5 name both candidates; the row stays CLOSED | **PASS** (one MINOR count error, Finding 2) | below | The substance is right |
| **F2:** `PYTEST_VERIFIED`, hard exit plus header WARNING, version test, "exactly once" self-test, gap stated | **PASS (mechanism)**; **FAIL (operational, Finding 1)** | `conftest.py:808,811,855,939-942`; `test_test_guards.py:713-724`; mutations | The mechanism works exactly as claimed |
| **F3:** refused commands are FPV starts; a spy proves only 5 ran; the sender stays idle with `rx_ok == 0`; the positive control streams | **PASS** | `test_control.py:572-617`; mutations; 10/10 repeats; CI runs | No streaming sender is left behind: 0 `LEAKED` lines in 2 CI runs and 10 isolated runs |
| Round-1 items intact | **PASS** | mutations, probes, repeats | — |
| Regression | **PASS** | below | — |

### F1 detail: every statement checked

| Statement (M-15 / §5) | Source | Result |
|---|---|---|
| Stalled-handshake test existed at 32b73f5 in race-prone form | `git show 32b73f5:gcs/tests/test_control.py:410-421`: waits only for `handshake_failures >= MAX_PENDING`. The WP17 fix (331732c) adds `r.expect(lambda: r.server._pending == 0, …)` | true |
| Failed once in WP17's full CI-like run (§1, R4 c) | WP17-IMPLEMENTATION `:24` (§1), `:82` (R4 c: "1 failed (the stalled-handshake race)") | true |
| "2 times in about 51 **isolated** runs before the fix" | WP17 `:86`: isolated original 1/20 + 0/30 = **1 in 50**. The "2 in about 51" of `:24` counts the full run too | **inaccurate** (Finding 2). I introduced this wording in round-1 Finding 1 myself, and the implementer copied it |
| 0 in 50 after the fix | WP17 `:86`: fixed 0/20 + 0/30 | true |
| Fixed in WP17 (331732c) | `git show 331732c`: "race fixed in the stalled-handshake test" | true |
| Rate-limit test added in WP13 3244ff5, byte-identical at 32b73f5 | 3244ff5 is an ancestor of 32b73f5. The function (and `class RateLimit`) is byte-identical at 3244ff5, 32b73f5 and 786acae. `control.py` is unchanged from 32b73f5 to 786acae | true |
| Failed once in the WP18 verifier's desktop (full) run | WP18-VERIFY-round2 `:154`: "1 failed, 699 passed … `assert 13 <= 20 * 0.594 + 1`" | true |
| WP10 batch at R10b 32b73f5; the test id was never kept | WP10-IMPLEMENTATION `:57`, `:84-85`, `:120-125` | true (as far as the record goes) |
| "neither can be named as the cause; with both fixed nothing known is left open"; the row stays CLOSED with the recurrence clause | — | sound; what round 1 asked for |

I found no other false statement in M-15, M-18, the README watchdog row or report §1–§11, except the two noted in Findings 1 and 2.

One more point, not a finding. The "0 failures in 30 isolated repeats" in M-15 and §5 refers to the round-1 form of the rate-limit test. Round 2 changed that test, and its §11 reports no new repeats. My 10/10 isolated repeats and both CI runs pass, and the parts added are exact or a generous poll, so the risk is low.

### F2 detail

**Code.**
- `teardown_recovery_verified()` compares `pytest.version_tuple[:2]` with `PYTEST_VERIFIED = ((9, 1),)`.
- `_finish_teardown` raises into the existing hard-exit path with the reason.
- The header prints either "(pytest 9.1.1, verified)" or a WARNING.
- The real CI logs show `vtolgcs: a teardown interrupted after its budget: the finalisers pytest skipped are run (pytest 9.1.1, verified)`.

**Mutations** (`mut2.py`, logs `logs2\mut_base_*.txt`):

| Mutation (on a copy of 843b490) | Test(s) | Result |
|---|---|---|
| `PYTEST_VERIFIED = ((9, 0),)` | R2 self-test + version test | **both FAIL**. The inner header shows `vtolgcs: WARNING pytest 9.1.1 is not verified for the teardown recovery (PYTEST_VERIFIED ((9, 0),)): …`, and the hang takes `+++ TIMEOUT: tests/test_a_mod.py::test_module_teardown_hangs: … cannot be run safely (pytest 9.1.1 is not a release this recovery was verified for …): hard exit (status 1)`. The version test says `re-verify gcs/conftest.py _finish_teardown against this release, then add it to PYTEST_VERIFIED` |
| finaliser lists copied (`list(entry[0])`, i.e. not popped in place) | R2 self-test | **FAIL**: `['mod-2', 'mod-3', 'node-fin', 'node-fin', …]` (ran twice) |
| skipped finalisers not run (`fin()` → `pass`) | R2 self-test | **FAIL**: both "fresh" tests FAILED |

**Documentation.** The README watchdog row, M-18, the conftest docstrings and report §6 state the remaining gap accurately: a behaviour change within a listed release is caught only by the self-test. The operational consequence is a separate matter (Finding 1).

**PyPI today** (`pip index versions pytest`): the latest is **9.1.1**, the version installed in the venv and the real Python. There is no 9.2 yet, so CI is green today.

### F3 detail

**Mutations:**

| Mutation (`control.py`) | Result |
|---|---|
| refused command executed through `self.handle(req)`, reply still "refused" (round 1's surviving mutant) | **FAIL**: `handled` = 15× `request_mode` |
| refused command executed directly: `if req.get("cmd") == "request_mode": self._cmd_request_mode(req)` before the refusal reply (bypasses the spy) | **FAIL**: `SenderState(mode=<Mode.FPV>, streaming=True, …)` |
| `if limited:` → `if False:` (executed, ok reply) | **FAIL** |

**Leak check.**
- The positive control starts a real stream. The `rig` fixture's ExitStack stops the server, runtime and sim in reverse order.
- There were 0 `+++ LEAKED` lines in 2 full CI-mode runs and in 10 isolated runs (`repeat2.py` greps every log for `+++ LEAKED` and `+++ TIMEOUT`).

## Round-1 spot checks

- **R1 mutations:**
  - `RATE_LIMIT_PER_S = 25.0`: FAIL, `assert (25.0 > 30)`.
  - No refusal pause in `_serve`: FAIL, `took` 0.0017 s.
- **Repeats:** `REPEAT_ONLY=test_rate_limit_refuses repeat2.py 10`, each in its own pytest process, `VTOLGCS_TEST_CPUS=4` (the header was checked in every log): **10/10**, 0.9–1.1 s each, no leak or timeout lines.
- **Hung-teardown probes** (`probes2.py`, T 2 / G 4 / B 3 / M 5, logs `logs2\probe_base_*`). Identical to round 1:

| Probe | Result |
|---|---|
| P1 (module) | exit 1, 5.3 s, `3 passed, 1 error`, ran 4 finalisers in LIFO order. Module b gets mod#3, with the patch and env undone |
| P3 (function) | fresh `outer#2`, patches undone |
| P4 (nested) | m1#7 fresh, s1#1 kept |
| P5 (second hang) | hard exit at 9.2 s, names the test, test_b never ran |
| P6 (internals mismatch) | hard exit naming the test: "cannot be run safely (the finaliser lists were not readable …)" |

  The header's own bound for these values is 13 s (18 s with the GIL held), and that is consistent.

## Contract results

No contract was changed. The control channel's wire behaviour is unchanged, and round 2 changed no product code. C3 failsafe intent: untouched.

## Tests run (commands + results)

| Run | Command | Result |
|---|---|---|
| CI mode 1 | `vrun.py scratch2\full logs2\ci1 ci` (real Python 3.12, venv site-packages on PYTHONPATH, `CI=true GITHUB_ACTIONS=true`, stdin NUL, own APPDATA, `-m "not interactive_desktop" --tb=long`) | **698 passed, 7 deselected**, 138.8 s, exit 0. No `+++ LEAKED/TIMEOUT/FAILED/ERROR` or INTERNALERROR line, no python process left. The header shows "verified" |
| CI mode 2 | the same | **698 passed, 7 deselected**, 137.4 s, exit 0, clean |
| Desktop | — | none run (as instructed) |
| Node | `VTOL_JSDOM=S\jsenv\node_modules\jsdom VTOL_PYTHON=S\venv\Scripts\python.exe node --test test/` | 310 pass, 0 fail, 0 skipped |
| Workflows | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=… node --test test/ci/workflows.test.js` | 7/7 (Windows PowerShell 5.1) |
| Checks | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0 (`logs2\checks.txt`) |
| Trial merge | clone of `S\repo\vtol-manual` (786acae) in `scratch2\merge`, `git merge --no-ff wp19` | clean, 9 files, +728/−56, all in "Files you own" |
| Mutations | `mut2.py` (8 mutants) | all killed (above) |

## Smoke tests

Not a web WP. The behavioural checks are the mutations and probes above.

## Findings

### 1. MAJOR: the F2 guard without a pin turns every future pytest minor release into a red CI and a blocked GCS release, and the report understates this

Files: `gcs/conftest.py:801-808`, `gcs/tests/test_test_guards.py:719-724`, report §11 "Why a guard rather than a pin", README watchdog row, M-18; the workflows `ci.yml:105,129` and `gcs-build.yml:49`.

**What happens.**
- The workflows install an unpinned `pip install pytest`.
- `test_the_teardown_recovery_was_verified_for_this_pytest` fails on any (major, minor) other than (9, 1). Mutation `verified_90` proves it.
- The day PyPI publishes pytest 9.2, with no change in this repo:

| Where | What it means |
|---|---|
| `ci.yml` `python-windows` (×5) | every run fails, on every push and PR, until someone re-verifies |
| `gcs-build.yml` "Tests, headless-safe suite" step | fails, and it gates the build. `release` has `needs: build` (`gcs-build.yml:126-129`). A `v*` tag then **cannot publish the GCS zip** |

**Why it is MAJOR.**
- **The report understates it.** §11 says the guard costs "one red CI run per new pytest minor release, by design". That is not true. CI stays red, and releases stay blocked, until a developer reads `teardown_exact` / `FixtureDef.finish` in the new pytest, updates `PYTEST_VERIFIED` and pushes. Protocol item 8.
- **The release block is not mentioned anywhere**: not in the README, M-18 or the report.
- **The owner gets no usable instruction.** The test's message ("re-verify gcs/conftest.py `_finish_teardown` against this release") cannot be acted on by a non-developer. No OPEN-ITEMS row tracks the scheduled breakage. M-18 is CLOSED.
- **CI is not reproducible.** The same commit is green today and red after an upstream release. Protocol item 7: a sensible implementation does not schedule a failure of the release pipeline.

**The round-2 rationale for not pinning does not hold.** It said "a pin would keep the suite from ever meeting a new pytest". A pin is raised deliberately, in the same commit that re-verifies and extends `PYTEST_VERIFIED`. The guard keeps its value for local venvs (the owner's M-16 desktop runs), so the two are complementary, not alternatives. The implementer's real constraint is valid: the workflows are not in WP19's files.

**Expected (concrete).**
1. **PM decision: pin in the three install lines.**
   - `ci.yml:105`: `python -m pip install "pytest>=9.1,<9.2"`.
   - `ci.yml:129` and `gcs-build.yml:49`: the same specifier, beside `pygame-ce` (and `"pyinstaller>=6"` in gcs-build).
   - Either add `.github/workflows/ci.yml` and `gcs-build.yml` (those lines only) to WP19's files, or apply it at merge.
   - Optionally the same specifier in `gcs/pyproject.toml` `dev`, so a local `pip install -e gcs[dev]` matches.
   - Keep `PYTEST_VERIFIED`, the header WARNING and the version test, for unpinned local venvs.
   - Check that `workflows.test.js` still passes. Today it does not assert on the install lines.
2. **Implementer: correct §11.** Replace "one red CI run per new pytest minor release" with the true consequence, or with the pinned behaviour once the PM decides.
3. **Implementer: add to the README test section and M-18 a short plain-language procedure for upgrading pytest.** Re-verify `SetupState.teardown_exact` (pops before calling) and `FixtureDef.finish` (clears `cached_result`), run the R2 self-test, then raise the pin and `PYTEST_VERIFIED` in one commit.
4. **If the PM declines the pin:** M-18, the README and §11 must say explicitly that the day a new pytest minor is published, every Windows CI run and every tagged GCS release build fails until a developer re-verifies. An open OPEN-ITEMS row must name this as a known scheduled breakage with that procedure.

### 2. MINOR: M-15 and report §5 miscount the stalled-handshake isolated runs

Files: `docs/relay/OPEN-ITEMS.md` M-15; report §5 table.

- **The text:** "2 times in about 51 isolated runs before WP17 fixed its race".
- **The source:** WP17-IMPLEMENTATION `:86` shows the isolated runs were 1/20 + 0/30 = **1 in 50**. The "2 in about 51" of `:24` includes the full CI-like run, which the same sentence already counts.
- **The origin:** I introduced this wording in round 1 (Finding 1, "2 in about 51 isolated runs").
- **Expected:** "1 in 50 isolated runs (2 in about 51 counting that full run)".

It does not change the conclusion.

### 3. Note: the 30-repeat figure predates round 2

M-15 and §5 cite "0 failures in 30 isolated repeats" for the rate-limit test. Those repeats were of the round-1 form, and round 2 changed the test. My 10/10 and the 2 CI runs cover the new form. Optional: say "(round-1 form; round-2 form 10/10 by the verifier)", or rerun.

## Approval rationale / items to fix

**Fixed or sound:**
- The round-1 MAJOR (M-15 premise) is fixed, and its substance is accurate.
- F3 is a good fix: it kills the round-1 surviving mutant and the direct-execution variant, and it leaks nothing.
- The F2 mechanism works exactly as described: hard exit with the reason, the WARNING, the failing version test, exactly-once detection.
- The round-1 behaviour is intact, and every regression is green.

**To fix for approval:**
- **Finding 1.** Correct §11's "one red CI run" claim. State the CI and release consequence and the upgrade procedure. Get the PM's decision on pinning `pytest>=9.1,<9.2` in `ci.yml:105,129` and `gcs-build.yml:49`; I recommend it. If not pinned, add an open OPEN-ITEMS row naming the scheduled breakage.
- **Finding 2** (MINOR) is a one-phrase fix, recommended.

**Leftover processes:** none.
- A `Win32_Process` search for command lines containing `verify\WP19` or `scratch2` returns nothing.
- `vrun.py` found no new python process alive after either CI run (pytest PIDs 26008 and 3804 exited by themselves).
- Every mutation, probe and repeat ended by itself, the probes' hard exits included.
- I stopped no process. No elevation, no push, no network write (only a PyPI read, `pip index versions pytest`), no desktop run.

Report: `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\verify\WP19\VERIFY-round2.md`
