'use strict';
// WP11 R1: parameter-file import and comparison (plan §10.1 A-3); WP14 R8: the expected values come from the reference
// parameter file (data/params-reference.js) for the safety-relevant subset. test/fixtures/sample.param is a synthetic file
// with the OLD (pre-Rev C) values, so it must show DIFFERS against the reference.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const T = require('../../js/tools-core.js');

const SAMPLE = readText('test/fixtures/sample.param');

test('R8: expected-values table = the reference param file for the plan §15.1 parameters plus the unchanged failsafe parameters', () => {
  const ref = require('../../data/params-reference.js');
  const E = Object.fromEntries(T.EXPECTED_PARAMS.map(e => [e.name, e]));
  // plan §15.1 (current values) and the "Unchanged" list
  const want = { BATT_CRT_VOLT: 21, BATT_FS_CRT_ACT: 6, BATT_LOW_VOLT: 22, BATT_FS_LOW_ACT: 1, BATT_LOW_TIMER: 10, BATT_FS_VOLTSRC: 1, BATT_ARM_VOLT: 24.6,
    AIRSPEED_CRUISE: 12, AIRSPEED_MIN: 10, Q_TRANSITION_MS: 3500, Q_TRANS_FAIL: 8, Q_TRANS_FAIL_ACT: 1, Q_BACKTRANS_MS: 8000, Q_RTL_ALT: 50,
    Q_RTL_MODE: 2, Q_OPTIONS: 426016, TRIM_THROTTLE: 30, Q_M_THST_HOVER: 0.35, Q_TILT_RATE_UP: 45, Q_TILT_RATE_DN: 45, Q_M_BAT_VOLT_MAX: 25.2,
    Q_M_BAT_VOLT_MIN: 19.8, FLTMODE2: 11, FENCE_ENABLE: 0, FENCE_TYPE: 0, FENCE_TOTAL: 0, COMPASS_DEV_ID: 658945, COMPASS_EXTERNAL: 2,
    COMPASS_DEV_ID2: 590114, COMPASS_USE2: 0, COMPASS_CAL_FIT: 16, COMPASS_AUTO_ROT: 2,
    THR_FAILSAFE: 2, THR_FS_VALUE: 950, FS_SHORT_ACTN: 0, FS_SHORT_TIMEOUT: 1.5, FS_LONG_ACTN: 1, FS_LONG_TIMEOUT: 5, FS_GCS_ENABL: 2,
    RTL_ALTITUDE: 120, AIRSPEED_MAX: 22, Q_ASSIST_SPEED: 9, Q_ASSIST_ALT: 25, Q_TILT_MAX: 80, Q_FRAME_CLASS: 7, Q_TILT_MASK: 3, BATT_CAPACITY: 7000, ARSPD_TYPE: 4 };
  for (const [k, v] of Object.entries(want)) {
    assert.ok(E[k], k + ' is in the Tools subset');
    assert.equal(E[k].value, v, k);
    assert.equal(E[k].value, ref.params[k], k + ' comes from the reference');
  }
  assert.match(E.Q_TRANS_FAIL_ACT.meaning, /QRTL/);
  assert.match(E.FLTMODE2.meaning, /^11 = RTL/);
  for (let i = 1; i <= 6; i++) assert.equal(E['FLTMODE' + i].value, ref.params['FLTMODE' + i], 'FLTMODE' + i);
  for (const e of T.EXPECTED_PARAMS) { assert.ok(e.source.includes('2026-10-17'), e.name + ' source'); assert.ok(e.meaning, e.name + ' meaning'); assert.notEqual(e.value, null, e.name); }
  // the meaning never contradicts the value ("N = …")
  for (const e of T.expectedParams(null, true)) { const m = e.meaning.match(/^(-?[\d.]+) = /); if (m) assert.equal(Number(m[1]), e.value, e.name); }
  assert.ok(E.Q_M_THST_HOVER.learned, 'hover thrust is learned (drifts): never judged');
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

test('compareParams marks match / differs / missing / learned / undocumented against the reference', () => {
  const { rows, summary } = T.compareParams(T.parseParamFile(SAMPLE).params);
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by.THR_FAILSAFE.status, 'match');
  assert.equal(by.Q_TRANS_FAIL_ACT.status, 'match');
  assert.equal(by.FLTMODE2.status, 'match');
  for (const n of ['BATT_CRT_VOLT', 'BATT_LOW_VOLT', 'Q_RTL_ALT', 'Q_TRANS_FAIL', 'AIRSPEED_CRUISE', 'AIRSPEED_MIN']) assert.equal(by[n].status, 'differs', n + ' (old value in the synthetic file)');
  assert.ok(Math.abs(by.BATT_CRT_VOLT.actual - 22.2) < 1e-6); assert.equal(by.BATT_CRT_VOLT.expected, 21);
  assert.equal(by.AIRSPEED_MAX.status, 'missing');
  assert.equal(by.AIRSPEED_MAX.actual, null);
  assert.equal(summary.differs, 6);
  assert.equal(summary.match + summary.differs + summary.missing + summary.learned + summary.undocumented, T.EXPECTED_PARAMS.length);
  // the reference against itself: everything matches
  const ref = require('../../data/params-reference.js');
  assert.deepEqual(T.compareParams(ref.params).summary, { match: T.EXPECTED_PARAMS.length, differs: 0, missing: 0, undocumented: 0, learned: 0 });
  // a learned value that drifted is shown, not judged
  const drift = T.compareParams(Object.assign({}, ref.params, { Q_M_THST_HOVER: 0.31 }));
  assert.equal(drift.rows.find(r => r.name === 'Q_M_THST_HOVER').status, 'learned');
  assert.equal(drift.summary.differs, 0);
  // the whole file against the reference
  const d = T.diffParamSets(Object.assign({}, ref.params, { BATT_CRT_VOLT: 22.2, NEW_PARAM_X: 1 }));
  assert.deepEqual(d.differs, [{ name: 'BATT_CRT_VOLT', file: 22.2, ref: 21 }]);
  assert.deepEqual(d.onlyFile, ['NEW_PARAM_X']); assert.deepEqual(d.onlyRef, []);
  assert.equal(T.diffParamSets({ THR_FAILSAFE: 2 }).onlyRef.length, ref.count - 1);
});

test('paramFileRecord / paramFileLabel / paramValue', () => {
  const now = new Date(2026, 9, 16, 9, 5).getTime();
  const rec = T.paramFileRecord('carrier.param', T.parseParamFile('AIRSPEED_MIN,12\n'), now);
  assert.deepEqual(Object.keys(rec), ['name', 'importedAt', 'params']);
  assert.equal(T.paramFileLabel(rec), 'verified against param file carrier.param 2026-10-16 09:05');
  assert.equal(T.paramFileLabel(null), null);
  assert.equal(T.paramFileLabel({ name: 'x', importedAt: 'nope' }), null);
  assert.deepEqual(T.paramValue(rec, 'AIRSPEED_MIN'), { value: 12, source: 'file' });
  assert.deepEqual(T.paramValue(null, 'AIRSPEED_MIN'), { value: 10, source: 'reference' });   // WP14: reference param file
  assert.deepEqual(T.paramValue(null, 'AIRSPEED_CRUISE'), { value: 12, source: 'reference' });
  assert.deepEqual(T.paramValue(null, 'FLTMODE2'), { value: 11, source: 'reference' });
  assert.equal(T.paramValue(null, 'NOT_A_PARAM'), null);
});
