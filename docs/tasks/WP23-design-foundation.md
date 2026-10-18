# WP23 — Design foundation: tokens, body font, shared components (redesign wave 1)

Read first: `01-COMMON-CONTEXT.md`, **`04-REDESIGN-CONTEXT.md` (normative for this WP)**, `02-CONTRACTS.md` (C4,
C5), `CLAUDE.md` "Style conventions", `css/base.css`, `css/print.css`, the `<style>` blocks of `index.html`,
`manual.html`, `relay/map.html` and `tools/latency-clock.html`, `test/pwa/base-css.test.js`, `test/pwa/pages.test.js`,
`test/pwa/computed-style.js`, `scripts/check-colours.mjs`, `js/render-content.js` (the classes it emits).

Worktree: `S/wt/WP23`, branch `wp/23` (S = the scratchpad in `04-REDESIGN-CONTEXT.md` §3).

## Goal

Build the design system that every later redesign WP uses:
- the tokens;
- a readable body font;
- one shared definition of every component that both the Tools page and the manual use today.

After this WP every page already looks calmer, because tokens, type and shared components change. Header and nav
(WP24) and page layouts (WP25–WP27) are **out of scope**.

## Files you own

- `css/base.css`, `css/print.css`
- `fonts/**` (new font files, OFL licence, `fonts/README.md`)
- the `<style>` blocks of `index.html`, `manual.html`, `relay/map.html`, `tools/latency-clock.html`: **only** to delete
  rules that move into `css/base.css` and to replace hard-coded values with tokens. No markup or script changes,
  except the `<link>` / font preload lines in `<head>` if needed.
- `test/pwa/base-css.test.js`, `test/pwa/pages.test.js`, `test/pwa/computed-style.js`, `test/pwa/fixtures/computed-*.json`;
  new `test/design/*.test.js`
