# WP10 verification — round 2
VERDICT: APPROVED

Round 2 checks branch `wp/10` at `d697f8a` ("rework round 1") on top of `fd450b1`. The base is `f7b5060`, which equals
current `main`. All work ran in throw-away clones under `S\verify\WP10\` (`clone2`, `mut2`, `mergetest2`, `r2\`).

Constraints followed this round:
- No CPU-stress or load test.
- The real `%APPDATA%\vtol-gcs` was never written (it still does not exist); pytest used `APPDATA=S\verify\WP10\appdata`.
- Every process started this round has exited.
- The four processes orphaned in round 1 (bash 24076/24352 and node 22264/7556, all running my `mut-runner/step.sh`) are now stopped, after confirming their command lines.

## Scope of the rework

Eight files changed:

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | F1, F2 |
| `test/ci/workflows.test.js` | New: F1 proof |
| `gcs/tests/test_runtime_e2e.py` | F3 |
| `docs/relay/OPEN-ITEMS.md` | F4 → M-15 |
| `CHANGELOG.md` | F5 |
| `.gitignore`, `scripts/git-setup.ps1` | F6 |
| `docs/tasks/reports/WP10-IMPLEMENTATION.md` | Rework section |

`scripts/git-setup.ps1` is outside the brief's file list. The edit is the minimum needed and justified: the script appends a fixed list of lines to `.gitignore` (`$ignoreLines`, `:43-58`). If the three Flask-era entries had stayed in that list, a re-run would add them back. Three lines were deleted and nothing else changed. **Accepted.**

## Round-1 findings

| # | Result | Evidence |
|---|---|---|
| F1 (MAJOR) | **FIXED** | See "F1: verbatim reproduction" below. `ci.yml` jsdom step: `shell: bash` (→ `bash --noprofile --norc -eo pipefail`) plus its own `set -o pipefail` plus a `^ℹ fail [1-9]\|^# fail [1-9]` guard. |
| F2 | **FIXED** | The pwsh loop annotates only pytest summary ids: case-sensitive `^(FAILED\|ERROR) ((gcs\|protocol)/\S+)`. Each distinct id is annotated once with its run numbers (at most 9), then one summary line, so it stays under GitHub's 10-per-step limit. A warning is added if more than 9 tests fail. Captured log lines no longer match (reproduced below). |
| F3 | **FIXED** | `test_api_status_is_cached_briefly` redirects the instance attribute `rt.status` and calls `Runtime.status(rt, …)` directly. I checked every caller in `gcs/vtolgcs/`: `runtime.py:442` (`self.status()` in the monitor), `runtime.py:193` (`lambda: self.status(...)`, API/SSE), `control.py:642` and `__main__.py:220/296` (`self.rt.status` / `rt.status`). All of them look the method up through the instance, so after the patch only the test touches the cache. The race from round 1 is gone. Passed 5/5 on its own and in the full run. |
| F4 | **DOCUMENTED** | `docs/relay/OPEN-ITEMS.md` M-15 is accurate: 17 green runs, CI keeps full logs and annotates the test id, and it says to close the row once the test is named. |
| F5 | **FIXED** | `CHANGELOG.md:16-17`: "17 work packages (WP01–WP16, WP08 in two parts)". |
| F6 | **FIXED** | `.gitignore` no longer lists `relay/__pycache__/`, `relay/*.pyc`, `relay/.env`; `git-setup.ps1` is updated to match. |

## F1: verbatim reproduction (my own extraction, independent of the implementer's parser)

### Every piped step

I parsed both workflows with PyYAML (`r2\extract.py` → `r2\steps.json`). The `run:` steps that contain a pipe are:

| Step | Shell | Test output? |
|---|---|---|
| `ci.yml` web step 5, jsdom tests | `shell: bash` | yes |
| `ci.yml` python-windows step 5, pytest ×5 | `shell: pwsh` | yes |
| `gcs-build.yml` "Zip the build folder" | pwsh (`Get-Item … \| Format-List`) | no |

Every other step has no pipe, so its exit status propagates. That includes the `gcs-build` "Tests" step.

### The jsdom step, extracted verbatim

The step was run in a temp tree whose `test/index.js` requires `a.test.js`. The environment was `RUNNER_TEMP=<tmp>`, `VTOL_JSDOM=` and `NODE_TEST_CONTEXT` unset.

