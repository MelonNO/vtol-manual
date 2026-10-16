# WP05 verification — round 1
VERDICT: REJECTED

Branch `wp/05` (worktree `S\wt\WP05`), commits `9ccaaef` (implementation) and `d91701b` (report). Merge base = `main` = `1f1444a`. Verifier: independent agent; no code changed.

One MAJOR safety-content finding (F1, the GCS app / controller emergency card). Everything else passes. The code, tests, smoke test and the other content are in good shape. Only minor items remain apart from F1.

## Scope (changed files, `git diff 1f1444a..HEAD --stat`)

| File | Owned? | Judgement |
|---|---|---|
| `data/content.js` (new) | yes | — |
| `js/render-content.js` (new) | yes | — |
| `test/content/content.test.js`, `render.test.js`, `profiles.test.js` (new) | yes | — |
| `index.html` | yes | — |
| `docs/tasks/reports/WP05-IMPLEMENTATION.md` | yes | — |
| `js/store.js` | allowed by R11 (a)–(c) | OK. Adds `cleanProfile`, `validateRecord`, `FIELDS` and the import-mode drop rule. |
| `test/tools/store.test.js` | R11a says "update the test that asserts the old behaviour" | OK |
| `sw.js` | **not owned**; justified in report §5.3 | Accepted. It only adds the 3 new scripts to the precache and bumps `CACHE` to v12. Without it, Tools would break offline after an update. WP09 must keep these entries. |

## Requirement results

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 | PASS | `data/content.js:53` designIntent (identical to the §4 quote), `:60` preflight A–E with E = `CLIENT`, `:119` turnaround, `:150` postflight, `:173` emergencies, `:313` emergencyNotes, `:325` failsafeTable (= §6.1.5), `:338` clientFailsafeChain, `:353` network (§3.3 incl. TBD IPs, plus C2/C3 local ports), `:371` callouts; UMD export `:22-26` | Ids are unique and well formed (test plus my own check). The extra keys are additive (see Contracts). |
| R2 | **FAIL (MAJOR F1)** | Failsafe intent is correct everywhere: `:174-192` (SIYI first, primary, 5 s RTL any mode), `:313-322` 915 = note with close-in case and S-01a TBD, `:330` fs-915 "None — RC ignored". S-02a: `:82`, `:84`, `:185`. S-02c: `:191`. All 8 §6.1.8 scenarios exist, each with ≤ 6 immediate phrases. No forbidden terms. | **F1:** `:258` (app/controller card) gives a restart branch that disarms an airborne client and contradicts WP08a's RESUME path. Minor content items: F2–F4, F8. |
| R3 | PASS | Tokens `render-content.js:34,58-82`. Copy blocks `content.js:33-51`: viewer and MP HUD for PAL and NTSC on 5601/5602, `.26` camera, sdp, corrected param block. | null, missing or object values → `TBD` (plain) or amber TBD (HTML). Verified in jsdom and unit tests. |
| R4 | PASS | `js/render-content.js` (pure, no DOM; `escH` first, markup second, escaped tokens last `:71-77`); `index.html:620-632` uses `VtolRender.checklist` | The row markup keeps the WP01 engine. Tick, ts, details, copy, GO, expiry and recheck all work in jsdom. Inline handlers no longer interpolate ids. |
| R5 | PASS | `index.html:243`, `:634-646` renderContent, `:281-282` modal containers, `:341` post-flight | Doc-id = "HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 (carrier) · ELRS 2.4 GHz (client) · SIYI HM30" and follows the active client (868 MHz / TBD verified). All §13.3 `index.html` places are gone. |
| R6 | PASS (minor F5, F6) | Tab `:469-505`, nav `:267`, `PROF :1002`, `profSave :1149`, `profDelete :1173`, `profUses :1050` | CRUD and duplicate for clients, packs and links cover every C1.3 field, with units. The active client and carrier pack, and all 8 settings, are editable. Validation errors name the field. Deleting asks for confirmation and lists IN-USE details. |
| R7 | PASS | `index.html:457-467`, `:915-985`; `render-content.js:300-364` | All C2 groups shown. Mismatch, failsafe and LQ thresholds are highlighted. Audio is off by default, beeps once per new crit, and is per session. "GCS APP NOT RUNNING" shows with a hint. No errors with `fetch` rejecting or absent. |
| R8 | PASS (minor F4) | Rules `render-content.js:209-276`; 11 items with `auto`; `index.html:987-999` | ✓/✗/? are live with the app and hidden without it. A hint never ticks an item (jsdom). |
| R9 | PASS | `test/content/*.test.js` (31 tests) | Covers schema, ids, the `immediate` limit, forbidden terms (strings and a file grep), SIYI/915 intent, the null→TBD template, and XSS escaping across every renderer. The tests exercise real logic, not trivial asserts. |
| R10 | PASS | CSP unchanged (`index.html:6` already allows `127.0.0.1:47800`); swipe `TABS :2041` = nav order; expiry and legacy behaviour verified | html-validate shows no new rule types (counts below). Mobile: the grids use `minmax(260px)`/`minmax(180px)` and the nav scrolls. New tap targets are ≥ 44 px. |
| R11a | PASS | `js/store.js:115-134` (mode `'import'` → drop), `:434`; test `store.test.js:232-256` | jsdom: an invalid, newer record with a default pack or client id does not overwrite the local record. |
| R11b | PASS | `js/store.js:136-227` | Load: a default profile → default value, others → TBD, bad name/kind → dropped. Import and form: drop. Tests and jsdom confirm it. |
| R11c | PASS | `index.html:577-604` | `vtol_cl2`/`vtol_cl3` are cleared and removed, with a one-time notice. Untimed ticks are cleared with their own notice. Untimed ticks never count towards GO (jsdom). |
| R11d | PASS | `content.js:75` (M1/M2 tilt, M4 tail), `:186` "120m REL, above home" | "Rear pair" and "120m AGL" are absent (grep). |

