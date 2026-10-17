'use strict';
// WP14 rework round 1 — F2: a value from an imported param file ALWAYS takes precedence (contract C1.6), 0 included.
// BATT_LOW_VOLT = 0 / BATT_FS_LOW_ACT = 0 disables the low-battery failsafe (same for BATT_CRT_VOLT / BATT_FS_CRT_ACT;
// BATT_ARM_VOLT = 0 disables the arming-voltage check): every display says DISABLED, never the default voltage.
// Also F3 (BATT_FS_VOLTSRC note in the compact card) and F4 (import of an edited pre-Rev C backup → notice).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const T = require('../../js/tools-core.js');
const S = require('../../js/store.js');
const C = require('../../data/content.js');
const R = require('../../js/render-content.js');
const D = require('../../js/diagrams.js');

// The repo's own synthetic old file: BATT_CRT_VOLT 22.2, BATT_LOW_VOLT 0.
const SAMPLE = { name: 'sample.param', importedAt: '2026-10-17T10:00:00.000Z', params: T.parseParamFile(readText('test/fixtures/sample.param')).params };
const settings = S.defaults().settings;
const carrier = S.defaults().packs[0];
const ctxOf = eff => R.ctxFrom(Object.assign(S.defaults(), { settings: eff }));
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('F2: sample.param (BATT_LOW_VOLT 0) — low-battery failsafe DISABLED, not the default 22.0; BATT_CRT_VOLT 22.2 from the file', () => {
  const e = T.effectiveSettings(settings, SAMPLE);
  assert.equal(e.battLowVolt, null);
  assert.equal(e.voltSource.battLowVolt, 'file');
  assert.ok(Math.abs(e.battCrtVolt - 22.2) < 1e-6);
  assert.deepEqual(Object.keys(e.fsDisabled), ['battLowVolt']);
  assert.equal(e.fsDisabled.battLowVolt.text, 'LOW-BATTERY FAILSAFE DISABLED in imported file sample.param (BATT_LOW_VOLT = 0) — differs from reference 22.0 V');
  assert.equal(T.packThresholds(carrier, e).battLowV, null, 'no threshold line / marker');
});

test('F2: an action of 0 disables too (BATT_FS_LOW_ACT / BATT_FS_CRT_ACT), BATT_ARM_VOLT 0 disables the arming check, another action is flagged', () => {
  const pf = p => ({ name: 'x.param', importedAt: '2026-10-17T10:00:00.000Z', params: p });
  const a = T.effectiveSettings(settings, pf({ BATT_LOW_VOLT: 22, BATT_FS_LOW_ACT: 0, BATT_CRT_VOLT: 21, BATT_FS_CRT_ACT: 0, BATT_ARM_VOLT: 0 }));
  assert.deepEqual(Object.keys(a.fsDisabled).sort(), ['battArmVolt', 'battCrtVolt', 'battLowVolt']);
  assert.match(a.fsDisabled.battLowVolt.text, /\(BATT_FS_LOW_ACT = 0\)/);
  assert.match(a.fsDisabled.battCrtVolt.text, /CRITICAL-BATTERY FAILSAFE DISABLED .*\(BATT_FS_CRT_ACT = 0\) — differs from reference 21\.0 V/);
  assert.match(a.fsDisabled.battArmVolt.text, /ARMING-VOLTAGE CHECK DISABLED .*\(BATT_ARM_VOLT = 0\) — differs from reference 24\.6 V/);
  assert.deepEqual([a.battLowVolt, a.battCrtVolt, a.battArmVolt], [null, null, null]);
  const b = T.effectiveSettings(settings, pf({ BATT_FS_LOW_ACT: 2 }));
  assert.deepEqual(b.fsDisabled, {});
  assert.deepEqual(b.fsActDiffers.battLowVolt, { actParam: 'BATT_FS_LOW_ACT', act: 2, ref: 1 });
  assert.equal(b.battLowVolt, 22.0, 'voltage from the settings when the file has none');
  // the reference itself: nothing disabled or different
  const r = T.effectiveSettings(settings, pf(require('../../data/params-reference.js').params));
  assert.deepEqual([r.fsDisabled, r.fsActDiffers], [{}, {}]);
});

