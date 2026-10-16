# WP01 verification — round 1
VERDICT: REJECTED

Verifier: independent verification agent. Worktree `S\wt\WP01`, branch `wp/01`, HEAD `208dcc6`, base `5a2377e` (= `git merge-base main HEAD`). Diff: `git diff 5a2377e...HEAD`. A trial merge into the current `main` (which has WP04 in it) is clean (`git merge-tree`).

## Scope

| File | In "Files you own"? | Judgement |
|---|---|---|
| `index.html` | yes | — |
| `js/version.js`, `js/common.js`, `js/store.js`, `js/tools-core.js` | yes (new) | — |
| `test/tools/*.test.js` (8 files) | yes | — |
| `docs/tasks/reports/WP01-IMPLEMENTATION.md` | yes | — |
| `sw.js` | **no** | **Justified and minimal.** 11 lines: cache bumped to v11, the 4 new `js/*.js` files precached, same-origin `.js` served network-first like HTML. Without this, the existing cache-first rule would serve a stale `tools-core.js`/`store.js` next to a newer `index.html` and break the page. This is the smallest change that keeps the page working. WP09 still owns the SW. |
| `test/index.js` | **no** | **Justified.** I checked it: with the file removed, `node --test test/` fails in Node 24.20 (the directory is resolved as a module), and `node --test "test/**/*.test.js"` runs the same 57 tests. The blob (`47892fc`) is byte-identical to WP02's `test/index.js`. |

