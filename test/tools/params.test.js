'use strict';
// WP11 R1: parameter-file import and comparison against the documented values (plan §10.1 A-3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../../js/tools-core.js');

const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'sample.param'), 'utf8');

test('expected-values table holds the values the manual relies on (incl. Q_TRANS_FAIL_ACT 0 = QLand)', () => {
  const E = Object.fromEntries(T.EXPECTED_PARAMS.map(e => [e.name, e]));
  const want = { THR_FAILSAFE: 2, FS_GCS_ENABL: 2, FS_LONG_TIMEOUT: 5, FS_LONG_ACTN: 1, BATT_CRT_VOLT: 22.2, BATT_FS_CRT_ACT: 6, BATT_LOW_VOLT: 0,
    RTL_ALTITUDE: 120, Q_RTL_ALT: 70, Q_TRANS_FAIL: 4, Q_TRANS_FAIL_ACT: 0, Q_ASSIST_SPEED: 9, Q_ASSIST_ALT: 25, Q_FRAME_CLASS: 7, Q_TILT_MASK: 3,
    AIRSPEED_CRUISE: 13, AIRSPEED_MIN: 11, AIRSPEED_MAX: 22, FENCE_ENABLE: 0 };
  for (const [k, v] of Object.entries(want)) assert.equal(E[k] && E[k].value, v, k);
  assert.match(E.Q_TRANS_FAIL_ACT.meaning, /QLand/);
  assert.doesNotMatch(E.Q_TRANS_FAIL_ACT.meaning.replace(/not QHOVER/, ''), /QHOVER/);
  for (let i = 1; i <= 6; i++) assert.ok(E['FLTMODE' + i], 'FLTMODE' + i);
  assert.equal(E.FLTMODE2.value, null, 'FLTMODE2 is TBD (conflicting notes)');
  assert.match(E.FLTMODE2.meaning, /^TBD — /);
  for (const e of T.EXPECTED_PARAMS) assert.ok(e.source, e.name + ' has a source');
});

test('parseParamFile reads the Mission Planner sample and reports bad lines', () => {
  const p = T.parseParamFile(SAMPLE);
  assert.equal(p.params.THR_FAILSAFE, 2);
  assert.equal(p.params.SERIAL1_BAUD, 57);
  assert.ok(Math.abs(p.params.BATT_CRT_VOLT - 22.2) < 1e-6);
  assert.equal(p.count, 25);
  assert.equal(p.errors.length, 1);
  assert.equal(p.errors[0].line, 27);
});

test('parseParamFile accepts MAVProxy and QGC formats, comments and CRLF', () => {
  const mav = T.parseParamFile('THR_FAILSAFE     2.000000\r\nFS_LONG_ACTN 1 # comment\r\n');
  assert.deepEqual(mav.params, { THR_FAILSAFE: 2, FS_LONG_ACTN: 1 });
  const qgc = T.parseParamFile('# Onboard parameters for Vehicle 1\n#\n# Vehicle-Id Component-Id Name Value Type\n1\t1\tAIRSPEED_MIN\t11.000000000000000000\t9\n1\t1\tQ_TRANS_FAIL_ACT\t0\t2\n');
  assert.deepEqual(qgc.params, { AIRSPEED_MIN: 11, Q_TRANS_FAIL_ACT: 0 });
  assert.equal(qgc.errors.length, 0);
  const dup = T.parseParamFile('A_B,1\nA_B,2\n');
  assert.deepEqual(dup.duplicates, ['A_B']);
  assert.equal(dup.params.A_B, 2);
  const bad = T.parseParamFile('__proto__,1\nX,0x10\nTOO_LONG_PARAMETER_NAME,1\n<img>,1\n');
  assert.equal(bad.count, 0);
  assert.equal(bad.errors.length, 4);
});

test('compareParams marks match / differs / missing / undocumented', () => {
  const { rows, summary } = T.compareParams(T.parseParamFile(SAMPLE).params);
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by.THR_FAILSAFE.status, 'match');
  assert.equal(by.BATT_CRT_VOLT.status, 'match', 'float32 22.2 equals 22.2');
  assert.equal(by.Q_TRANS_FAIL_ACT.status, 'differs');
  assert.equal(by.Q_TRANS_FAIL_ACT.actual, 1);
  assert.equal(by.AIRSPEED_MAX.status, 'missing');
  assert.equal(by.AIRSPEED_MAX.actual, null);
  assert.equal(by.FLTMODE2.status, 'undocumented');
  assert.equal(by.FLTMODE2.actual, 11);
  assert.deepEqual(summary, { match: 22, differs: 1, missing: 1, undocumented: 1 });
  assert.equal(T.compareParams({}).summary.missing, T.EXPECTED_PARAMS.length - 1);
});

test('paramFileRecord / paramFileLabel / paramValue', () => {
  const now = new Date(2026, 9, 16, 9, 5).getTime();
  const rec = T.paramFileRecord('carrier.param', T.parseParamFile('AIRSPEED_MIN,12\n'), now);
  assert.deepEqual(Object.keys(rec), ['name', 'importedAt', 'params']);
  assert.equal(T.paramFileLabel(rec), 'verified against param file carrier.param 2026-10-16 09:05');
  assert.equal(T.paramFileLabel(null), null);
  assert.equal(T.paramFileLabel({ name: 'x', importedAt: 'nope' }), null);
  assert.deepEqual(T.paramValue(rec, 'AIRSPEED_MIN'), { value: 12, source: 'file' });
  assert.deepEqual(T.paramValue(null, 'AIRSPEED_MIN'), { value: 11, source: 'documented' });
  assert.equal(T.paramValue(null, 'FLTMODE2'), null);
  assert.equal(T.paramValue(null, 'NOT_A_PARAM'), null);
});
