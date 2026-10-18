# Implementation programme — work packages

Source of requirements: `docs/SOFTWARE-IMPROVEMENT-PLAN.md` (Rev B). Every plan item is assigned to exactly one work package (WP) below, or listed under "Not implementable in software".

Process for every WP:
1. The PM writes the brief.
2. An implementation agent works in its own git worktree/branch.
3. An **independent verification agent** checks it (`03-VERIFICATION-PROTOCOL.md`).
4. Rework until **APPROVED**.
5. The PM merges into `main`.

## Waves and ownership

Work packages in the same wave run in parallel. They never own the same file.

| WP | Title | Wave | Depends on | Main files owned | Plan items |
|---|---|---|---|---|---|
| WP01 | Tools page core: bugs, data store, shared helpers | 1 | — | `index.html`, `js/store.js`, `js/common.js`, `js/version.js`, `js/tools-core.js`, `test/tools/` | IDX-01…19, S-05, S-06, §10.3 (store/profiles), Q11, §10.7 (Tools), §10.5 (weather) |
| WP02 | Coverage map: bugs + link model v2 + live layer | 1 | — | `relay/map.html`, `relay/rfmodel.js`, `relay/vendor/`, `js/gcs-client.js`, `test/map/` | MAP-01…16, §8, MAP-06 vendoring |
| WP03 | Relay protocol spec + Python reference + bridge simulator | 1 | — | `protocol/`, `gcs/vtolgcs/protocol*.py`, `gcs/tools/bridge_sim.py`, `gcs/tests/` (protocol) | C3, §7.3 (packet), §7.7 (protocol part), §14 decoders |
| WP04 | Images and repo hygiene | 1 | — | `img/`, `scripts/`, `.gitignore`, `archive/` | §9.1, REP-01/02/04/06/08 |
| WP05 | Shared content data, Tools content for the new relay, Link tab, client profiles UI | 2 | WP01, WP02 | `data/content.js`, `js/render-content.js`, `index.html` | S-01…S-08 (Tools), §6.2, §6.1.8 (data), A-1, §14.2 UI |
| WP06 | Manual rewrite for the new relay | 3 | WP04, WP05 | `manual.html` | §4, §6.1 (all), MAN-01…15, §6.3 |
| WP07 | Diagrams and graphics | 4 | WP06, WP11 | `img/diagrams/`, SVGs in `manual.html` / `index.html` | §9.2, §9.3 D1–D15 |
| WP08a | GCS app runtime | 2 | WP03 | `gcs/` (runtime) | §7.1–7.6, §7.8, §14.2, S-02b |
| WP08b | GCS app UI, video, MP output, CRSF menu, packaging | 3 | WP08a | `gcs/` (UI etc.) | §7.4, §7.5, §7.7, §14.3/14.4/14.5, packaging |
| WP09 | Offline/PWA/field-use features | 5 | WP02, WP05, WP06, WP07, WP11 | `sw.js`, `manifest.webmanifest`, `icons/`, small hooks in pages | SW-01…04, F-1…F-8 |
| WP10 | CI, tests, docs, retirement of the Flask app | 6 | all | `.github/`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `ai/`, `docs/relay/`, `relay/app.py` etc. (delete) | Q-1…Q-5, REP-03/05/07, §6.3, A-5 |
| WP11 | Tools analysis & UX extras | 3 | WP05, WP08a | `index.html`, `js/tools-core.js` | §10.4, §10.3 (maintenance), §10.8 (Tools), §14.7 (checklist automation, battery autofill) |
| WP12 | Hotfix: line-ending robustness | — (hotfix) | — | `.gitattributes`, `test/repo-files.js` | (CI robustness) |
| WP13 | GCS app hardening (WP08b verification findings) | — (follow-up) | WP08b | `gcs/**` | §7 (control channel) |
| WP14 | Carrier parameter update (Rev C) and parameter reference | — (after WP09) | WP09 | `data/content.js`, pages, `js/store.js`, `js/tools-core.js`, `docs/reference/`, `data/params-reference.js` | §15 (Rev C), C1.6 |
| WP15 | RC sender console safety (WP13 verification finding 3) | — (follow-up) | WP13 | `gcs/**` | §7.3 |
| WP16 | RC sender follow-ups (WP15 verification) | — (follow-up) | WP15 | `gcs/**` | §7.3 |

## Not implementable in software (documented as TBD / requests instead)

- Hardware and firmware work:
  - the relay PCB
  - G0/N6 firmware, including firmware requests Q7a/Q7b and the camera-gating change
  - KSZ8795 register names
- Measurements: HM30 capacity/latency, failsafe times, glass-to-glass latency, co-site RF, S-01a SITL/bench result.
- Owner decisions still open: Q3 IPs, Q13, Q14 (Nkom spectrum check).
- New own photos of the aircraft. WP04 prepares the pipeline and placeholders.

WP10 writes these into `docs/relay/FIRMWARE-REQUESTS.md` and `docs/relay/OPEN-ITEMS.md`.

## Status board

The PM updates this table.

| WP | Impl | Verify | Merged |
|---|---|---|---|
| WP01 | done (1 rework) | APPROVED (round 2) | yes |
| WP02 | done (1 rework) | APPROVED (round 2) | yes |
| WP03 | done (1 rework) | APPROVED (round 2) | yes |
| WP04 | done | APPROVED (round 1) | yes |
| WP05 | done (1 rework) | APPROVED (round 2) | yes |
| WP06 | done | APPROVED (round 1) | yes |
| WP07 | done | APPROVED (round 1) | yes |
| WP08a | done (1 rework) | APPROVED (round 2) | yes |
| WP08b | done | APPROVED (round 1) | yes |
| WP13 | done | APPROVED (round 1) | yes |
| WP15 | done | APPROVED (round 1) | yes |
| WP16 | done | APPROVED (round 1) | yes |
| WP14 | done (2 reworks) | APPROVED (round 3) | yes |
| WP09 | done | APPROVED (round 1) | yes |
| WP10 | done (1 rework) | APPROVED (round 2) | yes |
| WP11 | done (1 rework) | APPROVED (round 2) | yes |
| WP12 | done (hotfix) | APPROVED (round 1) | yes |
| WP17 | done (1 rework) | APPROVED (round 2) | yes |
| WP18 | done (1 rework) | APPROVED (round 2) | yes |
| WP19 | done (3 reworks) | APPROVED (round 4) | yes |
| WP20 | cancelled (owner decision 2026-10-18: keep the photo in history; rewrite prepared and verified, not applied) | (round 2 rejected on minors; superseded) | no |
| WP21 | done (1 rework) | APPROVED (round 2) | yes |
| WP22 | done (1 rework) | APPROVED (round 2) | yes |

**Final state (2026-10-17):** every work package is implemented, independently verified and merged; WP10 was the last
one. The programme is complete. What remains is outside software or undecided, and is tracked
in `docs/relay/OPEN-ITEMS.md` (hardware, firmware, measurements, owner decisions, photos, deferred features, known
minor follow-ups) and `docs/relay/FIRMWARE-REQUESTS.md`. Changes per release: `CHANGELOG.md` (2.0.0).
