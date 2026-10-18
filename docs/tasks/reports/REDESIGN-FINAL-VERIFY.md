# FINAL VERIFICATION — redesign programme WP23–WP28 (main vs v2.0.0)

**VERDICT: READY TO PUSH**

Verified `main` at `b2ae699` (clean working tree) against tag `v2.0.0` (detached worktree at `S/verify/FINAL/v200`; removed after use). Date: 2026-10-18.
Evidence: `S/verify/FINAL/` (scripts in `scripts/`, outputs `*.txt`, screenshots in `shots/`).

## 1. 04 §3 checks on main

| Check | Result |
|---|---|
| `node --test test/` (VTOL_JSDOM set) | **374 / 374 pass**, 0 fail, 0 skipped (`nodetest.log`) |
| `node scripts/gen-precache.mjs` | "already up to date"; `sw-precache.js` byte-identical before and after |
| `gen-precache --check`, `diagrams/build.js --check`, `gen-params-reference --check` | all OK (61 assets; 16 SVGs; 1663 parameters) |
| `check-links`, `check-images`, `check-colours` | all OK |
| html-validate (4 pages) | **0 errors, 0 warnings** (v2.0.0: 0 errors, 169 warnings) |
| `git diff v2.0.0..main -- gcs protocol` | **empty** (0 lines) |
| `git status` after all runs | clean |

## 2. Safety-content regression v2.0.0 → main

**data/content.js, loaded in Node from both versions** (`scripts/content-cmp.js`, `content-cmp.txt`):

