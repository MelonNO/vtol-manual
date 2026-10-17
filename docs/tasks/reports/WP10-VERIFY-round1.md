# WP10 verification — round 1
VERDICT: REJECTED

Branch `wp/10` at `fd450b1`, diff base `f7b5060` (= `git merge-base main HEAD` = current `main`). The work was checked in
throw-away clones under `S\verify\WP10\` (`clone`, `mut`, `build`, `mergetest`, `site`). Nothing was written to the
worktree or to the real `%APPDATA%\vtol-gcs`, which still does not exist after all runs. The pytest runs used
`APPDATA=S\verify\WP10\appdata`.

One MAJOR finding (F1) blocks approval. In CI, the jsdom test step pipes `node --test` into `tee` under GitHub's
default `bash -e` shell, which has no `pipefail`. A failing jsdom test, including every page smoke test, therefore
leaves the step green. Everything else is in good shape:

- The docs are accurate and complete.
- The Flask app is fully retired.
- R10a works with a real `sample.param` import.
- The precache list is current.
- All local test runs pass, including headless Edge offline.
- The merge into `main` is clean.

## Scope

38 files changed. All of them are in the brief's "Files you own" list or are justified in the report:

| Files | Justification |
|---|---|
| `manual.html` | R10a |
| `gcs/tests/**` | R10b |
| `test/pwa/wp14-refresh.test.js` | R10a |
| `test/tools/common.test.js`, `js/version.js` | PM decision: version 2.0.0 |
| `sw-precache.js` | Regenerated after the page change |
| `docs/tasks/00-README.md` | R8 |
| `.htmlvalidate.cjs` | The config file that R1 requires |
| `scripts/check-lib.mjs`, `test/ci/` | Helpers and tests for the check scripts |

Scope: PASS.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | **FAIL (MAJOR F1)** | `.github/workflows/ci.yml:26-131` | Every listed check is present and runs: the 3 `--check` scripts (:37-41), node without jsdom (:43-44), node with jsdom plus the skip guard (:51-59), html-validate on 4 pages with a justified config (:61-64, `.htmlvalidate.cjs`), links, images and colours (:66-73), the precache test (`test/pwa/precache.test.js` + `--check`), jsdom smoke (`test/smoke/`), protocol tests on Linux (:75-90), and the full suite ×5 on `windows-latest` (:92-131). **But a failure inside the jsdom step does not fail CI (F1).** The jsdom-only tests (the 5 page smoke tests, the WP09 style check, WP14 F8/F9 and the R10a test) are not gating. |
| R2 | PASS | `gcs-build.yml` | Runs on `windows-latest`: pip install, `pytest gcs protocol`, `build.ps1 -Python python -SkipInstall -Clean`, `Compress-Archive`, `upload-artifact` (`if-no-files-found: error`). The release job runs only on `v*` tags, with job-level `contents: write` (workflow level stays `read`), and uses `gh release create --verify-tag` if missing, then `upload --clobber`, with `GH_REPO` set (no checkout needed). I ran the build and zip steps locally exactly as in the workflow: build exit 0, `vtol-gcs.exe` + `vtol-gcs-sender.exe`, a 21.7 MB zip. |
| R3 | PASS | `.nojekyll` (0 bytes) | `gcs/` is never precached or linked. |
| R4 | PASS | `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | Details below; one wording nit (F5). |
| R5 | PASS | `docs/relay/*` | Every item the brief lists is present (cross-check below). Test criteria match the relay design (tests 1–9, lines 549-557 there). |
| R6 | PASS | `git diff -M`: the three `.txt` files are pure renames; `PROJECT_CONTEXT.txt` has 35 added header lines and its body is unchanged; `docs/history/README.md` | `ai/` is gone. |
| R7 | PASS | The 4 Flask files are deleted | `git grep` for app.py, flask, start.sh, requirements.txt, relay/templates, raspberry and pi.local finds them only in CHANGELOG (the retirement note), CLAUDE.md:38 ("retired and deleted"), `gcs/README.md:5` (history), the `gen-precache.mjs` comment, and the plan/task/history docs. Precache is regenerated and `--check` is green. |
| R8 | PASS | `docs/tasks/00-README.md` | WP12–16 rows added; WP10 row is "done / pending — PM"; final-state note. |
| R9 | PASS | `CLAUDE.md:202-258`, `docs/history/PROJECT_CONTEXT.txt:1-35`, `README.md:67-74` | The ladder equals plan §15.3 exactly. Storage note and §15.4 rationale are present. Known issues follow the owner document literally: issue 1 removed; issue 2 *rewritten* as "no geofence configured" (owner doc line 162; deviation 5 is justified); issue 3 kept; RC-loss and 8 s → QRTL added. Every value checked against `carrier-params-2026-10-17.param`. |
| R10a | PASS | `manual.html:878-891` | jsdom check with `test/fixtures/sample.param` imported through the real Tools UI and the manual opened with that store. The title reads "Battery & Power (reference param file 2026-10-17)". `BATT_LOW_VOLT` row: red (`crit-val`, `var(--red)`) "LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)". The CRT and ARM notes stay empty (22.2 V is active in the file). After clearing, all three notes are empty again. 0 script errors. |
| R10b | PASS (residual, F3/F4) | `gcs/tests/test_runtime_e2e.py`, `test_control.py`, `test_sender.py`, `test_timing_win.py` | The WP14 flake (`test_api_status_is_cached_briefly`) is correctly root-caused (the 1 Hz session-log `status()` replaces the cache). Other timing asserts now poll or have generous bounds plus diagnostics. 11/11 full runs green here (see Tests). The implementer's single unidentified failure did not recur. |
| R10c | **FAIL (MAJOR F1)** | `ci.yml:51-59` | jsdom is installed and `VTOL_JSDOM` is set, and the skip guard works (no test is skipped). A failing jsdom-gated test still passes the step. |

### R4 details

- **README:**
  - pages, emergency-only mode, GCS app, D1 diagram, repo layout
  - parameter reference, open items, development and tests, CI
  - tagging, and rollback with `git revert` or `git restore --source=<tag>` + commit, with an explicit "never force-push" (REP-07)
- **CLAUDE.md, read in full:** every module, global, function name, localStorage key, port, CSS class and file it names exists in the code. I grepped about 70 identifiers and found none missing. The `SEC_COLORS` hex values, `BATT_CHEM`, the store defaults, `sw.js` network-first 4 s plus SWR, and the "no CACHE constant" precache rule are all accurate. I found no stale statement.
- **CHANGELOG 2.0.0:**
  - It covers WP01–WP16.
  - Claims spot-checked: 18 alarm rules (counted in `alarms.py:185-208`), wind at 80/120/180 m, CSP on all 4 pages, `img/fpv_drone.jpg` gone, the `jitter_p99_max_ms → send_late_max_ms` message, `git-setup.ps1`, the measured-LQ heatmap.
  - The 2.0.0 version and "tag by the owner" match `js/version.js`.
- **CONTRIBUTING:** the Q-4 checklist is complete. Parameter claims cite the param file or the ArduPilot docs; relay claims cite the relay design; the TBD/VERIFY rules and design intent are there. Every referenced file exists.

### R5 cross-check against the brief

| Brief item | Where |
|---|---|
| 00-README "Not implementable": relay PCB, firmware, KSZ8795, measurements, Q3/Q13/Q14, photos | H-1, H-2, H-3, M-1, M-5…M-8, O-1, O-2, O-3, C-1 |
| Q2 | M-3 |
| Q3 | O-1 |
| Q13 | M-5 / O-2 |
| Q14 | O-3 |
| S-01a | M-1 |
| Own photos, linked to `img/README.md` "Photo shot list (owner)" (the heading exists) | C-1 |
| KSZ8795 register names | H-3 |
| Norwegian toggle, deferred | D-1 |
| FIRMWARE-REQUESTS | FR-1…FR-6 = camera policy, Q7a, Q7b, LEDs, protocol v1 / status packet, VRX via N6 (conditional) |
| IP plan | Matches plan §3.3; Q3 is open; `.20` / `.21` / `.100` are marked TBD |

## Contract results

- **C4:** `js/version.js` has the shape `{app:'2.0.0', content, paramFile}` and the footer shows 2.0.0 in Edge.
- **C1.6:** the store defaults match CLAUDE.md.
- **C2 and C3:** only described in the docs, and the ports, IPs and packet sizes there match `protocol/README.md` and the plan.
- **Precache rule (WP09):** `sw-precache.js` is regenerated (hash `667db43069c7f9bf`, 57 assets). The cache name `vtol-manual-2.0.0-667db43069c7f9bf` was observed in Edge.

## Tests run (commands + results)

Environment: Node 24.20.0, Python 3.12.10 (`S\venv`), jsdom 30.1.3, html-validate 11.16.2.

| Command | Result |
|---|---|
| `node --test test/` | 303 tests: 294 pass, 0 fail, 9 skipped |
| `VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/` | 303 / 303 pass |
| CI tools installed exactly as `ci.yml:46-49` (`npm install --no-save … --prefix $RUNNER_TEMP/ci-tools jsdom@30.1.3 html-validate@11.16.2`, outside the repo; repo stayed clean), then the jsdom step and the html-validate step run verbatim with those paths | 303/303 pass, guard OK; html-validate exit 0 |
| `node scripts/gen-precache.mjs --check`, `diagrams/build.js --check`, `gen-params-reference.mjs --check` | All up to date |
| `check-links.mjs` / `check-images.mjs` / `check-colours.mjs` | Green |
| `check-links` again with a case-exact `existsSync` (my harness; simulates Linux and Pages; verified to catch a `Docs.md` vs `docs.md` fixture) | 0 problems, 0 case mismatches |
| My own scan of every inline `<svg>` block in the 4 pages | No hex colour |
| html-validate, 4 pages, with `.htmlvalidate.cjs` | 0 errors, 169 warnings |
| html-validate on `main` without the config | 169 errors |
| html-validate on `main` with the config | The same 169 warnings: **no new findings from WP10**. The config's per-page counts (95 + 39 + 2 = 136 `no-inline-style`) are accurate. |
| Python Linux-job commands, run locally: `pytest test_protocol.py test_crsf.py`, `gen_test_vectors.py --check`, `-m vtolgcs.protocol --selftest` | 302 passed; up to date; SELFTEST OK. These modules import only the standard library, so they are platform-neutral. |
| **`pytest gcs protocol -rA --tb=long --durations=15 --junitxml`, 8 consecutive runs** (full logs: `S\verify\WP10\pyruns\run-1..8.txt/.xml`) | **8/8: 682 passed, 2 skipped** (both skips are `test_ui.py` UI smoke tests that need `VTOLGCS_UI_SMOKE=1`), 92.8–94.9 s |
| **3 further full runs with all 28 CPUs saturated** by busy loops (`load-1..3.txt/.xml`) | **3/3: 682 passed, 2 skipped**, 110–122 s |
| `gcs-build` steps run locally: `powershell -NoProfile -ExecutionPolicy Bypass -File gcs\packaging\build.ps1 -Python <venv> -SkipInstall -Clean`, then `Compress-Archive` | Exit 0; zip 21.7 MB |
| Merge: clone of `S\repo\vtol-manual` `main` (`f7b5060`), `git merge --no-ff wp/10` | Clean; 38 files; `gen-precache --check` and `node --test` green on the merged tree |

**The unidentified Python failure:** it was not caught. It did not recur in 11 full runs here (8 normal, 3 under full CPU load), which adds to the implementer's 6 green runs, so 17 consecutive green runs in total. It cannot be named. CI now keeps the full output of every run as an artifact, so a recurrence there will name it (F2 limits the annotations, not the log).

**Not runnable here:** there is no PowerShell 7, WSL or Docker on this machine, and no GitHub runner. So I did not run:

- the `pwsh` 5-run loop. I checked it by reading it: in pwsh ≥ 7.2, redirected native stderr does not trip `$ErrorActionPreference='stop'`, `$LASTEXITCODE` is python's exit code, and the explicit `exit 1` covers earlier runs.
- the Linux `web` job on Ubuntu. Case sensitivity and line endings are covered: `.gitattributes` uses `eol=lf`, and the precache hash is computed on LF text.
- the release job.

## Smoke tests

- **jsdom smoke of all pages:** I read `test/smoke/pages.test.js`. It loads `index.html`, `index.html#emergency-only`, `manual.html`, `relay/map.html` and `tools/latency-clock.html`, and checks:
  - every Tools tab and every manual nav item opens
  - the checklist ids equal those in `data/content.js`
  - a tick moves the progress
  - every emergency card is present
  - the parameter tab shows 1663 parameters
  - Leaflet loads offline

  All `<script src>` tags match the inlining pattern. **Mutation check:** I injected a delayed throw into `js/field.js` in a throw-away clone, and all 5 smoke tests failed with the error captured. The tests do detect script errors.
- **R10a in jsdom:** passes, as described in the requirement table.
- **Real browser:** headless Edge, the `git archive` of HEAD served by `python -m http.server` on 127.0.0.1:8731.
  - Online: the service worker became active and all 57 precache assets were cached (`vtol-manual-2.0.0-…`).
  - Then I stopped the server.
  - Offline: `index.html`, `index.html#emergency-only`, `manual.html` (Battery & Power label present), `manual.html#params` (1663), `relay/map.html` (Leaflet map created) and `tools/latency-clock.html` all loaded, with 0 exceptions, no unexpected console errors, and the self-hosted fonts loaded.
  - **17 PASS / 0 FAIL** (`S\verify\WP10\scripts\offline.mjs`).

## Findings

1. **MAJOR — `.github/workflows/ci.yml:51-59` — a failing test in the jsdom step does not fail CI.**
   - **What is wrong:**
     - The step has no `shell:`, so GitHub runs it with `bash -e {0}`. `-o pipefail` is added only when `shell: bash` is given explicitly.
     - `node --test test/ | tee "$RUNNER_TEMP/node-test.txt"` therefore returns `tee`'s exit status (0).
     - The following `if grep …skipped…` only checks for skips.
   - **Consequence:** the 9 jsdom-only tests are never gating in CI:
     - the 5 page smoke tests of R1
     - the WP09 computed-style check
     - the WP14 F8/F9 refresh tests
     - the new R10a test

     The earlier "without jsdom" step does gate the other 294 tests.
   - **Reproduced:**
     - I extracted the step verbatim and ran it with `bash -e` on a tree with a failing test: exit 0, with `ℹ fail 1` in the log.
     - With `bash --noprofile --norc -eo pipefail`: exit 1.
   - **Expected:** `shell: bash` on the step (or `set -o pipefail` as its first line), or an additional `grep -q '^ℹ fail [1-9]\|^# fail [1-9]'` → `exit 1`. Ideally prove it the way `test/ci/checks.test.js` proves the other checks.

2. **MINOR — `ci.yml:119` — the annotation pattern `'^(FAILED|ERROR) '` also matches pytest's captured-log lines.**
   - Captured-log lines look like `ERROR    vtolgcs.sender:…`, which pytest prints for a failing test under `-rfE`.
   - Reproduced: a failing test with 12 `logging.error` lines gave 13 matches, and the real `FAILED …` line came last.
   - GitHub keeps at most 10 error annotations per step, so the failing test's name can be pushed out of the annotations. It stays in the group log and in the uploaded artifact.
   - **Expected:** match `'^(FAILED|ERROR) \S+::'` (or `'^(FAILED|ERROR) gcs'`).

3. **MINOR — `gcs/tests/test_runtime_e2e.py::test_api_status_is_cached_briefly` — the docstring and report call it deterministic, but a small race remains at `c = h.rt.status(0.001)`.**
   - In `runtime.status()`, the caller reads the clock before taking the lock.
   - If the session-log thread stores a fresh cache in that gap (or within 1 ms before it), the cache is "young" (`now - t ≤ 0.001`, possibly negative), so the caller does not build, and `len(mine) == 2` fails.
   - The window is microseconds to 1 ms per second of runtime, so it is very unlikely, but not zero.
   - **Expected:** use a `max_age` that is clearly smaller than the elapsed sleep and also make the clock injectable, or pause the session-log loop for this test. Alternatively, reword "deterministic" to "practically".

4. **MINOR (open risk, as reported) — R10b: the one unidentified full-suite failure from the implementer's first batch is still unidentified.**
   - It was not reproduced in 11 runs here, including under full CPU load.
   - The CI artifact will name it if it recurs.
   - The implementer's report states this honestly (PARTIAL).

5. **MINOR (wording) — `CHANGELOG.md:16` says "16 work packages", but the board lists 17 (WP08a and WP08b are separate).** Say "WP01–WP16 (WP08 in two parts)" or "17".

6. **MINOR (acknowledged in report deviation 9) — `.gitignore:4-6` still lists `relay/__pycache__/`, `relay/*.pyc`, `relay/.env` from the Flask era.** These are harmless dead entries.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

The PM's additions are done: version 2.0.0 with no tag, and the full pytest log of every run kept as an artifact.

**Must fix:**
- **F1:** make the jsdom step of `ci.yml` fail when any test fails (`shell: bash` / `pipefail` or a fail-count guard). Until then, R1's jsdom smoke tests and R10c are not effective in CI.

**Should fix in the same round** (each takes one line):
- F2
- F3 (or reword it)
- F5

**Housekeeping note for the PM:** my aborted mutation run left two orphaned `node.exe` processes, PIDs 22264 and 7556, both started 16:00:01. Their command line is `node --test test/` in `S\verify\WP10\mut`. Stopping them was refused by the permission classifier. They belong to this verification and can be ended safely.
