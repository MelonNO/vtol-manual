# WP12 — Implementation report (hotfix: line-ending robustness)

Branch `wp/12`, commits `c75f31d` (R1), `7dd1793` (R2), plus this report.

## 1. Summary

- Root cause: the **index was already LF everywhere** (only `relay/vendor/leaflet/{LICENSE,leaflet.css}` are CRLF, deliberately, under `-text`). The 9 failures came only from the **checkout**: `core.autocrlf=true` (set system-wide in `C:/Program Files/Git/etc/gitconfig`) turned 130 text files into CRLF, and `test/manual/*` regexes assume LF.
- `.gitattributes` now forces `* text=auto eol=lf` (stored and checked out LF whatever `core.autocrlf` says), adds explicit `binary` rules, CRLF for future `*.bat`/`*.cmd`, and keeps `relay/vendor/** -text` unchanged as the last rule.
- `git add --renormalize .` was run. Because the index already held LF, it staged **no content changes**: commit `c75f31d` contains `.gitattributes` only.
- New shared test helper `test/repo-files.js` (`ROOT`, `toLf`, `readText`) normalises CRLF→LF. All tests that read repository files as text use it (manual, content scan, mission fixtures), so tests also pass on a CRLF checkout (e.g. an old clone made before this fix).
- Proven in fresh clones with `core.autocrlf=true` and `false`: `node --test test/` 163/163; pytest 548/548.

## 2. Requirements

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `.gitattributes:5` (`* text=auto eol=lf`), `:8-9` (bat/cmd CRLF), `:12-24` (png jpg jpeg gif webp ico woff woff2 ttf otf zip pdf exe → `binary`), `:27` (`relay/vendor/** -text`, unchanged text) | Renormalised; no content change was needed (index already LF). PowerShell decision below. |
| R1 (ps1) | DONE | `.gitattributes:3-4` | **LF**, no exception. Tested with Windows PowerShell 5.1.26100 (Desktop): the LF-only versions of `scripts/git-setup.ps1` and `scripts/watch-push.ps1` parse with 0 errors (`[Parser]::ParseFile`), and an LF-only probe script using a block comment, a `@'…'@` here-string, a function and a backtick line continuation runs correctly (`7 2`). PS 5.1 accepts LF, CR and CRLF; what it does care about is *encoding* (no-BOM = ANSI), and both scripts are pure ASCII. LF keeps one rule for all text and byte-identical files on every OS. `gcs/scripts/` does not exist yet; the `*` rule covers it. |
| R2 | DONE | `test/repo-files.js:11-18`; `test/manual/helpers.js:3-5` (manual.html → all `test/manual/*`); `test/content/content.test.js:9,218` (forbidden-terms scan of index.html, data/, js/); `test/map/mission.test.js:6,8` (fixtures) | Grep of `test/` for `readFile`, `__dirname`, `createReadStream`: no other test reads repo files as text (others `require()` JS modules, where CRLF is harmless). The mission CRLF case (`mission.test.js:31`) now builds CRLF from guaranteed-LF text, so it really tests `\r\n` (before, on a CRLF checkout it produced `\r\r\n`). |
| R3 | DONE | §4 | Fresh clones under `scratchpad\eoltest\`, both settings, plus a pre-fix control and a forced-CRLF checkout. |
| R4 | DONE | `git diff --stat 831d3a9..7dd1793`: `.gitattributes`, `test/content/content.test.js`, `test/manual/helpers.js`, `test/map/mission.test.js`, `test/repo-files.js` only | No page or app code touched; no blob content changed by renormalisation. |

## 3. Placeholders

None.

## 4. Tests

Commands (Git Bash, `S` = scratchpad, `WT` = `S/wt/WP12`; Node 24 on PATH):

```sh
cd "$S/eoltest"
git clone -q -c core.autocrlf=true  -b wp/12 "$WT" c-true
git clone -q -c core.autocrlf=false -b wp/12 "$WT" c-false
git clone -q -c core.autocrlf=true --no-checkout "$WT" c-base && git -C c-base checkout -q 831d3a9   # control: before the fix
git clone -q -c core.autocrlf=true --no-checkout -b wp/12 "$WT" c-crlf \
  && printf '* eol=crlf\n' > c-crlf/.git/info/attributes && git -C c-crlf checkout -q wp/12            # helper-only: forced CRLF checkout
