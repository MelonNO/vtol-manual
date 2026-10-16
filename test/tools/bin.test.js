'use strict';
// Synthetic ArduPilot DataFlash (.bin): FMT records (type 0x80, 89 bytes) followed by data records.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

function str(s, n) { const b = new Array(n).fill(0); for (let i = 0; i < s.length && i < n; i++) b[i] = s.charCodeAt(i); return b; }
const SZ = { Q: 8, B: 1, M: 1, H: 2, I: 4, f: 4, Z: 64 };
function fmt(type, name, format, labels) {
  const len = 3 + [...format].reduce((a, c) => a + SZ[c], 0);
  return [0xA3, 0x95, 0x80, type, len, ...str(name, 4), ...str(format, 16), ...str(labels, 64)];
}
function rec(type, format, values) {
  const out = [0xA3, 0x95, type];
  [...format].forEach((c, i) => {
    const v = values[i], b = Buffer.alloc(SZ[c]);
    if (c === 'Q') b.writeBigUInt64LE(BigInt(v));
    else if (c === 'B' || c === 'M') b.writeUInt8(v);
    else if (c === 'H') b.writeUInt16LE(v);
    else if (c === 'I') b.writeUInt32LE(v);
    else if (c === 'f') b.writeFloatLE(v);
    else if (c === 'Z') str(v, 64).forEach((x, k) => { b[k] = x; });
    out.push(...b);
  });
  return out;
}
const BAT = [fmt(10, 'BAT', 'QBff', 'TimeUS,Inst,Volt,Curr'), 'QBff'];
const GPS = [fmt(11, 'GPS', 'QBIHB', 'TimeUS,Status,GMS,GWk,NSats'), 'QBIHB'];
const POS = [fmt(12, 'POS', 'Qf', 'TimeUS,RelHomeAlt'), 'Qf'];
const MSG = [fmt(13, 'MSG', 'QZ', 'TimeUS,Message'), 'QZ'];
const MODE = [fmt(14, 'MODE', 'QMB', 'TimeUS,Mode,ModeNum'), 'QMB'];

function sampleLog() {
  return new Uint8Array([
    ...BAT[0], ...GPS[0], ...POS[0], ...MSG[0], ...MODE[0],
    ...rec(10, BAT[1], [1_000_000, 0, 25.0, 3.0]),
    ...rec(10, BAT[1], [1_000_000, 1, 12.0, 0.5]),     // second battery monitor: ignored
    ...rec(11, GPS[1], [1_500_000, 3, 475_218_000, 2319, 14]),
    ...rec(12, POS[1], [2_000_000, 0.0]),
    ...rec(12, POS[1], [3_000_000, 55.5]),
    ...rec(12, POS[1], [4_000_000, 120.0]),
    ...rec(14, MODE[1], [2_000_000, 18, 18]),
    ...rec(13, MSG[1], [2_500_000, 'Arming <motors>']),
    ...rec(10, BAT[1], [5_000_000, 0, 23.0, 20.0]),
    ...rec(10, BAT[1], [6_000_000, 1, 11.0, 0.5]),
    ...rec(10, BAT[1], [7_000_000, 0, 23.5, 2.0])
  ]);
}

test('parseBin decodes FMT-described records; BAT keeps only the first instance (Inst 0)', () => {
  const d = T.parseBin(sampleLog());
  assert.deepEqual(d.bat.v.map(v => +v.toFixed(2)), [25, 23, 23.5]);
  assert.deepEqual(d.bat.t, [1_000_000, 5_000_000, 7_000_000]);
  assert.deepEqual(d.pos.relHome.map(v => +v.toFixed(1)), [0, 55.5, 120]);
  assert.deepEqual(d.modes, [{ t: 2_000_000, mode: 18 }]);
  assert.deepEqual(d.msgs, [{ t: 2_500_000, text: 'Arming <motors>' }]);
  assert.deepEqual([d.gps.gwk[0], d.gps.gms[0], d.gps.sats[0]], [2319, 475_218_000, 14]);
  assert.deepEqual([d.firstT, d.lastT], [1_000_000, 7_000_000]);
});

test('GPS week/ms → UTC subtracts the 18 leap seconds', () => {
  assert.equal(T.GPS_UTC_LEAP_SECONDS, 18);
  // GPS week 2319, 475 218 000 ms = 2024-06-21 12:00:18 GPS time = 12:00:00 UTC
  assert.equal(T.gpsToUnixMs(2319, 475_218_000), Date.UTC(2024, 5, 21, 12, 0, 0));
  assert.equal(T.binStartUnixMs(T.parseBin(sampleLog())), Date.UTC(2024, 5, 21, 12, 0, 0));
});

test('binBatterySeries keeps samples inside the pack window', () => {
  const d = T.parseBin(sampleLog());
  assert.deepEqual(T.binBatterySeries(d, { cells: 6, chem: 'lipo' }).v.length, 3);
  assert.deepEqual(T.binBatterySeries(d, { cells: 3, chem: 'lipo' }).v.length, 0);
});

test('chartXFractions: proportional to time, index-spread when all timestamps are equal (no divide by zero)', () => {
  assert.deepEqual(T.chartXFractions([0, 5, 10]), [0, 0.5, 1]);
  assert.deepEqual(T.chartXFractions([7, 7, 7, 7]), [0, 1 / 3, 2 / 3, 1]);
  assert.deepEqual(T.chartXFractions([7]), [0]);
  assert.ok(T.chartXFractions([3, 3]).every(Number.isFinite));
});
