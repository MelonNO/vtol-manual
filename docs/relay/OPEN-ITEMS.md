# Open items

Everything release 2.0.0 could **not** implement in software, has not measured, or still needs an owner decision.
The pages show each of these as a visible amber **TBD** or **VERIFY** marker until it is closed; never replace one
with a guessed value (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)). When an item closes, record the result (in
[`TEST-RESULTS.md`](TEST-RESULTS.md) for measurements), update the content that shows the TBD, and mark the row
**CLOSED** with the date and the commit.

Sources: `docs/tasks/00-README.md` ("Not implementable in software"), plan §12 (open questions) and §15, and every
implementation and verification report in `docs/tasks/reports/`.

## Plan §12 open questions at a glance

| Question | Status | Item |
|---|---|---|
| Q2 — does the HM30 send MAVLink `RADIO_STATUS`? | open (measure) | M-3 |
| Q3 — final IPs of the N6, the bridge and the laptop; multicast through the HM30? | open (owner, at bring-up) | O-1 |
| Q7 — (a) CRSF passthrough GCS → module; (b) N6 decoder lock / standard in the status | open (firmware) | H-2, FR-2, FR-3 |
| Q12 — camera gating only while a client is connected | decided (owner); firmware change open | H-2, FR-1, O-4 |
| Q13 — measured HM30 capacity and the resulting P3 ingress limit | open (measure) | M-5 |
| Q14 — radio-spectrum compliance in Norway (Nkom) | open (owner) | O-3 |
| Q15 — S-01a: QHOVER behaviour when the 915 link drops in a manual phase | open (test) | M-1 |

## 1. Hardware and firmware — not implementable in software

| # | Item | What is needed | Shown in |
|---|---|---|---|
| H-1 | **The relay PCB** (video board + net/RC board) | Build and bring up per the relay design | whole relay chapter; all relay TBDs |
| H-2 | **G0 bridge and N6 video firmware** | Write it. The software's requests: camera client-gated policy (FR-1), Q7a CRSF passthrough (FR-2), Q7b N6 decoder lock / standard in the status (FR-3), LED patterns (FR-4), agreement on protocol v1 incl. the status packet (FR-5), VRX control via the N6 if chosen (FR-6) — see [`FIRMWARE-REQUESTS.md`](FIRMWARE-REQUESTS.md) | protocol README §10; GCS app ELRS tab "Not supported by bridge firmware (Q7a)"; `video.*` unknown |
| H-3 | **KSZ8795 register names** (port enable / camera on-off and its read-back, rate limit; the relay design took them from the KS8995 family) and the **RMII clock direction on P5** (50 MHz oscillator option) | Confirm in the KSZ8795 datasheet; then the camera status display and diagram D2 can be confirmed | protocol README §7; D2 |
| H-4 | **ELRS TX module supply** (VBAT_TX): output voltage inside the fitted module's range (Nomad XT30 6–16.8 V) and **peak current** at full power; DBR4-as-TX supply and real output power if used; relay consumption and the effect on endurance | Datasheet or measurement (bring-up, test 8) | Relay chapter power table; D11 |
| H-5 | **Antenna positions and separations** on the carrier (HM30 air unit, VRX patches, ELRS TX module, ELRS RX 915, GPS) | Document from the built aircraft (with own photos, C-1) | D9 (schematic only) |

## 2. Measurements and tests — record in [`TEST-RESULTS.md`](TEST-RESULTS.md)

