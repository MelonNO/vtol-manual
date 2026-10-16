'use strict';
// S-06 / IDX-02 / IDX-14: checklist state with stable ids, per-item timestamps, sessions and expiry.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

const H = 3600000;
const NOW = Date.UTC(2025, 4, 1, 12, 0, 0);
const SECTIONS = [
  { id: 'A', items: [{ id: 'site-airspace' }, { id: 'site-wind' }, { id: 'site-lz' }] },
  { id: 'B', items: [{ id: 'build-airframe' }, { id: 'build-props' }] }
];

test('clNew starts an empty session', () => {
  const st = T.clNew(NOW, 's1');
  assert.deepEqual(st, { session: { id: 's1', startedAt: new Date(NOW).toISOString() }, items: {} });
  assert.equal(T.clIsExpired(st, NOW + 100 * H, 6), false);   // nothing ticked → nothing to expire
});

test('clToggle stores {checked, ts}; the first tick of an empty list opens a new session', () => {
  const st = T.clNew(NOW - 10 * H, 'old');
  T.clToggle(st, 'site-wind', true, NOW, 's2');
  assert.deepEqual(st.session, { id: 's2', startedAt: new Date(NOW).toISOString() });
  assert.deepEqual(st.items['site-wind'], { checked: true, ts: new Date(NOW).toISOString() });
  T.clToggle(st, 'site-lz', true, NOW + 60000, 's3');
  assert.equal(st.session.id, 's2', 'later ticks stay in the session');
  T.clToggle(st, 'site-wind', false, NOW + 120000, 's4');
  assert.equal(st.items['site-wind'], undefined);
  assert.equal(T.clCheckedCount(st), 1);
});

test('clIsExpired: older than the expiry hours (6) with ticks → expired', () => {
  const st = T.clNew(NOW, 's1');
  T.clToggle(st, 'site-airspace', true, NOW, 's1');
  assert.equal(T.clIsExpired(st, NOW + 5.9 * H, 6), false);
  assert.equal(T.clIsExpired(st, NOW + 6.1 * H, 6), true);
  assert.equal(T.clIsExpired(st, NOW + 2.1 * H, 2), true);
  st.session.startedAt = 'garbage';
  assert.equal(T.clIsExpired(st, NOW, 6), true, 'ticks of unknown age never count as fresh');
});

test('clMigrateLegacy maps old index keys ("A-1") to stable item ids, tick times unknown', () => {
  const st = T.clMigrateLegacy({ 'A-0': true, 'A-2': true, 'B-1': true, 'B-0': false, 'Z-9': true }, SECTIONS, NOW, 'm1');
  assert.deepEqual(Object.keys(st.items).sort(), ['build-props', 'site-airspace', 'site-lz']);
  assert.ok(Object.values(st.items).every(i => i.checked === true && i.ts === null));
  assert.equal(st.session.migrated, true);
  assert.equal(st.session.startedAt, new Date(NOW).toISOString());
  assert.equal(T.clIsExpired(st, NOW + 7 * H, 6), true, 'migrated ticks also expire');
});

test('clNormalize rejects old/invalid shapes and keeps only checked items', () => {
  assert.equal(T.clNormalize(null), null);
  assert.equal(T.clNormalize({ 'A-0': true }), null);      // old v1 format
  const st = T.clNormalize({ session: { id: 's', startedAt: '2025-05-01T10:00:00.000Z' }, items: { a: { checked: true, ts: '2025-05-01T10:01:00.000Z' }, b: { checked: false }, c: null } });
  assert.deepEqual(Object.keys(st.items), ['a']);
});

test('expiry works with a faked old timestamp on the saved state', () => {
  const saved = JSON.parse(JSON.stringify({ session: { id: 's', startedAt: new Date(NOW - 8 * H).toISOString() }, items: { 'site-airspace': { checked: true, ts: new Date(NOW - 8 * H).toISOString() } } }));
  assert.equal(T.clIsExpired(T.clNormalize(saved), NOW, 6), true);
});
