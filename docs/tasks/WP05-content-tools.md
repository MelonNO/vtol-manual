# WP05 — Shared content data, Tools content for the new relay, client profiles UI, Link tab

- **Worktree:** `S\wt\WP05`
- **Branch:** `wp/05`
- **Wave:** 2
- **Starts after:** WP01 and WP02 are merged (you get `js/store.js`, `js/common.js`, `js/version.js`, `js/tools-core.js` and `js/gcs-client.js`)

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (you **own C5**; you consume C1, C2 and C4), the WP01 and WP02 implementation reports in `docs/tasks/reports/`, and plan §1.1, §4, §6.1.5, §6.1.6, §6.1.8, §6.2, §3.3, §13.2, §13.3, §14.2, §14.7.

## Goal

Create one shared source for all operational content (checklists, emergencies, failsafe table, network table, callouts), written for the **new relay** and the **owner's failsafe intent**. Render the Tools page from it. Add client/pack/link profile management and the live **Link** tab.

## Files you own

- new: `data/content.js`, `js/render-content.js`, `test/content/*.test.js`
- `index.html`
- `docs/tasks/reports/WP05-IMPLEMENTATION.md`

`manual.html` is **not** yours. WP06 will render its Emergency/failsafe/network sections from your data, so design the API for both pages.

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | `data/content.js` (global `VtolContent`, Node-exportable) per C5 contains: `checklists.preflight` (sections A–E per plan §6.2.1, renamed E → "CLIENT"), `checklists.turnaround`, `postflight` steps, `emergencies`, `failsafeTable` (plan §6.1.5 table), `network` (plan §3.3 table incl. TBD IPs), `callouts` (existing callouts updated + the new ones from §6.1.6/§6.1.9/§14.2), and `designIntent` (the §4 quote). Every item has a stable unique `id`. |
| R2 | MUST | Content accuracy:<br>- **Owner's failsafe intent** (§4): SIYI loss → RTL after 5 s in all modes; 915 MHz loss → no action (close-range backup); S-01a and S-02a/b/c covered where relevant.<br>- **Emergencies** per §6.1.8: SIYI/GCS link loss (primary), client RC loss, video loss (analog vs digital), relay PCB fault, GCS app/controller failure, carrier camera loss, transition failure, battery critical. Plus the "915 backup lost" **note** (not an emergency card) with its close-in case. Each has `immediate[]` (≤ 6 short phrases) and `cleanup[]`.<br>- No old relay terms in active content (Nomad relay, DBR4 receiver, "hold LEFT button", CVBS→HDMI, SIYI HDMI→IP, `192.168.144.25`, MPV RTSP, "re-bind").<br>- Every unknown number is a visible TBD (e.g. measured client failsafe time, final IPs). |
| R3 | MUST | Checklist items may use template tokens resolved from the active client profile and settings: `{client.name}`, `{client.vtx.freqMHz}`, `{client.vtx.band}{client.vtx.channel}`, `{client.elrs.band}`, `{client.failsafe.type}`, `{client.videoStandard}`, `{settings.battCrtVolt}`. Unknown/null → "TBD". Copy blocks per §6.2.1 include: the corrected failsafe parameter block, the Windows GStreamer viewer pipeline, the MP HUD pipeline (PAL and NTSC variants, plan §7.4, viewer port 5601 / MP port 5602 per C3), the carrier camera `.26` pipeline, and the `client-video.sdp` content. |
| R4 | MUST | `js/render-content.js` (global `VtolRender`, Node-exportable): **pure functions returning HTML strings** (escaped via `VtolCommon.escH` or an internal equivalent) for checklists, emergency cards (full and compact/modal), failsafe table, network table and callouts. The checklist interaction engine from WP01 (stable ids, `{checked, ts}`, expiry, session) must keep working, either reused or moved here; no behaviour regressions. |
| R5 | MUST | `index.html` renders its pre-flight, turnaround, post-flight and emergency modal (with quick-jump pills) from `VtolContent` and `VtolRender`. All old-relay references in `index.html` (plan §13.3 list) are gone. The header doc-id becomes "HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 (carrier) · ELRS <client band> (client) · SIYI HM30", using the active client. |
| R6 | MUST | **Profiles UI** (new Tools tab "Profiles", in the nav and in mobile swipe order): create/edit/delete/duplicate **clients**, **packs** and **links** (all C1 fields, with validation and units); select the active client and the active carrier pack; settings editor for the C1 `settings` thresholds. Uses `VtolStore.update`. Deleting a profile in use asks for confirmation. |
| R7 | MUST | **Link tab** (plan §6.2.3, §14.2), using `GcsClient` (C2):<br>- connection state; bridge state badge; RTT, loss, jitter; camera requested vs reported (mismatch highlighted); controller connected / arm-safe / throttle-low; video standard and decoder lock; client link (LQ, RSSI1/2, SNR, TX power), GPS (sats, alt, speed), battery (V, A, mAh, %), flight mode (raw + failsafe/armed/rescue-not-ready); active alarms list.<br>- An **audio cue** toggle (Web Audio beep, off by default) for crit alarms.<br>- "GCS APP NOT RUNNING" state with a one-line hint. No errors when the app is absent. |
| R8 | MUST | **Checklist automation** (plan §14.7): items may declare `auto: '<rule id>'`. When the GCS app is connected, the item shows a live `AUTO ✓` / `AUTO ✗` hint (e.g. bridge RUN, controller arm-safe, client rescue ready, client sats ≥ profile minSats, camera state matches the sortie plan). **The pilot still ticks manually.** Without the app the hint is hidden. |
| R9 | MUST | Content tests (`node --test test/`): schema (required fields, unique ids, `immediate` length), a forbidden-terms scan of all content strings, failsafe-intent assertions (SIYI card mentions 5 s RTL all modes; the 915 entry is a note, not an emergency), template resolution with a null client field → "TBD", and renderer escaping (an XSS string in a profile name renders escaped). |
| R10 | MUST | Keep the WP01 behaviour intact (store, expiry, swipe rules, CSP — extend the CSP only as needed and say so), mobile layout, and the existing style. |

## Acceptance (verifier)

- `node --test test/` passes.
- jsdom:
  - Tools loads without errors.
  - All checklists render from data, and ticking persists with a timestamp.
  - The emergency modal shows the new scenarios.
  - Editing the active client's VTX frequency updates the checklist text.
  - The Link tab shows "GCS APP NOT RUNNING" with fetch failing, and renders a full status when fed a C2 sample object (stub `GcsClient`).
- A forbidden-terms grep over `index.html`, `data/` and `js/` is clean.
