# WP23 — Design foundation: implementation report

Branch `wp/23`, implementation commit `88b4f90` (+ this report). Brief: `docs/tasks/WP23-design-foundation.md`;
direction: `docs/tasks/04-REDESIGN-CONTEXT.md`.

## 1. Summary

- `css/base.css` is now the design system. It has seven sections: fonts, tokens, base elements, **components**
  (between the markers `/* ── 4. COMPONENTS` and `/* ── end of components ── */`), sunlight, field-use and motion.
- **Tokens:** a 6-step type scale (12–28 px), line heights, spacing `--sp-1…7`, two radii and a surface ladder. Text
  tokens are `--text`, `--text-2` and `--muted`. `--dim` is retuned for non-text use only (≥ 3:1). There are tinted
  backgrounds and lines for the semantic colours, plus `--sans` / `--head` / `--mono`. The four semantic values are
  byte-identical, and `--bg` still equals the manifest's `background_color`.
- **Body font:** IBM Plex Sans (OFL) from `fonts.gstatic.com` v23. It is variable and ships as two woff2 files, latin
  (45 712 B) and latin-ext (30 964 B), with the licence, sha256 and source in `fonts/README.md`. Body text is 16 px at
  line-height 1.6. Monospace is kept for code, `.val`, `.mono`/`.num`, timers and value columns.
- **Components:** every rule that `index.html` and `manual.html` both defined has moved into base.css, along with the
  manual-only members of the same families: 76 selectors from index and 82 from manual (list in §8). Each one was
  restyled to the design direction:
  - calm cards whose colour shows only on the left edge;
  - tinted callouts with a small label and body text in `--text`;
  - sentence-case Oswald section and card titles in the text colour;
  - tables with a header band and tabular figures;
  - value chips and mode badges on tints;
  - steps with numbers in circles;
  - a high-contrast IMMEDIATE block and an amber CLEAN-UP block with a visible button.
- **New components:** `.btn` (+ `-primary`, `-ghost`, `-danger`, `-sm`, all ≥ 44 px), form controls at zero
  specificity, `.field`, `.disclosure`, and the utilities `.muted`, `.mono`, `.num`, `.stack`, `.cluster`, `.sr-only`.
- **Motion:** a `prefers-reduced-motion` rule switches all animation and transitions off.
- **Tests:** the WP09 "no visual change" snapshot is retired. In its place are design-system tests: semantic colours,
  tokens, WCAG contrast in both modes (tints included), the duplicate guard, component rules, jsdom computed styles,
  fonts and the styleguide.
- **Docs:** `docs/design/README.md` and `docs/design/styleguide.html`. `CLAUDE.md` "Style conventions" + Architecture
  row and `01-COMMON-CONTEXT.md` §2.4 are updated.
