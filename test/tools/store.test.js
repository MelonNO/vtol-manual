'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VtolStore = require('../../js/store.js');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    keys: () => [...m.keys()],
    _m: m
  };
}
function fresh(init) { const s = memStorage(init); VtolStore._setStorage(s); return s; }

test('defaults() follow contract C1 (shape, default profiles, settings)', () => {
  const d = VtolStore.defaults();
  assert.equal(d.schemaVersion, 2);
  assert.ok(!isNaN(Date.parse(d.updatedAt)));
  for (const k of ['archive', 'weatherFavorites', 'battLog']) assert.deepEqual(d[k], []);
  assert.deepEqual(d.packs.map(p => [p.label, p.role, p.cells, p.chem, p.capacityMah]), [
    ['Carrier 6S 7000', 'carrier', 6, 'lipo', 7000],
    ['Mast 6S 3000', 'mast', 6, 'lipo', 3000],
    ['Ref client 6S 1300', 'client', 6, 'lipo', 1300]
  ]);
  const c = d.clients[0];
  assert.equal(c.name, 'Reference client #1');
  assert.equal(c.fc, 'Matek F405 STD (clone)');
  assert.equal(c.firmware, 'Betaflight 4.5.2');
  assert.deepEqual(c.vtx, { band: 'R', channel: 5, freqMHz: 5806, powerMw: 25 });
  assert.equal(c.videoStandard, null);
  assert.deepEqual(c.elrs, { band: '2.4', packetRateHz: null, modelId: null, telemetryRatio: null, geminiRx: false });
  assert.deepEqual(c.failsafe, { type: 'gps_rescue', minSats: 8, delayS: 2.5 });
  assert.equal(d.packs.find(p => p.id === c.packId).label, 'Ref client 6S 1300');
  const [video, rc, gcs] = d.links;
  assert.deepEqual([video.name, video.kind, video.freqMHz, video.txPowerDbm, video.txGainDbi, video.rxGainDbi, video.rxSensDbm, video.marginDb, video.antenna],
    ['Client video 5.8 GHz', 'video', 5800, 14.0, 2.0, 10.0, -85, 6, 'dual_patch']);
  assert.deepEqual([rc.name, rc.kind, rc.freqMHz, rc.txPowerDbm, rc.txGainDbi, rc.rxGainDbi, rc.rxSensDbm, rc.marginDb, rc.antenna],
    ['ELRS RC (set me)', 'rc', 2440, null, null, null, null, 6, 'dipole']);
  assert.equal(gcs.kind, 'gcs');
  for (const k of ['freqMHz', 'txPowerDbm', 'txGainDbi', 'rxGainDbi', 'rxSensDbm', 'antenna']) assert.equal(gcs[k], null, k);
  assert.equal(gcs.marginDb, 6);
  const s = d.settings;
  assert.equal(s.activeClientId, c.id);
  assert.equal(s.activeCarrierPackId, d.packs[0].id);
  assert.deepEqual([s.battCrtVolt, s.manualRtlVolt, s.hardLimitVolt, s.storageVoltPerCell, s.checklistExpiryHours], [22.2, 23.0, 22.5, 3.80, 6]);
  assert.deepEqual([s.windGoMaxMs, s.windCautionMaxMs, s.gustMaxMs], [5, 8, 10]);
  assert.equal(VtolStore.KEY, 'vtol_store');
});

test('load() migrates legacy keys, then removes them; Gist keys are deleted', () => {
  const ls = fresh({
    vtol_battlog: JSON.stringify([{ date: '2025-05-01', flight: 's1', start: 25.1, min: 22.9, rest: 23.4, time: '18', notes: 'n', sag: 2.2 }]),
    vtol_pf_archive: JSON.stringify([{ date: '2025-05-01T10:00:00Z', duration: '12:00', durationMs: 720000, status: 'GO', notes: '' }]),
    vtol_wx_fav: JSON.stringify([{ lat: 59.9, lon: 10.7, name: 'Field' }]),
    vtol_batt_type: JSON.stringify({ cells: 4, chem: 'liion' }),
    vtol_gh_pat: 'ghp_x', vtol_gh_gist_id: 'g1', vtol_last_sync: '10:00'
  });
  const s = VtolStore.load();
  assert.equal(s.battLog.length, 1);
  assert.equal(s.battLog[0].packId, VtolStore.IDS.carrierPack);
  assert.equal(s.battLog[0].source, 'manual');
  assert.ok(s.battLog[0].id);
  assert.equal(s.archive.length, 1); assert.ok(s.archive[0].id);
  assert.deepEqual([s.weatherFavorites[0].name, s.weatherFavorites[0].lat], ['Field', 59.9]); assert.ok(s.weatherFavorites[0].id);
  const carrier = s.packs.find(p => p.id === VtolStore.IDS.carrierPack);
  assert.deepEqual([carrier.cells, carrier.chem], [4, 'liion']);
  for (const k of ['vtol_battlog', 'vtol_pf_archive', 'vtol_wx_fav', 'vtol_batt_type', 'vtol_gh_pat', 'vtol_gh_gist_id', 'vtol_last_sync']) {
    assert.equal(ls.getItem(k), null, k);
  }
  assert.ok(ls.getItem('vtol_store'));
  // second load reads the store, ids stay stable
  assert.equal(VtolStore.load().battLog[0].id, s.battLog[0].id);
});

