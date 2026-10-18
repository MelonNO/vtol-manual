# WP26 verification — round 1
VERDICT: APPROVED

Worktree `S/wt/WP26`, branch `wp/26`, HEAD `3af653e`; base = merge-base with `main` `3247bf0` (the merged WP27 on `main` is
not part of this diff). Verifier did not modify the worktree; all scripts and shots are under `S/verify/WP26/`.

## Scope (check 1)

Changed files (29): `manual.html`, `scripts/diagrams/{lib,slots,d1-3,d4-8,d9-15}.js`, 16 × `img/diagrams/*.svg`,
`test/manual/body.test.js` (new), `test/diagrams/files.test.js`, `sw-precache.js` — all owned.
Outside the list, justified in the report §5: `CLAUDE.md` (its own "manual.html tab structure" section, 5 lines, accurate),
`img/README.md` (palette table + desktop size, now matches the SVGs, see R8), `test/pwa/r12-carryover.test.js` (one
number follows the slot count 17→16; the test's intent — clean ERROR line, exit 1 — unchanged),
`docs/tasks/reports/WP26-IMPLEMENTATION.md`. No header/nav/footer markup (WP24) and no `css/base.css` touched. OK.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 Readable prose (MUST) | PASS | `manual.html` `.man-head/.man-title/.man-lede` (style block ~l.56-63), `.man-main p{max-width:70ch}`; every panel starts with `h2.man-title` (test R1); sections `h3.section-title` with ids | Screenshots: 16 px sans prose, clear h2→h3→h4 hierarchy, token spacing |
| R2 Overview (MUST) | PASS | `manual.html:281-353` | Two `<dl class="kv">` (10 figures, mono values; amber/red chips only on stall speed and battery failsafes), photos side by side at 200 px, "How to use this manual" line → `#emergency` and `index.html` |
| R3 Calmer callouts (MUST) | PASS | base `.alert` only; `details.man-more` (3+); no stacked callouts (static check); `.safety-box` gone | See Finding 1 (Overview warning shortened) |
| R4 Step rendering (MUST) | PASS | `css/base.css` `.step-body>strong{display:block}`; no page step rules | Procedures steps 2 and 7 flow inline at 1366/390/360 (own shots) |
| R5 On this page (MUST) | PASS | `renderToc/tocGo/tocSpy` (`manual.html` ~2235-2280), called from `showTab` and `renderManual` | jsdom: every tab, toc entries = section headings, 0 dangling anchors, hidden on Emergency; wide → `#man-aside` open; narrow → closed `<details>` under title; screenshots show sticky side list at 1366 and disclosure at 390 |
| R6 Copy pass (MUST) | PASS | full visible-text word diff of all 16 tabs (`S/verify/WP26/{before,after}/`) | Meaning unchanged everywhere; LOST tokens all accounted for (see Safety); MINOR Finding 1 |
| R7 Tables / inline styles (MUST) | PASS | 0 `style="` in `manual.html`; html-validate `manual.html`: 0 findings; every static table in `.tbl-wrap` (test) | Params tab: 116 lazy groups, same search; MINOR Findings 2–3 on phone column widths |
| R8 Diagrams (SHOULD) | PASS | `build.js --check` OK; `lib.js` palette = base tokens; headings in text colour; `.dg{max-width:440px}` | Own render of all 16 at 440 px: legible, ~15 px text next to 14 px tables; the six collisions (D2 LEDs/CRSF, D5 "immediately", D8 notes/bar, D11 POWER/bus, D13 video/orbit/best-case labels, D14 legend/frame) are fixed vs the merge-base render; SVG hex set = exactly the 12 documented palette values, consistent with `img/README.md` |
| R9 No regressions (MUST) | PASS | jsdom smoke before/after (below) | renderManual, showTab, manGoTo search, `#fpv`, `#relay/relay-ports`, ManualCore, Emergency (8 cards, 9 pills), credits (5 rows), design-intent cards, data-fs DISABLED all work; no script errors |
| R10 Evidence (MUST) | PASS | `S/shots/WP26/`: 32 tab shots, 2 sunlight, toc, 360 check, diagram sheets | Plus verifier's own shots |

## Contract results

No contract IDs/routes/keys changed: all element ids kept (diff only adds ids to headings), `showTab/manGoTo/renderManual/
fillFailsafePhrases/fillTokens` signatures unchanged, `data-fs`/`data-tok` markup contract unchanged (phrases still wrap the
token span), hash routes and `#fpv` alias unchanged, `localStorage` keys unchanged. Script changes are layout only:
`renderToc` family, `scrollToEl` block:'start' for headings, search skips `.man-toc`, sentence-case search header and notice
button label/class.

## Tests run (commands + results)

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                                  → tests 343, pass 343, fail 0, skipped 0
node scripts/gen-precache.mjs --check              → up to date (61 assets)
node scripts/diagrams/build.js --check             → up to date (16 SVG files, slots, inline SVGs)
node scripts/gen-params-reference.mjs --check      → up to date (1663)
node scripts/check-links.mjs / check-images.mjs / check-colours.mjs → all pass
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors, 159 warnings (none in manual.html)
html-validate manual.html                          → 0 findings
python3 -I S/tools/safety-tokens.py manual-before.html manual.html → LOST 7 (TBD, QLOITER, RTL, BATT_CRT_VOLT,
  BATT_LOW_VOLT, WAIT_GCS×2, 22.0 V), NEW '7'×3 — identical to the report
```
`test/manual/body.test.js` is meaningful: static structure checks (heading per tab, 10 key figures with exact data-fs markup,
no stacked callouts, no inline style, wrapped tables) plus three jsdom tests that exercise renderToc/tocGo through
`showTab`, deep links, wide layout, search exclusion and the Overview DISABLED chip. Changed existing tests: only the
palette list and slot count (layout facts), no safety/behaviour assertion weakened.

## Smoke tests (what you loaded/clicked + result)

- `S/verify/WP26/smoke.js` (jsdom, before and after, both with the worktree's js): `#fpv` → clients tab; showTab over all 16
  tabs (toc entries = headings, none dangling, hidden on Emergency); search "Fresnel/Heartbeat/WAIT_GCS/RESUME/sysid" →
  same hit counts before and after (8/19/8/21/5), manGoTo opens the tab and marks the hit; `#relay/relay-ports` deep link
  scrolls to the anchor; Emergency 8 cards/9 pills; credits 5 rows; diagram slots 17→16 (intended), 5 inline SVGs, gauge
  rendered; params 116 groups; errors [] (wide and narrow).
- `S/verify/WP26/fs.js`: imported `test/fixtures/sample.param` via `ToolsCore.parseParamFile` + `paramFileRecord` into
  `VtolStore`: BATT_LOW_VOLT 0 → "LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)" in the header strip,
  Overview key figures (red over amber chip; `.crit-val` declared after `.warn-val` in base.css), Flight Modes, Aircraft,
  Procedures ×2, Abbrev, Crew; BATT_CRT_VOLT 22.2 substituted everywhere. Before 31 / after 30 DISABLED mentions — the one
  missing is the Overview battery warning (Finding 1). Clearing the file restores every phrase.
- Rendered design-intent cards still present on Flight Modes and Emergency.

## Visual review (own shots, `S/verify/WP26/shots/`)

overview, aircraft, relay, procedures, emergency, comms, params, prearm at 1366 (3200 px tall, cropped) and 390 (5000 px
tall, sheets); `ac-battery-1366/390`; `sun-overview-1366.png`; `w360-procedures.png` with a measured overflow of 0 px on all
16 tabs at 360; diagram sheets `sheet-d01/d05/d08b/d12.png` vs `old6a/b.png`. Compared with `S/baseline/manual-*`:
much calmer and more readable — sans prose, plain headings, compact key figures, role cards, neutral signal chains,
diagrams at table text size, sticky "On this page". Nothing overlaps or is clipped; no page-level horizontal scroll.
Sunlight mode: black/white tokens, chips and toc legible.

## Safety review

Full word diff of the visible text of all 16 tabs read. Every rewritten sentence about failsafes, battery thresholds,
transitions, RTL/QRTL, the 915 MHz backup role, camera gating, RESUME, sysid keeps its meaning; no number, mode, parameter or
TBD/VERIFY marker changed. Specifics:
- Flight Modes battery callout (`#battery-failsafe`, alert-danger) keeps all thresholds and both data-fs phrases visible;
  only the sag-compensation explanation moved into "Why the pilot's call comes first".
- QLOITER aside removed from the FLTMODE2 sentence; the fact (FLTMODE2 = 11 RTL, not on the 3-position switch) unchanged;
  the aside remains in the Parameters tab row.
- D5 duplicate on Pre-Arm Ref → link "State machine diagram: Relay Electronics → RC Bridge"; the identical D5 caption
  (WAIT_GCS ×2, LED patterns TBD) is on Relay Electronics; the Pre-Arm bridge-state table still lists WAIT_GCS.
- Procedures "Carrier-only flights" NOTE → WARNING: content is a genuine hazard (DISARM sent to whatever receiver is bound,
  would disarm a flying client) — the raise is appropriate; the camera fact follows as a second paragraph.
- Nkom callout: lead now says "has not been assessed"; all four points kept in the disclosure.
- "Co-pilot" → "FPV Pilot": consistent with the crew table ("FPV Pilot / Co-Pilot") and the WP1→WP2 duty.
- Relay statements spot-checked against the relay design (5 consecutive valid packets, T_hold 250 ms, UDP 5770, ModelID ×3,
  RTP 5600, CAM_ENABLE bit 0): consistent. No owner decision contradicted.
- New `7` ×3 = the existing 7-waypoint mission in new ledes/links; not a new value.

## Findings

1. **MINOR** — `manual.html:329` (Overview battery WARNING). The shortened warning no longer states the 22.0 V automatic
   RTL (`BATT_LOW_VOLT`) and lost its `data-fs="battLowVolt"` phrase, so with a param file that disables it the DISABLED
   statement no longer appears inside this warning (31 → 30 renderings); "the pilot calls RTL earlier" now relies on the
   key-figures row above. The fact and its live DISABLED rendering remain on the same tab, three rows above, in an amber
   chip that turns red, and the warning makes no false auto-RTL promise, so this satisfies 04 §4 and the R3 instruction to
   shorten callouts repeating a fact stated on the tab. Recommended (cheap): keep the low-battery phrase in the warning,
   e.g. "`<span data-fs="battLowVolt">At 22.0V (BATT_LOW_VOLT) the carrier starts an automatic RTL</span>`; the pilot calls
   RTL earlier, at 23.0V …", so the warning is self-contained again.
2. **MINOR** — `manual.html` style `.man-main td code{white-space:nowrap}`: on phones the first column of message tables
   grows to the longest code (Pre-Arm Ref at 390: table 592 px in a 354 px wrapper, the Fix column fully off-screen until
   the row is scrolled; baseline showed it partially). No page scroll, but lookup on the phone needs sideways scrolling.
   Consider allowing wrap inside long `code` in the first column, or a stacked layout for these tables on phones.
3. **MINOR** — value chips now inside cells wrap mid-value in narrow value columns (Transition Parameters `9 m/ s` at 1366;
   `10 / m/s`, `45 deg/ s` at 390). Suggest `white-space:nowrap` for chips/values in table cells (could go to WP28 with
   request §10.3).
4. **MINOR** — at 1366 the single 440 px diagrams (D1, D10, D2, D9) leave a ~550 px empty column beside them; calm, but the
   pairing used for D8b/D8 and D5/D4 could be extended later. Not a regression.

No BLOCKER, no MAJOR.

## Approval rationale

All MUST requirements (R1–R7, R9, R10) pass on independent evidence and R8 (SHOULD) passes; all mandated checks are green;
scope is justified; the safety-token diff matches the report and every LOST token is a duplicate or an aside whose fact
remains on the same page; failsafe DISABLED rendering works everywhere except the one shortened Overview warning, which
no longer carries an auto-RTL claim (Finding 1, MINOR). Visual quality is a clear improvement over the baseline with no
overlap, clipping or page-level horizontal scroll at 360/390/1366 or in sunlight mode. MINOR findings 1–4 should be
addressed in a follow-up (Finding 1 ideally before release).
