# WP03 verification — round 2
VERDICT: APPROVED

Verifier: the same independent verification agent as round 1.
- Worktree `S\wt\WP03`, branch `wp/03`, HEAD `147d03f`.
- Rework commits: `8f5ea86` (code, vectors, tests) and `147d03f` (report).
- Diff of the rework: `git diff 5aea504 HEAD`. Round-1 base: `5a2377e`. Date 2026-10-16.

## Scope

The rework changes 10 files, all already in WP03's scope (owned, or extra files justified in round 1):
- `protocol/README.md`, `protocol/test-vectors.json`
- `gcs/vtolgcs/{protocol,crsf}.py`, `gcs/tools/bridge_sim.py`, `gcs/tools/gen_test_vectors.py`
- `gcs/tests/test_{protocol,crsf,bridge_sim}.py`
- `docs/tasks/reports/WP03-IMPLEMENTATION.md`

`docs/tasks/02-CONTRACTS.md` is not edited in the branch. The implementer correctly left it to the PM's copy on `main`.

Both commits carry the `Co-Authored-By` trailer, plus the `Claude-Session` trailer (accepted by the PM).

## Requirement results

R2, R3 and R5 to R9 are unchanged from round 1 except where noted. Only the deltas are re-evidenced here.

| ID | Result | Evidence | Note |
|---|---|---|---|
| R1 MUST | PASS | README §4 `:123-138` (new scaling, sender/receiver rules), §3.2 `crsf_tx` row `:91`, changelog row `:288` | Banner, CRCs, state machine, camera policies and versioning are unchanged and still correct |
| R2 MUST | PASS | `protocol.py`: `us_to_crsf` `:151`, `crsf_to_us` `:166`, `pack_channels(strict=True)` `:176`, `RcUp.pack(strict=True)` `:255` | Scaling now matches C3 on `main` exactly (see Contract results). Validation still raises `ProtocolError` subclasses |
| R3 MUST | PASS | `crsf.py:300` `build_rc_channels_frame_raw`; `build_rc_channels_frame(strict=...)` `:289` | My independent check of the new builder vector `rc_raw_0_2047`: packing `00F83F…E0FF` and CRC-8 `0x97` both match |
| R4 MUST | PASS | `crsf.py:598` `"!FS!" in text` | Matches the "contains" wording of plan §14.2. `armed = no suffix and not failsafe` is unchanged |
| R6 MUST | PASS | regenerated `test-vectors.json` | New vectors:<br>• `crsf_to_us` section (13 items) and `us_to_crsf` (15 items)<br>• `rc_up/raw_channels_0_and_2047` and `raw_channels_elrs_extended_limits`<br>• builder `rc_raw_0_2047`<br>• `crsf_pass_truncated` and `crsf_pass_header_only`<br>`--check` → `up to date` |
| R7 MUST | **PASS** (F1 fixed) | `bridge_sim.py:200` stores the raw `ch` bytes; `:249` builds the RC frame from them unchanged; `:728-731` the runner logs and survives unexpected exceptions | F1 crash probe re-run: see Smoke tests |
| R8 MUST | PASS | 343 tests; all UDP waits go through `TestClient.expect()` with a full diagnostic dump (`test_bridge_sim.py:473/:498`) | New tests are meaningful:<br>• fake-clock 0/2047, all-0 and all-2047 in RUN (`:105`)<br>• UDP raw extremes (`:685`)<br>• injected runner exception (`:701`)<br>• scaling anchors, round trip and monotonicity<br>• non-strict packing; strict sender vs lenient receiver<br>No flakiness in 23 full-suite runs |
| R9 SHOULD | PASS | `--selftest` → `SELFTEST OK` | |

## Contract results (C3 on `main`, PM decision)

**Contract text** (`git show main:docs/tasks/02-CONTRACTS.md`, C3 "Channel scaling"):
- `crsf = 172 + round((us-988)*1639/1024)`, clamped on the sending side.
- `us = 988 + round((crsf-172)*1024/1639)`.
- Receivers accept 0..2047.

**Implementation:** `protocol.py:151-174` is exactly this, with round half-up.

