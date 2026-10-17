# WP19 — GCS test follow-ups: rate-limit test timing, stale fixtures after a hung teardown, documented bounds

- **Worktree:** `S\wt\WP19`
- **Branch:** `wp/19` (from `main` at the commit that adds this brief, which contains WP17 and WP18; the first fully green GitHub run was 35affa1)
- **Files you own:**
  - `gcs/tests/**`, `gcs/conftest.py`
  - `gcs/vtolgcs/control.py`, only if the rate limiter needs an injectable clock; list and justify any product change
  - `gcs/README.md` (test section)
  - `docs/relay/OPEN-ITEMS.md` (row edits only)
  - `docs/tasks/reports/WP19-IMPLEMENTATION.md`

Read first:
- `01-COMMON-CONTEXT.md`
- `docs/tasks/reports/WP18-IMPLEMENTATION.md`, `WP18-VERIFY-round2.md` (its MINOR findings 1–3)
- OPEN-ITEMS rows **M-15** and **M-18**

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **`test_control.py::test_rate_limit_refuses_the_excess_with_a_warning` must be deterministic.**<br>- Today its margin is about 9–13 ms, measured with `time.monotonic`, which ticks in 15.6 ms steps on Windows. It failed once in the WP18 verifier's desktop run.<br>- Make it independent of wall-clock timing, for example with an injectable clock for the limiter, or by asserting on counts within a window driven by a fake clock. Keep the security property it guards: excess commands are refused with a warning, and UI load is never limited.<br>- Scan `gcs/tests` for other tests with the same pattern (tight margins on `time.monotonic`/`time.time` deltas, short sleeps used as synchronisation). Fix them, or list them with their margins in the report.<br>- Show it is stable: 30 isolated repeats of the test and of any other test you fixed, under 4-CPU affinity (`VTOLGCS_TEST_CPUS=4`), with zero failures.<br>- Update M-15: does this explain it? Close the row or say what remains. |
| R2 | MUST | **Stale fixtures after a hung teardown.**<br>- When a teardown is still running past its budget, `TestTimeout` skips that test's remaining finalisers. pytest then hands the cached, already-stopped fixture object (module or session scope) to later tests.<br>- Choose and justify one of: (a) hard-exit at that point, with stacks dumped and the test named; or (b) invalidate the affected higher-scope fixtures, so later tests get a fresh one or a clear error naming the cause.<br>- Self-test with a module-scoped fixture whose teardown hangs. |
| R3 | MUST | **Document the bounds.**<br>- The pytest header line, `gcs/README.md` and the conftest docstring state the per-test timeout, grace, teardown budget, hard-exit and faulthandler backstop.<br>- They also state the worst-case time per hanging test (≈190 s, ≈200 s for a GIL hang, per WP18 verify round 2; recompute it from your code).<br>- Check the arithmetic against the workflow step timeouts. |
| R4 | MUST | **All green:**<br>- CI mode (`CI=true GITHUB_ACTIONS=true`, stdin NUL, real Python) ×2<br>- at most 1 normal desktop run<br>- `node --test test/` with `VTOL_JSDOM` and `VTOL_PYTHON`<br>- `workflows.test.js`<br>- all `--check` scripts, `check-links`, `check-images`, `check-colours`, `gen_test_vectors --check`<br>- Update M-18 (closed, or what remains). |

## Rules

- Stop only processes you started, by PID.
- No pushes.
- No stress loops beyond R1's 30 repeats.
- Commit with the trailers.
