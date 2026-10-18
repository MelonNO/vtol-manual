# Redesign programme (WP23–WP28): common context

The owner asked on **2026-10-18** for the site to be made **cleaner, more readable and prettier**, because it
is currently very messy and busy. Read this file after `01-COMMON-CONTEXT.md`. Where the two differ, this file wins
for WP23–WP28.

## 1. Owner decisions (2026-10-18)

- **Goal:** cleaner, calmer, more readable, prettier: Tools, manual, coverage map and latency clock.
- **Keep the dark theme.** No light theme. Sunlight / high-contrast mode (`<html data-sun>`) stays.
- **Text may be changed:** shortened, expanded, merged, split or reordered where that makes it clearer. The
  safety-content rules in §4 still apply in full.
- **Process:** the repository's PM → implementer → verifier method (`docs/HANDOFF.md` §3). The PM implements nothing.
- **The visual "no change" pinning of WP09 is superseded.** WP09 R2 (`test/pwa/base-css.test.js` and
  `test/pwa/fixtures/computed-before.json`) kept the look identical while CSS moved into `css/base.css`. The owner has
  now asked for a new look, so WP23 replaces that pinning with design-system tests.
- **The fonts and base size in `CLAUDE.md` / `01-COMMON-CONTEXT.md` §2.4 change** with WP23. That WP updates both
  documents.
- The PM pushes `main` once, when the whole programme is merged and verified.

## 2. Design direction (normative for every WP of this programme)

**What is wrong today** (screenshots of `main` at 1366 px and 390 px: `S/baseline/*.png`):

- Three lines of tiny letter-spaced capitals in every header, plus a strip of 7–9 key values that wraps onto two
  rows. On a phone, about 330 px of header comes before any content.
- All prose is monospace and mostly uppercase with wide letter spacing.
- About 15 different font sizes, many of them 9–11 px.
- Low-contrast labels: `--muted #666` on `#0f0f0f` is about 3.3:1.
- Orange everywhere: titles, borders, buttons, values.
- Ten equal stat cards on the manual Overview. Stacked coloured callouts.
- Ten tabs plus two links on the Tools nav. On the phone, checklist titles wrap one word per line.
- 300+ inline `style=""` attributes. 89 CSS selectors duplicated between `index.html` and `manual.html`.

**Principles**

1. **Calm by default, loud for safety.**
   - **Orange** `--accent` marks interaction only: the active tab, the primary button, links and focus.
   - **Red** means emergency or danger only. **Amber** means warnings, `TBD` and `VERIFY` only. **Green** means GO
     or healthy only.
   - Headings use the text colour, not orange.
2. **Clear hierarchy.**
   - One page heading per view and at most one primary action per card or section.
   - Secondary information goes behind a disclosure (`<details>`) instead of being deleted.
3. **Readable type.**
   - Prose: a self-hosted sans-serif body font (WP23 adds it), 16 px, line-height about 1.6, measure about 70ch.
   - **Oswald** for headings and short labels.
   - **Share Tech Mono** only for values, parameters, IPs and ports, code, timers and tabular numbers.
   - Uppercase with letter spacing only for short labels (≤ 3 words, tracking ≤ 1.5 px), never for sentences.
   - Minimum rendered text size 12 px. Exceptions: map attribution and SVG diagram fine print.
4. **Contrast.**
   - Text ≥ 4.5:1 against its background (large or bold headings ≥ 3:1).
   - Control boundaries ≥ 3:1.
   - This holds for normal and sunlight mode alike.
5. **Rhythm.** One spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 px), two radii, one border style, one surface ladder
   (`--bg` < `--surface` < `--surface2`).
6. **Field use first.**
   - Tap targets ≥ 44 px. Checklist rows ≥ 50 px high. Checkboxes 24 × 24 px.
   - Works at 360 px width with no horizontal page scroll.
   - Offline: no CDN, fonts self-hosted.
   - Emergency is one tap away on every Tools and manual view. Emergency-only mode (`index.html#emergency-only`) keeps
     its function.
7. **Motion.** Short, functional transitions only. No infinite decorative animation. Everything honours
   `prefers-reduced-motion: reduce`.
8. **Keep the identity.** Dark, operational and precise, with the orange accent. Pretty means less noise, better
   type and spacing, and consistent components. It does not mean new decoration.

**Hard constraints**

- The four semantic colour **values** stay as they are: `--accent #f97316`, `--red #ef4444`, `--green #22c55e`,
  `--amber #facc15`. The manifest, the standalone SVGs and the tests use them. Neutrals (`--bg`, `--surface*`,
  `--border*`, `--text`, `--muted`, `--dim`) may be retuned.
- **No logic changes.** Keep:
  - every element `id`, every function name called from markup or tests, every `data-*` hook and every
    `localStorage` key;
  - the hash routes (`manual.html#tab/anchor`, `index.html#emergency-only`), `showTab`, `switchTab`, `manGoTo`,
    `vtolRefreshAll`, `renderManual` and `VtolRender` output contracts.
- A test may change only where its assertion was about the old **look or markup layout**, and the report must explain
  each change. Never weaken a safety or behaviour test.
- Colours only via tokens. `scripts/check-colours.mjs` must pass. Do not add new hard-coded colours in page CSS.

## 3. Environment (this computer: Linux)

