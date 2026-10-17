# WP16 — RC sender follow-ups (from the WP15 verification)

- **Worktree:** `S\wt\WP16`
- **Branch:** `wp/16`
- **Files you own:** `gcs/**`, `docs/tasks/reports/WP16-IMPLEMENTATION.md`
- **Runs in parallel with:** WP14 (no shared files)

Read first: `01-COMMON-CONTEXT.md`, `gcs/README.md`, `docs/tasks/reports/WP15-IMPLEMENTATION.md` and **`docs/tasks/reports/WP15-VERIFY-round1.md`** (findings F1–F5, with scripts under `S\verify\WP15\`).

## Requirements

| ID | MUST/SHOULD | Requirement |
|---|---|---|
| R1 | MUST | **F1:** a console prompt waiting for a typed word must never block the runtime main loop. A STOP (or any other accepted command) from the control channel takes effect immediately, even while a console prompt is open. Console alarms and events keep printing, or are queued and flushed. Use a non-blocking or threaded console reader. A pending console prompt is cancelled (with a message) if the state changes underneath it. Test: an open prompt plus a UI STOP → streaming stops within 100 ms. |
| R2 | MUST | **F3:** when the UI was started with `--resume` or `--mode carrier_only` and the sender refuses, the UI shows the refusal in Events (with the reason) instead of only logging it. |
| R3 | SHOULD | **F2:** handle Ctrl+Break like Ctrl+C (STOP gate) where Windows allows it. Document what cannot be caught (closing the console). |
| R4 | MUST | **F4:** make the Ctrl+C tests deliver the event for real (no inherited ignore flag) and assert the prompt appears. |
| R5 | MUST | **F5:** rotate or delete `sender-*.log` files: keep the last N (config, default 20) and/or cap the total size; never delete the current file. |
| R6 | MUST | No regression: `pytest gcs` several times, UI smoke 10× with `VTOLGCS_UI_SMOKE=1`, and the earlier acceptance, attack and race scripts. Never write to the real `%APPDATA%\vtol-gcs`; clean up any `bridge_sim` you start. |
