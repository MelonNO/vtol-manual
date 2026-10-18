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

**Section title** — Oswald `--fs-lg`, text colour, thin divider. `<div class="section-title">Crew Roles</div>`

**Table** — header row on `--surface2`, row dividers, cells `--sp-2`/`--sp-3`, tabular figures. Wrap it so it
scrolls on a phone; mark value cells.
```html
<div class="tbl-wrap"><table><thead><tr><th>Parameter</th><th>Value</th></tr></thead>
<tbody><tr><td><code>FS_GCS_ENABL</code></td><td class="val">2</td></tr></tbody></table></div>
```
`.val` = monospace value; `.num` = monospace tabular, no wrap; `tr.fs-primary` = the primary-failsafe row.

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
```

**Form controls** — `input`, `select`, `textarea` get a 44 px base style at zero specificity (`:where()`), so page
rules still win; checkboxes, radios and ranges get the accent colour.
```html
<div class="field"><label for="x">Label</label><input id="x" type="text"><span class="hint">Hint</span></div>
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
| Header, nav, footer | each page's `<style>` (redesign WP24 owns them) |
| Page-specific layout and widgets (checklist rows, Link panels, map panels, clock) | that page's `<style>` |
| Page-only tokens (map link colours, `--clock-*`, Tools `--content-pb`) | a `:root{…}` rule in that page's `<style>` |
