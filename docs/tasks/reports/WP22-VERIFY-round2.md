VERDICT: APPROVED

# WP22 verification — round 2

- Branch `wp/22` at **2b61a98**, on top of c4a4eb1 and 10ffe45. Base `be7b8f0`.
- Verifier: independent agent, 2026-10-18.
- Throw-away material is under `S\verify\WP22\r2\`:
  - `run\`: an archive copy of 2b61a98 (git-initialised), used for the tests and mutations
  - `site\`: the render copy
  - `shots\`: the renders
  - `merge\`: the trial-merge clone
- Round 1 (`VERIFY-round1.md`) verified the licences, honesty, image processing and PM decisions. Round 2 does not change those files: `img/README.md` and the images are untouched since c4a4eb1. Those results still stand, and I re-checked the image hashes (below).

## Round-1 findings: status

| Finding | Status | Evidence |
|---|---|---|
| MAJOR-1: illegible attribution links | **FIXED** | See the MAJOR-1 section below |
| MINOR-1: test gaps | **FIXED** | See "Mutation tests": all 22 mutations are caught |
| MINOR-2: check-images count | **FIXED** | Report §4 now says 39 (base 35). I reproduced 39. |
| MINOR-3: Phase A record outside the repository | **FIXED** | See the MINOR-3 section below |

### MAJOR-1

**The fix.**
- `manual.html:71` adds `.man-photo figcaption a,#image-credits-table a{color:var(--accent);}`. It is a token, so `check-colours` stays green.
- `<table id="image-credits-table">` scopes the rule to the credits table, so the glossary tables in the same tab are not affected.

**Rendered in headless Chrome** at 360 px CSS width, in an iframe wrapper. I rendered both themes. Sunlight mode was forced with `localStorage.vtol_sunlight='1'`, injected into a throw-away copy before `js/field.js` runs. I sampled the screenshots for:
- the Client Drones caption,
- the Maintenance (pitot) caption,
- the Image Credits table.

| Theme | Where | Link px | Background px | Contrast |
|---|---|---|---|---|
| Normal | Captions | (249,115,22) | (34,34,34) `--surface2` | **5.68:1** |
| Normal | Credits table | (249,115,22) | (15,15,15) `--bg` | **6.84:1** |
| Sunlight | Captions | (249,115,22) | (17,17,17) | **6.74:1** |
| Sunlight | Credits table | (249,115,22) | (0,0,0) | **7.49:1** |

- These match the implementer's claimed 5.68 / 6.84 / 6.74 / 7.49.
- There are 0 UA-blue pixels in any of the 6 shots.
- The links keep their underline, so the information does not depend on colour alone.
- Screenshots: `r2\shots\{normal,sun}_{clients_xfpv,maintenance_xpit,abbrev_image-credits}.png`.

**The new test** (`test/manual/manual.test.js:226`):
- It parses the `<style>` rule.
- It requires both selectors and `color:var(--token)`.
- It reads the token values from `css/base.css` (`:root` plus the `:root[data-sun]` overrides).
- It asserts at least 4.5:1 against `--surface2` and `--bg` in both themes.
- Mutations: the rule removed, `--muted`, `--dim`, and either selector dropped are all caught (below).

### MINOR-3

Report §7 copies the 38-candidate table, the A1/A2 (and the PM-rejected A3) licence data, the staged-file clean-check table, and the full sha256 values.

I spot-checked those hashes; all match:
- **Originals** against `S\wp22\downloads\originals\`:
  - `commons_Dron-fpv.jpg` 86c13739…68de7e5b
  - `ardupilot_pitot.jpg` e24dcea0…dbc282c6b
  - `ardupilot_matekf405-std.png` d0db0490…f0b3d52a
- **My own downloads** of `Dron-fpv.jpg` and `pitot.jpg` from round 1: identical.
- **Committed files** in `img/`, all four:
  - `rep_fpv_quad.jpg` 88440b20…4914c65
  - `rep_fpv_quad.webp` 01fd0838…fe43f3b
  - `rep_pitot_tube.jpg` 23f5fc7a…f22b1b
  - `rep_pitot_tube.webp` 1688d877…5ae2902

## Mutation tests (round 2)

Script: `S\verify\WP22\tools\mutate2.py`. It runs on `r2\run\`; each mutation is applied, `node --test test/manual/manual.test.js` is run, and the copy is reset with `git checkout`. The copy is clean afterwards.

| Mutation | Result | Failing test |
|---|---|---|
| Colour rule removed | caught | attribution links are legible |
| Colour → `var(--muted)` | caught | attribution links are legible |
| Colour → `var(--dim)` | caught | attribution links are legible |
| Rule without the `#image-credits-table a` selector | caught | attribution links are legible |
| Rule without the `.man-photo figcaption a` selector | caught | attribution links are legible |
| Vendor row Matek removed (manual table) | caught | every photo has a credits row |
| Vendor row Heewing removed | caught | every photo has a credits row |
| Vendor row SIYI removed | caught | every photo has a credits row |
| Heewing `data-img` without `t2_vtol2` | caught | every photo has a credits row |
| Credits row FPV removed | caught | every photo has a credits row |
| Credits row FPV: author removed | caught | every photo has a credits row |
| Credits row pitot: licence text removed | caught | every photo has a credits row |
| FPV caption author "Euflipo" removed | caught | every photo has a credits row |
| Pitot caption author "ArduPilot Dev Team" removed | caught | every photo has a credits row |
| FPV caption licence removed | caught | every photo has a credits row |
| Pitot caption `#abbrev/image-credits` link removed | caught | every photo has a credits row |
| FPV caption credit span removed | caught | every photo has a credits row |
| FPV alt "Representative " dropped | caught | every photo has a credits row |
| Pitot caption "Representative image:" dropped | caught | every photo has a credits row |
| README row `rep_pitot_tube` removed | caught | every photo has a credits row |
| README row `siyi_hm30` removed | caught | every photo has a credits row |
| README FPV author changed, so the caption no longer matches | caught | every photo has a credits row |

