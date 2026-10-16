# WP01 — Implementation report

Branch `wp/01`, worktree `S\wt\WP01`. Base `5a2377e`.

## 1. Summary

- Added the shared modules from contracts C1/C4:
  - `js/version.js` (`VTOL_VERSION`)
  - `js/common.js` (`VtolCommon`: `escH`, `fmtTime`, `fmtDuration`, `toggleCleanup`, `copyToClipboard`)
  - `js/store.js` (`VtolStore`: versioned store, default profiles, legacy migration, tombstones, merge-by-id import)
- Moved all pure Tools logic into `js/tools-core.js` (`ToolsCore`): battery maths and recommendation, health/level classification, `.tlog` and `.bin` parsers, weather helpers, sun times (vendored SunCalc subset), checklist session/expiry logic.
- `index.html` now uses these modules for everything. Every persistent Tools record (battery log, preflight archive, weather favourites, packs, settings) goes through `VtolStore`. EXPORT/IMPORT/LINK FILE handle the whole store, and import merges by id.
- Gist sync is removed completely (UI, functions, PAT prompt, `vtol_gh_*` and `vtol_last_sync` keys).
- Fixed IDX-01…IDX-19 (S-05, S-06):
  - BATT_LOW margin is measured to `BATT_CRT_VOLT`
  - pack-profile thresholds
  - checklists have stable ids, per-item timestamps and 6 h expiry
  - escaping and a CSP
  - swipe guard
  - weather hour index
  - cached weather only on network failure
  - signed MAVLink 2 / armed time / local date
  - `.bin` labels, leap seconds and `Inst` filter
  - `binChart` zero-duration guard
