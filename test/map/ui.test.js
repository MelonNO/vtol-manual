'use strict';
// Redesign WP27: the coverage map's control panel (collapsible groups, open state in vtol_map_state, a bottom sheet on a
// phone), its overlays and the latency clock body. Static checks always run; the jsdom checks need VTOL_JSDOM (as the
// smoke tests): VTOL_JSDOM=<path to the jsdom package> node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../repo-files.js');

const MAP = readText('relay/map.html'), CLOCK = readText('tools/latency-clock.html');
const markup = html => html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
const body = html => markup(html).slice(markup(html).indexOf('<body'));

test('R1: no static inline style attribute on the map or the clock (html-validate no-inline-style)', () => {
  for (const [f, html] of [['relay/map.html', MAP], ['tools/latency-clock.html', CLOCK]]) {
    assert.deepEqual(markup(html).match(/\sstyle="[^"]*"/g) || [], [], f);
  }
});

test('R1: the side panel is one set of collapsible groups with one heading style; one group open by default', () => {
  const sb = body(MAP).slice(body(MAP).indexOf('<div id="sb"'), body(MAP).indexOf('<!-- #sb -->'));
  const groups = [...sb.matchAll(/<details class="pnl" data-pnl="(\w+)"( open)?>\s*<summary>([^<]+)<\/summary>/g)];
  assert.deepEqual(groups.map(g => g[1]), ['place', 'sim', 'links', 'terrain', 'gcs', 'live', 'layer', 'legend', 'offline']);
  assert.equal((sb.match(/<details class="pnl"/g) || []).length, groups.length, 'every group has the same markup');
  assert.deepEqual(groups.filter(g => g[2]).map(g => g[1]), ['place'], 'only Manual placement is open by default');
  // at most one primary action per group
  for (const part of sb.split('<details class="pnl"').slice(1)) {
    assert.ok((part.match(/\bbtn-primary\b/g) || []).length <= 1, part.slice(0, 40));
  }
  // the placement hint of the old separate hint panel is now the first line of the placement group
  assert.match(sb, /data-pnl="place" open>\s*<summary>Manual placement<\/summary>\s*<div class="pnl-b">\s*<p class="help">Click the map/);
});

test('R5: every element the map script looks up with $(\'…\') exists in the markup (ids unchanged)', () => {
  const html = markup(MAP);
  const dynamic = new Set(['btn-measure']);   // created by the Leaflet measure control
  const used = new Set([...MAP.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]).filter(id => !dynamic.has(id)));
  // ids built from a prefix: 'sp-' + mode, 'btn-' + mode, 'pk-' + kind, 'amode-' + mode
  for (const id of ['sp-straight', 'sp-orbit', 'sp-mission', 'btn-straight', 'btn-orbit', 'btn-mission', 'pk-video', 'pk-rc', 'pk-gcs',
    'amode-rel', 'amode-agl', 'amode-amsl']) used.add(id);
  const missing = [...used].filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
  assert.match(MAP, /<div class="info-txt" data-vf-version><\/div>/, 'version line (shell test) kept, now at the foot of the panel');
});