- `scripts/check-colours.mjs` (only if you extend it)
- new `docs/design/README.md`, new `docs/design/styleguide.html`
- `CLAUDE.md` section "Style conventions" (and the `css/base.css` row of "Architecture"); `docs/tasks/01-COMMON-CONTEXT.md` §2.4
- `sw-precache.js` (generated)

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **Tokens** in `:root` of `css/base.css`, each with a one-line comment:<br>- **Type scale:** `--fs-xs` 12 px · `--fs-sm` 14 · `--fs-md` 16 · `--fs-lg` 18 · `--fs-xl` 22 · `--fs-2xl` 28 (you may tune the values, but keep 6 steps with a 12 px minimum). Line heights `--lh-tight`, `--lh-body`.<br>- **Spacing:** `--sp-1`…`--sp-7` = 4 / 8 / 12 / 16 / 24 / 32 / 48 px.<br>- **Radii:** `--r-sm`, `--r-md`.<br>- **Surface ladder** (`--bg` < `--surface` < `--surface2`) and borders.<br>- **Tinted backgrounds** for callouts and badges, derived from the semantic colours (e.g. `color-mix(in srgb, var(--amber) 12%, transparent)`, or rgba tokens).<br>- **Font families** `--sans` (body), `--head` (Oswald), `--mono` (Share Tech Mono).<br>- The four semantic colour values stay byte-identical (`04` §2). Retune neutrals so that **`--text`, `--muted` and `--dim`-as-text reach ≥ 4.5:1 on `--bg`, `--surface` and `--surface2`**. If `--dim` stays below that, it is documented as "non-text only". Sunlight mode must also pass. |
| R2 | MUST | **Body font.**<br>- Add a self-hosted, OFL-licensed sans-serif font: **IBM Plex Sans** recommended; another OFL sans of similar quality is acceptable if you justify it.<br>- woff2, latin and latin-ext subsets, regular and semibold (or one variable file); each file ≤ 80 KB.<br>- Download it from an official source (Google Fonts `fonts.gstatic.com` or the IBM Plex GitHub release) into `S/wp23/downloads/` (untrusted data), then copy it into `fonts/`.<br>- Add `@font-face` with `font-display:swap` and the same unicode-ranges style as the existing faces.<br>- Add the OFL licence file. Record the source URL, version, date and sha256 in `fonts/README.md`.<br>- CSP `font-src 'self'` unchanged.<br>- `body` uses `var(--sans)` at `--fs-md`. Monospace stays for values, code, parameters, IPs and timers (`code`, `.val`, `.mono`, inputs of numbers, tables of values where the pages use it now). |
| R3 | MUST | **One definition per shared component.**<br>- Move every rule that is duplicated between `index.html` and `manual.html` into a "components" section of `css/base.css`. That is the 89 shared selectors (`.alert*`, `.card*`, `.section-title`, `.emerg-*`, `.proc-step*`, `.step*`, `.mbadge` / `.m-*`, `.warn-val`, `.crit-val`, `.val`, `.tbl-wrap`, `table` / `th` / `td`, `p` / `strong` / `code` inside content, `.tab-panel`, `.content`, keyframes, etc.).<br>- Restyle each one per the design direction and delete the page copies.<br>- **Exception:** header, nav and footer selectors (`header`, `nav*`, `.hdr-*`, `footer`) stay in the pages. WP24 owns them.<br>- Class names are **unchanged**, because the renderers and JS emit them.<br>- Page-specific rules stay in the page.<br>- Afterwards, no selector from the base components section may be redefined in a page `<style>` (R7 tests this). |
| R4 | MUST | **Component styles** (document each in R8):<br>- **Card:** surface, 1 px border, `--r-md`, padding `--sp-5`; variants accent / amber / danger mark only a 3 px left edge and the title colour.<br>- **Callout** `.alert-info` / `.alert-warn` / `.alert-danger`: tinted background, 3 px left border, a small uppercase label with icon, and body text in `--text`, not in the colour.<br>- **Section title:** Oswald, `--fs-lg`, text colour, modest tracking, thin divider.<br>- **Tables:** readable header row, row dividers, cell padding `--sp-2`/`--sp-3`, numeric cells monospace, horizontal scroll wrapper on phones.<br>- **Mode badges** and **value chips** (`.warn-val` amber, `.crit-val` red).<br>- **Steps:** number in a small circle or column, title semibold sans, detail text muted, inline `strong` / `code` stay inline.<br>- **Emergency family:** IMMEDIATE stays bold, high-contrast and red-marked; CLEAN-UP stays amber and collapsible. Semantics per `CLAUDE.md` "Emergency procedures structure".<br>- **Buttons:** new classes `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, all ≥ 44 px high.<br>- **Form controls:** `input`, `select`, `textarea` base style and a `.field` / label pattern.<br>- **Disclosure:** `details` / `summary` style.<br>- **Utility:** `.muted`, `.mono`, `.stack` / `.cluster` layout helpers (keep the set small). |
| R5 | MUST | **Motion.** `@media (prefers-reduced-motion: reduce)` turns off animations and transitions on every page. No infinite decorative animation is defined in `css/base.css`. (The Tools emergency FAB pulse lives in `index.html`; leave it for WP24.) |
| R6 | MUST | **Sunlight mode and print keep working.**<br>- Sunlight mode: `:root[data-sun]` overrides updated for the new tokens; still white on black, bigger text, thicker lines.<br>- `css/print.css`: the kneeboard still prints black on white with readable fonts.<br>- Check both visually: a screenshot with sunlight on, and print rules read through. |
| R7 | MUST | **Tests.**<br>- Retire the WP09 R2 "computed styles unchanged" pinning (`base-css.test.js` and the `computed-before.json` fixture). Explain in the test file header that it was superseded by the owner decision of 2026-10-18.<br>- Replace it with:<br>&nbsp;&nbsp;(a) the semantic colour values are unchanged;<br>&nbsp;&nbsp;(b) the type, spacing and radius tokens exist;<br>&nbsp;&nbsp;(c) a **WCAG contrast test** computes the ratios of `--text` and `--muted` (and every token documented as text) on `--bg`, `--surface` and `--surface2`, in normal and sunlight mode, and requires ≥ 4.5:1;<br>&nbsp;&nbsp;(d) a **duplicate guard**: no page `<style>` redefines a selector of the base components section;<br>&nbsp;&nbsp;(e) the font files exist, are referenced by `@font-face` and are licensed (update `pages.test.js` R1 for the new family).<br>- Keep every other test green.<br>- A jsdom computed-style check of a few key elements (body font family and size, `.alert-warn` border colour) is welcome. |
| R8 | MUST | **Documentation.**<br>- `docs/design/README.md`: the principles (short), the token tables, every component with a copy-ready markup snippet, do's and don'ts, and where page-specific CSS goes.<br>- `docs/design/styleguide.html`: a static page that links `../../css/base.css` and shows every token and component, with a sunlight toggle. It is **not** precached and not linked from the field pages. It must pass html-validate and the CSP and test rules that apply to pages (if `test/pwa/pages.test.js` enumerates pages, decide sensibly and explain).<br>- Update `CLAUDE.md` "Style conventions" (fonts, base 16 px, tokens, component rule, contrast rule, link to `docs/design/README.md`) and `01-COMMON-CONTEXT.md` §2.4. |
| R9 | MUST | **No regressions.**<br>- Every page loads with no script errors (jsdom smoke tests).<br>- All checks in `04` §3 pass. html-validate: no new errors.<br>- Before and after screenshots at 1366 and 390 px of at least these views (`S/shots/WP23/`): Tools pre-flight, Tools battery log, the Tools emergency modal or emergency-only mode, manual overview, manual procedures, manual emergency, map, latency clock, and the styleguide in both modes. Look at every one and describe what changed in the report. |
| R10 | SHOULD | Replace hard-coded `rgba(…)` colours in the page `<style>` blocks that you touch with tokens where that is a one-for-one swap. Do not chase every one (later WPs own the page bodies). |

## Out of scope

- Header, nav, the key-values strip and footer markup and CSS (WP24).
- Page layouts and copy (WP25–WP27).
- `data/content.js` and the renderer markup (WP28).
- `gcs/`, `protocol/`.

## Report

`docs/tasks/reports/WP23-IMPLEMENTATION.md`, per `01-COMMON-CONTEXT.md` §5, plus:
- the contrast table (token pair → ratio);
- the list of moved selectors;
- the screenshot list with your observations.
