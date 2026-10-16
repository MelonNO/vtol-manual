# WP02 verification — round 2
VERDICT: APPROVED

- **Worktree:** `S\wt\WP02`, branch `wp/02`, HEAD `8deeb60`.
- **Commits under review:**
  - `e415b69` — rework
  - `8deeb60` — report typo fix
  - `6833b46` — PM merge of main (brought in `js/store.js`)
- **Current main:** `d10dca7` (WP04 + WP01 + WP03 merged).
- **Round-1 report:** `S\verify\WP02\VERIFY-round1.md`.

## Scope

The rework diff (`git diff 6833b46 HEAD`) touches:
- `.gitattributes`
- `docs/tasks/reports/WP02-IMPLEMENTATION.md`
- `relay/map.html`
- `relay/rfmodel.js`
- `relay/vendor/leaflet/{LICENSE, leaflet.css}`
- `test/map/{defaults (new), mission, rfmodel-coverage}.test.js`

Against current main, the branch only adds files from the round-1 owned list plus `.gitattributes`. `.gitattributes` is new (main has none) and justified: it is the fix suggested for F2. It holds one line, `relay/vendor/** -text`, so it affects only the vendored files.

## Round-1 findings: re-verification

| # | Round-1 severity | Result | Independent evidence |
|---|---|---|---|
| F1 | MAJOR | **FIXED** | Details below. |
| F2 | MINOR | **FIXED** | Details below. |
| F3 | MINOR | **FIXED** | Details below. |
| F4 | MINOR | **FIXED** | `live` object no longer has `status`; `grep "live\.status" relay/map.html` finds nothing. |
| F5 | MINOR | **FIXED** | Details below. |
| F6 | MINOR | **FIXED** | Details below. |
| F7 | MINOR | **FIXED (improved beyond main)** | `html-validate`: main 85 errors; wp/02 now **40** (39 `no-inline-style`, 1 pre-existing `multiple-labeled-controls`). Every rule is at or below main. The legend swatches moved to `.c-*` classes that use only CSS variables. Added lines contain no new hex/rgb outside `:root`. |

**F1 — fallback profiles now match `js/store.js`.**
- My `S\verify\WP02\profdiff.js` against the worktree's `js/store.js` (the same blob as main's) reports **0 field differences** in packs, clients and links.
- A separate script ran `assert.deepStrictEqual` on `RfModel.DEFAULT_PROFILES.{packs,clients,links}` against `VtolStore.defaults()`. It also compared `JSON.stringify` of both, which matches byte for byte, and checked that every `VtolStore.IDS` value is present. All pass.
- The ids are now `pack-client-ref-6s-1300`, `link-client-video-58`, `link-elrs-rc` and `link-siyi-hm30`; `sizeIn` is 7 and HM30 `notes` is `null`.
- The new drift guard `test/map/defaults.test.js` `require`s `js/store.js` and asserts the same. It is meaningful.
- jsdom with `store.js` not served: the fallback now uses the same ids as the store.

**F2 — vendored Leaflet is byte-exact.**
- `leaflet.css` blob SHA-256 = `p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`, the official SRI.
- `leaflet.js` = `20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`, also official.
- `git ls-files --eol` shows `i/crlf attr/-text` for the CSS and LICENSE.
- The report's §1, §5.9 and R1 wording is corrected.

**F3 — store save failures are now reported.**
- `persistLink` uses `VtolStore.load()` → edit → `VtolStore.save()` and checks the result. `saveNotice` shows the outcome.
- Own jsdom test `f3.js` on the trial-merged tree with the real `store.js`:
  - A normal GCS edit lands in place in `vtol_store` (`link-siyi-hm30`, freq 900, no duplicate).
  - With `localStorage.setItem` throwing, the toast and `pf-status` both show "⚠ Profile NOT saved — browser storage full or blocked (kept for this session only)" in red. The in-memory value is 901 while the stored value stays 900.
  - No errors.

