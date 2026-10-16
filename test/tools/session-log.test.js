'use strict';
// WP11 R3: GCS session-log viewer logic (schema vtol-gcs-session/1, gcs/README.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

const t0 = Date.parse('2026-10-16T10:00:00.000Z');
const L = (mono, type, fields) => JSON.stringify(Object.assign({ t: new Date(t0 + mono * 1000).toISOString(), mono_s: mono, type }, fields));
const status = (mono, state, rtt, loss, lq) => L(mono, 'status', { status: { bridge: { state, rtt_ms: rtt, uplink_loss_pct: loss }, client: { link: { lq_pct: lq } } } });

function sampleLog() {
  return [
    L(0, 'session_start', { schema: 'vtol-gcs-session/1', version: '2.0.0', config: {} }),
    status(0.2, 'WAIT_GCS', null, null, null),
    L(1, 'bridge_state', { from: 'WAIT_GCS', to: 'START', fw_version: '1', rx_ok: 5, rx_bad_crc: 0, rx_bad_seq: 0 }),
    L(1.2, 'bridge_state', { from: 'START', to: 'RUN' }),
    status(1.4, 'RUN', 12.5, 0, 100),
    L(2, 'telemetry', { kind: 'flight_mode', raw: 'ANGL', failsafe: false, armed: true, rescue_not_ready: false }),
    L(2, 'telemetry', { kind: 'battery', voltage_v: 25.1, current_a: 2, used_mah: 10, remaining_pct: 100 }),
    L(2.1, 'telemetry', { kind: 'link', lq_pct: 98, rssi1_dbm: -60 }),
    status(30, 'RUN', 30.0, 2.5, 80),
    L(60, 'telemetry', { kind: 'battery', voltage_v: 21.4, current_a: 30, used_mah: 600, remaining_pct: 40 }),
    L(61, 'telemetry', { kind: 'link', lq_pct: 61 }),
    L(62, 'alarm', { id: 'client_lq_low', severity: 'warn', text: 'FPV LQ LOW', since: 'x', active: true }),
    L(64, 'alarm', { id: 'client_lq_low', severity: 'warn', text: 'FPV LQ LOW', since: 'x', active: false }),
    status(70, 'FAILSAFE', null, 100, 0),
    L(70.5, 'alarm', { id: 'bridge_failsafe', severity: 'crit', text: 'RELAY FAILSAFE <b>', since: 'x', active: true }),
    L(80, 'telemetry', { kind: 'battery', voltage_v: 22.0, current_a: 0.5, used_mah: 812, remaining_pct: 30 }),
    L(80, 'telemetry', { kind: 'flight_mode', raw: 'ANGL', failsafe: false, armed: false }),
    L(85, 'new_future_type', { x: 1 }),
    'not json',
    '{"type":"status"}',
    '',
    L(90, 'session_end', { dropped: 0, packets_sent: 1, rx: {} })
  ].join('\n');
}

test('parseSessionLog: series, timeline, alarms, robustness', () => {
  const s = T.parseSessionLog(sampleLog());
  assert.equal(s.schema, 'vtol-gcs-session/1');
  assert.equal(s.version, '2.0.0');
  assert.equal(s.bad, 2, 'invalid JSON and a record without mono_s');
  assert.equal(s.ignored, 1, 'unknown types are ignored');
  assert.equal(s.ended, true);
  assert.equal(s.durationS, 90);
  assert.equal(s.startIso, '2026-10-16T10:00:00.000Z');
  assert.deepEqual(s.rtt.v, [12.5, 30]);
  assert.deepEqual(s.loss.v, [0, 2.5, 100]);
  assert.deepEqual(s.lq.v, [98, 61], 'decoded link frames preferred over /status LQ');
  assert.deepEqual(s.battV.v, [25.1, 21.4, 22.0]);
  assert.deepEqual(s.bridgeTimeline.map(x => x.state), ['WAIT_GCS', 'START', 'RUN', 'FAILSAFE']);
  assert.equal(s.bridgeTimeline[3].end, 90);
  assert.equal(s.alarms.length, 3);
  assert.deepEqual(s.alarms.map(a => [a.id, a.severity, a.active]), [['client_lq_low', 'warn', true], ['client_lq_low', 'warn', false], ['bridge_failsafe', 'crit', true]]);
  assert.equal(s.alarms[2].text, 'RELAY FAILSAFE <b>', 'kept as text; the page escapes it');
});

test('LQ falls back to the /status value without decoded link frames', () => {
  const s = T.parseSessionLog([status(1, 'RUN', 10, 0, 90), status(2, 'RUN', 11, 0, 70)].join('\n'));
  assert.deepEqual(s.lq.v, [90, 70]);
});

test('sessionBattEntry: start/min/end, mAh used, armed duration, pack window', () => {
  const s = T.parseSessionLog(sampleLog());
  assert.equal(T.sessionArmedS(s), 78);
  const e = T.sessionBattEntry(s, { cells: 6, chem: 'lipo' });
  assert.deepEqual([e.start, e.min, e.rest, e.sag, e.usedMah, e.time, e.durationSource], [25.1, 21.4, 22, 3.7, 802, '1', 'armed']);
  assert.match(e.date, /^2026-10-1[67]$/);
  assert.equal(T.sessionBattEntry(s, { cells: 3, chem: 'lipo' }), null);
  assert.equal(T.sessionBattEntry(T.parseSessionLog(''), null), null);
});

test('sessionSummary for a flight record', () => {
  const sum = T.sessionSummary(T.parseSessionLog(sampleLog()), 'session-20261016T100000Z.jsonl');
  assert.equal(sum.kind, 'gcs');
  assert.equal(sum.rttMaxMs, 30); assert.equal(sum.lossMaxPct, 100); assert.equal(sum.lqMinPct, 61);
  assert.equal(sum.critAlarms, 1); assert.equal(sum.alarms, 2); assert.equal(sum.failsafe, true);
  assert.equal(sum.durationS, 90);
});
