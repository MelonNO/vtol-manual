# WP11 — Implementation report (Tools analysis, maintenance, param-file import, accessibility)

Branch `wp/11`, worktree `S\wt\WP11`. Base `5cf0ad3`. `main` was merged in once (`8e49cb7`), as the PM asked, to pick up `test/repo-files.js` and `.gitattributes`. There were no conflicts.

## 1. Summary

- **Pure logic in `js/tools-core.js`**, covered by Node tests:
  - expected-parameter table, `.param` parser and comparison
  - `.bin` flight analysis (transitions, events, max current per phase, battery entry, summary)
  - GCS session-log parser (schema `vtol-gcs-session/1`)
  - maintenance status
  - challenge–response helpers
  - latency statistics
  - cloud / visibility extraction
  - the verified Norwegian airspace / NOTAM links
- **`js/store.js`, additive C1 extensions:**
  - the optional key `paramFile`
  - new collections `flights` and `maintenance`
  - an optional `battLog[].usedMah`

  All of them are validated on load and on import, and merged on import.
- **`index.html`:**
  - new **Params** tab: import, comparison, and a "verified against param file …" label in the header
  - new **Flights** tab: maintenance tracker, pack cycles, flight records
  - Telemetry tab: `.bin` phases / events / current, battery entry and flight-record attach; GCS session-log viewer; latency-clock link
  - Weather tab: cloud cover, low cloud and visibility, plus the airspace / NOTAM card
  - challenge–response mode, using the same checklist engine
  - accessibility work: focus styles, row buttons with keyboard support, `aria-expanded` / `aria-pressed`, labels, status text next to colours
- **New `tools/latency-clock.html`:** a standalone page for relay-design test 2 with a millisecond clock, a frame counter, the measured display rate, and 20-sample mean / worst. It loads no external resources.
- **Tests:** 191 Node tests pass, 28 of them new in this WP (5 new test files; `main` has 163). The jsdom smoke test passes 76 checks with 0 script errors. *(Counts corrected in rework round 1; see the end of this report for the current figures.)*

## 2. Requirement table