| Area | Result |
|---|---|
| Top-level keys | identical (13) |
| Pre-flight: sections / items | identical ids, order, counts (5 / 36), `w` / `copy` / `auto` flags |
| Turnaround | identical (3 / 16) |
| Post-flight | identical step ids, order, counts (4/5/4); only change: `style:'accent'` dropped from `pf-immediate` (presentation, justified in WP28) |
| Emergencies | 8 scenarios, same ids and order; **IMMEDIATE steps identical (byte-for-byte) in all 8** |
| Clean-up steps | same counts; 11 strings reworded in emerg-video / camera / trans / batt ("Pre-Flight"→"Pre-flight", "Check X —"→"X:", "minimum"→"at least"). I read each one: meaning, values and order unchanged |
| emergencyNotes, failsafeTable, clientFailsafeChain, network, pipelines, sdp, failsafeParams, designIntent, version | **identical** |
| callouts | groups and abort identical; only the intro dropped the duplicated "One to five words… COPY" sentence (WP28 R1: stated on the same tab) |
| Changed strings in total | 79 (matches the WP28 verifier's deep diff) |

**Safety-token diff v2.0.0 → main** (`safety-tokens.txt`). I checked every LOST token against the WP reports:

| File | LOST | NEW | Accounted for |
|---|---|---|---|
| index.html | AUTO×2, MANUAL×3 | RTL×1 | MANUAL×1 = nav label "MANUAL ▶" (WP24); AUTO×2 / MANUAL×2 = label case "auto RTL"/"Manual RTL" (WP25 R6); RTL×1 = battery intro (WP25) ✔ |
| manual.html | TBD×1, MANUAL×3, QLOITER×1, WAIT_GCS×2, '001'×1 | '7'×3 | MANUAL×3 + '001' = header title / duplicate DOC-RC-001 (still in the footer) (WP24); TBD + WAIT_GCS×2 = duplicate D5 caption (still on Relay Electronics) and QLOITER = historical aside (WP26 R2); '7' = "7-waypoint" ledes (WP26) ✔ |
| relay/map.html | MANUAL×1 | 0 | nav label (WP24) ✔ |
| tools/latency-clock.html | 0 | 0 | ✔ |
| data/content.js | 0 (485→485) | 0 | ✔ |
| js/render-content.js | CSS values only (1px, 22, 44, 66, 25/30/35%) | 0, 3,8 | code values, not content (WP28) ✔ |

**Import of `test/fixtures/sample.param` (BATT_LOW_VOLT 0) in jsdom via the real `paramImport()` UI path** (`scripts/param.js`):

| | v2.0.0 | main |
|---|---|---|
| Import status | 25 params, 1 unreadable line | identical |
| Tools `#hdr-low` | "DISABLED in sample.param (BATT_LOW_VOLT = 0)" | identical |
| Tools warning chips | (none, the strip was always visible) | **"✖ LOW VOLT DISABLED" (crit)**, also after reload |
| Tools body "DISABLED" count | 19 | 20 (19 + chip) |
| Manual "DISABLED" count | 30 | **31** (30 + chip); 20 `data-fs` hooks on both |
| Manual warning chip | — | **"✖ LOW VOLT DISABLED" (crit)** |
| Without a param file | — | chip "⚠ PARAMS not verified" (amber) is visible while the summary is closed |

## 3. End-to-end behaviour on main

jsdom (`scripts/e2e.js`, `e2e.txt`): **all PASS**, no script errors on any page.
- **Tools nav:** 5 groups each open their tab; all 10 sub-tabs open and save `vtol_active_tab`; a group reopens its last tab.
- **Swipe:** walks all 10 tabs in nav order and stops at both ends. It is blocked while the emergency modal is open.
  - Order changed vs v2.0.0: `… flights > weather > params > profiles` (v2.0.0: `… flights > params > weather > profiles`). This is intended: WP24 R3 specifies "swipe over all ten tabs in group order, derived from the nav".
- **EMERGENCY** is available on all 10 tabs. The FAB opens the modal, which has a pill for all 8 scenarios plus the 915 note. Escape closes it.
- **Checklists:** I ticked 3 pre-flight items and 1 turnaround item, then reloaded. The ticks, progress "3 / 36", sunlight and the active tab all persist.
- **Emergency-only mode** (`#emergency-only`): `vf-eo` is set and all 8 scenario titles are present.
- **Manual:**
  - All 16 tabs open through the real nav and set the hash. Every On-this-page link points to an existing heading in its tab. A TOC click scrolls to the right anchor.
  - Search `FS_GCS_ENABL` gives 5 hits. `manGoTo(0)` opens the tab and marks the hit. A no-match search shows "No results".
  - Deep links:
    - `#fpv` opens Client Drones.
    - `#callouts/callouts-sec-6` opens Callouts and scrolls to `co-abort-calls` ("Abort Calls").
    - `#abbrev/image-credits` and `#emergency/emerg-batt` resolve.
  - The bar has the Emergency link.
- **Map:**
  - It loads with no errors. 9 control groups.
  - A panel toggle is saved in `vtol_map_state.panels` and restored on reload.
  - The Status panel opens.
- **Sunlight:** toggles and persists on Tools, manual, map and clock.

Firefox (real browser):
- **Emergency jump, every scenario, at 1366 and 390** (plus sunlight at 390). The scenario title was measured below the sticky modal header in every case, gap 33–41 px; the 915 note is at the end of the scroll. See `shots/emjump-*.png`.
- **No horizontal page scroll at 360 px.** Measured on all 16 manual tabs and all 10 Tools tabs (scrollWidth = clientWidth).
- **Deep link `#callouts/callouts-sec-6`** at 1366 and 390: the "Abort Calls" heading is in view.
- **Sunlight** screenshots of the manual, map and clock look correct.

**Precache coverage** (`scripts/precache_cov.py`, `precache.txt`):
- Every local CSS, JS, font, SVG, webp and icon that the 4 pages, `css/base.css` and the manifest reference is in `sw-precache.js`. That includes all 5 fonts, among them `ibm-plex-sans-latin.woff2` and `ibm-plex-sans-latin-ext.woff2`.
- No precache entry is missing on disk, and no page references a missing file. The 2 "missing" hits are regex false positives inside JS code.
- The only items not precached are the 6 `.jpg` fallbacks inside `<picture>` (the webp is precached). This is the same policy as v2.0.0, so it is not a regression.
- No external CDN script, stylesheet or font.

## 4. Data compatibility (v2.0.0 localStorage → main)

I generated `v200-localstorage.json` by driving the v2.0.0 Tools page and map in jsdom:
- 3 + 1 checklist ticks;
- a battery log entry (25.1 / 22.8 / 23.2 V, 18 min);
- client profile renamed "V200 Edited Client" with VTX 400 mW;
- a flight record;
- sunlight on;
- map state: altMode agl, layer sat, home, GCS.

Loaded on main (`scripts/compat.js`, `compat.txt`), **all PASS**:
- `vtol_store` is byte-identical after the main Tools load (except `updatedAt`), and `vtol_cl_*` is unchanged.
- The ticks are restored (3/36 and 1).
- The battery entry and its values are in the table.
- The edited client and 400 mW show in Profiles, the Tools header and the manual header (VTX 5806).
- The flight record shows, and sunlight is restored.
- `vtol_map_state` in v2.0.0 format: every key is preserved, the AGL button is active and the Satellite layer is selected.

My first AGL check reported FAIL. It was a selector bug in my script; the check fails on v2.0.0 too. A direct check of `#amode-agl.amode-on` passes on both versions.

## 5. Visual sanity (main vs S/baseline)

I looked at Tools pre-flight, Tools battery log, manual overview, manual emergency and the map at 1366 and 390, plus emergency-only at 390.
- All are calmer, with the slim app bar and grouped nav, and nothing is broken.
- Checklist rows are full-width with the details column, and the phone EMERGENCY bar sits above the bottom nav.
- The overview key figures are now a table with amber and red values. The battery warning callout is intact.
- The emergency cards keep IMMEDIATE first, in red.

Two screenshot-only observations:
- In the first 1366 overview shot the two figures (T2 photo, client SVG) were blank or showed alt text. This was a `loading="lazy"` timing artifact of the headless screenshot: a retake rendered them (`manual-overview-1366-retake1.png`), and the markup is identical to v2.0.0.
- The map shows partial tiles because there is no network.

## 6. Findings

| # | Severity | Finding |
|---|---|---|
| 1 | MINOR | `.htmlvalidate.cjs` comment for `no-inline-style` still says relay/map.html has 39 inline styles and the clock 2. Main has 1 and 0, and html-validate reports 0 warnings. The comment is stale; this is doc-only. |
| 2 | MINOR | Manual Emergency "Carrier failsafe — design intent" at 390 px: "low 22.0 V" breaks between "22.0" and "V". It is cosmetic only, with no lost value; a `&nbsp;` or `nowrap` value would fix it. |
| 3 | INFO | Swipe order now follows the nav groups (Weather before Params). This is intended by WP24 R3. |
| 4 | INFO | The minors carried by the PM remain: WP26 M4 diagram whitespace, the CLEAN-UP toggle text in `js/common.js`, "safely" in `pf-hm30-off`, and the `safety-lock.js` header comment. None is safety-relevant. |

No BLOCKER and no MAJOR findings.
- Safety content (checklists, IMMEDIATE steps, failsafe / network / pipelines / SDP tables) is unchanged or only reworded with its meaning reviewed.
- Every LOST token is accounted for.
- DISABLED and param warnings are now more visible, not less.
- v2.0.0 user data loads without loss.
- `gcs/` and `protocol/` are untouched.
