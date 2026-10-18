'use strict';
// WP24 — the shared page frame: one app bar on all four pages, the "Aircraft summary" disclosure with its warning
// chips, the grouped Tools navigation (bottom nav on a phone), the manual's dropdown nav with its Menu sheet, the map
// status, the footer and the EMERGENCY button. Static checks always run; the behaviour checks need jsdom (VTOL_JSDOM),
// like the other jsdom tests, and are skipped without it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../repo-files.js');
const { selectors, pageStyles } = require('../design/design-lib.js');
const { loadJsdom } = require('../pwa/computed-style.js');
const F = require('../../js/field.js');

const PAGES = { 'index.html': ['Tools', 'Flight Tools', 'index.html'], 'manual.html': ['Manual', 'Operations Manual', 'manual.html'],
  'relay/map.html': ['Map', 'Coverage Map', 'map.html'], 'tools/latency-clock.html': ['Clock', 'Latency Clock', null] };
const CSS = readText('css/base.css');
const SHELL = CSS.slice(CSS.indexOf('/* ── 8. SHELL'));
const rule = sel => { const m = SHELL.match(new RegExp('\\n' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };

// ── static ──
test('R1: every page has one app bar: badge, short title, page switcher (current page marked), ☀ toggle; no doc-id or subtitle line', () => {
  for (const [f, [badge, title, self]] of Object.entries(PAGES)) {
    const html = readText(f), hdr = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    assert.ok(hdr.length > 0, f + ' header');
    assert.match(hdr, new RegExp('<div class="app-bar">\\s*<div class="app-id"><span class="app-badge">' + badge + '</span><h1 class="app-title"[^>]*>' + title + '</h1></div>'), f + ' badge + title');
    const sw = hdr.match(/<div class="app-switch seg">([\s\S]*?)<\/div>/);
    assert.ok(sw, f + ' switcher');
    assert.deepEqual([...sw[1].matchAll(/>(\w+)<\/a>/g)].map(m => m[1]), ['Tools', 'Manual', 'Map'], f);
    const cur = [...sw[1].matchAll(/<a href="([^"]+)" aria-current="page">/g)].map(m => path.posix.basename(m[1]));
    assert.deepEqual(cur, self ? [self] : [], f + ' current page marked');
    assert.match(hdr, /<button type="button" class="app-sun" data-vf-sun aria-pressed="false" aria-label="Sunlight mode">☀<\/button>/, f + ' ☀');
    assert.doesNotMatch(hdr, /hdr-doc-id|hdr-sub|DOC-RC-001/, f + ' no doc-id / subtitle line in the header');
    assert.equal((html.match(/<header\b/g) || []).length, 1, f + ' one header');
  }
  assert.match(rule('.app-bar'), /height:56px;/, 'one 56 px row');
  assert.match(rule('.map-hdr .app-bar'), /height:48px;/, 'map: 48 px, the height of its old header, so the map does not shrink');
  assert.match(rule('.app-title'), /white-space:nowrap;/);
  // the clock stays reachable where it is linked today (Tools, Telemetry tab)
  assert.match(readText('index.html'), /href="tools\/latency-clock\.html"/);
});

test('R1/R9: document id, revision and date moved to the footer; one footer with the version line on every page but the full-height map', () => {
  const tools = readText('index.html'), man = readText('manual.html');
  assert.match(tools, /<footer class="app-footer">\s*<div id="hdr-doc-id" data-vf-warn-src>HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 \(carrier\) · ELRS TBD \(client\) · SIYI HM30<\/div>\s*<div data-vf-version>/);
  assert.match(man, /<footer id="man-footer" class="app-footer">\s*<div id="hdr-doc-id" data-vf-warn-src>DOC-RC-001 · /);
  assert.match(man, /getElementById\('hdr-doc-id'\)\.textContent = 'DOC-RC-001 · REV ' \+ V\.app \+ ' · ' \+ V\.content \+ ' · '/, 'id, revision and date still rendered');
  assert.match(readText('tools/latency-clock.html'), /<footer class="app-footer">[\s\S]*<div data-vf-version><\/div>\s*<\/footer>/);
  assert.match(readText('relay/map.html'), /<div class="info-txt" data-vf-version><\/div>/, 'map: version line in the sidebar (no footer under the full-height map)');
  assert.ok(tools.indexOf('<details class="vf-share" data-vf-share>') > tools.indexOf('<footer class="app-footer">'), 'share / kneeboard menu in the Tools footer');
});

test('R2: the meta strip is an "Aircraft summary" disclosure under the bar, closed by default; same ids and render hooks', () => {
  for (const f of ['index.html', 'manual.html']) {
    const html = readText(f);
    const m = html.match(/<\/div>\s*<details class="app-summary" data-vf-summary>\s*<summary><span class="app-summary-lbl">Aircraft summary<\/span><span class="app-chips" data-vf-chips><\/span><\/summary>\s*<div class="hdr-meta">([\s\S]*?)<\/div>\s*<\/details>\s*<\/header>/);
    assert.ok(m, f + ' summary directly under the bar, inside the header, without "open"');
  }
  const tools = readText('index.html');
  for (const id of ['hdr-client', 'hdr-low', 'hdr-crit', 'hdr-params']) assert.match(tools, new RegExp('<div class="hdr-meta">[\\s\\S]*id="' + id + '"[\\s\\S]*</details>'), id);
  assert.match(readText('manual.html'), /<div class="hdr-meta">[\s\S]*data-fs="battLowVolt"[\s\S]*data-fs="battCrtVolt"[\s\S]*id="hdr-client"[\s\S]*<\/details>/);
  assert.equal(F.SUMMARY_KEY, 'vtol_summary_open');
  assert.match(readText('CLAUDE.md'), /`vtol_summary_open`/, 'key in the CLAUDE.md key table');
});

test('R2: warning chips — DISABLED red, TBD / not verified amber, nothing for normal values', () => {
  assert.deepEqual(F.summaryChip('PARAMS', 'not verified against a param file'), { level: 'warn', text: 'PARAMS not verified' });
  assert.equal(F.summaryChip('PARAMS', 'verified against param file x.param 2026-10-17 12:00'), null);
  assert.deepEqual(F.summaryChip('LOW VOLT', 'DISABLED in sample.param (BATT_LOW_VOLT = 0)'), { level: 'crit', text: 'LOW VOLT DISABLED' });
  assert.deepEqual(F.summaryChip('LOW VOLT', 'LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)', true), { level: 'crit', text: 'LOW VOLT DISABLED' });
  assert.deepEqual(F.summaryChip('CLIENT', 'TBD — no active client'), { level: 'warn', text: 'CLIENT TBD' });
  assert.deepEqual(F.summaryChip('CRIT VOLT', 'TBD'), { level: 'warn', text: 'CRIT VOLT TBD' });
  assert.deepEqual(F.summaryChip('X', '5.8 GHz', false, true), { level: 'warn', text: 'X TBD' }, 'a .warn-val marker counts');
  for (const ok of ['22.0V auto RTL', '21.0V QLand here', '6S 7000mAh', '120m REL (above home)', 'Reference client #1']) assert.equal(F.summaryChip('K', ok), null, ok);
  assert.equal(F.chipsHTML([{ level: 'crit', text: '<b>' }]), '<span class="app-chip crit"><span aria-hidden="true">✖</span>&lt;b&gt;</span>', 'escaped');
  assert.match(rule('.app-chip.warn'), /color:var\(--amber\)/);
  assert.match(rule('.app-chip.crit'), /color:var\(--red-fg\)/);
});

test('R3: Tools nav — groups, sub-tabs, bottom nav on a phone with five ≥ 44 px group buttons', () => {
  const html = readText('index.html'), nav = html.slice(html.indexOf('<nav id="nav"'), html.indexOf('</nav>'));
  assert.match(nav, /^<nav id="nav" class="tn" aria-label="Tools sections">/);
  assert.equal((nav.match(/class="tn-group"/g) || []).length, 5);
  assert.match(rule('.tn-groups'), /display:flex;/);
  const phone = SHELL.slice(SHELL.lastIndexOf('@media(max-width:600px){'));
  assert.match(phone, /\.tn-groups\{position:fixed;left:0;right:0;bottom:0;/);
  assert.match(phone, /\.tn-group\{flex:1 1 0;min-width:0;min-height:56px;/);
  assert.match(html, /function switchTab\(name, btn\) \{[\s\S]*?localStorage\.setItem\('vtol_active_tab', name\);/);
});

test('R4: manual nav — grouped dropdowns (position:fixed), Emergency always visible and red, outside the Menu sheet', () => {
  const html = readText('manual.html'), nav = html.slice(html.indexOf('<nav id="nav"'), html.indexOf('</nav>'));
  const items = nav.slice(nav.indexOf('<div class="mn-items" id="nav-items">'), nav.indexOf('<button type="button" data-tab="emergency"'));
  assert.ok(items.includes('data-tab="overview"') && !items.includes('data-tab="emergency"'), 'Emergency is not in the menu');
  assert.match(nav, /<button type="button" data-tab="emergency" onclick="showTab\(this\.dataset\.tab\)" class="nav-emerg">⚠ Emergency<\/button>/);
  assert.match(nav, /<button type="button" id="nav-menu-btn" class="mn-menu-btn" aria-expanded="false" aria-controls="nav-items" onclick="toggleNavMenu\(\)">/);
  assert.match(rule('.nav-dropdown'), /position:fixed;/);
  for (const m of SHELL.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {   // no absolute dropdown / sheet inside an overflow container
    if (m[1].split(',').some(x => /\.(nav-dropdown|mn-items)(\.open)?\s*$/.test(x))) assert.doesNotMatch(m[2], /position:absolute/, m[1].trim());
  }
  assert.match(rule('.nav-emerg'), /border:1px solid var\(--red\);[^}]*color:var\(--red-fg\);/);
  assert.match(SHELL, /@media\(max-width:900px\)\{[\s\S]*?\.mn\.mn-open \.mn-items\{display:grid;[^}]*position:fixed;/);
  assert.match(html, /function toggleNavGroup\(btn\) \{\s*if \(document\.getElementById\('nav'\)\.classList\.contains\('mn-open'\)\) return;/);
  assert.match(html, /dropdown\.style\.top = r\.bottom \+ 'px';/, 'dropdowns still placed from getBoundingClientRect()');
  assert.match(html, /document\.getElementById\('nav'\)\.addEventListener\('scroll', closeDropdowns, \{ passive: true \}\);/);
});

test('R6: the EMERGENCY button is fixed and red, no pulse; above the bottom nav on a phone', () => {
  const fab = rule('#emerg-fab');
  assert.match(fab, /position:fixed;/);
  assert.match(fab, /background:var\(--red\);/);
  assert.doesNotMatch(fab, /animation/);
  assert.doesNotMatch(readText('index.html'), /pulseFab/);
  assert.match(SHELL, /#emerg-fab\{right:var\(--sp-3\);bottom:calc\(56px \+ var\(--sp-3\) \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(readText('index.html'), /<button type="button" id="emerg-fab" onclick="openEmerg\(\)">⚠ EMERGENCY<\/button>/);
});

test('R7: header, nav and footer styles live in the css/base.css shell section only; buttons there are type="button"', () => {
  const FRAME = /^(header|nav|footer)\b|^\.(hdr|nav|app|tn|mn|map-st|seg)\b|^#(emerg-fab|nav|man-search|hdr|sim-banner)(?![\w-])|^\.(hs|dot)\b/;
  for (const f of Object.keys(PAGES)) {
    const own = [...selectors(pageStyles(readText(f)))].filter(s => FRAME.test(s));
    assert.deepEqual(own, [], f + ' page <style> has no frame rules');
    const html = readText(f);
    const frame = html.slice(html.indexOf('<header'), html.indexOf('</header>')) + (html.includes('<nav') ? html.slice(html.indexOf('<nav'), html.indexOf('</nav>')) : '')
      + (html.includes('<footer') ? html.slice(html.indexOf('<footer'), html.indexOf('</footer>')) : '');
    for (const b of frame.match(/<button\b[^>]*>/g) || []) assert.match(b, /type="button"/, f + ': ' + b);
  }
  assert.match(CSS, /\n \* 8\. Shell: /, 'section listed in the file header');
  assert.doesNotMatch(SHELL.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'colours only via tokens');
});

// ── behaviour (jsdom) ──
const BASE = 'https://melonno.github.io/vtol-manual/';
function pageHtml(page) {
  const dir = path.posix.dirname(page);
  return readText(page).replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + (/gcs-client\.js$/.test(src)
    ? "self.GcsClient = { BASE: 'http://127.0.0.1:47800', start() {}, stop() {}, isConnected() { return false; } };"
    : readText(path.posix.join(dir, src)).replace(/<\/script/gi, '<\\/script')) + '</script>');
}
function open(JSDOM, page, storage) {
  const errors = [];
  const dom = new JSDOM(pageHtml(page), { url: BASE + page, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {}; w.print = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('offline (test)'));
      w.addEventListener('error', e => errors.push(String(e.message)));
      Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k]));
    } });
  return { w: dom.window, d: dom.window.document, errors };
}
const tick = () => new Promise(r => setTimeout(r, 20));
const chips = d => [...d.querySelectorAll('[data-vf-chips] .app-chip')].map(c => c.className.replace('app-chip ', '') + ': ' + c.textContent.slice(1));

test('R2 (jsdom): Tools — closed by default, the open state is remembered, the chips follow every store change', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, 'index.html');
  t.after(() => w.close());
  await tick();
  const sum = d.querySelector('[data-vf-summary]');
  assert.equal(sum.open, false, 'closed by default');
  assert.deepEqual(chips(d), ['warn: PARAMS not verified'], 'visible while closed');
  w.VtolStore.update(s => { s.paramFile = { name: 'sample.param', importedAt: '2026-10-17T10:00:00.000Z', params: { BATT_LOW_VOLT: 0, BATT_CRT_VOLT: 22.2 } }; });
  await tick();
  assert.match(d.getElementById('hdr-low').textContent, /^DISABLED in sample\.param/, 'same render function');
  assert.deepEqual(chips(d), ['crit: LOW VOLT DISABLED']);
  w.VtolStore.update(s => { delete s.paramFile; });
  await tick();
  assert.deepEqual(chips(d), ['warn: PARAMS not verified']);
  sum.open = true; await tick();
  assert.equal(w.localStorage.getItem('vtol_summary_open'), '1');
  sum.open = false; await tick();
  assert.equal(w.localStorage.getItem('vtol_summary_open'), null);
  assert.deepEqual(errors, []);
  w.close();
  const again = open(JSDOM, 'index.html', { vtol_summary_open: '1' });
  t.after(() => again.w.close());
  await tick();
  assert.equal(again.d.querySelector('[data-vf-summary]').open, true, 'restored per device');
  again.w.close();
});

