# WP27 — Coverage map and latency clock bodies: implementation report

Branch `wp/27` (worktree `S/wt/WP27`), based on `main` with WP23 and WP24 merged. Commits: `d556a91` (implementation),
a follow-up commit (phone hint/toast spacing, regenerated `sw-precache.js`, this report).

## 1. Summary

- **Map control panel:** the ten stacked orange-topped panels are now **one card of nine collapsible groups**:
  Manual placement, Simulation, Link profiles, Terrain model, GCS coverage (HM30), Live (GCS app), Map layer, Legend,
  Offline data. Each group is a `<details class="pnl" data-pnl>` with **one heading style** (Oswald 16 px, text colour,
  chevron). Only **Manual placement** is open by default. The open/closed state of each group is kept in
  `vtol_map_state.panels` (the existing key is extended; no new key).
- **Panel content** uses the base components:
  - base `.btn` with **at most one `.btn-primary` per group**; the rest are default or ghost buttons;
  - base `.field` labels and 44 px inputs, with **units in a suffix beside the input** (MHz, dBm, dBi, dB, m, km, °, × F1, `m REL`);
  - segmented choices for the sim mode, the link kind and the altitude reference;
  - helper lines at 12–14 px, and long notes behind disclosures (the NAV command list; the profile value editor).
  - The panel is compact again through grouping. No tap target was shrunk.
- **Phone (≤ 600 px):** the panel is a **bottom sheet** with a grab handle ("Controls"). It is **closed at start**,
  opens to at most 68 % of the height, and the map stays visible above it. The Leaflet attribution sits above the
  closed sheet. The cursor bar moves to the top, beside the zoom buttons. The attitude box becomes a minimised chip
  at the top right that opens on tap.
- **Overlays:** the attitude box, the cursor/AMSL bar, the placement hint, the toast and the new SIMULATED chip share
  **one calm overlay style**: surface, border, 8 px radius, soft shadow, text of 12 px or more. They are placed clear
  of each other and of the Leaflet controls, which are dark and **44 px** now.
- **Simulated state below 1280 px (WP24 M2):** the closed Status button now gets the amber ⚠ when the state is
  simulated, and a **"⚠ SIMULATED" chip** appears on the map.
- **Latency clock:**
  - the digits are sized to the page width, so they **no longer overflow at 1366**;
  - the procedure is a **numbered list** with step circles;
  - base buttons (one primary: Add) and a labelled field;
  - calm stat boxes with sentence-case labels;
  - on a phone, "Samples" spans the full width so "7 / 20" is never cut.
- **No logic changes:** the RF model, the map state, the live layer and mission playback are untouched. Every id and
  function is kept. The only script edits switch elements from `style.display` to the `hidden` attribute, so that no
  static inline style is needed, and add three small UI functions (§5).