| # | Item | Notes | Shown in |
|---|---|---|---|
| M-1 | **S-01a** (Q15): QHOVER when the 915 MHz link drops during a manual phase — **SITL or bench (props off)** | Expected from the parameters: no action, holds with centred sticks, drifts with the wind (plan §15.2). VERIFY until tested | manual Flight Modes (S-01a), 915 note, `fs-915`, D7 |
| M-2 | **S-02 Q-mode case**: SIYI / GCS loss in a VTOL mode → QRTL — **SITL** | Plan §15.2 states the behaviour; confirm | SIYI-loss card, `fs-siyi`, manual `#siyi-loss`, D7 (VERIFY) |
| M-3 | **S-02c / Q2**: does the HM30 send `RADIO_STATUS` (remrssi)? | MP → Ctrl+F → MAVLink Inspector | SIYI card, Flight Modes S-02c |
| M-4 | **Relay-design system tests 1–9** | After H-1/H-2 | Relay chapter acceptance table |
| M-5 | **HM30 capacity and latency** (Q13): UDP echo / RTT with video and camera off/on, throughput ceiling | Sets the N6 bitrate, the **P3 ingress limit**, D8, and the app's `alarms.rtt_max_ms` / `rtt_rise_ms` (inactive until set). Until then: **camera OFF while the client is armed** | network table, camera card, D8/D8b, GCS app alarms |
| M-6 | **Failsafe times per cause** (test 6): app stopped, HM30 unplugged, G0 reset, controller unplugged | Total = T_hold 250 ms + module reaction + client RX timeout | client failsafe chain, client RC-loss card, D6 |
| M-7 | **Glass-to-glass latency** (test 2) | `tools/latency-clock.html`, 240 fps camera, 20 samples | RF & Comms latency table, D4 |
| M-8 | **Co-site RF** (test 7): picture and RSSI with everything at full power; cleanest analog channel | — | RF & Comms co-site, D9 |
| M-9 | **Video-board restart / recovery time** | Reconcile with the video-loss card's "WAIT 10 SECONDS" memory item | video-loss card clean-up |
| M-10 | **Relay power-up order** (bench) | Checklist item `build-battery-power` and the manual's 8-step order are TBD until bench-tested | Procedures, checklist C |
| M-11 | **ELRS TX module behaviour when the handset goes silent** (relay-design risk) | If the module drops telemetry, `!FS!` never reaches the GCS and **FPV TELEMETRY LOST** is the primary alarm | client failsafe chain |
| M-12 | **On the target laptop:** Mission Planner UDP connection names and the ADS-B display; MP HUD on UDP 5602; GStreamer pipelines and `d3d11h264dec` vs `avdec_h264` latency; RC sender jitter with the UI attached (review the `SEND JITTER HIGH` threshold, WP08a m2); the frozen build (`vtol-gcs.exe` starting the sender without a console) | Each is marked VERIFY in `gcs/README.md` | GCS app README, manual pipelines |
| M-13 | **Browser access to the local API** from the HTTPS pages (private-network access to `http://127.0.0.1:47800`) in Chrome, Edge and Firefox **with the app running** | Absent-app behaviour is verified; the live case is not (WP02 §5.4) | Tools Link tab, map live layer |
| M-14 | **On a real ELRS module (after FR-2):** VTX Admin field names, 16-bit parameter byte order, the ModelID start byte (0xEE vs 0xC8) | — | ELRS tab |
| M-15 | **One unidentified GCS-suite failure (WP10 R10b):** in the implementer's first batch of five full `pytest gcs protocol` runs, one run reported "1 failed, 681 passed"; only the summary line was kept, so the test is unknown. It has not recurred since: 6 further runs by the implementer and 11 by the verifier (3 of them under full CPU load) were all green. WP17 fixed one real race (stalled handshakes) that may be it. WP18's cause may explain it too and is not ruled out: with the old 0.5 ms GIL switch interval even that 28-CPU PC starved an in-process runtime + bridge_sim to 14-18 Hz while one Python thread was CPU-bound (e.g. pytest formatting a failure; WP18 verification round 1), which can make a timing test fail. Fixed in WP18 (1 ms) | CI keeps the full log of every Windows run (artifact `pytest-logs-windows`). Since WP18 every failure's full text is written when the test fails (`+++ FAILED [time] <id>`, also `pytest-failures.txt`) and every failed id is annotated, so a recurrence names it even if the session dies later. Then fix that test and close this row | GCS app test suite |
| M-16 | **GCS tests that run only on a real desktop (WP17) — run before each release.** Marked `interactive_desktop`, skipped on CI runners (`GITHUB_ACTIONS` / `CI` set, or no interactive window station): `test_main_cli.py::test_real_console_single_keys_change_nothing_typed_words_work`, `::test_open_console_prompt_does_not_delay_a_control_stop`, `::test_console_prompt_cancelled_when_the_state_changes_events_keep_printing`, `::test_launch_resume_prompt_does_not_block_the_control_channel` (keys and Ctrl+C / Ctrl+Break into a real console); `test_ui.py::test_spawned_sender_has_no_window_takes_no_focus_and_ignores_keys` (foreground window, console keys); `test_ui.py::test_ui_smoke_*` (Tk windows; also need `VTOLGCS_UI_SMOKE=1`) | On the owner's PC, logged on, in a normal terminal (PowerShell, repo root): `python -m pytest gcs protocol -p no:cacheprovider` (full suite; the header line must say `interactive_desktop tests RUN`), then `$env:VTOLGCS_UI_SMOKE='1'; python -m pytest gcs -m interactive_desktop -v -p no:cacheprovider` (all 7 must pass, none skipped). Record the result in [`TEST-RESULTS.md`](TEST-RESULTS.md). WP18: no test may report `+++ LEAKED THREADS` (a teardown ERROR) | GCS app test suite, release |
| M-17 | **CLOSED 2026-10-17 (WP18):** F-A, F-B, F-C fixed (unanchored `Timeout \([0-9:.]+\)!` in both workflows plus teardown cases in `workflows.test.js`; `CHILDREN.keep` keeps descendants; `IsProcessInJob` before each kill), F-D documented in the `gcs/conftest.py` docstring (run pytest as its own process). Left as notes: the process-list buffer assumes 64-bit Python (the runners and the PC are 64-bit); `CREATE_BREAKAWAY_FROM_JOB` is refused under test (no product code uses it). Was: **WP17 verify round 2 minors (follow-up WP):** F-A the workflow hang annotation regex misses a GIL hang in fixture teardown (dump follows `[ 50%]` with no space; re-armed timeout prints fractional seconds `Timeout (0:00:11.984000)!`) — the log still has the dump, only the annotation lacks the test id; fix `Timeout \([0-9:.]+\)!` unanchored + a teardown case in `workflows.test.js`. F-B `CHILDREN.keep(pid)` protects only that PID, not its descendants (venv launcher). F-C job-path kill has no `IsProcessInJob` re-check (PID-reuse race of milliseconds). F-D `pytest.main()` inside a long-lived host puts the host into the kill-on-close job; process-list buffer assumes 64-bit Python | `docs/tasks/reports/WP17-VERIFY-round2.md` | GCS tests / CI |
| M-18 | **WP18 verify round 2 minors (follow-up WP):** (1) `test_control.py::test_rate_limit_refuses_the_excess_with_a_warning` has a ~9–13 ms timing margin measured with `time.monotonic` (15.6 ms ticks on Windows); it failed once in the verifiers desktop run, on main and wp/18 alike — candidate for M-15; make it deterministic. (2) A teardown still running past its budget gets `TestTimeout`, which skips that tests remaining finalisers; pytest then hands the cached, already-stopped fixture to later tests — document or hard-exit there (pre-dates WP18). (3) Document the teardown budget and the worst-case bound (≈190 s per hanging test, 200 s for a GIL hang) in the pytest header line, `gcs/README.md` and the report | `docs/tasks/reports/WP18-VERIFY-round2.md` | GCS tests / CI |

