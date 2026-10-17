'use strict';
// WP05 R3/R4/R8/R9: template tokens, renderer escaping, auto hints and the Link view (js/render-content.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../js/render-content.js');
const C = require('../../data/content.js');
const VtolStore = require('../../js/store.js');

const XSS = '<img src=x onerror=alert(1)>"\'';
function ctx(over) {
  const d = VtolStore.defaults();
  const c = R.ctxFrom(d);
  return Object.assign(c, over || {});
}

// A full C2 status object (contract C2 sample).
function sample() {
  return {
    time_utc: '2026-10-16T12:00:00Z',
    app: { version: '2.0.0', mode: 'fpv', streaming: true },
    controller: { connected: true, name: 'RadioMaster TX16S Joystick', arm_switch_safe: true, throttle_low: true },
    bridge: { state: 'RUN', rtt_ms: 152.4, uplink_loss_pct: 0.2, send_jitter_ms_p99: 0.8, status_age_ms: 40, timing_locked: true, sync_offset_us: 1.5, fw_version: '0.1.0', camera: { requested: false, reported: false } },
    video: { standard: 'PAL', decoder_lock: true, rx_kbps: 4200 },
    client: {
      profile_id: VtolStore.IDS.refClient, telemetry_age_ms: 120,
      link: { rssi1_dbm: -60, rssi2_dbm: -62, lq_pct: 100, snr_db: 8, rf_mode: 0, tx_power_mw: 250, dl_rssi_dbm: -70, dl_lq_pct: 100, dl_snr_db: 6 },
      gps: { lat: 59.9, lon: 10.7, alt_m: 42.0, gspd_kmh: 12.5, hdg_deg: 90, sats: 11 },
      battery: { voltage_v: 24.6, current_a: 12.1, used_mah: 320, remaining_pct: 70 },
      attitude: { pitch_rad: 0, roll_rad: 0, yaw_rad: 0 },
      flight_mode: { raw: 'ANGL', failsafe: false, armed: true, rescue_not_ready: false }
    },
    carrier: { lat: 59.9, lon: 10.7, alt_rel_m: 100, hdg_deg: 0, source: 'mavlink-readonly' },
    alarms: [{ id: 'client_failsafe', severity: 'crit', text: 'FPV FAILSAFE', since: '2026-10-16T12:00:00Z' }]
  };
}

test('ctxFrom picks the active client and its pack', () => {
  const c = ctx();
  assert.equal(c.client.name, 'Reference client #1');
  assert.equal(c.clientPack.cells, 6);
  const d = VtolStore.defaults(); d.settings.activeClientId = 'nope';
  assert.equal(R.ctxFrom(d).client, null);
});

test('tokens resolve from the profile and settings, with formatting', () => {
  const c = ctx();
  assert.equal(R.plain('{client.vtx.band}{client.vtx.channel} {client.vtx.freqMHz} MHz', c), 'R5 5806 MHz');
  assert.equal(R.plain('{client.elrs.band}', c), '2.4 GHz');
  assert.equal(R.plain('{client.failsafe.type}', c), 'GPS Rescue');
  assert.equal(R.plain('{settings.battCrtVolt} / {settings.manualRtlVolt}', c), '21.0 / 23.0');   // WP14 Rev C defaults
  assert.equal(R.plain('{settings.battLowVolt} / {settings.battArmVolt}', c), '22.0 / 24.6');
  assert.equal(R.plain('{client.name}', c), 'Reference client #1');
});

test('null / missing / unknown token → TBD (plain) and amber TBD (HTML)', () => {
  const c = ctx();
  assert.equal(c.client.videoStandard, null);
  assert.equal(R.plain('{client.videoStandard}', c), 'TBD');
  assert.equal(R.fmt('std {client.videoStandard}', c), 'std <span class="warn-val">TBD</span>');
  assert.equal(R.plain('{client.elrs.packetRateHz}', c), 'TBD');
  assert.equal(R.plain('{client.nope.deeper}', c), 'TBD');
  assert.equal(R.plain('{client.vtx}', c), 'TBD', 'objects are not values');
  assert.equal(R.plain('{client.name}', { client: null, settings: {} }), 'TBD', 'no active client');
  c.client.vtx.freqMHz = null;
  assert.match(R.checklist(C.checklists.preflight, { items: {} }, c), /<strong>R5 · <span class="warn-val">TBD<\/span> MHz/);
});