**Independent check** (`S\verify\WP03\scaling.py`): exact `Fraction` arithmetic, no float, no `vtolgcs` in the oracle. **0 failures** in:
- the anchors 988→172, 1000→191, 1500→992, 2000→1792, 2012→1811;
- all 15 `us_to_crsf` and all 13 `crsf_to_us` vectors;
- exact round trip for every integer µs from 988 to 2012;
- reference `us_to_crsf` against the oracle for every integer µs from 800 to 2199 **and** every 0.1 µs step from 800.0 to 2199.9;
- reference `crsf_to_us` against the oracle for every value 0..2047.

**Rounding ties.** The README says 1500 µs is the only tie and that CRSF → µs has no ties. Both claims are correct:
- 1639 is odd, so `(us−988)·1639 ≡ 512 (mod 1024)` only when `us−988 ≡ 512`, i.e. 1500 µs within range. Half-up maps it to 992, the C3 anchor.
- For CRSF → µs the denominator 1639 is odd, so a result of x.5 is impossible.

**Extended-value claims** were checked against the primary sources fetched in round 1:
- 1984 → 2120 µs is ELRS `US_CHANNEL_VALUE_EXT_MAX` (`crsf_protocol.h:16,25`).
- 0 → 881 µs matches Betaflight `rx/crsf.c:624-627` (`0.62477…·v + 881`).

**Receivers accept 0..2047:**
- `RcUp.unpack` and `unpack_channels` are lenient.
- The bridge forwards the raw bytes.
- `pack_channels(strict=False)` allows 0..2047 and still rejects −1 and 2048.

**No byte layout changed.** My bit-serial checker (`indep.py`, unchanged from round 1) passes **103/103** on the regenerated vectors. That is the 101 round-1 checks plus the two new raw `rc_up` vectors, rebuilt byte for byte, including the 0/2047 and 0/1984 channel sets.

## Tests run (commands + results)

**Full suite:** `S\venv\Scripts\python.exe -m pytest gcs -q -p no:cacheprovider`, run from the worktree root.
- 10× sequential: all `343 passed`, 9.5–9.6 s each. One run took 12.9 s but still passed, probably because the host was busy.
- 6 × 2 runs in parallel (12 runs): all `343 passed`.
- **Total: 22/22 green.**

**Merged tree:** `343 passed`.

**Other checks:**
- `python gcs/tools/gen_test_vectors.py --check` → `up to date`.
- `cd gcs && python -m vtolgcs.protocol --selftest` → `SELFTEST OK`.
- Independent checks: `scaling.py` FAILS 0, `indep.py` FAILS 0 (103 OK), plus a separate check of the raw RC builder vector.

## Merge check

