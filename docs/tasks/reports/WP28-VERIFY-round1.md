# WP28 verification — round 1
VERDICT: REJECTED

Worktree `S/wt/WP28`, branch `wp/28` (HEAD 538977f), base `main`. Commits: 3406aea (R2 lock + fixture), 0fe71cc (copy
pass, renderer, folds, minors), 8a45457 (post-flight card, map row, docs, report), 538977f (report line refs).
Scripts and evidence: `S/verify/WP28/` (deepdiff.js / deepdiff.txt, mutate.sh, fs.js, more.js, deeplink.js, shoot.sh,
shots/main + shots/wp28).

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| Scope | PASS | `git diff main...HEAD --stat` (22 files) | All files owned or justified (report §5.1): `index.html` More-menu listener + removed folded overrides + `.cl-section-letter` `--sec` rule; `manual.html` / `relay/map.html` style deletions + the allowed button-row rule; layout-only test edits; three phrases of `CLAUDE.md`. No `gcs/`, `protocol/`, `js/common.js`, `js/version.js` changes. |
| R1 copy pass (MUST) | PASS | `deepdiff.txt`: 79 changed strings, 1 removed key; safety-token diff `data/content.js` 485→485, LOST 0 / NEW 0 | Read every changed string (below). IMMEDIATE steps of all 8 scenarios, `emergencyNotes`, `failsafeTable`, `clientFailsafeChain`, `network`, `pipelines`, `sdp`, `failsafeParams`, all callout rows: byte-identical to main. Ids, order, `w`, `copy`, `auto`: identical. All `s` ≤ 5 words. Only removed sentence (callouts intro "One to five words…/COPY…") is stated on the same tab (`manual.html:1689,1692`) and the intro is rendered only there. New nav paths valid ("Setup → Profiles" `index.html:386,403`; "Pre-flight → C"). No warning weakened (several strengthened: "never store it discharged"). |
| R2 safety-token lock (MUST) | PASS on the letter, claims overstated → Finding 1 (MAJOR) | `test/content/safety-lock.js`, `wp28-safety-lock.test.js`, fixture | Fixture committed in 3406aea, a commit that does not touch `data/content.js` (0-line diff vs main). Regenerating with the HEAD extractor from main's `content.js` gives a file byte-identical to the 3406aea fixture. HEAD fixture differs from it in one line only (`pf-immediate style=accent` → `pf-immediate`), justified (presentation flag, orange = interaction only). Own mutations: see "Smoke tests". Value, mode, param, IP, TBD, w/copy/auto flags, item reorder, tokened IMMEDIATE swap: all caught. **Not caught: swapping two token-free IMMEDIATE steps, and deleting a token-free IMMEDIATE step** — contradicting the code comment and report claim "count and order are locked too". |
| R3 wave-3 requests (MUST) | PASS | `css/base.css` diff; `docs/design/README.md` "Wave-3 requests" table; page `<style>` deletions | Every request of WP24/WP25/WP26/WP27 reports accounted for: folded (scrollbar, alert p + details, section-title scroll margin, td chips, `.btn-icon`, `.help`, sticky sub-tabs, sunlight overlay outlines, map bar 1 px) or rejected with a sound reason (single-consumer page patterns; Tools `.kv` vs manual `.kv` are different structures). Page copies removed (static test + my diff read). WP25 `.htmlvalidate.cjs` request was already handled by WP25 rework. |
| R4 rendered components (MUST) | PASS | `js/render-content.js` diff | Class contracts unchanged (`cl-section*`, `fs-table`, `net-table`, `co-table`, `fs-primary`, `design-intent`, emergency family, `lk-*`); tables in `.tbl-wrap` + thead/tbody; the only style attribute is `--sec:#hex`, hex-validated (tested with an injection string). Escaping: `escH`/`fmt` unchanged — my probe with `<img onerror>`, `"`, `<i>` in names/ids/text is escaped. `[[TBD]]`/`[[VERIFY]]` render `.warn-val` (6 in pre-flight, 9 in emergencies; visible amber in shots). |
| R5 CHANGELOG / README (MUST) | PASS | `CHANGELOG.md` "Unreleased — redesign", `README.md` | Accurate for a field user (groups, Aircraft summary, manual menu/On this page, map Status/panels, EMERGENCY bar). `js/version.js` untouched (2.0.0). |
| R6 no regressions + evidence (MUST) | PASS | Commands below; own shots | All 04 §3 checks green; html-validate 0 findings (same as main). |
| Carried WP23 M2/M3/M4 | PASS | styleguide `rgb()` null-safe + jsdom test; tokens test over all three surfaces; print.css comment | |
| Carried WP24 M1/M4/M5/M6/M7 | PASS | `css/base.css:425` (`align-items:start;overscroll-behavior:contain`), `:490` (≤400 px nav), dead `.vf-hdr-tools`/`.vf-lbl`/`.hdr-*` removed (grep: no consumers left), sticky sub-tabs in shell | 360 px shot: full "Search the manual" placeholder visible. |
| Carried WP25 (More-menu swallow, `!important`, FAB covering rows) | PASS | `index.html:2858-2870`, `css/base.css:482` | See smoke tests. |
| Carried WP26 (requests, data-fs counts) | PASS | DISABLED count with `test/fixtures/sample.param`: main 31, WP28 31, per-element output identical | MINOR 4 (440 px diagrams) NOT DONE — acceptable: optional, needs `manual.html` markup outside WP28. |
| Carried WP27 (Use My Location, §6 requests) | PASS | `relay/map.html:109`; map 1366 shot: label inside its button | |
| CLEAN-UP button text | NOT DONE — accepted | `js/common.js:39` rewrites the label on every toggle; `js/common.js` is not WP28's file | Sound reason; follow-up candidate. |