## Contract results

- **C5 (owned):** `VtolContent` has checklists with stable ids, emergencies (immediate + clean-up), `failsafeTable`, `network` and `callouts`. The renderers are in `js/render-content.js`. The additive keys (`postflight`, `emergencyNotes`, `clientFailsafeChain`, `pipelines`, `sdp`, `failsafeParams`, `version`) are reasonable. The PM should record them, plus the content markup convention and the CSS class list WP06 needs (report §6), in `02-CONTRACTS.md`.
- **C1 / C1.4:** uses `VtolStore.update`, `IDS`, `live`, `find`, `upsert`, `remove`. Adds `validateRecord` and `FIELDS` (additive, report it in C1.4). R11a closes the default-id gap. `defaults()` is unchanged.
- **C1.3 `elrs.telemetryRatio`:** stored as integer N of 1:N (0 = off). C1 gives no type, so I accept this. WP08 must use the same convention; add it to C1.3.
- **C2:** `GcsClient.start({onStatus, onAlarm, onConnection})` is used as specified (`index.html:1203`). Every Status field is consumed null-safely. The alarm handling also accepts `cleared`/`active:false` (lenient, harmless).
- **C3 ports:** the viewer is on 5601, the MP HUD on 5602, and the network table says the N6 sends 5600 to the GCS. **The SDP on port 5601 is accepted**: mpv is a standalone viewer, so it must read the C3 fan-out port. Plan §7.4's 5600 predates C3.
- **NTSC 640×480:** accepted. Plan §7.4 says it literally.
- **C4:** `VtolCommon.escH`, `toggleCleanup` and `copyToClipboard` (via `copyVal`) are used. render-content keeps an identical internal `escH` so it has no load-order dependency, which is acceptable.

## Tests run (commands + results)

```
export PATH="/c/Program Files/nodejs:$PATH"; cd S/wt/WP05; node --test test/
ℹ tests 133  ℹ pass 133  ℹ fail 0
```

```
npx --prefix S/jsenv html-validate index.html     (main 1f1444a vs wp/05)
main : no-implicit-button-type 41, no-inline-style 72, prefer-tbody 1
wp/05: no-implicit-button-type 31, no-inline-style 74, prefer-tbody 1
```
There are no new rule types. +2 inline styles are on the new tab markup, which is consistent with the existing page.

