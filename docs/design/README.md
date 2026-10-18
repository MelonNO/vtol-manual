# Design system (WP23)

All pages (Tools, manual, coverage map, latency clock) share one stylesheet: `css/base.css`. It holds the tokens, the
fonts, the base element styles and **one definition of every shared component**. Page `<style>` blocks hold
page-specific rules only. To see every token and component rendered, open
[`styleguide.html`](styleguide.html) (serve the repo root, then `/docs/design/styleguide.html`; it has a sunlight
toggle and measures the contrast live). The styleguide is a developer page: not precached, not linked from the field
pages.

## Principles (short)

1. **Calm by default, loud for safety.** Orange (`--accent`) marks interaction only: the active tab, the primary
   button, links and focus. Red = emergency / danger only. Amber = warnings, `TBD` and `VERIFY` only. Green = GO /
   healthy only. Headings use the text colour.
2. **Clear hierarchy.** One page heading per view; at most one primary action per card or section; secondary
   information goes into a disclosure instead of being deleted.
3. **Readable type.** Prose in IBM Plex Sans 16 px, line-height 1.6, measure ≈ 75ch. Oswald for headings and short
   labels. Share Tech Mono only for values, parameters, IPs, ports, code and timers. Uppercase with tracking only for
   short labels (≤ 3 words, tracking ≤ 1.5 px), never for sentences. Nothing below 12 px (exceptions: map attribution,
   SVG diagram fine print).
4. **Contrast.** Text ≥ 4.5:1 (large / bold headings ≥ 3:1), control boundaries ≥ 3:1 — in normal and sunlight mode.
   Tested: `test/design/tokens.test.js`.
5. **Rhythm.** One spacing scale, two radii, one surface ladder.
6. **Field use first.** Tap targets ≥ 44 px, checklist rows ≥ 50 px, checkboxes 24 × 24 px, 360 px width without
   sideways scrolling, offline (fonts self-hosted), emergency one tap away.
7. **Motion.** Short functional transitions only; `prefers-reduced-motion: reduce` switches all animation and
   transitions off (`css/base.css` section 7).
8. **Keep the identity.** Dark, operational, precise, orange accent. Pretty = less noise, better type and spacing,
   consistent components — not new decoration.

## Tokens

### Colours

| Token | Value | Sunlight | Use |
|---|---|---|---|
| `--bg` | `#0f0f0f` | `#000` | Page background (= manifest `background_color`) |
| `--surface` | `#171717` | `#000` | Cards, panels, header |
| `--surface2` | `#1f1f1f` | `#111` | Raised: table headers, code, hover |
| `--border` | `#262626` | `#bbb` | Hairline row dividers (decorative) |
| `--border2` | `#333` | `#fff` | Card and panel outlines (decorative) |
| `--dim` | `#6e6e6e` | `#d0d0d0` | **Non-text only**: control boundaries, checkbox frames, icons (≥ 3:1) |
| `--text` | `#e8e8e8` | `#fff` | Primary text, headings |
| `--text-2` | `#c8c8c8` | `#fff` | Prose paragraphs |
| `--muted` | `#a0a0a0` | `#ececec` | Secondary text, labels, first table column |
| `--accent` | `#f97316` | — | Interaction only (fixed value) |
| `--red` | `#ef4444` | — | Emergency / danger (fixed value). Large or bold text and non-text; small red text uses `--red-fg` |
| `--amber` | `#facc15` | — | Warning, TBD, VERIFY (fixed value) |
| `--green` | `#22c55e` | — | GO / healthy (fixed value) |
| `--red-fg` | `#f87171` | — | Red **text** on surfaces and tints |
| `--blue` | `#60a5fa` | — | FBWA / FBWB mode badge |
| `--orange-lt` | `#fb923c` | — | MANUAL mode badge, primary-button hover |
| `--accent-bg`, `--red-bg`, `--amber-bg`, `--green-bg`, `--blue-bg` | `rgba(…, .08–.12)` | `.14–.2` | Tinted backgrounds of callouts, badges, chips, IMMEDIATE / CLEAN-UP blocks |
| `--red-line`, `--amber-line` | `rgba(…, .35)` | solid | Dividers and outlines inside red / amber blocks |
| `--paper`, `--ink` | `#fff`, `#000` | — | Print, QR; dark text on filled red / orange buttons |
| `--shadow` | `rgba(0,0,0,.6)` | — | Toast shadow |

### Contrast (normal mode; the full table for both modes is checked by `test/design/tokens.test.js`)