- Added wind at relay altitude (80/120/180 m) and configurable wind limits.
- 57 Node tests in `test/tools/`, all passing. A jsdom smoke test of `index.html` passes with no script errors.

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `js/version.js`; `js/common.js:9-62`; `index.html:550-551` (`escH`, `toggleCleanup` from `VtolCommon`), `index.html:787` (`copyVal` → `VtolCommon.copyToClipboard`) | If the Clipboard API rejects, the code falls back to `execCommand('copy')`. If that also fails, the text is selected for a manual copy and a tooltip says so (IDX-13). |
| R2 | DONE | `js/store.js` (API at the end of the file: `load/save/update/uid/defaults/exportJSON/importJSON/KEY`) | Shape, defaults, legacy migration (legacy keys are removed only after a successful save), Gist key deletion, 30-day tombstones, merge by id. Tested in `test/tools/store.test.js` (13 tests). |
| R3 | DONE | `index.html:1047-1146` (data file), `:905-921` (battery), `:1195-1233` (archive), `:1247-1296` (favourites) | Export, import and the linked file all use `VtolStore.exportJSON()` / `importJSON()`. Import merges by id and keeps local records that are missing from the file. The linked file is merged in at start/link time and then rewritten on every `vtol-store-changed`. |
| R4 | DONE | `grep -i "gist\|vtol_gh" index.html js/` → only `js/store.js:15,165` (cleanup) | The SETUP SYNC / SYNC NOW buttons, all `vtolGist*`/`vtolCloud*` functions and the PAT `prompt()` are gone. The keys are deleted on every `load()`. |
| R5 | DONE | `js/tools-core.js:33-105`; `index.html:830-1004`, HTML `:457-479` | A pack selector replaces the cells/chemistry selects. Every new entry stores `packId`. Values now taken from pack and settings: RTL line, storage row (`storageVoltPerCell × cells`), colouring (`hardLimitVolt`/`manualRtlVolt`), `.tlog` window (`voltRange`: cells × chemistry). |
| R6 | DONE | `js/tools-core.js:69-85`; `index.html:955-970` | Margin = rec − `settings.battCrtVolt`, and the text says "x V above BATT_CRT_VOLT (22.2 V)". The chemistry floor is shown on a separate line. The 23.0 V floor comes from `settings.manualRtlVolt`. Non-carrier packs show a "not shown for this pack" card and no recommendation. A BATT_CRT input is added (`#set-crt`). |
| R7 | DONE | `js/tools-core.js:466-512`; `index.html:660-828`, `:1150-1154` | State is `{session:{id,startedAt}, items:{id:{checked,ts}}}` in `vtol_cl_preflight` / `vtol_cl_turnaround`. Expiry on load (and when the tab becomes visible again) shows "Checklist from DD Mon HH:MM expired — reset (older than 6 h)". Each checked row and its detail pane show "checked HH:MM". START TIMER offers a fresh session. All 43 CL/CL2 items have stable ids with unchanged texts. `vtol_cl2`/`vtol_cl3` are migrated once and then deleted (see §5.2). |
| R8 | DONE | `js/tools-core.js:340-351`; `index.html:1656` | Floors to the hour, otherwise falls back to the last hour ≤ now. Tested with `…T18:15` (`weather.test.js`). |
| R9 | DONE | (deleted code) | `parseTlogFull`, `renderTlogResult`, `_tlogMsg`, `tlogChart`, `_tlogCard`, `mavlinkExtractAll` and the old `mavlinkExtractBattery` are removed. `rf32le` was no longer used, so it is removed too. |
| R10 | DONE | `index.html:6` (CSP); escaping at `:939` (battery rows), `:1219-1224` (archive), `:1284-1291` (favourites), `:1508` (.bin filename), `:1552` (MSG text), `:1780` (Nominatim name), `:1075-1077` (file names), `:1628`, `:1641-1646` (errors/cache) | Escaped: battery date/flight/notes/values, archive fields, favourite names (ids passed via `data-id`, never inside `onclick` strings), `.bin` filename and MSG text, Nominatim name, error messages, file handle names. CSP allows only self, inline script/style, Google Fonts, Open-Meteo, Nominatim, `http://localhost:20199`, `http://127.0.0.1:47800`. Checked in jsdom (no errors). Not yet checked in a real browser. |
| R11 | DONE | `index.html:1833-1864` | Swipes are ignored when the modal is open, or when the touch starts in a horizontally scrollable ancestor (`scrollWidth > clientWidth` and `overflow-x: auto/scroll`) or in a form control. |
| R12 | DONE | `index.html:934-941` | The table is built once. |
| R13 | DONE | `js/tools-core.js:108-193` | Parses one record at a time (8-byte timestamp + frame) and resyncs on garbage. The v2 signed flag adds 13 bytes. Truncated v2 payloads are zero-extended. Duration is armed time from the vehicle HEARTBEAT `base_mode & 0x80` (GCS/invalid-autopilot heartbeats are ignored), else first→last timestamp. The date is local. Tested in `tlog.test.js` (7 tests). |
| R14 | DONE | `js/tools-core.js:196-204`, `:270`; `index.html:1428-1430`, `:1455`, `:1518-1519` | Labels say "ALTITUDE RELATIVE TO HOME … not height above terrain" / "ALTITUDE REL. HOME" / "EKF, relative to home — not AGL". `GPS_UTC_LEAP_SECONDS = 18` is a named constant with a comment. BAT records are kept only when `Inst` is absent or 0. Tested in `bin.test.js`. |
| R15 | DONE | `js/tools-core.js:406-464` | Vendored SunCalc subset with its licence header (BSD-2-Clause, see §5.1). Times are shown in the location's time zone using Open-Meteo `utc_offset_seconds` (`index.html:1670-1678`). Tested against USNO for 60.0 N 10.8 E and 37.8 N 122.4 W, summer and winter solstice, ±2 min (`sun.test.js`), plus polar day and polar night. |
| R16 | DONE | `index.html:1600-1648` | The cache is used only when `fetch()` rejects (network failure). HTTP errors and code errors show the error. The cache banner shows the location name, coordinates, age and time. A second red banner appears if the cached point is more than 1 km from the requested point. |
| R17 | DONE | `js/tools-core.js:330-336`; `index.html:1381` | `chartXFractions` spreads points by index when all timestamps are equal. Tested. |
| R18 | DONE (fallback clause) | `index.html:453`, `:1298-1301`, `:1319` | The UI says the MP endpoint is unverified. C2 has no carrier voltage, so there is a TODO(WP08a) comment and no GCS-app button. |
| R19 | DONE | `index.html:1612` (URL), `:1743-1754`, `:1808-1814`; `js/tools-core.js:362-397`; settings `js/store.js:91-93` | Shows a 10 m / 80 / 120 / 180 m table (speed, direction, status against the limits; no gusts aloft). The limits are editable in `settings` (`windGoMaxMs` 5, `windCautionMaxMs` 8, `gustMaxMs` 10) via three inputs on the Weather tab. The intro text is built from these settings. |
| R20 | DONE | `js/tools-core.js`; `test/tools/*.test.js` | Every exported `ToolsCore` function is covered by tests (battery, tlog, bin, weather, sun, checklist). |
| R21 | DONE | `index.html:199`, `:542`, `:552-553` | Header meta and footer show `VTOL_VERSION.app` and `.content`. |
| R22 | DONE | `index.html:605`, `:197` | "all 3 motors (M1/M2 tilt, M4 tail)"; "RTL ALT 120m REL (above home)". |
| R23 | DONE | CSS `index.html:160-165`; new inputs use `.cfg-row` (wrap, min-width 130 px), `.cfg-input` (min-height 44 px); wind table `min-width:340px` inside `overflow-x:auto` | At 360 px the threshold inputs wrap two per row. Notices are block alerts. The fixed bottom nav is unchanged. |

