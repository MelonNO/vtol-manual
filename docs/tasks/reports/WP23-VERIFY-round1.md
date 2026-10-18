# WP23 verification — round 1
VERDICT: APPROVED

Worktree `S/wt/WP23`, branch `wp/23` (commits `88b4f90`, `c361433`), base `main` (`aa2e1be`).
S = `/tmp/claude-1000/-home-migul/7990681d-bfce-43e5-a095-ff045b3ad313/scratchpad`. My scripts, my screenshots and
this report are in `S/verify/WP23/`.

## Scope (check 1)

There are 23 changed files. Every one is in the brief's "Files you own" list, or it is the report or the generated
`sw-precache.js`:
- `css/base.css`, `css/print.css`;
- `fonts/` (two woff2 files, `OFL-IBMPlexSans.txt`, `README.md`);
- `docs/design/README.md`, `docs/design/styleguide.html`;
- the `<style>` blocks of the four pages;
- `test/pwa/{base-css,pages}.test.js`, `test/pwa/computed-style.js`, the deleted fixture `computed-before.json`;
- new `test/design/*`;
- `CLAUDE.md` (Architecture row + "Style conventions"), `01-COMMON-CONTEXT.md` §2.4;
- `sw-precache.js`.

**Markup and JS are unchanged.** `outside-style.py` removes every `<style>…</style>` block and compares each page
with `main`. All four pages are **byte-identical** outside `<style>`, including `<head>`, ids, `data-*` hooks and
scripts.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 Tokens (MUST) | PASS | `css/base.css:26-78`; sunlight `:239-245` | 6-step type scale 12–28 px, `--lh-tight` / `--lh-body`, `--sp-1…7` = 4…48, `--r-sm` / `--r-md`, ladder `#0f0f0f` < `#171717` < `#1f1f1f`, rgba tints. One comment per token. The four semantic values are byte-identical (`#f97316`, `#ef4444`, `#facc15`, `#22c55e`) and are not overridden in `[data-sun]`. `--dim` is documented as non-text. My own contrast numbers are below. |
| R2 Body font (MUST) | PASS | `css/base.css:8-13, 83`; `fonts/` | See "Fonts" below. The body uses `var(--sans)` at `--fs-md`, line-height 1.6. Monospace stays on `code`, `.val`, `.mono` / `.num`, the clock and timers, and the value columns that the pages had. |
| R3 One definition (MUST) | PASS | `css/base.css:89-234`; `dups.py` | Before WP23, `main` had **88** selectors shared between the index and manual `<style>` blocks. Now there are **14**, all header / nav / footer (`.hdr-*`, `header`, `nav*`, `footer`), which WP24 owns. My own parser finds **zero** component-section selectors redefined in any of the four pages. Class names are unchanged. |
| R4 Component styles (MUST) | PASS | `base.css`: card `:113-120`, callouts `:123-131`, section title `:109`, tables `:134-141`, chips `:144-147`, badges `:150-155`, steps `:158-166`, emergency `:169-196`, buttons `:199-208`, forms `:211-218`, disclosure `:221-227`, utilities `:96-106` | Everything the brief lists is present and documented in `docs/design/README.md` with markup snippets. Every `.btn` size is ≥ 44 px. IMMEDIATE steps are 700 weight in `--text` on a red tint with a red edge. CLEAN-UP is amber and collapsible (verified with a jsdom click). |
| R5 Motion (MUST) | PASS | `base.css:322-325` | Reduced motion switches off all animation and transitions. There is no `infinite` in base.css. The `.go-nogo` pulse and the FAB pulse are page rules, covered by the global reduced-motion rule. |
| R6 Sunlight + print (MUST) | PASS | `base.css:239-258`, `print.css:11-12, 21` | My sunlight screenshots (manual emergency and Tools pre-flight, 1366 and 390) are white on black with larger text and 2 px lines; IMMEDIATE and CLEAN-UP stay distinct. Print maps the new tokens to ink and the tints to transparent. The implementer's kneeboard print shot is black on white and readable. |
| R7 Tests (MUST) | PASS | `test/pwa/base-css.test.js`, `test/design/{tokens,components}.test.js`, `test/pwa/pages.test.js` R1 | The WP09 pinning is retired, and the file header explains the 2026-10-18 supersession. Parts (a)–(e) are all present and non-trivial. I ran mutation checks; see "Tests run". |
| R8 Docs (MUST) | PASS | `docs/design/README.md` (179 lines), `docs/design/styleguide.html`, `CLAUDE.md`, `01-COMMON-CONTEXT.md` §2.4 | The styleguide passes html-validate (0 problems), has a CSP and `noindex`, and is not precached or linked from the field pages (tested). The sunlight toggle works in Firefox. |
| R9 No regressions (MUST) | PASS | Tests, checks and screenshots below | All 04 §3 checks pass. html-validate: 0 errors and 169 warnings, the same as `main` (the per-rule counts are identical). Safety tokens: 0 LOST and 0 NEW on all four pages. |
| R10 rgba → tokens (SHOULD) | PASS | `index.html` / `manual.html` `+` lines; map `#000` → `var(--ink)` | One-for-one swaps only. The remaining map rgba values have no matching token, which is acceptable. |

