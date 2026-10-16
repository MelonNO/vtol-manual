# WP12 verification — round 1
VERDICT: APPROVED

Worktree `S\wt\WP12`, branch `wp/12` @ `50697f6`; diff base = `git merge-base main HEAD` = `831d3a9` (= current `main`).
Git 2.56.0.windows.2 (system `core.autocrlf=true`), Node v24.20.0, Windows PowerShell 5.1.26100.9711 (Desktop).

## Scope

`git diff --name-status 831d3a9 HEAD`:

| File | Status | Owned? |
|---|---|---|
| `.gitattributes` | M | yes |
| `docs/tasks/reports/WP12-IMPLEMENTATION.md` | A | yes |
| `test/content/content.test.js` | M | yes (`test/**`) |
| `test/manual/helpers.js` | M | yes |
| `test/map/mission.test.js` | M | yes |
| `test/repo-files.js` | A | yes |

Nothing outside the owned list. `git show --stat c75f31d` (R1 commit) = `.gitattributes` only.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `.gitattributes:5` `* text=auto eol=lf`; `:8-9` `*.bat`/`*.cmd eol=crlf`; `:12-24` png/jpg/jpeg/gif/webp/ico/woff/woff2/ttf/otf/zip/pdf/exe `binary`; `:27` `relay/vendor/** -text` (unchanged text, and last, so it wins over `*`) | `git check-attr`: `manual.html`, `scripts/*.ps1` → `text: auto, eol: lf`; all `relay/vendor/**` → `text: unset` (vendor PNGs also `binary: set`); `img/*` → `binary`. `eol: lf` inherited by `-text` files has no effect (Git ignores `eol` when `text` is unset) — confirmed empirically: every file under `relay/vendor/` and `img/` hashes (`git hash-object --no-filters`) to its HEAD blob in both fresh clones; `leaflet.css` and `LICENSE` remain CRLF on disk. `leaflet.css` sha256 = `p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=`, `leaflet.js` = `20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=` (official SRIs) in both clones. |
| R1 renormalise | PASS | `git ls-files --eol` on HEAD: every text blob is `i/lf` except the two deliberate vendored CRLF files | Re-ran `git add --renormalize .` in fresh clones (autocrlf true and false): 0 files staged. Claim "no content changes needed" is true. |
| R1 PowerShell | PASS | `.gitattributes:3-4` comment; scripts covered by `*` → LF | Own check in PS 5.1: LF-only (0 CR bytes) `scripts/git-setup.ps1` and `scripts/watch-push.ps1` from both clones parse with `[Parser]::ParseFile` → 0 errors (449 / 918 tokens). Own LF-only probe (block comment, `param`, function, `@'…'@` here-string, backtick continuation, `if` block) run via `powershell.exe -File` → `7 2` / `ok`, correct. Both scripts are pure ASCII, no BOM, so encoding is not an issue. `gcs/scripts/` does not exist; `*` covers it. Decision (LF) and justification are sound. |
| R2 | PASS | `test/repo-files.js:11-18` (`toLf`, `readText`); `test/manual/helpers.js:3-5`; `test/content/content.test.js:9,218`; `test/map/mission.test.js:6,8` | Searched all of `test/` for `readFile*`, `readdir`, `createReadStream`, `fs.`, `__dirname`, `require(`, `spawn/exec`, `vm.`: the only text reads of repo files are the three now routed through `readText` (`manual.html` → all `test/manual/*`; forbidden-terms scan of `index.html`/`data/`/`js/`; `.waypoints` fixtures). Remaining `fs` uses are `readdirSync` (content.test.js:214, index.js:8) and `existsSync` (manual.test.js:183) — no text content. All other tests `require()` JS modules (CRLF harmless). Python tests read with text-mode `open`/`read_text` (universal newlines). Mission CRLF case (`mission.test.js:31`) now really tests `\r\n`. |
| R3 | PASS | see Tests | Reproduced independently: 163/163 in both settings, 9 failures on pre-fix control, 163/163 on forced-CRLF checkout; pytest 548/548 in both. |
| R4 | PASS | diff list above | No page, JS app, relay, or gcs code touched; renormalisation changed no blob. |

## Contract results

No contracts referenced by the brief. N/A.