| Text token | on `--bg` | on `--surface` | on `--surface2` |
|---|---|---|---|
| `--text` | 15.6 | 14.6 | 13.4 |
| `--text-2` | 11.5 | 10.7 | 9.9 |
| `--muted` | 7.3 | 6.9 | 6.3 |
| `--accent` | 6.8 | 6.4 | 5.9 |
| `--amber` | 12.5 | 11.7 | 10.8 |
| `--green` | 8.4 | 7.9 | 7.2 |
| `--red-fg` | 6.9 | 6.5 | 6.0 |
| `--blue` | 7.5 | 7.1 | 6.5 |
| `--red` (large / non-text, ≥ 3) | 5.1 | 4.8 | 4.4 |
| `--dim` (non-text, ≥ 3) | 3.8 | 3.5 | 3.2 |

### Type, spacing, radii

| Token | Value | Use |
|---|---|---|
| `--sans` | IBM Plex Sans | Body text, prose |
| `--head` | Oswald | Headings, short labels, buttons |
| `--mono` | Share Tech Mono | Values, parameters, IPs, ports, code, timers |
| `--fs-xs` / `--fs-sm` / `--fs-md` / `--fs-lg` / `--fs-xl` / `--fs-2xl` | 12 / 14 / 16 / 18 / 22 / 28 px | labels · secondary, tables, callouts · body · section titles, IMMEDIATE · page headings · display values |
| `--lh-tight` / `--lh-body` | 1.25 / 1.6 | Headings, labels / prose |
| `--sp-1` … `--sp-7` | 4 / 8 / 12 / 16 / 24 / 32 / 48 px | All padding, margins and gaps |
| `--r-sm` / `--r-md` | 4 / 8 px | Controls, badges, chips, code / cards, callouts, panels |
| `--content-max`, `--content-pb` | 1000 px, `--sp-7` | Width and bottom padding of `.content` (Tools: more, for its bottom nav) |

## Components (copy-ready)

Class names are emitted by the pages and by `js/render-content.js`: **never rename them.**

**Card** — surface, 1 px border, `--r-md`, padding `--sp-5`. Variants only colour the 3 px left edge and the title.
```html
<div class="card"><div class="card-title">Title</div><p>Text.</p></div>
<div class="card accent">…</div>  <div class="card amber">…</div>  <div class="card danger">…</div>
```

**Callout** — tinted background, 3 px edge, a small label (`::before`: ▶ NOTE / ⚡ WARNING / ⚠ CAUTION), body in
`--text`.
```html
<div class="alert alert-info">…</div> <div class="alert alert-warn">…</div> <div class="alert alert-danger">…</div>
```
Several points: one `<p>` each (a short visible lead first). The rest goes behind a quiet "More" disclosure — a
`<details>` directly inside the callout (the manual adds `class="man-more"` as a hook; it has no own CSS):
```html
<div class="alert alert-warn"><p><strong>Lead.</strong> The one thing to act on.</p>
  <details><summary>Why …</summary><p>Background.</p></details></div>
```

**Section title** — Oswald `--fs-lg`, text colour, thin divider. `<div class="section-title">Crew Roles</div>`, or as a
real heading `<h3 class="section-title" id="…">` (the manual; "On this page" lists them). With an `id` it keeps
`--sp-4` of air above it after an anchor jump (`scroll-margin-top`).

**Table** — header row on `--surface2`, row dividers, cells `--sp-2`/`--sp-3`, tabular figures. Wrap it so it
scrolls on a phone; mark value cells.
```html
<div class="tbl-wrap"><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead>
<tbody><tr><td><code>FS_GCS_ENABL</code></td><td class="val">2</td></tr></tbody></table></div>
```
`.val` = monospace value; `.num` = monospace tabular, no wrap; `tr.fs-primary` = the primary-failsafe row. A marker
can also be a whole cell (`<td class="warn-val">TBD</td>`): it keeps the cell padding. `.tbl-wrap` has a thin dark
scrollbar. Rendered tables (`VtolRender`) always come in `.tbl-wrap` with `<thead>` / `<tbody>`; the callout tables
(`.co-table`) set their column widths with `th.co-trig` (30 %), `th.co-who` (25 %) and `th.co-call` (35 %).

**Markers and badges**
```html
<span class="warn-val">TBD — what is needed</span>  <span class="crit-val">critical</span>
<span class="mbadge m-qhov">QHOVER</span> m-fbwb · m-fbwa · m-auto · m-man · m-rtl
```

**Steps**
```html
<div class="step"><div class="step-n">1</div><div class="step-body"><strong>Title</strong><p>Detail, <strong>inline</strong> stays inline.</p></div></div>
<div class="proc-step"><span class="n">1</span><span class="t">Procedure step</span></div>
```

