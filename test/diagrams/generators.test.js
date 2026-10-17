'use strict';
// WP07 R4–R6: js/diagrams.js generators return well-formed SVG with a <title>, CSS-variable colours only, escaped text.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../js/diagrams.js');
const S = require('../../js/store.js');
const { wellFormed } = require('./xml.js');

const HEX = /#[0-9a-fA-F]{3,8}\b/;
// Fragment references (href="#sym-quad", url(#id)) are not colours.
const hexFree = svg => !HEX.test(svg.replace(/href="#[\w-]+"/g, '').replace(/url\(#[\w-]+\)/g, ''));
function checkSvg(svg, what) {
  assert.equal(typeof svg, 'string', what);
  assert.ok(svg.startsWith('<svg '), what + ': starts with <svg');
  const wf = wellFormed(svg);
  assert.ok(wf.ok, what + ': well-formed — ' + wf.error);
  assert.equal(wf.root, 'svg', what);
  assert.match(svg, /^<svg [^>]*role="img"/, what + ': role=img');
  assert.match(svg, /<title>[^<]+<\/title>/, what + ': has a <title>');
  assert.ok(hexFree(svg), what + ': no hex colours (CSS variables only)');
  assert.doesNotMatch(svg, /NaN|undefined|Infinity/, what + ': no NaN / undefined');
  // every font size used is ≥ 11 (sizes are in user units; the charts are drawn 1:1 or with a min-width)
  for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) assert.ok(+m[1] >= 11, what + ': font-size ' + m[1]);
}

const DEF = S.defaults();
const carrier = DEF.packs.find(p => p.role === 'carrier');
const client = DEF.packs.find(p => p.role === 'client');
const settings = DEF.settings;

test('XML checker rejects broken markup (sanity check of the test helper)', () => {
  assert.ok(wellFormed('<svg><g><text>a &amp; b</text></g></svg>').ok);
  for (const bad of ['<svg><g></svg>', '<svg a="1" a="2"/>', '<svg><text>a & b</text></svg>', '<svg x=1/>', '<svg/><svg/>', '<svg><!-- a -- b --></svg>', '<svg t="<"/>', 'text', '<svg>'])
    assert.equal(wellFormed(bad).ok, false, bad);
});

test('batteryGauge (R4): carrier markers manual RTL, hard limit, BATT_CRT, storage; BATT_LOW only when set', () => {
  const g = D.batteryGauge(carrier, settings);
  checkSvg(g, 'gauge carrier');
  for (const v of ['23.0 V', '22.5 V', '22.2 V', '22.8 V']) assert.ok(g.includes(v), v);
  assert.match(g, /MANUAL RTL/); assert.match(g, /HARD LIMIT/); assert.match(g, /BATT_CRT_VOLT/); assert.match(g, /STORAGE/);
  assert.match(g, /BATT_LOW_VOLT not set/);
  assert.doesNotMatch(g, /BATT_LOW_VOLT — low-battery warning/);
  const g2 = D.batteryGauge(carrier, settings, { battLowVolt: 23.6 });
  checkSvg(g2, 'gauge with BATT_LOW');
  assert.match(g2, /23\.6 V/); assert.match(g2, /BATT_LOW_VOLT — low-battery warning/); assert.doesNotMatch(g2, /not set/);
  // MAN-14: the operating zone ends at the manual RTL voltage, "RTL now" between hard limit and RTL
  assert.match(g, /22\.5–23\.0 V: RTL now/);
  assert.match(g, /23\.0–25\.2 V: Operate/);
  // profile-driven: a changed setting moves the marker
  assert.match(D.batteryGauge(carrier, Object.assign({}, settings, { manualRtlVolt: 23.4 })), /23\.4 V · 3\.90 V\/cell/);
});

test('batteryGauge: other packs and chemistries (client, mast, Li-Ion storage TBD), escaped label', () => {
  const g = D.batteryGauge(client, settings);
  checkSvg(g, 'gauge client');
  assert.doesNotMatch(g, /MANUAL RTL|BATT_CRT/, 'carrier thresholds only for carrier packs');
  assert.match(g, /LONGEVITY FLOOR/); assert.match(g, /STORAGE/);
  const li = D.batteryGauge(Object.assign({}, client, { chem: 'liion', label: '<img src=x onerror=alert(1)>' }), settings);
  checkSvg(li, 'gauge li-ion');
  assert.match(li, /Storage voltage for Li-Ion: TBD/);
  assert.doesNotMatch(li, /<img/);
  assert.match(li, /&lt;img src=x/);
  const nulls = D.batteryGauge(carrier, Object.assign({}, settings, { manualRtlVolt: null, hardLimitVolt: null }));
  checkSvg(nulls, 'gauge with null settings');
  assert.match(nulls, /Carrier thresholds: TBD/);
});

test('battTrend (R5): profile thresholds, y-axis ticks, <title> with date on every point', () => {
  const e = [
    { date: '2026-10-09', flight: '3', min: 23.6 }, { date: '2026-10-05', flight: '<b>2</b>', min: 23.3 }, { date: '2026-10-01', flight: '1', min: 22.4 }
  ];
  const t = D.battTrend(e, carrier, settings);
  checkSvg(t, 'trend');
  assert.equal((t.match(/<circle/g) || []).length, 3);
  for (const d of ['2026-10-09', '2026-10-05', '2026-10-01']) assert.match(t, new RegExp('<title>' + d));
  assert.match(t, /23\.0 MANUAL RTL/); assert.match(t, /22\.5 HARD LIMIT/); assert.match(t, /22\.2 BATT_CRT/);
  assert.ok((t.match(/text-anchor="end">\d+<\/text>/g) || []).length >= 3, 'y-axis tick labels');
  assert.match(t, /&lt;b&gt;2&lt;\/b&gt;/, 'flight text escaped');
  assert.match(t, /CRIT<\/title>/, 'level as text, not only colour');
  const c = D.battTrend(e, client, settings);
  checkSvg(c, 'trend client');
  assert.match(c, /LONGEVITY FLOOR/); assert.doesNotMatch(c, /MANUAL RTL/);
  assert.equal(D.battTrend(e.slice(0, 1), carrier, settings), '', 'needs two entries');
  const many = Array.from({ length: 20 }, (_, i) => ({ date: '2026-09-' + String(i + 1).padStart(2, '0'), min: 23 }));
  assert.equal((D.battTrend(many, carrier, settings).match(/<circle/g) || []).length, 12, 'last 12 flights');
});

test('battSparkline (R5): threshold line, axis values, date tooltip', () => {
  const s = D.battSparkline({ date: '2026-10-01', flight: '1', start: 25.0, min: 22.4, rest: 23.0 }, carrier, settings);
  checkSvg(s, 'sparkline');
  assert.match(s, /<title>2026-10-01 · 1 — start 25 V, min 22\.4 V, rest 23 V — CRIT \(manual RTL 23\.0 V dashed\)<\/title>/);
  assert.match(s, />25\.2<\/text>/); assert.match(s, />18\.6<\/text>/);
  assert.match(s, /stroke-dasharray="3,3"/);
});

test('windCompass (R5): land-into-wind hint and gust-spread arc from the limits', () => {
  const w = D.windCompass(250, 6.2, 9.1, 'var(--amber)', settings);
  checkSvg(w, 'compass');
  assert.match(w, /INTO WIND 250° WSW/);
  assert.match(w, /Take off and land into wind: heading 250° WSW/);
  assert.match(w, /<title>Gust spread 6\.2 → 9\.1 m\/s<\/title>/);
  assert.match(w, /full circle = gust limit 10 m\/s/);
  checkSvg(D.windCompass(null, null, null, 'var(--muted)', {}), 'compass without data');
  assert.equal(D.cardinal(0), 'N'); assert.equal(D.cardinal(359), 'N'); assert.equal(D.cardinal(180), 'S');
});

test('timeChart (R5): mode timeline overlay, transition / failsafe event markers, axis ticks, escaping', () => {
  const v = [], t = [];
  for (let i = 0; i <= 300; i++) { v.push(i % 50); t.push(i * 1e6); }
  const modes = [{ t0: 0, t1: 60e6, name: 'QHOVER', cls: 'vtol' }, { t0: 60e6, t1: 200e6, name: 'AUTO', cls: 'fw' }, { t0: 200e6, t1: 300e6, name: 'Q<RTL>', cls: 'vtol' }];
  const events = [{ t: 61e6, kinds: ['transition'], text: 'Transition done' }, { t: 201e6, kinds: ['failsafe'], text: 'Failsafe <script>' }];
  const c = D.timeChart(v, t, { color: 'var(--green)', unit: 'm', label: 'Altitude', modes, events });
  checkSvg(c, 'timeChart');
  assert.match(c, /flight-mode timeline/); assert.match(c, /2 marked events/);
  assert.match(c, /<title>QHOVER 0:00–1:00<\/title>/);
  assert.match(c, /<title>1:01 · transition · Transition done<\/title>/);
  assert.match(c, /Failsafe &lt;script&gt;/);
  assert.match(c, /stroke="var\(--red\)"[^>]*stroke-dasharray="4,3"/, 'failsafe marker in red');
  assert.match(c, /stroke="var\(--amber\)"[^>]*stroke-dasharray="4,3"/, 'transition marker in amber');
  assert.match(c, />5:00<\/text>/, 'time axis end');
  assert.match(c, /min-width:\d+px/, 'scroll min-width');
  const plain = D.timeChart([1, 2, null, 4], [0, 1e6, 2e6, 3e6], { color: 'var(--accent)' });
  checkSvg(plain, 'timeChart plain');
  assert.equal(D.timeChart([1], [0], {}), '', 'needs two points');
  assert.equal(D.timeChart([5, 5, 5], [0, 0, 0], {}).length > 0, true, 'flat / zero-length series does not throw');
  checkSvg(D.timeChart([5, 5, 5], [0, 0, 0], {}), 'degenerate');
});

test('gpsRescue (R3): parameterised from the profile; null → TBD; quad icon via <use>', () => {
  const p = { name: 'Ref <1>', delayS: 2.5, minSats: 8, climbM: 30, returnAltM: 100, speedMs: 7.5, descentDistM: 20, descentRateMs: 1.5, landingAltM: 4, minDistM: 15, altMode: 'CURRENT_ALT' };
  const g = D.gpsRescue(p);
  checkSvg(g, 'gps rescue');
  assert.match(g, /\+ 2\.5 s delay/); assert.match(g, /Needs 8\+ GPS sats/); assert.match(g, /LANDING PHASE 4 m/);
  assert.match(g, /<use href="#sym-quad"/);
  assert.match(g, /Ref &lt;1&gt;/);
  const n = D.gpsRescue(Object.assign({}, p, { delayS: null, minSats: null }));
  checkSvg(n, 'gps rescue nulls');
  assert.match(n, /\+ TBD delay/); assert.match(n, /Needs TBD\+ GPS sats/);
});

test('niceTicks / mmss helpers', () => {
  assert.deepEqual(D.niceTicks(18.6, 25.2, 4), [20, 22, 24]);
  assert.deepEqual(D.niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
  assert.equal(D.mmss(59.6), '1:00'); assert.equal(D.mmss(null), '—');
});
