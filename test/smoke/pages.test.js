'use strict';
// WP10 R1 — jsdom smoke tests of every page: it loads without a script error, the key tabs open, and the checklists
// and emergency cards render from data/content.js. jsdom is not a repository dependency: CI installs it and sets
// VTOL_JSDOM (see .github/workflows/ci.yml). Without it these tests are skipped, like the other jsdom checks.
//   VTOL_JSDOM=<path to the jsdom package> node --test test/
// Each page runs with its real local scripts inlined (jsdom fetches no files here). Network access is stubbed to
// fail at once (the GCS app, Open-Meteo and the map tiles are absent), which is the field case without internet.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../repo-files.js');

// The jsdom package from $VTOL_JSDOM (its path), a normal require, or null (same lookup as test/pwa/computed-style.js).
function loadJsdom() {
  for (const t of [process.env.VTOL_JSDOM, 'jsdom'].filter(Boolean)) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}

const BASE = 'https://melonno.github.io/vtol-manual/';
const content = require('../../data/content.js');

// The page with every local <script src> inlined, resolved against the page's own folder.
function pageHtml(page) {
  const dir = path.posix.dirname(page);
  return readText(page).replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    /^(https?:)?\/\//.test(src) ? m : '<script>' + readText(path.posix.join(dir, src)).replace(/<\/script/gi, '<\\/script') + '</script>');
}

function open(page, hash) {
  const { JSDOM, VirtualConsole } = loadJsdom();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(String(e && e.message))) errors.push(String(e && (e.stack || e.message))); });
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
  const dom = new JSDOM(pageHtml(page), {
    url: BASE + page + (hash || ''), runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {}; w.print = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('network unavailable (smoke test)'));
      w.addEventListener('error', e => errors.push('window error: ' + String(e.message)));
      // (an unhandled promise rejection in page code reaches Node itself and fails the test run)
    }
  });
  return { w: dom.window, d: dom.window.document, errors, close: () => dom.window.close() };
}
const settle = ms => new Promise(r => setTimeout(r, ms || 50));
const ids = list => list.flatMap(cl => cl.sections.flatMap(s => s.items.map(i => i.id)));

function skipWithoutJsdom(t) {
  if (loadJsdom()) return false;
  t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path to run the smoke tests');
  return true;
}

test('smoke: index.html (Flight Tools) — loads, every tab opens, checklists and emergency cards render', async t => {
  if (skipWithoutJsdom(t)) return;
  const { w, d, errors, close } = open('index.html');
  try {
    await settle();
    const tabs = [...d.querySelectorAll('nav button[onclick^="switchTab("]')];
    assert.ok(tabs.length >= 10, 'nav tabs found: ' + tabs.length);
    for (const b of tabs) {
      const name = /switchTab\('([^']+)'/.exec(b.getAttribute('onclick'))[1];
      b.click();
      assert.ok(d.getElementById('tab-' + name).classList.contains('active'), 'tab opens: ' + name);
      assert.equal(d.querySelectorAll('.tab-panel.active').length, 1, 'one active panel after ' + name);
    }
    // checklists: every pre-flight and turnaround item of data/content.js is rendered once, by its stable id
    const rows = sel => [...d.querySelectorAll(sel + ' .ci[data-id]')].map(r => r.dataset.id);
    assert.deepEqual(rows('#cl-container'), ids([content.checklists.preflight]));
    assert.deepEqual(rows('#cl-container2'), ids([content.checklists.turnaround]));
    assert.ok(d.getElementById('postflight-body').textContent.trim().length > 100, 'post-flight rendered');
    // tick one item: progress moves
    const first = d.querySelector('#cl-container .ci .ci-left');
    first.click();
    assert.ok(first.closest('.ci').classList.contains('done'), 'an item can be ticked');
    assert.match(d.getElementById('pl').textContent, /^1 \/ \d+ ITEMS COMPLETE$/);
    // the emergency modal opens with every card
    d.getElementById('emerg-fab').click();
    assert.equal(d.getElementById('emerg-modal').style.display, 'block');
    for (const c of content.emergencies) assert.ok(d.getElementById(c.id), 'emergency card ' + c.id);
    w.closeEmerg();
    await settle();
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('smoke: index.html#emergency-only — the large-button emergency mode renders every scenario', async t => {
  if (skipWithoutJsdom(t)) return;
  const { d, errors, close } = open('index.html', '#emergency-only');
  try {
    await settle();
    assert.ok(d.documentElement.classList.contains('vf-eo'), 'emergency-only mode active');
    const text = d.body.textContent;
    for (const c of content.emergencies) assert.ok(text.includes(c.title), 'scenario ' + c.title);
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('smoke: manual.html — loads, every navigation tab opens, emergency cards and parameter reference render', async t => {
  if (skipWithoutJsdom(t)) return;
  const { w, d, errors, close } = open('manual.html');
  try {
    await settle();
    const buttons = [...d.querySelectorAll('#nav [data-tab]')];
    const panels = [...d.querySelectorAll('.tab-panel')].map(p => p.id.replace(/^tab-/, ''));
    assert.ok(buttons.length >= 14, 'navigation items: ' + buttons.length);
    for (const b of buttons) {                                       // the real navigation (dropdown items, direct tabs)
      const name = b.dataset.tab;
      assert.ok(panels.includes(name), 'nav item has a panel: ' + name);
      b.click();
      assert.ok(d.getElementById('tab-' + name).classList.contains('active'), 'tab opens: ' + name);
      assert.equal(d.querySelectorAll('.tab-panel.active').length, 1, 'one active panel after ' + name);
    }
    for (const name of panels) {                                     // every panel is reachable and has content
      w.showTab(name);
      assert.ok(d.getElementById('tab-' + name).classList.contains('active'), 'tab opens: ' + name);
      assert.ok(d.getElementById('tab-' + name).textContent.trim().length > 50, 'tab has content: ' + name);
    }
    for (const c of content.emergencies) assert.ok(d.querySelector('#emerg-list #' + c.id), 'emergency card ' + c.id);
    assert.ok(d.querySelector('#fm-failsafe table'), 'failsafe table rendered');
    w.showTab('params');
    assert.match(d.getElementById('tab-params').textContent, /1663/, 'parameter reference: 1663 parameters');
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('smoke: relay/map.html — loads with the vendored Leaflet, offline (no tiles), no script error', async t => {
  if (skipWithoutJsdom(t)) return;
  const { w, d, errors, close } = open('relay/map.html');
  try {
    await settle(100);
    assert.equal(typeof w.L, 'object', 'Leaflet loaded');
    assert.ok(d.querySelector('.leaflet-container'), 'map created');
    assert.match(d.body.textContent, /RELAY COVERAGE/);
    assert.match(d.body.textContent, /GCS APP/);
    assert.deepEqual(errors, []);
  } finally { close(); }
});

test('smoke: tools/latency-clock.html — loads and runs its clock', async t => {
  if (skipWithoutJsdom(t)) return;
  const { d, errors, close } = open('tools/latency-clock.html');
  try {
    await settle(100);
    assert.ok(d.body.textContent.trim().length > 0);
    assert.deepEqual(errors, []);
  } finally { close(); }
});