**Emergency family** (semantics: `CLAUDE.md` "Emergency procedures structure"; markup from
`VtolRender.emergencyCard`). IMMEDIATE: red tint, red 3 px edge, bold `--fs-md` steps. CLEAN-UP: amber, collapsed until
`toggleCleanup(btn)`.
```html
<div class="card danger emerg-card emerg-primary"><div class="emerg-hdr">Title</div><p class="emerg-summary">…</p>
  <div class="emerg-imm"><div class="emerg-imm-badge">IMMEDIATE — FROM MEMORY</div>
    <div class="emerg-imm-step"><div class="n">1</div><div>STEP</div></div></div>
  <button type="button" class="emerg-cleanup-btn" aria-expanded="false" onclick="toggleCleanup(this)">▶ &nbsp;CLEAN-UP — …</button>
  <div class="emerg-cleanup"><div class="emerg-cu-label">CLEAN-UP · NOT FOR MEMORY</div>
    <div class="emerg-cu-step"><div class="n">1</div><div class="t">…</div></div></div></div>
<div class="emerg-pills"><button type="button" class="emerg-pill primary">…</button><button type="button" class="emerg-pill note">…</button></div>
```

**Buttons** — all ≥ 44 px high; at most one `.btn-primary` per card or section.
```html
<button type="button" class="btn btn-primary">Save</button> <button type="button" class="btn">Default</button>
<button type="button" class="btn btn-ghost">Cancel</button> <button type="button" class="btn btn-danger">Delete</button>
<button type="button" class="btn btn-sm">Small</button>
<button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Remove">✕</button>   <!-- glyph only: ≥ 44 px square, aria-label -->
```

**Form controls** — `input`, `select`, `textarea` get a 44 px base style at zero specificity (`:where()`), so page
rules still win; checkboxes, radios and ranges get the accent colour.
```html
<div class="field"><label for="x">Label</label><input id="x" type="text"><span class="hint">Hint</span></div>
<p class="help">A helper line under a control or a group of controls (same style as .field .hint).</p>
```

**Disclosure** — for secondary information.
```html
<details class="disclosure"><summary>More</summary><div class="disclosure-body">…</div></details>
```

**Utilities** — `.muted`, `.mono`, `.num`, `.stack` (column, gap 12), `.cluster` (wrapping row, gap 8), `.sr-only`.

## Do / don't

- **Do** use tokens for every colour, size, space and radius. `scripts/check-colours.mjs` fails on hex in inline
  styles and inline SVG; `test/pwa/base-css.test.js` fails on colours outside the `:root` token blocks of
  `css/base.css`.
- **Do** keep orange for interaction; give values `.val` / `code` (monospace, text colour), not orange.
- **Do** put secondary text in `--muted` and prose in `--text-2`; never below 12 px.
- **Don't** write sentences in uppercase or letter-space them; don't stack coloured callouts — one per point.
- **Don't** redefine a component selector in a page `<style>`: `test/design/components.test.js` (duplicate guard)
  fails. Need a variant? Add a page-scoped selector (`#tab-link .card`) or a modifier class, and ask for the shared
  change (redesign wave 3: list it in your report, WP28 folds it into `css/base.css`).
- **Don't** add a new colour value outside `:root` in `css/base.css`; add a token with a one-line comment and check
  its contrast in both modes (`test/design/tokens.test.js`).

## Where CSS goes

| What | Where |
|---|---|
| Tokens, fonts, base elements, shared components, sunlight overrides, field-use components (toast, SUN, emergency-only mode), reduced motion | `css/base.css` (sections 1–7) |
| Print and the kneeboard | `css/print.css` |
| Shell: app bar, page switcher, Aircraft summary, Tools and manual navigation, map status, footer, the Tools EMERGENCY button | `css/base.css` section 8 (redesign WP24, WP28) |
| Page-specific layout and widgets (checklist rows, Link panels, map panels, clock) | that page's `<style>` |
| Page-only tokens (map link colours, `--clock-*`, Tools `--content-pb`) | a `:root{…}` rule in that page's `<style>` |

## Diagrams

The standalone diagram files (`img/diagrams/*.svg`) cannot read the tokens; they use the same hex values. The
palette is in [`img/README.md`](../../img/README.md) and equals the tokens above (retuned by WP26).

## Page patterns (not shared components)

These live in one page's `<style>` because only that page uses them today. Promote one to section 4 when a second page
needs it (and delete the page copy: the duplicate guard enforces one definition).