No unjustified files.

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `js/version.js:4`; `js/common.js:17-74`; `index.html:549-550` (escH, toggleCleanup), `:787-799` (copyVal → `VtolCommon.copyToClipboard`) | Fallback chain: Clipboard API → `execCommand` → select the text plus a tooltip. Smoke test: the fallback selects the text. |
| R2 | **FAIL (partial)** | `js/store.js` | API, shape, defaults, legacy migration, tombstones and merge by id all match C1. But the settings merge (`store.js:246-250`) overwrites edited local settings — see Finding 1. |
| R3 | **FAIL (partial)** | `index.html:1047-1141`, `:905-921`, `:1195-1233`, `:1247-1293` | Everything goes through VtolStore, and export/import/link file cover the whole store. Records are never deleted because they are missing from the file (verified). However, importing a file **silently replaces locally edited settings** (BATT_CRT_VOLT and the other thresholds) with the other device's defaults. That is the IDX-03 class of bug this requirement exists to prevent (Finding 1). |
| R4 | PASS | `grep -rin "gist\|vtol_gh" index.html js/` → only `js/store.js:15,166` (cleanup). The SunCalc github URL is in a comment. | Buttons, functions and the PAT prompt are gone (smoke: `vtolSetupSync`/`vtolSyncNow` are undefined, the `.vtol-sync-*` elements are absent). `vtol_gh_pat`, `vtol_gh_gist_id` and `vtol_last_sync` are deleted on every `load()`. |
| R5 | PASS | `js/tools-core.js:37-53, 88-95`; `index.html:830-994`, HTML `:457-478` | RTL line, storage row (3.80 × 6 = 22.8, verified), 22.5/23.0 colouring and the `.tlog`/`.bin` window (`voltRange`) all come from the pack and `settings`. A pack selector replaces the cells/chem selects. Each entry stores `packId`. |
| R6 | PASS | `js/tools-core.js:69-82`; `index.html:955-968` | Smoke: avg landing 22.1 V → 23.0 V, "0.8V above BATT_CRT_VOLT (22.2V)". Changing BATT_CRT to 22.6 gives 0.4 V. The RTL floor follows `manualRtlVolt`. The chemistry floor (18.6 V) is on its own line. The mast pack gets "Not shown for this pack" and no recommendation. A non-positive margin turns red and shows a danger alert. |
| R7 | PASS | `js/tools-core.js:466-510`; `index.html:660-827`, `:1150-1154` | `{session:{id,startedAt}, items:{id:{checked,ts}}}` in `vtol_cl_preflight`/`vtol_cl_turnaround`. 8 h-old state is reset with the notice "Checklist from 16 Oct 12:56 expired — reset (older than 6 h)". 5 h-old state is kept. Ticks show "checked HH:MM" in the row and in the detail. START TIMER offers a fresh session. 43 items have unique stable ids, and the texts equal `main` except the R22 string (verified by script). `vtol_cl2`/`vtol_cl3` are migrated (A-0 → site-airspace, B-3 → build-props, T1-1 → ta-battery-swap) and then deleted. |
| R8 | PASS | `js/tools-core.js:340-348`; `index.html:1656`; `test/tools/weather.test.js:10` | Smoke: `current.time` …T14:15 → hour 14:00. The icing table, the winds aloft and the 4-h forecast all use index 14. |
| R9 | PASS | grep finds no `parseTlogFull`, `renderTlogResult`, `_tlogMsg`, `tlogChart`, `_tlogCard`, `mavlinkExtract*` or `rf32le` | — |
| R10 | **FAIL (partial)** | CSP `index.html:6`; escaping at `:939`, `:1216-1223`, `:1284-1290`, `:1508`, `:1552`, `:1780`, `:1075-1077`, `:1628-1646` | The listed vectors are escaped (smoke: battery notes and flight, archive notes, favourite names, Nominatim name, attribute-breaking payloads all render as text; the XSS counter stays at 0). The CSP is correct and complete for what the page uses (fonts, Open-Meteo, Nominatim, MP, GCS app; no other hosts, `<img>`, iframes or forms). But **`pack.cells` from imported pack profiles goes into `innerHTML` raw** (Finding 2). |
| R11 | PASS | `index.html:1833-1864` | Smoke: a swipe is ignored while the modal is open, works when it is closed, and is ignored when it starts inside a horizontally overflowing `overflow-x:auto` table. |
| R12 | PASS | `index.html:934-940` | A single `table.innerHTML` build. |
| R13 | PASS | `js/tools-core.js:111-193`; `test/tools/tlog.test.js` | I checked the v1/v2 header offsets, the v2 frame length (12 + len + 13 if signed), the HEARTBEAT/SYS_STATUS/BATTERY_STATUS payload offsets and the armed bit 0x80 against the MAVLink definitions. GCS/invalid-autopilot heartbeats are ignored. The date is local. |
| R14 | PASS | `js/tools-core.js:197-204, 267-276`; `index.html:1455`, `:1518-1519` | "relative to home … not AGL". `GPS_UTC_LEAP_SECONDS = 18` with a comment. BAT is kept when `Inst` is absent or 0. |
| R15 | PASS | `js/tools-core.js:406-463`; `test/tools/sun.test.js` | A SunCalc subset with its full BSD-2 header. SunCalc is BSD-2-Clause, not MIT; the report notes this correctly. Tests against USNO for 60.0N 10.8E and 37.8N 122.4W at both solstices pass with ±2 min. I spot-checked that the values are plausible (SF 21 Jun rise 05:48 / set 20:35 PDT). |
| R16 | PASS | `index.html:1617-1648` | Smoke: a network rejection shows the cache with name, coordinates, age and timestamp, plus a "DIFFERENT LOCATION" warning (> 1 km). HTTP 500 shows "Weather failed: Open-Meteo HTTP 500" and no cache. |
| R17 | PASS | `js/tools-core.js:330-335`; `index.html:1380-1381` | — |
| R18 (SHOULD) | PASS | `index.html:453`, `:1298-1301`, `:1319` | The UI says the endpoint is unverified. C2 has no carrier voltage (only `client.battery`), so the TODO(WP08a) comment is the correct branch of the requirement. |
| R19 | PASS | `index.html:1609-1615`, `:1743-1814`, `:503-508`; `js/tools-core.js:362-397`; `js/store.js:95` | Smoke: the 10/80/120/180 m table renders. 80 m at hour 14 shows 14.5 m/s, NO-GO. The limit inputs change the intro text and the classification (GO limit 3 → 4 m/s is CAUTION). |
| R20 | PASS | `js/tools-core.js` exports; `test/tools/*` | Every exported function is exercised by the tests (battery, tlog, bin, weather, sun, checklist), and `index.html` calls `ToolsCore`. |
| R21 | PASS | `index.html:199`, `:542`, `:552-553` | Smoke: header and footer contain `2.0.0-dev` and the content date. |
| R22 | PASS | `index.html:605`, `:197` | — |
| R23 | PASS | CSS `index.html:160-165`; inputs `.cfg-row`/`.cfg-input` (wrap, min-width 130 px, 44 px height); wind table `min-width:340px` inside `overflow-x:auto` | No new fixed width > 360 px without overflow handling. The `@media(max-width:600px)` block and the bottom nav are unchanged. |