## 3. Owner decisions

| # | Decision | Notes |
|---|---|---|
| O-1 | **Q3 — final IPs** of the N6, the bridge and the laptop (proposal `.20` / `.21` / `.100`); multicast through the HM30 | Decide at bring-up; [`IP-PLAN.md`](IP-PLAN.md) lists what to update together |
| O-2 | **Q13 — P3 ingress limit** (camera cap) once M-5 is measured | Until then camera OFF while the client is armed |
| O-3 | **Q14 — Nkom radio-spectrum compliance**: 915 MHz backup link, the ELRS TX module band and power (Nomad up to 1 W per band), 2.4 GHz power, the VTX bands and powers | The RF & Comms frequency table's Nkom column is TBD on every row. Operational authorisation for remote piloting through the relay is **covered** (owner decision, plan §1.1) |
| O-4 | **Camera policy A or B** (FR-1) | Owner intent is B (gating only while a client is connected); needs the firmware |
| O-5 | **Purge the old GPS-tagged image from the git history**: `img/fpv_drone.jpg` (4.2 MB with an EXIF GPS block) was deleted in WP04, and the original full-size photos were replaced by stripped copies, but all of them **remain in the git history** | Purging needs a history rewrite and a force-push of `main` (every clone must re-clone; open PRs break). This is the one case where a force-push may be justified; it is **the owner's decision** (README "Releases and rollback" otherwise forbids force-pushes) |
| O-6 | **`docs/history/CONVERSATION_LOG.txt`** (personal working notes, plan REP-05): keep public, delete, or also purge from the history (same procedure as O-5) | Moved, unchanged, in 2.0.0 |
| O-7 | **Authorisation reference / document number** (plan §10.5) | Tools Weather airspace card shows a TBD for the reference only |
| O-8 | **Kartverket (Norgeskart) offline tile download**: allowed on its CC BY 4.0 licence, but the service's fair-use limits are not published | Keep or disable the map's download button for that layer (WP02 §5.5) |
| O-9 | **Publish the relay design document** in this repository (e.g. `docs/relay/`)? | Today it is cited by title only |
| O-10 | **Propeller rotation directions** (CW/CCW for M1, M2, M4) | No source gives them; the motor diagram shows "CW / CCW: TBD — confirm on the airframe" (WP07 §5.1) |
| O-11 | **`Q_LAND_FINAL_SPD`**: the reference param file has **0.5 m/s**; the old manual said 0.2 | WP14 corrected the manual to 0.5 from the file; confirm this is intended (WP14 §5.3) |
| O-12 | **FLTMODE expectations — RESOLVED (2026-10-17):** `FLTMODE2` = **11 (RTL)**, not reachable from the 3-position switch; the earlier "QLOITER" label was wrong. Switch positions: QHOVER (`FLTMODE1` 18) · FBWB (6) · AUTO (10) | Plan §15.1, reference param file; Tools Params tab and manual Flight Modes updated (WP14) |
| O-13 | **ELRS writes while the client may be armed**: refused by default (`crsf_menu.allow_write_while_armed` false), so a TX-power change in flight needs the option set | Alternative: a typed confirmation (WP08b §5.3) |
| O-14 | **Reference client #1 facts:** video standard (PAL/NTSC, `null` today), size 7" vs 5" (VERIFY), the meaning of `gps_rescue_landing_alt` = 4 ("motor cut at 4 m"?), GPS Rescue altitude mode CURRENT_ALT vs the 100 m return altitude (VERIFY), ELRS packet rate / model id / telemetry ratio (`null`) | Fill in through the Tools Profiles tab and `data/content.js` |
| O-15 | **VRX follow:** ELRS VRX backpack (option a) or N6 control (option b, FR-6); and which VRX is fitted | — |
| O-16 | **Release 2.0.0 — tag it:** `js/version.js` is set to `app: '2.0.0'` (PM decision, WP10). Remaining: decide the GCS app's version (`gcs/vtolgcs/__init__.py`, 0.1.0) and tag `v2.0.0` on `main` — the tag is the owner's call | Steps in [`README.md`](../../README.md) "Releases and rollback" |
| O-17 | **Maintenance intervals** for the periodic relay tests (tests 5 and 9) and where the firmware log is kept | Manual Maintenance tab TBD |

