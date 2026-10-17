'use strict';
// WP11 R2: .bin transitions, assist / failsafe / battery events, max current per phase, battery entry. Synthetic records.
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
const S = 1_000_000;
const BAT = 'QBff', ARSP = 'Qf', MODE = 'QMBB', MSG = 'QZ', GPS = 'QBIHB';
const HDR = [fmt(10, 'BAT', BAT, 'TimeUS,Inst,Volt,Curr'), fmt(11, 'ARSP', ARSP, 'TimeUS,Airspeed'),
  fmt(12, 'MODE', MODE, 'TimeUS,Mode,ModeNum,Rsn'), fmt(13, 'MSG', MSG, 'TimeUS,Message'), fmt(14, 'GPS', GPS, 'TimeUS,Status,GMS,GWk,NSats')].flat();

// QHOVER 0–10 s (VTOL) → FBWB at 10 s (forward transition; airspeed 11 m/s at 13.5 s) → AUTO 20 s → QLAND at 40 s
// by battery failsafe (Rsn 4) → QHOVER at 45 s with reason VTOL_FAILED_TRANSITION (23).
function flightLog(opts) {
  opts = opts || {};
  const b = [...HDR, ...rec(14, GPS, [S, 3, 475_218_000, 2319, 14])];
  b.push(...rec(12, MODE, [S, 18, 18, 1]));
  const cur = { 2: 30, 5: 42, 11: 55, 12: 60, 15: 18, 25: 22, 41: 48 };
  for (let s = 1; s <= 50; s++) b.push(...rec(10, BAT, [s * S, 0, 25.0 - s * 0.05, cur[s] || 10]));
  b.push(...rec(12, MODE, [10 * S, 6, 6, 1]));
  if (!opts.noArsp) [[10, 2], [11, 5], [12, 8], [13.5, 11.2], [15, 13]].forEach(([s, v]) => b.push(...rec(11, ARSP, [Math.round(s * S), v])));
  if (opts.doneMsg) b.push(...rec(13, MSG, [12.5 * S, 'Transition done']));
  b.push(...rec(13, MSG, [18 * S, 'Alt assist 24.0m']));
  b.push(...rec(12, MODE, [20 * S, 10, 10, 2]));
  b.push(...rec(13, MSG, [39 * S, 'Battery 1 is critical']));
  b.push(...rec(12, MODE, [40 * S, 20, 20, 4]));
  b.push(...rec(12, MODE, [45 * S, 18, 18, 23]));
  b.push(...rec(13, MSG, [46 * S, 'Arming checks passed']));
  return new Uint8Array(b);
}

test('parseBin keeps current with timestamps and the MODE reason', () => {
  const d = T.parseBin(flightLog());
  assert.equal(d.cur.t.length, 50);
  assert.equal(d.cur.a[1], 30);
  assert.deepEqual(d.modes[0], { t: S, mode: 18, reason: 1 });
});

test('modeClass: Q-modes are VTOL, others FW, INITIALISING unknown', () => {
  assert.equal(T.modeClass(18), 'vtol'); assert.equal(T.modeClass(23), 'vtol');
  assert.equal(T.modeClass(6), 'fw'); assert.equal(T.modeClass(10), 'fw'); assert.equal(T.modeClass(25), 'fw');
  assert.equal(T.modeClass(16), 'unknown'); assert.equal(T.modeClass(99), 'unknown');
  assert.equal(T.PLANE_MODES[11], 'RTL'); assert.equal(T.PLANE_MODES[19], 'QLOITER');
});

test('transitions: forward with time to AIRSPEED_MIN, back transitions with reasons', () => {
  const an = T.binAnalyze(T.parseBin(flightLog()), { airspeedMin: 11 });
  assert.equal(an.transitions.length, 2);
  const [fwd, back] = an.transitions;
  assert.equal(fwd.dir, 'forward'); assert.equal(fwd.from, 'QHOVER'); assert.equal(fwd.to, 'FBWB');
  assert.equal(fwd.tSec, 9);                                    // log starts at 1 s
  assert.equal(fwd.reached, true);
  assert.ok(Math.abs(fwd.timeToMinS - 3.5) < 1e-9);
  assert.equal(fwd.endBy, 'airspeed');
  assert.equal(back.dir, 'back'); assert.equal(back.from, 'AUTO'); assert.equal(back.to, 'QLAND');
  assert.equal(back.reason, 'BATTERY_FAILSAFE');
});

