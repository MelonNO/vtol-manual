'use strict';
// WP05 R11(a)(b): client and link profile validation in js/store.js (C1.3 types, enums, ranges, null = TBD).
const test = require('node:test');
const assert = require('node:assert/strict');
const VtolStore = require('../../js/store.js');

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
}
function fresh(init) { const s = memStorage(init); VtolStore._setStorage(s); VtolStore.takeIssues(); return s; }
const NEW = '2099-01-01T00:00:00Z';

test('defaults load without any repair issue (clients and links are valid)', () => {
  fresh();
  VtolStore.load();
  assert.deepEqual(VtolStore.takeIssues(), []);
  const s = VtolStore.load();
  assert.equal(VtolStore.find(s, 'links', VtolStore.IDS.gcsLink).antenna, null, 'null antenna = TBD is allowed');
});

test('validateRecord: coerces numeric strings and enum numbers, keeps nulls as TBD', () => {
  const d = VtolStore.defaults().clients[0];
  const r = VtolStore.validateRecord('clients', Object.assign({}, d, { vtx: { band: 'F', channel: '4', freqMHz: '5800', powerMw: '' }, elrs: { band: 868, packetRateHz: null, modelId: '3', telemetryRatio: '8', geminiRx: 'true' } }));
  assert.ok(r.record, r.issues.join());
  assert.deepEqual(r.record.vtx, { band: 'F', channel: 4, freqMHz: 5800, powerMw: null });
  assert.deepEqual(r.record.elrs, { band: '868', packetRateHz: null, modelId: 3, telemetryRatio: 8, geminiRx: true });
});

test('validateRecord rejects bad types, enums, ranges and a missing name', () => {
  const d = VtolStore.defaults();
  const bad = [
    Object.assign({}, d.clients[0], { name: '' }),
    Object.assign({}, d.clients[0], { videoStandard: 'SECAM' }),
    Object.assign({}, d.clients[0], { vtx: Object.assign({}, d.clients[0].vtx, { freqMHz: 'abc' }) }),
    Object.assign({}, d.clients[0], { vtx: Object.assign({}, d.clients[0].vtx, { channel: 2.5 }) }),
    Object.assign({}, d.clients[0], { failsafe: { type: 'gps_rescue', minSats: -1, delayS: 2.5 } }),
    Object.assign({}, d.clients[0], { elrs: Object.assign({}, d.clients[0].elrs, { band: '5.8' }) }),
    Object.assign({}, d.clients[0], { name: { evil: 1 } })
  ];
  for (const b of bad) { const r = VtolStore.validateRecord('clients', b); assert.equal(r.record, null, JSON.stringify(b).slice(0, 80)); assert.ok(r.issues.length); }
  for (const l of [Object.assign({}, d.links[0], { kind: 'lte' }), Object.assign({}, d.links[0], { rxSensDbm: 20 }), Object.assign({}, d.links[0], { antenna: 'yagi' })]) {
    assert.equal(VtolStore.validateRecord('links', l).record, null);
  }
  assert.ok(VtolStore.validateRecord('links', d.links[2]).record, 'all-TBD link is valid');
  assert.equal(VtolStore.validateRecord('packs', Object.assign({}, d.packs[0], { cells: null })).record, null);
});

test('import: invalid client/link records are dropped and never overwrite valid local ones (incl. default ids)', () => {
  fresh();
  VtolStore.update(s => { VtolStore.find(s, 'clients', VtolStore.IDS.refClient).videoStandard = 'PAL'; });
  VtolStore.importJSON(JSON.stringify({
    clients: [
      Object.assign(VtolStore.defaults().clients[0], { videoStandard: 'bogus', name: '<b>x</b>', updatedAt: NEW }),
      { id: 'c2', name: 'Good 5"', vtx: { band: 'R', channel: 1, freqMHz: 5658, powerMw: 200 }, videoStandard: 'NTSC', elrs: { band: '915' }, failsafe: { type: 'land' }, packId: null, notes: '' }
    ],
    links: [Object.assign(VtolStore.defaults().links[0], { txPowerDbm: '14 dBm', updatedAt: NEW })]
  }), { merge: true });
  const s = VtolStore.load();
  const ref = VtolStore.find(s, 'clients', VtolStore.IDS.refClient);
  assert.equal(ref.videoStandard, 'PAL');
  assert.equal(ref.name, 'Reference client #1');
  const c2 = VtolStore.find(s, 'clients', 'c2');
  assert.deepEqual([c2.videoStandard, c2.elrs.band, c2.elrs.packetRateHz, c2.elrs.geminiRx, c2.failsafe.minSats], ['NTSC', '915', null, false, null]);
  assert.equal(VtolStore.find(s, 'links', VtolStore.IDS.videoLink).txPowerDbm, 14);
  const issues = VtolStore.importJSON.lastStats.issues.join('\n');
  assert.match(issues, /Client "<b>x<\/b>" dropped: invalid videoStandard/);
  assert.match(issues, /Link .* dropped: invalid txPowerDbm/);
});

test('load: bad stored fields are repaired (default → default value, others → TBD), bad name drops', () => {
  const d = VtolStore.defaults();
  d.clients[0].vtx.freqMHz = 'garbage';
  d.clients.push({ id: 'c9', name: 'Mine', vtx: { band: 'A', channel: 99999, freqMHz: 5865, powerMw: 25 }, videoStandard: 'PAL', elrs: { band: '2.4' }, failsafe: { type: 'land' } });
  d.clients.push({ id: 'c10', name: '', vtx: {} });
  d.links[1].antenna = 'yagi';
  fresh({ vtol_store: JSON.stringify(d) });
  const s = VtolStore.load();
  assert.equal(VtolStore.find(s, 'clients', VtolStore.IDS.refClient).vtx.freqMHz, 5806);
  const c9 = VtolStore.find(s, 'clients', 'c9');
  assert.equal(c9.vtx.channel, null);
  assert.equal(c9.vtx.freqMHz, 5865);
  assert.equal(VtolStore.find(s, 'clients', 'c10'), null);
  assert.equal(VtolStore.find(s, 'links', VtolStore.IDS.rcLink).antenna, 'dipole');
  const issues = VtolStore.takeIssues().join('\n');
  assert.match(issues, /reset to the default profile value/);
  assert.match(issues, /Client "Mine": invalid vtx.channel — set to TBD/);
  assert.match(issues, /dropped: invalid name/);
});