**F5 — coarse steps no longer jump into loaded terrain.**
- Own `f5.js` runs 480 ridge-after-gap cases: gap starts at 500, 1000 and 1337 m; gap lengths 25–1000 m; offsets 0–150 m; ridge widths 10, 25, 26 and 60 m.
- Ridges wider than one sample step: rework code misses **0**; round-1 code misses **104**.
- The only misses are ridges exactly one step (25 m) wide on the sample grid. These are floating-point aliasing: the same ridge with **no gap** is missed too (1100 m → `rf`). That is not a gap effect.
- The admitted residual case (a < 8-step known strip inside a gap, i.e. a tile corner clip) still returns `nodata`. It is drawn as "no terrain data (RF only)", not as clear coverage, and is documented in the code comment. Acceptable.
- New unit test "coarse steps never jump into a loaded tile" is present and passes.

**F6 — no jump onto the loiter circle.**
- Own `f6.js` cases: VTOL_TAKEOFF, then LOITER_TO_ALT, LOITER_TURNS and LOITER_TIME (CCW) at the take-off point, then VTOL_LAND; and a loiter centre 50 m away with r = 200.
- Largest move per 0.5 s step: **8.4 m** and **6.5 m** (limit 2 steps = 13 m). Round-1 code moved 200 m and 150 m in one step.
- LOITER_TO_ALT holds altitude while flying out (unit test). Loiter timings are measured from orbit entry.
- My round-1 maths check for LOITER_TURNS expected 96.7 s, which assumed the old jump. The new value is 104.3 s = 2·2π·100/13 + 100/13 (the fly-out leg), which is correct. I updated the expectation.

## Regression

| Check | Result |
|---|---|
| `node --test test/` in the worktree (Node 24.20.0) | tests 103, pass 103, fail 0 |
| Trial merge into current main `d10dca7` (throw-away clone `S\verify\WP02\merge2`, `git merge --no-ff`) and `git merge-tree --write-tree pm/main HEAD` | **Clean**, no conflicts (20 files, all WP02's) |
| `node --test test/` on the trial-merged tree | tests 103, pass 103, fail 0 |
| `maths.js` (round-1 independent maths) on the merged tree | ALL OK after the LOITER_TURNS expectation update above. Unchanged: DCM pitch sign, Fresnel 6.82 / 17.63 m, FSPL, budget 105 dB → 731 m, Weissberger, intersection, grid, own 7-WP parse (7 items) and playback, brute-force LOS, R4. |
| `smoke.js` merged tree, real `store.js` | ALL OK, 0 uncaught errors, 0 console output. Store ids in use; RC absent with null sensitivity, drawn when filled; OPERATING AREA; own 7-WP mission; orbit sweep; GCS on demand; live layer and escaping. |
| `smoke.js --no-store` (`store.js` 404) | ALL OK. `VtolStore` absent; fallback ids identical to the store's; saves to `vtol_map_state`. |
| `smoke.js --no-gcs-client` (`gcs-client.js` 404) | ALL OK; the live layer is harmless. |
| `grep unpkg / 61.22` in `relay/map.html` | none |

Logs are in `S\verify\WP02\` as `maths-r2.log`, `smoke-r2-merged.log`, `smoke-r2-nostore.log` and `smoke-r2-nogcs.log`.

## Requirement results

The round-1 results stand: R1–R12 and R14–R19 PASS; R13 (SHOULD) partial, accepted. The rework did not change any requirement-relevant behaviour except to fix F1–F7. R6 playback is now smoother (F6) and R5 sampling is stricter (F5).

## Contract results

| Contract | Result | Note |
|---|---|---|
| C1 (incl. C1.4) | **PASS** | Fallback is equal to `VtolStore.defaults()` / `IDS`; the store is used correctly when present; `save()` result checked. |
| C2 | **PASS** | Unchanged from round 1. |

## Findings

No BLOCKER or MAJOR findings. One observation, no action required:

1. **INFO** — `relay/rfmodel.js:247-260`. A known terrain strip shorter than 8 steps inside a data gap can still be stepped over. This is a tile-corner clip; the ray is flagged `nodata` and drawn as such. It is documented in the comment.

## Approval rationale

- The round-1 MAJOR finding (F1) is fixed and checked independently. All MINOR findings (F2–F7) are fixed.
- Every MUST requirement passes and contracts C1/C2 conform.
- Tests pass (103/103) on both the branch and the trial merge with current main, and the merge is clean.
- Independent maths and jsdom smoke tests pass, with no regressions.

**APPROVED.**