## Contract results

- C5: all top-level keys, ids, item shapes unchanged; one optional presentation key (`postflight[0].style`) removed —
  optional per renderer (`render-content.js:127`), no consumer depends on it. `VtolRender` export list unchanged.
- 04 §2 hard constraints: element ids, function names, `data-*` hooks, localStorage keys, hash routes unchanged; the
  only logic change is the brief-allowed More-menu listener.

## Tests run (commands + results)

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                               → tests 373, pass 373, fail 0
node scripts/gen-precache.mjs --check           → up to date (61 assets)
node scripts/diagrams/build.js --check          → up to date
node scripts/gen-params-reference.mjs --check   → up to date
node scripts/check-links.mjs / check-images.mjs / check-colours.mjs → pass
html-validate index.html manual.html relay/map.html tools/latency-clock.html docs/design/styleguide.html → 0 findings (main: 0)
python3 -I S/tools/safety-tokens.py --git S/wt/WP28 main data/content.js → 485/485, LOST 0, NEW 0
  (index.html, manual.html, relay/map.html: LOST 0 NEW 0; js/render-content.js LOST only code values 1px/22/44/66/30%/25%/35%)
```
Test edits reviewed: `content.test.js` (case-insensitive name), `tokens.test.js` (extended), `shell.test.js` (FAB
position regex for the bar; fixed/red/no-pulse/markup still asserted), `wp25-tools-body.test.js` (no `!important`,
sticky rule moved to shell). All layout-only; none weakened.

## Smoke tests (what you loaded/clicked + result)

- **Content deep diff** (`deepdiff.js`, main vs WP28 `VtolContent` in Node): 79 string changes + `pf-immediate.style`
  removed; zero changes to any `immediate` array, ids, flags or order.
- **Lock mutations** (`mutate.sh`, real source edits, then `node --test test/content/wp28-safety-lock.test.js`):
  WAIT 10→20 SECONDS: caught · 5m→3m radius: caught · drop `[[TBD — measured, test 6]]`: caught · `[[QRTL]]`→`[[QLAND]]`
  (emerg-trans): caught · unbracketed RTL→QLAND in a checklist: caught · `FS_GCS_ENABL = 2`→`1`: caught · IP .144→.145:
  caught · swap tokened IMMEDIATE steps (video 4/5): caught · drop a token-free middle step: caught (only because a
  tokened step shifts) · `w` / `copy` / `auto` flag changes: caught · swap two checklist item ids: caught ·
  **swap "FPV PILOT: HANDS OFF" / "CARRIER: HOLD ORBIT" (emerg-client-rc): NOT caught** ·
  **delete "CLEAR AREA BELOW" (last emerg-batt step): NOT caught** · reword "CARRIER: HOLD ORBIT" →
  "CARRIER: LAND IMMEDIATELY": not caught (by design of a token lock).
- **data-fs** (`fs.js`, manual.html + `ToolsCore.parseParamFile(test/fixtures/sample.param)` into VtolStore): DISABLED
  count main 31 / WP28 31, per-element lines identical, no script errors.
- **More menu / EMERGENCY** (`more.js`, index.html in jsdom, phone): menu open + tap row detail zone → menu closes,
  detail not opened; menu open + tap "Link" group → swallowed, tab unchanged; menu open + click `#emerg-fab` → not
  prevented, menu closes, `emergIsOpen()` true; 9 pills, `emergJump` runs; tick with no menu works; `#emergency-only`
  sets `vf-eo`; no errors. Real event path: the listener is a document capture-phase `click`; the swipe handler uses
  passive touchstart/touchend and acts only on ≥ 60 px horizontal moves, so a tap reaches the click path; `#emerg-fab`
  (z 1050) sits above the menu (z 110) so a tap on the bar targets it and is exempt.
