'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');
const VtolStore = require('../../js/store.js');

const settings = VtolStore.defaults().settings;   // battCrtVolt 22.2, manualRtlVolt 23.0, hardLimitVolt 22.5, storage 3.80
const carrier = { id: 'c', role: 'carrier', cells: 6, chem: 'lipo' };
const client = { id: 'k', role: 'client', cells: 6, chem: 'lipo' };
const client4sLife = { id: 'l', role: 'client', cells: 4, chem: 'life' };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const entry = (start, min, rest) => ({ start, min, rest, sag: +(start - min).toFixed(2) });

test('battStats averages and extremes', () => {
  const st = T.battStats([entry(25.0, 22.0, 23.0), entry(25.2, 22.4, 23.2)]);
  near(st.avgStart, 25.1); near(st.avgMin, 22.2); near(st.lowestMin, 22.0);
  near(st.avgSag, 2.9); near(st.worstSag, 3.0);
  assert.equal(T.battStats([]), null);
});

test('S-05/IDX-01: BATT_LOW margin is measured to BATT_CRT_VOLT (22.2 V), not the chemistry floor', () => {
  // avg landing 22.0 V → raw 22.8 → floored to manual RTL 23.0 → 0.8 V above 22.2 (old code said 4.4 V above 18.6 V)
  const rec = T.recommendBattLow([entry(25, 22.0, 23)], carrier, settings);
  near(rec.recV, 23.0);
  near(rec.marginToCrtV, 0.8, 1e-9);
  assert.equal(rec.crtV, 22.2);
  assert.equal(rec.flooredByRtl, true);
  near(rec.chemFloorV, 18.6, 1e-9);
  near(rec.perCellV, 23.0 / 6);
  // above the floor: avg landing + 0.8
  const rec2 = T.recommendBattLow([entry(25, 23.0, 23.6)], carrier, settings);
  near(rec2.recV, 23.8); near(rec2.marginToCrtV, 1.6, 1e-9); assert.equal(rec2.flooredByRtl, false);
});

test('recommendation follows the settings thresholds', () => {
  const s = Object.assign({}, settings, { battCrtVolt: 21.6, manualRtlVolt: 22.4 });
  const rec = T.recommendBattLow([entry(25, 21.0, 22)], carrier, s);
  near(rec.recV, 22.4); near(rec.marginToCrtV, 0.8, 1e-9);
});

test('no ArduPilot recommendation for non-carrier packs', () => {
  assert.equal(T.recommendBattLow([entry(25, 22, 23)], client, settings), null);
});

test('minVoltLevel: carrier uses hardLimitVolt/manualRtlVolt, other packs per-cell chemistry', () => {
  assert.equal(T.minVoltLevel(22.4, carrier, settings), 'crit');   // < 22.5
  assert.equal(T.minVoltLevel(22.8, carrier, settings), 'warn');   // < 23.0
  assert.equal(T.minVoltLevel(23.2, carrier, settings), 'ok');
  assert.equal(T.minVoltLevel(22.4, client, settings), 'ok');      // 3.73 V/cell is fine for a client pack
  assert.equal(T.minVoltLevel(20.5, client, settings), 'warn');    // < (3.35+0.10)·6 = 20.7
  assert.equal(T.minVoltLevel(18.8, client, settings), 'crit');    // < (3.10+0.05)·6 = 18.9
  const s = Object.assign({}, settings, { hardLimitVolt: 22.0, manualRtlVolt: 22.6 });
  assert.equal(T.minVoltLevel(22.4, carrier, s), 'warn');
});

test('packThresholds: chemistry × cells, storage from storageVoltPerCell (LiPo only), carrier-only operational values', () => {
  const th = T.packThresholds(carrier, settings);
  near(th.fullV, 25.2); near(th.lowV, 20.1); near(th.critV, 18.6); near(th.storageV, 22.8);
  assert.deepEqual([th.crtV, th.rtlV, th.hardV], [22.2, 23.0, 22.5]);
  const tl = T.packThresholds(client4sLife, settings);
  near(tl.fullV, 14.6); near(tl.critV, 10.8);
  assert.equal(tl.storageV, null);                    // TBD — no LiFe storage value in the sources
  assert.deepEqual([tl.crtV, tl.rtlV, tl.hardV], [null, null, null]);
});

test('voltRange derives the plausible log window from cells × chemistry', () => {
  const r6 = T.voltRange(carrier);
  near(r6.minV, 6 * 3.10 * 0.85); near(r6.maxV, 6 * 4.20 * 1.05);
  const r4 = T.voltRange({ cells: 4, chem: 'lipo' });
  assert.ok(r4.maxV < 18 && r4.minV > 10);
});

test('healthClass and sagLevel', () => {
  assert.equal(T.healthClass(6 * 3.12, carrier).level, 'crit');
  assert.match(T.healthClass(6 * 3.12, carrier).text, /^CRITICAL/);
  assert.match(T.healthClass(6 * 3.38, carrier).text, /^LOW/);
  assert.equal(T.healthClass(6 * 3.43, carrier).level, 'warn');
  assert.equal(T.healthClass(6 * 3.80, carrier).level, 'ok');
  assert.equal(T.sagLevel(2.2, 6), 'crit');
  assert.equal(T.sagLevel(1.5, 6), 'warn');
  assert.equal(T.sagLevel(1.0, 6), 'ok');
});
