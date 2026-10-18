# WP25 verification — round 2
VERDICT: APPROVED

Worktree `S/wt/WP25`, branch `wp/25`. The rework is commit `bc8dd22`, on top of `dfb62a3`.

The rework changes these files:
- `index.html`: 4 CSS lines, the More-menu listeners and `emergJump`.
- `test/tools/wp25-tools-body.test.js`
- `.htmlvalidate.cjs`
- `sw-precache.js` (regenerated)
- the report

All of them are owned by WP25 or justified in the report. `.htmlvalidate.cjs` is a comment-only change, approved by the PM.

## Requirement results
| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | html-validate index.html 0 warnings | unchanged since round 1 |
| R2 | PASS | Firefox: ticked rows 52 px at 390 and 1366; minimum row 52 px; done-390.png | MINOR 3 from round 1 is fixed |
| R3 | PASS | unchanged since round 1 | |
| R4 | **PASS** (F1 fixed) | Firefox measurements and shots in `S/verify/WP25/shots2/` | see the jump table below |
| R5 | PASS | `emergJump` keeps its name and signature; only the scroll arithmetic changed; the new code is listeners only | no existing function changed apart from `emergJump` |
| R6 | PASS | safety-token diff identical to round 1 (LOST AUTO×2 and MANUAL×2 from label case, NEW RTL×1 in the battery intro) | no content changed in the rework |
| R7 / R8 / M1 / M5 / M7 | PASS | as in round 1 | |

**F1, emergency jump in real Firefox.** For every jump I measured where the scenario title and the whole `.emerg-imm` block sit against the bottom of the sticky header and the viewport.

| Width | Header bottom | emerg-gcs (first) | emerg-relay-pcb (middle) | emerg-batt (last scenario) | note-915-lost (last card) |
|---|---|---|---|---|---|
| 1366 | 70 | title 111, IMMEDIATE block 146–437 ✓ | title 111 ✓ | title 111, block 146–397 ✓ | title 148 ✓ |
| 390 | 93 | ✓ | title 126, block 160–479 ✓ | title 126, block 160–457 ✓ | title 126 ✓ |
| 360 | 93 | ✓ | ✓ | title 126, block 160–501 ✓ | title 126 ✓ |
| 390, sunlight | 106 | ✓ | title 142, block 182–549 ✓ | title 142, block 182–574 ✓ | title 142 ✓ |

- In every case the title is fully below the header and the IMMEDIATE badge and steps are on screen.
- I visually checked these shots: `j-emerg-batt-360`, `j-sun-emerg-relay-pcb-390`, `j-emerg-relay-pcb-1366` and `j-note-915-lost-390`.
- The pills call the same `emergJump`, so the pill path is covered too.

**Is the `emergJump` change minimal?** Yes. It is one arithmetic line that scrolls by the on-screen distance between the card top and the header bottom, minus 16 px. It has a fallback to the modal top when there is no header. It is robust to the header wrapping and to the sunlight zoom.

## Contract results
No change since round 1. The kneeboard print is unaffected:
- The More checkbox is now `display:none` on desktop.
- In print it is hidden by `.cl-hdr > :not(.cl-hdr-title)` anyway.

## Tests run (commands + results)
- `node --test test/`: 339 pass, 0 fail.
- `gen-precache --check`, `diagrams --check`, `params --check`, `check-links`, `check-images`, `check-colours`: all green.
- html-validate: 0 errors. Warnings: index 0, manual 0, map 40, latency 2. These match `main` apart from index, which went from 117 to 0.
- `.htmlvalidate.cjs`: the diff changes only `//` comment lines, and `require()` loads the file.
- **Do the new tests guard the fixes?** I ran the new test file against the round-1 tree (`git archive dfb62a3`) in `S/verify/WP25/r1`.
  - R2 fails on the round-1 code: done-row height, the desktop More checkbox and the emergJump regex.
  - R7 fails on the round-1 code: "card top lands 16 px under the header, never under it".
  - So the tests really guard F1 and the minors.
  - The jsdom part stubs rectangles, because jsdom has no layout. That is a reasonable unit-level guard, and the Firefox measurements above cover real layout.

## Smoke tests (what you loaded/clicked + result)
I ran these in Firefox with `shotjs`, at 390 and at 1366.

**Phone (390 px), More menu:**
- The label opens the menu.
- EXPAND ALL inside the menu runs its action (`aria-expanded=true`) and the menu closes.
- Tapping outside (the title) closes it.
- Escape closes it.
- Tapping the label twice opens and closes it.
- The checkbox is shown (still sr-only and focusable) and the focus ring is on the label.
- Tab order is checkbox, then the menu items.

**Desktop (1366 px):**
- Both the checkbox and the label are `display:none`, so they are out of the tab order.
- The tools row is always visible.

**Listener side effects:**
- The capture-phase click listener acts only when a `.cl-more-cb` is checked, and it never stops or prevents the event.
- The Escape listener only unchecks the boxes. The existing Escape handling for the emergency modal and challenge–response still works; I checked this in jsdom in round 1, and the logic is unchanged.
- The jsdom test passes with no script errors.

## Findings
1. MINOR — A tap outside the open More menu both closes the menu and activates whatever was tapped, for example ticking a row. The listener deliberately does not swallow the click. This is the usual behaviour of a non-modal menu, so it is acceptable, but WP28 or the owner may prefer a tap that only dismisses.
2. MINOR, carried over to WP28 by PM decision:
   - the `!important` overrides of the renderer's section colours;
   - the `body>#nav.tn-has-sub` workaround;
   - promoting the page components into `css/base.css`.
3. MINOR, pre-existing frame issue (WP24/WP28) — on a phone the fixed EMERGENCY button covers the right end of whichever row is under it while scrolling. The tick zones stay clear.

## Approval rationale
F1 (MAJOR) is fixed and verified in real Firefox:
- widths 1366, 390 and 360, plus sunlight mode;
- the first, a middle and the last scenario, and the last card.

The rework is minimal and guarded by tests that fail on the round-1 code. The round-1 minors on ticked-row height, the More menu and the stale `.htmlvalidate.cjs` comments are resolved. All checks in 04 §3 pass, and the safety-token diff is unchanged and explained. There are no BLOCKER or MAJOR findings, and every MUST requirement passes. APPROVED.