- **No content text changed.** The safety-token diff shows 0 LOST and 0 NEW on all four pages (§3).

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 Tokens | DONE | `css/base.css:26-78` (`:root`, one comment per line); sunlight `:239-245` | Type `--fs-xs…2xl` = 12/14/16/18/22/28; `--lh-tight` 1.25, `--lh-body` 1.6; `--sp-1…7`; `--r-sm` 4 / `--r-md` 8; ladder `#0f0f0f` < `#171717` < `#1f1f1f`; tints are rgba tokens. Text tokens ≥ 4.5:1 on all three surfaces in both modes (§4). `--dim` is documented as non-text (≥ 3:1). |
| R2 Body font | DONE | `fonts/ibm-plex-sans-latin*.woff2`, `fonts/OFL-IBMPlexSans.txt`, `fonts/README.md:10-11,18-25,34`; `@font-face` `css/base.css:8-13`; body `:83` | Variable `wght` 100–700 (covers 400 and 600). Both files ≤ 80 KB and start with `wOF2` (checked before copying). They were downloaded into `S/wp23/downloads/`; the scripts live in `S/wp23/scripts/`. `unicode-range` is copied from the Google CSS. CSP is unchanged. |
| R3 One definition | DONE | Components section `css/base.css:89-234`; page deletions in `index.html` / `manual.html` `<style>` | Header, nav and footer are untouched (WP24). Class names are unchanged. The duplicate guard covers all four pages. |
| R4 Component styles | DONE | card `:113-120`, callouts `:123-132`, section title `:109-110`, tables `:135-143`, values `:146-149`, badges `:152-158`, steps `:161-170`, emergency `:173-197`, buttons `:199-209`, forms `:211-218`, disclosure `:221-228`, utilities `:96-104` | Documented with markup in `docs/design/README.md` "Components". |
| R5 Motion | DONE | `css/base.css:322-325` | `animation:none; transition:none` on `*`. No `infinite` in base.css (tested). The FAB pulse stays in `index.html` (WP24). |
| R6 Sunlight + print | DONE | `css/base.css:239-258`; `css/print.css:11-12,21` | Sunlight stays white on black with 1.15 zoom; 2 px borders now also on `.btn` and 5 px callout edges; stronger tints. Print maps the new text tokens to ink and the tints to transparent, and prose uses the full paper width. Checked visually: `sun-*.png`, `styleguide-sun-*.png`, `print-*.png` (§9). |
| R7 Tests | DONE | `test/pwa/base-css.test.js` (rewritten, a+b, header explains the supersession), `test/design/tokens.test.js` (c), `test/design/components.test.js` (d + R3/R4/R5 + jsdom computed styles + styleguide), `test/pwa/pages.test.js` R1 (e), `test/pwa/computed-style.js` (generalised), fixture `computed-before.json` deleted | §5 |
| R8 Docs | DONE | `docs/design/README.md`, `docs/design/styleguide.html`, `CLAUDE.md` Architecture row + "Style conventions", `docs/tasks/01-COMMON-CONTEXT.md` §2.4 | The styleguide passes html-validate with 0 problems, has the same CSP shape and `noindex`, and is not precached or linked from the field pages (tested). It is deliberately **not** added to `pages.test.js` `PAGES`: that list is "field pages", and its checks assume `js/field.js`, the manifest and the version line, which a developer page should not load. The applicable rules (CSP, base.css link, no Google fonts) are tested in `components.test.js` R8 instead. |
| R9 No regressions | DONE | §5, §9 | All 04 §3 checks pass. html-validate: 0 errors and 169 warnings, the same count as `main`. Screenshots of every required view at 1366 and 390. |
| R10 rgba → tokens (SHOULD) | DONE (partial by design) | `index.html`: `.ci-warn-dot`, `.ci-right.open`, `.ci-detail`, `.go-nogo.go/.nogo`, `.ci.done .ci-box`, `.bl-btn` colour; `manual.html`: `tr.row-active td`, `.safety-box`; `relay/map.html` `#sb .btn*` `#000` → `var(--ink)` | Only one-for-one swaps. Header/nav colours (WP24) and the map's `#cursor-bar` / `.mlabel` rgba (no equivalent token) are left alone. |

## 3. Placeholders

No `TBD` added. Safety-token diff (`python3 -I S/tools/safety-tokens.py --git S/wt/WP23 main <file>`):

```
index.html               LOST 0 · NEW 0
manual.html              LOST 0 · NEW 0
relay/map.html           LOST 0 · NEW 0
tools/latency-clock.html LOST 0 · NEW 0
```

The only text-like change is in CSS-generated labels. The callout labels lost their trailing colons and became block
labels: `⚠ CAUTION`, `⚡ WARNING`, `▶ NOTE`. The words themselves are unchanged.

## 4. Contrast table (WCAG 2; computed by `test/design/tokens.test.js`)

Normal mode:

| Token | on `--bg` | on `--surface` | on `--surface2` | on its tint (over bg / surface) | min |
|---|---|---|---|---|---|
| `--text` | 15.64 | 14.63 | 13.45 | red-bg 14.37/13.31 · amber-bg 13.59/12.44 · accent-bg 13.93/12.83 · green-bg 13.65/12.54 | 4.5 |
| `--text-2` | 11.46 | 10.72 | 9.85 | — | 4.5 |
| `--muted` | 7.33 | 6.86 | 6.30 | red-bg 6.73/6.24 · amber-bg 6.37/5.83 | 4.5 |
| `--accent` | 6.84 | 6.40 | 5.88 | 6.09/5.61 | 4.5 |
| `--amber` | 12.52 | 11.71 | 10.76 | 10.87/9.95 | 4.5 |
| `--green` | 8.41 | 7.87 | 7.23 | 7.34/6.74 | 4.5 |
| `--red-fg` | 6.93 | 6.48 | 5.96 | 6.37/5.90 | 4.5 |
| `--blue` | 7.54 | 7.05 | 6.48 | 6.39/5.85 | 4.5 |
| `--orange-lt` | 8.47 | 7.92 | 7.28 | accent-bg 7.54/6.95 | 4.5 |
| `--red` (large/bold text, non-text) | 5.09 | 4.76 | 4.38 | — | 3 |
| `--dim` (non-text only) | 3.76 | 3.52 | 3.23 | — | 3 |

Sunlight mode (bg = surface = `#000`, surface2 `#111`):