Line numbers refer to the commit that holds this report.

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | Table `js/tools-core.js:523-553` (TODO at :523); `parseParamFile` :561, `compareParams` :581, `paramFileLabel` :598, `paramValue`; store `cleanParamFile` `js/store.js:292`, load :351-357, import/merge :493-497, :513-517; UI `index.html:509` (tab), `renderParamHeader` :2306, `paramImport` :2310, `renderParams` :2331; header `#hdr-params`; tests `test/tools/params.test.js`, fixture `test/fixtures/sample.param`, `test/tools/store-wp11.test.js` | **Formats:** Mission Planner, MAVProxy and QGC files are accepted. **Table:** it lives in tools-core, because WP05 left no `expectedParams` slot and the PM ruled that `data/content.js` must not be touched. **Values:** all from the plan / manual. **`Q_TRANS_FAIL_ACT` = 0 means QLand** ("not QHOVER", per §13.1). **Statuses:** MATCH / DIFFERS / MISSING / "no documented value", each shown as icon + text. The 22.2 V check compares at float32 tolerance. **Label for other pages:** `ToolsCore.paramFileLabel(store.paramFile)` → "verified against param file <name> <YYYY-MM-DD HH:MM>". **Filter:** "show only differences" is available. |
| R2 | DONE | `binAnalyze` `js/tools-core.js:641`, `binBattEntry` :715, `binSummary`; `parseBin` now keeps `cur{t,a}` and `MODE.Rsn`; UI `binExtrasHTML` `index.html:2014`, `binCreateEntry` :2059, `binAttach`; tests `test/tools/bin-analysis.test.js` (7 tests, synthetic records) | **Transitions:** VTOL ↔ FW mode-class changes, with time to `AIRSPEED_MIN` after a forward transition when ARSP exists. `AIRSPEED_MIN` comes from the param file, else the documented 11 m/s (labelled). Without ARSP, the "Transition done" message is the fallback. **Events:** assist (MSG "Alt assist" / "Angle assist", ArduPlane source); transition, failsafe and battery (MSG text); failsafe and battery mode reasons (`ModeReason.h`). **Max current per phase:** VTOL / transition / FW. **Battery entry:** "Create battery-log entry from this .bin" with a pack selector and start / min / end / duration (`source:'bin'`). |
| R3 | DONE | `parseSessionLog` `js/tools-core.js:737`, `sessionBattEntry` :807, `sessionSummary`; UI `gcsLoad` `index.html:2081`, `renderGcs` :2094, `gcsCreateEntry` :2139; tests `test/tools/session-log.test.js` | **Charts:** RTT, uplink loss, LQ and client battery voltage. LQ comes from telemetry `link`, falling back to the `/status` LQ. **Timeline:** bridge states, each segment labelled with its state name. **Alarms:** list of raised and cleared alarms. **Client battery entry:** start / min / end and mAh (last − first `used_mah`); duration is the armed time when present. **Robustness:** unknown record types are ignored and bad lines are counted and reported (gcs/README "readers must ignore what they do not know"). |
| R4 | DONE | `MAINT_TASKS` `js/tools-core.js:831`, `maintStatus` :854, `maintLast`, `addMonths`; store `maintenance` collection, `cleanMaint`; UI `renderMaint` `index.html:2268`, `mtDone` :2289, `mtUndo`; tests `test/tools/maintenance.test.js` | **Intervals (manual):** carrier every 5 / 10 / 25 flights or monthly; client every 5 flights. **Flight counting:** a flight is one battery-log entry — carrier-role packs for the carrier, the client profile's `packId` for each client. **Statuses:** OK / 1 FLIGHT LEFT / DUE / OVERDUE, as text badges. **Mark done:** records a date (`store.maintenance`, with UNDO). **Monthly:** due date shown; "unknown" until the first mark-done. **Pack cycles:** logged flights next to the profile's cycle count. |
| R5 | DONE | store `flights` collection, `cleanSummary` / `cleanFlight` `js/store.js:267-283`; UI `flAttach` `index.html:2162`, `renderFlights` :2194, `flSave` :2235 | **What a record links:** preflight archive session, carrier and client battery entries, the `.bin` summary and the GCS summary, under one id. **List view:** shows the resolved links, and shows deleted ones as such. **Summaries:** attached from the Telemetry tab, either to a new record or to an existing one. |
| R6 | DONE | URL `index.html:2410`; `cloudVis` `js/tools-core.js:885`; `wxCloudVisHTML` `index.html:2635`; `AIRSPACE_LINKS` with the verification comment `js/tools-core.js:889-903`; `renderAirspace` `index.html:2647`; card :563-568 | **Cloud and visibility:** hourly `cloud_cover`, `cloud_cover_low` and `visibility` from Open-Meteo, shown as "not available from the model" when absent. They are information only, because the manual sets no limits. **Links verified 2026-10-16** (see §5.3): IPPC (NOTAM), dronesoner.no, the Luftfartstilsynet no-drone-zones page, the Avinor drone map and AIP Norway. **Authorisation:** states the owner decision (covered by the operator's authorisation, plan §1.1); amber TBD only for the reference number (rework round 1). |
| R7 | DONE | CSS `index.html:221-259` (`:focus-visible`, `.sr-only`, icons on Link-view warn/crit rows); `clA11y` :772 plus the document keydown handler :643; `aria-expanded` in `toggleDetail` / `toggleExpandAll`; `aria-current` on nav; `LEVEL_TXT` :655 (battery min V); forecast rows carry GO / CAUTION / NO-GO text; `.bin` warn messages are prefixed ⚠; every new status is a text badge; labels via `for=` on all battery, `.bin`, `.tlog` and weather inputs; `aria-label` on ✕ / ✎ buttons; emergency modal `role="dialog"` | `render-content.js` (WP05) is not changed. Rows get `role="button"`, `tabindex=0` and `aria-pressed` / `aria-expanded` / `aria-controls` after rendering, and Enter / Space activates them. The smoke test checks that every `input` / `select` on the page has a label. |
| R8 | DONE | Modal `index.html:317-332`; `crOpen` / `crRender` / `crCheck` / `crSkip` / `crBack` / `crReview` :882-960; `clSetItem` / `clRowSync` :785-800; helpers `crItems` / `crNextOpen` / `speechText` `js/tools-core.js:505-519` | **Layout:** full screen, big text, ◀ BACK / ✓ CHECK / SKIP ▶ (≥ 64 px). **Progress and end screen:** "x / n CHECKED · n SKIPPED"; at the end it shows ALL CHECKED or the NO-GO list with REVIEW. **Ticking:** CHECK ticks through the same engine (`clToggle`, sessions, time stamps, expiry) and updates the list row. **Speech:** `speechSynthesis` is off by default and per session; markup is stripped before speaking. Escape closes the mode. |
| R9 | DONE | `tools/latency-clock.html`; `latencyStats`, `fmtClockMs`, `LATENCY_SAMPLES = 20` `js/tools-core.js:870-881`; link `index.html:487-491` (Telemetry tab) | **Clock:** large `HH:MM:SS.mmm` redrawn every animation frame, a 0–1 s position bar, a frame counter and the average frame interval / display rate. **Samples:** the 20-sample entry gives mean / worst / best and can copy the result. **Offline:** strict CSP, no external fonts or scripts; only `../js/tools-core.js`. |
| R10 | DONE | 5 new test files in `test/tools/` (28 tests); jsdom smoke `S\wp11smoke\smoke.js` | **Unit tests:** all pass (191). **Smoke test:** 76 checks — every new view, and these WP01/WP05 behaviours: expiry, the Link tab "GCS APP NOT RUNNING", emergency cards, export/import, store validation. **CSP of `index.html`:** unchanged; no new hosts were needed. |

## 3. Placeholders (amber, visible)

| Where | Placeholder | Why |
|---|---|---|
| `EXPECTED_PARAMS` `FLTMODE2` (Params tab) | `TBD — the project notes give 11 (= RTL in ArduPlane numbering) but call it QLOITER (= 19); confirm from the param file` | The only source for FLTMODE1–6 is `ai/PROJECT_CONTEXT.txt`, and its FLTMODE2 number and label contradict each other. The manual gives only the switch positions (QHOVER / FBWB / AUTO). The row is shown, never judged. |
| Weather tab airspace card | `TBD — authorisation reference / document number (plan §10.5)` | The coverage itself is decided (plan §1.1) and stated as such; only the reference is unknown. *(Changed in rework round 1.)* |
| Maintenance, client without `packId` | `TBD — no pack set in this client profile, flights cannot be counted` | Client flights are counted by the client's pack. |
| `.bin` transition, no `AIRSPEED_MIN` at all | amber `TBD` | Only if neither the param file nor the table has it. This cannot happen with the current table. |

## 4. Tests

New:
- `test/tools/params.test.js` (5): the table values (incl. Q_TRANS_FAIL_ACT 0 = QLand, FLTMODE2 TBD, a source on every row); MP / MAVProxy / QGC / CRLF / comment parsing; bad names and values; duplicates; match / differs / missing / undocumented on `test/fixtures/sample.param`; the label and value helpers. The fixture is read through `readText()` (`test/repo-files.js`).
- `test/tools/bin-analysis.test.js` (7): `cur` and `Rsn` in `parseBin`; `modeClass`; forward / back transitions with time to AIRSPEED_MIN and reasons; not reached; no ARSP → unknown or "Transition done"; events (MSG and mode reason); max current per phase; battery entry and summary.
- `test/tools/session-log.test.js` (4): series, timeline, alarms, bad / unknown lines; LQ fallback; battery entry (start / min / end, mAh, armed time, pack window); summary.
- `test/tools/maintenance.test.js` (7): intervals; flights-since with same-day ordering; ok / soon / due / overdue; monthly due / overdue / unknown; `addMonths`; `maintLast`; challenge–response helpers; latency stats and clock format; cloud / visibility; airspace links are https.
- `test/tools/store-wp11.test.js` (5): defaults; `paramFile` validation on load (XSS name, bad date); import newer-wins, ignoring older or invalid records; export round trip; flights / maintenance merge and validation; `usedMah`.

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 191  ℹ pass 191  ℹ fail 0
```

**jsdom smoke** (outside the repo): `node S\wp11smoke\smoke.js [worktree]` → **76 pass, 0 fail**, 0 script errors. It loads `index.html` and `tools/latency-clock.html` at `https://melonno.github.io/vtol-manual/…` with the scripts inlined, and feeds files through stubbed `input.files`. It covers:
- param import (XSS file name, DIFFERS / MISSING / MATCH, filter)
- checklist keyboard / ARIA
- challenge–response (CHECK through the engine, SKIP, BACK, speech off / on, Escape, all-checked → GO)
- `.bin` phases / events / current / entry / attach
- GCS session log (4 charts, timeline, escaped alarms, client entry with mAh, attach to the same record)
- flight-record edit with linked archive and entries (XSS label)
- maintenance DUE → DONE → UNDO
- weather cloud / visibility with a stubbed fetch
- export of the new keys
- a reload with an expired checklist (WP01 rule), the Link tab and the emergency cards (WP05)
- the latency page

**html-validate on `index.html`** vs `main`:

| Rule | `main` | this branch |
|---|---|---|
| `no-implicit-button-type` | 31 | 31 (all new buttons have `type`) |
| `no-inline-style` | 74 | 94 (new static markup follows the page's inline style) |
| `prefer-tbody` | 1 | 1 |

`tools/latency-clock.html` has only 2 × `no-inline-style`.

## 5. Deviations / contract issues

1. **C1 extensions (store.js)** — the PM may want these in `02-CONTRACTS.md`. The brief named only `paramFile` as additive, but R4/R5 require store keys, so I added:
   - **`paramFile`** (optional): `{name, importedAt ISO, params: {NAME: finite number}}`.
     - A bad record is removed on load, with a store notice.
     - On import, the incoming record wins only if its `importedAt` is newer; `importJSON.lastStats.paramFile = true` then. The `stats` object keeps its WP01 shape otherwise.
     - **Limitation:** it is a single record with no tombstone, so "CLEAR PARAM FILE" on one device does not propagate through import.
   - **`flights`** (collection, merge by id, tombstones): `{id, date, label, notes, archiveId, battIds[], logSummary|null, gcsSummary|null}`. Summaries are coerced to flat display data (strings ≤ 200 chars, finite numbers, booleans, null, one nested level).
   - **`maintenance`** (collection): `{id, taskId, doneDate 'YYYY-MM-DD', markedAt ISO, notes}`. Task ids are `carrier-5`, `carrier-10`, `carrier-25` and `client-5:<clientId>`. Invalid records are dropped with an issue.
   - **`battLog[].usedMah`** (optional, number ≥ 0 or null): set by GCS-telemetry entries.
2. **Expected-parameter table location:** it is in `js/tools-core.js` with `TODO(content)`. `data/content.js` was not edited (PM rule; WP06 changed it in parallel).
   - **Sources:** plan §13.1 / §6.1.5, the manual's Aircraft tab, and CLAUDE.md for FENCE_ENABLE.
   - **FLTMODE1–6:** the only source is `ai/PROJECT_CONTEXT.txt`; see the FLTMODE2 TBD above. The owner should confirm these, or remove them if that file is not an accepted source.
3. **R6 URLs — verified on the web 2026-10-16** and cited in the comment above `AIRSPACE_LINKS`:
   - <https://luftfartstilsynet.no/en/drones/no-drone-zones/> ("NOTAM can be checked at IPPC.no"; links to dronesoner.no, the AIP and Avinor)
   - <https://www.ippc.no/ippc/index.jsp> ("IPPC – Norwegian Aerodrome Info", © Avinor Flysikring AS, NOTAM briefing; linked from <https://partner.avinor.no/en/ais/homepage/>)
   - <https://partner.avinor.no/en/ais/aip/> ("AIP – Norway"; `avinor.no/en/ais/aipnorway/` 301-redirects here)
   - <https://www.avinor.no/en/practical-info/drone/dronekart/> (Avinor "Drone map")
   - <https://dronesoner.no/> — it does not name its operator on the page, but Luftfartstilsynet links to it as the UAS geographical zones map. The label says "linked by Luftfartstilsynet".

   Open-Meteo has **no cloud-base variable**. The plan's "cloud base" is therefore covered by low-cloud cover (≤ 3 km) plus visibility.
4. **Facts read from ArduPilot source (master, 2026-10-16):**
   - mode numbers (`ArduPlane/mode.h`)
   - `ModeReason` (`libraries/AP_Vehicle/ModeReason.h`)
   - MSG texts "Alt assist …" / "Angle assist …" (`VTOL_Assist.cpp`) and "Transition … done / failed" (`quadplane.cpp`)

   `index.html`'s `QPLANE_MODES` now points to `ToolsCore.PLANE_MODES`, which adds 14, 16 and 26.
5. **Phase classification** uses the flight mode only. AUTO, RTL and GUIDED count as FW even when they fly VTOL segments, and the UI says so. When a forward transition has no ARSP and no "Transition done" message, its current counts as FW, with a visible note.
6. **Battery entries from `.bin` / GCS** store the end-of-log value as "resting V", like the existing `.tlog` import, and say so in the notes. A true 30-minute rest voltage is not in the logs.
7. **`sw.js` not touched:**
   - The new page has no external dependencies, and the existing network-first rule caches it on the first online visit.
   - It is **not precached** at install. WP09 R3 precaches `tools/*`.
   - `index.html` loads no new scripts, so its offline behaviour is unchanged.
8. **CSP:** `index.html` is unchanged; the IPPC / Avinor links are plain navigations, not fetches. `tools/latency-clock.html` has its own strict CSP.
9. **Colour-only cases left:**
   - Battery trend-chart dots are coloured. They now carry an SVG `<title>` with the level text, the legend explains the colours, and the table rows below carry the text.
   - The `.bin` mode timeline is coloured, but every segment is named in the legend.
10. **Merge of `main`:** done once as instructed. `.gitattributes` now forces LF, and the CRLF working copies are normalised on commit.

## 6. Notes for the verifier

- **Tests:** run `node --test test/`. For the smoke test, run `node S\wp11smoke\smoke.js` (default worktree `S\wt\WP11`).
- **Params:** Params tab → select `test/fixtures/sample.param` → IMPORT.
  - Expect `Q_TRANS_FAIL_ACT` ✖ DIFFERS (file 1, documented 0 = QLand), `AIRSPEED_MAX` ? MISSING and `FLTMODE2` "no documented value".
  - The header shows "verified against param file sample.param <date time>".
- **Challenge–response:** Pre-Flight → CHALLENGE–RESPONSE. CHECK ticks the row in the list behind the modal (with a time stamp); SKIP leaves it unticked. READ ALOUD uses the browser voice.
- **`.bin` / session log:** use any real ArduPlane `.bin` (or the synthetic generator in the smoke script) and a real `session-*.jsonl` from `python -m vtolgcs --headless --sim`. The Telemetry tab then shows the phase / event tables and the GCS charts. Use CREATE ENTRY and ATTACH, then open the Flights tab.
- **Maintenance:** log 5 carrier battery entries → "Carrier — every 5 flights" shows ⚠ DUE. DONE resets it, and UNDO restores it.
- **Keyboard:** Tab onto a checklist row → Enter ticks it; Tab onto DETAILS → Enter expands it (`aria-expanded`).

## Rework round 1

This round answers `S\verify\WP11\VERIFY-round1.md` (REJECTED, one MAJOR finding). Where this section conflicts with sections 1–6 above, this section wins.

| Finding | Sev | Fix | Evidence |
|---|---|---|---|
| **1** Authorisation line contradicted the owner decision | MAJOR | The Weather airspace card now **states the decision**: "Remote piloting through the relay is covered by the operator's authorisation (Luftfartstilsynet) — owner decision, plan §1.1. Radio-spectrum rules (Nkom) are a separate question." This matches `manual.html:466` and the checklist item `site-airspace`. The amber TBD is kept only for the **authorisation reference / document number** (plan §10.5). | `index.html:567-568`; smoke checks "authorisation stated as decided" and "amber TBD only for the reference" |
| 2 `paramFile` newer-wins compared raw strings | MINOR | `cleanParamFile` normalises `importedAt` to ISO (`new Date(Date.parse(…)).toISOString()`). `mergeStores` compares `Date.parse` values. An invalid date is rejected before the comparison, so it never wins. | `js/store.js:315`, `:527-531`; test `store-wp11.test.js` "paramFile times compare as dates" ("Fri, 01 Jan 2000 …" loses to an ISO 2026 stamp; an RFC date from 2026-10-17 wins and is stored as ISO; "tomorrow" is ignored) |
| 3 `cleanFlight` never rejected | MINOR | A flight record is **dropped** (on load and on import, with an issue) when its date is not a real `YYYY-MM-DD`, `battIds` is not an array of strings, label / notes / archiveId is an object, or a summary is not an object. So a malformed newer record can no longer replace a valid local one (C1.4). `cleanMaint` now also requires a real calendar date (`2026-02-30` is rejected). Shared helper: `isDay`. | `js/store.js:279-300`; tests "a malformed incoming flight record never replaces a valid local one (C1.4)" (7 malformed variants; a valid newer record still wins) and the extended maintenance test |
| 4 MSG events over-labelled as FAILSAFE / BATTERY | MINOR | The patterns now follow ArduPilot's own texts (read 2026-10-16, cited in the comment). Any other error-like text ("Calibration failed", "Mode change … failed", "Airspeed sensor 1 failed", "Lost GPS lock", "PreArm: …", "EKF variance error") gets a separate **`warning`** kind, shown as "⚠ ERROR / WARNING", never as failsafe. Mode-reason events are unchanged. | `js/tools-core.js:629-647`; `index.html:2029` (labels: ✖ FAILSAFE / ✖ BATTERY in red, ⚠ ERROR / WARNING in amber); test "MSG classification follows ArduPilot failsafe / battery texts" |
| 5 EMERGENCY button hidden behind the challenge–response screen | MINOR | The **EMERGENCY button stays on top**: `#emerg-fab` z-index 1050 is above the challenge–response mode (1000), and the emergency modal (1100) opens above both. The challenge–response screen reserves bottom padding so the button never covers SKIP. Escape closes the emergency modal first, and the challenge–response mode stays open behind it. | `index.html:41`, `:245-276`, `:334`, `:643`; smoke checks for z-order, the FAB opening above the mode, and the Escape order |
| 6 `fmtS` showed 59.6 s as 0:00 | MINOR | Rounds to whole seconds before splitting minutes and seconds. The same fix is applied to the pre-existing `.bin` `tFmt` / duration / MSG-time formatting, which had the same bug. | `index.html:2007`; smoke: `fmtS(59.6)` = 1:00, `fmtS(119.5)` = 2:00, `fmtS(59.4)` = 0:59 |
| 7 Wrong test counts in the report | MINOR | §1 and §2 R10 are corrected: round 0 had 5 new test files and 28 new tests (191 − 163). Current counts are below. | this report |
| 8 Latency clock had its own clipboard code | MINOR | The page loads `../js/common.js` (same origin, no dependencies) and uses `VtolCommon.copyToClipboard`, which has the execCommand fallback. When both methods fail, the text is shown so it can be copied by hand. | `tools/latency-clock.html:93`, `:149`; smoke "copy through VtolCommon.copyToClipboard" |
| 9 Housekeeping | MINOR | **Fixed:**<br>- the unused `role` parameter of `packOptions` and the redundant `n` of `battSel` are removed<br>- the Params table renders "VERIFY …" in a meaning as the amber marker (Q_ASSIST_ALT)<br><br>**Unchanged and disclosed:**<br>- `no-inline-style` +20<br>- `.param` CLEAR not propagated through import<br>- AUTO VTOL-takeoff counted as transition | `index.html:2008`, `:2220`, `:2343` |

**Files touched in this round:** `index.html`, `js/store.js`, `js/tools-core.js`, `tools/latency-clock.html`, `test/tools/store-wp11.test.js`, `test/tools/bin-analysis.test.js`, and this report.

### Tests (rework round 1)

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 194  ℹ pass 194  ℹ fail 0
```

`main` has 163 tests, so WP11 adds **31** (in 5 files). Three were added this round:
- paramFile date comparison
- malformed flight records
- MSG classification

The flights / maintenance test was updated.

jsdom smoke `S\wp11smoke\smoke.js`: **82 pass, 0 fail**, 0 script errors. The new checks cover the authorisation text and its TBD, `fmtS`, the EMERGENCY button z-order and the Escape order, and the latency copy through `VtolCommon`.