```
git merge-tree --write-tree main wp/05   → clean (main is still the merge base 1f1444a)
git merge-tree wp/04 wp/05, wp/08a wp/05 → no conflicts
```

The forbidden-terms grep over `index.html`, `data/` and `js/` (Nomad relay, DBR4, hold/left button, CVBS→HDMI, HDMI→IP, `.25`, MPV RTSP / MPV.net / mpv.conf, re-bind, sub-drone, AGL, 4 motors, rear pair, FS_SHORT, 1.5 s, "AUTO only", Ranger) is clean. The remaining "AGL" hits are the pre-existing, correct "not AGL" text in the telemetry and weather code. "mpv" appears only for the `.sdp` method that plan §7.4 keeps.

## Smoke tests (what you loaded/clicked + result)

Script: `S\verify\WP05\smoke.js`. Log: `S\verify\WP05\smoke-wt.log`. The page loads at `https://melonno.github.io/vtol-manual/index.html` with `runScripts:'dangerously'` and `resources` + `requestInterceptor`, which serves the worktree files. External fonts are stubbed. **Result: 99 pass, 0 fail, no script errors in any scenario.**

1. **Fresh load:**
   - 35 pre-flight and 16 turnaround rows are built from data, with sections A–E (E = CLIENT). Post-flight is rendered from data.
   - Doc-id and the header CLIENT field are correct. VTX tokens read "R5 · 5806 MHz · 25 mW". The null `videoStandard` shows as an amber TBD.
   - The rendered text has no old-relay terms. The 5 video copy blocks (5601/5602, PAL/NTSC, sdp), the `.26` camera pipeline and the corrected param block are present.
2. **Ticking:**
   - A tick saves `{checked:true, ts:ISO}` and shows its time. The tick persists across a reload.
   - DETAILS expands and a copy block copies `192.168.144.12`. Ticking all of the turnaround gives GO.
3. **WP01 regressions:**
   - Legacy `vtol_cl2`/`vtol_cl3` ticks are cleared (not migrated), with a one-time notice that is gone after a reload, and the keys are removed.
   - An untimed tick is cleared, a timed tick is kept, and an unknown id is dropped.
   - Ticks older than 6 h are reset with the "expired" notice.
4. **Emergency modal:**
   - 9 pills: SIYI / GCS LOSS first, 915 BACKUP LOST last as a note.
   - 8 cards in the §6.1.8 set. 915 is a note, not a card. The SIYI card shows "5 s → RTL — ANY MODE".
   - The design intent is shown. The clean-up toggles, and a pill jumps to its card. The battery card's thresholds come from settings.
5. **Swipe:**
   - postflight → link → battlog, and weather → profiles; there is no swipe past the last tab.
   - There is no swipe while the modal is open or from inside an input. Nav order = swipe order.
6. **Profiles:**
   - **Editing the active client's VTX to F1/5740 MHz, NTSC and ELRS 868 updates** the pre-flight and turnaround VTX text, the doc-id (ELRS 868 MHz), the expected standard and the video emergency card. The store holds the coerced numbers.
   - An empty name and a negative frequency are rejected, the errors name the field, and the store is unchanged.
   - A new client with an XSS name, band, fc and notes is saved and made active: no element is injected, `__xss` stays unset, and the name renders as text. The doc-id shows ELRS TBD.
   - Duplicate works. Deleting the active client asks for confirmation with "IN USE … ACTIVE client". Deleting the active carrier pack asks with IN USE, and cancelling keeps the pack.
   - A new pack with an XSS label is escaped. A link with +20 dBm sensitivity is rejected; with an empty sensitivity it is saved as a null TBD.
   - The settings editor (BATT_CRT 22.0) updates the battery card and the param block. An invalid setting is ignored.
7. **Import through the page:**
   - An invalid client (channel 'x') is dropped and a valid one kept.
   - An invalid, newer record with the default client id or the default carrier-pack id does **not** overwrite the local record.
   - An imported `<b>` name is escaped on the Profiles tab.
