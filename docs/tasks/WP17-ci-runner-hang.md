# WP17 — GCS test suite hangs on GitHub's Windows runners

- **Worktree:** `S\wt\WP17`
- **Branch:** `wp/17`
- **Files you own:** `gcs/tests/**`, `gcs/conftest.py`, `gcs/pyproject.toml` (test config only), `.github/workflows/*.yml`, `test/ci/**`, `docs/relay/OPEN-ITEMS.md` (row edits only), `docs/tasks/reports/WP17-IMPLEMENTATION.md`

## Problem (first real GitHub run, commit b4a8aef)

- **Passed:** the web job (25 s) and the Linux protocol job (7 s).
- **Workflow "GCS build", job "Build vtol-gcs (windows-latest)":** **cancelled at its 40-minute timeout in step 5**, `python -m pytest gcs protocol -q -p no:cacheprovider`. No artifact.
- **Workflow "CI", job "Python — full GCS suite ×5 (Windows)":** still running after 45 min (60-minute timeout), so it almost certainly hangs the same way.
- **Locally** the same suite passes in about 90 s per run (682 passed, 2 skipped).
- **Logs:** the PM cannot read the GitHub logs (they need a signed-in account; the API is rate-limited without a token). `-q` output also does not name the hanging test.

**Most likely cause:** tests that need an **interactive desktop session**, which GitHub's hosted runners don't have (the runner is a service with no interactive desktop or foreground window). For example:
- consoles created with `CREATE_NO_WINDOW` and driven via `WriteConsoleInput` / `GenerateConsoleCtrlEvent`
- Ctrl+C/Ctrl+Break delivery
- `GetForegroundWindow` checks
- tkinter UI tests
- pygame joystick init
- `SetThreadExecutionState`
- firewall/`icacls`/named-pipe ACL calls that behave differently under the runner account
- subprocesses that wait on stdin
- tests that spawn `bridge_sim` and wait for a UDP port

**Do not guess one cause; make the suite self-diagnosing AND robust.**

## Requirements

All are MUST.

| ID | Requirement |
|---|---|
| R1 | **Per-test timeout with a stack dump:** every test gets a hard timeout (e.g. 120 s; longer for explicitly marked slow tests). On timeout it fails with a full thread stack dump (`faulthandler.dump_traceback_later` in an autouse fixture or a conftest hook — no new third-party dependency unless justified; if you add `pytest-timeout`, pin it and install it in both workflows). Every subprocess started by tests has its own timeout and is always killed in teardown. |
| R2 | **Live test names in CI:** the workflow pytest steps run with `-v` (or `-rA` plus `--durations`) and unbuffered output (`-u` / `PYTHONUNBUFFERED=1`), so the live job log shows the test that is running. Also set step-level `timeout-minutes` below the job timeout so the log-upload step still runs after a hang. |
| R3 | **Interactive-desktop tests:** add a pytest marker (e.g. `interactive_desktop`) to every test that needs a real interactive console/desktop or foreground-window semantics. Detect a non-interactive session in code (e.g. `GITHUB_ACTIONS`/`CI` env, or no interactive window station/desktop, or `GetConsoleWindow`/`GetForegroundWindow` unusable) and **skip** those tests there, with a precise reason. Locally on the owner's PC they must still run. List every marked test and why in the report. Never skip a safety assertion that can run headless: split such tests so the headless part still runs in CI. |
| R4 | **Reproduce as closely as possible locally:** run the suite in a non-interactive context, e.g. `CI=true GITHUB_ACTIONS=true` plus stdin from NUL, ideally also via a scheduled task or service-like launch without a desktop (e.g. `schtasks /RU SYSTEM` is NOT allowed — no admin changes on the owner's machine; use only what needs no elevation). Report what you could and could not reproduce. |
| R5 | **Release-only behaviour unchanged:** the GCS build job's test step may run only the headless-safe suite (marker expression); the full-suite stability job in `ci.yml` keeps 5 runs with the same skips. Job timeouts: GCS build ≤ 30 min, the CI Windows job ≤ 45 min. |
| R6 | **Tests stay green locally:** `pytest gcs protocol` passes several times on the owner's PC (interactive tests included). Add `test/ci/workflows.test.js` checks for R2 (verbose/unbuffered flags, step timeouts) so they can't regress. `node --test test/` stays green. No CPU-stress or long load tests on the owner's machine; clean up every process you start, by PID only. |
| R7 | **OPEN-ITEMS:** add a row noting which interactive-desktop tests run only locally and should be run before each release on a real desktop (with the command). |