| Tree | `bash -e` (GitHub default) | `bash --noprofile --norc -eo pipefail` (`shell: bash`) |
|---|---|---|
| a deliberately failing test | **1** (`ℹ fail 1`) | **1** |
| a skipped test | **1** ("tests were skipped…") | **1** |
| all tests pass | **0** | **0** |
| the real repo with jsdom 30.1.3 (CI tools as installed in round 1), green | — | **0** (306/306) |

In round 1 the same failing tree gave exit 0 under `bash -e`.

### The Windows pytest loop, extracted verbatim

The step was wrapped exactly as GitHub's pwsh template wraps it: `$ErrorActionPreference = 'stop'` first, `exit $LASTEXITCODE` last. It ran through `powershell -NoProfile -ExecutionPolicy Bypass -File`, with a `python.cmd` shim pointing to the venv.

| Tree | Exit | Logs | Annotations |
|---|---|---|---|
| `test_bad` (12 `logging.error` lines + assert) and `test_err` (raises) | **1** | 5 | `gcs/tests/test_f.py::test_bad failed in run(s) 1, 2, 3, 4, 5 of 5`, `…::test_err failed in run(s) 1, 2, 3, 4, 5 of 5`, then the summary. **No captured log line.** |
| fails **only in run 3** (counter file) | **1** | 5 | `gcs/tests/test_fl.py::test_flaky failed in run(s) 3 of 5` + summary. **This is exactly the M-15 scenario: the intermittent failure is now named.** |
| collection error (`import no_such_module_xyz`) | **1** | 5 | `gcs/tests/test_c.py failed in run(s) 1, …, 5 of 5` + summary |
| all pass | **0** | 5 | none |

### Review of `test/ci/workflows.test.js`

- **Static rule:** every non-PowerShell step that pipes (pipes inside quoted strings are ignored) must contain `set -o pipefail`, and the jsdom step must declare `shell: bash`.
  - **Mutation check:** with `set -o pipefail` removed from `ci.yml` (in clone `mut2`), the static test fails with "pipes output without pipefail".
  - The behavioural bash test still passes on that mutant because of the fail-count guard, which is intended defence in depth.
- **Behavioural checks:** the bash step is checked under plain `bash -e` (fail → ≠ 0, skip → ≠ 0, pass → 0). The pwsh step is checked on Windows (failing → ≠ 0, 5 logs, exactly the 2 expected annotations; passing → 0).
- **Gating:**
  - Where a tool is missing, the test passes with a diagnostic instead of a skip, so the "no skip with jsdom" guard keeps its meaning.
  - On the `python-windows` job, `VTOL_REQUIRE_WORKFLOW_TEST=1` turns a missing tool into a failure, so the check cannot vanish silently there.
  - I confirmed this locally from PowerShell: with no Git `bash` and no pytest-capable `python` on the Windows PATH, both checks fail ("cannot run this check here"). With Git `bin` and `VTOL_PYTHON` set: 3/3 pass.
- **Parser:** the line-based YAML step reader is adequate for these two files. Its results agree with my PyYAML extraction.

### Judgement on the PowerShell 5.1 vs pwsh 7 caveat

Both the implementer's proof and the CI self-test run the step under Windows PowerShell 5.1; the real step runs under pwsh 7.

- **What the script uses** works the same in both versions: `[ordered]@{}`, `.Contains`, `Select-String -CaseSensitive`, `Matches[0].Groups[2]`, `Tee-Object -FilePath`, `$LASTEXITCODE`, `-join`.
- **The real differences** do not change the result:
  - `Tee-Object` writes UTF-16LE in 5.1 and UTF-8 in pwsh 7. `Select-String` detects both, and both are fine for the uploaded artifact.
  - Native stderr redirected with `2>&1` under `$ErrorActionPreference='stop'`:
    - 5.1 is the stricter version: a stderr line would terminate the script.
    - pwsh ≥ 7.2 does not terminate (and `PSNativeCommandUseErrorActionPreference` is off by default).

  A pass under 5.1 therefore implies a pass under pwsh 7 for this script.
- **Residual risk:** low. Only the first real run on `windows-latest` exercises pwsh 7 itself. Optional hardening: let the self-test prefer `pwsh` when it exists (runners have it) and fall back to `powershell`. Not required.

