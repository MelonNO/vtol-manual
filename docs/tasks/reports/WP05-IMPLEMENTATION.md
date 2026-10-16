# WP05 — Implementation report (shared content, Tools content for the new relay, Profiles, Link tab)

Branch `wp/05`, worktree `S\wt\WP05`. Base `1f1444a`. Implementation commit `9ccaaef`.

## 1. Summary

- **`data/content.js` (global `VtolContent`, contract C5)** is the single source of operational content, written for the new relay and the owner's failsafe intent:
  - pre-flight (A–E, E renamed CLIENT), turnaround and post-flight
  - 8 emergency cards (SIYI/GCS loss first and marked primary) plus the "915 backup lost" **note**
  - the §6.1.5 failsafe table and the client failsafe chain
  - the §3.3 network table (with the C2/C3 local ports), callouts, and the §4 design-intent quote
  - Every item has a stable unique id. Unknown values are visible `[[TBD — …]]` placeholders.
- **`js/render-content.js` (global `VtolRender`)** holds pure renderers that return HTML strings. They escape everything first, then apply a small markup set, then fill template tokens from the active client profile and settings. `null` or unknown tokens become an amber TBD. The module also holds the checklist-automation rules and the Link-tab status view.
- **`index.html`**:
  - Pre-flight, turnaround, post-flight and the emergency modal (with quick-jump pills) are rendered from data. The WP01 checklist engine (ids, `{checked, ts}`, sessions, expiry) is reused unchanged.
  - The header doc-id follows the active client.
  - New **Profiles** tab: CRUD for clients, packs and links, the active client and carrier-pack selection, and a settings editor.
  - New **Link** tab, built on `GcsClient`: a full C2 status view, an audio cue, and "GCS APP NOT RUNNING".
  - Live `AUTO ✓/✗` hints on checklist items. The pilot still ticks every item.
- **`js/store.js`**:
  - An invalid incoming record is now dropped, even for default ids. It never resets a valid local record.
  - Client and link profiles are validated and coerced on load and import.
  - New `validateRecord()` for the forms.
- **WP01 carry-overs:** untimed legacy ticks are cleared with a one-time notice, and the 4-motor and "120m AGL" texts are gone.
- **Tests:** 133 unit tests pass, including 41 new ones in `test/content/`. The jsdom smoke test passes 85 checks with 0 script errors.

## 2. Requirement table