| Item | Path / command |
|---|---|
| S (scratchpad) | `/tmp/claude-1000/-home-migul/7990681d-bfce-43e5-a095-ff045b3ad313/scratchpad` |
| Main repo (PM only) | `/home/migul/vtolman` (branch `main`) — **do not edit it** |
| Your worktree | `S/wt/WPnn` on branch `wp/nn`, created by the PM from `main`. **Work only there.** |
| Node | `node` (v26 here; CI uses 24 — use nothing newer than Node 24 supports) |
| jsdom / html-validate | `export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom` · `/home/migul/vtol-tools/node_modules/.bin/html-validate <files>` |
| Python | `python3` (3.14, no venv). The GCS app is out of scope: **do not touch `gcs/` or `protocol/`**, so pytest is not required |
| Screenshots | `S/tools/shot.sh <site-root> <page[#hash]> <width> <out.png> [tools-tab] [height]` — headless Firefox, animations off. Example: `S/tools/shot.sh S/wt/WP25 index.html 390 S/shots/WP25/battlog-390.png battlog 2000` |
| Baseline screenshots of `main` | `S/baseline/` — `tools-<tab>-<w>.png`, `tools-emergency-only-<w>.png`, `manual-<tab>-<w>.png`, `map-<w>.png`, `latency-<w>.png`, widths 1366 and 390 |
| Safety-token diff | `python3 -I S/tools/safety-tokens.py --git <worktree> main <path>` (see §4) |
| Relay design (read only) | `/home/migul/Documents/a2ip/Analog Video to IP Relay with Drone TX Control — Technical Solution.md` |

**Checks every WP runs before reporting** (all must pass; html-validate: no new **errors**, warnings reported):

```bash
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/
node scripts/gen-precache.mjs            # then commit sw-precache.js if it changed
node scripts/gen-precache.mjs --check && node scripts/diagrams/build.js --check && node scripts/gen-params-reference.mjs --check
node scripts/check-links.mjs && node scripts/check-images.mjs && node scripts/check-colours.mjs
/home/migul/vtol-tools/node_modules/.bin/html-validate index.html manual.html relay/map.html tools/latency-clock.html
```

**Visual evidence (mandatory for every WP):**
- Take after-screenshots with `S/tools/shot.sh` at **1366** and **390** px for every view your WP changes. Also take
  at least one sunlight-mode check: set `localStorage.vtol_sunlight` — read `js/field.js` for the value — or show it
  in the styleguide.
- Save them in `S/shots/WPnn/`.
- **Look at them yourself** (Read the PNGs) and compare them with `S/baseline/`. List them in your report.

## 4. Text changes and safety content

You may rewrite copy: shorten, merge duplicated sentences, split walls of text, add one-line intros, make headings
plainer and terminology consistent. You must **not**:
- change, add or remove any number, unit value, parameter name or value, IP or port, mode name, threshold, timer, or
  `TBD` / `VERIFY` marker — unless the sentence holding it is removed because the same fact is stated elsewhere on the
  same page;
- change the order or meaning of checklist items, emergency IMMEDIATE steps or procedures;
- weaken or soften a warning; contradict an owner decision (`CLAUDE.md` "Owner decisions that must never be
  contradicted");
- invent anything. Relay facts come from the relay design (§3), parameters from
  `docs/reference/carrier-params-2026-10-17.param`, and requirements from `docs/SOFTWARE-IMPROVEMENT-PLAN.md` §15.

Run `python3 -I S/tools/safety-tokens.py --git <worktree> main <file>` for every content file you change. Paste the
output into your report and explain every LOST token: where the same fact still appears, or why it was a duplicate.
A NEW value is allowed only with its source.

## 5. Waves and file ownership

| WP | Title | Wave | Owns |
|---|---|---|---|
| WP23 | Design foundation: tokens, fonts, shared components | 1 | `css/`, `fonts/`, the `<style>` blocks of all four pages (only to remove rules moved into `css/base.css` and swap hard-coded values for tokens), `test/pwa/` (style tests), new `test/design/`, `docs/design/`, style sections of `CLAUDE.md` and `01-COMMON-CONTEXT.md` |
| WP24 | Shared page frame: header, key-values strip, navigation | 2 | the header / nav / footer markup, CSS and script of all four pages; `js/field.js`; the "shell" section of `css/base.css`; nav tests |
| WP25 | Tools page body | 3 | `index.html` below the nav (tab panels, modals, page CSS), `test/tools/`, `test/smoke/` (Tools parts) |
| WP26 | Manual body and diagrams | 3 | `manual.html` below the nav, `scripts/diagrams/`, `img/diagrams/`, `test/manual/`, `test/diagrams/` |
| WP27 | Coverage map and latency clock bodies | 3 | `relay/map.html` below the header, `tools/latency-clock.html` below the header, `test/map/` |
| WP28 | Shared content copy, rendered components, CHANGELOG | 4 | `data/content.js` (text), `js/render-content.js` (markup), `css/base.css` (components), `test/content/`, `CHANGELOG.md`, `README.md`, `docs/design/` |

- Wave 3 WPs run in parallel and **must not edit `css/base.css`**. If a shared component needs a change, put a
  page-scoped override in your page `<style>` and list the request in your report; WP28 folds it in.
- `sw-precache.js` is generated: each WP regenerates it, and the PM regenerates it again after each merge.
- Each WP may edit **its own section** of `CLAUDE.md` (for example "index.html — checklist system") when its change
  makes that section wrong.
