# WP27 verification — round 2
VERDICT: APPROVED

Worktree `S/wt/WP27`, branch `wp/27`, rework commit `ec1855b` (on top of `4d56f10`, the round-1 state). Files in the
rework: `relay/map.html`, `test/map/ui.test.js`, `sw-precache.js` (regenerated), `docs/tasks/reports/WP27-IMPLEMENTATION.md`
("Rework round 1" section; §5.5 corrected). All in scope.

## Requirement results
| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 side panel (MUST) | PASS | `relay/map.html` groups unchanged; placement group reordered | One primary per group still holds (test). First load no longer saves the default-open group (`initPanels`, `let last = d.open`) |
| R2 phone layout (MUST) | PASS | shots `shots2/map-390.png`, `map-open-360.png`, `map-measure-390.png`, `map-sim-360.png` | Sheet, handle, map, zoom and cursor bar usable; no horizontal scroll (`documentElement.scrollWidth` = viewport at 1366/390/360) |
| R3 overlays (MUST) | PASS | toast `top:112px` (phone: sheet + 112 px); `.att-pnl` max-height + scrolling body | Toast no longer covers the hint (1366 and 390); attitude box clear of the zoom/measure controls at 1366 × 400 |
| R4 latency clock (MUST) | PASS | not changed in this round | Re-shot at 1366/390/360: unchanged and fine |
| R5 no logic changes (MUST) | **PASS** (was FAIL) | `relay/map.html` `#veg-draw-hint{color:…}`, `#cursor-bar .cmeasure{color:…}` | F1 fixed, see below. Script diff vs round 1: only the 3-line `initPanels` guard. Safety-token diff 0 LOST / 0 NEW for both files |
| R6 evidence (MUST) | PASS | `S/shots/WP27/r1/` + my own `S/verify/WP27/shots2/` | |
| Carried-over minors (M5 WP23, M2 WP24, clock/att notes) | PASS | as round 1 | M3 (1 px) still NOT DONE, accepted (shell frozen, WP28) |

## F1 re-check
- **jsdom with the page CSS** (`S/verify/WP27/smoke.js`): `startVegDraw()` → `#veg-draw-hint` computed `display:block`; 📏 click → `#cursor-measure` computed `display:inline`. (Round 1: both `none`.)
- **Real Firefox** (`shots2/ff-probe.png`): "measure display=block | veg display=block". Visual: `shots2/map-measure-1366.png` and `map-measure-390.png` show the amber "📏 click to add point · dbl-click to finish" in the cursor bar. `map-veg-1366.png` shows the amber "Click to add points · double-click to close" under "Draw forest zone".
- **Audit of hidden toggles** (confirmed by me): the elements the script shows by clearing `hidden` are `sp-straight/orbit/mission` (`.sim-sub`: no display rule), `off-terr-prog`/`off-map-prog` (`progress.off-prog{display:block}`, hidden by `[hidden]{display:none !important}`), `cursor-measure`, `veg-draw-hint` (no display rule left; `.info-txt:empty` does not apply because the hint has text) and `sim-chip` (its phone rule `display:flex` loses to `[hidden] !important`, and it is deliberately `display:none` at ≥ 1280 px where the header banner shows). No remaining conflict.
- **New tests fail on the old code and pass now.** I ran `test/map/ui.test.js` against a tree with the round-1 `relay/map.html` (`4d56f10`): the 3 new tests fail (static guard, jsdom visibility, first-load save) and the 8 old ones pass. With HEAD, all 11 pass. The static guard covers every `$('…').hidden =` id plus the prefix-built ones, so it is a real regression guard. No earlier test was changed (the diff only appends tests).

## Minor fixes and extra changes checked
- M2: `#map.measuring #btn-measure` gives an accent tint and a 2 px accent ring. Clearly "on" in the 1366 and 390 shots. It turns off on the second click (jsdom).
- M3: toast and hint are both readable (1366, 390).
- M4 / "Apply / Update" move and the "Client" sub-heading: the markup moved with no attribute changes. The same inputs and handlers stay (`applyManual()`, `geolocate()`, `startHomePick()`, `clearHome()`, `setVtx`, `setClientAgl` + presets). `applyManual` reads only m-lat/lon/alt/roll/pitch/hdg (`relay/map.html:1402-1418`), so placing it under those fields is correct. VTX and client AGL apply on their own, as before. jsdom placement result is identical to round 1 (boresight 0.7 km, RC/op TBD). Apply is now visible at 1366 × 800.
- Extra ✕ fix: `#sb .btn-row .btn.ico{flex:0 0 44px}` makes the ✕ / ⏹ buttons 44 × 44 again in rows.
- M5: the attitude box scrolls on a 400 px tall viewport and starts below the 📏 button.
- M6: the first load saves no `panels` (test + my smoke: after toggling Terrain only `{"terrain":true}` is saved). An old state without `.panels` still loads, with model and live intact.

## Tests run (commands + results)
```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                                   → 345 pass, 0 fail
gen-precache --check, diagrams/build.js --check, gen-params-reference --check → up to date
check-links, check-images, check-colours            → pass
html-validate (4 pages)                             → 0 errors, 117 warnings; relay/map.html + tools/latency-clock.html: 0 problems
safety-tokens relay/map.html                        → 35/35, LOST 0, NEW 0
safety-tokens tools/latency-clock.html              → 9/9, LOST 0, NEW 0
test/map/ui.test.js on round-1 map.html             → 3 new tests fail (expected), 8 pass
```

## Smoke tests
The jsdom smoke run (desktop, old state, malformed state, phone + simulation) had no errors. The simulated chip and the ⚠ show and clear as before. Screenshots in `S/verify/WP27/shots2/` were all viewed: map 1366 (open/closed/measure/forest-draw/1366×400), 390 (closed/open/measure), 360 (open/sim), sunlight 390, clock 1366/390/360. Calm and consistent, nothing overlapping. The only visual defect is minor finding 1.

## Findings
1. MINOR — `relay/map.html` `#sb .btn-row .btn{…padding-left/right:var(--sp-2)}`: at desktop width (panel 320 px) the "⊕ Use My Location" label is 10 px wider than its button (Firefox `scrollWidth 118 > clientWidth 108`). The text runs onto the button border (`shots2/crop-btnrow.png`). Nothing is hidden, and phones are fine (no overflow at 390/360). Suggest a shorter label ("⊕ My location") or a wider share for that button. Fold into WP28 or a later touch-up.
2. MINOR (carried) — the remaining round-1 minors are resolved. M3 (1 px map height) stays with WP28.

## Approval rationale
F1, the only MAJOR, is fixed and proven by new tests that fail on the old code. The behaviour has been checked in jsdom and in real Firefox. The rework adds no logic change; the only script change is the `initPanels` save guard. All MUSTs pass, all checks pass, and the safety-token diff is clean. One cosmetic MINOR remains. **APPROVED.**