test('forward transition never reaching AIRSPEED_MIN; no ARSP falls back to "Transition done" or unknown', () => {
  const slow = T.binAnalyze(T.parseBin(flightLog()), { airspeedMin: 20 });
  assert.equal(slow.transitions[0].reached, false);
  assert.equal(slow.transitions[0].timeToMinS, null);
  const noArsp = T.binAnalyze(T.parseBin(flightLog({ noArsp: true })), { airspeedMin: 11 });
  assert.equal(noArsp.hasArsp, false);
  assert.equal(noArsp.transitions[0].reached, null);
  assert.equal(noArsp.transitionUnknown, 1);
  assert.equal(noArsp.phases.transition.maxA, null);
  const msg = T.binAnalyze(T.parseBin(flightLog({ noArsp: true, doneMsg: true })), { airspeedMin: 11 });
  assert.equal(msg.transitions[0].endBy, 'msg');
  assert.equal(msg.phases.transition.maxA, 60);                 // 10–12.5 s: samples at 10, 11, 12 s
  assert.equal(msg.phases.fw.maxA, 22);
});

test('events from MSG text and failsafe / battery mode reasons', () => {
  const an = T.binAnalyze(T.parseBin(flightLog()), { airspeedMin: 11 });
  const kinds = an.events.map(e => e.source + ':' + e.kinds.join('+'));
  assert.deepEqual(kinds, ['MSG:assist', 'MSG:battery', 'MODE:battery+failsafe', 'MODE:failsafe+transition']);
  assert.match(an.events[2].text, /QLAND — reason BATTERY_FAILSAFE/);
  assert.deepEqual(T.msgKinds('Transition failed, exceeded time limit'), ['transition', 'failsafe']);
  assert.deepEqual(T.msgKinds('Angle assist r=20 p=5'), ['assist']);
  assert.deepEqual(T.msgKinds('Arming checks passed'), []);
});

test('MSG classification follows ArduPilot failsafe / battery texts; other errors are warnings, not failsafes', () => {
  const k = T.msgKinds;
  assert.deepEqual(k('RC Short Failsafe On'), ['failsafe']);
  assert.deepEqual(k('GCS Failsafe On: switched to RTL'), ['failsafe']);
  assert.deepEqual(k('GCS Failsafe Cleared'), ['failsafe']);
  assert.deepEqual(k('Battery 1 is low 22.80V used 5200 mAh'), ['battery']);
  assert.deepEqual(k('Battery 1 is critical 22.10V used 6100 mAh'), ['battery']);
  assert.deepEqual(k('Alt assist 24.0m'), ['assist']);
  assert.deepEqual(k('Transition done'), ['transition']);
  for (const t of ['Calibration failed', 'Mode change to QLAND failed: requires position', 'Airspeed sensor 1 failed', 'Lost GPS lock',
    'PreArm: Battery 1 below minimum arming voltage', 'EKF variance error']) assert.deepEqual(k(t), ['warning'], t);
  assert.deepEqual(k('VTOL transition only in AUTO'), []);
});

test('max current per phase: VTOL / transition / FW', () => {
  const an = T.binAnalyze(T.parseBin(flightLog()), { airspeedMin: 11 });
  assert.equal(an.phases.vtol.maxA, 48);         // QHOVER 1–10 s (max 42) and QLAND/QHOVER 40–50 s (48 at 41 s)
  assert.equal(an.phases.transition.maxA, 60);   // 10–13.5 s
  assert.equal(an.phases.fw.maxA, 22);           // 13.5–40 s
  assert.equal(an.phases.vtol.n + an.phases.transition.n + an.phases.fw.n, 50);
});

test('binBattEntry / binSummary for the battery log and flight records', () => {
  const d = T.parseBin(flightLog()), pack = { cells: 6, chem: 'lipo' };
  const e = T.binBattEntry(d, pack);
  assert.equal(e.start, 24.95); assert.equal(e.rest, 22.5); assert.equal(e.min, 22.5);
  assert.equal(e.sag, 2.45); assert.equal(e.time, '1');
  assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(T.binBattEntry(d, { cells: 3, chem: 'lipo' }), null, 'outside the 3S window');
  const sum = T.binSummary(d, T.binAnalyze(d, { airspeedMin: 11 }), 'f.bin', pack);
  assert.equal(sum.kind, 'bin'); assert.equal(sum.transitions, 2); assert.equal(sum.maxA.transition, 60);
});
