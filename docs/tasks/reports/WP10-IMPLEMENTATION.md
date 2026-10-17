# WP10 — Implementation report (CI, tests, project documentation, retirement of the Flask app)

Branch `wp/10`, worktree `S\wt\WP10`. Base `f7b5060` (main after the WP14 merge). Commits:

| Commit | Content |
|---|---|
| `32b73f5` | R10b — timing-sensitive Python tests made deterministic or generous, with diagnostics |
| `c28f498` | R10a — manual "Battery & Power" table labelled as reference values, per-row DISABLED note (WP14 F10) |
| `132eaa7` | R6/R7/R9 — Flask app deleted; `ai/` → `docs/history/` with a README and a historical header in `PROJECT_CONTEXT.txt` |
| `8aa17ab` | R1–R3 — CI and GCS build workflows, `.htmlvalidate.cjs`, `scripts/check-*.mjs`, `test/ci/`, `test/smoke/`, `.nojekyll` |
| `b61f8b5` | R4/R5/R8/R9 — README, CLAUDE.md, CHANGELOG, CONTRIBUTING, `docs/relay/`, final status board |
| (this) | report |

## 1. Summary

- **CI** (`.github/workflows/ci.yml`, every push and PR): on `ubuntu-latest` the generated-file checks, `node --test
  test/` without and **with jsdom** (a step fails if any test is skipped when jsdom is installed — R10c),
  html-validate on all four pages with `.htmlvalidate.cjs` (accepted rules downgraded to warnings, each with its
  reason), the internal link check, the image budget and the inline-SVG colour lint; the platform-neutral protocol /
  CRSF tests on Linux; and the **full GCS suite five times on `windows-latest`** (R10b).
- **GCS build** (`.github/workflows/gcs-build.yml`, `windows-latest`): install, tests, `gcs/packaging/build.ps1`,
  zip uploaded as an artifact; on `v*` tags a second job creates the release if needed and attaches the zip (`gh`
  CLI, no third-party action).
- **New checks** `scripts/check-links.mjs`, `check-images.mjs` (raster ≤ 250 KiB, diagrams ≤ 60 KiB),
  `check-colours.mjs` (no hex in inline SVG, in JS-built SVG or in inline styles), with a shared `check-lib.mjs`;
  `test/ci/checks.test.js` runs them on the repo **and** on fixture trees to prove each one detects its fault.
- **jsdom smoke tests** `test/smoke/pages.test.js`: every page loads with no script error; every Tools tab and
  every manual navigation item opens; checklists render exactly the `data/content.js` item ids; a tick moves the
  progress; the emergency modal shows every card; emergency-only mode; map with vendored Leaflet offline; latency
  clock.
- **Flask app retired** (A-5): `relay/app.py`, `relay/templates/`, `relay/start.sh`, `relay/requirements.txt` deleted;
  no reference left in README, CLAUDE.md or the pages; CHANGELOG records it.
- **Docs:** README rewritten (suite, pages, GCS app, D1, repo layout, parameter reference, development, CI, release and
  rollback with `git revert` / restoring a tag — no force-push); CLAUDE.md rewritten for the new architecture and Rev C
  (ladder, storage note, §15.4 rationale, known issues); CHANGELOG 2.0.0 covering all WPs; CONTRIBUTING with the Q-4
  content-review checklist; `docs/relay/` (README, IP-PLAN, FIRMWARE-REQUESTS, OPEN-ITEMS, TEST-RESULTS);
  `docs/history/` (moved notes + README); status board final.
- **Carry-overs:** R10a (manual table label + DISABLED note), R10b (flaky tests), R10c (jsdom in CI).
- **Tests:** Node 303 (with jsdom 303/303; without 294 pass + 9 skipped); pytest 682 passed / 2 skipped in 10 of 11
  full runs (one unidentified failure in the first batch of five, see §4.3; the next six runs were all green);
  all three `--check` scripts and the three new checks green; html-validate 0 errors.

## 2. Requirement table

