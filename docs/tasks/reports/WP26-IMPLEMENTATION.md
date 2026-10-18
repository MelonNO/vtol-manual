# WP26 — Manual body and diagrams: implementation report

Branch `wp/26` (worktree `S/wt/WP26`), based on `main` with WP23 and WP24 merged. Commits: `1e3034c` (body, layout,
"On this page", callouts, diagram scale), `63171f2` (diagram label collisions, chain wrapping, links), `6396666` (tests),
`d8fcb78` (scrollbars, CLAUDE.md / img/README.md), plus this report.

## 1. Summary

- **Every tab has one heading.** Each panel opens with `.man-head`: an `h2.man-title` and a one-line lede. Section
  titles are `h3.section-title`, all with a stable `id`; sub-headings are `h4.man-sub`. Prose is IBM Plex 16 px with a
  70ch measure; tables and diagrams use the full column.
- **"On this page"** is built at render time from the open tab's section headings, static and rendered. From 1200 px it
  is a sticky side list that marks the section being read. Narrower, it is a closed disclosure under the tab title.
  Entries open their anchor through `showTab(tab, anchor)`.
- **Overview:**
  - The ten orange stat cards are now two compact definition lists. Values are monospace; the battery failsafes show in
    their amber / red chips and keep their `data-fs` / `data-tok` hooks.
  - The photos sit side by side at 200 px with short captions.
  - A "How to use this manual" line points to ⚠ Emergency and Tools.
  - Three stacked callouts became one callout, a footnote and a paragraph.
- **Calmer callouts and cards:**
  - 32 callouts → 26; none are stacked any more.
  - Long callouts have a visible lead and a "More" disclosure.
  - `.safety-box` is replaced by the base `card danger`.
  - Decorative orange-edged cards are plain cards, and amber is kept only for warnings / not-implemented items.
  - 17 cards that only wrapped a table were unwrapped (a box around a box); six of them keep their title as a
    sub-heading.
- **Diagrams (R8):**
  - The 400-unit diagrams are capped at 440 px (1.1 px per unit). Their text is now about 15 px, next to 14 px tables
    (it was about 20 px). The inline SVGs and the JS gauge / GPS Rescue drawing have matching max-widths.
  - Diagram headings are in the text colour, not orange.
  - The standalone palette follows the WP23 neutrals. `--muted` changed from `#777` (4.0:1) to `#a0a0a0`, and `--dim` is
    now `#6e6e6e`.
  - Six pre-existing label collisions are fixed (D2, D5, D8, D11, D13, D14).
  - D8b/D8 and D5/D4 sit side by side on wide screens.
- **Copy pass:**
  - Tightened prose, and split two walls of text.
  - Cross-references written in italics are now real links.
  - Terminology is consistent: "Co-pilot" → "FPV Pilot".
  - The duplicate D5 diagram on Pre-Arm Ref is replaced by a link.
  - No safety value changed (§8).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 Readable prose | DONE | `manual.html:56-62` (`.man-head`, `.man-title`, `.man-lede`, `.man-main p{max-width:70ch}`), `:63` `.man-sub`; every panel starts with `.man-head` | Body 16 px sans from base. Hierarchy: h2 tab title → h3 sections → h4 sub-headings / card titles. Spacing from the token scale only. Test `test/manual/body.test.js` R1 |
