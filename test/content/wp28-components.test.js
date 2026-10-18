'use strict';
// WP28 (redesign wave 4): rendered components, the wave-3 requests folded into css/base.css, and the carried minors
// (shell, print, styleguide, the Tools More menu). The jsdom parts are skipped without VTOL_JSDOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, readText } = require('../repo-files.js');
const { loadJsdom } = require('../pwa/computed-style.js');
const R = require('../../js/render-content.js');
const C = require('../../data/content.js');
const VtolStore = require('../../js/store.js');

const CSS = readText('css/base.css');
const COMP = CSS.slice(CSS.indexOf('/* ── 4. COMPONENTS'), CSS.indexOf('/* ── end of components ── */'));
const SHELL = CSS.slice(CSS.indexOf('/* ── 8. SHELL'));
const pageStyle = f => { const h = readText(f); return h.slice(h.indexOf('<style>'), h.indexOf('</style>')); };
const ctx = () => R.ctxFrom(VtolStore.defaults());

test('R4: renderer output has no inline styles; tables in .tbl-wrap with thead / tbody', () => {
  const c = ctx();
  const html = [R.checklist(C.checklists.preflight, { items: {} }, c, { colors: { A: '#60a5fa' }, prefix: 'csp-' }),
    R.checklist(C.checklists.turnaround, { items: {} }, c), R.postflight(C.postflight, c),
    R.emergencies(C.emergencies, C.emergencyNotes, c), R.emergencyPills(C.emergencies, C.emergencyNotes),
    R.failsafeTable(C.failsafeTable, c), R.networkTable(C.network, c), R.callouts(C.callouts, c),
    R.clientFailsafeChain(C.clientFailsafeChain, c), R.designIntent(C.designIntent, c), R.linkStatus({}, c)].join('');
  // the only style attribute left is the section colour as a custom property
  assert.deepEqual((html.match(/\sstyle="[^"]*"/g) || []).filter(s => !/^ style="--sec:#[0-9a-f]{3,8}"$/i.test(s)), []);
  for (const t of [R.failsafeTable(C.failsafeTable, c), R.networkTable(C.network, c), R.callouts(C.callouts, c)]) {
    assert.equal((t.match(/<table/g) || []).length, (t.match(/<div class="tbl-wrap"><table/g) || []).length, 'every table wrapped');
    assert.equal((t.match(/<table/g) || []).length, (t.match(/<thead><tr>/g) || []).length, 'every table has a thead');
  }
  assert.match(R.callouts(C.callouts, c), /<th class="co-trig">Trigger<\/th><th class="co-who">Who calls<\/th>/);
  assert.match(R.callouts(C.callouts, c), /<div class="section-title" id="co-abort-calls">Abort Calls<\/div>/, 'the abort heading has a stable anchor');
  assert.match(COMP, /\.co-table \.co-trig\{width:30%;\}/);
});

test('R4 / WP25: the checklist section colour is the --sec custom property (letter badge only), never an inline colour', () => {
  const h = R.checklistSection(C.checklists.preflight.sections[0], 'preflight', { items: {} }, ctx(), { colors: { A: '#60a5fa' }, prefix: 'csp-' });
  assert.match(h, /^<div class="cl-section" id="cls-A" style="--sec:#60a5fa"><div class="cl-section-hdr"><span class="cl-section-letter">A<\/span><span class="cl-section-name">Site<\/span>/);
  const bad = R.checklistSection(C.checklists.preflight.sections[0], 'preflight', { items: {} }, ctx(), { colors: { A: 'red;background:url(x)' } });
  assert.match(bad, /^<div class="cl-section" id="cls-A"><div/, 'only a hex value reaches the style attribute');
  const page = pageStyle('index.html');
  assert.match(page, /\.cl-section-letter\{[^}]*color:var\(--sec,var\(--text\)\);/);
  assert.doesNotMatch(page, /!important/, 'no !important overrides left in the Tools page CSS');
});

test('R4: design intent is a plain card (orange marks interaction only); Link view labels in sentence case', () => {
  assert.match(R.designIntent(C.designIntent, ctx()), /^<div class="card design-intent" id="design-intent">/);
  const lk = R.linkStatus({ bridge: { state: 'RUN' } }, ctx());
  for (const k of ['State', 'Uplink loss', 'Status age', 'Decoder lock', 'Telemetry age', 'Rescue not ready']) assert.ok(lk.includes('<span class="lk-k">' + k + '</span>'), k);
  for (const t of ['BRIDGE', 'CLIENT LINK', 'CLIENT FLIGHT MODE']) assert.ok(lk.includes('>' + t + '<'), 'panel titles stay short labels: ' + t);
  assert.doesNotMatch(lk, /class="lk-k">[A-Z]{2,}[A-Z ]*[A-Z]{3,}</, 'no all-caps row label');
});

test('R1: checklist section names in sentence case, short titles ≤ 5 words', () => {
  for (const list of Object.values(C.checklists)) {
    assert.doesNotMatch(list.goText, /\/\//, 'no decoration in the GO banner');
    for (const sec of list.sections) {
      assert.notEqual(sec.name, sec.name.toUpperCase(), sec.id + ' ' + sec.name);
      for (const it of sec.items) assert.ok(it.s.split(/\s+/).length <= 5, it.id + ': ' + it.s);
    }
  }
});

test('R3: wave-3 requests folded into the base components; the page overrides are gone', () => {
  assert.match(COMP, /\.tbl-wrap\{[^}]*scrollbar-width:thin;scrollbar-color:var\(--dim\) transparent;/);
  assert.match(COMP, /\.alert p\{margin:0 0 var\(--sp-2\);/);
  assert.match(COMP, /\.alert>details>summary\{[^}]*color:var\(--accent\);/);
  assert.match(COMP, /\.section-title\[id\]\{scroll-margin-top:var\(--sp-4\);\}/);
  assert.match(COMP, /td\.warn-val,td\.crit-val\{padding:var\(--sp-2\) var\(--sp-3\);/);
  assert.match(COMP, /\.btn-icon\{min-width:44px;/);
  assert.match(COMP, /\.field \.hint,\.help\{font-size:var\(--fs-xs\);line-height:1\.45;color:var\(--muted\);\}/);
  assert.match(CSS, /:root\[data-sun\] :is\([^)]*\.att-pnl,#sb-wrap,#cursor-bar\)\{border-top-width:2px;/);
  const man = pageStyle('manual.html'), tools = pageStyle('index.html'), map = pageStyle('relay/map.html');
  assert.doesNotMatch(man, /\.man-more|\.man-main \.alert p\{|\.man-main \.section-title\{|:is\(\.tbl-wrap,\.dg-scroll\)/);
  assert.doesNotMatch(tools, /\.btn-icon\{|\.content \.tbl-wrap,|body>#nav/);
  assert.doesNotMatch(map, /\n\.help\{/);
  assert.match(map, /#sb \.btn-row \.btn\{flex:1 1 auto;/, 'WP27: "Use My Location" gets the room its label needs');
});

test('carried shell minors: Menu sheet aligned and scroll-contained, map bar 48 px, sticky sub-tabs, phone EMERGENCY bar, narrow nav row', () => {
  assert.match(SHELL, /\.mn\.mn-open \.mn-items\{[^}]*align-items:start;overscroll-behavior:contain;/);
  assert.match(SHELL, /\.map-hdr\{border-bottom:none;box-shadow:inset 0 -1px 0 var\(--border2\);\}/);
  assert.match(SHELL, /\.tn\.tn-has-sub\{position:sticky;top:0;z-index:700;/);
  assert.match(SHELL, /#emerg-fab\{left:0;right:0;bottom:calc\(56px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(readText('index.html'), /:root\{--content-pb:140px;\}/, 'the phone content still clears the nav (56) + EMERGENCY bar (48)');
  assert.match(SHELL, /@media\(max-width:400px\)\{[^@]*#man-search::placeholder\{font-size:var\(--fs-xs\);\}/);
});

test('carried minors: no dead header selectors in css/print.css or css/base.css; print comment current', () => {
  const pr = readText('css/print.css');
  assert.doesNotMatch(pr + CSS, /\.vf-hdr-tools|\.vf-lbl|\.hdr-(top|main|title|badge|sub)\b/);
  assert.doesNotMatch(pr, /manual --muted/);
});

test('carried WP23 M2 (jsdom): the styleguide script survives unparsable colours and still wires the sunlight toggle', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path'); return; }
  const { JSDOM: J, VirtualConsole } = require(process.env.VTOL_JSDOM);
  const vc = new VirtualConsole(), errors = [];
  vc.on('jsdomError', e => errors.push(String(e && (e.detail || e.message || e))));
  const dom = await J.fromFile(path.join(ROOT, 'docs/design/styleguide.html'), { runScripts: 'dangerously', resources: 'usable', virtualConsole: vc });
  try {
    await new Promise(r => dom.window.addEventListener('load', r));
    const d = dom.window.document;
    d.querySelector('[data-sg-sun]').click();
    assert.equal(d.documentElement.hasAttribute('data-sun'), true, 'sunlight toggle wired');
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('carried WP25 (jsdom): a tap outside the open More menu only closes it; EMERGENCY still acts on the first tap', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path'); return; }
  const HTML = readText('index.html');
  const errors = [];
  const html = HTML.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + (src === 'js/gcs-client.js'
    ? "self.GcsClient = { BASE: 'http://127.0.0.1:47800', start() {}, stop() {}, isConnected() { return false; } };"
    : readText(src).replace(/<\/script/gi, '<\\/script')) + '</script>');
  const dom = new JSDOM(html, { url: 'https://melonno.github.io/vtol-manual/index.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('offline'));
      w.addEventListener('error', e => errors.push(String(e.message)));
    } });
  const w = dom.window, d = w.document;
  try {
    await new Promise(r => setTimeout(r, 30));
    const cb = d.getElementById('cl-more-pf'), row = d.querySelector('#cl-container .ci');
    cb.checked = true; row.querySelector('.ci-left').click();
    assert.equal(cb.checked, false, 'closed');
    assert.ok(!row.classList.contains('done'), 'the row under the tap was not ticked');
    row.querySelector('.ci-left').click();
    assert.ok(row.classList.contains('done'), 'the next tap ticks as usual');
    cb.checked = true; d.querySelector('#tab-preflight .cl-tools button').click();
    assert.equal(cb.checked, false, 'an action in the menu still runs and closes it');
    assert.equal(d.getElementById('expand-btn').getAttribute('aria-expanded'), 'true', 'the menu action ran');
    cb.checked = true; d.getElementById('emerg-fab').click();
    assert.equal(cb.checked, false);
    assert.equal(w.emergIsOpen(), true, 'EMERGENCY opens on the first tap even with the menu open');
    assert.deepEqual(errors, []);
  } finally { w.close(); }
});

test('rework 1 (jsdom): the old runtime anchor #callouts/callouts-sec-6 still opens the Abort Calls heading', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path'); return; }
  const html = readText('manual.html').replace(/<script src="([^"]+)"><\/script>/g, (m, src) => /^(https?:)?\/\//.test(src) ? m
    : '<script>' + readText(path.posix.normalize(src)).replace(/<\/script/gi, '<\\/script') + '</script>');
  const errors = [];
  const dom = new JSDOM(html, { url: 'https://melonno.github.io/vtol-manual/manual.html#callouts/callouts-sec-6', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.alert = () => {}; w.scrollTo = () => {}; w.print = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('offline'));
      w.Element.prototype.scrollIntoView = function () { (w.__scrolled = w.__scrolled || []).push(this.id); };
      w.addEventListener('error', e => errors.push(String(e.message)));
    } });
  const w = dom.window, d = w.document;
  try {
    await new Promise(r => setTimeout(r, 50));
    assert.ok(d.getElementById('tab-callouts').classList.contains('active'), 'Callouts tab open');
    assert.ok(d.getElementById('co-abort-calls'), 'the heading exists with its fixed id');
    assert.equal(w.location.hash, '#callouts/co-abort-calls', 'the alias resolves to the fixed id');
    assert.ok(!d.getElementById('callouts-sec-6'), 'no runtime id is generated for it any more');
    assert.deepEqual(errors, []);
  } finally { w.close(); }
});
