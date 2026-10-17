# docs/history — historical working notes

These files were the project's working notes before release 2.0.0. Until then they lived in `ai/`. They were moved
here unchanged (plan REP-05) and are kept only as a record of how the project developed.

| File | What it is |
|---|---|
| `PROJECT_CONTEXT.txt` | A snapshot of the first version: pages, tabs, parameters, known issues. It now starts with a header note that lists what is out of date. |
| `SESSION_NOTES.txt` | Decisions and changes from the early working sessions. |
| `CONVERSATION_LOG.txt` | A reconstructed log of the early working conversation. |

**They are historical and partly outdated.** Do not take values, procedures or architecture from them. In particular they
still describe:

- the old relay chain (Nomad 868 → DBR4 → Nomad 2.4, CVBS → HDMI → SIYI encoder), which was removed;
- a 4-motor airframe in places (the carrier is a 3-motor Heewing T2 Cruza: M1/M2 tilt, M4 tail);
- the pre-Rev C parameter set (for example `BATT_CRT_VOLT` 22.2 V, `BATT_LOW_VOLT` not set, a "configured but
  disabled" geofence, `Q_TRANS_FAIL_ACT` → QHOVER, the GCS failsafe "in AUTO only");
- the Flask app (`relay/app.py`), the Gist sync and the old service-worker cache scheme, all retired.

**Current sources:**

| Topic | Source |
|---|---|
| Carrier parameters | [`docs/reference/carrier-params-2026-10-17.param`](../reference/carrier-params-2026-10-17.param) ([README](../reference/README.md)) |
| Requirements, failsafe intent, Rev C values | [`docs/SOFTWARE-IMPROVEMENT-PLAN.md`](../SOFTWARE-IMPROVEMENT-PLAN.md), §1.1, §4 and §15 |
| Architecture and conventions | [`CLAUDE.md`](../../CLAUDE.md), [`README.md`](../../README.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| What changed | [`CHANGELOG.md`](../../CHANGELOG.md) |
| Relay open items, firmware requests, test results | [`docs/relay/`](../relay/README.md) |

**Privacy note.** `CONVERSATION_LOG.txt` contains personal working notes (plan REP-05). Moving it here does not remove
it from the public repository or its git history. Whether to delete it, and whether to purge it from the history, is
an owner decision; see [`docs/relay/OPEN-ITEMS.md`](../relay/OPEN-ITEMS.md).
