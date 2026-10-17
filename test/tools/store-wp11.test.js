'use strict';
// WP11 C1 extensions: paramFile (optional key), flights and maintenance collections, battLog usedMah.
const test = require('node:test');
const assert = require('node:assert/strict');
const VtolStore = require('../../js/store.js');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
}
function fresh(storeObj) {
  VtolStore._setStorage(memStorage(storeObj ? { vtol_store: JSON.stringify(storeObj) } : {}));
  VtolStore.takeIssues();
}
const PF = (name, at, params) => ({ name, importedAt: at, params });

test('defaults: empty flights and maintenance, no paramFile', () => {
  const d = VtolStore.defaults();
  assert.deepEqual(d.flights, []); assert.deepEqual(d.maintenance, []);
  assert.equal('paramFile' in d, false);
});

test('paramFile is validated on load: valid kept, invalid removed with a notice', () => {
  const base = VtolStore.defaults();
  fresh(Object.assign({}, base, { paramFile: PF('a.param', '2026-10-16T08:00:00.000Z', { THR_FAILSAFE: 2, BATT_CRT_VOLT: 22.2 }) }));
  assert.deepEqual(VtolStore.load().paramFile.params, { THR_FAILSAFE: 2, BATT_CRT_VOLT: 22.2 });
  fresh(Object.assign({}, base, { paramFile: PF('a.param', '2026-10-16T08:00:00.000Z', { '<img src=x>': 1 }) }));
  assert.equal(VtolStore.load().paramFile, undefined);
  assert.match(VtolStore.takeIssues().join(' '), /Parameter file record was invalid/);
  fresh(Object.assign({}, base, { paramFile: PF('a.param', 'never', { A: 1 }) }));
  assert.equal(VtolStore.load().paramFile, undefined);
});

test('import: newer paramFile wins, older or invalid one is ignored; export round trip', () => {
  fresh(Object.assign(VtolStore.defaults(), { paramFile: PF('local.param', '2026-10-16T08:00:00.000Z', { A: 1 }) }));
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('old.param', '2026-10-01T08:00:00.000Z', { A: 2 }) }));
  assert.equal(VtolStore.load().paramFile.name, 'local.param');
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('new.param', '2026-10-17T08:00:00.000Z', { A: 3 }) }));
  assert.equal(VtolStore.importJSON.lastStats.paramFile, true);
  assert.equal(VtolStore.load().paramFile.name, 'new.param');
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('bad.param', '2026-10-18T08:00:00.000Z', { A: 'x' }) }));
  assert.equal(VtolStore.load().paramFile.name, 'new.param');
  assert.match(VtolStore.importJSON.lastStats.issues.join(' '), /invalid — ignored/);
  const out = JSON.parse(VtolStore.exportJSON());
  assert.equal(out.paramFile.name, 'new.param');
});

test('import: paramFile times compare as dates (non-ISO strings cannot win by string order)', () => {
  fresh(Object.assign(VtolStore.defaults(), { paramFile: PF('local.param', '2026-10-16T08:00:00.000Z', { A: 1 }) }));
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('rfc.param', 'Fri, 01 Jan 2000 00:00:00 GMT', { A: 2 }) }));
  assert.equal(VtolStore.load().paramFile.name, 'local.param', '"F…" > "2…" as strings, but 2000 is older');
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('rfc-new.param', 'Sat, 17 Oct 2026 08:00:00 GMT', { A: 3 }) }));
  const pf = VtolStore.load().paramFile;
  assert.equal(pf.name, 'rfc-new.param');
  assert.equal(pf.importedAt, '2026-10-17T08:00:00.000Z', 'normalised to ISO');
  VtolStore.importJSON(JSON.stringify({ paramFile: PF('nodate.param', 'tomorrow', { A: 4 }) }));
  assert.equal(VtolStore.load().paramFile.name, 'rfc-new.param', 'an invalid date never wins');
});

test('flights and maintenance merge by id and are validated', () => {
  fresh(null);
  VtolStore.load();
  VtolStore.importJSON(JSON.stringify({
    flights: [{ id: 'f1', date: '2026-10-16', label: 'S1', archiveId: 'arc', battIds: ['b1', 'b2'],
      logSummary: { kind: 'bin', file: 'x.bin', maxA: { vtol: 40, fw: null, deep: { no: 1 } }, list: [1] } }],
    maintenance: [{ id: 'm1', taskId: 'carrier-5', doneDate: '2026-10-16', markedAt: '2026-10-16T10:00:00Z' },
      { id: 'm2', taskId: 'carrier-5', doneDate: '16.10.2026' }, { id: 'm3', doneDate: '2026-10-16' }, { id: 'm4', taskId: 'carrier-5', doneDate: '2026-02-30' }]
  }));
  const s = VtolStore.load();
  const f = VtolStore.find(s, 'flights', 'f1');
  assert.deepEqual(f.battIds, ['b1', 'b2']);
  assert.deepEqual(f.logSummary, { kind: 'bin', file: 'x.bin', maxA: { vtol: 40, fw: null } });
  assert.equal(f.gcsSummary, null);
  assert.deepEqual(VtolStore.live(s.maintenance).map(m => m.id), ['m1']);
  assert.equal(VtolStore.importJSON.lastStats.issues.filter(t => /Maintenance record/.test(t)).length, 3);
});

test('a malformed incoming flight record never replaces a valid local one (C1.4)', () => {
  const good = { id: 'f1', date: '2026-10-16', label: 'S1', archiveId: '', battIds: ['b1'], notes: '', updatedAt: '2026-10-16T10:00:00Z' };
  fresh(Object.assign(VtolStore.defaults(), { flights: [good] }));
  const newer = '2026-10-17T10:00:00Z';
  for (const bad of [{ date: 'yesterday' }, { date: '2026-13-01' }, { battIds: 'b1' }, { battIds: ['b1', 5] }, { label: { x: 1 } }, { gcsSummary: 'nope' }, { logSummary: [1] }]) {
    VtolStore.importJSON(JSON.stringify({ flights: [Object.assign({}, good, { updatedAt: newer }, bad)] }));
    assert.match(VtolStore.importJSON.lastStats.issues.join(' '), /Flight record .* dropped: invalid/, JSON.stringify(bad));
    const f = VtolStore.find(VtolStore.load(), 'flights', 'f1');
    assert.deepEqual([f.date, f.label, f.battIds, f.updatedAt], ['2026-10-16', 'S1', ['b1'], good.updatedAt], JSON.stringify(bad));
  }
  VtolStore.importJSON(JSON.stringify({ flights: [Object.assign({}, good, { label: 'S1 edited', updatedAt: newer })] }));
  assert.equal(VtolStore.find(VtolStore.load(), 'flights', 'f1').label, 'S1 edited', 'a valid newer record still wins');
});

test('battLog usedMah: kept when valid, null when invalid, absent otherwise', () => {
  fresh(Object.assign(VtolStore.defaults(), { battLog: [
    { id: 'a', date: '2026-10-16', start: 25, min: 22, rest: 23, usedMah: 812, source: 'gcs' },
    { id: 'b', date: '2026-10-16', start: 25, min: 22, rest: 23, usedMah: 'x' },
    { id: 'c', date: '2026-10-16', start: 25, min: 22, rest: 23 }] }));
  const s = VtolStore.load();
  assert.deepEqual(s.battLog.map(e => e.usedMah), [812, null, undefined]);
  assert.equal(s.battLog[0].source, 'gcs');
});