## Contract results

- **C4 / C5 and the 04 §2 hard constraints:** no id, function, `data-*` hook, `localStorage` key, hash route or
  renderer markup changed. The pages are byte-identical outside `<style>`, and `js/` and `data/` are untouched.
- The renderer classes (`emerg-*`, `ci-*`, `mbadge`, `warn-val`, …) keep their names.
- `--bg` = manifest `background_color` (tested).

## Fonts

- `fonts/ibm-plex-sans-latin.woff2` (45 712 B) and `-latin-ext.woff2` (30 964 B) are both under 80 KB.
- Both are genuine WOFF2 files:
  - magic `wOF2`;
  - flavor `0x00010000` (TrueType);
  - header `length` equals the file size;
  - 24 tables.
- Their sha256 values match `fonts/README.md`. The README also records the source (gstatic v23) and the date.
- `fonts/OFL-IBMPlexSans.txt` is SIL OFL 1.1, © 2017 IBM Corp., Reserved Font Name "Plex".
- `@font-face` has `font-display:swap` and a Google-style `unicode-range`. The `url(../fonts/…)` paths resolve.
- Every page CSP still has `font-src 'self'`. No googleapis or gstatic reference remains in css or pages, and no CDN
  was added.
- The Firefox screenshots render Plex.

## Contrast: my own computation (`contrast.py`, WCAG 2 relative luminance)

| Token | Normal: bg / surface / surface2 | Sunlight: bg / surface / surface2 |
|---|---|---|
| `--text` #e8e8e8 | 15.64 / 14.63 / 13.45 | 21.00 / 21.00 / 18.88 |
| `--text-2` #c8c8c8 | 11.46 / 10.72 / 9.85 | 21.00 / 21.00 / 18.88 |
| `--muted` #a0a0a0 | 7.33 / 6.86 / 6.30 | 17.78 / 17.78 / 15.98 |
| `--accent` | 6.84 / 6.40 / 5.88 | 7.49 / 7.49 / 6.74 |
| `--amber` | 12.52 / 11.71 / 10.76 | 13.71 / 13.71 / 12.33 |
| `--green` | 8.41 / 7.87 / 7.23 | 9.22 / 9.22 / 8.29 |
| `--red-fg` #f87171 | 6.93 / 6.48 / 5.96 | 7.59 / 7.59 / 6.83 |
| `--blue` #60a5fa | 7.54 / 7.05 / 6.48 | 8.26 / 8.26 / 7.43 |
| `--orange-lt` #fb923c | 8.47 / 7.92 / 7.28 | 9.28 / 9.28 / 8.34 |
| `--red` (large / non-text, ≥ 3) | 5.09 / 4.76 / 4.38 | 5.58 / 5.58 / 5.02 |
| `--dim` (non-text, ≥ 3) | 3.76 / 3.52 / 3.23 | 13.62 / 13.62 / 12.24 |

- **Text on tints:** in both modes I checked `--text`, `--muted` and the tint's own colour on every tint composited
  over all three surfaces, including `--surface2`, which the test does not cover. The minimum is 5.12 (accent on
  accent-bg over surface2). Everything is ≥ 4.5.
- **Filled red buttons:**
  - The emergency-only primary button is white on `--red`: 3.76. It is large bold text (≥ 3:1), so it passes.
  - The manual's primary pill is black on red: 5.58.
- **The report's table agrees with my numbers.** Before WP23, `--muted #666` was 3.34.

## Tests run (commands + results)

Run in `S/wt/WP23` with `VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom`:

```
node --test test/                               → tests 321, pass 321, fail 0, skipped 0
node scripts/gen-precache.mjs --check            → up to date (61 assets)
node scripts/diagrams/build.js --check           → up to date
node scripts/gen-params-reference.mjs --check    → up to date
node scripts/check-links.mjs                     → every internal link and asset resolves
node scripts/check-images.mjs                    → 39 images within budget
node scripts/check-colours.mjs                   → no hard-coded colours
html-validate index.html manual.html relay/map.html tools/latency-clock.html docs/design/styleguide.html
                                                 → 0 errors, 169 warnings (main: 0 / 169; per-rule counts identical)
safety-tokens.py --git … main <each of 4 pages>  → LOST 0 · NEW 0 (all four)
```

