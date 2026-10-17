# WP13 — GCS app hardening (follow-up to WP08b)

- **Worktree:** `S\wt\WP13`
- **Branch:** `wp/13`
- **Runs in parallel with:** WP07 (no shared files)

Read first: `01-COMMON-CONTEXT.md`, `02-CONTRACTS.md`, `gcs/README.md`, `docs/tasks/reports/WP08b-IMPLEMENTATION.md` and **`docs/tasks/reports/WP08b-VERIFY-round1.md`** (the findings below, with the verifier's attack scripts in `S\verify\WP08b\`).

## Files you own

- `gcs/**`
- `docs/tasks/reports/WP13-IMPLEMENTATION.md`

## Requirements

All are MUST.

| ID | Requirement |
|---|---|
| R1 | **Control-pipe ACL:** create the named pipe with an explicit security descriptor granting access only to the current user (and SYSTEM if needed); reject remote clients (`PIPE_REJECT_REMOTE_CLIENTS`). Test the ACL (e.g. read it back with `GetSecurityInfo` or `icacls`-equivalent). |
| R2 | **Handshake not blocking:** the authentication handshake of a new connection must not block the listener. Use a per-connection thread or overlapped I/O, with a handshake timeout (e.g. 2 s). Test that a stalled client cannot block a second, legitimate client. |
| R3 | **Rate limit** per connection (e.g. ≤ 50 commands/s; excess dropped with a logged warning) and a bounded queue. Re-measure: a token-holding flood must not push sender packets late beyond the normal jitter (report numbers). |
| R4 | **Stop/RESUME race:** after a `stop` is accepted, any later start/resume must be evaluated against the new state. No previously queued or in-flight start may execute after stop. Test with the verifier's reproduction. |
| R5 | The Revert label shows the result only after the revert outcome is known. |
| R6 | GStreamer detection is cached (re-check on demand or every ≥ 30 s), not on every redraw. |
| R7 | Fix the `video.py` docstring about stopping an orphaned fan-out, or implement it. |
| R8 | `pytest gcs` passes several times; no regression of the WP08a/WP08b acceptance (sim + sender + UI where possible). |