| Page | Patterns |
|---|---|
| Tools (`index.html`) | `.form-grid` (+ `.wide`, `.wide-2`), `.actions`, `.note`, `.status`, `.st` status chips and `.lk-badge`, `.kv` (a `<dl>` grid), `.stat` cards, `.chart-lbl` / `.chart-box`, `.file-input`, `.check`, `.txt-ok/warn/crit/muted`, `.v-*` value colours, checklist rows (`.ci…`, `.cl-…`; the section colour arrives as `--sec`), Link panels (`.lk-…`), uppercase button labels inside the content |
| Manual (`manual.html`) | `.kv` / `.kv-grid` (rows of `<div><dt><dd>`, values right-aligned), diagram figures `.dg` / `.dg-row` / `.dg-scroll`, signal chains `.chain`, `.principles`, `.man-toc` |
| Map (`relay/map.html`) | `.u-in` (input with a unit suffix), `.seg3` (equal-width segmented choice; `.seg` in the shell is the navigation variant), `.vtx-row`, `.btn-row`, `.ico` (44 × 44 icon button inside a button row) |

## Wave-3 requests (WP28)

What happened to every request of the redesign WP23–WP27 reports for this stylesheet and the renderers:

| Request (from) | Result |
|---|---|
| Thin dark scrollbar on table wrappers (WP25, WP26) | **Folded**: `.tbl-wrap` in section 4; page copies removed (Tools keeps it for `.chart-box`, `.msg-list`; manual for `.dg-scroll`) |
| Callout with several paragraphs and a "More" disclosure (WP26) | **Folded**: `.alert p`, `.alert>details`; manual `.man-main .alert p` and `.man-more` rules removed |
| `scroll-margin-top` on `.section-title` (WP26) | **Folded**: `.section-title[id]`; manual rule removed |
| Marker chips on table cells (WP26) | **Folded**: `td.warn-val, td.crit-val` keep the cell padding |
| Renderer: no inline-styled table wrappers, abort heading id, plain design-intent card (WP26) | **Done** in `js/render-content.js`: `.tbl-wrap` + `thead`/`tbody`, `.co-table` column classes, `id="co-abort-calls"`, `card design-intent` |
| Renderer: section colour as a custom property, no `!important` overrides (WP25) | **Done**: `<div class="cl-section" style="--sec:#hex">`; only the letter badge uses it (`index.html`) |
| Sticky Tools sub-tabs `body>#nav.tn-has-sub` (WP24 M7, WP25) | **Folded** into the shell as `.tn.tn-has-sub` (phone) |
| Dead `.vf-hdr-tools`, `.vf-lbl`, phone `.hdr-top` (WP24) | **Removed** (also the dead `.hdr-*` rules in `css/print.css`) |
| Shell documented in this README; styleguide shows the shell (WP24) | **Done** ("Where CSS goes"; styleguide section "Shell") |
| Map bar 1 px taller than 48 px (WP24 M3, WP27) | **Done**: `.map-hdr` draws its divider inside the bar (`inset` shadow) |
| Sunlight 2 px outlines for `.att-pnl`, `#sb-wrap`, `#cursor-bar` (WP27) | **Folded** into the section 5 list |
| Shared helper line (WP27 `.help`) | **Folded**: `.help` = `.field .hint`; the map's page rule removed |
| Shared icon button (WP25 `.btn-icon`, WP27 `.ico`) | **Folded**: `.btn-icon` from Tools; the map's `.ico` stays a button-row modifier (its markup is outside WP28) |
| Promote `.seg` / `.seg3`, `.u-in`, `.vtx-row` (WP24, WP27) | **Not promoted**: one consumer each (see "Page patterns") |
| Promote the Tools patterns (`.form-grid`, `.actions`, `.note`, `.status`, `.st`, `.kv`, `.stat`, `.chart-*`, `.file-input`, `.check`, `.txt-*`, `.v-*`, uppercase button labels) and the manual `.kv` / `.dg` (WP25, WP26) | **Not promoted**: no second page uses them; Tools `.kv` (a grid of `dt`/`dd`) and manual `.kv` (rows of `div`) are different structures, so one shared rule would change one page's layout |
| Checklist section names in sentence case (WP25) | **Done** in `data/content.js` |
| Callouts intro shorter (WP26) | **Done** in `data/content.js` (the manual lists the principles right above it) |
| Single 440 px diagrams beside text at 1366 (WP26 MINOR 4, optional) | **Not done**: it needs a manual markup change (figure beside its text) outside WP28; pairing unrelated diagrams is not wanted |
