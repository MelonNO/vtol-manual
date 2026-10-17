# Reference carrier parameter file

| Item | Value |
|---|---|
| File | `carrier-params-2026-10-17.param` |
| Saved | **2026-10-17** (Mission Planner → Config → Full Parameter List → Save to file) |
| Source | the owner's carrier parameter export `params.param`, delivered with *VTOL Manual: Changes Needed to Match Carrier Params* (2026-10-17) |
| Aircraft | Heewing T2 Cruza relay carrier, ArduPlane QuadPlane |
| Parameters | 1663 |
| SHA-256 | `2eb324cc0bb2c85480272982df14b040188fae888674cb8f34b1330893d9e460` |

The file is a **byte-exact copy** of the export (Windows CRLF line endings kept: `.gitattributes` stores
`docs/reference/*.param` with `-text`). Do not edit it by hand.

It is the project's **reference baseline** (plan §15, contract C1.6):

- `data/params-reference.js` (global `VtolParamsRef`) is generated from it. Every page uses it offline:
  - the manual's **Reference ▾ Parameters** tab (all parameters, searchable, grouped by prefix);
  - the Tools **PARAMS** tab (expected values for the safety-relevant subset, and the "Use reference" baseline);
  - the map's simulation speeds (`AIRSPEED_MIN`, `AIRSPEED_CRUISE`).
- An imported `.param` file (Tools → PARAMS, `store.paramFile`) takes precedence over this reference for display
  and analysis, and is compared against it.

## How to update

1. Export the new parameter list from Mission Planner.
2. Replace the file here: delete the old `carrier-params-*.param` and add the new export, **byte for byte**, named
   `carrier-params-YYYY-MM-DD.param` with the date it was saved (bump the date). Exactly one such file must exist.
3. Update the date, parameter count and SHA-256 in the table above (`sha256sum carrier-params-*.param`).
4. Regenerate and check:
   ```
   node scripts/gen-params-reference.mjs
   node scripts/gen-precache.mjs
   node --test test/
   ```
   `node scripts/gen-params-reference.mjs --check` fails while `data/params-reference.js` is stale.
5. Review the differences: the Tools PARAMS tab (import the old file to compare), and every value the manual, the
   checklists, the emergency cards, the diagrams and the map rely on (plan §15). `test/params/reference.test.js`
   pins the safety-relevant values, so a changed failsafe or battery value fails the tests until the content is
   updated to match.