| R2 Overview | DONE | `manual.html:281-353` (tab), `:92-99` (`.kv*`), `:86-88` (photo row 200 px), `:292` how-to line | Two `<dl class="kv">` (Speed and altitude / Battery and power), 10 figures, the safety values in `.warn-val` / `.crit-val` chips with `data-fs` intact (DISABLED still works: jsdom test R9). How-to line links `#emergency` and `index.html` |
| R3 Calmer callouts | DONE | base `.alert` everywhere; `.man-more` disclosure `:74-80`; list in §7 | No stacked callouts (test R3 checks the static markup, and fails on `main`). `.safety-box` removed; `card accent` removed from the static markup |
| R4 Step rendering | DONE (already fixed by WP23, verified) | `css/base.css` `.step-body>strong{display:block}` (child combinator); the page has no step rules | The baseline bug was `.step-body strong{display:block}` in the old page CSS. All `.step` / `.proc-step` instances were checked in screenshots (Procedures steps 2 and 7 flow inline: `manual-procedures-*.png`). Regression test R4 |
| R5 On this page | DONE | markup `:285` (`#man-toc`, empty list), `:1813` (`#man-aside`); CSS `:31-53`; script `renderToc` `:2235`, `tocGo` `:2254`, `tocSpy` `:2262`; called from `showTab` `:2293` and after `renderManual` | Desktop ≥ 1200 px: sticky side column, open, scroll-spy. Narrower: closed `<details>` under the tab title, closes after a choice. Built from `.section-title` at render time; no hard-coded list (test). Rendered headings without an id get `tab-sec-N`. Search ignores the list (`:2347`). Headings scroll to the top (`scrollToEl`, `:2228`); search hits still centre |
| R6 Copy pass | DONE | §7, §8 | Prose tightened, repetitions across tabs linked (D5, client-config pointer, cross-references). Terminology: carrier, client, relay, GCS app, Mission Planner; "Co-pilot" → "FPV Pilot" (the crew table names the role "FPV Pilot / Co-Pilot"). Relay statements are unchanged in substance (only split or reworded sentences, no new relay fact). `data-fs` markup contract unchanged |
| R7 Tables and inline styles | DONE | every static `<table>` is in `.tbl-wrap` (test R7); html-validate on `manual.html`: 0 findings | No static `style=""`. Value chips moved from `<td class="warn-val">` into a span, so the cells keep their padding. Parameters tab: same lazy groups and search, restyled as one bordered list (`:162-174`) |
| R8 Diagrams | DONE | `scripts/diagrams/lib.js:4` (palette), `:90` (heading colour); `slots.js:59`; `d1-3.js`, `d4-8.js`, `d9-15.js` (collisions); page CSS `:121-142` | `node scripts/diagrams/build.js --check` passes, no layout warnings. Contact sheet of all 16: `S/shots/WP26/sheet/` |
| R9 No regressions | DONE | 343/343 tests (§4) | `renderManual`, `showTab`, `manGoTo`, hash routes, `ManualCore` (unchanged), the Emergency tab from `VtolContent`, `data-fs` DISABLED statements and the image credits all work. Covered by the existing smoke and refresh tests and the new jsdom tests |
| R10 Evidence | DONE | `S/shots/WP26/` (§9) | All 16 tabs at 1366 and 390 (full length), two sunlight views, "On this page" views, a 360 px overflow check, before-shots of the post-WP24 state |

## 3. Placeholders

None added. Every TBD / VERIFY marker of `main` is still there. The one LOST `TBD` is a duplicate caption (§8).

## 4. Tests

New file `test/manual/body.test.js`: 9 tests, 3 of them in jsdom.
- R1: headings.
- R2: Overview lists and chips.
- R3: no stacked callouts, base classes only.
- R4: step CSS.
- R7: no inline style, wrapped tables, chips not on cells.
- R5: no hard-coded list; built from the headings; anchor via `showTab`; follows the tab; rendered heading ids; hidden
  on Emergency; deep link; wide-screen side column.
- R9: search ignores the list; `manGoTo` marks the hit; the Overview `data-fs` chip turns red DISABLED and back.

Mutation check: the R3 "stacked" and R7 "chip on cell" assertions fail on `main`'s manual.

Changed tests, each because of a layout change:
- `test/diagrams/files.test.js:21`: `PALETTE` now lists the WP23 neutrals (the same check, new values).
- `test/diagrams/files.test.js` R2: 16 slots instead of 17. D5 was shown twice and is now once; the same per-slot
  assertions apply.
