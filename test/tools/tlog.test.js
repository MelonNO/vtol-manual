'use strict';
// Synthetic MAVLink .tlog records: 8-byte big-endian µs timestamp + one v1/v2 frame (CRC bytes are not checked by the parser).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

const T0 = Date.UTC(2025, 4, 1, 21, 30, 0);   // 23:30 in Oslo summer time, 21:30 UTC
const range6s = T.voltRange({ cells: 6, chem: 'lipo' });

function tsBytes(ms) {
  const us = BigInt(Math.round(ms * 1000)), b = [];
  for (let i = 7; i >= 0; i--) b.push(Number((us >> BigInt(i * 8)) & 0xffn));
  return b;
}
function v1(msgid, payload, sysid = 1) { return [0xFE, payload.length, 0, sysid, 1, msgid, ...payload, 0xAA, 0xBB]; }
function v2(msgid, payload, { signed = false, sysid = 1 } = {}) {
  const sig = signed ? [0x01, 0xFD, 0xFE, 0xFD, 0xFE, 0xFD, 0xFE, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66] : [];
  return [0xFD, payload.length, signed ? 0x01 : 0x00, 0, 0, sysid, 1, msgid & 0xff, (msgid >> 8) & 0xff, (msgid >> 16) & 0xff, ...payload, 0xAA, 0xBB, ...sig];
}
function sysStatus(mV) { const p = new Array(31).fill(0); p[14] = mV & 0xff; p[15] = mV >> 8; return p; }
function battStatus(mV, id = 0) { const p = new Array(36).fill(0); p[10] = mV & 0xff; p[11] = mV >> 8; p[32] = id; return p; }
// HEARTBEAT payload: custom_mode u32, type, autopilot, base_mode, system_status, mavlink_version
function heartbeat(armed, { type = 1, autopilot = 3 } = {}) { return [0, 0, 0, 0, type, autopilot, armed ? 0x80 | 0x01 : 0x01, 4, 3]; }
function tlog(records) { return new Uint8Array(records.flatMap(([ms, frame]) => [...tsBytes(ms), ...frame])); }

test('v1 SYS_STATUS: start/min/end voltage, duration from log span, local date', () => {
  const buf = tlog([
    [T0, v1(1, sysStatus(25100))],
    [T0 + 60000, v1(1, sysStatus(23000))],
    [T0 + 120000, v1(1, sysStatus(22600))],
    [T0 + 600000, v1(1, sysStatus(23400))]
  ]);
  const r = T.parseTlog(buf, range6s);
  assert.equal(r.startV, 25.1); assert.equal(r.minV, 22.6); assert.equal(r.endV, 23.4);
  assert.equal(r.durationSource, 'log');
  assert.ok(Math.abs(r.durationMin - 10) < 1e-9);
  const d = new Date(T0);
  assert.equal(r.date, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  assert.equal(r.frames, 4);
});

test('MAVLink 2 signed frames (incompat flag 0x01) are skipped with their 13-byte signature', () => {
  const f = T.mavFrame(new Uint8Array(v2(1, sysStatus(24000), { signed: true })), 0);
  assert.equal(f.signed, true);
  assert.equal(f.frameLen, 12 + 31 + 13);
  const buf = tlog([
    [T0, v2(1, sysStatus(25000), { signed: true })],
    [T0 + 1000, v2(1, sysStatus(24000), { signed: true })],
    [T0 + 2000, v2(147, battStatus(23500), { signed: true })],
    [T0 + 3000, v2(1, sysStatus(23800))]
  ]);
  const r = T.parseTlog(buf, range6s);
  assert.equal(r.frames, 4);
  assert.equal(r.signedFrames, 3);
  assert.deepEqual([r.startV, r.minV, r.endV], [25, 23.5, 23.8]);
});

test('MAVLink 2 truncated payload (trailing zeros removed) still decodes', () => {
  const p = sysStatus(24400).slice(0, 16);    // fields after voltage_battery were zero and got trimmed
  const r = T.parseTlog(tlog([[T0, v2(1, p)], [T0 + 1000, v2(1, p)]]), range6s);
  assert.equal(r.startV, 24.4);
});

test('duration = armed time from the vehicle HEARTBEAT base_mode bit 0x80', () => {
  const buf = tlog([
    [T0, v1(0, heartbeat(false))],
    [T0 + 1000, v1(1, sysStatus(25100))],
    [T0 + 60000, v1(0, heartbeat(true))],                       // armed at +1 min
    [T0 + 300000, v1(0, heartbeat(true, { type: 6, autopilot: 8 }), 255)],   // GCS heartbeat: ignored
    [T0 + 300000, v1(0, heartbeat(false, { type: 6, autopilot: 8 }), 255)],
    [T0 + 360000, v1(1, sysStatus(22800))],
    [T0 + 660000, v1(0, heartbeat(false))],                     // disarmed at +11 min → 10 min armed
    [T0 + 900000, v1(1, sysStatus(23300))]                      // ground time after landing
  ]);
  const r = T.parseTlog(buf, range6s);
  assert.equal(r.durationSource, 'armed');
  assert.ok(Math.abs(r.durationMin - 10) < 1e-9, String(r.durationMin));
});

test('armed until the end of the log counts up to the last record', () => {
  const buf = tlog([
    [T0, v1(0, heartbeat(true))],
    [T0 + 1000, v1(1, sysStatus(25000))],
    [T0 + 240000, v1(1, sysStatus(23000))]
  ]);
  assert.ok(Math.abs(T.parseTlog(buf, range6s).durationMin - 4) < 1e-9);
});

test('voltage filter comes from the pack (cells × chemistry); BATTERY_STATUS only for battery id 0', () => {
  const buf = tlog([
    [T0, v1(1, sysStatus(25000))],
    [T0 + 1000, v1(147, battStatus(16000, 1))],   // second battery: ignored
    [T0 + 2000, v1(1, sysStatus(3900))],          // a per-cell value: outside the 6S window
    [T0 + 3000, v1(1, sysStatus(23000))]
  ]);
  const r = T.parseTlog(buf, range6s);
  assert.deepEqual([r.startV, r.minV, r.endV], [25, 23, 23]);
  // a 4S window rejects every 6S sample
  assert.equal(T.parseTlog(buf, T.voltRange({ cells: 4, chem: 'lipo' })), null);
});

test('garbage between records is skipped (resync); fewer than two voltages → null', () => {
  const good = tlog([[T0, v1(1, sysStatus(25000))], [T0 + 1000, v1(1, sysStatus(24000))]]);
  const buf = new Uint8Array([0xFD, 0x00, 0x13, ...good.slice(0, good.length / 2), 0x55, 0xFE, ...good.slice(good.length / 2)]);
  const r = T.parseTlog(buf, range6s);
  assert.deepEqual([r.startV, r.endV], [25, 24]);
  assert.equal(T.parseTlog(tlog([[T0, v1(1, sysStatus(25000))]]), range6s), null);
});
