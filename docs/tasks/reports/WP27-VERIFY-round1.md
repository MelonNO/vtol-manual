# WP27 verification — round 1
VERDICT: REJECTED

Verifier: independent verification agent. Worktree `S/wt/WP27`, branch `wp/27` (commits `d556a91`, `4d56f10`), base `main`.
Changed files (`git diff main...HEAD --stat`): `CLAUDE.md` (map Architecture row, allowed by 04 §5), `docs/tasks/reports/WP27-IMPLEMENTATION.md`,
`relay/map.html`, `sw-precache.js` (generated), `test/map/ui.test.js` (new), `tools/latency-clock.html`. All in scope.

## Requirement results
| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 side panel (MUST) | PASS | `relay/map.html:38-168` (CSS), `:333-630` (9 × `<details class="pnl" data-pnl>`), `initPanels()` `:2311-2323` | One heading style; only Manual placement open; state in `vtol_map_state.panels` (no new key); ≤ 1 `.btn-primary` per group; base `.field`/`.btn`/`.disclosure`; units as suffixes; `no-inline-style` 0 in both files (main: map 39, clock 2) |
| R2 phone layout (MUST) | PASS | phone block `:280-298`; `toggleSb(open)` `:2299` | Bottom sheet closed at start, 52 px handle with grab bar, opens to ≤ 68vh; map, zoom, measure and cursor bar remain usable (own shots 390/360 open + closed). No horizontal scroll |
| R3 overlays (MUST) | PASS (with MINOR 3) | `#att` `:169`, `#cursor-bar` `:234`, `#toast`/`#maphint` `:248-258`, `#sim-chip` `:260-266` | One calm overlay style; no collisions at 1366/1024/390/360 in normal use. The *content* of the cursor bar lost its measure hint — see Finding 1 |
| R4 latency clock (MUST) | PASS | `tools/latency-clock.html` CSS/markup | Digits fit at 1366/390/360 (baseline overflowed at 1366), monospace white on black; 4-step numbered list + note; one primary (Add). jsdom: add 3 samples → 3/20, mean 210, worst 250; Clock only ↔ Show panels |
| R5 no logic changes (MUST) | **FAIL** | `relay/map.html:159`, `:242` vs script `:1597`, `:1841` | Script diff is display-only (reviewed line by line, see Smoke tests) and RF/coverage/live/mission/state are unaffected, **but** the `style.display` → `hidden` swap breaks two hints that are now never shown (Finding 1). Behaviour differs from `main`. Safety-token diff 0 LOST / 0 NEW for both files |
| R6 evidence (MUST) | PASS | `S/shots/WP27/` (open/closed, 1366/390/360/1024, sunlight) | Re-taken independently in `S/verify/WP27/shots/` |
| WP23 M5 (`--dim` as text) | PASS | no `color:var(--dim)` in page CSS (tested) | |
| WP23 note (compact sidebar) | PASS | groups closed by default, 44 px kept | |
| WP24 M2 (simulated visible < 1280) | PASS | `:1300`, observer `:2331`, base `.map-st-btn.has-warn::after` | jsdom (phone + desktop) and Firefox shots at 1024 and 360: amber ⚠ on Status and "⚠ SIMULATED" chip without opening a panel; chip hidden after stop; hidden ≥ 1280 where the banner is inline |
| WP24 M3 (1 px) | NOT DONE — accepted | report §5 | Height comes from the shell in `css/base.css` §8, frozen in wave 3; correctly handed to WP28 |
| WP24 notes (clock overflow, att box over sidebar on phone) | PASS | shots | Both fixed |

## Contract results
- All element ids used by `$('…')` exist (tested and re-checked); function names kept (`toggleSb` gains an optional arg; `toggleAtt`, `initPanels` new).
- `vtol_map_state` compatibility: an old state without `.panels` (main format: active/model/live) loads with no errors, model and live values restored (md-k 0.8, margin 5, lv-on false, follow true), groups at their defaults; toggling a group then saves `panels` while keeping `model`/`live` intact. A malformed `panels: "x"` loads without error.
- Hash routes / shell untouched; version line `data-vf-version` kept (moved to panel foot).

## Tests run (commands + results)
```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                                   → 342 pass, 0 fail (main 334; +8 in test/map/ui.test.js)
node scripts/gen-precache.mjs --check && node scripts/diagrams/build.js --check && node scripts/gen-params-reference.mjs --check → all up to date
node scripts/check-links.mjs && check-images.mjs && check-colours.mjs → pass
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors, 117 warnings; map + clock alone: 0 problems (main: 42 warning lines incl. no-inline-style)
python3 -I S/tools/safety-tokens.py --git S/wt/WP27 main relay/map.html          → 35/35, LOST 0, NEW 0
python3 -I S/tools/safety-tokens.py --git S/wt/WP27 main tools/latency-clock.html → 9/9, LOST 0, NEW 0
```
No existing test was changed (`git diff main...HEAD --stat -- test/` shows only the new file).
`test/map/ui.test.js` review: meaningful — static checks (inline styles, group structure, one primary, id coverage, phone CSS pins, ≥12 px, no `infinite`, no `--dim` text, clock formula/steps) and three real jsdom behaviour tests (panels persisted and restored, phone start state + handle `aria-expanded`, simulated ⚠/chip and sub-panel `hidden`). Weakness: several CSS-regex pins are layout-brittle, and no test checks that an element whose `hidden` is cleared actually becomes visible — which is how Finding 1 slipped through.