8. **Link tab, app absent:**
   - With the real `GcsClient` and `fetch` rejecting for 1.5 s: "GCS APP NOT RUNNING" with the hint, hints hidden, no errors.
   - With no `fetch` at all: still graceful.
9. **Link tab with a stub `GcsClient` (captured handlers) fed a C2 sample:**
   - Shows the connected badge and all values: RUN, 152.4 ms, 0.2 %, jitter, LOCKED, controller name and SAFE/LOW, PAL/LOCK/kbit/s, LQ, RSSI 1/2, SNR, TX mW, sats, alt, speed, 24.60 V with 4.10 V/cell, A, mAh, %, ANGL, alarm, fw.
   - 11 × `AUTO ✓`, and the items are not ticked.
   - A failsafe sample (`!FS!`, camera mismatch, FAILSAFE, 5 sats, arm not safe) highlights MISMATCH and FAILSAFE and gives the expected `AUTO ✗`. Alarm-text XSS is escaped.
   - Audio: off by default. A test beep plays on enable, a new crit alarm beeps, and a repeated alarm does not.
   - A null-field status renders dashes. Disconnect → NOT RUNNING, hints hidden.
   - Profile NTSC vs a PAL stream → `AUTO ✗`.

## Content review (line by line against plan §1.1, §3.3, §4, §6.1.5, §6.1.6, §6.1.8, §6.2, §7.4, §14.2 and the relay design)

I traced every number in `data/content.js` to a source:
- **Existing manual / index on main:** 5 m LZ, 6S 3000 mAh mast, 25.0 V, 2 m/s, 21.0 V brown-out, 22.8 V / 3.8 V/cell / 48 h, 30+ s, GPS Rescue 30 m / 100 m / 7.5 m/s / 4 m, 60 m+ / 300 m / 3 s, 11 m/s, 2 s, LQ 70 % / −90 dBm, 21.0 V / 3.5 V/cell, 30 min, THR_FS_VALUE 950, the camera pipeline, WAIT 10 SECONDS, 915 radio RTL button.
- **Plan:** 5 s, FS_* values, BATT_FS_CRT_ACT 6, Q_TRANS_FAIL 4 s, §3.3 IPs and ports, 200–250 Hz, 36 bytes, > 2 s telemetry, 300 ms, 2 ms.
- **Relay design:** T_hold 250 ms, 5 valid packets, the state machine, decoder-lock LED, XT30 power-in, JST-GH, tests 6 and 9.
- **C2/C3:** 47800, 5601/5602.

**I found no invented number.** The unknowns are visible amber `[[TBD — …]]`: Q-mode RTL, remrssi, client failsafe time, video N s, LED patterns, P3 limit, P4, N6/bridge IPs, laptop IP, ELRS TX silent behaviour, RTT thresholds, S-01a, the power-up order.

**Owner's failsafe intent: correct everywhere.**
- SIYI/GCS loss is the only carrier failsafe: RTL after FS_LONG_TIMEOUT 5 s in all modes, with the causes (MP closed, sleep, cable).
- 915 loss → none: THR_FAILSAFE = 2, a note rather than an emergency, with the close-in case "take over in MP — QLOITER / QLAND" and S-01a as TBD.
- S-02a is in pre-flight C, the SIYI card and MP connect. S-02c is a TBD in the SIYI clean-up.
- The client failsafe chain matches §6.1.5. The camera being forced off on GCS loss matches the relay design.

Implementer-flagged items (report §5.7):