## Tests run (commands + results)

All under `S\verify\WP12\` (Git Bash, `export PATH="/c/Program Files/nodejs:$PATH"`):

```sh
git clone -q -c core.autocrlf=true  -b wp/12 "$S/wt/WP12" c-true
git clone -q -c core.autocrlf=false -b wp/12 "$S/wt/WP12" c-false
git clone -q -c core.autocrlf=true --no-checkout "$S/wt/WP12" c-base && git -C c-base checkout -q 831d3a9
git clone -q -c core.autocrlf=true --no-checkout -b wp/12 "$S/wt/WP12" c-crlf \
  && printf '* eol=crlf\n' > c-crlf/.git/info/attributes && git -C c-crlf checkout -q wp/12
(cd <clone> && node --test test/)
(cd <clone> && "$S/venv/Scripts/python.exe" -m pytest -q -p no:cacheprovider gcs protocol)
```

| Clone | autocrlf | Working-tree EOL (`ls-files --eol`) | `node --test test/` | pytest gcs protocol | `git status` |
|---|---|---|---|---|---|
| c-true (wp/12) | true | 133 w/lf, 2 w/crlf (vendor only), 13 -text | 163 pass / 0 fail | 548 passed | clean |
| c-false (wp/12) | false | same | 163 pass / 0 fail | 548 passed | clean |
| c-base (831d3a9, control) | true | 132 w/crlf | 154 pass / **9 fail** (bug reproduced) | — | — |
| c-crlf (wp/12, forced CRLF) | true | 134 w/crlf | 163 pass / 0 fail (helper alone suffices) | — | — |
| m-11 (wp/12 + merge wp/11 @ fdfe72c) | true | LF, vendor CRLF | 191 pass / 0 fail | — | — |
| m-08b (wp/12 + merge wp/08b @ 1c12ac6) | true | LF, vendor CRLF | — | 564 passed | — |

I did not see the flaky `test_main_cli` failure the report mentions (all pytest runs green first time).

Merges (`git merge-tree --write-tree`):
- `wp/12` vs `main` (831d3a9): clean (main is the merge base → fast-forward).
- `wp/12` vs `wp/08b` (1c12ac6): clean, tree `967aaf7`.
- `wp/12` vs `wp/11`: clean at 5cf0ad3 and again after it advanced to fdfe72c during verification (tree `9d023a2`).
- No blob with CR outside `relay/vendor/` in either merged tree, in `wp/08b` or in `wp/11`, so merging will not leave files that renormalisation would flag.

## Smoke tests

Not a web WP (no page/app change), so no jsdom / html-validate run is required. The page tests in `test/manual/*` and `test/content/*` pass on LF and on forced-CRLF checkouts.

## Findings

1. **MINOR — `docs/tasks/reports/WP12-IMPLEMENTATION.md` §4 table.** EOL counts ("132 w/lf", "131 w/crlf") are off by one to three compared with HEAD (133 w/lf / 134 w/crlf), because the report was committed after the counts were taken. Results (pass/fail) are accurate. Cosmetic only.
2. **MINOR (advisory, not WP12's defect) — `wp/11` `test/tools/params.test.js:9`.** This new test in the in-progress branch reads `test/fixtures/sample.param` with raw `fs.readFileSync`. It passes after merging with wp/12 (fixture is LF; fresh checkouts are now LF). For consistency WP11 should use `readText()` from `test/repo-files.js`, as the report's §5 already recommends.
3. **Note — existing CRLF working copies.** The main repo and other worktrees keep CRLF files on disk until re-checked out (correctly documented in report §5). Tests are robust to that through the helper (shown by c-crlf).

No BLOCKER or MAJOR findings.

## Approval rationale

All four MUST requirements pass on my own evidence. The change is minimal and in scope: `.gitattributes` plus one small, clear test helper, used by every test that reads repository text. Vendored Leaflet and images stay byte-exact, with SRIs intact. The rule order keeps `relay/vendor/** -text` effective. PowerShell scripts work as LF in PS 5.1. R3 reproduces, with a control that shows the original 9 failures. The branch merges cleanly into `main`, `wp/08b` and `wp/11`. The report's claims match reality, apart from cosmetic count differences.