| ID | Status | Evidence | Note |
|---|---|---|---|
| R1 | DONE | `data/content.js`: `designIntent` :53, `checklists.preflight` :60 (A–E, E = `CLIENT`), `turnaround` :119, `postflight` :150, `emergencies` :173, `emergencyNotes` :313, `failsafeTable` :325, `clientFailsafeChain` :338, `network` :353, `callouts` :371 | Node-exportable UMD. Ids are unique and well formed (`content.test.js` "every id is unique"). The extra keys are listed in §5. |
| R2 | DONE | SIYI card `data/content.js:174-192`; client RC loss :193; video (a)/(b) :211; relay PCB :228; app/controller :246; camera :262; transition :277; battery :293; 915 note :313-322 | Every card has ≤ 6 `immediate` phrases and a `cleanup`. **Intent:** SIYI loss → RTL after 5 s, any mode. 915 loss → no action, written as a note with the close-in case (take over in MP, QLOITER/QLAND, S-01a TBD). **S-02a** is in `gs-laptop-sleep`, the SIYI clean-up and `gs-mp-connect` ("Never close MP in flight"). **S-02b:** the content never has the app send MAVLink; the app/controller card keeps MP separate. **S-02c** is a TBD in the SIYI clean-up. Forbidden terms are absent (tests + jsdom). |
| R3 | DONE | Tokens in `fmt`/`plain` (`js/render-content.js:58-82`). Copy blocks: failsafe params `data/content.js:43-51`; viewer and MP HUD pipelines in PAL and NTSC on 5601/5602, the `.26` camera pipeline and the `.sdp` content :33-41, used in `gs-client-video` / `gs-carrier-camera` | All listed tokens are supported, plus `{client.fc}`, `{client.firmware}`, `{client.elrs.telemetryRatio}`, `{client.failsafe.*}`, `{settings.*}` and `{clientPack.*}`. `null`, missing or object values → `TBD` (amber in HTML). |
| R4 | DONE | `js/render-content.js` (functions :38-300); `index.html:620-645` (`buildChecklist`, `renderContent`) | Output is HTML strings only, with no DOM access. Every string goes through an internal `escH`, identical to `VtolCommon.escH`. Row markup is identical to WP01's, so `toggleCI`, `toggleDetail`, `copyVal`, the progress counters, GO/NO-GO, expiry and `clRecheck` all work unchanged. Inline handlers no longer interpolate ids: they use `this.closest('.ci').dataset.id` / `data-target`. |
| R5 | DONE | `index.html:281-282` (modal containers), `:341` (post-flight), `:243` + `renderContent` :634 (doc-id); old static cards removed | The doc-id reads "HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 (carrier) · ELRS 2.4 GHz (client) · SIYI HM30" (or `TBD`). Every place listed in §13.3 for `index.html` is gone: header, the emergency cards, checklist C/E, turnaround and post-flight. The acceptance grep is a unit test (`content.test.js` "forbidden-terms scan: index.html, data/ and js/"). |
| R6 | DONE | Tab `index.html:469-505`, nav :267; JS `PROF` :1002, `renderProfiles` :1068, `profSave` :1149, `profDelete` :1173, `profUses` :1050 | Create, edit, delete and duplicate for clients, packs and links, with every C1 field and units in the labels. Validation goes through `VtolStore.validateRecord` and errors show inline, naming the field. The active client and carrier pack are set through `VtolStore.update` (via `storeUpdate`). The settings editor covers all eight numeric settings. Deleting asks for confirmation and lists "IN USE" details: the active client or pack, client→pack references, battery-log entries, the map selection (`vtol_map_state`) and the only link of its kind. |
| R7 | DONE | Tab `index.html:457-467`; `linkOnStatus` :928, `linkAudioToggle` :951, `linkRender` :972; `VtolRender.linkStatus` `js/render-content.js:300` | The view shows: connection badge, bridge state badge, RTT/loss/jitter, status age, timing lock, sync offset, fw; camera requested vs reported (a mismatch is red); controller connected / arm-safe / throttle-low; video standard vs the profile, decoder lock, kbit/s; client LQ, RSSI1/2, SNR, TX power, RF mode, downlink, telemetry age; GPS sats (vs `minSats`), alt, speed, heading; battery V (and V/cell from the client pack), A, mAh, %; flight mode raw / FAILSAFE / armed / rescue-not-ready; the alarm list. The Web Audio beep is off by default, per session, and sounds once per newly raised crit alarm. "GCS APP NOT RUNNING" shows a one-line hint. No errors with a failing `fetch` (jsdom). |
| R8 | DONE | Rules `js/render-content.js:209-276`; items with `auto` in `data/content.js` (11 items); `linkApplyAuto` `index.html:987` | Rules: `bridge-run`, `app-controller-safe`, `client-rescue-ready`, `client-sats` (≥ profile `minSats`), `camera-off` (requested = reported = OFF), `video-lock` (lock plus the standard vs the profile), `client-link` (LQ ≥ 70 %). With the app connected each hint shows `AUTO ✓` / `AUTO ✗` / `AUTO ?` with a tooltip; without the app it is hidden. A hint never ticks the item (jsdom check). |
| R9 | DONE | `test/content/content.test.js`, `render.test.js`, `profiles.test.js` | Covered: schema (required fields, unique ids, `immediate` ≤ 6 and ≤ 60 chars); a forbidden-terms scan of every content string, plus a file grep of `index.html`, `data/` and `js/`; failsafe intent (the SIYI card says 5 s, RTL and any mode, and is first and primary; 915 is only a note); template null → `TBD`; escaping of an XSS profile name in the checklists, emergencies, callouts, header and Link view. |
| R10 | DONE | Store, expiry, swipe and CSP unchanged (CSP `index.html:6`, already allows `http://127.0.0.1:47800`); swipe `TABS` :2041 includes `link` and `profiles` in nav order | The CSP is **not** changed. Mobile: new tap targets are ≥ 44 px, and the grids collapse to one column at 360 px. The bottom nav now holds 8 tabs plus 2 links and scrolls horizontally, as before. html-validate on `index.html`: `no-implicit-button-type` 41 → 31, `no-inline-style` 72 → 74, `prefer-tbody` 1 → 1. |
| R11a | DONE | `js/store.js:115-137` (`cleanPack` mode), :434 (import uses `'import'`); test `test/tools/store.test.js:232-256` | Import: an invalid record is dropped, default id or not. Load: a default profile is repaired from its default (unchanged). The test now starts from a local 4S Li-Ion carrier pack and asserts that it survives an invalid, newer default-id record. |
| R11b | DONE | `js/store.js:138-266` (`FIELDS`, `cleanField`, `cleanProfile`, `validateRecord`) | Covers C1.3 types and enums, numeric ranges (§5.4), numeric-string coercion and `null` = TBD. **Import / form:** any invalid field → the record is dropped. **Load:** a default profile → default value; another profile → `null` (TBD), or dropped if `name`/`kind` is bad. Every repair is reported through `takeIssues()` and the existing store notice. Tests: `test/content/profiles.test.js`. |
| R11c | DONE | `index.html:577-604` (`clLoad`) | `vtol_cl2`/`vtol_cl3` are no longer migrated: they are removed and a one-time notice says they were cleared. Any stored tick without a time (e.g. migrated by WP01 code already deployed) is cleared with its own notice. Ticks for item ids that no longer exist are dropped silently. Untimed ticks can never count towards GO. |
| R11d | DONE | `build-props` `data/content.js` (M1/M2 tilt props, M4 tail prop); SIYI clean-up says "120m REL, above home" | "Rear pair" and "120m AGL" are gone (forbidden-terms test). |