test('R2 (jsdom): manual — a disabled failsafe and a TBD client show as chips while the summary is closed', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, 'manual.html');
  t.after(() => w.close());
  await tick();
  assert.deepEqual(chips(d), []);
  w.VtolStore.update(s => { s.paramFile = { name: 'sample.param', importedAt: '2026-10-17T10:00:00.000Z', params: { BATT_CRT_VOLT: 0 } }; });
  await tick();
  assert.deepEqual(chips(d), ['crit: CRIT VOLT DISABLED']);
  d.getElementById('hdr-client').textContent = 'TBD — no active client';
  await tick();
  assert.deepEqual(chips(d), ['crit: CRIT VOLT DISABLED', 'warn: CLIENT TBD']);
  assert.deepEqual(errors, []);
  w.close();
});

test('R3 (jsdom): Tools — group buttons, sub-tab rows, last tab per group, saved tab restored with its group', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, 'index.html', { vtol_active_tab: 'tlog' });
  t.after(() => w.close());
  await tick();
  const nav = d.getElementById('nav'), act = () => d.querySelector('.tab-panel.active').id;
  const grp = () => d.querySelector('#nav .tn-group.active').dataset.group;
  assert.equal(act(), 'tab-tlog');
  assert.equal(grp(), 'logs');
  assert.ok(nav.classList.contains('tn-has-sub'));
  assert.equal(d.querySelector('#nav .tn-sub.active').dataset.group, 'logs');
  d.querySelector('.tn-group[data-group="weather"]').click();
  assert.equal(act(), 'tab-weather');
  assert.ok(!nav.classList.contains('tn-has-sub'), 'one-tab group: no sub-tab row');
  d.querySelector('.tn-group[data-group="checklists"]').click();
  assert.equal(act(), 'tab-preflight', 'first tab of the group');
  d.querySelector('.tn-sub[data-group="checklists"] button:nth-child(2)').click();
  assert.equal(act(), 'tab-turnaround');
  assert.equal(w.localStorage.getItem('vtol_active_tab'), 'turnaround');
  d.querySelector('.tn-group[data-group="logs"]').click();
  assert.equal(act(), 'tab-tlog', 'the group remembers its last tab');
  d.querySelector('.tn-group[data-group="checklists"]').click();
  assert.equal(act(), 'tab-turnaround');
  assert.equal(d.querySelectorAll('#nav .active[aria-current="page"]').length, 2, 'tab and group marked');
  assert.deepEqual(Array.from(w.navTabOrder()), ['preflight', 'turnaround', 'postflight', 'link', 'battlog', 'tlog', 'flights', 'weather', 'params', 'profiles']);
  assert.deepEqual(errors, []);
  w.close();
});