test('legacy keys are kept when the migrated store cannot be saved', () => {
  const ls = memStorage({ vtol_battlog: JSON.stringify([{ date: '2025-05-01', start: 25, min: 23, rest: 23.5, sag: 2 }]) });
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  VtolStore._setStorage(ls);
  const s = VtolStore.load();
  assert.equal(s.battLog.length, 1);
  assert.ok(ls.getItem('vtol_battlog'), 'legacy data must survive a failed save');
});

test('Gist keys are removed even when a v2 store already exists', () => {
  const ls = fresh({ vtol_store: JSON.stringify(VtolStore.defaults()), vtol_gh_pat: 'ghp_x' });
  VtolStore.load();
  assert.equal(ls.getItem('vtol_gh_pat'), null);
});

test('load() never throws on a corrupt store and keeps a backup copy', () => {
  const ls = fresh({ vtol_store: '{not json' });
  const s = VtolStore.load();
  assert.equal(s.schemaVersion, 2);
  assert.ok(ls.keys().some(k => k.startsWith('vtol_store_corrupt_')));
});

test('save() sets updatedAt; update() persists the mutation', async () => {
  fresh();
  const s = VtolStore.load();
  const before = s.updatedAt;
  await new Promise(r => setTimeout(r, 5));
  VtolStore.update(st => { st.settings.battCrtVolt = 21.9; });
  const after = VtolStore.load();
  assert.equal(after.settings.battCrtVolt, 21.9);
  assert.ok(after.updatedAt > before);
});

test('remove() leaves a tombstone; live() hides it; tombstones expire after 30 days', () => {
  const ls = fresh();
  VtolStore.update(s => { VtolStore.upsert(s, 'archive', { id: 'a1', date: '2025-01-01', status: 'GO' }); });
  VtolStore.update(s => { VtolStore.remove(s, 'archive', 'a1'); });
  let s = VtolStore.load();
  assert.deepEqual(s.archive.map(r => [r.id, r.deleted]), [['a1', true]]);
  assert.equal(VtolStore.live(s.archive).length, 0);
  // age the tombstone past 30 days
  const raw = JSON.parse(ls.getItem('vtol_store'));
  raw.archive[0].updatedAt = new Date(Date.now() - 31 * 86400000).toISOString();
  ls.setItem('vtol_store', JSON.stringify(raw));
  s = VtolStore.load();
  assert.equal(s.archive.length, 0);
});

test('mergeStores: by id, newer updatedAt wins, missing records are never deleted', () => {
  const v = { start: 25, min: 23, rest: 23.5, sag: 2 };
  const local = VtolStore.defaults();
  local.battLog = [
    { ...v, id: 'x', date: '2025-01-01', notes: 'local-new', updatedAt: '2025-02-02T00:00:00Z' },
    { ...v, id: 'y', date: '2025-01-02', notes: 'local-old', updatedAt: '2025-01-01T00:00:00Z' },
    { ...v, id: 'only-local', date: '2025-01-03', updatedAt: '2025-01-01T00:00:00Z' }
  ];
  const incoming = { battLog: [
    { ...v, id: 'x', date: '2025-01-01', notes: 'remote-old', updatedAt: '2025-01-01T00:00:00Z' },
    { ...v, id: 'y', date: '2025-01-02', notes: 'remote-new', updatedAt: '2025-03-01T00:00:00Z' },
    { ...v, id: 'z', date: '2025-01-04', notes: 'remote-only', updatedAt: '2025-01-01T00:00:00Z' }
  ] };
  const { store, stats } = VtolStore.mergeStores(local, incoming);
  const by = Object.fromEntries(store.battLog.map(r => [r.id, r.notes]));
  assert.equal(by.x, 'local-new');
  assert.equal(by.y, 'remote-new');
  assert.equal(by.z, 'remote-only');
  assert.ok('only-local' in by);
  assert.deepEqual(stats, { added: 1, updated: 1, deleted: 0, settings: false, issues: [] });
});