The worktree stayed clean; I ran no non-`--check` generators there.

**Mutation checks** (on a copy of HEAD in `S/verify/WP23/mut`), to confirm the new tests are meaningful:
- Adding `@media(max-width:600px){.card , .alert-warn{color:red}}` to the manual `<style>` → the R7d duplicate guard
  fails. It catches rules inside `@media` and selector lists.
- `--muted:#666` → the R7c normal-mode contrast test fails.
- `--red:#ef4445` → the R7a semantic-colour test fails.

**Test quality:**
- `components.test.js` also pins the 44 px buttons, the IMMEDIATE / CLEAN-UP rules and the callout text colour.
- It runs jsdom computed styles on all four pages: body Plex 16 px, amber `.alert-warn` edge, `.warn-val` amber,
  `code` mono, `.btn` 44 px, IMMEDIATE bold, sunlight black / white.
- `pages.test.js` R1 checks the 5 faces, swap + unicode-range, WOFF2 magic, ≤ 80 KB, the OFL files and the sha256
  values in the README.

This is a sound replacement for the WP09 snapshot. No safety or behaviour test was weakened. The changed assertions
are only the look ones listed in report §5.

## Smoke tests (what I loaded / clicked + result)

jsdom, served over `http://127.0.0.1` with `runScripts:'dangerously'` and `resources:'usable'` (`smoke.js`), run on
both WP23 and `main`:
- `index.html`: 0 errors, 52 checklist items.
- `index.html#emergency-only`: 0 errors, `vf-eo` set, 9 scenario buttons.
- `manual.html#emergency`: 8 IMMEDIATE blocks. Clicking `.emerg-cleanup-btn` makes CLEAN-UP visible. The only error is
  jsdom's "scrollTo not implemented", which `main` also shows.
- `relay/map.html` and `tools/latency-clock.html`: 0 errors.
- **Result:** identical to `main`.
- `docs/design/styleguide.html`: its live-contrast script throws in jsdom because jsdom does not resolve `var()` in
  computed colour. It works in Firefox: the ratios are filled and the sunlight toggle works (see screenshots). → MINOR 2.

## Visual review (my own screenshots, `S/verify/WP23/shots/`, compared with `S/baseline/`)

I took screenshots at 1366 and 390 of:
- Tools pre-flight, battery log and `#emergency-only`;
- manual overview, procedures (`#procedures`) and emergency;
- the map, the latency clock and the styleguide;
- the styleguide in sunlight mode;
- in sunlight mode (my `shot-sun.sh` sets `vtol_sunlight=1`): Tools pre-flight and manual emergency.

What I saw:
- **Tools pre-flight:**
  - Checklist titles are Plex in sentence case.
  - At 390, "Wind within limits", "Landing zone clear" and similar titles now fit on one line instead of wrapping one
    word per line.
  - Rows are still ≥ 50 px and the EMERGENCY FAB is present.
  - The progress label "0 / 36 ITEMS COMPLETE" now wraps onto two lines at 1366 (page-owned; MINOR 1).
- **Battery log:**
  - Sentence-case Oswald section titles, 44 px fields, an amber TBD chip, cards with radius.
  - Nothing is clipped beyond the baseline: the narrow "e.g. 25.1" placeholder clip at 390 is identical on `main`.
- **Emergency-only:** the same structure and order. The primary SIYI button is filled red, the others are outlined
  with light-red text, and 915 BACKUP is amber. It is still prominent and fills the screen.
- **Manual overview:**
  - Prose at about 75ch, readable, no longer letter-spaced mono.
  - The NOTE callout has a label and white body.
  - The crew table has a header band.
  - The stat boxes stay orange (WP26).
- **Procedures:**
  - Numbered circles, semibold titles, muted detail.
  - Bold inline phrases no longer break the line, which is a clear improvement over `main` (where
    `.step-body strong` was `display:block`).
  - One capture showed the lazy-loaded D10 `<img>` as alt text. A retake rendered it normally, so it is a screenshot
    timing artefact, not a regression.
- **Manual emergency:**
  - IMMEDIATE steps are bold white uppercase on a red tint with a red edge and red numbers.
  - The CLEAN-UP button is now clearly visible; on `main` it was nearly invisible `#facc1555`.
  - The pills are rounded, and the primary pill is filled red.
  - Emergency stays the loudest element on the page.