## 2. Requirements

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 side panel | **DONE** | CSS `relay/map.html:38-168`; markup `:333-636` (groups `data-pnl` place … offline); `initPanels()` `:2308`; test `test/map/ui.test.js` R1 (static and jsdom) | Collapsible groups with one heading style. Manual placement is open by default; the state is in `vtol_map_state.panels` and restored on load. One primary per group (tested). Base `.field` / `.btn` / `.disclosure`, units beside the inputs. html-validate `no-inline-style`: map **39 → 0**, clock **2 → 0** (whole files: 0 problems) |
| R2 phone layout | **DONE** | phone block `relay/map.html:280-302`; `toggleSb(open)` `:2296`; start state in `initPanels()` | A bottom sheet with a handle button (`#sb-tog`, `aria-expanded`), closed at start on ≤ 600 px. Zoom and measure stay at the top left (44 px). The cursor bar is at the top. The attribution is above the sheet. Screenshots at 390 and 360, open and closed |
| R3 overlays | **DONE** | `#att` `:169-198`, `#cursor-bar` `:234-246`, `#toast` / `#maphint` `:248-258`, `#sim-chip` `:260-266`, tablet rule `:277`, phone rules | One overlay style. Desktop: hint and chip at the top centre of the free map area (left of the panel); cursor bar at the bottom centre of the free area; attitude box at the bottom left (raised above the cursor bar below 1200 px). Phone: see R2; toast and hint above the sheet. Checked at 1366, 1024, 390 and 360 |
| R4 latency clock | **DONE** | `tools/latency-clock.html:15-59` (CSS), `:70-116` (markup) | Digits `min(calc((min(100vw,1100px) - 48px) / 7.4), 150px)`, white on black, monospace. Measured in the screenshots: the 12 characters fit at 1366, 390 and 360. Numbered `<ol class="steps">`, card titles, `.btn-primary` Add, `.btn-ghost` Clear / Full screen |
| R5 no logic changes | **DONE** | §5; test `ui.test.js` "every element the map script looks up … exists"; `test/map/*` green | RF model, `vtol_map_state` (only `panels` added), live layer and mission playback are unchanged. All ids and functions are kept. Safety-token diff: 0 LOST / 0 NEW for both files (§4) |
| R6 evidence | **DONE** | §7 | `S/shots/WP27/`: panel open and closed, clock at 1366 / 390 (and 360, 1024), sunlight map and clock |
| WP23 M5 (`--dim` as text) | **DONE** | no `color:var(--dim)` left in the map page CSS (tested) | Glyphs use `--muted` / `--text`; `--dim` remains only for control boundaries and the sheet handle |
| WP23 note (taller sidebar) | **DONE** | groups closed by default | Compact through grouping and disclosures; the 44 px controls are kept |
| WP24 M2 (simulated state hidden below 1280) | **DONE** | observer `relay/map.html:2331`; chip `:325`, `renderState` `:1300` | ⚠ on the closed Status button plus the amber "⚠ SIMULATED" chip on the map (hidden ≥ 1280 px, where the banner is inline). Tested in jsdom |
| WP24 M3 (map area 1 px shorter) | **NOT DONE** | — | The height comes from the shell (`.map-hdr .app-bar` and the header border in `css/base.css` section 8), which is frozen in wave 3. Listed as a WP28 request |
| WP24 notes (clock overflow, attitude box over the sidebar on phones) | **DONE** | R4, R2/R3 | Both fixed |

## 3. Placeholders

None added. All `TBD` texts are unchanged (they are generated by the script, e.g. "Service fair-use limits TBD").

## 4. Tests

**New: `test/map/ui.test.js`** (8 tests).

Static tests:
- No static `style=""` in either file.
- Nine groups in order, the same markup for each, only Manual placement open, at most one `.btn-primary` per group,
  and the placement hint is the first line of its group.
- Every `$('…')` id used by the map script exists in the markup, plus the prefix-built ids; the version line is kept.
- Phone rules: the sheet, the handle, the attribution offset, the cursor bar and the attitude box positions; 44 px
  Leaflet buttons; no px font size below 12; no `infinite`; no `color:var(--dim)`.
- Clock: the size formula, white on black, a 4-step numbered list holding 240 fps, 20 samples, mean and worst case
  and the video chain, one primary button, no page-wide `label` / `li` / `ol` / `.btn.primary` rule.

jsdom tests:
- Group state is saved to `vtol_map_state.panels` and restored on reload.
- Phone vs desktop start state of the sheet and the attitude box, and the handle toggle with `aria-expanded`.
- Simulated state: the ⚠ on the Status button, the SIMULATED chip shown and hidden, and the sim-mode sub-panels via
  `hidden`.

No existing test was changed. `test/pwa/wp14-carryover.test.js` pins `#sb-wrap{position:absolute;top:54px;`; that
value is kept.

Commands and results (worktree):

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                 → tests 342 · pass 342 · fail 0 · skipped 0   (main: 334)
node scripts/gen-precache.mjs     → wrote sw-precache.js (committed)
node scripts/gen-precache.mjs --check && node scripts/diagrams/build.js --check && node scripts/gen-params-reference.mjs --check
                                  → sw-precache.js up to date (61 assets) · diagrams up to date · params-reference up to date