## 3. Placeholders

- **Storage target for non-LiPo packs** (`index.html` battery analysis): `TBD — storage voltage for <chem> not set (the storage setting is a LiPo value)`, amber `.warn-val`. `settings.storageVoltPerCell` (3.80) is a LiPo figure, and the sources give no Li-Ion/LiFe storage voltage.
- `VTOL_VERSION.paramFile = 'TBD'`, as set by contract C4.
- Default link profiles keep `null` (= TBD) values exactly as C1 specifies.

## 4. Tests

Added in `test/tools/`:
- `store.test.js` (13): defaults vs C1, migration, failed-save safety, Gist keys, corrupt store, tombstones and expiry, merge rules, legacy import, round trip, settings merge, uid
- `common.test.js` (6)
- `battery.test.js` (8): S-05 margin, settings, non-carrier, levels, thresholds, LiFe TBD
- `tlog.test.js` (7): synthetic v1/v2/signed/truncated frames, armed time, GCS heartbeat ignored, battery id, pack window, resync
- `bin.test.js` (4): synthetic FMT+BAT/GPS/POS/MSG/MODE, `Inst` filter, leap seconds, zero-span chart
- `weather.test.js` (6): 15-min `current.time`, fallbacks, limits, winds aloft, precip/icing
- `sun.test.js` (7): USNO reference values
- `checklist.test.js` (6): ids, ts, session, expiry with a faked old timestamp, legacy migration

