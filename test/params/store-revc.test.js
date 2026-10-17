'use strict';
// WP14 R7 (contract C1.6): Rev C store defaults, migration of stored settings with a one-time notice, paramFile precedence.
const test = require('node:test');
const assert = require('node:assert/strict');
const VtolStore = require('../../js/store.js');
const T = require('../../js/tools-core.js');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, map: m };
}
// A store as saved by the pre-Rev C code: settings without battLowVolt / battArmVolt, old default battCrtVolt 22.2.
function oldStore(settingsPatch) {
  const d = VtolStore.defaults();
  const s = Object.assign({}, d.settings, { battCrtVolt: 22.2 }, settingsPatch || {});
  delete s.battLowVolt; delete s.battArmVolt;
  return Object.assign({}, d, { settings: s });
}
function use(storeObj) {
  const mem = memStorage(storeObj ? { vtol_store: JSON.stringify(storeObj) } : {});
  VtolStore._setStorage(mem);
  VtolStore.takeIssues();
  return mem;
}

test('C1.6 defaults: battCrtVolt 21.0, battLowVolt 22.0, battArmVolt 24.6; manual RTL 23.0 / hard limit 22.5 unchanged', () => {
  const s = VtolStore.defaults().settings;
  assert.deepEqual([s.battCrtVolt, s.battLowVolt, s.battArmVolt, s.manualRtlVolt, s.hardLimitVolt], [21.0, 22.0, 24.6, 23.0, 22.5]);
  assert.equal('updatedAt' in s, false);
  assert.deepEqual(VtolStore.REV_C, { battCrtVolt: 21.0, battLowVolt: 22.0, battArmVolt: 24.6 });
});

test('R7: an unedited old store (22.2, no settings.updatedAt) migrates to 21.0 + the new keys, with ONE notice', () => {
  const mem = use(oldStore());
  const s = VtolStore.load();
  assert.deepEqual([s.settings.battCrtVolt, s.settings.battLowVolt, s.settings.battArmVolt], [21.0, 22.0, 24.6]);
  assert.equal(s.settings.manualRtlVolt, 23.0);
  assert.equal('updatedAt' in s.settings, false, 'the migration is not a user edit');
  // persisted: the stored JSON now has the Rev C values
  const saved = JSON.parse(mem.map.get('vtol_store')).settings;
  assert.deepEqual([saved.battCrtVolt, saved.battLowVolt, saved.battArmVolt], [21.0, 22.0, 24.6]);
  const n = VtolStore.notices();
  assert.equal(n.length, 1);
  assert.equal(n[0].id, 'revc-settings');
  assert.match(n[0].text, /updated to the reference param file \(2026-10-17\)/);
  assert.match(n[0].text, /BATT_CRT_VOLT 22\.2 → 21\.0 V/);
  assert.match(n[0].text, /BATT_LOW_VOLT 22\.0 V \(automatic RTL\)/);
  assert.deepEqual(VtolStore.takeIssues(), [], 'a migration is not an "invalid data" repair');
  // one-time: loading again changes nothing and adds no notice; dismissing removes it for every page
  VtolStore.load();
  assert.equal(VtolStore.notices().length, 1);
  VtolStore.dismissNotice('revc-settings');
  assert.deepEqual(VtolStore.notices(), []);
  VtolStore.load();
  assert.deepEqual(VtolStore.notices(), [], 'never shown again');
});

test('R7: an edited old store keeps the user\'s values, gets the new keys and a "differs from reference param file" notice', () => {
  use(oldStore({ updatedAt: '2026-09-01T10:00:00.000Z', manualRtlVolt: 23.2 }));
  const s = VtolStore.load();
  assert.equal(s.settings.battCrtVolt, 22.2, 'kept');
  assert.equal(s.settings.manualRtlVolt, 23.2, 'kept');
  assert.deepEqual([s.settings.battLowVolt, s.settings.battArmVolt], [22.0, 24.6]);
  assert.equal(s.settings.updatedAt, '2026-09-01T10:00:00.000Z');
  const n = VtolStore.notices();
  assert.equal(n.length, 1);
  assert.match(n[0].text, /edited settings were kept/);
  assert.match(n[0].text, /differ from the reference param file \(2026-10-17\): BATT_CRT_VOLT 22\.2 V \(reference 21\.0 V\)/);
  // the pages show the same difference permanently (Tools settings), from ToolsCore
  assert.deepEqual(T.settingsVsReference(s.settings).map(d => d.param), ['BATT_CRT_VOLT']);
});

test('R7: an edited store that already equals the reference gets the new keys and an "updated" notice without a difference', () => {
  use(oldStore({ updatedAt: '2026-09-01T10:00:00.000Z', battCrtVolt: 21.0 }));
  const s = VtolStore.load();
  assert.deepEqual([s.settings.battCrtVolt, s.settings.battLowVolt, s.settings.battArmVolt], [21.0, 22.0, 24.6]);
  assert.doesNotMatch(VtolStore.notices()[0].text, /differ/);
});

test('R7: a Rev C store (battLowVolt present) and a fresh store are never migrated and show no notice', () => {
  use(VtolStore.defaults());
  VtolStore.load();
  assert.deepEqual(VtolStore.notices(), []);
  const rc = VtolStore.defaults(); rc.settings.battCrtVolt = 22.2; rc.settings.updatedAt = '2026-10-17T09:00:00.000Z';
  use(rc);
  assert.equal(VtolStore.load().settings.battCrtVolt, 22.2, 'a later user edit is never undone');
  assert.deepEqual(VtolStore.notices(), []);
  use(null);
  const s = VtolStore.load();
  assert.equal(s.settings.battCrtVolt, 21.0);
  assert.deepEqual(VtolStore.notices(), []);
});

test('new settings are validated like the others (bad battLowVolt falls back to the default with an issue)', () => {
  const d = VtolStore.defaults(); d.settings.battLowVolt = 'x'; d.settings.battArmVolt = -1;
  use(d);
  const s = VtolStore.load();
  assert.deepEqual([s.settings.battLowVolt, s.settings.battArmVolt], [22.0, 24.6]);
  assert.equal(VtolStore.takeIssues().length, 2);
});

test('C1.6: paramFile BATT_CRT_VOLT / BATT_LOW_VOLT / BATT_ARM_VOLT take precedence for display and analysis, with the source', () => {
  const d = VtolStore.defaults();
  d.paramFile = { name: 'today.param', importedAt: '2026-10-17T12:00:00.000Z', params: { BATT_CRT_VOLT: 20.9, BATT_LOW_VOLT: 22.1, BATT_ARM_VOLT: 24.5 } };
  use(d);
  const s = VtolStore.load();
  const e = T.effectiveSettings(s.settings, s.paramFile);
  assert.deepEqual([e.battCrtVolt, e.battLowVolt, e.battArmVolt], [20.9, 22.1, 24.5]);
  assert.deepEqual(e.voltSource, { battCrtVolt: 'file', battLowVolt: 'file', battArmVolt: 'file' });
  assert.equal(e.voltFile, 'today.param');
  // analysis uses it: thresholds, gauge, content tokens
  const th = T.packThresholds(s.packs[0], e);
  assert.deepEqual([th.crtV, th.battLowV, th.armV], [20.9, 22.1, 24.5]);
  const R = require('../../js/render-content.js');
  assert.equal(R.plain('{settings.battLowVolt} / {settings.battCrtVolt}', R.ctxFrom(Object.assign({}, s, { settings: e }))), '22.1 / 20.9');
  assert.match(require('../../js/diagrams.js').batteryGauge(s.packs[0], e), /22\.1 V · 3\.68 V\/cell/);
});