| Item | Judgement |
|---|---|
| (a) App/controller card, "start interlock needs DISARMED" | **MAJOR, F1.** Unsafe ambiguity, and it contradicts WP08a's RESUME (client airborne) path. |
| (b) Relay PCB: "carrier control does not pass through the relay PCB" | **Correct.** Plan §3.1 shows `AU <--> FC` directly. In the relay design the HM30 Ethernet goes to P1 only, and the N6 UART-to-FC "MAVLink" is just a spare-pin example use. "The carrier flies on normally" is slightly over-confident; see F3 (minor). |
| (c) Video card: "WAIT 10 SECONDS" vs §6.1.8 "N s" TBD | Not invented (existing memory item) and conservative, but the two values on one card disagree. **Minor, F2.** |
| (d) Transition card: Q_TRANS_FAIL citation | Sourced from plan §6.1.5 and the existing manual, and the card carries "confirm against the param file". The failsafe-table row does **not** carry the caveat, although §13.1 lists `Q_TRANS_FAIL` as not re-verified. **Minor, F8** (see the note there). |
| Header "FPV BATT LOW" uses Reference client #1 21.0 V | Acceptable; it is labelled as the reference client. |
| `build-battery-power` keeps "power on early", with the new power-up order as TBD | Acceptable (§6.1.6 says "to be confirmed by test"). |

Judgement of the implementer's deviations:

| Deviation | Judgement |
|---|---|
| `sw.js` precache + v12 | Accepted (minimal, needed for offline use). |
| `js/store.js` | Accepted (R11). |
| Additive C5 keys | Accepted; the PM records them in the contract. |
| SDP 5601 | Accepted (C3 fan-out). |
| NTSC 640×480 | Accepted (plan §7.4). |
| Validation ranges | Accepted. They are plausibility bounds that reject garbage only, and every value `relay/map.html` writes passes. |
| `telemetryRatio` as N | Accepted; record it in C1.3 for WP08. |

## Findings

1. **F1 — MAJOR — `data/content.js:253,258` (emergency card `emerg-app`, "GCS App / Controller Failure").**
   - **What is wrong:**
     - Clean-up step 2 reads: *"Restart the app only once the client is on the ground, **or if it is still controllable**. The app's start interlock needs the arm switch DISARMED — sending DISARMED to an airborne client would disarm it."*
     - The only start path the card describes needs the arm switch DISARMED. The card also allows a restart while the client is airborne ("or if it is still controllable"). Followed literally, that restart's first packets disarm the client in mid-air.
     - It also states as fact that the app's start interlock needs DISARMED. That contradicts the PM-ordered WP08a **"RESUME (client airborne)"** start path, which is already implemented on `wp/08a` (`gcs/README.md` "Modes and interlocks" rule 3): the pilot holds the arm switch ARMED, sees a live-value preview, types a `RESUME` confirmation, and a second `THROTTLE` confirmation is needed at minimum throttle.
     - The pilot is never directed to that path.
     - This is safety-critical operational content: it describes a procedure that can disarm an airborne client.
   - **Expected:** the clean-up must separate the two start paths unambiguously. For example:
     - "Client on the ground: normal start (arm switch DISARMED, throttle low)."
     - "Client airborne: **never** use the normal start — its first packet would disarm the client. Restart only with **RESUME (client airborne)**: arm switch ARMED, check the live arm/throttle preview, confirm. Only if the client is not already safely returning in its own failsafe."
     - Keep the immediate item "DO NOT RESTART APP MID-RECOVERY", or refine it in line with plan §6.1.8 ("unless the client is still controllable").
     - Refer to the RESUME path by its WP08a name. If the PM wants WP05 independent of WP08a's wording, a visible `[[TBD — RESUME procedure, WP08a]]` marker is acceptable.
     - Add a content test that the card does not pair an airborne restart with the DISARMED start.

2. **F2 — MINOR — `data/content.js:218` vs `:224` (video loss card).** The memory item "WAIT 10 SECONDS → STILL LOST: CLIENT RETURN HOME" and the clean-up "continue only if it returns within [[TBD — N s]]" give two different decision times on one card. 10 s comes from the existing manual and is not invented, but the clean-up should say that 10 s is the interim value until the video-board restart time is measured, so the pilot is not left with two rules.

3. **F3 — MINOR — `data/content.js:242` (relay PCB card).** "Carrier control … does not pass through the relay PCB — the carrier flies on normally" is right about the control path. But a relay fault that floods P1 or the HM30, or loads the shared supply, could still take the SIYI link down. Suggest adding: "if MP telemetry also drops → SIYI / GCS LOSS card".