## Tests run (commands + results)

Run in `r2\run\` (archive of 2b61a98), with `VTOL_JSDOM` and `VTOL_PYTHON` set.

| Command | Result |
|---|---|
| `node --test test/` | exit 0; tests **312**, pass 312, fail 0, skipped 0 |
| `node scripts/gen-precache.mjs --check` | exit 0; up to date (**59 assets**) |
| `node scripts/diagrams/build.js --check` | exit 0 |
| `node scripts/gen-params-reference.mjs --check` | exit 0 (1663 parameters) |
| `node scripts/check-links.mjs` | exit 0 |
| `node scripts/check-images.mjs` | exit 0; **39** images within budget |
| `node scripts/check-colours.mjs` | exit 0 |
| `html-validate manual.html index.html relay/map.html tools/latency-clock.html` | 0 errors, 169 warnings. The warning set is identical to base `be7b8f0`. `manual.html` alone is clean. |

**Trial merge**, in the clone `r2\merge\`:
- `be7b8f0` + `wp/21` (d43f6a9) + `wp/22` (2b61a98): both merges are clean.
- No file is changed by both branches.
- On the combined tree:
  - `node --test test/` passes 312/312.
  - The precache, links, images, colours, diagrams and params checks all exit 0.

## Smoke tests

**jsdom** (`tools\smoke.js` on `r2\run`):
- A direct load of `#abbrev/image-credits` makes `tab-abbrev` active, scrolls `#image-credits` into view, and shows 5 credits rows. There are 0 script errors.
- Following the caption link from `#clients` gives the same result.
- The glossary filter hides 0 credits rows.
- The figures are unchanged:
  - `<picture>` with a webp source, 1600×1200 and 1600×841, lazy;
  - the pitot full-size link goes to the precached `.webp`;
  - `.credit` keeps `text-transform:none`.

**Headless Chrome** at 360 px: no horizontal overflow and no cropping, in both themes.

## Scope

- **Changed files** (be7b8f0..2b61a98): `docs/tasks/reports/WP22-IMPLEMENTATION.md`, `img/README.md`, `img/rep_fpv_quad.{jpg,webp}`, `img/rep_pitot_tube.{jpg,webp}`, `manual.html`, `sw-precache.js` and `test/manual/manual.test.js`.
- None of WP21's files are touched.
- **Serial check:** I compared every EXIF token (digit runs ≥ 6, alphanumeric runs ≥ 8) of the historical `fpv_drone` blob against the full diff and the commit messages. There are 0 matches, so no camera serial appears.
- **Coordinates:** none of A1's Commons coordinates appear in the diff or the report.

## Findings

None at BLOCKER or MAJOR level. No new MINOR findings.

**Notes (no action needed for WP22):**
- **Pre-existing `Tools` link.** The link at `manual.html:1480` (*Client Drones ▸ Client Profiles*: "edit in Tools → PROFILES") still uses the UA default blue: no `a` rule matches it. I confirmed it predates WP22; it was introduced by 4b94a9b (WP06). It is out of scope, recorded for the PM.
  - **Correction to my round-1 report:** it said the manual had no plain text links before WP22. This one existed.
- **Report §7.1 row 1** gives a reason for the PM's Q1 = no ("courtesy of mateksys.com is permission given to ArduPilot, not a CC BY-SA relicence by Matek"). The PM decisions block records only "Q1: NO". This is wording only, and it does not affect anything shipped.
- **Accent token scope.** The contrast test reads `--accent` from `css/base.css` only. If `manual.html` ever overrode `--accent` in its own `:root`, the test would not see it. Today it overrides only `--muted`.

## Approval rationale

Every MUST requirement (R1–R6) and every PM decision passes.
- The round-1 MAJOR is fixed, and I measured the contrast in rendered output in both themes.
- All three round-1 MINOR findings are fixed.
- The new tests catch every mutation I tried, 22 of 22.
- The regression checks and html-validate show no change from base, and the trial merge with wp/21 is clean and green.

**APPROVED.**