- `test/pwa/r12-carryover.test.js:70`: the expected error text is now "expected 16 diagram slots, found 15". This file is
  outside my list. It is a one-number change that follows the slot count, and the test's intent (a clean ERROR line,
  exit 1) is unchanged.

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                                   → tests 343, pass 343, fail 0
node scripts/gen-precache.mjs --check               → sw-precache.js up to date (61 assets)
node scripts/diagrams/build.js --check              → diagrams up to date (16 SVG files, manual slots and inline SVGs)
node scripts/gen-params-reference.mjs --check       → up to date (1663 parameters)
node scripts/check-links.mjs                        → every internal link and asset resolves
node scripts/check-images.mjs                       → 39 images within budget
node scripts/check-colours.mjs                      → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html → 0 errors, 159 warnings (all in index / map / clock, unchanged); manual.html alone: 0 findings
```

## 5. Deviations / contract issues

1. **R4 was already fixed** by WP23's step CSS (`.step-body>strong`). I verified it, added a regression test and changed
   no step CSS.
2. **The D5 duplicate is removed** from Pre-Arm Ref. It is replaced by a link to Relay Electronics → RC Bridge (R6:
   link instead of repeating). Because of this, `slots.js` expects 16 slots, and two tests changed (§4).
3. **The diagram palette** was retuned to the WP23 neutral tokens. The old `#777` muted text was 4.0:1, under the
   contrast rule. The four semantic colours are unchanged. `img/README.md` (palette table, desktop size) is outside my
   list and was updated so it stays true.
4. **Standalone diagrams stay monospace.** The generator lays text out with a fixed 0.6 em advance, so monospace is what
   keeps the width checks exact on Windows (Consolas) and Linux (DejaVu Sans Mono). R8 is met through size (about 15 px)
   and colour instead.
5. **Files outside "Files you own":**
   - `CLAUDE.md`: its own section "manual.html tab structure" now describes the tab heading and `renderToc`.
   - `img/README.md`: see item 3.
   - `test/pwa/r12-carryover.test.js`: see §4.
6. **Behaviour touches inside the page script.** All are layout or wording only; no route, id, key or render contract
   changed:
   - `scrollToEl` puts a heading at the top (search hits still centre).
   - Search skips `.man-toc`.
   - The search result header and "No results" are in sentence case.
   - The notice button uses `.btn btn-sm` and the label "Dismiss".
7. **Kept on purpose:**
   - The safety warnings that repeat across tabs (the transition abort on Mission and Procedures; the QHOVER-landing
     reselect on Flight Modes, Aircraft and Procedures) stay where they are: each tab must stand alone in the field.
   - The Emergency tab still starts with the rendered design-intent card.

## 6. Notes for the verifier

- Desktop (≥ 1200 px), any tab:
  - The tab title, lede and right-hand "On this page" list are visible.
  - Scroll: the list stays and marks the current section.
  - Click an entry: the hash becomes `#tab/id` and the heading lands at the top.
  - Below 1200 px: the "On this page" disclosure sits under the title.
- `manual.html#relay/relay-ports`, `#fpv` and the search ("Fresnel", "Heartbeat") still work. A search hit in a closed
  emergency clean-up still opens it.
- Import a param file with `BATT_LOW_VOLT 0` (Tools → PARAMS): the Overview "Low battery failsafe" value becomes the red
  DISABLED statement inside its chip. It returns when you clear the file.
- Diagrams: open `S/shots/WP26/sheet/diagrams.png` (all 16 at 440 px). The fixes are in `S/shots/WP26/sheet/fix.png`.
- Screenshot helper: `S/wp26tools/shot2.sh` (`shotjs.sh` plus eager images, so lazy diagrams render). Batch:
  `S/wp26tools/allshots.sh <root> <outdir> [tabs]`, which also writes readable crops (`crop.py`).

## 7. Merged, shortened or removed callouts (old → where the fact lives now)