## Smoke tests (what you loaded/clicked + result)
- Script diff (`S/verify/WP27/script.diff`, main 539–2231 vs WP 661–2372): only `$('sim-chip').hidden`, `selectSimMode`/measure/veg/offline `hidden` swaps, measure `<a>` inline style removed, `toggleSb(open)`, `toggleAtt`, `initPanels`, observer selector `b.warn, #sim-banner.sim`, `initPanels()` call. Matches report §5. No RF/coverage/live/mission code touched.
- jsdom (`S/verify/WP27/smoke.js`): load desktop (no errors) → place 59.91/10.75 + Apply → hint hidden, banner MANUAL POSITION, boresight 0.7 km, RC/op TBD (as main) → toggle Terrain group → `panels` saved; reload with old state (above); phone: sheet closed + att minimised; straight sim → chip shown, ⚠ set, banner "SIMULATED — STRAIGHT"; stop → chip hidden. **`startVegDraw()` → `#veg-draw-hint` hidden=false but computed display none; measure button click → `#cursor-measure` hidden=false, computed display none.** Confirmed in real Firefox (`shots/ff-computed.png`: "measure hidden=false display=none / veg hidden=false display=none").
- Clock jsdom (`clock.js`) WP27 vs main: identical behaviour; no errors.
- Screenshots (`S/verify/WP27/shots/`): map 1366 open/closed/placed+measure, 1024 sim, 390 closed/open, 360 closed/open/sim, sunlight 1366 + 390; clock 1366/390/360 + sunlight 390. Compared with `S/baseline/map-*`, `latency-*`: a large, clear improvement — calm single Controls card, sentence-case labels, unit suffixes, one orange primary, overlays consistent; phone map now usable (baseline: sidebar covered the whole map and the attitude panel overlapped it); clock digits fit (baseline overflowed). Sunlight readable, 2 px control borders, nothing clipped. No horizontal scroll at 360.

## Findings
1. **MAJOR** — `relay/map.html:159` and `:242` (with script `:1597`, `:1841`). The two mode hints are now never displayed. `#veg-draw-hint{display:none;…}` and `#cursor-bar .cmeasure{display:none;…}` are page rules with higher specificity than the `[hidden]` reset, so clearing `hidden` leaves them `display:none`. On `main` the inline `style.display=''` showed them (amber, blinking). Effect: the amber "📏 click to add point · dbl-click to finish" in the cursor bar (measure mode) and "Click to add points · double-click to close" (forest-zone drawing) never appear; after the 5 s toast fades the only cue is a crosshair cursor and a barely different `--surface2` button. This is a behaviour regression against R5 and exactly the case the brief warned about ("removal of the two endless blinks must not hide any warning state"). The report's claim (§5.5) that the measure hint "is amber instead" is untrue. Expected: drop `display:none` from both rules (the `hidden` attribute already hides them) and add a jsdom/visibility test that the hints become visible (e.g. assert no page rule sets `display:none` on an element toggled via `hidden`, or check computed style after `startMeasure()` / `startVegDraw()`).
2. MINOR — `relay/map.html:1619` the active measure button uses `var(--surface2)` as its "on" background, nearly indistinguishable from hover/normal. With Finding 1 fixed it is acceptable; a clearer active state (accent border, as `#sb .btn.active`) would help.
3. MINOR — desktop: `#toast` and `#maphint` both sit at `top:60px`; at start the measure toast is drawn over the placement hint (see `shots/ff-computed.png`). Transient; consider offsetting the toast when the hint is visible.
4. MINOR — at 1366 × 800 the primary "▶ Apply / Update" of the open Manual placement group is below the fold of the panel (scroll needed). Not a regression of substance (the panel scrolls), but the group's primary action could sit higher (e.g. right after lat/lon/alt).
5. MINOR — on a very short desktop viewport (~400 px high) the attitude box overlaps the zoom/measure controls. Edge case.
6. MINOR — `initPanels()`: the default-open `place` group fires a `toggle` event on load, so `panels.place=true` is saved on first load. Harmless.

Deviations judged: version line moved to the panel foot — acceptable (same markup, shell test passes; hidden in a closed phone sheet, which is fine). Profile values behind "Edit profile values" — acceptable: client, kind, active profile and the completeness/TBD status `#pf-status` stay visible. `CLAUDE.md` phrase — allowed (own Architecture row, accurate). M3 NOT DONE — accepted, shell frozen in wave 3, assigned to WP28. Order change (placement first) — sensible.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed
REJECTED because of one MAJOR finding (R5 MUST fails):
- **F1**: measure-mode hint (`#cursor-measure`) and forest-draw hint (`#veg-draw-hint`) are never shown because page CSS `display:none` overrides the cleared `hidden` attribute (`relay/map.html:159`, `:242`). Fix the CSS, correct report §5.5, and add a test that would catch this.

Everything else (scope, tests, validation, safety tokens, state compatibility, simulated-state visibility, phone sheet, clock, visual quality) passes; the visual result is a clear improvement over the baseline. A small round-2 fix should suffice.