| ID | Status | Evidence | Explanation |
|---|---|---|---|
| R1 | DONE | `.github/workflows/ci.yml` (job `web`: steps "Generated files…", "Unit tests without jsdom", "Install the CI-only tools…", "All unit tests with jsdom…", "html-validate…", "Internal links…", "Image-size budget…", "No hard-coded colours…"; jobs `python-portable`, `python-windows`); `.htmlvalidate.cjs`; `scripts/check-links.mjs`, `check-images.mjs`, `check-colours.mjs`, `check-lib.mjs`; `test/smoke/pages.test.js`; `test/ci/checks.test.js` | `node --test test/`, `pytest gcs` (3.12), html-validate (npm in CI only, into `$RUNNER_TEMP`, pinned 11.16.2; jsdom 30.1.3), link check (no deps), image budget, colour lint, precache completeness (`test/pwa/precache.test.js` + `gen-precache.mjs --check`), jsdom smoke tests — all in CI. |
| R2 | DONE | `.github/workflows/gcs-build.yml` | `windows-latest`: pip install (pytest, pygame-ce, pyinstaller ≥ 6), `pytest gcs protocol`, `build.ps1 -Python python -SkipInstall -Clean`, `Compress-Archive` → `vtol-gcs-<tag or build-sha>-windows-x64.zip`, `upload-artifact`. Job `release` (only `v*` tags, `contents: write`): `gh release create --verify-tag` if missing, then `gh release upload --clobber`. |
| R3 | DONE | `.nojekyll` (empty) | Pages serves every file as is (no Jekyll). `gcs/` contains only `.py`/`.md`/`.ps1`/`.toml`/`.spec` files (no `_`-prefixed paths, no symlinks, nothing large); nothing links to it; build output `gcs/build`, `gcs/dist` stays git-ignored. The precache rules (`scripts/gen-precache.mjs`) never include `gcs/`. |
| R4 | DONE | `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | README: suite, pages (+ emergency-only), GCS app, D1 image link, layout, parameter reference, open items, development, tests, CI, **release/rollback with `git revert` and `git restore --source=<tag>` + commit, never force-push** (REP-07). CLAUDE.md: new architecture, modules and globals, store events, keys, conventions, precache rule (replaces "bump CACHE"). CHANGELOG 2.0.0 summarises every WP (Q-5). CONTRIBUTING: Q-4 checklist (param claims cite the param file / ArduPilot docs; relay claims cite the relay design; TBD/VERIFY rules; design intent; presentation). |
| R5 | DONE | `docs/relay/README.md`, `IP-PLAN.md`, `FIRMWARE-REQUESTS.md`, `OPEN-ITEMS.md`, `TEST-RESULTS.md` | IP plan: §3.3 + C2/C3 + local GCS ports; Q3 open. Firmware requests FR-1 camera client-gated policy, FR-2 Q7a, FR-3 Q7b, FR-4 LED patterns, FR-5 protocol v1 / status packet agreement (the 9 items of protocol README §10), FR-6 VRX via N6 (conditional). Open items: everything in 00-README "Not implementable" (H-1…H-3, M-4…M-8, O-1/O-3, C-1), Q2 (M-3), Q3 (O-1), Q13 (M-5/O-2), Q14 (O-3), S-01a (M-1), measurements, own photos (link to `img/README.md` shot list), KSZ8795 registers (H-3), Norwegian toggle deferred (D-1), plus propeller directions (O-10), FLTMODE resolved (O-12), git-history purge (O-5), and the accepted MINOR follow-ups. Test results: template for tests 1–9, S-01a, S-02 / S-02c, HM30 capacity, failsafe times per cause, glass-to-glass, laptop timing. |
| R6 | DONE | `docs/history/{CONVERSATION_LOG,PROJECT_CONTEXT,SESSION_NOTES}.txt` (git renames), `docs/history/README.md` | README: historical, partly outdated, lists what is stale, points to current sources, privacy note on `CONVERSATION_LOG.txt` (REP-05). `ai/` no longer exists. |
| R7 | DONE | `git show --stat 132eaa7`; `git grep -i "app\.py\|flask\|start\.sh\|requirements\.txt\|relay/templates"` → only CHANGELOG (retirement note), `docs/history/*` (README + old notes), `gcs/README.md:5` ("It replaces `relay/app.py`", history), the plan/task docs, and the `gen-precache.mjs` comment | CHANGELOG "Removed / retired" explains why (S-02b sysid 255). No page referenced it. Precache unaffected (the Flask files were never precached). |
| R8 | DONE | `docs/tasks/00-README.md` (WP10 row "done / pending — PM", WP12–WP16 added to the WP table, "Final state" note) | The PM fills in the verification result and the merge. |
| R9 | DONE | `CLAUDE.md` sections "Carrier voltage ladder", "Battery-log recommendation", storage note, "Known issues / gaps", "Key failsafe and transition behaviour"; `docs/history/PROJECT_CONTEXT.txt:1-35`; README "Parameter reference" | Ladder = plan §15.3 exactly; storage 22.8 V note; §15.4 rationale (`suggestManualRtl`, avg + 0.8 V, floor 23.0 V, never recommends changing the failsafes). Known issues: BATT_LOW_VOLT=0 removed; "no geofence configured"; critical lands at current position kept; added RC loss → no action (THR_FAILSAFE=2) and transition timeout 8 s → QRTL home (Q_TRANS_FAIL_ACT=1, Q_OPTIONS=426016). PROJECT_CONTEXT: header note naming the reference param file and plan §15 as authoritative, listing the stale values; the body is unchanged. All values checked against the param file. |
| R10a | DONE | `manual.html:878` (title "Battery & Power (reference param file 2026-10-17)"), `:886`, `:888`, `:891` (`<div data-fs="…">` in the BATT_LOW_VOLT / BATT_CRT_VOLT / BATT_ARM_VOLT notes); test `test/pwa/wp14-refresh.test.js` "WP10 R10a (WP14 F10)…" | Uses the existing WP14 mechanism unchanged (`fillFailsafePhrases()`): an empty `data-fs` element shows nothing while the reference applies and the red "LOW-BATT FAILSAFE: DISABLED (<file>; reference 22.0V auto RTL)" when the imported file disables it; restored on clear. No JS change. |
| R10b | PARTIAL | `gcs/tests/test_runtime_e2e.py` (`test_api_status_is_cached_briefly`, `test_run_rtt_…` status age, `test_controller_disconnect_stops_sending`, `test_session_log_records`), `test_control.py` (`test_stalled_handshake_…`), `test_timing_win.py` (both waiter tests), `test_sender.py` (`test_thread_rate_…`); CI job `python-windows` (5 runs) | See §4.2: the WP14 round-3 flake was `test_api_status_is_cached_briefly` — root cause the runtime's own 1 Hz session-log `status()` replacing the cache between the two calls; now deterministic (counts the caller's own builds). Other timing-sensitive asserts: poll instead of one sample, or generous bounds with diagnostics, keeping the deterministic property (e.g. no packet after suspension). **PARTIAL:** one unidentified failure in 11 full runs remains (§4.3). |
| R10c | DONE | `ci.yml` step "All unit tests with jsdom…" (`VTOL_JSDOM: ${{ runner.temp }}/ci-tools/node_modules/jsdom`, skip guard) | The step fails if `node --test` reports any skipped test while jsdom is installed, so the jsdom-gated tests (WP09 style check, WP14 refresh, the new smoke tests) cannot silently skip in CI. |

## 3. Placeholders

No new TBD in pages or code. The docs collect the existing ones:

- `docs/relay/IP-PLAN.md`: laptop `.X`, N6 and bridge IPs (Q3), P3 limit (Q13), P4 use, HM30's own addresses, the
  G0 source-IP allowlist — all **TBD** as in the plan / content.
- `docs/relay/FIRMWARE-REQUESTS.md`: camera policy choice, `fw_ver` threshold for status bits 3/4, the N6 → G0 status
  path, LED patterns, VRX option — **TBD**, pending firmware.
- `docs/relay/TEST-RESULTS.md`: a template; every result cell is empty / TBD.

## 4. Tests

### 4.1 Commands and results (Windows 11, Node 24.20.0, Python 3.12.10, jsdom 30.1.3, html-validate 11.16.2)

```
node --test test/                                   → tests 303, pass 294, fail 0, skipped 9 (jsdom-only)
VTOL_JSDOM=S/jsenv/node_modules/jsdom node --test test/ → tests 303, pass 303, fail 0, skipped 0
node scripts/gen-precache.mjs --check               → sw-precache.js up to date (57 assets)
node scripts/diagrams/build.js --check              → diagrams up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-params-reference.mjs --check       → data/params-reference.js up to date (1663 parameters)
node scripts/check-links.mjs                        → every internal link and asset resolves
node scripts/check-images.mjs                       → 35 images within budget (largest img/t2_vtol.jpg 199.0 KiB)
node scripts/check-colours.mjs                      → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors, 169 warnings (accepted rules)
python -m pytest gcs protocol, 11 full runs (5 + 6)  → 10 × "682 passed, 2 skipped"; 1 × "1 failed, 681 passed"
                                                    (batch 1, run 4 — see §4.3)
python -m pytest gcs/tests/test_protocol.py gcs/tests/test_crsf.py; gen_test_vectors.py --check; --selftest
                                                    → 302 passed; up to date; SELFTEST OK   (the Linux CI job)
```

Node tests added (293 → 303): `test/ci/checks.test.js` (4: each check on the repo + on a fixture tree that it must
fail), `test/smoke/pages.test.js` (5 jsdom smoke tests), and one R10a test in `test/pwa/wp14-refresh.test.js`.
The fixture tests prove the detectors: a missing asset, a bad `#fragment`, a broken SVG `<use href>`, a broken
Markdown link (code spans and fences ignored; tab/hash routes accepted); a 250 KiB + 1 B photo and an oversize
diagram; a hex colour in an SVG tag, in a JS-built SVG string and in an inline style (standalone SVG and the archive
exempt; `href="#abc"` / `url(#grad)` not mistaken for colours). The smoke tests' error capture (VirtualConsole
`jsdomError` + window `error`) was checked to catch a thrown script error; an unhandled promise rejection in page
code reaches Node and fails the run.

### 4.2 R10b — timing-sensitive tests

| Test | Problem | Change |
|---|---|---|
| `test_runtime_e2e::test_api_status_is_cached_briefly` (failed once in WP14 round 3) | Relied on `status(0.5)` returning the identical object twice; the runtime's session-log thread calls `status()` (a fresh build that **replaces the cache**) once a second, so under load the cache could change between the two calls | Deterministic: wraps `_build_status` and counts the builds made by the test thread — a fresh `status()` builds and caches; `status(60)` does **not** build in the caller; `status(0.001)` after 20 ms builds; `status()` always builds. Mutation (ignore the cache) fails it |
| `test_run_rtt_telemetry_camera_and_failsafe` | One sample of `status_age_ms < 300` (10 Hz status) | Polled with `h.expect(…)` (8 s, diagnostics) |
| `test_controller_disconnect_stops_sending` | `< 0.5 s` and `≤ 50` packets across two test-thread statements | Deterministic core kept and strengthened: **no packet after the suspension** (0.3 s check). Detection latency `< 2 s` and `≤ 500` packets, with the runtime diagnostics in the message |
| `test_session_log_records` | Fixed `sleep(1.3)` for "at least one per-second sender record" | Waits for the `sender` record (spy on `session.write`) |
| `test_control::test_stalled_handshake_does_not_block_a_second_client` | Second client within 0.8 s with a 1 s handshake timeout | Timeout 5 s, served within 4 s (still tells "not blocked" from "served after the stalled timeout"), closure wait 12 s |
| `test_timing_win` (2 tests) | `max(late) < 50 ms`, past deadline `< 10 ms` | "Never early" stays exact; gross-failure bounds 250 ms with the per-packet lateness / waiter kind in the message |
| `test_sender::test_thread_rate_absolute_deadlines_and_stop` | 250 Hz ± 8 % over 1.2 s | ± 15 %, packet window unchanged (200–320), diagnostics (sent, skipped slots, p99, max, waiter) |

Kept as is: the WP16 R1 test (`stop` within 100 ms with a prompt open; measured ≈ 2 ms, a 50× margin, it is the
brief's requirement value) and the other timing tests, which already poll with generous deadlines and diagnostics
(WP03 F2, WP08b `test_headless_sim_streams_then_failsafe_on_exit` 15 s).

Stress run: the changed tests twice in a row while `nproc` CPU-bound Python processes ran (all CPUs busy): 22/22
passed both times. Full suite: see §4.1 and §4.3.

### 4.3 One unidentified failure in 11 full runs (open)

The first batch of five full runs (`gcs protocol`) gave 682 passed ×4 and **1 failed, 681 passed** once (run 4).
That batch only kept the summary line, so **the failing test is not known**. A second batch of six runs, with
`-rf --tb=long` logs kept for each run, was green 6/6 (93–94 s each). No test changed between the batches. Nothing
else heavy ran in parallel apart from a 0.2 s protocol test run of mine. So one test somewhere in the suite still
fails roughly 1 run in 10 on this machine. CI runs the suite 5× on `windows-latest` and prints `-q` failure
summaries, so a recurrence there names the test. **This is an open R10b risk**, not a proven fix.

No background process was hung or stopped: the PM's status check found run 6 of the second batch in progress (each
run takes ~93 s); it finished normally. No process was ended.

## 5. Deviations / contract issues

1. **Python on Linux:** the brief asks for `pytest gcs` in CI and the PM note allows running the GCS suite on
   `windows-latest`. The app is Windows-only and many tests exercise named pipes, consoles, waitable timers and
   tkinter. I could not run the suite on Linux here (no WSL/Docker on this machine), so the **full suite runs on
   `windows-latest` (×5)**, and `ubuntu-latest` runs the platform-neutral part (`test_protocol.py`, `test_crsf.py`,
   the vector check and the protocol self-test), which I verified locally. Extending the Linux job is possible once
   someone confirms the rest skips cleanly there.
2. **html-validate accepted rules are warnings, not off:** `no-inline-style`, `no-implicit-button-type`,
   `prefer-tbody`, `multiple-labeled-controls` stay visible in the CI log; any other rule fails. Fixing the 31 implicit
   button types in `index.html` would have meant editing a page outside my list for no behavioural change (none is in
   a `<form>`). The archived manual is not validated (obsolete, reason in the config).
3. **Config format:** `.htmlvalidate.cjs` (not `.json`) so each accepted rule carries its reason as a comment;
   html-validate 11 loads it automatically.
4. **`check-links.mjs` reuses `test/pwa/assets.js`** (`htmlRefsFromText`, `resolveRef`) so the link check and the
   precache-completeness test parse pages the same way; the CSS / manifest / script reference rules are repeated in
   the script with a root argument so they can run on fixture trees.
5. **Known issues wording (R9):** the brief's line reads "remove 'BATT_LOW_VOLT=0', 'no geofence configured'". I
   followed the owner's document: issue 1 (BATT_LOW_VOLT = 0) removed, issue 2 **rewritten as "no geofence
   configured"** (with the fence conflicts to document first), issue 3 kept, RC-loss and transition-timeout issues
   added. CLAUDE.md says BATT_LOW_VOLT is now set.
6. **`PROJECT_CONTEXT.txt`:** header note only (as the brief says), not the owner document's "update the KEY
   PARAMETERS block" — the header lists every stale value and points to the param file and plan §15.
7. **Release version not bumped:** `js/version.js` still says `app: '2.0.0-dev'` (not my file). The CHANGELOG entry is
   "2.0.0 — to be tagged `v2.0.0`"; README "Tagging a release" and OPEN-ITEMS O-16 give the steps (bump, regenerate,
   tag). The GCS app version (`0.1.0`) is a separate decision.
8. **Files touched outside the brief's list:** `sw-precache.js` (regenerated because `manual.html` changed — the WP09
   precache rule), `docs/tasks/00-README.md` (R8). `scripts/check-lib.mjs` is a shared helper of the `check-*`
   scripts (matches `scripts/check-*.mjs`). `test/ci/` is a new test folder for the check scripts.
9. **Left unchanged (not mine, harmless):** `.gitignore` still lists `relay/__pycache__/`, `relay/*.pyc`,
   `relay/.env` from the Flask era; `gcs/.gitignore` is not redundant after all (`test_packaging.py` reads it);
   `gcs/README.md:5` says the app "replaces `relay/app.py`" (true as history).
10. **GitHub Actions versions:** `actions/checkout@v4`, `setup-node@v4`, `setup-python@v5`, `upload-artifact@v4`,
    `download-artifact@v4` — major-version tags, not SHA pins. The release job uses the preinstalled `gh` CLI instead
    of a third-party release action.

## 6. Notes for the verifier

- **Workflows can only really run on GitHub.** Locally: the YAML parses (PyYAML), every `run:` command was executed
  by hand with the same arguments (Node checks, jsdom tests, html-validate, the Linux Python commands, pytest ×5).
  Not executed here: `npm install` on the runner, the PyInstaller build in Actions, the release job. The first push
  will show them; see "Before pushing" below.
- **R10c guard:** `node --test test/ | grep -E '^ℹ skipped [1-9]'` matches without jsdom (9 skipped) and not with it.
- **Smoke tests:** `VTOL_JSDOM=<jsdom path> node --test test/smoke/pages.test.js` → 5/5; without `VTOL_JSDOM` → 5
  skipped.
- **R10a:** in the manual with `sample.param` imported (BATT_LOW_VOLT = 0), Aircraft → Battery & Power shows the red
  "LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)" under the BATT_LOW_VOLT row; the title says
  "(reference param file 2026-10-17)"; clearing the file removes the note.
- **R10b:** `pytest gcs/tests/test_runtime_e2e.py::test_api_status_is_cached_briefly` — to see the old race, call
  `h.rt.session.write("status", status=h.rt.status())` between two `status(0.5)` calls in the old test.
- **Docs:** every Markdown link resolves (`check-links.mjs` also checks `.md` files; I also checked case-exactness
  against `git ls-files`, which matters on Linux/Pages). Values in CLAUDE.md and the history header were checked
  against `docs/reference/carrier-params-2026-10-17.param`.

### Before pushing to GitHub (for the PM)

1. Pages settings: deploy from branch `main`, folder `/` (root) — `.nojekyll` then applies.
2. The first CI run installs jsdom/html-validate from npm and pygame-ce/pyinstaller from PyPI; a red first run is
   most likely the Windows GCS suite on a shared runner (console and timing tests) — the five-run step names the
   failing run, and the timing asserts print their measurements.
3. Tag `v2.0.0` only after bumping `js/version.js` to `2.0.0` and regenerating the precache list; the GCS build
   workflow then attaches the zip to the release.
4. OPEN-ITEMS O-5 / O-6 (history purge of the GPS-tagged image and of `CONVERSATION_LOG.txt`) need a force-push and
   must be decided by the owner **before** the repository is shared more widely.

## PM decisions after the report (release)

| Decision | Done | Evidence |
|---|---|---|
| This is the release: `js/version.js` `app` → `'2.0.0'` (content and paramFile unchanged) | yes | `js/version.js:4`; `test/tools/common.test.js:57` follows it; `sw-precache.js` regenerated (new content hash, so browsers get the RELOAD prompt) |
| CHANGELOG says 2.0.0; no tag (the owner tags) | yes | `CHANGELOG.md` "## [2.0.0] — 2026-10-17" with a note that the `v2.0.0` tag is the owner's; OPEN-ITEMS O-16 updated. Deviation 7 above is resolved by this. |
| The test runs keep full output, so an unidentified failure cannot happen again | yes | `ci.yml` job `python-windows`: every run writes its **full** output (`-rfE --tb=long --durations=10`) to `pytest-logs/run-N.txt` via `Tee-Object`; all five runs always execute; each failing test is printed as a `::error::` annotation with its name; the step "Keep the full pytest logs" uploads `pytest-logs/` as an artifact with `if: always()`. The loop logic was checked in Windows PowerShell with a deliberately failing test (both failures named, exit 1). Locally the R10b runs used the same rule from the second batch on (`pyrun*.txt`, full `-rf --tb=long` output). |

Checks after these changes: `node --test test/` 303 tests (294 pass + 9 skipped without jsdom; 303/303 with jsdom);
`gen-precache.mjs --check` (57 assets), `diagrams/build.js --check`, `gen-params-reference.mjs --check`,
`check-links`, `check-images`, `check-colours` all green; `ci.yml` parses.