| Tab | Old | Now |
|---|---|---|
| Overview | NOTE "REL = altitude above home …" | Same sentence as a footnote under the key figures |
| Overview | NOTE "Both pilots co-located … if the client sends telemetry … verbal callouts primary" | Paragraph under Crew Roles, all facts kept |
| Overview | WARNING "Battery failsafes: at 22.0V (BATT_LOW_VOLT) automatic RTL; at 21.0V (BATT_CRT_VOLT) Loiter → QLand at the current position …; pilot RTL 23.0V; every RTL lands at home" | One WARNING: pilot RTL at 23.0V; `data-fs="battCrtVolt"` phrase "at the critical 21.0V … QLand at the current position, not home"; RTL lands at home; link to the ladder. The 22.0V auto RTL and the parameter names are in the key-figures list on the same tab, with their `data-fs` hooks |
| RF & Comms | WARNING Nkom (one block) | Lead (not assessed; verify every row before publishing, Q14) + "Points to check" disclosure with all four points |
| RF & Comms | NOTE Co-site, stacked under the Nkom warning | Paragraph, same text and the TBD — test 7 marker |
| Flight Modes | CAUTION MANUAL | Same facts, bold lead "MANUAL in flight will result in loss of control." |
| Flight Modes | CAUTION Battery failsafes (one long block) | Visible: the thresholds with their `data-fs` phrases, plus the QHOVER-landing reselect. Disclosure "Why the pilot's call comes first": the sag-compensation explanation |
| Flight Modes | "Design Intent" section heading above the rendered design-intent card | Heading removed (the card has its own title "Carrier failsafe — design intent") |
| Relay | NOTE Open hardware points | Muted paragraph, same text |
| Procedures | NOTE Carrier-only flights | **Raised** to WARNING; the hazard ("would disarm a flying client") comes first; same facts |
| Procedures | CAUTION Transition | Same text, bold lead "Highest-risk phase." |
| Procedures | `.safety-box` EdgeTX RF off | `card danger`, same title and text |
| Crew | NOTE "Client configuration … in the Client Drones tab" | One-line link under FPV Pilot — Prerequisites |
| Callouts | 4 stat boxes + NOTE "The FPV Pilot carries most …" | Definition list (same four principles) + paragraph |
| Mission Planning | WARNING band guidance | Lead (bands differ; the more demanding link sets the altitude; check both on the MAP) + "Bands and clearance" disclosure |
| Pre-Arm Ref | Second copy of diagram D5 | Link "State machine diagram: Relay Electronics → RC Bridge" |

Card variants: all static `card accent` → `card` (orange marks interaction only). Camera protocol, GPS Rescue
parameters, relay periodic tests and the two battery-maintenance tables → plain. Amber stays on S-02a, S-02b, S-01a,
the firmware request, the transition steps and the compass card (no backup compass).

## 8. Safety-token diff

```
python3 -I S/tools/safety-tokens.py --git S/wt/WP26 main manual.html
manual.html: 1458 tokens before, 1453 after

LOST (fewer occurrences after): 7
  marker 'TBD' x1
  mode   'QLOITER' x1
  mode   'RTL' x1
  param  'BATT_CRT_VOLT' x1
  param  'BATT_LOW_VOLT' x1
  param  'WAIT_GCS' x2
  value  '22.0 V' x1

NEW (more occurrences after): 1
  value  '7' x3
```

**LOST:**
- `22.0 V`, `BATT_LOW_VOLT`, `BATT_CRT_VOLT`, `RTL` (one each): from the shortened Overview battery warning. The same
  facts are in the key-figures list on the same tab: "Low battery failsafe `BATT_LOW_VOLT` 22.0V auto RTL" and
  "Critical battery failsafe `BATT_CRT_VOLT` 21.0V QLand here", both with their `data-fs` hooks.