test('R4 (jsdom): manual — Menu sheet opens and closes, lists every tab but Emergency, a choice opens the tab; dropdowns stay fixed', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, 'manual.html');
  t.after(() => w.close());
  await tick();
  const nav = d.getElementById('nav'), btn = d.getElementById('nav-menu-btn'), items = d.getElementById('nav-items');
  btn.click();
  assert.ok(nav.classList.contains('mn-open'));
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  const tabs = [...items.querySelectorAll('[data-tab]')].map(b => b.dataset.tab);
  assert.deepEqual([...tabs, 'emergency'].sort(), [...w.ManualCore.TAB_IDS].sort());
  const g = items.querySelector('.nav-group-btn');
  g.click();
  assert.equal(d.querySelectorAll('.nav-dropdown.open').length, 0, 'no dropdown inside the sheet');
  items.querySelector('[data-tab="relay"]').click();
  assert.ok(d.getElementById('tab-relay').classList.contains('active'));
  assert.ok(!nav.classList.contains('mn-open'), 'choosing closes the sheet');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  btn.click(); d.body.click();
  assert.ok(!nav.classList.contains('mn-open'), 'a click outside closes it');
  btn.click();
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(!nav.classList.contains('mn-open'), 'Escape closes it');
  // desktop dropdown: still position:fixed from getBoundingClientRect(), closed by a choice
  g.click();
  const dd = g.nextElementSibling;
  assert.ok(dd.classList.contains('open'));
  assert.match(dd.style.top, /px$/);
  dd.querySelector('[data-tab="flightmodes"]').click();
  assert.ok(!dd.classList.contains('open'));
  assert.equal(w.location.hash, '#flightmodes');
  assert.ok(g.classList.contains('active'));
  assert.deepEqual(errors, []);
  w.close();
});