test('mergeStores: a tombstone wins only when newer than the local record', () => {
  const day = n => new Date(Date.now() - n * 86400000).toISOString();   // tombstones must be < 30 days old to survive
  const local = VtolStore.defaults();
  local.archive = [
    { id: 'a', date: '2025-01-01', updatedAt: day(10) },
    { id: 'b', date: '2025-01-02', updatedAt: day(1) }
  ];
  const incoming = { archive: [
    { id: 'a', deleted: true, updatedAt: day(5) },
    { id: 'b', deleted: true, updatedAt: day(5) }
  ] };
  const { store } = VtolStore.mergeStores(local, incoming);
  assert.equal(store.archive.find(r => r.id === 'a').deleted, true);
  assert.equal(!!store.archive.find(r => r.id === 'b').deleted, false);
});

test('importJSON merges a legacy v1 export file and does not duplicate on re-import', () => {
  fresh();
  VtolStore.update(s => { VtolStore.upsert(s, 'archive', { id: 'keep', date: '2025-06-01T00:00:00Z', status: 'GO' }); });
  const legacyFile = JSON.stringify({
    archive: [{ date: '2025-05-01T10:00:00Z', duration: '12:00', status: 'GO', notes: '' }],
    weatherFavorites: [{ lat: 59.9, lon: 10.7, name: 'Field' }]
  });
  VtolStore.importJSON(legacyFile, { merge: true });
  VtolStore.importJSON(legacyFile, { merge: true });
  const s = VtolStore.load();
  assert.equal(VtolStore.live(s.archive).length, 2);
  assert.ok(s.archive.find(r => r.id === 'keep'));
  assert.equal(VtolStore.live(s.weatherFavorites).length, 1);
  assert.throws(() => VtolStore.importJSON('not json'));
  assert.throws(() => VtolStore.importJSON('[1,2]'));
});

test('exportJSON → importJSON round trip keeps the whole store (battery log included)', () => {
  fresh();
  VtolStore.update(s => {
    VtolStore.upsert(s, 'battLog', { id: 'b1', packId: VtolStore.IDS.carrierPack, date: '2025-05-01', start: 25, min: 23, rest: 23.4, sag: 2, source: 'manual' });
    s.settings.battCrtVolt = 22.0; s.settings.updatedAt = new Date().toISOString();
  });
  const exported = VtolStore.exportJSON();
  fresh();   // other device, empty
  VtolStore.importJSON(exported, { merge: true });
  const s = VtolStore.load();
  assert.equal(s.battLog[0].id, 'b1');
  assert.equal(s.settings.battCrtVolt, 22.0);   // never-edited local settings take the imported ones
});

test('settings are taken from an import only when they were edited more recently (settings.updatedAt)', () => {
  const local = VtolStore.defaults();
  local.settings.updatedAt = '2025-06-01T00:00:00Z';
  local.settings.battCrtVolt = 22.4;
  const copy = () => JSON.parse(JSON.stringify(local));
  const older = { updatedAt: '2025-09-01T00:00:00Z', settings: { battCrtVolt: 21.0, updatedAt: '2025-01-01T00:00:00Z' } };
  assert.equal(VtolStore.mergeStores(copy(), older).store.settings.battCrtVolt, 22.4);
  const newer = { updatedAt: '2025-07-01T00:00:00Z', settings: { battCrtVolt: 21.5, updatedAt: '2025-07-01T00:00:00Z' } };
  const r = VtolStore.mergeStores(copy(), newer);
  assert.equal(r.store.settings.battCrtVolt, 21.5);
  assert.equal(r.stats.settings, true);
  // never-stamped settings never overwrite, however new the file is
  const unstamped = { updatedAt: '2030-01-01T00:00:00Z', settings: { battCrtVolt: 21.0 } };
  assert.equal(VtolStore.mergeStores(copy(), unstamped).store.settings.battCrtVolt, 22.4);
});

test('regression: importing from a device that never edited its settings keeps edited local thresholds', async () => {
  // laptop: the user edited BATT_CRT to 22.4 and the checklist expiry to 4 h
  const laptop = fresh();
  VtolStore.update(s => { s.settings.battCrtVolt = 22.4; s.settings.checklistExpiryHours = 4; s.settings.updatedAt = new Date().toISOString(); });
  const laptopRaw = laptop.getItem('vtol_store');
  await new Promise(r => setTimeout(r, 5));
  // phone: default settings, logs a flight later (its top-level updatedAt is newer than the laptop's settings edit)
  fresh();
  VtolStore.update(s => { VtolStore.upsert(s, 'battLog', { id: 'phone-1', packId: VtolStore.IDS.carrierPack, date: '2030-01-01', start: 25, min: 23, rest: 23.4, sag: 2 }); });
  const phoneFile = VtolStore.exportJSON();
  assert.ok(JSON.parse(phoneFile).updatedAt > JSON.parse(laptopRaw).settings.updatedAt);
  // back on the laptop: import the phone's file
  fresh({ vtol_store: laptopRaw });
  VtolStore.importJSON(phoneFile, { merge: true });
  const s = VtolStore.load();
  assert.equal(s.settings.battCrtVolt, 22.4);
  assert.equal(s.settings.checklistExpiryHours, 4);
  assert.ok(s.battLog.find(e => e.id === 'phone-1'), 'records are still merged');
  assert.equal(VtolStore.importJSON.lastStats.settings, false);
});