test('F2: emergency card, failsafe table, design intent and checklists state DISABLED — no default voltage, no "AUTO RTL" promise', () => {
  const e = T.effectiveSettings(settings, SAMPLE), ctx = ctxOf(e);
  const c = T.contentForFailsafes(C, e);
  assert.notEqual(c, C);
  assert.equal(T.contentForFailsafes(C, T.effectiveSettings(settings, null)), C, 'unchanged content when nothing is disabled');
  assert.match(JSON.stringify(C), /\{settings\.battLowVolt\}V → AUTO \[\[RTL\]\] \(FAILSAFE\)/, 'the original content is not modified');
  const compact = strip(R.emergencyCard(c.emergencies.find(x => x.id === 'emerg-batt'), ctx, { compact: true }));
  assert.match(compact, /LOW-BATT FAILSAFE DISABLED — NO AUTO RTL/);
  assert.doesNotMatch(compact, /AUTO RTL \(FAILSAFE\)|(?<!reference )22\.0 ?V|TBD/, 'the default 22.0 V appears only as the reference');
  assert.match(compact, /22\.2V → AUTO QLAND HERE/, 'the critical step follows the file value');
  assert.match(compact, /Start the RTL manually at 23\.0 V/);
  const full = strip(R.emergencyCard(c.emergencies.find(x => x.id === 'emerg-batt'), ctx));
  assert.match(full, /LOW-BATTERY FAILSAFE DISABLED in sample\.param — NO automatic RTL \(reference 22\.0 V\)/);
  assert.doesNotMatch(full, /BATT_LOW_VOLT [\d.]+ ?V → automatic RTL|The automatic RTL ends/);
  const table = strip(R.failsafeTable(c.failsafeTable, ctx));
  assert.match(table, /Battery low .*BATT_LOW_VOLT \/ BATT_FS_LOW_ACT in sample\.param .*LOW-BATTERY FAILSAFE DISABLED/);
  assert.match(strip(R.designIntent(c.designIntent, ctx)), /low battery LOW-BATTERY FAILSAFE DISABLED in sample\.param/);
  const lists = strip(R.checklist(c.checklists.preflight, { items: {} }, ctx));
  assert.doesNotMatch(lists, /low battery \(22\.0 V\)/);
  // no token of a disabled value is left anywhere (it would render as a number or TBD)
  assert.doesNotMatch(JSON.stringify(c), /\{settings\.battLowVolt\}/);
  // EO mode / every card: no step anywhere promises the disabled RTL
  for (const em of c.emergencies) assert.doesNotMatch(em.immediate.map(x => R.plain(x, ctx)).join(' '), /AUTO \[\[RTL\]\] \(FAILSAFE\)/);
});