## Contract results

**C1 (`js/store.js`)**
- API: `load`, `save` (sets `updatedAt`, fires `vtol-store-changed` on window), `update` (returns the store), `uid`, `defaults`, `exportJSON`, `importJSON(str,{merge:true})` and `KEY='vtol_store'` are all present and behave as specified. `load()` never throws: corrupt JSON, unavailable storage and quota errors were all tested.
- Shape: every collection and its record fields match. `schemaVersion: 2`.
- Default profiles: they match C1 field by field, and `store.test.js` asserts them. The SIYI link has every value null except margin 6.
- Migration: matches C1. Legacy keys are removed only after a successful save (tested with a throwing `setItem`), and the gh keys are deleted.
- Tombstones: kept for 30 days and purged on `load()`.
- Extensions: `settings.windGoMaxMs`/`windCautionMaxMs`/`gustMaxMs`/`updatedAt`, plus the helpers `live/find/upsert/remove/mergeStores/IDS/SCHEMA_VERSION`, and `save()` returns a bool. These are additive and break nothing in the specified API or shape. **Acceptable.** They should be added to `02-CONTRACTS.md`.
- **Deviation in the merge semantics for `settings`:** C1 says "merge … with `updatedAt` per record if present". The implementation substitutes the *file's* `updatedAt` when the settings record has none, which defeats the rule (Finding 1).

**C4**
- `js/version.js` sets `self.VTOL_VERSION = {app:'2.0.0-dev', content:'2026-10-16', paramFile:'TBD'}` in the browser and also exports it for Node.
- `js/common.js` exposes `VtolCommon.escH`, `fmtTime`, `toggleCleanup` and `copyToClipboard → Promise<bool>` (never rejects). The extra `fmtDuration` is additive.
- PASS.

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"; cd S/wt/WP01; node --test test/
ℹ tests 57  ℹ pass 57  ℹ fail 0        (Node v24.20.0)