## Regression (commands + results)

Environment: Node 24.20.0, Python 3.12.10 venv, jsdom 30.1.3 and html-validate 11.16.2 installed as CI does it.

| Command | Result |
|---|---|
| `node --test test/` | 306 tests: 297 pass, 0 fail, 9 skipped. The pwsh check reports "not run here: no Python with pytest" as a diagnostic, by design. |
| CI jsdom step verbatim on the repo (`VTOL_JSDOM`, `VTOL_PYTHON` set) | exit 0, **306/306** (the pwsh step check runs too) |
| `gen-precache.mjs --check` / `diagrams/build.js --check` / `gen-params-reference.mjs --check` | up to date (57 assets / 16 SVG / 1663 parameters) |
| `check-links` / `check-images` / `check-colours` (+ my case-exact link harness) | green (0 problems, 0 case mismatches) |
| html-validate on the 4 pages (`.htmlvalidate.cjs`) | exit 0, 0 errors; the same 169 accepted warnings as `main` and round 1 |
| `pytest gcs protocol -rfE --tb=long` (once, junit `r2\pytest.xml`) | **682 passed, 2 skipped**, 94.3 s (1 warning, see O1) |
| `test_api_status_is_cached_briefly` alone ×5 | 5/5 pass |
| Merge: clone of `S\repo\vtol-manual` `main` (`f7b5060`) + `git merge --no-ff wp/10` (`d697f8a`) | **clean**, 41 files; `gen-precache --check` green; `node --test` 297 pass / 0 fail / 9 skipped on the merged tree |

## Findings (round 2)

No BLOCKER and no MAJOR findings.

1. **MINOR (risk note, fail-safe) — `ci.yml` python-windows step "The piped test steps of this workflow fail on a failing test".**
   - The check needs `bash` (Git for Windows) and pytest-capable `python` on the runner's PATH, and fails hard (`VTOL_REQUIRE_WORKFLOW_TEST=1`) when either is missing.
   - On `windows-latest` both are normally present (Git `bin` on PATH; `setup-python` + `pip install pytest`). The libuv PATH lookup takes PATH order, not System32 first.
   - If a runner image resolved `bash` to a WSL stub, CI would go **red**, not silently green. This could not be verified without a runner; watch the first run.
2. **MINOR (optional) — the pwsh step's self-test runs it under Windows PowerShell 5.1 rather than pwsh 7.** It is acceptable as argued above. Preferring `pwsh` when present would test the exact shell.

### Observation O1 (outside WP10 scope)

During this round's full run, pytest reported a `PytestUnhandledThreadExceptionWarning` in `tests/test_control.py::test_many_stalled_handshakes_time_out_and_free_their_slots`:

```
control.py:537 _serve → conn.recv_bytes → TypeError: ReadFile() argument 1 must be int, not None
```

The `_serve` loop catches only `(EOFError, OSError)`. The connection was closed (handle `None`) by shutdown or teardown while the thread was reading.

- The test passes; it is only a warning. It did not occur in any of the 11 round-1 runs.
- The code is WP13's (`gcs/vtolgcs/control.py`), and neither the test nor the module was changed by WP10.
- It is harmless at shutdown, but it is an uncaught thread exception. Suggest the PM adds it to OPEN-ITEMS §6 "Known minor software follow-ups": catch `TypeError`/`ValueError` from a closed connection in `_serve`, or close under the work lock.

## Approval rationale

- Every round-1 finding is fixed (F1, F2, F3, F5, F6) or documented (F4 → M-15).
- F1 is proven by my own extraction of every piped test step:
  - the jsdom step fails under both `bash -e` and pipefail on a failing or skipped test, and passes on a green tree;
  - the pytest loop fails and names the test on persistent, run-3-only and collection-error failures, and passes on a green tree.
- The fix is guarded by a test that catches a removed `pipefail`, and that test is enforced on the Windows CI job.
- All MUST requirements R1–R10 now pass:
  - R1 and R10c pass now that the jsdom tests gate CI.
  - The other requirements were verified in round 1 and are unchanged or improved.
- Regression is green: node with and without jsdom, the `--check` scripts, link/image/colour checks, html-validate, pytest once.
- The merge into current `main` is clean.
- The remaining items are MINOR or out of scope.
