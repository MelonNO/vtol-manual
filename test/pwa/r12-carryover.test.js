'use strict';
// WP09 R12: carry-overs from the WP07 verification (docs/tasks/reports/WP07-VERIFY-round1.md, MINOR 1–7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, readText } = require('../repo-files.js');
const D = require('../../js/diagrams.js');
const S = require('../../js/store.js');

const st = S.defaults();
const carrier = st.packs.find(p => p.id === S.IDS.carrierPack), client = st.packs.find(p => p.id === S.IDS.refClientPack) || st.packs.find(p => p.role === 'client');
const GAUGES = {
  'carrier, Rev C defaults': D.batteryGauge(carrier, st.settings),
  'carrier, BATT_LOW not set': D.batteryGauge(carrier, Object.assign({}, st.settings, { battLowVolt: null })),
  'carrier, BATT_LOW 23.6': D.batteryGauge(carrier, st.settings, { battLowVolt: 23.6 }),
  'carrier, thresholds TBD': D.batteryGauge(carrier, Object.assign({}, st.settings, { manualRtlVolt: null, hardLimitVolt: null })),
  'client Li-Ion (storage TBD)': D.batteryGauge(Object.assign({}, client, { chem: 'liion' }), st.settings),
  'client LiPo, long label': D.batteryGauge(Object.assign({}, client, { label: 'A very long pack label that would not fit on one line' }), st.settings)
};
const texts = svg => [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"([^>]*)>([^<]*)<\/text>/g)]
  .map(m => ({ x: +m[1], y: +m[2], size: +m[3], anchor: (m[4].match(/text-anchor="(\w+)"/) || [])[1] || 'start', s: m[5].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'") }));

test('R12(a): battery-gauge notes and labels are wrapped — no text runs past the 360-unit viewBox (Li-Ion TBD note too)', () => {
  for (const [name, g] of Object.entries(GAUGES)) {
    const [, W, H] = g.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    for (const t of texts(g)) {
      const w = t.s.length * 0.6 * t.size;   // monospace advance ≤ 0.6 em (Share Tech Mono 0.54)
      const x0 = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x;
      assert.ok(x0 >= 0 && x0 + w <= W, name + ': "' + t.s + '" spans ' + x0.toFixed(0) + '…' + (x0 + w).toFixed(0) + ' of ' + W);
      assert.ok(t.y > 0 && t.y <= H, name + ': "' + t.s + '" inside the height');
    }
  }
  assert.match(GAUGES['carrier, BATT_LOW not set'], /BATT_LOW_VOLT: TBD in the settings/);   // WP14: BATT_LOW_VOLT is now a configured failsafe
  assert.match(GAUGES['client Li-Ion (storage TBD)'], /Storage voltage for Li-Ion: TBD/);
});

test('R12(b): gauge text ≥ 14 units → ≥ 12.2 px when the 360-unit gauge is 315 px wide (360 px phone with a scrollbar)', () => {
  for (const [name, g] of Object.entries(GAUGES)) {
    const sizes = [...g.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1]);
    const min = Math.min(...sizes);
    assert.ok(min >= 14, name + ': ' + min);
    assert.ok(min * 315 / 360 >= 12, name);
  }
});

test('R12(c): the gauge zone names are visible text (a legend), not only <title> tooltips', () => {
  const visible = g => texts(g).map(t => t.s).join(' ');
  const c = visible(GAUGES['carrier, Rev C defaults']);
  for (const z of ['Operate — RTL at 23.0 V', 'RTL now', 'Past the hard limit — RTL must already be active', 'Below BATT_LOW —', 'automatic RTL', 'Below BATT_CRT —', 'automatic QLand here']) assert.ok(c.includes(z), z);
  assert.match(c, /22\.5–23\.0 V RTL now/);
  const o = visible(GAUGES['client Li-Ion (storage TBD)']);
  for (const z of ['Usable range', 'Below the longevity floor']) assert.ok(o.includes(z), z);
});

test('R12(d): build.js --check with a missing slot prints a clean ERROR line (no stack trace) and exits 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp09-diagrams-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'diagrams'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'img', 'diagrams'), { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, 'scripts', 'diagrams'))) fs.copyFileSync(path.join(ROOT, 'scripts', 'diagrams', f), path.join(tmp, 'scripts', 'diagrams', f));
    for (const f of fs.readdirSync(path.join(ROOT, 'img', 'diagrams'))) fs.copyFileSync(path.join(ROOT, 'img', 'diagrams', f), path.join(tmp, 'img', 'diagrams', f));
    const manual = readText('manual.html');
    assert.ok(manual.includes('<div class="diagram-slot" data-diagram="D3">'));
    fs.writeFileSync(path.join(tmp, 'manual.html'), manual.replace('<div class="diagram-slot" data-diagram="D3">', '<div class="diagram-slot-removed" data-diagram="D3">'));
    const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'diagrams', 'build.js'), '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^ERROR expected 16 diagram slots, found 15$/m);   // WP26: one slot per diagram
    assert.doesNotMatch(r.stdout + r.stderr, /\n\s+at /, 'no stack trace');
    // the intact copy passes
    fs.writeFileSync(path.join(tmp, 'manual.html'), manual);
    const ok = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'diagrams', 'build.js'), '--check'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('R12(e): every VERIFY marker inside the manual\'s inline SVGs uses the amber token', () => {
  const html = readText('manual.html');
  let n = 0;
  for (const svg of html.match(/<svg\b[\s\S]*?<\/svg>/g)) {
    for (const t of svg.matchAll(/<text\b([^>]*)>((?:(?!<\/text>)[\s\S])*VERIFY(?:(?!<\/text>)[\s\S])*)<\/text>/g)) {
      n++;
      assert.match(t[1], /fill="var\(--amber\)"/, 'VERIFY text: ' + t[2]);
    }
  }
  assert.ok(n >= 1, n + ' VERIFY markers found');   // WP14: the transition-fail VERIFY is resolved by the reference param file (8 s → QRTL)
  assert.match(readText('scripts/diagrams/inline.js'), /'\(8 s: automatic QRTL home\)', \{ fill: 'var\(--amber\)' \}/);
});

test('R12(g): img/README.md gives the measured phone content width (330 px figure image, ≈ 315 px with a scrollbar)', () => {
  const r = readText('img/README.md');
  assert.match(r, /a figure's image 330 px/);
  assert.match(r, /14 × 330 \/ 400 ≈ 11\.55 px/);
  assert.doesNotMatch(r, /14 × 332/);
});

test('R12(h): sunlight mode reaches the inline SVG diagrams (they use only CSS variables; base.css overrides the tokens and strokes)', () => {
  const html = readText('manual.html');
  for (const svg of html.match(/<svg\b[^>]*class="man-svg[\s\S]*?<\/svg>/g)) assert.doesNotMatch(svg, /(?:fill|stroke)="#/, 'no hex colours in an inline SVG');
  const css = readText('css/base.css');
  assert.match(css, /:root\[data-sun\]\{[^}]*--muted:#ececec;[^}]*--dim:#d0d0d0;/);
  assert.match(css, /:root\[data-sun\] svg :is\(\[stroke-width="0\.5"\],\[stroke-width="0\.8"\],\[stroke-width="1"\],\[stroke-width="1\.2"\],\[stroke-width="1\.5"\]\)\{stroke-width:2\.5;\}/);
  assert.match(css, /:root\[data-sun\] img\[src\*="diagrams\/"\]\{filter:/, 'standalone diagram files get a contrast filter');
});