## 3. Placeholders (`[[TBD — …]]`, rendered amber)

| Where | Placeholder | Why |
|---|---|---|
| `build-battery-power` note | final power-up order with the relay | plan §6.1.6 says "to be confirmed by test" |
| `gs-subnet`, `net-laptop` | final laptop IP (suggested `.100`) | plan Q3 open |
| `client-failsafe`, client RC loss card, client failsafe chain | measured total client failsafe time through the relay | relay-design test 6 not yet run |
| SIYI card clean-up, `fs-siyi` row | RTL behaviour when triggered in a Q-mode | S-02: `Q_RTL_MODE`/`Q_OPTIONS` plus SITL test |
| SIYI card clean-up | whether the HM30 sends `RADIO_STATUS` remrssi | S-02c / Q2 |
| Video loss card | "continue only if video returns within N s" | plan §6.1.8 gives no N; the video-board restart time is not measured |
| Relay PCB card | bridge and video-board LED patterns | the firmware must define them (§6.1.4) |
| Camera card, `net-camera` | P3 ingress rate-limit value | Q13 |
| `net-spare` | what may be connected to P4, and its bandwidth cap | §3.3 |
| `net-n6`, `net-bridge` | N6 and bridge IPs (e.g. `.20`, `.21`) | Q3 |
| Client chain step | ELRS TX module behaviour with a silent handset | relay-design risk table |
| `co-rc-degraded` | RTT/loss alarm thresholds | §7.5 has "RTT > X ms" |
| 915 note close-in case | QHOVER behaviour on 915 loss in a manual phase | S-01a / Q15 |
| Profile fields with `null` | e.g. reference client `videoStandard`, ELRS packet rate, model id, telemetry ratio | C1 defaults; they render as TBD everywhere |

## 4. Tests