- `TBD` and `WAIT_GCS` ×2: the caption of the duplicate D5 on Pre-Arm Ref ("BOOT → WAIT_GCS → … → WAIT_GCS. LED
  patterns: TBD (firmware)"). The identical caption remains on Relay Electronics, and the Pre-Arm bridge-state table
  still lists WAIT_GCS.
- `QLOITER`: the historical aside "the earlier "QLOITER" label was wrong" after `FLTMODE2` = 11 RTL. The fact itself
  (FLTMODE2 = 11 RTL, not on the 3-position switch) is unchanged. QLOITER as a mode still appears everywhere it is used.

**NEW:** `7` ×3 is the "7-waypoint" / "7-WP" in the new Mission and Mission Planning ledes and the new link "Mission
Planning → 7-WP template". The existing fact is the 7-waypoint mission; no new value.

**Diagrams:** the SVG text is unchanged in 15 of 16 files. In D13, "carrier orbit" is split onto two lines. Every other
change is colour or position.

`scripts/diagrams/slots.js` tokens: `17` → `16` is the slot count in code, plus a `0` in a comment ("D5 … until WP26").
These are not content values.

## 9. Screenshots (`S/shots/WP26/`)

Compared with `S/baseline/manual-*` (pre-redesign) and with `S/shots/WP26/before/` (the post-WP24 state of `main`).

| File(s) | Observation |
|---|---|
| `manual-overview-{1366,390}.png` | Baseline: ten big orange stat cards and three stacked callouts. Now: heading, lede and how-to line; two 200 px photos; two compact key-figure lists (amber / red chips only on the safety values); one callout; role cards instead of a cramped 3-column table (much better at 390) |
| `manual-flightmodes-*` | Design intent first; D7 at about 15 px text (was about 20 px, giant next to 14 px tables); the battery callout has a lead and a disclosure; S-02c no longer amber (three amber cards → two) |
| `manual-procedures-*` | Steps 2 and 7 flow inline (the baseline bug); the carrier-only warning reads hazard-first; the EdgeTX safety card uses the base danger card; D10 at table text size |
| `manual-comms-*` | Links table before the tall D1; neutral signal-chain nodes (no orange or red borders) that wrap with their arrows; the Nkom warning is one lead plus "Points to check"; co-site is prose |
| `manual-relay-*` | D8b + D8 and D5 + D4 side by side on desktop; the ports table scrolls inside its wrapper on a phone with a thin dark scrollbar. Longest tab (about 12.8k px at 1366), navigable through the side list |
| `manual-aircraft-*` | Tables with value chips inside their cells; the photos and D9 under their own heading; the battery gauge next to the voltage ladder, sized to about 15 px text (was about 20 px) |
| `manual-clients-*`, `manual-crew-*`, `manual-maintenance-*`, `manual-missionplan-*`, `manual-mission-*` | Tables no longer boxed inside cards; titles as sub-headings; links instead of italic references; the pitot caption credit line flows inline |
| `manual-callouts-*` | The four principles as a calm definition list; the rendered callout tables are unchanged |
| `manual-prearm-*`, `manual-abbrev-*`, `manual-params-*` | Filter field under the heading; the duplicate D5 is now a link; parameter groups form one bordered list instead of about 190 separate boxes |
| `manual-emergency-*` | Heading + lede; the CAUTION and pills unchanged; space above the cards. No "On this page" (no sections) |
| `toc-sticky-scrolled-1366.png` | Side list stays visible while scrolled; "Carrier Failsafe" marked |
| `toc-open-390.png` | Phone: "On this page" opened under the Procedures heading |
| `sun-manual-flightmodes-1366.png`, `sun-manual-overview-390.png` | Sunlight: black / white tokens, 2 px lines, zoomed text; the side list zooms with the content |
| `overflow-check-360.png` | Measured in Firefox at 360 px: `scrollWidth = clientWidth` on all 16 tabs (no sideways page scroll) |
| `sheet/diagrams.png`, `sheet/fix.png` | All 16 diagrams at 440 px; the label-collision fixes |
| `crops/` | Readable slices of every full-length shot |

## 10. Requests for WP28 (`css/base.css`, renderers, content)

1. **Callout with paragraphs and a disclosure.**
   - Today `.alert` assumes one text block. I used page rules `.man-main .alert p{…}` and `.man-more` (`manual.html:72-80`).
   - Please add multi-paragraph spacing to `.alert`, and promote `.man-more` (a quiet "More" summary in accent) as a
     component (e.g. `.alert .more`).
2. **`.section-title` as a heading.** The manual now uses `h3.section-title`; the component works unchanged. Please add
   `scroll-margin-top` to the component (page rule `.man-main .section-title`) and mention h2/h3 use in
   `docs/design/README.md`.
3. **Value chips on table cells.** `td.warn-val` / `td.crit-val` lose the cell padding (chip padding `0 .3em`). Document
   "chip inside the cell", or add `td.warn-val,td.crit-val{padding:var(--sp-2) var(--sp-3)}`.
4. **Scroll wrappers.** Add `scrollbar-width:thin;scrollbar-color:var(--dim) transparent` to `.tbl-wrap` in base (the
   page rule is `manual.html:110`).
5. **`js/render-content.js`:**
   - Tables are emitted in `<div style="overflow-x:auto">` with inline `th` widths (callouts, failsafe, network); please
     use `.tbl-wrap`.
   - The "Abort Calls" section title has no `id` (the manual adds `callouts-sec-N` at run time).
   - `designIntent()` emits `card accent`, an orange edge on non-interactive content; a plain card fits the principles.
6. **Shared components.**
   - The key-value list `.kv` / `.kv-grid` (`manual.html:92-99`) could serve the Tools summaries too.
   - So could the diagram figure `.dg` / `.dg-row`.
7. **Content copy (`data/content.js`).** The callouts intro ("One to five words per call; the recipient acknowledges with
   COPY …") repeats two of the four principles that the manual lists right above it; it could be shortened to the
   relay-specific sentence.
8. **`docs/design/README.md`.** The diagram palette now equals the WP23 tokens (`img/README.md` updated). The README
   could link to it.

## Rework round 1 (verifier round 1: APPROVED with MINOR 1–4; the PM required MINOR 1)

1. **MINOR 1 (required) — done.**
   - The Overview battery warning (`manual.html:329`) states both automatic failsafes again, each in its own phrase:
     `<span data-fs="battLowVolt">at 22.0V (BATT_LOW_VOLT) the carrier starts an automatic RTL</span>` and
     `<span data-fs="battCrtVolt">at 21.0V (BATT_CRT_VOLT) it does Loiter → QLand at the current position, not home</span>`.
     The rest stays short: the pilot's 23.0V call, RTL lands at home, and the link to the ladder.
   - The static `data-fs` phrases in the page body are back to `main`'s 9 / 8 / 3 (battLowVolt / battCrtVolt /
     battArmVolt).
   - New tests in `test/manual/body.test.js`:
     - The per-key phrase counts may not fall below 9 / 8 / 3.
     - The Overview warning must hold both phrases.
     - No "22.0 V … automatic RTL" may appear outside a `data-fs` phrase.
     - jsdom: with all three failsafes disabled, every `[data-fs]` element becomes a red DISABLED statement (20 in the
       body), including the one in the Overview warning.
   - Mutation check: deleting the restored phrase makes 2 tests fail.
2. **MINOR 2 — done.** On phones (≤ 600 px) the Pre-Arm Ref tables (`.prearm-filter`) show one block per row: message,
   cause and fix stacked, with no sideways scrolling. In other tables, `td code` may wrap on phones. See
   `shots/WP26/rework1/manual-prearm-390.png`.
3. **MINOR 3 — done.** The 13 numeric chip cells are now `<td class="num">` (base `.num`: tabular, no wrap). Page rule:
   `.man-main td.val{white-space:nowrap}`. Values such as "9 m/s", "10 m/s" and "45 deg/s" no longer break; long TBD
   chips still wrap. See `shots/WP26/rework1/manual-aircraft-{1366,390}.png`.
4. **MINOR 4 — not changed (optional).** The single 440 px diagrams stay alone. Pairing more of them would put
   unrelated diagrams side by side. A float or figure-beside-text layout is a candidate for WP28.

Safety-token diff after the rework (`python3 -I S/tools/safety-tokens.py --git S/wt/WP26 main manual.html`):

```
manual.html: 1458 tokens before, 1457 after
LOST: marker 'TBD' x1, mode 'QLOITER' x1, param 'WAIT_GCS' x2
NEW:  value '7' x3
```

The `22.0 V`, `BATT_LOW_VOLT`, `BATT_CRT_VOLT` and `RTL` losses are gone. The remaining LOST and NEW tokens are explained
in §8 (duplicate D5 caption, the historical QLOITER aside, "7-waypoint").

Checks:
- `node --test test/`: 345 / 345 pass.
- gen-precache, diagrams, params-reference `--check`; links, images, colours: all pass.
- html-validate: 0 errors; manual.html has 0 findings.

Screenshots: `S/shots/WP26/rework1/` (overview, prearm and aircraft at 1366 and 390, with crops).
