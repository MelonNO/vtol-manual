// Drift guard (contract C1.4, WP02 rework F1): the map's fallback profiles must equal
// VtolStore.defaults() / VtolStore.IDS from js/store.js exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const VtolStore = require('../../js/store.js');
const M = require('../../relay/rfmodel.js');

test('RfModel.DEFAULT_PROFILES equals VtolStore.defaults() packs, clients and links', () => {
  const d = VtolStore.defaults();
  assert.deepStrictEqual(M.DEFAULT_PROFILES.packs, d.packs);
  assert.deepStrictEqual(M.DEFAULT_PROFILES.clients, d.clients);
  assert.deepStrictEqual(M.DEFAULT_PROFILES.links, d.links);
});

test('fallback profiles use the VtolStore.IDS ids', () => {
  const I = VtolStore.IDS, P = M.DEFAULT_PROFILES;
  assert.deepEqual(P.packs.map(p => p.id), [I.carrierPack, I.mastPack, I.clientPack]);
  assert.equal(P.clients[0].id, I.refClient);
  assert.equal(P.clients[0].packId, I.clientPack);
  assert.deepEqual(P.links.map(l => l.id), [I.videoLink, I.rcLink, I.gcsLink]);
});