node scripts/check-links.mjs      → every internal link and asset resolves
node scripts/check-images.mjs     → 39 images within budget
node scripts/check-colours.mjs    → no hard-coded colours in inline SVG or inline styles
html-validate index.html manual.html relay/map.html tools/latency-clock.html
                                  → 0 errors, 117 warnings (main: 0 errors, 159 warnings)
                                    relay/map.html 40 → 0 (39 no-inline-style, 1 multiple-labeled-controls)
                                    tools/latency-clock.html 2 → 0
```

**Safety-token diff:**

```
$ python3 -I S/tools/safety-tokens.py --git S/wt/WP27 main relay/map.html
relay/map.html: 35 tokens before, 35 after
LOST (fewer occurrences after): 0
NEW (more occurrences after): 0

$ python3 -I S/tools/safety-tokens.py --git S/wt/WP27 main tools/latency-clock.html
tools/latency-clock.html: 9 tokens before, 9 after
LOST (fewer occurrences after): 0
NEW (more occurrences after): 0
```

Text changes, none of which touch a value:
- Labels in sentence case with the unit moved into a suffix: "Freq (MHz)" → "Frequency" + `MHz`; "Alt (m REL)" →
  "Altitude" + `m REL`; "RX sens (dBm)" → "RX sensitivity" + `dBm`; "Ant. Height (m)" → "Antenna height" + `m`.
- "Orbit Radius (m) — also the default loiter radius" → label "Orbit radius", unit `m`, hint "Also the default loiter
  radius."
- "Client VTX Power (default from client profile)" → label plus hint.
- The separate hint panel text is merged into the placement group's first line: "Click the map, enter a position or
  use My Location to place the relay aircraft". The on-map hint keeps the original sentence.
- The profile note is split. "Saved to …" now sits under the Save button.
- Clock:
  - "CLOCK ONLY / FULL SCREEN / SHOW PANELS" → sentence case (the `togglePanel` strings too);
  - the uppercase labels → sentence case;
  - procedure step 2 "showing the relayed video" → "with the relayed video" and step 3 "the clock shown in" → "the
    clock in";
  - old step 5 ("The display's own frame interval … limits the resolution of one reading") is now a note under the
    four action steps. Its order is unchanged (still last), and so is its meaning.

## 5. Deviations / contract issues

1. **Script edits (presentational only).** These are needed because static inline styles are gone:
   - `selectSimMode`, `startMeasure` / `clearMeasure` / dblclick, `startVegDraw` / `_finishVegDraw` and both download
     functions now set `el.hidden` instead of `el.style.display`;
   - the measure control lost its inline-styled `<a>` (styled by `#btn-measure`).

   New UI code:
   - `toggleSb(open)` (same name, optional argument, sets `aria-expanded` instead of rewriting the arrow text);
   - `toggleAtt(open)`;
   - `initPanels()` (restores and saves `mapState.panels`, and closes the sheet and the attitude box on a phone at
     start);
   - one line in `renderState` for the SIMULATED chip;
   - the WP24 status observer also matches `#sim-banner.sim`.

   Nothing in the RF model, coverage, live or mission code changed.
2. **The version line moved** from the attitude box to the foot of the control panel. The markup is the same, which
   the shell test expects.
3. **Group order changed:** Manual placement first (open), then Simulation. The old separate hint panel is merged
   into Manual placement.
4. **The profile value fields are behind the "Edit profile values" disclosure.** The client, the kind, the active
   profile and the completeness status (`#pf-status`) stay visible.
5. **No infinite blink** on "terrain fetching" or on the measure hint any more. They are amber instead (principle 7).
6. **`CLAUDE.md`:** one phrase is added to the map Architecture row: the groups, `vtol_map_state.panels` and the
   phone sheet.

### Requests for WP28 (`css/base.css` frozen in wave 3)

- **Shell, WP24 M3:** the map area is 1 px shorter than on the old `main`. The 48 px `.map-hdr .app-bar` plus the
  header border are in section 8. If the border should not add to the height, use `box-sizing` / an inset shadow
  there.
- **Sunlight list (section 5):** `:root[data-sun] :is(.card,…,.pnl,.box)` could add `.att-pnl`, `#sb-wrap` and
  `#cursor-bar` for 2 px outlines. Today they get the white `--border2` at 1 px, which is visible but thinner than
  the cards.