test('F2: gauge, trend and battery analysis — no automatic-RTL marker, an explicit DISABLED note', () => {
  const e = T.effectiveSettings(settings, SAMPLE);
  const g = D.batteryGauge(carrier, e);
  assert.doesNotMatch(g, /BATT_LOW_VOLT — AUTOMATIC RTL|Below BATT_LOW/);
  assert.match(g, /LOW-BATTERY FAILSAFE DISABLED in imported file sample\.param \(BATT_LOW_VOLT = 0\)/);
  assert.match(g, /22\.2 V · 3\.70 V\/cell/, 'BATT_CRT_VOLT from the file');
  const both = T.effectiveSettings(settings, { name: 'y.param', importedAt: '2026-10-17T10:00:00.000Z', params: { BATT_LOW_VOLT: 0, BATT_CRT_VOLT: 0 } });
  const g2 = D.batteryGauge(carrier, both);
  assert.doesNotMatch(g2, /BATT_CRT_VOLT — Loiter|Below BATT_CRT/);
  assert.match(g2, /CRITICAL-BATTERY FAILSAFE DISABLED/);
  assert.match(g2, /RTL now/, 'the pilot zones remain');
  const t = D.battTrend([{ date: '2026-10-01', min: 22.6 }, { date: '2026-10-02', min: 22.9 }], carrier, e);
  assert.doesNotMatch(t, /BATT_LOW RTL/);
  assert.doesNotMatch(t, /y1="[^"]*" x2="[^"]*" y2="[^"]*" stroke="var\(--red\)" stroke-dasharray="4,4"\/><text[^>]*>0\.0/, 'no line at 0 V');
  const rec = T.suggestManualRtl([{ start: 25, min: 22.6, rest: 23, sag: 2.4 }], carrier, e);
  assert.equal(rec.lowV, null); assert.equal(rec.marginToLowV, null);
});

test('F2: the pages use the adapted content and show the disabled state (header, banner, analysis, Params view)', () => {
  const idx = readText('index.html'), man = readText('manual.html');
  assert.match(idx, /CONTENT = ToolsCore\.contentForFailsafes\(VtolContent, contentCtx\.settings\)/);
  assert.match(idx, /VtolRender\.emergencies\(CONTENT\.emergencies, CONTENT\.emergencyNotes, contentCtx, \{ compact: true \}\)/);
  assert.match(idx, /<div id="fs-alert" class="alert alert-danger" role="alert" hidden><\/div>/);
  assert.match(idx, /el\.textContent = dis\[k\] \? 'DISABLED in '/);
  assert.match(idx, /dv\('battLowVolt'\) \+ ' — NO automatic RTL'/);
  assert.match(idx, /const disHtml = Object\.keys\(dis\)/);
  assert.match(man, /var C = self\.ToolsCore \? ToolsCore\.contentForFailsafes\(VtolContent, manCtx\.settings\) : VtolContent;/);
  assert.match(man, /<div id="man-fs-alert" class="alert alert-danger" role="alert" hidden><\/div>/);
});

test('F3: the compact (Tools modal / kneeboard) battery card carries the BATT_FS_VOLTSRC note', () => {
  const ctx = ctxOf(T.effectiveSettings(settings, null));
  const compact = strip(R.emergencyCard(C.emergencies.find(x => x.id === 'emerg-batt'), ctx, { compact: true }));
  assert.match(compact, /sag-compensated voltage \(BATT_FS_VOLTSRC = 1\); the OSD reads raw voltage, lower under load/);
});

test('F4: importing an edited pre-Rev C JSON backup (22.2, no battLowVolt) gives the migration notice', () => {
  const m = new Map();
  S._setStorage({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
  S.takeIssues();
  S.load();
  assert.deepEqual(S.notices(), []);
  const old = S.defaults();
  old.settings.battCrtVolt = 22.2; old.settings.updatedAt = '2030-01-01T00:00:00.000Z';
  delete old.settings.battLowVolt; delete old.settings.battArmVolt;
  const st = S.importJSON(JSON.stringify(old), { merge: true });
  assert.equal(st.settings.battCrtVolt, 22.2, 'edited value kept');
  assert.deepEqual([st.settings.battLowVolt, st.settings.battArmVolt], [22.0, 24.6]);
  const n = S.notices();
  assert.equal(n.length, 1);
  assert.match(n[0].text, /^Import: Carrier thresholds: your edited settings were kept, but they differ from the reference param file \(2026-10-17\): BATT_CRT_VOLT 22\.2 V/);
  // a Rev C backup gives no notice
  S.dismissNotice(n[0].id);
  const rc = S.defaults(); rc.settings.updatedAt = '2031-01-01T00:00:00.000Z';
  S.importJSON(JSON.stringify(rc), { merge: true });
  assert.deepEqual(S.notices(), []);
});
