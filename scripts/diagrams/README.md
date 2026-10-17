# scripts/diagrams — diagram generator

This folder generates the manual's diagrams. It needs only plain Node.js (18 or newer) and no npm packages.

| Output | Source |
|---|---|
| `img/diagrams/d01…d15*.svg` (16 standalone SVG files, D1–D15 + D8b) | `d1-3.js`, `d4-8.js`, `d9-15.js` (one function per diagram), drawn with the helpers in `lib.js` |
| `manual.html` diagram slots (`<div class="diagram-slot" data-diagram="Dx">`: image, width/height, alt text, caption) | `slots.js` |
| `manual.html` inline SVGs (motors, mission profile, line of sight / Fresnel, orbit) | `inline.js` |

The battery gauge, the GPS Rescue trajectory and the Tools charts are **not** generated here. The pages draw them at run time with `js/diagrams.js`.

## Regenerate

From the repository root:

```
node scripts/diagrams/build.js            # write img/diagrams/*.svg and update manual.html
node scripts/diagrams/build.js --check    # compare only; exit 1 and list the differences if anything is out of date
```

- **Byte-for-byte:** the output is deterministic, and `--check` compares byte-for-byte (CRLF and LF are treated alike, because Windows checkouts may convert line endings).
- **Test:** `node --test test/` runs the same comparison in `test/diagrams/regenerate.test.js`. A hand edit to a generated SVG, or to a slot or inline SVG in `manual.html`, therefore fails the tests until the generator matches it.
- **Layout warnings:** `lib.js` estimates text width (monospace, 0.6 em) and prints `layout warning: …` for text that would overflow its box or is smaller than 14 units. Fix those before committing.

## Editing a diagram

1. **Change the definition.** Each entry in `d*.js` returns `{ h, heading, sub, title, desc, source, body }`:
   - `title`, `desc` and `source` become `<title>`, `<desc>` and the `<!-- Sources: … -->` comment.
   - `desc` is the full text version of the diagram. Keep it in step with the drawing.
2. **Keep the rules in `img/README.md` → Diagrams:**
   - palette hex values only (see `lib.js` `P`)
   - text ≥ 14 units in the 400-unit viewBox
   - ≤ 60 KB per file
   - unknown values as **TBD**, values to confirm as **VERIFY**, never invented numbers
3. **Rebuild and test:** run `node scripts/diagrams/build.js`, then `node --test test/`. `test/diagrams/files.test.js` also checks each diagram's content against the plan and the relay design.
4. **Check visually:** open the SVG in a browser at 400 px width.
5. **Slot captions and alt texts** are in `slots.js`. **Inline SVGs** are in `inline.js`, which finds them in `manual.html` by their `aria-labelledby` ids.
