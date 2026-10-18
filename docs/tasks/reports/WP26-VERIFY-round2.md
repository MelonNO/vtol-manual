# WP26 verification — round 2
VERDICT: APPROVED

Rework commit `d78a5bf` on `wp/26` (on top of `3af653e`, which round 1 approved). Changed files: `manual.html`,
`test/manual/body.test.js`, `sw-precache.js`, the report (new section "Rework round 1"). All of them are in scope.
Base for the safety diff: the merge-base `3247bf0`, as in round 1.

## Requirement results (rework items)

| Item | Result | Evidence | Note |
|---|---|---|---|
| MINOR 1: Overview warning states the 22.0 V auto RTL with its data-fs phrase | PASS | `manual.html:336` | The text is "at 22.0V (BATT_LOW_VOLT) the carrier starts an automatic RTL; at 21.0V (BATT_CRT_VOLT) it does Loiter → QLand at the current position, not home. The pilot calls RTL earlier, at 23.0V …". Both phrases carry `data-fs`. This is main's wording plus the ladder link. |
| MINOR 1: DISABLED count back to main's | PASS | `S/verify/WP26/fs.js`, with `sample.param` imported through `ToolsCore.parseParamFile`/`paramFileRecord` | Main: 31. Round 2: 31. The output per element matches main line for line. The only difference is that the Overview key-figure chip also keeps `warn-val`, and `crit-val` wins in the cascade. |
| MINOR 1: the new tests are meaningful | PASS | `test/manual/body.test.js:164-194` | Mutation A: the Overview text was kept but its `data-fs` span removed. Both new tests fail. Mutation B: round 1's `manual.html` (phrase removed). Both new tests fail. Unmutated: both pass. |
| MINOR 2: Pre-Arm rows stack on phones | PASS | `manual.html:183-188` (`@media(max-width:600px)` on `.prearm-filter`, 4 tables); `:110` | At 390 and 360 each row is a block: message, cause, fix. Fix is fully visible and there is no sideways scrolling. At 1366 the 3-column table matches round 1. Phone-only `td code{white-space:normal}`. |
| MINOR 3: values do not break mid-value | PASS | `td.val` nowrap; chip cells now `td.num` (nowrap, base) | "9 m/s", "10 m/s", "8 s", "3500 ms" and "45 deg/s" stay on one line at 1366, 390 and 360. |

## Tests run

```
export VTOL_JSDOM=/home/migul/vtol-tools/node_modules/jsdom
node --test test/                               → 345 tests, 345 pass, 0 fail, 0 skipped
gen-precache --check / diagrams build --check / gen-params-reference --check → all up to date
check-links / check-images / check-colours      → pass
html-validate (4 pages)                         → 0 errors, 159 warnings (unchanged); manual.html → 0 findings
safety-tokens manual-before.html (merge-base) manual.html:
  LOST: TBD x1, QLOITER x1, WAIT_GCS x2 (the D5 duplicate and the QLOITER aside, explained in round 1)
  NEW:  '7' x3 (the 7-waypoint references)
  22.0 V, BATT_LOW_VOLT, BATT_CRT_VOLT and RTL are no longer lost.
```

## Smoke / visual

Own screenshots are in `S/verify/WP26/shots2/`: Overview, Pre-Arm Ref and Aircraft at 1366, 390 and 360. I looked at all of them. Overflow measured in Firefox at 360 px is 0 on all 16 tabs (`w360.png`).
- **Overview:** the warning reads naturally and keeps both thresholds. Nothing changed elsewhere.
- **Pre-Arm Ref:** the stacked rows are clean and readable on phones. The desktop table is unchanged.
- **Aircraft:** values and chips are on one line. At ≤ 600 px a long code name may wrap at "/" (`Q_TILT_RATE_UP/DN`), which is acceptable.

No regressions.

## Findings

None new. Round 1's MINOR 1–3 are fixed. MINOR 4 (empty space beside single 440 px diagrams at 1366) was not part of the rework and stays as noted.

## Approval rationale

There are no BLOCKER or MAJOR findings, and all MUST requirements still pass. The rework fixes the three requested items. The new tests fail when the safety phrase is removed. All §3 checks are green, and the safety-token diff is better than in round 1.