test('R2/R3: phone layout — bottom sheet with a handle, overlays moved clear of each other and of the Leaflet controls', () => {
  const css = MAP.match(/<style>([\s\S]*?)<\/style>/)[1];
  const phone = css.slice(css.indexOf('@media(max-width:600px){'));
  assert.match(phone, /#sb-wrap\{position:fixed;top:auto;left:0;right:0;bottom:0;/, 'sheet docked at the bottom');
  assert.match(phone, /#sb-tog::before\{/, 'a visible grab handle');
  assert.match(phone, /\.leaflet-bottom\{bottom:var\(--sheet-h\)\}/, 'attribution above the closed sheet');
  assert.match(phone, /#cursor-bar,[^{]*\{top:56px;bottom:auto;left:64px;/, 'cursor bar at the top, right of the zoom buttons');
  assert.match(phone, /#att\{top:104px;bottom:auto;left:auto;right:var\(--sp-2\)\}/, 'attitude box top right, under the cursor bar');
  assert.match(css, /\.leaflet-touch \.leaflet-bar a,\.leaflet-bar a\{width:44px;height:44px;/, 'zoom buttons are 44 px tap targets');
  // nothing below 12 px in the page rules (font-size in px)
  for (const m of css.matchAll(/font-size:(\d+)px/g)) assert.ok(+m[1] >= 12, m[0]);
  assert.doesNotMatch(css, /infinite/, 'no endless blinking');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /color:var\(--dim\)/, 'M5: --dim is never a text colour');
});

test('R4: latency clock — base components, a numbered procedure, clock size bound to the page width', () => {
  const css = CLOCK.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#clock\{font-family:var\(--mono\);font-size:min\(calc\(\(min\(100vw, 1100px\) - 48px\) \/ 7\.4\),150px\);/);
  assert.match(css, /--clock-bg:#000; --clock-fg:#fff;/, 'white on black');
  const steps = CLOCK.match(/<ol class="steps">([\s\S]*?)<\/ol>/);
  assert.ok(steps, 'numbered list');
  assert.equal((steps[1].match(/<li>/g) || []).length, 4);
  for (const v of ['240 fps', '20 samples', 'mean and worst case', 'VTX → VRX → relay → HM30 → GCS']) assert.ok(steps[1].includes(v), v);
  assert.match(CLOCK, /class="btn btn-primary" onclick="addSample\(\)"/, 'one primary action');
  for (const s of ['.btn.primary', 'label', 'li', 'ol']) assert.doesNotMatch(css, new RegExp('(^|\\n)' + s.replace('.', '\\.') + '\\{'), 'no page-wide rule for ' + s);
});

// ── jsdom: behaviour of the panel, the sheet and the status marker ──
function loadJsdom() {
  for (const t of [process.env.VTOL_JSDOM, 'jsdom'].filter(Boolean)) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}
function pageHtml(page) {
  const dir = path.posix.dirname(page);
  return readText(page).replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    '<script>' + readText(path.posix.join(dir, src)).replace(/<\/script/gi, '<\\/script') + '</script>');
}
function openMap({ phone = false, storage = {} } = {}) {
  const { JSDOM, VirtualConsole } = loadJsdom();
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && (e.stack || e.message))); });
  const dom = new JSDOM(pageHtml('relay/map.html'), {
    url: 'https://melonno.github.io/vtol-manual/relay/map.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
      w.matchMedia = q => ({ matches: phone && /max-width: 600px/.test(q), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('offline (test)'));
    }
  });
  return { w: dom.window, d: dom.window.document, errors, close: () => dom.window.close() };
}
const settle = ms => new Promise(r => setTimeout(r, ms));

test('R1: the open / closed state of each group is kept in vtol_map_state (panels) and restored', async t => {
  if (!loadJsdom()) { t.skip('jsdom not available'); return; }
  let saved;
  {
    const { w, d, errors, close } = openMap();
    try {
      await settle(50);
      d.querySelector('[data-pnl=legend]').open = true;
      d.querySelector('[data-pnl=place]').open = false;
      await settle(450);   // toggle events, then the 300 ms save debounce
      saved = w.localStorage.getItem('vtol_map_state');
      const st = JSON.parse(saved);
      assert.equal(st.panels.legend, true);
      assert.equal(st.panels.place, false);
      assert.deepEqual(errors, []);
    } finally { close(); }
  }
  const { d, close } = openMap({ storage: { vtol_map_state: saved } });
  try {
    await settle(50);
    assert.equal(d.querySelector('[data-pnl=legend]').open, true);
    assert.equal(d.querySelector('[data-pnl=place]').open, false);
    assert.equal(d.querySelector('[data-pnl=sim]').open, false, 'others keep their default');
  } finally { close(); }
});

test('R2: on a phone the controls start as a closed sheet and the attitude box minimised; the handle opens and closes them', async t => {
  if (!loadJsdom()) { t.skip('jsdom not available'); return; }
  for (const phone of [false, true]) {
    const { w, d, errors, close } = openMap({ phone });
    try {
      await settle(50);
      const wrap = d.getElementById('sb-wrap'), tog = d.getElementById('sb-tog');
      assert.equal(wrap.classList.contains('sb-off'), phone, 'closed at start only on a phone');
      assert.equal(tog.getAttribute('aria-expanded'), phone ? 'false' : 'true');
      assert.equal(d.getElementById('att').classList.contains('att-min'), phone);
      tog.click();
      assert.equal(wrap.classList.contains('sb-off'), !phone);
      assert.equal(tog.getAttribute('aria-expanded'), phone ? 'true' : 'false');
      w.toggleAtt();
      assert.equal(d.getElementById('att-tog').getAttribute('aria-expanded'), phone ? 'true' : 'false');
      assert.deepEqual(errors, []);
    } finally { close(); }
  }
});

