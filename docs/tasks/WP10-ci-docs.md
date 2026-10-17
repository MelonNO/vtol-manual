# WP10 — CI, tests, project documentation, retirement of the Flask app

- **Worktree:** `S\wt\WP10`
- **Branch:** `wp/10`
- **Wave:** 6 (last)
- **Starts after:** all other WPs are merged

Read first: `01-COMMON-CONTEXT.md`, all reports, plan §5.6 (REP-03/05/07), §6.3, §10.6 (Q-1…Q-5), §10.1 A-5, §12, and `docs/tasks/00-README.md` ("Not implementable in software").

## Files you own

- `.github/workflows/*.yml`, `.nojekyll`
- `README.md`, `CLAUDE.md`, new `CHANGELOG.md`, new `CONTRIBUTING.md`
- `ai/` (move to `docs/history/`)
- new `docs/relay/` (`README.md`, `IP-PLAN.md`, `FIRMWARE-REQUESTS.md`, `OPEN-ITEMS.md`, `TEST-RESULTS.md`)
- delete `relay/app.py`, `relay/templates/`, `relay/start.sh`, `relay/requirements.txt`
- `test/smoke/` (CI-only smoke tests), `scripts/check-*.mjs`
- `docs/tasks/reports/WP10-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **CI workflow** on push and PR:<br>- `node --test test/`<br>- `pytest gcs` (Python 3.12)<br>- `html-validate` on all pages (npm install in CI only, with a config file that encodes accepted rules and reasons)<br>- link check of internal links/assets (script `scripts/check-links.mjs`, no deps)<br>- an image-size budget (≤ 250 KB per raster image, ≤ 60 KB per diagram)<br>- SVG/inline colour lint (no hex colours in page inline SVG; standalone diagrams exempt)<br>- precache-completeness test from WP09<br>- jsdom smoke tests in `test/smoke/` (CI installs jsdom): every page loads without script errors, the key tabs open, and the checklists render |
| R2 | MUST | **GCS build workflow** on `windows-latest`: install deps, run tests, run `gcs/packaging/build.ps1`, and upload the artifact. On tags `v*`, attach a zip to the GitHub Release. |
| R3 | MUST | **`.nojekyll`** so Pages serves everything as is. Make sure `gcs/` source and tests do not break Pages (they won't be linked). |
| R4 | MUST | **Docs:**<br>- `README.md` rewritten: what the suite is, the pages, the GCS app, architecture diagram link (D1), development (no build; tests; CI), release/rollback with `git revert` / redeploying a tag, not force-push (REP-07)<br>- `CLAUDE.md` updated to the new architecture and conventions (REP-03)<br>- `CHANGELOG.md` with a 2.0.0 entry summarising all WPs (Q-5)<br>- `CONTRIBUTING.md` with the content-review checklist (Q-4: every parameter claim cites the param file or ArduPilot docs; every relay claim cites the relay design; TBD rules) |
| R5 | MUST | **`docs/relay/`:**<br>- the IP plan (§3.3, Q3 open)<br>- **FIRMWARE-REQUESTS.md**: camera client-gated policy, Q7a CRSF passthrough, Q7b N6 decoder-lock/standard in status, bridge LED patterns, status packet v1 agreement (C3), and VRX control via N6 if chosen<br>- **OPEN-ITEMS.md**: everything in `00-README` "Not implementable", plus Q2, Q3, Q13, Q14, S-01a, measurements, own photos (link `img/README.md` shot list), KSZ8795 register names, plus the optional Norwegian language toggle (deferred)<br>- **TEST-RESULTS.md**: a template table for relay-design tests 1–9, S-01a, S-02c, HM30 capacity, failsafe times per cause, glass-to-glass |
| R6 | MUST | Move `ai/*.txt` to `docs/history/` with a README explaining that they are historical notes and partly outdated (REP-05). |
| R7 | MUST | **Retire the Flask app (A-5):** delete the files; remove every reference (README, CLAUDE.md, pages); the CHANGELOG mentions it. |
| R8 | MUST | Update `docs/tasks/00-README.md` status board to final (the PM will verify). |
| R10 | MUST | **Release carry-overs.** You may make small edits in `manual.html`, `gcs/tests/**` and `test/**` for these.<br>(a) WP14 F10/F11 (`docs/tasks/reports/WP14-VERIFY-round3.md`): label the Aircraft "Battery & Power" table "(reference param file 2026-10-17)". When an imported param file disables a battery failsafe, show the same inline red DISABLED note as the rest of the manual, through the existing WP14 mechanism.<br>(b) Flaky timing tests: find the Python test that failed once under load in the WP14 round-3 run (see that report) and any other timing-sensitive tests. Make them deterministic, or give them generous deadlines with diagnostics. Run `pytest gcs` at least 5× (also in CI).<br>(c) Make sure CI runs the jsdom-gated tests (`VTOL_JSDOM` with jsdom installed in CI). |
| R9 | MUST | **Rev C in the project docs** (plan §15; owner document `C:\Users\Simulator\Downloads\docs2\VTOL Manual Changes Needed to Match Carrier Params.md`, "Flight Tools and project docs" section):<br>- `CLAUDE.md`: the carrier voltage table is replaced by the §15.3 ladder; the storage note; the battery-recommendation rationale (§15.4); known issues — remove "BATT_LOW_VOLT=0", "no geofence configured", keep "critical lands at current position", add "RC loss triggers no action (THR_FAILSAFE=2)" and "transition timeout 8 s → QRTL home (Q_TRANS_FAIL_ACT=1, Q_OPTIONS=426016)".<br>- The historical `docs/history/PROJECT_CONTEXT.txt`: add a header note pointing to `docs/reference/carrier-params-2026-10-17.param` and plan §15 as authoritative, rather than rewriting history.<br>- README: mention the parameter reference. |