`git merge-tree --write-tree main HEAD` gives a **clean** tree, `56e0435`.
- `main` (now `071d794`, with WP01 and WP04 merged and the C3 update) and `wp/03` change **no files in common**.
- I extracted `gcs/` and `protocol/` from the merged tree into `S\verify\WP03\merged\` and ran pytest there: `343 passed`.

## Smoke tests

**F1 crash probe** (`S\verify\WP03\probe_f1.py`). It builds `rc_up` by hand, without `vtolgcs`, with CH = [0, 2047] × 8 and a correct CRC-16.
- Target: the CLI simulator `bridge_sim.py --port 5784 --telemetry-hz 5`.
- Run 1: WAIT_GCS → START → RUN; `crsf_tx` rose to 1617, i.e. RC frames were sent the whole time; then FAILSAFE → WAIT_GCS when the stream stopped.
- Run 2, the same probe: START → RUN → FAILSAFE → WAIT_GCS again.
- Run 3, a normal stream (`client.py`): RUN with camera on, then FAILSAFE.
- The process was **still alive** at the end, and the log has no traceback or exception (`sim_f1_r2.log`).

**In-process pass-through** (fake clock). Channel sets tested: [0, 2047]×8; [0, 1984, 992…]; and all channels = 5.
- In RUN, `last_rc_frame[3:25]` equals the received 22 `ch` bytes.
- The header is `EE 18 16`, the frame parses, and `decode_rc_channels` returns the sent values.

**State machine and camera policies.** Re-ran my round-1 client (`client.py`) under both policies. Identical behaviour to round 1:
- START at rx_ok = 9, meaning exactly 5 consecutive packets after the gap reset;
- ModelID ×3, then RUN;
- FAILSAFE about 255 ms after the last packet, then WAIT_GCS;
- design policy: camera off before the stream, follows CAM_ENABLE in RUN, off after loss;
- client-gated policy: camera **on** before the first stream, follows CAM_ENABLE in RUN, off after loss.

**RTT echo:** unchanged code path; covered by `test_udp_status_rate_and_rtt_echo` (≥ 90 ms with 100 ms injected latency).

## MINOR fixes from round 1

| Round-1 finding | Result | Evidence |
|---|---|---|
| F2 UDP test diagnostics | FIXED | `expect()` dumps the state runs, last status, flight-mode runs, simulator transitions, counters, reply address and whether the thread is alive. Timeouts raised to 8 s (10 s for telemetry). 22 green full runs |
| F3 `crsf_tx` counts passthrough | FIXED | `bridge_sim.py:668`; the test asserts `crsf_tx == 2` with no RC stream; the README row is updated |
| F4 `-v` | FIXED | `-v` gives DEBUG (`DEBUG reject rc_up: CrcError …` seen for a bad packet); without it the same packet logs nothing; the dead code is removed |
| F5 `_now_hint` | FIXED | `run_age(now)` and `timing_locked(now)` take `now` explicitly (`:253/:257`); no leftover references |
| F6 `!FS!` contains | FIXED | `crsf.py:598`; tests `X!FS!` and `!FS!*` |
| F7 console encoding | FIXED | The banner is ASCII (0 non-ASCII bytes in the log); stdout/stderr use `errors="backslashreplace"` |
| F8 truncated `crsf_pass` | FIXED | 2 new `LengthError` vectors |

## Findings (new, round 2)

1. **MINOR: a redundant line in the vector generator.**
   - **Where:** `gcs/tools/gen_test_vectors.py`, the `rc_cases` loop.
   - **What:** for the `raw_channels_*` cases, `item["hex"]` is computed once with `strict=not name.startswith(...)` and then assigned again inside the `if name.startswith("raw_channels")` block. Harmless.
   - **Expected:** keep one of the two.

2. **MINOR (info): `gcs/.gitignore` is now redundant.**
   - **Where:** `gcs/.gitignore`.
   - **What:** `main`'s root `.gitignore` now covers `__pycache__/`, `*.pyc`, `.pytest_cache/`, `gcs/build/` and `gcs/dist/`, so the 6-line `gcs/.gitignore` duplicates it. It is harmless and does not conflict.
   - **Expected:** the PM may drop it later (e.g. in WP10).

3. **Note: the runner now swallows all exceptions.**
   - **Where:** `bridge_sim.py:728-731`.
   - **What:** the runner catches every exception and logs it with a traceback. This is the right behaviour for a long-running simulator. A future simulator bug would then show up as a logged traceback rather than a dead thread. The UDP tests would still catch functional breakage through `expect()`.
   - **Expected:** no change required.

There are no BLOCKER or MAJOR findings.

**Safety content:**
- No new invented numbers. The scaling constants come from C3, the relay design and ELRS; the extended values come from ELRS and Betaflight.
- The TBD placeholders are unchanged.
- Nothing touches the failsafe intent.

**Report honesty:** "Rework round 1" (§7) is accurate. Spot-checked:
- the line references `:200`, `:249`, `:668`, `:731`, `protocol.py:151/:166/:176/:255` and `crsf.py:300/:598`;
- the count of 343 tests;
- the claim that the CLI re-probe stays alive, which I reproduced on another port.

## Approval rationale

**APPROVED.**
- The round-1 MAJOR, F1, is fixed. The simulator now forwards any 11-bit channel payload unchanged, as the G0 will. It survives CH = 0/2047 in RUN on the CLI, in-process and over UDP, and new tests cover all three.
- Channel scaling matches the PM's C3 decision exactly. This is confirmed by exact-rational oracle comparison over the whole input range, and all five anchors hold.
- All MINOR findings from round 1 are fixed.
- The independent CRC-16, CRC-8 and packing comparisons pass on the regenerated vectors.
- 22/22 full-suite runs passed (343 tests), including runs in parallel pairs.
- `wp/03` merges cleanly into the current `main` with no overlapping files, and the merged tree passes.

The two remaining MINOR items are cosmetic and may stay.