test('R3/M2: a simulated state marks the closed Status button (⚠) and shows the SIMULATED chip on the map', async t => {
  if (!loadJsdom()) { t.skip('jsdom not available'); return; }
  const { w, d, errors, close } = openMap();
  try {
    await settle(50);
    assert.equal(d.getElementById('sim-chip').hidden, true, 'no chip while nothing is simulated');
    d.getElementById('m-lat').value = '59.91'; d.getElementById('m-lon').value = '10.75';
    w.applyManual();
    w.selectSimMode('straight');
    assert.equal(d.getElementById('sp-straight').hidden, false, 'the chosen mode shows its settings');
    assert.equal(d.getElementById('sp-orbit').hidden, true);
    w.startSim();
    await settle(50);
    assert.match(d.getElementById('sim-banner').className, /\bsim\b/);
    assert.ok(d.getElementById('map-st-btn').classList.contains('has-warn'), '⚠ on the Status button');
    assert.equal(d.getElementById('sim-chip').hidden, false, 'SIMULATED chip shown');
    w.stopSim();
    await settle(50);
    assert.equal(d.getElementById('sim-chip').hidden, true);
    assert.deepEqual(errors, []);
  } finally { close(); }
});

// Rework round 1 (verification F1): an element shown by clearing its hidden attribute must not be kept hidden by a page
// rule. Static guard over every element the script toggles with .hidden, then the real modes in jsdom (computed style).
test('R5/F1: no page rule sets display:none on an element the script shows by clearing hidden', () => {
  const css = MAP.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const ids = new Set([...MAP.matchAll(/\$\('([\w-]+)'\)\.hidden =/g)].map(m => m[1]));
  for (const p of ['sp-straight', 'sp-orbit', 'sp-mission', 'off-terr-prog', 'off-map-prog']) ids.add(p);   // via 'sp-' + m and prog
  assert.ok(ids.has('cursor-measure') && ids.has('veg-draw-hint'));
  const tag = id => (MAP.match(new RegExp('<\\w+[^>]*\\bid="' + id + '"[^>]*>')) || [''])[0];
  for (const id of ids) {
    if (id === 'sim-chip') continue;   // hidden on purpose at ≥ 1280 px, where the header banner shows the state
    const classes = ((tag(id).match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
    for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/display:none/.test(rule[2]) || /\[hidden\]/.test(rule[1])) continue;
      // the compound that selects the element itself (last one); a state pseudo-class (:empty …) is conditional, not a hide
      const hit = rule[1].split(',').map(x => x.trim().split(/[\s>+~]+/).pop()).some(last => !last.includes(':') &&
        (new RegExp('#' + id + '(?![\\w-])').test(last) || classes.some(c => new RegExp('\\.' + c + '(?![\\w-])').test(last))));
      const sel = rule[1];
      assert.ok(!hit, `#${id} would stay hidden: ${sel.trim()}{${rule[2]}}`);
    }
  }
});

test('R5/F1: the measure hint and the forest-zone drawing hint are visible while their mode is active (jsdom, page CSS)', async t => {
  if (!loadJsdom()) { t.skip('jsdom not available'); return; }
  const { w, d, errors, close } = openMap();
  try {
    await settle(50);
    const shown = id => !d.getElementById(id).hidden && w.getComputedStyle(d.getElementById(id)).display !== 'none';
    assert.equal(shown('cursor-measure'), false);
    d.getElementById('btn-measure').click();
    assert.equal(shown('cursor-measure'), true, 'measure hint in the cursor bar');
    assert.ok(d.getElementById('map').classList.contains('measuring'), 'the measure button is marked on (#map.measuring #btn-measure)');
    d.getElementById('btn-measure').click();
    assert.equal(shown('cursor-measure'), false);
    assert.equal(shown('veg-draw-hint'), false);
    w.startVegDraw();
    assert.equal(shown('veg-draw-hint'), true, 'forest-zone drawing hint');
    w.selectSimMode('orbit');
    assert.equal(shown('sp-orbit'), true);
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('R1: the first load does not save the default group state (only a user toggle is saved)', async t => {
  if (!loadJsdom()) { t.skip('jsdom not available'); return; }
  const { w, close } = openMap();
  try {
    await settle(450);
    const st = JSON.parse(w.localStorage.getItem('vtol_map_state') || '{}');
    assert.equal(st.panels, undefined);
  } finally { close(); }
});