| Token | bg / surface | surface2 | tint |
|---|---|---|---|
| `--text` | 21.00 | 18.88 | 16.64–17.62 |
| `--text-2` | 21.00 | 18.88 | — |
| `--muted` | 17.78 | 15.98 | 14.29–14.92 |
| `--accent` | 7.49 | 6.74 | 6.15 |
| `--amber` | 13.71 | 12.33 | 11.02 |
| `--green` | 9.22 | 8.29 | 7.30 |
| `--red-fg` | 7.59 | 6.83 | 6.37 |
| `--blue` | 8.26 | 7.43 | 6.39 |
| `--orange-lt` | 9.28 | 8.34 | 7.62 |
| `--red` | 5.58 | 5.02 | — |
| `--dim` | 13.62 | 12.24 | — |

Before WP23, `--muted #666` was 3.34 on `--bg` and the manual's `#777` was 4.28.

## 5. Tests

Added or changed:
- `test/pwa/base-css.test.js` (rewritten; WP09 R2 pinning retired with an explanation in the header): semantic values
  unchanged and not overridden in sunlight mode; `--bg` = manifest; the type, spacing, radius, surface, tint and font
  tokens with their values; every token has a comment; body uses `--sans` / `--fs-md`; no hex or rgba outside the
  `:root` blocks of base.css; `--shadow` kept.
- `test/design/tokens.test.js`: the contrast table above, both modes (57 pairs each).
- `test/design/components.test.js`:
  - every moved selector is in the components section, and the new component classes exist;
  - no header/nav/footer selector is in the section;
  - **duplicate guard** for the four pages, covering selectors inside `@media` and `@keyframes`, with selector lists
    split at top level and combinators normalised;
  - 44 px buttons, IMMEDIATE / CLEAN-UP rules, the callout text colour and tints;
  - reduced motion and no `infinite`;
  - jsdom computed styles on all four pages: body font Plex and 16 px, `.alert-warn` amber edge with `--text` body,
    `.warn-val` amber, `code` monospace, `.btn` 44 px, IMMEDIATE weight 700, sunlight body black/white;
  - styleguide rules.
- `test/design/design-lib.js`: selector and contrast helpers (not a test file).
- `test/pwa/pages.test.js` R1: 5 faces including 2 Plex faces (`font-weight:100 700`), `swap` + `unicode-range` on
  every face, woff2 magic, ≤ 80 KB, three OFL files, gstatic sources and sha256 values recorded in
  `fonts/README.md`.
- `test/pwa/computed-style.js`: generalised to `computeStyles(…, selectors, props, {sun, extraHtml})` with
  `rootTokens(css, sel)` / `modeTokens`. The fixture writer was removed. `wp14-refresh.test.js` still uses
  `loadJsdom`.
- `test/pwa/fixtures/computed-before.json`: deleted (look snapshot).

Commands (04 §3), all green:

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                       → tests 321, pass 321, fail 0, skipped 0
node scripts/gen-precache.mjs           → sw-precache.js regenerated (the 2 Plex woff2 added; 61 assets)
node scripts/gen-precache.mjs --check   → up to date
node scripts/diagrams/build.js --check  → up to date
node scripts/gen-params-reference.mjs --check → up to date
node scripts/check-links.mjs            → every internal link and asset resolves
node scripts/check-images.mjs           → 39 images within budget
node scripts/check-colours.mjs          → no hard-coded colours
html-validate index.html manual.html relay/map.html tools/latency-clock.html docs/design/styleguide.html
                                        → 0 errors, 169 warnings (main: 0 errors, 169 warnings; styleguide 0)
```

Tests changed because they asserted the old look:

| Old test | Why it changed |
|---|---|
| base-css "tokens are exactly the old values" | Neutral values were retuned by the owner decision. The semantic values are still pinned. |
| base-css "computed styles unchanged" | The pinning is superseded. Replaced by the computed-style checks in `components.test.js`. |
| "manual keeps its own `--muted #777`" | The override was removed: one `--muted` for all pages, ≥ 4.5:1. |
| pages R1 "3 faces" | Now 5. The same checks plus the new family. |

No safety or behaviour test was touched. `emergency-only.test.js` and `r12-carryover.test.js` regexes on base.css
still match unchanged.

## 6. Deviations / contract issues / notes for later WPs

