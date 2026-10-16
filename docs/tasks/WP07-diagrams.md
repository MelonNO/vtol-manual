# WP07 — Diagrams and graphics

- **Worktree:** `S\wt\WP07`
- **Branch:** `wp/07`
- **Wave:** 4
- **Starts after:** WP06 and WP11 are merged

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md`, the WP06 report (diagram slots), plan §9.2, §9.3 (D1–D15 and the Mermaid drafts), §3, §6.1, and the relay design.

## Goal

Replace the obsolete graphics, fix the existing ones (legibility, tokens, accessibility), and draw the 15 new diagrams. All diagrams must be accurate to the plan and the relay design, readable on a phone, and work offline.

## Files you own

- new: `img/diagrams/*.svg`, `js/diagrams.js` (global `VtolDiagrams`, Node-exportable)
- `manual.html` — only the diagram slots and existing inline SVG blocks
- `index.html` — only the chart/SVG generator functions: `battTrendSVG`, `battSparkline`, `windCompassSVG`, `binChart`, or wherever WP01/WP11 moved them
- `test/diagrams/*.test.js`
- `docs/tasks/reports/WP07-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **D1–D15** as standalone SVG files in `img/diagrams/` (`d01-system-overview.svg` …). Each has `role="img"`, `<title>`, `<desc>`, and the project palette hex values with a comment mapping them to the CSS tokens. Readability rule: text ≥ 11 CSS px when the diagram is shown at 360 px viewport width, **or** the diagram sits in a horizontally scrollable wrapper whose min-width guarantees that. Content must match plan §9.3 (D2 with KSZ8795 P1–P5 and the VLAN map; D5 the bridge state machine; D6 the client failsafe chain with TBD times; D7 the carrier failsafe matrix per §4; D8/D8b the bandwidth/camera logic). |
| R2 | MUST | Insert every diagram into its `diagram-slot` in `manual.html` (lazy-loaded `<img>` or inline where theming matters), with a caption. Each slot WP06 created must be filled. |
| R3 | MUST | **§9.2 existing diagrams:** remove hard-coded colours (use CSS variables for inline SVG); minimum text size per R1; a11y attributes; repeated quad icons → `<symbol>`/`<use>`. Specific fixes:<br>- motor diagram: CW/CCW arrows plus a tilt side-view inset<br>- mission profile: altitude scale (REL m from the 7-WP template ranges), distances, transition corridor, back-transition glide, abort branch<br>- RF LOS side view: Fresnel ellipse and two links<br>- orbit top view: new labels, patch beam cones (~70°), always-covered inner zone, body-shadow note<br>- GPS Rescue diagram: parameterised from the active client profile when it is the reference client |
| R4 | MUST | **Battery gauge generated from the pack profile** (`VtolDiagrams.batteryGauge(pack, settings)` → SVG string) with markers BATT_LOW (if set), manual RTL, hard limit, BATT_CRT, storage. Used in the manual Aircraft tab (carrier pack) and available to the Tools page. Fixes MAN-14. |
| R5 | MUST | **Tools charts (§9.2):** battery trend and sparkline use profile thresholds and have y-axis ticks and a date tooltip (`<title>`); the wind compass adds a "land into wind" hint and a gust-spread arc; the `.bin` charts overlay the mode timeline and mark transition/failsafe MSG events. Pure generators in `js/diagrams.js` where practical. |
| R6 | MUST | Tests: each generator returns well-formed SVG (parse with a minimal XML well-formedness check written in the test, since no npm deps are allowed), contains `<title>`, and has no hex colours in the generated inline SVG (the CSS-variable rule). Every `img/diagrams/*.svg` is well-formed and ≤ 60 KB. |

## Acceptance (verifier)

- Tests pass.
- Open every SVG and check its content against the plan and the relay design: port numbers, states, failsafe intent.
- jsdom: the manual has no empty diagram slots.
- Mobile readability rule spot-checked on 3 diagrams.
