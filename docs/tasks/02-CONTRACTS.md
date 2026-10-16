# Contracts between work packages

These interfaces let work packages run in parallel. **Conform exactly.** If a contract blocks you, implement the closest compliant version and report the problem; do not invent a private variant.

Each contract names its **owner** (the WP that implements it) and its **consumers**.

---

## C1. Shared browser data store — owner WP01; consumers WP02, WP05, WP11

All three pages share one origin (`https://melonno.github.io/vtol-manual/…`), so they share `localStorage`.

### C1.1 Module `js/store.js` (global `VtolStore`, also exported for Node)

```js
VtolStore.load()            // → store object (migrates legacy keys on first call; never throws)
VtolStore.save(store)       // persists, sets updatedAt, fires window event 'vtol-store-changed'
VtolStore.update(fn)        // load → fn(store) mutates → save; returns store
VtolStore.uid()             // short unique id string
VtolStore.defaults()        // fresh default store (includes default profiles below)
VtolStore.exportJSON()      // string; VtolStore.importJSON(str, {merge:true}) merges by id
VtolStore.KEY               // 'vtol_store'
```

### C1.2 Store shape (`localStorage['vtol_store']`, JSON)

```js
{
  schemaVersion: 2,
  updatedAt: "ISO-8601",
  archive:          [ { id, date, duration, durationMs, status, notes } ],          // preflight timer sessions
  weatherFavorites: [ { id, lat, lon, name } ],
  battLog:          [ { id, packId, date, flight, start, min, rest, time, notes, sag, source } ], // source: 'manual'|'tlog'|'bin'|'gcs'
  packs:   [ PackProfile ],
  clients: [ ClientProfile ],
  links:   [ LinkProfile ],
  settings: {
    activeClientId, activeCarrierPackId,
    battCrtVolt: 22.2, manualRtlVolt: 23.0, hardLimitVolt: 22.5,   // carrier operational thresholds (V, pack)
    storageVoltPerCell: 3.80,
    checklistExpiryHours: 6
  }
}
```

Merging rule: merge by `id`, with `updatedAt` per record if present. Deleted records are kept as `{id, deleted:true, updatedAt}` tombstones for 30 days.

**Legacy migration** (first `load()` when `vtol_store` is absent):
- `vtol_battlog` → `battLog` (assign ids, `packId` = default carrier pack, `source:'manual'`)
- `vtol_pf_archive` → `archive`
- `vtol_wx_fav` → `weatherFavorites`
- `vtol_batt_type` → the default carrier pack's cells/chem

Remove the legacy keys **only after** a successful save. **Delete** `vtol_gh_pat` and `vtol_gh_gist_id` (Gist sync is removed).

### C1.3 Profiles

```js
PackProfile   = { id, label, role: 'carrier'|'mast'|'client', cells, chem: 'lipo'|'liion'|'life',
                  capacityMah, cycles, purchased /*ISO date or ''*/, notes }

ClientProfile = { id, name, sizeIn, fc, firmware,
                  vtx:  { band, channel, freqMHz, powerMw },
                  videoStandard: 'PAL'|'NTSC'|null,          // null = TBD
                  elrs: { band: '868'|'915'|'2.4'|'gemini', packetRateHz, modelId, telemetryRatio, geminiRx: bool },
                  failsafe: { type: 'gps_rescue'|'land'|'drop', minSats, delayS },
                  packId, notes }

LinkProfile   = { id, name, kind: 'video'|'rc'|'gcs', freqMHz, txPowerDbm, txGainDbi, rxGainDbi,
                  rxSensDbm /*null = TBD*/, marginDb, antenna: 'dual_patch'|'omni'|'dipole', notes }
```

**Default profiles** created by `defaults()`:

- **Packs:**
  - "Carrier 6S 7000" — carrier, 6S, lipo, 7000 mAh
  - "Mast 6S 3000" — mast, 6S, lipo, 3000 mAh
  - "Ref client 6S 1300" — client, 6S, lipo, 1300 mAh
- **Client "Reference client #1"** (values from the current manual / `docs/FPV_betaflight_dump.txt`):
  - fc "Matek F405 STD (clone)", firmware "Betaflight 4.5.2"
  - vtx {band:'R', channel:5, freqMHz:5806, powerMw:25}
  - videoStandard: null
  - elrs {band:'2.4', packetRateHz:null, modelId:null, telemetryRatio:null, geminiRx:false}
  - failsafe {type:'gps_rescue', minSats:8, delayS:2.5}
  - packId → "Ref client 6S 1300"
- **Links:**
  - "Client video 5.8 GHz" — kind video, 5800 MHz, 14.0 dBm (25 mW), tx 2.0 dBi, rx 10.0 dBi, sens −85 dBm, margin 6 dB, antenna dual_patch. These are the current map constants plus the reference client's real VTX power.
  - "ELRS RC (set me)" — kind rc, freqMHz 2440, txPowerDbm null, gains null, **rxSensDbm null**, margin 6, antenna dipole. All TBD until the owner fills them in from the ExpressLRS docs.
  - "SIYI HM30 (set me)" — kind gcs, everything null except margin 6.