New:
- `test/content/content.test.js` (15): C5 shape; unique and well-formed ids; checklist item fields; emergency `immediate` count and length; the §6.1.8 scenarios; SIYI intent; 915 as a note; failsafe table; corrected param block; R3 copy blocks (5601/5602, PAL/NTSC, `.26`, sdp); required new and removed items; auto rules exist; forbidden-terms scan of content and a file grep (`index.html`, `data/`, `js/`); no bare "TBD"; network table; new callouts.
- `test/content/render.test.js` (11): `ctxFrom`; token formatting; null/missing → TBD (plain and HTML); markup; XSS escaping across every renderer; WP01 row structure; compact and full emergency cards, pills and the note; tables, callouts, intent and doc-id; every auto rule ok/fail/unknown; the Link view with a C2 sample, mismatch, failsafe, empty and null input.
- `test/content/profiles.test.js` (5): defaults load without issues; coercion; rejection of bad types, enums, ranges and names; the import drop rule incl. default ids; load repair (default value / TBD / drop).

Changed: `test/tools/store.test.js` — the validation test now asserts the R11a drop rule.

```
export PATH="/c/Program Files/nodejs:$PATH"; node --test test/
ℹ tests 133  ℹ pass 133  ℹ fail 0
```

**jsdom smoke test** (outside the repo): `S\wp05smoke\smoke.js`. It inlines `js/*.js` and `data/*.js` and loads the page at `https://melonno.github.io/vtol-manual/index.html`. Result: **85 pass, 0 fail**, no script errors. It checks:
- clearing of legacy and untimed ticks, with their notices
- rows rendered from data, and ticks persisting with `ts`
- the doc-id, VTX tokens and the TBD for `videoStandard`
- the 5 copy blocks
- the 8 cards plus the note, the pills, the clean-up toggle and the jump
- "GCS APP NOT RUNNING" with a failing `fetch` (real `GcsClient`, ≥ 1 s of polling)
- a stubbed `GcsClient` fed a C2 sample: full view, `AUTO ✓` ×11, FAILSAFE → `AUTO ✗`, camera mismatch, disconnect hides the hints
- the Profiles tab: editing the active client's VTX to F1/5740 MHz and NTSC updates the checklist text; an empty name is rejected; an XSS name renders as text in the header and lists; duplicate; delete-in-use confirmations
- a settings change updates the battery emergency card
- the WP01 expiry rule

## 5. Deviations / contract issues

1. **C5 additions (additive):**
   - `postflight` (R1 asks for it), `emergencyNotes` (holds the 915 note so it is never an emergency), `clientFailsafeChain` (§6.1.5)
   - `pipelines`, `sdp`, `failsafeParams` (raw strings for WP06/WP08)
   - `version`
   - The PM may want these in `02-CONTRACTS.md`.

   **Content markup** (documented in the header of `data/content.js`): `` `code` ``, `**bold**`, `[[MODE]]` → mode badge, `[[anything else]]` → amber (`[[TBD — …]]` for every placeholder), and `{client.…}` / `{settings.…}` / `{clientPack.…}` tokens. Copy blocks are plain text.
2. **Video ports and pipelines:**
   - **`client-video.sdp` uses port 5601.** C3 fans the stream out to 5601 for standalone viewers; plan §7.4 shows 5600, which predates C3.
   - **NTSC variants scale to 640×480**, as plan §7.4 states ("NTSC … scale to 640×480").
   - All pipelines carry the plan's "verify on the target laptop" note.