## 4. Content and media

| # | Item | Notes |
|---|---|---|
| C-1 | **Own photos** of the aircraft and the ground station replace the four vendor marketing images (`t2_vtol`, `t2_vtol2`, `matek_f405`, `siyi_hm30`) | Shot list and rules: [`img/README.md`](../../img/README.md) "Photo shot list (owner)"; run `scripts/optimize-images.py` (strips EXIF/GPS) |
| C-2 | Bridge and video-board **LED patterns** in the manual, D2, D5, D12 | After FR-4 |
| C-3 | Remaining **VERIFY** markers not tied to a test: `Q_TILT_MAX` (tilt held during the transition; fully forward in fixed-wing), `Q_ASSIST_ALT` altitude reference, `Q_FRAME_TYPE` meaning for frame class 7 | Check against the firmware in use and the ArduPilot docs |
| C-4 | P4 spare port: what may be connected, its priority and bandwidth cap | Network table, relay chapter |

## 5. Deferred features (not in 2.0.0)

| # | Feature | Notes |
|---|---|---|
| D-1 | **Norwegian / English language toggle** (plan §10.8) — **deferred** | The shared content in `data/content.js` (A-1) is the place to add translations later |
| D-2 | Coverage map: "observed edge" markers and a carrier-relative LQ heatmap (plan §14.5) | WP02 built the absolute-position heatmap only |
| D-3 | Native ELRS MAVLink path for smart clients (§14.4), advisory relay positioning (§14.7), MSP-over-CRSF profile auto-fill, debrief package | Research items |
| D-4 | Real-browser (Playwright) smoke tests (plan Q-3) | CI runs jsdom smoke tests (`test/smoke/`); offline/service-worker behaviour was verified in headless Edge during WP09/WP14 verification |
| D-5 | ES modules (A-6), phone ↔ laptop sync through the GCS app (§12 Q11) | Not needed so far |
| D-6 | A native RC-sender helper (plan §7.2) | Only if field measurements show `SEND JITTER HIGH` with the real UI (M-12) |

## 6. Known minor software follow-ups

Accepted as MINOR at verification; none affects a safety value or blocks flight. Fix when the area is next touched.