4. **F4 — MINOR — `data/content.js:138` (`ta-camera`, `auto:'camera-off'`), also `:105`.**
   - The `camera-off` rule shows `AUTO ✗` whenever the camera is ON.
   - `ta-camera` says "re-enable … only if the sortie plan needs it", so a correctly planned camera-ON sortie (carrier-only, or after test 9) shows a red hint.
   - Suggest an `unknown` result when the camera is ON and requested = reported, or a rule that only checks requested = reported for `ta-camera`.

5. **F5 — MINOR — `js/store.js:126-127` via `profSave` (`index.html:1149`).**
   - In the pack form, an invalid capacity (e.g. −5) is silently saved as `null` and invalid cycles as `0`. `cleanPack` coerces these instead of rejecting them, so no field error is shown.
   - Clients and links do reject such values.
   - This is inconsistent with "with validation"; consider rejecting in import/form mode.

6. **F6 — MINOR — `index.html:1173-1190` (`profDelete`).** Deleting the active client silently makes the first remaining client active. That client then drives the checklists and header, but the confirmation doesn't say so. Suggest naming the replacement in the confirmation, or setting the active client to none (TBD).

7. **F7 — MINOR — S-02b is not mentioned in any content.** The plan places S-02b on the GCS app, so it is optional here. A one-line note in `gs-mp-connect` or the SIYI clean-up would close the documentation gap for operators running other MAVLink tools on the laptop: "no other MAVLink GCS may run as sysid 255 — it would mask the SIYI failsafe".

8. **F8 — MINOR — `data/content.js:333` (failsafe table `fs-trans`) and `:279`.**
   - Plan §13.1 lists `Q_TRANS_FAIL` as "not re-verified".
   - The card has "confirm against the param file", but the table row states "`Q_TRANS_FAIL_ACT` → QHOVER" without a marker.
   - Verifier's note, from recollection, to be checked: in current ArduPlane, `Q_TRANS_FAIL_ACT` takes -1 Warn only / 0 QLand / 1 QRTL. If so, the manual's "0 = QHOVER" is wrong and the automatic action would be QLand.
   - Suggest a visible `[[verify — param file (§13.1)]]` on the row and an owner check. This affects WP06 too.

9. **F9 — MINOR — housekeeping.**
   - `ToolsCore.clMigrateLegacy` and its test are now dead code (WP01 file; the report says so). The PM should assign its removal (WP11).
   - The header meta "CRIT VOLT 22.2V" and `pf-carrier-pack` "22.8V (3.8V/cell)" are static, although `battCrtVolt` and `storageVoltPerCell` are editable settings. The report discloses the header meta; consider tokens.
   - The content carries over the manual's own inconsistency between "no airspeed build after 2s" (callout) and "in 3s" (transition card / §6.1.6).
   - New CSS uses the page's existing dark tints (`#1f1a08`, `#1a1206`, `#1a0e0e`), plus `#fff` and a `#f97316` fallback in `render-content.js:106`. This is consistent with the existing page, but not variables.

10. **F10 — MINOR — contracts.** The PM should add the C5 additive keys, the content markup, the renderer CSS class list, `VtolStore.validateRecord`/`FIELDS` and the `telemetryRatio` = N (0 = off) convention to `02-CONTRACTS.md`.

## Approval rationale or list of BLOCKER/MAJOR items that must be fixed

**REJECTED.** One MAJOR finding must be fixed:

- **F1:** the GCS app / controller emergency card allows a mid-flight app restart through a start path that sends DISARMED, which would disarm an airborne client. It also contradicts the WP08a "RESUME (client airborne)" path. Rewrite the clean-up as described in F1 and add a test.

Apart from F1, WP05 meets every MUST requirement:
- 133/133 unit tests pass and 99/99 jsdom checks pass, with no script errors.
- There are no invented numbers, the failsafe intent is correct throughout, and the forbidden-terms grep is clean.
- The branch merges cleanly into `main`, and the implementation report is accurate.

F2–F10 are minor. The implementer should fix F2, F4 and F8 together with F1, because they are small content and rule edits.
