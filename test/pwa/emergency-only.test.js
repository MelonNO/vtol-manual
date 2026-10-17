'use strict';
// WP09 R9: emergency-only mode (index.html#emergency-only) — js/emergency-only.js builders and the page hook.
// The no-scroll fit at 360×640 is checked in a real browser (report §6); fitText's search is unit-tested here.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const EO = require('../../js/emergency-only.js');
const C = require('../../data/content.js');
const R = require('../../js/render-content.js');
const S = require('../../js/store.js');

const ctx = R.ctxFrom(S.defaults());
const fmt = t => R.fmt(t, ctx);

test('R9: routes — #emergency-only (list), #emergency-only/<id> (one scenario), anything else off', () => {
  assert.deepEqual(EO.parseHash('#emergency-only'), { id: null });
  assert.deepEqual(EO.parseHash('#emergency-only/emerg-gcs'), { id: 'emerg-gcs' });
  assert.equal(EO.parseHash(''), null);
  assert.equal(EO.parseHash('#emergency'), null);
  assert.equal(EO.parseHash('#emergency-onlyx'), null);
});

test('R9: one large button per scenario (every emergency card + the 915 note), primary first in red, notes amber; escaped', () => {
  const list = EO.scenarios(C);
  assert.equal(list.length, C.emergencies.length + C.emergencyNotes.length);
  const html = EO.listHTML(C);
  assert.equal((html.match(/<button /g) || []).length, list.length);
  for (const e of C.emergencies) assert.ok(html.includes('data-eo="' + e.id + '">' + R.escH(e.pill) + '</button>'), e.id);
  assert.match(html, /^<button type="button" class="primary" data-eo="emerg-gcs">SIYI \/ GCS LOSS<\/button>/);
  assert.match(html, /class="note" data-eo="note-915-lost"/);
  assert.doesNotMatch(EO.listHTML({ emergencies: [{ id: 'x"><img', pill: '<img src=x>', immediate: [] }] }), /<img/);
});

test('R9: a scenario screen shows the IMMEDIATE actions only (no clean-up text), tokens resolved, TBD markers rendered', () => {
  for (const s of EO.scenarios(C).filter(x => x.kind === 'card')) {
    const h = EO.cardHTML(s, fmt);
    assert.equal((h.match(/class="eo-step"/g) || []).length, s.item.immediate.length, s.item.id);
    for (const c of s.item.cleanup) assert.ok(!h.includes(fmt(c)), s.item.id + ': no clean-up step');
    assert.doesNotMatch(h, /\[\[|\{(?:client|settings)\./, s.item.id + ': no raw markup');
  }
  const batt = EO.cardHTML(EO.scenarios(C).find(s => s.item.id === 'emerg-batt'), fmt);
  assert.match(batt, /23\.0V → <span class="mbadge m-rtl">RTL<\/span> NOW/);
  assert.match(batt, /22\.0V → AUTO <span class="mbadge m-rtl">RTL<\/span> \(FAILSAFE\)/);   // WP14 Rev C ladder
  assert.match(batt, /21\.0V → AUTO <span class="mbadge m-rtl">QLAND<\/span> HERE — not home/);
  assert.doesNotMatch(batt, /22\.2V/);
  const note = EO.cardHTML(EO.scenarios(C).find(s => s.kind === 'note'), fmt);
  assert.match(note, /expected, no action/);
  assert.match(note, /TAKE OVER IN MP/);
});

test('R9: fitText picks the largest font size that fits without scrolling (binary search), falls back to scrolling', () => {
  // fake element: content height grows linearly with the font size
  const el = (perPx, box) => ({ style: {}, clientHeight: box, clientWidth: 300, scrollWidth: 300, get scrollHeight() { return parseFloat(this.style.fontSize) * perPx; } });
  const a = el(10, 400);
  const px = EO.fitText(a, 44, 13);
  assert.ok(px <= 40 && px > 39, px);
  assert.equal(a.style.overflowY, '');
  const b = el(100, 400);
  assert.equal(EO.fitText(b, 44, 13), 13);
  assert.equal(b.style.overflowY, 'auto', 'too long even at the minimum → scroll instead of cutting text');
});

test('R9: the Tools page mounts the mode, hides everything else and links to it from the emergency modal and the footer', () => {
  const html = readText('index.html'), css = readText('css/base.css');
  assert.match(html, /<div id="eo-view" class="eo-view" role="dialog" aria-modal="true" aria-labelledby="eo-title">/);
  assert.match(html, /VtolEmergOnly\.mount\(\{\s*el: document\.getElementById\('eo-view'\), content: VtolContent,\s*fmt: t => VtolRender\.fmt\(t, contentCtx\)/);
  assert.ok((html.match(/href="#emergency-only"/g) || []).length >= 2);
  assert.match(css, /:root\.vf-eo body>\*:not\(\.eo-view\):not\(\.vf-toast\)\{display:none !important;\}/);
  assert.match(css, /\.eo-list\{flex:1;display:grid;grid-auto-rows:1fr;/);
  assert.match(css, /\.eo-list button\{min-height:44px;/);
});