| Source | Item |
|---|---|
| WP16 verify F1 | Console: after a cancelled prompt the ignored line gives no feedback (print "ignored …", pause the status line while discarding) |
| WP16 verify F2 | Console: `logging` lines break a half-typed answer |
| WP16 verify F3 | `SENDER_OUTPUT_RE` uses `\d` (matches non-ASCII digits); use `[0-9]` |
| WP16 verify F4, F6, F7 | README wording on "files still open" (delete-sharing readers); wrong attach note with `--attach-only`; no echo when stdout is redirected |
| WP13 verify 1 | Control-channel flood by a token holder still adds a few late RC packets (below the alarm); a lower `SERVER_MSGS_PER_S` would tighten it |
| WP13 verify 2, 4, 5 | Same-user process can hold `MAX_PENDING` stalled handshakes; reliance on CPython 3.12 pipe internals (CI pins 3.12; `pyproject.toml` says ≥ 3.12); redundant `_cmd_lock` |
| WP08a verify m5 | `VTOLGCS_TEST_INSTANCE_NAME` (tests only) lets two senders run — never set it operationally |
| WP11 verify | Tools: CLEAR PARAM FILE does not propagate through import (no tombstone; C1.5); AUTO VTOL take-off counted as "transition" in the `.bin` phases; `MSG_WARN` matches inside words and shows "Failsafe Cleared" as FAILSAFE; inline styles |
| WP03 verify r2 | `gcs/tools/gen_test_vectors.py`: one redundant assignment in the `rc_cases` loop |
| WP04 verify | `watch-push.ps1` misses folder renames; `optimize-images.py` docstring says "size limits" (it checks pixels); `git-setup.ps1` appends CRLF lines |
| WP14 verify r3 | Some Tools handlers render twice (their own call, then the central refresh) — no visible effect |
| WP10 verify r2 O1 | `pytest` run raised an uncaught `TypeError` warning (not a failure) from `gcs/vtolgcs/control.py:537` (WP13 code); investigate and handle the exception |
| WP17 | **CLOSED 2026-10-17 — first green GitHub run after WP18 (commit 35affa1: GCS build 695 passed in 137 s; CI Windows ×5 all 695 passed, 131–151 s each). Cause found and fixed in WP18:** the runtime's 0.5 ms GIL switch interval (Windows waits for the GIL in whole ms, so below 1 ms the waiting threads force a switch at once and poll) collapsed on the runner's 4 CPUs once `test_concurrent_stop_and_resume_from_two_clients` had 3-6 runtimes alive; pytest then took minutes to format that test's failure, the watchdog's `TestTimeout` hit pytest's own code (`INTERNALERROR`), teardown was skipped and the runtimes kept the process busy past the step timeout. Reproduced locally with `VTOLGCS_TEST_CPUS=4` (WP18 report). Close this row when the first GitHub run after WP18 is green. Was: The GCS suite hung on GitHub's Windows runners (first run, commit b4a8aef); the cause was not reproduced locally (it passes in a non-interactive window station and in a runner-like launch). The suite now names the running test live, fails a hanging test after 120 s with a stack dump (`+++ TIMEOUT`, artifacts `pytest-logs-windows` / `pytest-logs-build`), ends a native hang that holds the GIL through faulthandler (`Timeout (h:mm:ss)!` + stacks, the test annotated), and ends a hang at interpreter exit (`+++ EXIT GUARD`, `Timeout (…)!` after `END of session`, or `+++ EXIT WATCHDOG`). The real pygame/SDL test now runs on CI too (the leading suspect). Read the next run's log; if one of these appears, fix that test and close this row |
| WP17 verify F5 | The workflow tests run the `shell: pwsh` steps with PowerShell 7 when it is installed (the runners have it), else Windows PowerShell 5.1 (the owner's PC): native-stderr handling and the `Tee-Object` encoding can differ between the two; the CI job checks them under 7 |
| WP17 guards | Not covered by the guards: a hang during collection or pytest's start-up (before the first test); only the CI step timeout ends it |
| WP18 R3 | **CLOSED 2026-10-17:** the rewritten test, including its remote-client half, passed on the GitHub runner in all six runs of commit 35affa1. `test_pipe_dacl_is_user_only_and_remote_clients_are_rejected` failed on the runner because its expected SDDL string named the user's SID, which Windows prints as the alias `LA` for the built-in Administrator account (RID 500; `runneradmin` is presumably that account: not verifiable without a runner). The test now checks the DACL ACE by ACE against the token's user SID and prints the token (user, owner, groups, elevation) and the pipe's SDDL. Its remote-client half has never run on a runner (it stopped at the first assertion before). Read the next run's log: if it fails, the printed diagnostics say why |