test('validation: imported records with bad types are rejected, local valid copies survive', () => {
  fresh({ vtol_batt_type: JSON.stringify({ cells: 4, chem: 'liion' }) });   // local carrier pack: 4S Li-Ion (≠ default)
  const xss = '6<img src=x onerror=alert(1)>';
  VtolStore.importJSON(JSON.stringify({
    packs: [
      { id: 'evil', label: 'Evil', role: 'client', cells: xss, chem: 'lipo' },
      { id: VtolStore.IDS.carrierPack, label: 'Carrier 6S 7000', role: 'carrier', cells: '<b>', chem: 'lipo', updatedAt: '2099-01-01T00:00:00Z' },
      { id: 'ok4s', label: 'Client 4S', role: 'client', cells: '4', chem: 'liion', capacityMah: '' },
      { id: 'badcap', label: 'Bad capacity', role: 'client', cells: 4, chem: 'lipo', capacityMah: 'x' }
    ],
    battLog: [{ id: 'b-bad', date: '2025-01-01', start: 'abc', min: 22, rest: 23 }, { id: 'b-ok', date: '2025-01-02', start: '25.0', min: 23, rest: 23.5 }],
    weatherFavorites: [{ id: 'f-bad', lat: 'north', lon: 10, name: 'x' }]
  }), { merge: true });
  const s = VtolStore.load();
  const ids = VtolStore.live(s.packs).map(p => p.id);
  assert.ok(!ids.includes('evil'));
  const carrier = VtolStore.find(s, 'packs', VtolStore.IDS.carrierPack);
  // WP05 R11(a): an invalid incoming record is dropped — even for a default id it never resets the local record.
  assert.deepEqual([carrier.cells, carrier.chem], [4, 'liion'], 'invalid incoming default-pack record dropped, local pack kept');
  assert.ok(VtolStore.importJSON.lastStats.issues.some(t => /Carrier 6S 7000.*dropped/.test(t)));
  const p4 = VtolStore.find(s, 'packs', 'ok4s');
  assert.deepEqual([p4.cells, p4.capacityMah], [4, null], 'numeric string coerced, empty capacity = unknown');
  assert.equal(VtolStore.find(s, 'packs', 'badcap'), null, 'WP05 F5: an invalid capacity on import drops the record');
  assert.deepEqual(VtolStore.live(s.battLog).map(e => [e.id, e.start]), [['b-ok', 25]]);
  assert.equal(VtolStore.live(s.weatherFavorites).length, 0);
  assert.ok(VtolStore.importJSON.lastStats.issues.length >= 4);
});

test('validation on load: string or garbage settings fall back, are reported once and the repair is saved', () => {
  const d = VtolStore.defaults();
  d.settings.battCrtVolt = '22.6';          // numeric string → coerced
  d.settings.manualRtlVolt = 'abc';          // garbage → default
  d.settings.hardLimitVolt = null;
  d.packs[0].cells = '6"><svg onload=x>';
  const ls = fresh({ vtol_store: JSON.stringify(d) });
  VtolStore.takeIssues();
  const s = VtolStore.load();
  assert.deepEqual([s.settings.battCrtVolt, s.settings.manualRtlVolt, s.settings.hardLimitVolt, s.packs[0].cells], [22.6, 23.0, 22.5, 6]);
  const issues = VtolStore.takeIssues();
  assert.ok(issues.length >= 3 && issues.some(t => /manualRtlVolt/.test(t)));
  assert.equal(JSON.parse(ls.getItem('vtol_store')).settings.manualRtlVolt, 23.0, 'repair saved');
  VtolStore.load();
  assert.deepEqual(VtolStore.takeIssues(), [], 'reported once');
});

test('importJSON throws when the merged store cannot be saved', () => {
  const ls = fresh();
  VtolStore.load();
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => VtolStore.importJSON(JSON.stringify({ archive: [{ date: '2025-01-01T00:00:00Z' }] })), /could not be saved/);
});

test('uid() returns distinct short strings', () => {
  const ids = new Set(Array.from({ length: 500 }, () => VtolStore.uid()));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[0-9a-z-]{6,24}$/);
});