test('markup: code, bold, mode badge, amber placeholder', () => {
  assert.equal(R.fmt('a `x` **b** [[RTL]] [[TBD — y]]', {}),
    'a <code>x</code> <strong>b</strong> <span class="mbadge m-rtl">RTL</span> <span class="warn-val">TBD — y</span>');
});

test('renderer escaping: an XSS string in a profile name renders escaped everywhere', () => {
  const c = ctx();
  c.client.name = XSS; c.client.vtx.band = XSS; c.client.fc = '**bold?** `code?` [[RTL]]';
  const html = R.checklist(C.checklists.preflight, { items: {} }, c) + R.emergencies(C.emergencies, C.emergencyNotes, c) + R.callouts(C.callouts, c);
  assert.ok(!html.includes('<img'), 'no raw tag');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;'));
  assert.ok(html.includes('**bold?** `code?` [[RTL]]'), 'profile text is never interpreted as markup');
  assert.ok(!R.headerDocId({ client: { elrs: { band: XSS } } }).includes('<img'), 'unknown band → TBD');
  const link = R.linkStatus(Object.assign(sample(), { alarms: [{ id: XSS, severity: 'crit', text: XSS }], controller: { name: XSS } }), c);
  assert.ok(!link.includes('<img'));
});

test('checklist rows keep the WP01 engine structure (ids, data-list, detail, copy, auto)', () => {
  const st = { items: { 'site-airspace': { checked: true, ts: '2026-10-16T10:00:00Z' } } };
  const h = R.checklist(C.checklists.preflight, st, ctx(), { colors: { A: '#60a5fa' }, prefix: 'csp-' });
  assert.match(h, /<div class="ci done warn-item" data-id="site-airspace" data-sec="A" data-list="preflight">/);
  assert.match(h, /id="det-site-airspace"/);
  assert.match(h, /id="csp-A"/);
  assert.match(h, /class="ci-note copy-val" onclick="copyVal\(this,event\)">THR_FAILSAFE = 2/);
  assert.match(h, /<span class="ci-auto" data-auto="bridge-run" hidden><\/span>/);
  assert.match(h, /BATT_CRT_VOLT = 21\.0 {2}\(critical -&gt; Loiter to QLand HERE\)/, 'owner\'s copy block (escaped)');
  const n = (h.match(/class="ci( |")/g) || []).length;
  assert.equal(n, R.checklistItemIds(C.checklists.preflight).length);
});