1. **New colour tokens beyond the brief's list.** `--red-fg #f87171` exists because `--red` is 4.38:1 on `--surface2`,
   so small red text needs a lighter red. `#f87171` was already used by the old `.alert-danger` text. Also new:
   `--blue #60a5fa` (moved from the map's page token, same value; FBWA/FBWB badge, previously hard-coded),
   `--orange-lt #fb923c` (the MANUAL badge, previously hard-coded) and `--text-2` (prose). The four semantic values
   are unchanged.
2. **Map `.btn`:** base.css now defines `.btn`, so the map's own `.btn` rules were scoped as `#sb .btn…`. All 28 map
   `.btn` elements are inside `#sb`. Because they inherit the base `.btn` min-height of 44 px, and inputs and selects
   inherit the 44 px base control, the map sidebar panels are taller (`map-1366.png`). That is the tap-target rule,
   but it lengthens the sidebar. **WP27 decides the map layout.**
3. **Latency clock:** its `.btn`, `.card`, `p`, `table/td/th`, `a` and `:focus-visible` rules now come from base. It
   also lost its page `--mono` / `--head` fallbacks; they are now in the base tokens with the same value.
   `#clock`, `.v` and `.ticks` got `font-family:var(--mono)`, so the timer keeps its monospace now that the body is
   sans. Its card lost the orange left edge (a plain card).
4. **Monospace kept explicitly** where the pages relied on the old monospace body for values: `index.html` `.ci-note.copy-val`, `.lk-v`, `.ci-ts`, `.cl-section-prog`, `.cl-progress-label`; `manual.html` `.pr-table td:nth-child(2)`. Other value tables in the Tools tabs (battery log, flights, telemetry) are now sans with tabular figures — **WP25** should add `.num`/`.val` where wanted.
5. **Page-only token** `--content-pb` (`index.html` 100 px, 140 px on phones). This keeps `.content` shared while the
   Tools page keeps room for its bottom nav and FAB.
6. **Header, nav and footer** (WP24) were not edited, but the new tokens change their look:
   - body font Plex;
   - brighter `--muted`;
   - `.vf-btn` / `.vf-share` / toast in base got the radius and a quieter label style.
7. **Requests for later WPs** (not done here): many page-specific Tools rules still use 9–11 px sizes and letter
   spacing (WP25). The manual `.stat-box` / `.stat-val` are still orange (WP26). Diagram SVG text is unchanged.
8. **Screenshot tool note:** `S/tools/shot.sh` sometimes captures the latency clock before any text has painted.
   This also happens on `main`. The latency shots were retaken until text showed.

## 7. Notes for the verifier

- Open `docs/design/styleguide.html` (serve the repo root). The **☀ Sunlight mode** button, or `#sun` in the URL,
  switches modes; the contrast column is measured live.
- `node --test test/design/` runs the new suites. To see the guard fail, add `.card{}` to any page `<style>`.
- Fonts: `head -c4 fonts/ibm-plex-sans-latin.woff2` gives `wOF2`, and `sha256sum fonts/*.woff2` matches
  `fonts/README.md`.

## 8. Moved selectors

`index.html` → `css/base.css` (76 selectors):
- **Layout and text:** `.content`, `.tab-panel`, `.tab-panel.active`, `@keyframes fadeSlideIn`, `.section-title`,
  `.section-title:first-child`, `p`, `p strong`, `p b`.
- **Cards:** `.card`, `.card.accent`, `.card.amber`, `.card.danger`, `.card-title`, `.card.amber .card-title`,
  `.card.danger .card-title`.
- **Tables and values:** `table`, `th`, `td`, `td:first-child`, `td code` (→ `code`), `tr:last-child td`, `.val`,
  `.warn-val`, `.crit-val`.
- **Callouts:** `.alert`, `.alert-danger`, `.alert-warn`, `.alert-info`, `.alert::before`, `.alert-danger::before`,
  `.alert-warn::before`, `.alert-info::before`.
- **Steps:** `.step`, `.step-n`, `.step-body`, `.step-body strong` (→ `.step-body > strong`), `.step-body p`,
  `.proc-step`, `.proc-step .n`, `.proc-step .t`.
- **Emergency:** `.emerg-hdr`, `.emerg-imm`, `.emerg-imm-badge`, `.emerg-imm-step`, `.emerg-imm-step:last-child`,
  `.emerg-imm-step .n`, `.emerg-cleanup-btn`, `.emerg-cleanup-btn:hover`, `.emerg-cleanup-btn.open`,
  `.emerg-cleanup`, `.emerg-cleanup.visible`, `.emerg-cu-label`, `.emerg-cu-step`, `.emerg-cu-step:last-child`,
  `.emerg-cu-step .n`, `.emerg-cu-step .t`, `.emerg-pill`, `.emerg-pill.primary`, `.emerg-pill.note`, `.emerg-card`,
  `.emerg-primary`, `.emerg-summary`, `.emerg-note .emerg-note-text`, `.emerg-note-close`, `.emerg-note-close-title`,
  `.emerg-note-close .emerg-imm-step`, `.fs-primary td`.
- **Badges:** `.mbadge`, `.m-qhov`, `.m-fbwb`, `.m-auto`, `.m-rtl`.
- **Other:** `:focus-visible` (→ base elements), `.sr-only`, `.tbl-wrap`.

`manual.html` → `css/base.css` (82 selectors):
- **Same as index:** every index selector except `:focus-visible` and `.sr-only`.
- **Manual-only members of the same families:** `p code`, `li code`, `.step-body code` (→ `code`), `.alert strong`,
  `.alert code` (→ `code`), `.m-fbwa`, `.m-man`, `.emerg-pills`.
- **Page overrides removed:** `:root { --muted:#777 }` and `body{line-height:1.65}`.
- **Phone rules moved into the base phone block:** `.content`, `.card`, `th,td`, `table`, `.step`.

`relay/map.html`:
- `.warn-val` and `--blue` were removed (now in base).
- `.btn`, `.btn:hover`, `.btn.active`, `.btn.stop`, `.btn.stop:hover`, `.btn-row .btn`, `.sim-tabs .btn` and
  `.btn:disabled` were scoped as `#sb …`.

`tools/latency-clock.html`: `a`, `:focus-visible`, `.btn`, `.card`, `p` (from `p,li`), `table`, `td,th`, `th`, and the
`--mono` / `--head` page tokens.

## 9. Screenshots

All in `S/shots/WP23/` (S = `/tmp/claude-1000/-home-migul/7990681d-bfce-43e5-a095-ff045b3ad313/scratchpad`), with the
baseline in `S/baseline/`. They are 1366 and 390 px wide unless noted:
- `tools-{preflight,battlog,link,postflight}`, `tools-emergency-only`;
- `manual-{overview,procedures,emergency,relay,params}`;
- `map`, `latency`;
- `styleguide`, `styleguide-sun`, `sun-tools-preflight`, `sun-manual-emergency`;
- `print-manual-emergency.png`, `print-kneeboard.png` (800 px, `print.css` forced to `media=all`; the kneeboard with
  `html.vf-kb`).

Observations (compared with the baseline):
- **Tools pre-flight:** checklist titles are now Plex sans in sentence case. At 390 px, titles like "Wind within
  limits" fit on one line instead of one word per line. The page is calmer, and the rows are unchanged at ≥ 50 px.
  Section headers, the timer and the progress area are page-specific (WP25) and still use small letter-spaced
  labels.
- **Tools battery log:** section titles are sentence-case Oswald in the text colour. Form fields are 44 px with rounded
  boundaries. The amber "unverified" note is a chip, and the cards have radius and quieter edges.
- **Tools link / post-flight:** prose is readable; IPs show as monospace code chips.
- **Emergency-only mode:** the same structure, with rounded scenario buttons in lighter red (`--red-fg`) text. The
  primary button stays white on red.
- **Manual overview:** section titles are no longer letter-spaced grey caps. Prose is at a ≈ 75ch measure. The NOTE
  callout has a label line and white body text instead of orange text, and the crew table has a header band. The stat
  boxes are page-specific and still orange (WP26).
- **Manual procedures:** numbered circles, semibold step titles, muted detail and inline code chips. At 390 px the
  steps no longer stack the number above the text.
- **Manual emergency:** IMMEDIATE is bold white on a red tint with a red edge and red numbers; the label is a small red
  outline badge. The CLEAN-UP button is now clearly visible (amber outline; it was `#facc1555` before). The primary
  card has a red outline. Pills are rounded and the primary pill is filled red with dark text.
- **Manual relay / params:** the warning callout is calm. Parameter names are code chips and values are monospace.
- **Map:** the header is unchanged (WP24). Sidebar buttons and fields are 44 px and rounded, so the sidebar is longer
  (see §6.2). The legend and panels are otherwise as before.
- **Latency clock:** the buttons are base `.btn` (Oswald, 44 px) and the procedure text is in sans. The clock and the
  values stay monospace; the cards are plain.
- **Sunlight:** white on black, larger text, 2 px borders, stronger tints. The IMMEDIATE and CLEAN-UP blocks stay
  distinct.
- **Print:** black on white with readable sans body text. The emergency cards print first on the kneeboard, CLEAN-UP is
  expanded with a dashed separator, TBD/VERIFY are bold with a dotted underline, and the chips are outlined.