- **`.vtx-row`, `.u-in` (input + unit suffix) and `.seg3` (equal-width segmented choice)** are page-scoped in the map.
  If Tools / manual need the same pattern, promote them to section 4. `.seg` in the shell is the nav variant.
- **`.field .hint`** is 12 px muted. A `.help` helper-line class (12 px, line-height 1.45, muted) is defined on the map
  page. Consider one shared helper class.
- **`.btn-ghost`** on a dark card is borderless. For small icon buttons (✕ clear) the map adds `.ico` (44 × 44). A
  shared `.btn-icon` would be useful.

## 6. Notes for the verifier

- Open `relay/map.html` at 1366. The "Controls" card shows groups; Manual placement is open. Open and close a few
  groups and reload: the state is restored. In `localStorage.vtol_map_state` → `panels`.
- Click the "Controls" header to collapse the card. The hint and the cursor bar re-centre (`:has`).
- Phone (390 / 360):
  - the sheet handle sits at the bottom; tap it to open the sheet over the lower ~2/3;
  - the zoom and measure buttons and the cursor bar stay at the top;
  - the attitude box is a chip at the top right.
- Simulated: enter lat 59.91 / lon 10.75, Apply, then Simulation → Straight → Start. At < 1280 px the Status button
  shows ⚠ and a "⚠ SIMULATED" chip is on the map; at ≥ 1280 the inline banner shows and the chip is hidden.
- Clock: the digits fit at every width. "Clock only" hides the cards; it switches to "Show panels".
- The headless screenshots happened to load tiles (network available). The UI was judged regardless.

## 7. Screenshots (`S/shots/WP27/`) and comparison with `S/baseline/`

The before-state of `main` (after WP24) is in `S/shots/WP27/before/`; iteration shots are in `S/shots/WP27/it/`.

| File | Observation vs baseline |
|---|---|
| `map-1366.png` | Baseline: ten stacked panels with orange top borders, 10–11 px letter-spaced uppercase labels, orange values, a separate hint panel. Now: one Controls card, the open placement group with sentence-case labels, unit suffixes and a single orange primary. The attitude box is a calm card; the cursor bar is a pill at the bottom centre of the free area; the hint is at the top |
| `map-closed-1366.png` | Panel collapsed to a "Controls ‹" button; the hint and cursor bar re-centre on the full width |
| `map-groups-1366.png`, `map-offline-1366.png` | Link profiles open with the value editor disclosure; Live / Map layer / Offline open. The same heading style, ghost "✕ Clear log" |
| `map-sim-1024.png` | Tablet: the panel shows all group headings; the Status button carries ⚠ and an amber dot; the attitude box is raised so it does not meet the cursor bar |
| `map-390.png`, `map-360.png` | Baseline: the sidebar covered the whole phone map and the attitude panel overlapped it. Now: the map is free; the sheet handle is at the bottom; the attribution and hint sit above it; the zoom, the cursor bar and the attitude chip are at the top with no overlap |
| `map-open-390.png`, `map-open-360.png` | The sheet open over ~2/3; the map and the Leaflet controls stay visible above; the Simulation group with segmented modes at 360 |
| `map-placed-390.png`, `map-att-390.png` | Placed aircraft; the toast above the sheet; the attitude box expanded at the top right, clear of the zoom controls |
| `map-sim-390.png`, `map-status-sim-390.png` | Simulated at 390: the amber dot plus ⚠ on Status and the "⚠ SIMULATED" chip; the status panel lists SIMULATED |
| `latency-1366.png`, `latency-samples-1366.png` | Baseline: the digits overflowed (".1" cut off) and the titles were orange and letter-spaced. Now the 12 digits fit with margins; numbered steps; one orange Add; sentence-case stat labels; a compact sample table |
| `latency-390.png`, `latency-samples-360.png` | The clock fits; the stats are three columns; in the samples card, Samples spans the full width so "7 / 20" is whole |
| `sun-map-1366.png`, `sun-map-open-390.png`, `sun-latency-390.png` | Sunlight: black / white tokens, 2 px control borders, the panel zoom 1.15 without clipping (the altitude choice moved onto the label row for this reason) |