- **Sunlight:** pure white on black, larger text, 2 px borders. Callouts, IMMEDIATE and pills stay distinct.
- **Map:**
  - The header is unchanged.
  - The sidebar buttons and fields are 44 px, so the sidebar is longer and scrolls.
  - The ATTITUDE panel overlapping the sidebar at 390 and the "×" clear-home button overflowing the sidebar edge are
    both identical on `main`, so they are not introduced by WP23.
- **Latency clock:** base buttons, sans procedure text, the clock and values still monospace.
- **Styleguide:** every token with live contrast, the type and spacing scales, the components. At 390 its tables
  scroll inside `.tbl-wrap`.
- **Horizontal scroll at 390:** none visible on any view. Base components add no fixed width over 360 px.

**Overall:** readability is clearly better, nothing is newly broken, overlapping or clipped, and emergency is still
prominent. This WP introduces no look or layout regression.

## Deviations evaluated

1. **`--red-fg`, `--blue`, `--orange-lt`, `--text-2`: ACCEPT.**
   - `--red` is 4.38:1 on `--surface2`, so small red text needs a lighter red.
   - `#f87171`, `#60a5fa` and `#fb923c` were already in use: the old `.alert-danger` text, the map page token, and
     hard-coded badge colours that are now tokenised.
   - The semantic four are untouched. Every new token is commented, contrast-tested in both modes and mapped to ink
     in print.
2. **Map `.btn` scoped as `#sb .btn` and the taller sidebar: ACCEPT.**
   - Scoping is required, because otherwise the map's `.btn` would redefine a base component and trip the guard.
   - All 28 map `.btn` elements are inside `#sb` (verified), so behaviour is unchanged.
   - The extra height comes from the 44 px tap-target rule (04 §2 principle 6). It makes the sidebar longer, but
     breaks nothing that `main` did not already have. WP27 owns the map layout.
3. **Monospace re-added on `.ci-note.copy-val`, `.lk-v`, `.ci-ts`, the progress labels, `.pr-table` value column,
   `#clock`, `.v` and `.ticks`: ACCEPT.** This is exactly R2 ("Monospace stays for values … timers"), now that the body
   is sans.
4. **Styleguide tested in `components.test.js` R8 rather than added to `pages.test.js` PAGES: ACCEPT.** PAGES checks
   field-page assumptions (`field.js`, manifest, version line) that a developer page should not carry. The rules that
   do apply (CSP, base.css link, not precached or linked) are tested.
5. **`--content-pb` page token (Tools 100 / 140 px): ACCEPT.** It keeps `.content` shared while leaving room for the
   bottom nav and the FAB.

## Findings

1. **MINOR** — `index.html` `.cl-progress-label` / the pre-flight header: at 1366, "0 / 36 ITEMS COMPLETE" now wraps
   onto two lines, because the header row reflowed with the new button sizes. This is a page-specific rule, so it goes
   to WP25.
2. **MINOR** — `docs/design/styleguide.html:204-206`: `rgb()` returns `null` when a computed colour cannot be parsed,
   so the script throws before it wires the sunlight toggle. This happens in jsdom only, not in browsers. A guard
   would make the developer page robust.
3. **MINOR** — `test/design/tokens.test.js:15-30`: text on tints is checked over `--bg` and `--surface` only, not over
   `--surface2`. My computation shows those pairs all pass (minimum 5.12), but the test does not cover them.
4. **MINOR** — `css/print.css:8`: the comment still says "the pages' own :root overrides (manual --muted)", but that
   override was removed by this WP.
5. **MINOR (note for WP25 / WP27)** — page rules still use `color:var(--dim)` for text-like glyphs:
   - `relay/map.html:178` `.ter-txt`;
   - `index.html:75` `.expand-icon`;
   - `manual.html:94` `.ca`.

   `--dim` is 3.76:1, which is better than the old `#444`, but it is documented as non-text. Many page-specific
   9–11 px sizes and letter-spaced labels also remain. Both are acknowledged in report §6.7 and are out of WP23 scope.

## Approval rationale

All MUST requirements R1–R9 pass, and the SHOULD R10 passes too.
- **Scope:** clean; markup and JS are byte-identical outside `<style>`.
- **Semantic colours and contrast:** the semantic colours are byte-identical, and the contrast targets hold in both
  modes. I recomputed them independently.
- **Fonts:** genuine OFL woff2, self-hosted, CSP unchanged.
- **Duplicates:** they really moved; only WP24's header / nav / footer remain shared.
- **Tests:** the replacement tests are meaningful, as the mutation checks show.
- **Checks:** all 04 §3 checks pass, with no new html-validate errors and a 0 / 0 safety-token diff.
- **Visual review:** a clear readability gain with no look or layout regression.

There are no BLOCKER or MAJOR findings; the five MINOR items may remain.