Consumers must treat `null` as **unknown**: show "TBD" and do not compute with it.

### C1.4 Extensions accepted at the WP01 merge (normative from now on)

- **`settings` extra keys:** `windGoMaxMs` (5), `windCautionMaxMs` (8), `gustMaxMs` (10), and `updatedAt` (set when the user edits a setting). Imported settings replace local ones **only** when they carry their own `settings.updatedAt` and it is newer.
- **Extra `VtolStore` helpers:** `live`, `find`, `upsert`, `remove`, `mergeStores`, `IDS` (the default profile ids — **consumers must use these ids; WP02's fallback must match them**), `importJSON.lastStats`, `takeIssues`, and `_setStorage` (tests only). `save()` returns true/false.
- **Validation:** every record and setting is validated and coerced on load and import. Invalid incoming records must **not** overwrite a valid local record. WP05 must fix the remaining case where an invalid incoming default-pack record resets local fields, and must add validation for client and link profiles when it builds their UI.

---

## C2. GCS companion app local API — owner WP08; consumers WP02 (map live layer), WP05 (Tools "Link" tab)

- **Base URL:** `http://127.0.0.1:47800`
- **Read-only.** No endpoint changes state.
- `GET /api/v1/health` → `{ "ok": true, "app": "vtol-gcs", "version": "x.y.z" }`
- `GET /api/v1/status` → the **Status object** below.
- `GET /api/v1/events` → Server-Sent Events. `event: status` with the same JSON at ≈ 5 Hz, plus `event: alarm` with an Alarm object when an alarm is raised or cleared.
- **CORS:**
  - Reflect `Origin` when it is `https://melonno.github.io`, `http://localhost:<any>`, `http://127.0.0.1:<any>` or `null` (file://).
  - Answer `OPTIONS` preflight with `Access-Control-Allow-Methods: GET`, `Access-Control-Allow-Headers: *` and **`Access-Control-Allow-Private-Network: true`**.
  - Always send `Cache-Control: no-store`.
- **Consumers:**
  - Poll `/api/v1/health` every 3 s while disconnected.
  - Use SSE when connected, and fall back to polling `/status` at 2 Hz if SSE fails.
  - Show "GCS APP NOT RUNNING" gracefully; never throw.
  - Put the shared client code in **`js/gcs-client.js`** (global `GcsClient`; **owner WP02**, also used by WP05):
    ```js
    GcsClient.start({ onStatus(s), onAlarm(a), onConnection(bool) }); GcsClient.stop(); GcsClient.BASE
    ```

**Status object** (every field may be `null` when unknown; units in names):

```json
{
  "time_utc": "ISO-8601",
  "app": { "version": "2.0.0", "mode": "fpv|carrier_only|idle", "streaming": true },
  "controller": { "connected": true, "name": "RadioMaster TX16S Joystick", "arm_switch_safe": true, "throttle_low": true },
  "bridge": {
    "state": "BOOT|WAIT_GCS|START|RUN|FAILSAFE|UNREACHABLE",
    "rtt_ms": 0.0, "uplink_loss_pct": 0.0, "send_jitter_ms_p99": 0.0, "status_age_ms": 0,
    "timing_locked": true, "sync_offset_us": 0.0, "fw_version": "x",
    "camera": { "requested": false, "reported": false }
  },
  "video": { "standard": "PAL|NTSC|null", "decoder_lock": true, "rx_kbps": 0 },
  "client": {
    "profile_id": "…", "telemetry_age_ms": 0,
    "link": { "rssi1_dbm": -60, "rssi2_dbm": -62, "lq_pct": 100, "snr_db": 8, "rf_mode": 0, "tx_power_mw": 250,
              "dl_rssi_dbm": -70, "dl_lq_pct": 100, "dl_snr_db": 6 },
    "gps": { "lat": 0.0, "lon": 0.0, "alt_m": 0.0, "gspd_kmh": 0.0, "hdg_deg": 0.0, "sats": 0 },
    "battery": { "voltage_v": 0.0, "current_a": 0.0, "used_mah": 0, "remaining_pct": 0 },
    "attitude": { "pitch_rad": 0.0, "roll_rad": 0.0, "yaw_rad": 0.0 },
    "flight_mode": { "raw": "ANGL*", "failsafe": false, "armed": false, "rescue_not_ready": false }
  },
  "carrier": { "lat": 0.0, "lon": 0.0, "alt_rel_m": 0.0, "hdg_deg": 0.0, "source": "mavlink-readonly|null" },
  "alarms": [ { "id": "client_failsafe", "severity": "warn|crit", "text": "FPV FAILSAFE", "since": "ISO-8601" } ]
}
```

### C2.1 Extensions (PM, during WP08a — normative)

- **`app.start_path`:** `"normal"` | `"resume"` | `null` (idle).
  - `"resume"` = the explicit, confirmed **RESUME (client airborne)** start. It allows streaming with the arm switch ARMED, so an app restart never disarms an airborne client.
  - The app **never** auto-resumes.
  - Pages and the manual must describe this path for "GCS app failure" recovery.
- **SSE `event: alarm` payload:** adds `"active": true|false` (raised vs cleared). The `alarms[]` array in `/status` keeps exactly the four C2 keys.

---

## C3. Relay UDP protocol v1 (PROPOSAL) — owner WP03 (spec + Python reference + test vectors); consumer WP08

The relay design defines `rc_up` and the content of the status packet but not the byte order or the other messages. This contract fixes them **as a proposal** that must be agreed with the firmware before flight. Mark it so in `protocol/README.md`.

- **Byte order:** little-endian for all multi-byte fields. Packed, no padding.
- **CRC-16:** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0), over all bytes before the CRC field.
- **CRSF CRC-8:** poly 0xD5, over type + payload (as in the relay design).
- **Ports:**
  - The bridge listens on UDP **5770**. It replies (status and forwarded frames) to the **source IP:port** of the latest valid `rc_up`.
  - Video RTP arrives at the GCS on **5600**. The app fans it out to `127.0.0.1:5601` (standalone viewer) and `127.0.0.1:5602` (Mission Planner HUD).

| Message | Dir | Layout (offset:type name) | Size |
|---|---|---|---|
| `rc_up` | GCS→bridge | 0:u8[2] magic `'R','C'` · 2:u8 ver=1 · 3:u8 flags (bit0 `CAM_ENABLE`, rest 0) · 4:u32 seq · 8:u32 t_gcs_us · 12:u8[22] ch (CRSF 16×11-bit packing) · 34:u16 crc16 | 36 |
| `status` | bridge→GCS | 0:u8[2] `'R','S'` · 2:u8 ver=1 · 3:u8 state (0 BOOT, 1 WAIT_GCS, 2 START, 3 RUN, 4 FAILSAFE) · 4:u8 flags (bit0 camera_on_readback, bit1 timing_locked, bit2 p2_link_100fd, bit3 decoder_lock*, bit4 std_ntsc*) · 5:u8 reserved · 6:u16 fw_ver · 8:u32 seq · 12:u32 t_gcs_us_echo · 16:u32 rx_ok · 20:u32 rx_bad_crc · 24:u32 rx_bad_seq · 28:u32 crsf_tx · 32:i32 sync_period_x10us · 36:i32 sync_offset_x10us · 40:u16 crc16 | 42 |
| `crsf_fwd` | bridge→GCS | 0:u8[2] `'R','F'` · 2:u8 ver=1 · 3:u8 len · 4:u8[len] raw CRSF frame (sync…crc) · 4+len:u16 crc16 | 6+len |
| `crsf_pass` (Q7a, future) | GCS→bridge | 0:u8[2] `'R','P'` · 2:u8 ver=1 · 3:u8 len · 4:u8[len] raw CRSF frame · 4+len:u16 crc16 | 6+len |

\* bit3/bit4 would need the N6 to report through the bridge. This is a future firmware request; consumers treat them as unknown unless `fw_ver` says otherwise.

**Channel scaling:** 172 = 988 µs, 992 = 1500 µs, 1811 = 2012 µs (from the relay design).

- **Mapping (PM decision, round 2 of WP03):** use the endpoint-exact linear form. It reproduces all three relay-design anchors and ELRS's 1000 µs → 191.
  - `crsf = 172 + round((us - 988) * 1639 / 1024)`, clamped 172…1811 on the **sending** side.
  - Inverse: `us = 988 + round((crsf - 172) * 1024 / 1639)`.
- Receivers (bridge, simulator, decoders) must accept **any** 11-bit value 0…2047 without error. Only the GCS sender clamps.

`protocol/test-vectors.json` (owner WP03) holds byte-exact examples for every message, used by the Python tests **and** future firmware tests.

---

## C4. Version and shared helpers — owner WP01; consumers all web WPs

- `js/version.js`: `self.VTOL_VERSION = { app: '2.0.0-dev', content: 'YYYY-MM-DD', paramFile: 'TBD' }`.
- `js/common.js` (global `VtolCommon`): `escH(str)`, `fmtTime`, `toggleCleanup(btn)`, `copyToClipboard(text) → Promise<bool>` (with fallback). Pages call these instead of private copies.

## C5. Shared content data — owner WP05; consumers WP06, WP07, WP11

- `data/content.js` (global `VtolContent`): checklists (`preflight`, `turnaround`, each item with a **stable `id`**), `emergencies` (immediate + clean-up steps, used by both the Tools modal and the manual Emergency tab), `failsafeTable`, `network` (IP/port table), `callouts`.
- Renderers live in `js/render-content.js` (owner WP05).