- **Abort id** (`deeplink.js`): `manual.html#callouts/co-abort-calls` opens the tab and scrolls to the heading; TOC
  entry `#callouts/co-abort-calls`. Old runtime id `#callouts/callouts-sec-6` now opens the tab without scrolling
  (never a static id; no reference anywhere in pages, content, tests, docs, search, diagrams).
- **Screenshots** (own, headless Firefox, main and WP28 side by side in `S/verify/WP28/shots/{main,wp28}/`): Tools
  pre-flight with one item expanded (1366/390/360), scrolled pre-flight (390/360), Link with a live status
  (1366/390), emergency modal after `emergJump('emerg-batt')` (1366/390/360; title and IMMEDIATE badge visible below
  the sticky header), emergency-only (360, no bar over it), challenge–response (390: CHECK/SKIP above the bar),
  More menu open (390), manual emergency/comms + network table/overview/callouts + abort TOC jump, map (1366/390/360),
  post-flight 1366, sunlight Tools 390 + manual emergency 1366. Viewed all. No regression found: network table at 390
  pixel-equivalent to main; Link labels sentence case; section letters keep their tint; the red bar is always visible,
  never over a row at rest end, rows scroll clear of it (`--content-pb` 140 px); sunlight renders the bar and 2 px
  lines; "⊕ Use My Location" fits its button at 1366.

## Findings

1. **MAJOR — safety lock does not lock IMMEDIATE step count/order, contrary to its own documentation and the report.**
   `test/content/safety-lock.js:6-7` ("each emergency IMMEDIATE step on its own, so their count and order are locked
   too"), `:57-60`, and report §2 R2 / §1. A token-free step yields `[]`, and `diff()` treats a missing key and an
   empty list as equal (`wp28-safety-lock.test.js:20`, `(a.tokens[k] || []).join`), so deleting the last token-free
   step ("CLEAR AREA BELOW", emerg-batt) or swapping two token-free steps ("FPV PILOT: HANDS OFF" / "CARRIER: HOLD
   ORBIT", emerg-client-rc) passes the lock. 27 of the 39 IMMEDIATE steps carry no token. The mutation test only
   swaps two tokened steps, so it does not reveal this. Future editors will rely on the stated guarantee for the most
   safety-critical text in the app.
   Expected: lock the IMMEDIATE structure for real — at minimum record each scenario's step count in `structure`
   (e.g. `emerg-batt immediate=5`) and lock order of token-free steps (simplest: lock each IMMEDIATE step's exact text,
   since any memory-item change must be justified anyway; or a normalised-text fingerprint), add a mutation case for a
   token-free swap and a dropped step; or, if not locked, correct the comment and report claims. The first is
   strongly preferred.
2. **MINOR — `carrier-camera-sortie` lost "normally"** (`data/content.js`, item `carrier-camera-sortie`.t): the Tools
   checklist now says "Carrier camera OFF before the client launches … unless relay-design test 9 has passed", while
   the manual Procedures keeps "normally **OFF**" (`test/manual/body.test.js:58` asserts it). Stricter, not weaker,
   but the two pages now differ; align the wording (keep "normally" or note it in the report).
3. **MINOR — report wording.** §1/R4 "`js/render-content.js` emits no inline styles" (and CHANGELOG "emits no inline
   styles"): it emits `style="--sec:#hex"` (intended, tested). Say "no inline styles except the `--sec` custom
   property".
4. **MINOR — old runtime anchor.** `#callouts/callouts-sec-6` bookmarks now open the tab without scrolling (graceful;
   the id was runtime-only and unreferenced). Optional: mention in CHANGELOG "for developers", or accept.
5. **MINOR (informational) — `data/content.js` is "text only"**, but `postflight[0].style` was removed. Justified in the
   report and fixture; acceptable.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

Everything else is sound: content changes preserve every value, mode, parameter, IP, marker, id, flag and order;
IMMEDIATE text is untouched; the DISABLED count equals main (31); the phone EMERGENCY bar is visible, one tap away,
exempt from the More-menu swallow and clears the rows; renderer escaping and amber markers are intact; all checks and
373 tests pass; visuals show no regression at 1366/390/360 or in sunlight.

Must fix before approval:
- **Finding 1 (MAJOR):** make the safety lock actually lock IMMEDIATE step count and order (incl. token-free steps)
  with mutation tests for a token-free swap and a dropped step — or at the very least stop claiming it. Regenerate the
  fixture from main's content (IMMEDIATE text is unchanged, so it must still pass).