`test/index.js` is the entry point for `node --test test/`. In Node 24 a directory argument resolves to `test/index.js`. The file is byte-identical to WP02's `test/index.js` (same blob `47892fc`), so the two branches merge cleanly.

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 57  ℹ pass 57  ℹ fail 0
```

jsdom smoke test (outside the repo): `S\wp01smoke\smoke.js`. It inlines `js/*.js`, because jsdom gives `file://` an opaque origin with no localStorage, and loads the page at `https://melonno.github.io/vtol-manual/index.html`. Result: **no script errors**. Checked:
- legacy migration (all legacy keys and `vtol_gh_*` gone; `vtol_cl2`/`vtol_cl3` → stable ids)
- XSS strings in battery notes/flight, archive notes and favourite names render as text
- carrier recommendation text "x V above BATT_CRT_VOLT (22.2 V)"
- tick shows "checked HH:MM"; an 8 h-old state is reset with the notice
- weather render with a 15-min `current.time` and the relay-wind rows; network failure → labelled cache plus different-location warning; HTTP 500 → error
- swipe ignored while the modal is open
- clean-up toggle, copy fallback, EXPAND ALL, START TIMER fresh session

`html-validate` (index.html) against main: `no-inline-style` 70 → 72, `no-implicit-button-type` 43 → 41, `prefer-tbody` 1 → 1. These are only the pre-existing rule classes; the page already uses inline styles throughout.

## 5. Deviations / contract issues

1. **SunCalc licence:** SunCalc is **BSD-2-Clause**, not MIT as the brief's example says. The full BSD-2 header is kept in `js/tools-core.js`.
2. **Legacy checklist migration (R7):** the old `vtol_cl2`/`vtol_cl3` ticks carry no time.
   - They are migrated to stable ids with `ts: null`, in a session stamped at migration time and marked `migrated`.
   - A visible amber notice says the ticks were carried over with unknown times and must be re-verified or RESET. Rows show "checked — time unknown".
   - The migrated ticks then expire after 6 h like any other.
   - I chose this over silently resetting (which loses data) and over stamping them "now" without a notice (which hides S-06).
3. **C1 extensions (additive):**
   - `settings.windGoMaxMs` / `windCautionMaxMs` / `gustMaxMs` (R19 asks for limits in `settings`).
   - `settings.updatedAt`, set when the user edits a setting. Settings have no id, so the merge needs a time: incoming settings win when edited more recently (a file without the stamp counts as of its own `updatedAt`).
   - Extra helpers: `VtolStore.live/find/upsert/remove/mergeStores/IDS/SCHEMA_VERSION`, `importJSON.lastStats`, and `_setStorage` (tests only).
   - `save()` returns a boolean.
   - The PM may want to add these to `02-CONTRACTS.md`.
4. **Tombstone rule:** import never deletes a local record just because the file lacks it. A tombstone from the file wins only if it is newer than the local record's `updatedAt`, which is the purpose of C1's tombstones. Tombstones older than 30 days are purged on `load()`.
5. **Default client `sizeIn: 7`:** from the manual ("7"+ FPV quad"); C1 does not list this field's value.
6. **`sw.js` (file not in my list) — minimal change:** bumped `CACHE` to v11, precached the four `js/*.js` files, and serve same-origin `.js` network-first like HTML. Without this, the old cache-first rule would keep serving stale `tools-core.js`/`store.js` next to a newer `index.html` after any later deploy, which breaks the page. WP09 owns the full SW work.
7. **Battery-log view selection** is kept in `localStorage['vtol_bl_pack']` (a UI convenience like `vtol_active_tab`). Choosing a carrier pack also sets `settings.activeCarrierPackId`. The log and analysis are filtered to the selected pack.
8. **No pack-editing UI.** Packs come from the defaults (and from migration of `vtol_batt_type`). Before, the cell/chemistry selects let users analyse e.g. a 4S pack; now that needs a pack profile. Profile editing is WP05 scope, so WP05/WP11 should add pack editing.
9. **Content left for WP05:** the checklist note "Rear pair: fixed lift motor props" (B / props item) still describes 4 motors, and the emergency text still says "120m AGL". The brief limited R22 to the two listed strings.
10. **Wind compass SVG:** the circle used `c+'22'` hex-alpha concatenation. The status colours are now CSS variables, so this became `fill-opacity`/`stroke-opacity`, with the same look.

## 6. Notes for the verifier

- **Tests:** run `node --test test/`. For the smoke test, run `node S\wp01smoke\smoke.js`, or reuse its `inlined()` loader: `js/*.js` must be inlined because jsdom has no localStorage on `file://`.
- **Migration:** put `vtol_battlog`, `vtol_pf_archive`, `vtol_wx_fav`, `vtol_batt_type`, `vtol_cl2`, `vtol_gh_pat` in localStorage before load. After load, only `vtol_store`, `vtol_cl_preflight` and `vtol_cl_turnaround` remain, and the migration notice shows above the Pre-Flight list.
- **Expiry:** set `vtol_cl_preflight` to `{"session":{"id":"s","startedAt":"<8 h ago>"},"items":{"site-airspace":{"checked":true,"ts":"<8 h ago>"}}}` and reload. Expect the notice "Checklist from … expired — reset" and 0 ticks.
- **Battery:** the Battery Log tab shows the PACK selector and the carrier threshold inputs. The recommendation reads "… V above BATT_CRT_VOLT (22.2V)". Selecting "Mast 6S 3000" removes the recommendation.
- **Weather:** stub `fetch`. A rejected promise gives the cached view with location and age; `{ok:false}` gives the error. With data, the "WIND AT RELAY ALTITUDE" table appears.
- **Gist check:** `grep -rin "gist\|vtol_gh" index.html js/` only matches `js/store.js` cleanup and the word "re**gist**er" in the service-worker registration line.