(cd <clone> && git ls-files --eol | awk '{print $1,$2}' | sort | uniq -c && node --test --test-reporter=tap test/)
(cd <clone> && "$S/venv/Scripts/python.exe" -m pytest -q -p no:cacheprovider gcs protocol)
```

| Clone | `core.autocrlf` | Working tree EOL (text files) | `node --test test/` | pytest gcs protocol |
|---|---|---|---|---|
| c-true (wp/12) | true | 132 `w/lf`, 0 CRLF outside vendor | **163 pass, 0 fail** | **548 passed** |
| c-false (wp/12) | false | 132 `w/lf` | **163 pass, 0 fail** | 547 + 1 flaky fail on first run; **548 passed** on rerun (see §5) |
| c-base (`831d3a9`, before fix) | true | 130 `w/crlf` | 154 pass, **9 fail** (reproduces the bug) | — |
| c-crlf (wp/12, forced CRLF) | true | 131 `w/crlf` | **163 pass, 0 fail** (helper alone is enough) | — |

Also: `git status` is clean in all wp/12 clones; every file under `relay/vendor/` and every image under `img/` is byte-identical to its blob (`git hash-object --no-filters` = `HEAD:<file>`) in c-true and c-false; the two vendored CRLF files stay CRLF. In the worktree itself, before re-checkout (CRLF files, helper in place): 163/163; after re-checkout (LF): 163/163.

## 5. Deviations / notes for the PM

- **Existing Windows clones (main repo, other worktrees) keep their CRLF files after merging** until those files are touched or re-checked out; Git does not rewrite unchanged files. The tests now pass anyway (R2). To get LF on disk in a clean clone: `git ls-files -z | xargs -0 rm -f && git checkout -- .` (Git Bash; only on a clean tree). `git status` may otherwise show nothing or, on some files, a "CRLF will be replaced by LF" warning; that is harmless.
- **Parallel branches:** `wp/08b` and `wp/11` touch none of the files changed here; `git merge-tree` of each with `wp/12` is clean, and neither branch (nor `main`) has a blob with CR outside `relay/vendor/`. New tests in those branches that read repo files should preferably use `readText()` from `test/repo-files.js`, but with this `.gitattributes` they will also see LF on any fresh checkout.
- **Flaky Python test (not EOL related):** `gcs/tests/test_main_cli.py::test_headless_sim_streams_then_failsafe_on_exit` failed once in c-false (it waits a fixed 5 s for the simulated bridge to reach FAILSAFE after a subprocess exits; it ran under load right after the c-true suite). Three reruns of the file and a full rerun all passed. Worth a timing margin in a later WP.
- Small additions beyond the literal brief, both in `.gitattributes`: `*.bat`/`*.cmd eol=crlf` (no such files yet; cmd.exe needs CRLF) and `*.exe`/`*.gif`/`*.ttf`/`*.otf`/`*.jpeg` as `binary` (future PyInstaller output and assets).

## 6. Notes for the verifier

1. `git show --stat c75f31d` → `.gitattributes` only. `git diff --stat 831d3a9..wp/12` → `.gitattributes` + `test/` only.
2. `git check-attr text eol -- manual.html relay/vendor/leaflet/leaflet.css img/t2_vtol.jpg scripts/git-setup.ps1` → `text: auto, eol: lf` for the page and the script; `text: unset` for vendor and the image (they also inherit `eol: lf` from `*`, but with `text` unset Git does no conversion; byte-exactness was checked in §4).
3. Repeat the four clones in §4; expect the same table (c-base must fail 9, the others 163/163).
