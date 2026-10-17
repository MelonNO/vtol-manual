'use strict';
// WP14 R1: the reference parameter file (docs/reference/carrier-params-2026-10-17.param, a byte-exact copy of the
// owner's params.param) and the generated data/params-reference.js (contract C1.6, global VtolParamsRef).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ROOT, readText } = require('../repo-files.js');
const REF = require('../../data/params-reference.js');
const T = require('../../js/tools-core.js');

const FILE = 'docs/reference/carrier-params-2026-10-17.param';
const gen = () => import(pathToFileURL(path.join(ROOT, 'scripts', 'gen-params-reference.mjs')).href);
const bytes = () => fs.readFileSync(path.join(ROOT, FILE));

test('R1: the reference file is the byte-exact export: SHA-256 and size as recorded in docs/reference/README.md, CRLF kept', () => {
  const b = bytes(), sha = crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(sha, '2eb324cc0bb2c85480272982df14b040188fae888674cb8f34b1330893d9e460');
  const readme = readText('docs/reference/README.md');
  assert.ok(readme.includes(sha), 'README records the SHA-256');
  assert.match(readme, /\*\*2026-10-17\*\*/); assert.match(readme, /\| Parameters \| 1663 \|/);
  assert.match(readme, /How to update/); assert.match(readme, /gen-params-reference\.mjs/); assert.match(readme, /bump the date/);
  const lines = b.toString('latin1').split('\n');
  assert.equal(lines.length - 1, 1663, '1663 lines');
  assert.ok(lines.slice(0, -1).every(l => l.endsWith('\r')), 'every line ends with CRLF (the export is kept byte for byte)');
  assert.match(readText('.gitattributes'), /^docs\/reference\/\*\.param -text$/m, 'git never converts the line endings');
  assert.equal(fs.readdirSync(path.join(ROOT, 'docs', 'reference')).filter(f => /^carrier-params-.*\.param$/.test(f)).length, 1, 'exactly one reference file');
});

test('R1: data/params-reference.js is generated from the file and matches it value for value (C1.6 shape)', async () => {
  const g = await gen();
  assert.equal(readText('data/params-reference.js'), g.render(), 'run: node scripts/gen-params-reference.mjs');
  assert.equal(REF.source, FILE);
  assert.equal(REF.savedDate, '2026-10-17');
  assert.equal(REF.count, 1663);
  assert.equal(REF.sha256, crypto.createHash('sha256').update(bytes()).digest('hex'));
  // independent parse with the Tools parser: same names, same order, same numbers
  const p = T.parseParamFile(bytes().toString('utf8'));
  assert.equal(p.errors.length, 0); assert.equal(p.duplicates.length, 0);
  assert.deepEqual(Object.keys(REF.params), Object.keys(p.params));
  for (const [k, v] of Object.entries(p.params)) assert.ok(Object.is(REF.params[k], v), k + ': ' + REF.params[k] + ' vs ' + v);
  // and line by line against the raw text
  for (const line of bytes().toString('utf8').split(/\r\n/).filter(Boolean)) {
    const [n, v] = line.split(',');
    assert.equal(REF.params[n], Number(v), n);
  }
});

test('R1: generator --check passes; the strict parser rejects a dirty file', async () => {
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-params-reference.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /up to date \(1663 parameters\)/);
  const g = await gen();
  assert.throws(() => g.parseStrict('A_B,1\r\nA_B,2\r\n'), /duplicate A_B/);
  assert.throws(() => g.parseStrict('A_B,x\r\n'), /line 1/);
  assert.deepEqual(g.parseStrict('# c\r\nA_B,1.5\r\n\r\n'), { A_B: 1.5 });
});

// Plan §15.1 (current values) and its "Unchanged" list, pinned: a new reference file that changes any of them must fail
// here until the manual, the content, the diagrams and the map have been reviewed (docs/reference/README.md step 5).
test('plan §15.1 values are exactly what the reference file holds', () => {
  const want = {
    BATT_CRT_VOLT: 21, BATT_FS_CRT_ACT: 6, BATT_LOW_VOLT: 22, BATT_FS_LOW_ACT: 1, BATT_LOW_TIMER: 10, BATT_FS_VOLTSRC: 1, BATT_ARM_VOLT: 24.6,
    AIRSPEED_CRUISE: 12, AIRSPEED_MIN: 10, Q_TRANSITION_MS: 3500, Q_TRANS_FAIL: 8, Q_TRANS_FAIL_ACT: 1, Q_BACKTRANS_MS: 8000,
    Q_RTL_ALT: 50, Q_RTL_ALT_MIN: 35, Q_RTL_MODE: 2, Q_OPTIONS: 426016, TRIM_THROTTLE: 30, Q_M_THST_HOVER: 0.35, Q_M_HOVER_LEARN: 2,
    Q_TILT_RATE_UP: 45, Q_TILT_RATE_DN: 45, Q_M_BAT_VOLT_MAX: 25.2, Q_M_BAT_VOLT_MIN: 19.8, FLTMODE2: 11,
    FENCE_ENABLE: 0, FENCE_TYPE: 0, FENCE_TOTAL: 0, FENCE_ALT_MAX: 100, FENCE_RADIUS: 300,
    COMPASS_DEV_ID: 658945, COMPASS_PRIO1_ID: 658945, COMPASS_EXTERNAL: 2, COMPASS_DEV_ID2: 590114, COMPASS_USE2: 0, COMPASS_CAL_FIT: 16, COMPASS_AUTO_ROT: 2,
    THR_FAILSAFE: 2, THR_FS_VALUE: 950, FS_SHORT_ACTN: 0, FS_SHORT_TIMEOUT: 1.5, FS_LONG_ACTN: 1, FS_LONG_TIMEOUT: 5, FS_GCS_ENABL: 2,
    RTL_ALTITUDE: 120, AIRSPEED_MAX: 22, Q_ASSIST_SPEED: 9, Q_ASSIST_ALT: 25, Q_TILT_MAX: 80, Q_FRAME_CLASS: 7, Q_TILT_MASK: 3,
    BATT_CAPACITY: 7000, ARSPD_TYPE: 4, TECS_CLMB_MAX: 5, TECS_SINK_MAX: 5, Q_LAND_FINAL_SPD: 0.5, AHRS_GPS_MINSATS: 6
  };
  for (const [k, v] of Object.entries(want)) assert.equal(REF.params[k], v, k);
  // Q_OPTIONS bit 5 set (VTOL modes use QRTL for a failsafe RTL), bit 19 cleared
  assert.ok(REF.params.Q_OPTIONS & (1 << 5)); assert.ok(!(REF.params.Q_OPTIONS & (1 << 19)));
});

test('store defaults (C1.6) equal the reference file', () => {
  const S = require('../../js/store.js');
  const s = S.defaults().settings;
  assert.equal(s.battCrtVolt, REF.params.BATT_CRT_VOLT);
  assert.equal(s.battLowVolt, REF.params.BATT_LOW_VOLT);
  assert.equal(s.battArmVolt, REF.params.BATT_ARM_VOLT);
});
