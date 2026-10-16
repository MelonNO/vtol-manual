# WP01 — Tools page core: bugs, data store, shared helpers

- **Worktree:** `S\wt\WP01`
- **Branch:** `wp/01`
- **Wave:** 1 (runs in parallel with WP02, WP03, WP04)

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md` (you **own C1 and C4**), and plan sections §5.1, §4 (S-05, S-06), §10.3, §10.5, §10.7, §12 Q11.

## Goal

Fix every code defect in `index.html` and move its logic onto a tested shared core. Introduce the shared data store with profiles that later WPs build on. Remove Gist sync. **Do not** rewrite the operational *content* — checklist texts, emergency texts, relay chain wording. That belongs to WP05. Leave the existing CL/CL2/emergency content as is, except where an item below says otherwise.

## Files you own

- `index.html`
- new: `js/store.js`, `js/common.js`, `js/version.js`, `js/tools-core.js`
- new: `test/tools/*.test.js`, `test/fixtures/` (small sample logs only, ≤ 200 KB total)
- `docs/tasks/reports/WP01-IMPLEMENTATION.md`

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | Create `js/version.js` and `js/common.js` per C4. `index.html` uses `VtolCommon.escH`, `toggleCleanup` and `copyToClipboard` (with a fallback when the Clipboard API fails — IDX-13). |
| R2 | MUST | Create `js/store.js` per C1 exactly: API, shape, defaults, legacy migration, tombstones, merge-by-id import. Unit-tested in Node. |
| R3 | MUST | All persistent Tools data goes through `VtolStore`: battery log, preflight archive, weather favourites, battery type → packs. EXPORT/IMPORT/LINK FILE export and import the **whole store** (IDX-04). Import **merges** by id and never deletes local records (IDX-03 class of bug). |
| R4 | MUST | **Remove Gist sync** completely: UI buttons, functions, the PAT prompt, and the `vtol_gh_*` keys (deleted on migration). Plan Q11. |
| R5 | MUST | Battery analysis uses **pack profiles** and `settings` thresholds instead of hard-coded 6S numbers (IDX-08). Covers: the 23.0 V RTL line, the 22.8 V storage row (from `storageVoltPerCell × cells`), the 22.5/23.0 colouring, and the .tlog voltage filter (derived from cells × chemistry limits). A pack selector replaces the cells/chemistry selects (each pack has cells and chemistry), and each log entry stores `packId`. |
| R6 | MUST | **S-05 / IDX-01:** the recommended-BATT_LOW margin is computed against `settings.battCrtVolt` (default 22.2), and the text says so. Show the chemistry floor separately. The 23.0 V floor comes from `settings.manualRtlVolt`. Carrier thresholds apply only to packs with `role: 'carrier'`. For other roles, show per-chemistry analysis without the ArduPilot recommendation. |
| R7 | MUST | **S-06 / IDX-02:** checklist state stores `{checked, ts}` per item, keyed by a **stable item id**, plus a session `{id, startedAt}`. State older than `settings.checklistExpiryHours` (6) is auto-reset on load, with a visible notice "Checklist from <time> expired — reset". Each checked item's detail shows "checked HH:MM". Starting the preflight timer offers to start a fresh session. Add stable `id`s to the existing CL/CL2 items (IDX-14); keep the texts unchanged. New storage keys: `vtol_cl_preflight` and `vtol_cl_turnaround`. Migrate the old `vtol_cl2`/`vtol_cl3` once, then delete them. |
| R8 | MUST | **IDX-05:** find the weather hourly index for "now" by matching the hour (floor the current time to the hour), not exact string equality. Unit-test with a 15-minute-aligned `current.time`. |
| R9 | MUST | **IDX-06:** delete the dead `parseTlogFull`/`renderTlogResult`/`_tlogMsg`/`tlogChart`/`_tlogCard`/`mavlinkExtractAll` code. Keep `rf32le` only if still used, and rename the comment. |
| R10 | MUST | **IDX-07:** every dynamic string inserted via `innerHTML` is escaped: battery notes/flight, archive notes, favourite names, `.bin` MSG text, filenames, Nominatim names. Add a CSP `<meta http-equiv="Content-Security-Policy">` that allows only what the page uses: self, inline styles/scripts (the page uses them), Google Fonts until WP09 self-hosts them, Open-Meteo, Nominatim, `http://localhost:20199` (MP), `http://127.0.0.1:47800` (GCS app, C2). Verify that nothing breaks. |
| R11 | MUST | **IDX-09:** swipe navigation ignores gestures while the emergency modal is open, and gestures that start inside a horizontally scrollable element. |
| R12 | MUST | **IDX-10:** build the battery table once. |
| R13 | MUST | **IDX-11:** the .tlog parser handles MAVLink 2 signed frames (incompat flag 0x01 → +13 bytes), uses the local date, and computes duration from **armed time** (HEARTBEAT `base_mode` bit 0x80) when available, else the first/last timestamp. Unit-tested with synthetic frames. |
| R14 | MUST | **IDX-12:** `.bin` labels say "relative to home" (not "true AGL"); GPS week→UTC subtracts leap seconds (18 s, as a named constant with a comment); `BAT` records are filtered on the first instance (`Inst` = 0 when present). |
| R15 | MUST | **IDX-15:** replace the sun-time routine with a correct implementation (e.g. a vendored, MIT-licensed SunCalc subset with its licence header). It must produce correct local times for 60.0 N 10.8 E and for 37.8 N −122.4 W on a fixed date. Unit-tested against known values (cite the reference used in the test comment). |
| R16 | MUST | **IDX-16:** cached weather is shown only on network failures, labelled with its location and age; other errors show the error. |
| R17 | MUST | **IDX-18:** guard the `binChart` zero-duration case (the token prompt is gone with R4). |
| R18 | SHOULD | **IDX-19:** keep the MP voltage button, but say in the UI text that the endpoint is unverified. When the GCS app is reachable (C2 `/api/v1/health`), offer "from GCS app" as the source. If C2 has no carrier voltage, leave it as a TODO comment referencing WP08a. Do not block on this. |
| R19 | MUST | **§10.5 weather:** add **wind at relay altitude**: Open-Meteo `wind_speed_80m`, `wind_speed_120m`, `wind_speed_180m` (+ direction), shown as a small table. Make the GO/CAUTION/NO-GO wind limits configurable in `settings` (defaults = current values 5 / 8 / gust 10 m/s). |
| R20 | MUST | Move pure logic into `js/tools-core.js` (global `ToolsCore`): battery maths and recommendation, health classification, tlog parser, bin parser, weather index helper, wind/precip/icing classification, sun times. `index.html` calls it. **Node tests** in `test/tools/` cover each function (`node --test test/`). |
| R21 | MUST | Header/footer show `VTOL_VERSION.app` and `.content`. |
| R22 | MUST | Fix the IDX-17 **content** strings that are pure facts, not relay content: "all 4 motors" → "all 3 motors (M1/M2 tilt, M4 tail)"; header meta "RTL ALT 120m AGL" → "RTL ALT 120m REL (above home)". |
| R23 | MUST | Mobile layout (≤ 600 px) keeps working with any new controls (pack selector, wind table, notices). |

## Out of scope

- New checklist/emergency content for the new relay, the Link tab and client-profile editing UI: **WP05**. You only create the store and the default profiles.
- PWA/service worker: WP09.

## Acceptance tests (the verifier will run these)

- `node --test test/` passes, with meaningful tests for every function moved into `ToolsCore`, `VtolStore` migration/merge, and the checklist-expiry logic.
- jsdom load of `index.html`: no errors.
  - Old-format localStorage (`vtol_battlog`, `vtol_pf_archive`, `vtol_wx_fav`, `vtol_cl2`, `vtol_gh_pat`) migrates correctly, and the gh keys are gone.
  - Checklist expiry works with a faked old timestamp.
  - An XSS string in battery notes renders as text.
- No Gist/PAT code remains (`grep -i "gist\|vtol_gh"` → only migration cleanup).