# without test/index.js (copy in S/verify/WP01/noindex, since deleted):
node --test test/                    → fails ("test at test:1:1 … test failed")
node --test "test/**/*.test.js"      → 57 pass
```

The tests are meaningful, not trivial asserts:
- `store.test.js` covers C1 defaults field by field, migration, failed-save safety, Gist keys, corrupt store, tombstone expiry, merge rules and the round trip.
- `battery.test.js` covers the S-05 margin, the floor, settings, non-carrier packs, levels and LiFe TBD.
- `tlog.test.js` uses synthetic v1/v2/signed/truncated frames and covers armed time, the GCS heartbeat and resync.
- `bin.test.js` uses synthetic FMT/BAT/GPS records and covers the Inst filter and leap seconds.
- `checklist.test.js` covers expiry with a faked old timestamp and migration.
- `sun.test.js` checks against USNO values.
- `weather.test.js` uses a 15-min `current.time`.
- **Gap:** `store.test.js:194-202` codifies the faulty settings fallback (Finding 1). No test covers profile values of the wrong type, or markup, from import.

`npx --prefix S/jsenv html-validate`:
- main: no-implicit-button-type 43, no-inline-style 70, prefer-tbody 1.
- WP01: 41 / 72 / 1.
- Only pre-existing rule classes. +2 inline styles in the new controls, in the page's existing style. Acceptable.

## Smoke tests (what you loaded/clicked + result)

My own script: `S\verify\WP01\smoke.js`; output in `S\verify\WP01\smoke-output.txt`. It inlines `js/*.js` and loads at `https://melonno.github.io/vtol-manual/index.html` in jsdom with `runScripts:'dangerously'`, stubbed fetch/confirm/prompt/alert. **56 pass, 2 fail.** Both fails are real defects (Findings 1, 2).

1. **Legacy localStorage**
   - Input: `vtol_battlog` (XSS in flight/notes), `vtol_pf_archive`, `vtol_wx_fav`, `vtol_batt_type`, `vtol_cl2`, `vtol_cl3`, `vtol_gh_pat`, `vtol_gh_gist_id`, `vtol_last_sync`.
   - Result: no script errors. The store is migrated (ids, packId, source) and every legacy and gh key is removed. Checklist ticks map to stable ids, with the migration notice. XSS strings render as text in the battery table, archive and favourites.
2. **Battery tab**
   - The recommendation, settings changes and the mast pack behave as under R6.
   - A new entry stores packId and source, and an attribute-breaking note is escaped.
3. **Checklist**
   - A click shows "checked 20:56" and saves `{checked:true, ts}` under `site-wind`.
   - A faked 8 h state is reset with the notice; 5 h state is kept.
   - START TIMER clears the ticks after the confirm.
4. **UI**
   - Swipe guards: modal open, and a scrollable table.
   - Clean-up toggle and copy fallback work.
   - Export holds the whole store.
5. **Weather**
   - With a 15-min-aligned `current.time`, the hour index, icing row, relay-wind table, forecast window and escaped Nominatim name are all correct.
   - The editable limits work.
   - A network failure gives the labelled cache and different-location warning; HTTP 500 gives an error.
6. **Import**
   - The local record is kept and the remote one added. An older tombstone does not delete. A file without the record does not delete. Invalid JSON throws and leaves the store unchanged.
   - **FAIL:** locally edited `battCrtVolt` 22.4 reverts to 22.2 after importing a never-edited file from another device.
   - **FAIL:** an imported pack with `cells: '6<img src=x onerror=…>'` creates 2 `<img>` elements in `#bl-analysis`. jsdom does not fetch images, so the handler did not fire here; in a browser `onerror` fires, and the CSP allows inline handlers.
7. **Extra** (`S\verify\WP01\typecheck.js`): a store whose settings have string values (`battCrtVolt:"22.2"`) throws `TypeError: v.toFixed is not a function` in `renderBattLog` on every load, and `vtolInit` aborts (Finding 3).

## Findings

1. **MAJOR — import silently overwrites locally edited safety settings** (`js/store.js:246-250`; codified by `test/tools/store.test.js:194-202`).
   - **What is wrong:**
     - When the incoming `settings` has no `updatedAt`, the code uses the file's top-level `updatedAt` instead.
     - `settings.updatedAt` is only written when a user edits a setting, so every export from a device that never edited settings lacks it.
     - The top-level `updatedAt` is bumped on every save (any battery entry, archive or tick of the pack selector).
   - **Scenario (reproduced):**
     - The laptop has edited `battCrtVolt` 22.4 (and/or RTL, hard limit, checklist expiry, wind limits).
     - A phone with default settings logs a flight and exports.
     - The laptop imports that file. All settings revert to the phone's defaults (22.2), with no message. The alert even says "Local records not in the file are kept".
   - **Impact:** these thresholds drive the S-05 recommendation and the checklist expiry (S-06), and this is the IDX-03 data-loss class that R3 targets.
   - **Expected:**
     - An incoming settings record without its own `updatedAt` counts as never edited (oldest), so it may only fill in keys missing locally and never overwrites.
     - Alternatively, stamp `settings.updatedAt` in `defaults()` with epoch / '' and compare only per-record stamps, as C1 says ("with `updatedAt` per record if present").
     - Fix the test accordingly.
     - Optionally, report changed settings in the import alert.

2. **MAJOR — imported pack-profile values reach `innerHTML` unescaped** (`index.html:972` and `:980` `${cells}S …`, `:1509` `'('+cells+'S '+…`).
   - **What is wrong:**
     - `pack.cells` comes from `store.packs`, which `importJSON`/LINK FILE merge from an external file without validation (`store.js:235`).
     - Plan IDX-07 explicitly treats imported data as untrusted, and R10 (MUST) requires every dynamic string in `innerHTML` to be escaped.
     - Reproduced: injected `<img>` elements in the analysis card. The CSP has `'unsafe-inline'`, so inline event handlers are not blocked.
   - **Expected:**
     - Escape these interpolations with `escH`.
     - Better, and also needed for Finding 3: coerce or validate numeric profile fields (`cells` a positive integer, `chem` one of the enum values, `role` one of the enum values) when importing or normalising, because WP02/WP05/WP11 will also render profiles.
   - **Lower-risk part of the same class (MINOR):** `.bin` mode names `index.html:1483`, `:1534`, `:1539`. `m.mode` becomes a string if a crafted FMT declares `Mode` as `Z`/`N`. Use `escH(s.name)`.

3. **MINOR — imported values are not type-checked; a malformed file permanently breaks the Battery tab** (`js/store.js:112`, `:236`, `:249`; `index.html:945-953`).
   - **What is wrong:** settings, or profile numbers, imported as strings or `null` reach `.toFixed()`. `renderBattLog` then throws on every load, so `vtolInit` stops, and there is no recovery short of clearing storage.
   - **Expected:**
     - Coerce or validate numeric settings on merge and normalise; reject invalid values, keeping the local or default value.
     - Same fix point as Finding 2.

4. **MINOR — `importJSON` ignores a failed `save()`** (`js/store.js:261`). On a quota error the user is told "Imported and merged …" although nothing was persisted. Return or throw on a `false` result.

5. **MINOR — migrated legacy ticks get a fresh 6 h session** (`js/tools-core.js:482-489`, `index.html:693-695`).
   - **What happens:** ticks of unknown age from `vtol_cl2`/`vtol_cl3` can still show the green "GO — CLEAR TO ARM" banner for up to 6 h after the first load of the new version.
   - **Mitigation in place:** an amber notice is shown and rows say "time unknown". The choice is documented in report §5.2.
   - **Note for the PM:** for S-06 strictness, migrated ticks could count as expired immediately (`clIsExpired` already treats an unknown start as expired). This is a judgement call, not a defect.

6. **MINOR — the pack selector changes `settings.activeCarrierPackId` without bumping `settings.updatedAt`** (`index.html:889`). This is inconsistent with the settings merge rule that the implementation itself introduced.

7. **MINOR — expiry is only re-checked on load and `visibilitychange`** (`index.html:700-704`, `:1014`). A page that stays in the foreground past the expiry (e.g. a laptop) keeps showing stale ticks until a reload or tab switch. A one-minute interval check would close this.

8. **MINOR (informational, out of R22 scope, reported by the implementer)** — the checklist note "Rear pair: fixed lift motor props" (`index.html:605`) and the emergency texts "120m AGL" (`:237`, `:244`) still contradict the 3-motor / REL facts. Leave them for WP05, but track them.

## Approval rationale / items that must be fixed

**REJECTED** — two MAJOR findings, and R2/R3/R10 (MUST) are not fully met:

- **Finding 1:** settings merge must not let an un-stamped (never-edited) incoming settings record overwrite locally edited settings. Fix `store.js:246-250` and the test at `store.test.js:194-202`, and add a test for the phone→laptop scenario above.
- **Finding 2:** escape `pack.cells` (and the other profile-derived values) at `index.html:972`, `:980`, `:1509`. Preferably also validate and coerce profile fields on import. Escape the `.bin` mode name.

**Recommended in the same rework:** Finding 3, which has the same fix point as Finding 2, and Finding 4.

Everything else is solid:
- The S-05 margin logic, S-06 expiry and ids, tlog/bin parsing, weather index, sun times, CSP and Gist removal are correct and well tested.
- The out-of-scope `sw.js` and `test/index.js` changes are minimal and justified.
- The C1/C4 extensions are acceptable.
- The report is honest, except that it does not mention the two defects above.
