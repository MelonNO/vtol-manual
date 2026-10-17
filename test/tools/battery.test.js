'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');
const VtolStore = require('../../js/store.js');

const settings = VtolStore.defaults().settings;   // Rev C: battCrtVolt 21.0, battLowVolt 22.0, battArmVolt 24.6, manualRtlVolt 23.0, hardLimitVolt 22.5, storage 3.80
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

// WP14 R6 (plan §15.4): the output is a suggested MANUAL RTL trigger (pilot, OSD raw voltage); BATT_LOW_VOLT 22.0 /
// BATT_CRT_VOLT 21.0 are configured failsafes that are shown, never recommended or changed.
test('R6: suggested manual RTL trigger = avg landing + 0.8 V, never below the manual RTL setting; failsafes shown, not recommended', () => {
  assert.equal(T.recommendBattLow, undefined, 'the BATT_LOW_VOLT recommendation is gone');
  // avg landing 22.0 V → raw 22.8 → floored to manual RTL 23.0
  const rec = T.suggestManualRtl([entry(25, 22.0, 23)], carrier, settings);
  near(rec.recV, 23.0);
  assert.equal(rec.flooredByRtl, true); assert.equal(rec.raisesManualRtl, false);
  assert.equal(rec.lowV, 22.0); near(rec.marginToLowV, 1.0, 1e-9);
  assert.equal(rec.crtV, 21.0); near(rec.marginToCrtV, 2.0, 1e-9);
  near(rec.chemFloorV, 18.6, 1e-9);
  near(rec.perCellV, 23.0 / 6);
  // above the floor: avg landing + 0.8 → suggests raising the pilot's call, never a parameter
  const rec2 = T.suggestManualRtl([entry(25, 23.0, 23.6)], carrier, settings);
  near(rec2.recV, 23.8); assert.equal(rec2.flooredByRtl, false); assert.equal(rec2.raisesManualRtl, true);
  assert.equal(rec2.lowV, 22.0, 'BATT_LOW_VOLT unchanged by the log');
});

test('suggestion follows the settings thresholds (effective settings: param file values take precedence)', () => {
  const s = Object.assign({}, settings, { manualRtlVolt: 22.4 });
  const rec = T.suggestManualRtl([entry(25, 21.0, 22)], carrier, s);
  near(rec.recV, 22.4);
  const eff = T.effectiveSettings(settings, { name: 'x.param', importedAt: '2026-10-17T10:00:00Z', params: { BATT_LOW_VOLT: 22.2, BATT_CRT_VOLT: 21.2 } });
  const r2 = T.suggestManualRtl([entry(25, 22.0, 23)], carrier, eff);
  assert.equal(r2.lowV, 22.2); assert.equal(r2.crtV, 21.2);
});

test('no manual RTL suggestion for non-carrier packs', () => {
  assert.equal(T.suggestManualRtl([entry(25, 22, 23)], client, settings), null);
});

test('C1.6: effectiveSettings — an imported param file\'s BATT_CRT/LOW/ARM_VOLT take precedence, with the source', () => {
  const none = T.effectiveSettings(settings, null);
  assert.deepEqual([none.battCrtVolt, none.battLowVolt, none.battArmVolt], [21.0, 22.0, 24.6]);
  assert.deepEqual(none.voltSource, { battCrtVolt: 'settings', battLowVolt: 'settings', battArmVolt: 'settings' });
  assert.equal(none.voltFile, null);
  const pf = { name: 'carrier.param', importedAt: '2026-10-17T10:00:00Z', params: { BATT_CRT_VOLT: 20.8, BATT_LOW_VOLT: 0 } };
  const e = T.effectiveSettings(settings, pf);
  assert.equal(e.battCrtVolt, 20.8); assert.equal(e.voltSource.battCrtVolt, 'file');
  assert.equal(e.battLowVolt, 22.0, 'a 0 (not set) value in the file does not replace the setting');
  assert.equal(e.voltSource.battLowVolt, 'settings'); assert.equal(e.voltFile, 'carrier.param');
  assert.equal(settings.battCrtVolt, 21.0, 'the stored settings are not mutated');
  assert.deepEqual(T.settingsVsReference(settings), []);
  assert.deepEqual(T.settingsVsReference(Object.assign({}, settings, { battCrtVolt: 22.2 })).map(d => [d.param, d.setting, d.ref]), [['BATT_CRT_VOLT', 22.2, 21]]);
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
  assert.deepEqual([th.armV, th.rtlV, th.hardV, th.battLowV, th.crtV], [24.6, 23.0, 22.5, 22.0, 21.0]);   // plan §15.3 ladder
  const tl = T.packThresholds(client4sLife, settings);
  near(tl.fullV, 14.6); near(tl.critV, 10.8);
  assert.equal(tl.storageV, null);                    // TBD — no LiFe storage value in the sources
  assert.deepEqual([tl.crtV, tl.rtlV, tl.hardV, tl.battLowV, tl.armV], [null, null, null, null, null]);
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