3. **`sw.js` (not in my file list) — minimal change:** the three scripts `index.html` now loads (`js/gcs-client.js`, `js/render-content.js`, `data/content.js`) are added to the precache and `CACHE` is bumped to v12. Without this, the Tools page would break offline after an update. WP09 owns the full service-worker work.
4. **`js/tools-core.js` untouched:** `ToolsCore.clMigrateLegacy` is no longer called (R11c clears instead of migrating). It and its test remain; WP01/WP11 may delete it.
5. **Validation ranges** (`js/store.js` `FIELDS`) are plausibility bounds against garbage, not operating limits. I chose them (e.g. frequency 1–100000 MHz, TX power −60…60 dBm, sensitivity −200…0 dBm, sats 0–64). They cover every value `relay/map.html` writes (it writes numbers or `null`).
6. **`elrs.telemetryRatio`:** C1 gives no type. I store the integer N of "1:N", with 0 = off; the label says so.
7. **Content judgements the owner or PM should review** (each is derived from the sources, not invented):
   - App/controller card: "the app's start interlock needs the arm switch DISARMED — sending DISARMED to an airborne client would disarm it". This is the reason behind §6.1.8's "do not restart the app mid-recovery".
   - Relay PCB card: "carrier control (MP over the HM30 to the FC) does not pass through the relay PCB". From the §3.1 diagram (`AU ↔ FC`).
   - Video card: the memory item **"WAIT 10 SECONDS"** is kept from the existing manual. The §6.1.8 "within N s" is a TBD in the clean-up; the two should be reconciled once the N6 restart time is measured.
   - Transition card summary cites `Q_TRANS_FAIL` 4 s → QHOVER from plan §6.1.5, marked "confirm against the param file" (§13.1 lists it as not re-verified).
   - Callout "FPV BATT LOW — RETURNING" gives the Reference client #1 value (21.0 V, 3.5 V/cell, from the manual), because packs have no per-client threshold field.
   - `build-battery-power` keeps "power on the carrier early for GPS" (existing procedure). The new relay power-up order from §6.1.6 is a TBD, because the plan says "to be confirmed by test".
8. **Link default notes:** the default GCS link's `notes: null` (C1) is normalised to `''` on load. This is harmless; `defaults()` itself is unchanged and still matches C1 and WP02's test.
9. **Header meta** still shows static BATT 6S 7000 / CRIT VOLT 22.2 V (the WP01 layout). Only the doc-id and the new CLIENT field are dynamic.
10. **Audio cue** is per session and not persisted. A stored "on" could not play without a user gesture after reload, and the brief asks for off by default.

## 6. Notes for the verifier

- **Tests:** `node --test test/`. **Smoke:** `node S\wp05smoke\smoke.js [worktree]`, run from anywhere. It inlines `js/` and `data/` scripts (jsdom has no `file://` localStorage). It runs the real `GcsClient` with `fetch` rejecting, then a stub `GcsClient` that captures the handlers as `window.__gcsH`.
- **Link tab by hand:** open DevTools and run `linkOnConnection(true); linkOnStatus({...C2 sample...})`. The sample is in `test/content/render.test.js` `sample()`. Checklist items then show `AUTO ✓`; `linkOnConnection(false)` hides them.
- **Template update:** Profiles → Clients → EDIT → change VTX FREQUENCY → SAVE. Pre-Flight E "VTX on, correct band/channel" and Turnaround T3 change at once, and so does the header ELRS band (if changed).
- **R11c:** set `localStorage.vtol_cl2 = '{"A-0":true}'` and reload. Expect 0 ticks and the notice "…previous version had no time stamp and were cleared".
- **CSS classes the renderers need** (WP06 must provide them in `manual.html`):
  - `.card` / `.danger` / `.amber` / `.accent`, `.card-title`, `.section-title`, `.step*`, `.proc-step`
  - `.emerg-hdr`, `.emerg-imm*`, `.emerg-cleanup*`, `.emerg-cu-*`, `.emerg-card`, `.emerg-primary`, `.emerg-summary`, `.emerg-pill(.primary/.note)`, `.emerg-note*`
  - `.mbadge` + `.m-qhov` / `.m-rtl` / `.m-fbwb` / `.m-auto` / `.m-man`, `.warn-val`
  - `.fs-table` / `.fs-primary`, `.net-table`, `.co-table`, `.design-intent`
  - the globals `toggleCleanup(btn)` and `emergJump(id)`
  - Manual usage: `VtolRender.emergencies(VtolContent.emergencies, VtolContent.emergencyNotes, VtolRender.ctxFrom(VtolStore.load()))` (full cards with summaries), plus `failsafeTable`, `clientFailsafeChain`, `networkTable`, `callouts`, `designIntent`.