test('emergency cards: compact (Tools) and full (manual); pills and the 915 note', () => {
  const c = ctx();
  const e = C.emergencies[0];
  const full = R.emergencyCard(e, c), compact = R.emergencyCard(e, c, { compact: true });
  assert.match(full, /class="emerg-summary"/);
  assert.doesNotMatch(compact, /emerg-summary/);
  assert.match(compact, /id="emerg-gcs" class="card danger emerg-card emerg-primary"/);
  assert.match(compact, /emerg-cleanup-btn/);
  assert.equal((compact.match(/emerg-imm-step/g) || []).length, e.immediate.length);
  const pills = R.emergencyPills(C.emergencies, C.emergencyNotes);
  assert.match(pills, /data-target="emerg-gcs" onclick="emergJump\(this.dataset.target\)">SIYI \/ GCS LOSS/);
  assert.match(pills, /emerg-pill note" data-target="note-915-lost"/);
  const note = R.emergencyNote(C.emergencyNotes[0], c);
  assert.match(note, /card amber emerg-note/);
  assert.doesNotMatch(note, /card danger/);
  const batt = R.emergencyCard(C.emergencies.find(x => x.id === 'emerg-batt'), c, { compact: true });
  assert.match(batt, /23\.0V → <span class="mbadge m-rtl">RTL<\/span> NOW/);
});

test('tables, callouts, design intent and post-flight render', () => {
  const c = ctx();
  assert.match(R.failsafeTable(C.failsafeTable, c), /<tr id="fs-siyi" class="fs-primary">/);
  assert.match(R.networkTable(C.network, c), /<tr id="net-bridge">/);
  assert.match(R.callouts(C.callouts, c), /"RC LINK DEGRADED"/);
  assert.match(R.designIntent(C.designIntent, c), /only link whose loss triggers a carrier failsafe/);
  assert.match(R.postflight(C.postflight, c), /Save GCS app session log/);
  assert.match(R.clientFailsafeChain(C.clientFailsafeChain, c), /T_hold/);
  assert.equal(R.headerDocId(c), 'HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 (carrier) · ELRS 2.4 GHz (client) · SIYI HM30');
});

test('auto hints (R8): ok / fail / unknown per rule', () => {
  const c = ctx(), s = sample();
  for (const id of Object.keys(R.AUTO_RULES)) assert.equal(R.autoHint(id, s, c).state, 'ok', id);
  assert.equal(R.autoHint('bridge-run', { bridge: { state: 'FAILSAFE' } }, c).state, 'fail');
  assert.equal(R.autoHint('bridge-run', {}, c).state, 'unknown');
  assert.equal(R.autoHint('client-sats', { client: { gps: { sats: 6 } } }, c).state, 'fail');
  assert.equal(R.autoHint('client-rescue-ready', { client: { flight_mode: { rescue_not_ready: true } } }, c).state, 'fail');
  // WP05 rework F4: the camera hint follows the sortie (app mode), mismatch is always ✗.
  const cam = (rq, rp, mode) => R.autoHint('camera-sortie', { app: { mode }, bridge: { camera: { requested: rq, reported: rp } } }, c).state;
  assert.equal(cam(true, false, 'fpv'), 'fail', 'requested ≠ reported');
  assert.equal(cam(false, true, 'carrier_only'), 'fail', 'requested ≠ reported');
  assert.equal(cam(false, false, 'fpv'), 'ok');
  assert.equal(cam(true, true, 'carrier_only'), 'ok', 'camera ON is the plan for a carrier-only sortie');
  assert.equal(cam(true, true, 'fpv'), 'unknown', 'camera ON in FPV mode may be planned (test 9): not a red ✗');
  assert.equal(R.autoHint('app-controller-safe', { controller: { connected: true, arm_switch_safe: false, throttle_low: true } }, c).state, 'fail');
  assert.equal(R.autoHint('client-link', { client: { link: { lq_pct: 50 } } }, c).state, 'fail');
  const pal = ctx(); pal.client.videoStandard = 'NTSC';
  assert.equal(R.autoHint('video-lock', s, pal).state, 'fail', 'standard mismatch');
  assert.equal(R.autoHint('nope', s, c).state, 'unknown');
  assert.equal(R.autoHint('bridge-run', null, c).state, 'unknown');
  assert.equal(R.autoHintLabel({ state: 'ok' }), 'AUTO ✓');
  assert.equal(R.autoHintLabel({ state: 'fail' }), 'AUTO ✗');
});

test('Link view (R7) renders every C2 group; mismatches and failsafe highlighted; nulls as —', () => {
  const c = ctx(), s = sample();
  const h = R.linkStatus(s, c);
  for (const t of ['BRIDGE', 'CARRIER CAMERA', 'CONTROLLER', 'VIDEO', 'CLIENT LINK', 'CLIENT GPS', 'CLIENT BATTERY', 'CLIENT FLIGHT MODE', 'ALARMS']) assert.ok(h.includes('>' + t + '<'), t);
  assert.match(h, /lk-badge ok">RUN</);
  assert.match(h, /152\.4 ms/);
  assert.match(h, /4\.10 V\/cell, 6S/);
  assert.match(h, /FPV FAILSAFE/);
  s.bridge.camera = { requested: true, reported: false };
  s.client.flight_mode.failsafe = true;
  const h2 = R.linkStatus(s, c);
  assert.match(h2, /MISMATCH/);
  assert.match(h2, /lk-badge crit">FAILSAFE</);
  const empty = R.linkStatus({}, c);
  assert.match(empty, /No active alarms/);
  assert.match(empty, /lk-na">—</);
  assert.doesNotThrow(() => R.linkStatus(null, null));
});

test('Link view shows app.start_path (C2.1): NORMAL, RESUME (client airborne), none', () => {
  const c = ctx(), s = sample();
  s.app.start_path = 'normal';
  assert.match(R.linkStatus(s, c), /START NORMAL/);
  s.app.start_path = 'resume';
  assert.match(R.linkStatus(s, c), /START <span class="lk-badge warn">RESUME \(CLIENT AIRBORNE\)<\/span>/);
  s.app.start_path = null;
  assert.match(R.linkStatus(s, c), /START <span class="lk-na">—<\/span>/);
  s.app.start_path = '<b>x</b>';
  assert.doesNotMatch(R.linkStatus(s, c), /<b>x/);
});
