VERDICT: REJECTED

# WP19 verification — round 1

Verifier: independent agent. Branch `wp/19` at 762ffbe (commits 1f0dcaa, 5c5cbae, 762ffbe), base `main` 786acae.
`S` = `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad`.
My tools, logs and throw-away copies are in `S\verify\WP19\` (`mut.py`, `probes.py`, `repeat.py`, `vrun.py`, `logs\`, `scratch\`).
I did not modify the worktree or the main repo: `git status` is clean in both, and HEAD is unchanged.

**Summary.** The code is good. The product change is neutral, the R1 tests are exact and kill every mutation I was
asked about, R2 works in all six probes, the R3 arithmetic is right, and R4 is all green. I reject on **one MAJOR
report-honesty finding**: the M-15 closure (OPEN-ITEMS row and report §5) rests on a false premise. The fix is a
text edit.

## Scope

All 9 changed files are in "Files you own": `gcs/conftest.py`, `gcs/tests/{test_control,test_runtime_e2e,test_sender,test_test_guards}.py`, `gcs/vtolgcs/control.py` (justified in report §9.1), `gcs/README.md` (test section only: the watchdog row and the new "Time bounds"), `docs/relay/OPEN-ITEMS.md` (M-15 and M-18 rows only), `docs/tasks/reports/WP19-IMPLEMENTATION.md`. PASS.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| Product change | PASS | `control.py:385` `rate_clock: Callable[[], float] = time.perf_counter`, `:392`, `:531` `RateLimit(..., self._rate_clock)`; `RateLimit.__init__` default `clock=time.perf_counter` (`:307-308`, unchanged); `:397` `_budget = RateLimit(server_msgs_per_s, SERVER_MSGS_BURST)` (real clock); `__main__.py:690` passes no `rate_clock` | The default was **already** `perf_counter`, not `monotonic`: before WP19, `RateLimit(self.rate_per_s, self.rate_burst)` used that default. The default path is identical. The warning throttle (`time.monotonic`, `:569-572`), the refusal pause (`max(bucket.wait_s(), 1/rate)`) and the not-executed reply are untouched |
| R1 rate-limit test deterministic | PASS | `test_control.py:562-604`; mutations below; 15/15 isolated repeats | Exact counts `[True]*5 + [False]*10`, the error text, `rate_limited == 10`, the warning, recorded pauses `[0]*5 + [0.05]*10`, a real-time lower bound `took >= 0.405`, refill after 0.151 s (3 tokens), the connection stays usable |
| R1 UI load never limited | PASS | `test_control.py:607-620` | 300 at 30/s on the fake clock, then a burst of 30, plus the static `RATE_LIMIT_PER_S > 30 and RATE_BURST >= 30`. The old test (45 commands < burst 50) could not fail; the new one does (mutations) |
| R1 other timing tests | PASS | e2e `test_runtime_e2e.py:152-171`; sender `test_sender.py:532-544`; server budget `test_control.py:685-697`; report §4 list | The e2e rewrite is **not** a tautology (mutations below). The sender bound is stricter than before: a 5 % fast rate fails the new test but passes the old one |
| R1 stability | PASS | `logs\repeat\SUMMARY.txt` | 5 tests × 15 isolated processes, `VTOLGCS_TEST_CPUS=4` (the header line was checked in every log): 75/75 |
| R1 M-15 | **FAIL (wording)** | Finding 1 | The closure is defensible, but the reasoning given for it is factually wrong |
| R2 stale fixtures, option (b) | PASS | `conftest.py:800-884` `_finaliser_lists` / `_scope_node` / `_finish_teardown`, `:642-652` `on_timeout`, `:993-995` hook; self-test `test_test_guards.py:669-692`; my probes P1–P6 | Later tests get fresh fixtures. Patches are undone, and finalisers run in pytest's LIFO order. A second hang ends at the existing hard exit. A mismatch in the internals takes the hard exit and names the test. All three discriminating probes fail on the 786acae conftest |
| R3 bounds | PASS | docstring `conftest.py:33-39`; `worst_case_s` `:680-687`; header `:913-918`; README "Time bounds (WP19)"; test `test_test_guards.py:695-705` | Recomputed below. It matches `_Watchdog._run` and the step timeouts |
| R4 all green | PASS | below | CI ×2, desktop ×1, node, workflows, every check, trial merge |
| M-18 row | PASS (accurate) | OPEN-ITEMS M-18 | It matches the code and tests. Its "(if pytest's internals ever differ) hard exit" shares the slight overstatement of Finding 2 |

## Contract results

No contract was changed. The control channel's wire behaviour is unchanged: the refusal reply text, the pause and the warning are byte-identical, and only the clock source is now injectable. C3 failsafe intent: the e2e test still proves that a GCS stop leads to bridge FAILSAFE no earlier than T_hold (250 ms) after the GCS's last rc_up, and that the GCS's `failsafe_timing` is consistent with it.

## Tests run (commands + results)

### R1 mutations

These ran on throw-away copies of the HEAD tree, created with `mut.py` (copies in `scratch\mut_*`, logs in `logs\mut_*`).

| Mutation (control.py unless noted) | Target test(s) | Result |
|---|---|---|
| limiter never refuses (`limited = False`) | rate | **FAIL** (all 15 ok) |
| refused commands executed, ok reply (`if limited:` → `if False:`) | rate | **FAIL** |
| refused commands executed, but the reply still says refused (`self.handle(req)` before the refusal reply) | rate | passes (Finding 3; the old test missed it too) |
| `RATE_LIMIT_PER_S = 25.0` | rate + UI | **FAIL** (static `25.0 > 30`). With the static assert also removed, the 30/s loop fails at request 294 |
| no refusal pause in `_serve` (`if pause:` → `if False:`) | rate | **FAIL** (`took` 0.0017 s) |
| `_process` returns pause 0 | rate | **FAIL** (pauses list) |
| pause 10 ms instead of a token interval | rate | **FAIL** |
| no warning | rate | **FAIL** |
| bucket ignores the injected clock | rate + UI | **FAIL** both |
| UI path limited: server default `rate_per_s=20` | UI | **FAIL** (request 147) |
| UI path limited: `RATE_BURST = 10` | UI | **FAIL** (static) |
| UI path limited: `inputs` commands get their own 20/s bucket | UI | **FAIL** (request 12) |
| `bridge_sim.py`: FAILSAFE after 0.6 × T_hold | e2e | **FAIL** (`t_fs - t_last_rc` 0.15 s) |
| `runtime.py`: stop time taken 30 ms late | e2e | **FAIL** (new) / FAIL (old) |
| `runtime.py`: stop time taken 15 ms late | e2e | **FAIL** (new, observed 237.8) / FAIL (old) |
| `runtime.py`: `observed = 0` | e2e | **FAIL** |
| `sender.py`: deadlines 5 % short (≈263 Hz) | sender | **FAIL** new (316 > 250·1.2+3) / **passes** on the old test: the new bound is stricter |

### Repeats

`repeat.py 15`, each test in its own pytest process, `VTOLGCS_TEST_CPUS=4`:

| Test | Result |
|---|---|
| rate limit | 15/15 |
| UI load | 15/15 |
| server budget | 15/15 |
| e2e FAILSAFE | 15/15 |
| sender rate | 15/15 |

### Regression runs

| Run | Command | Result |
|---|---|---|
| CI mode 1 | `vrun.py scratch\full logs\ci1 ci`: real Python 3.12, venv site-packages on PYTHONPATH, `CI=true GITHUB_ACTIONS=true`, stdin NUL, own APPDATA, `-m "not interactive_desktop" --tb=long` | **697 passed, 7 deselected**, 138.4 s, exit 0. No `+++ LEAKED/TIMEOUT/FAILED/ERROR` or INTERNALERROR line, no python process left |
| CI mode 2 | the same | **697 passed, 7 deselected**, 138.3 s, exit 0, clean |
| Desktop (my only one) | `vrun.py … normal` (venv; header: `interactive_desktop tests RUN (WinSta0, session 1)`) | **702 passed, 2 skipped** (UI smoke needs `VTOLGCS_UI_SMOKE`), 161.6 s, exit 0, clean |
| Node | `VTOL_JSDOM=S\jsenv\node_modules\jsdom VTOL_PYTHON=S\venv\Scripts\python.exe node --test test/` | 310 pass, 0 fail, 0 skipped |
| Workflows | `VTOL_REQUIRE_WORKFLOW_TEST=1 VTOL_PYTHON=… node --test test/ci/workflows.test.js` | 7/7 (Windows PowerShell 5.1) |
| Checks | `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check`, `check-links`, `check-images`, `check-colours`, `gen_test_vectors.py --check`, `vtolgcs.protocol --selftest` | all exit 0 |
| Trial merge | local clone of `S\repo\vtol-manual` (786acae) in `scratch\merge`, `git merge --no-ff wp19` | clean, 9 files, +588/−52 |

`scratch\full` is a `git archive` of HEAD.

### R2 probes

`probes.py`, run with `VTOLGCS_TEST_TIMEOUT=2 GRACE=4 TEARDOWN_BUDGET=3 BACKSTOP_MARGIN=5`. Logs are in `logs\probe_*`.

| Probe | wp/19 | 786acae conftest |
|---|---|---|
| **P1 module scope.** A module fixture hangs in its teardown in the last test of module a. It depends on a module `mod_res`, a module `pytest.MonkeyPatch` (setitem + setenv) and an `addfinalizer`, and the module has `teardown_module` | exit 1 in 5.3 s, `3 passed, 1 error`, `ran the 4 finaliser(s)`. Events in LIFO order: addfinalizer → undo mod_patch → close mod#2 → teardown_module. Module b gets **mod#3**, live, with the patch and env undone. The session fixture keeps sess#1 | b1 FAILED: `mod#2` (stale), `patched=patched env=1` |
| **P2 session scope.** A session fixture hangs at the session's end (last test) | `3 passed, 1 error`, `ran the 3 finaliser(s)`: `close sess_a#1`, `undo sess_patch`. Clean end, no hard exit. Earlier tests kept the same live session object | — |
| **P3 function scope.** `monkeypatch` (setattr + setenv + chdir), `tmp_path` and an outer function fixture, with the hang in an inner fixture | `ran the 4 finaliser(s)`. The next test (same module) gets outer#2, original attribute, env and cwd. The other module is clean too | both later tests FAILED (`patched`) |
| **P4 nested.** function f1(m2, monkeypatch) → module m2 (hangs) → module m1 → session s1, plus a class-scoped k1 | `ran the 2 finaliser(s)`, `close m2#3`, `close m1#2`. Module b gets **m1#7**, the same s1#1, and env undone | b FAILED: stale m1#2 |
| **P5 a second hang during the recovery** (a skipped module finaliser hangs too, interruptibly) | `TestTimeout raised … (teardown …)`, then `+++ TIMEOUT: tests/test_a.py::test_a is still running 7 s later: hard exit (status 1)` with stacks. Exit 1 at 9.2 s (= timeout 2 + budget 3 + grace 4). test_b never ran | — |
| **P5b** the same with `time.sleep(600)` (not interruptible) | identical: hard exit at 9.2 s, names the test | — |
| **P6 internals mismatch.** The `_setupstate.stack` entries are swapped for a tuple subclass whose indexing raises once the test body ran (pytest's own unpacking still works) | `+++ TIMEOUT: tests/test_a.py::test_a: its teardown was interrupted after its budget, and the finalisers pytest skipped cannot be found (the finaliser lists were not readable before the teardown): hard exit (status 1) …`, stacks, exit 1. test_b never ran | — |

No stale fixture or patch leaked into a later test in any probe on wp/19.

### R3 arithmetic

Checked against `_Watchdog._run` (`conftest.py:563-621`): `end = fired + G`; on a teardown `td_raise_at = max(since, fired) + B`, `end = max(end, td_raise_at + G)`, backstop `end + M`.

- A teardown can start at the latest just before `T + G`.
- So `TestTimeout` comes at most at `T + G + B` = 170 s, the hard exit at `T + 2G + B` = **190 s**, and the backstop at **200 s**. These are the defaults in `conftest.py:103-108`.
- P5 confirms the formula with small values. The teardown started before the timeout, so 2 + 3 + 4 = 9 s.

Against the workflows:
- `ci.yml` step `timeout-minutes: 35` = 2100 s: 5 × (130 + 200 + 5) = 1675 s; the break-even per run is 2100/5 − 205 = 215 s. With an exit-guard hang: 5 × 385 = 1925 s.
- `gcs-build.yml` test step `timeout-minutes: 15` = 900 s: 330 s for one hang; "up to three" holds at 200 s each.
- My CI-mode runs take 138 s, so the "≈130 s" estimate is fair.

## Smoke tests

Not a web WP. The behavioural checks are the mutations and probes above.

## Findings

1. **MAJOR: the M-15 closure rests on a false statement** (`docs/relay/OPEN-ITEMS.md` M-15, report §1 and §5). Both say the rate-limit test "is the only test seen failing in a full local run since WP10", and use that to argue it is the "most likely explanation". That is not true:
   - WP17 saw `test_control.py::test_many_stalled_handshakes_time_out_and_free_their_slots` fail in a full CI-like local run. See `docs/tasks/reports/WP17-IMPLEMENTATION.md:82`: "1st: 680 passed, 8 skipped, **1 failed** (the stalled-handshake race, now fixed)".
   - That test's failure rate before the fix was 2 in about 51 isolated runs (`:24`, `:86`). WP17 itself called it "probably M-15" (`:24`, `:124`).
   - That test, with its race, already existed at WP10 R10b. `git show 32b73f5:gcs/tests/test_control.py` has it at line 410 in its pre-fix form, which only waits for `handshake_failures >= MAX_PENDING`.

   So at the time of WP10's batch there are two known flaky candidates with comparable evidence, and both are fixed now. The new row drops the WP17 candidate from its reasoning (it survives only in the "Was:" text) and presents the WP19 one as the probable cause. The brief asked "does this explain it?", and the honest answer is "one of two candidates, both now fixed; which one cannot be told".
   - **Expected:** correct M-15 and report §1 and §5. Name both candidates and their evidence, and say that both are fixed. The row can stay CLOSED on that basis, with the existing "if it recurs, the `+++ FAILED` line names it" clause.

   I grade this MAJOR under protocol item 8 (the report's claims must match reality). The brief's R1 explicitly asked for this judgement, and the false premise is what the closure argues from. The fix is a text edit only.

2. **MINOR: pytest is neither pinned nor version-checked; the guard is partial.**
   - The CI workflows install an unpinned `pip install pytest` (`ci.yml:105,129`, `gcs-build.yml:49`). `conftest.py` does not check `pytest.version_tuple`.
   - What does guard an upgrade:
     - a structural change (attributes missing, entries reshaped) makes `_finaliser_lists`/`_finish_teardown` take the hard exit (P6);
     - the R2 self-test runs on every Windows CI run and asserts "no hard exit", fresh fixtures and an undone `monkeypatch`, so such an upgrade fails loudly in CI.
   - What is not covered: a semantic change that leaves the attributes in place. One example is `teardown_exact` iterating the finaliser list without popping it. `_finish_teardown` would then re-run finalisers that already ran, and the self-test would most likely still pass.
   - The README ("if pytest's internals ever change so that this cannot be done, it takes the hard exit instead"), M-18 and report §6 ("The fallback covers a change to them") overstate this.
   - **Suggestion:** a `pytest.version_tuple[:2] == (9, 1)` check that prints a header warning or fails the self-test with "re-verify `_finish_teardown` against pytest X". Or pin `pytest==9.1.*` in the workflows. Or word the docs as "structural changes".

3. **MINOR (pre-existing, not a weakening): the rate-limit test does not prove that refused commands are not executed.**
   - It sends `request_mode idle`, which has no observable effect. A mutation that runs `self.handle(req)` and still sends the "rate limit … not executed" reply passes. It passed on the 786acae test too.
   - The docstring claims "(not executed, not queued)".
   - **Suggestion:** use a command with a visible effect for the refused requests. For example, `request_mode fpv` after the burst, then assert that the sender's mode is still idle and its packet count unchanged.

4. **Note (no finding).** If a teardown hook raised a different exception while a `TestTimeout` was still pending (not yet delivered), the pending one could be delivered inside `_finish_teardown` and cut the recovery short. The window is a few bytecodes, and the existing hard exit still bounds it. Not worth a change.

5. **Note.** Like the implementer, I sent the check scripts' scratch output to Git Bash `/tmp/null.txt` once, and deleted it afterwards.

## Approval rationale / items to fix

The code side of WP19 is sound:
- The product change is neutral, with the default `perf_counter` as before.
- The rate-limit and UI-load tests are exact and kill every mutation the task asked about.
- The e2e failsafe rewrite still proves the stop → T_hold → FAILSAFE behaviour, and is as sensitive as before to a 15 ms error.
- R2 option (b) works in all six probes, including the second hang and the internals mismatch.
- The R3 arithmetic matches the code and the workflows.
- R4 is green everywhere.

**To fix for approval:** Finding 1, a correction of the M-15 row and report §1 and §5. Findings 2 and 3 are MINOR. They are recommended, not required.

**Leftover processes:** none. A `Win32_Process` search for command lines under `verify\WP19` (mutation and probe copies included) returns nothing. Every run and probe ended by itself (the probes' hard exits included). I stopped no process. There was no elevation, no network write and no push, and only 1 desktop run.

Report: `C:\Users\SIMULA~1\AppData\Local\Temp\claude\C--Users-Simulator--local-bin\8b20c513-1423-4428-a521-9d0f657bd241\scratchpad\verify\WP19\VERIFY-round1.md`
