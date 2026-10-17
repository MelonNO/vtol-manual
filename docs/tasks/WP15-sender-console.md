# WP15 — RC sender console safety (follow-up to WP13)

- **Worktree:** `S\wt\WP15`
- **Branch:** `wp/15`
- **Files you own:** `gcs/**`, `docs/tasks/reports/WP15-IMPLEMENTATION.md`

Read first: `01-COMMON-CONTEXT.md`, `gcs/README.md`, and **`docs/tasks/reports/WP13-VERIFY-round1.md`** (MINOR finding 3, with the verifier's scripts and logs under `S\verify\WP13\`).

## Problem

When the UI spawns the RC sender, the sender's console window becomes the foreground window for about 11 s. That console acts on **single keys**:
- In production, `q` and `i` end the RC stream **with no typed confirmation**. A stray keystroke would trigger the client failsafe.
- In sim, `a` sets the fake arm switch ARMED. This probably explains the intermittent `test_ui_smoke_with_spawned_sender` failure.

## Requirements

All are MUST.

| ID | Requirement |
|---|---|
| R1 | When spawned by the UI, the sender runs **without an interactive console**: no console window (`CREATE_NO_WINDOW` or `DETACHED_PROCESS`, or `pythonw`/windowed build) and no keyboard input handling. Its output goes to the log (and is optionally visible in the UI's log view). It must not take focus. |
| R2 | In standalone headless console mode, **no single key may end or change the RC stream**. Stream-ending or mode-changing actions require the same typed confirmation as the control channel (e.g. `STOP`). Keep harmless keys (status refresh, help) single-key. `--sim`-only keys (fake arm) must also need a typed word, or be removed in favour of a test-only API. Update the README key table. |
| R3 | Tests: a spawned sender has no console and ignores stdin; a single `q`/`i`/`a` keystroke in headless mode changes nothing while streaming; the typed confirmations still work; and the UI smoke test passes repeatedly (run it at least 10 times with `VTOLGCS_UI_SMOKE=1`). |
| R4 | No regression: `pytest gcs` passes several times; the WP08a/WP08b/WP13 acceptance and the attack scripts behave as before. Never write to the real `%APPDATA%\vtol-gcs`. |
