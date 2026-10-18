'use strict';
// WP26 (redesign wave 3): the manual body — tab headings, readable prose, the Overview key figures, calmer callouts,
// the step rendering fix, "On this page", tables without inline styles. Static checks plus jsdom behaviour (skipped
// unless VTOL_JSDOM points to a jsdom package, like the other page tests).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { loadJsdom } = require('../pwa/computed-style.js');
const { HTML, loadManualCore } = require('./helpers.js');

const MC = loadManualCore();
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
const BODY = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<script src="js/version.js">'));   // static markup, no scripts
const panel = id => { const m = HTML.match(new RegExp('<div id="tab-' + id + '" class="tab-panel">([\\s\\S]*?)\\n</div>\\n')); return m ? m[1] : ''; };

test('R1: every tab opens with one tab title (h2) and a lede; section headings are h3, sub-headings h4', () => {
  for (const id of MC.TAB_IDS) {
    const p = panel(id);
    assert.match(p, /^\s*<div class="man-head"><h2 class="man-title">[^<]+<\/h2>\s*<p class="man-lede">[^<]{20,}<\/p><\/div>/, id + ': heading first');
    assert.equal((p.match(/<h2\b/g) || []).length, 1, id + ': one tab title');
    assert.doesNotMatch(p, /<div class="section-title"/, id + ': section titles are headings');
  }
  assert.equal((BODY.match(/<h3 class="section-title"/g) || []).length, (BODY.match(/class="section-title"/g) || []).length);
  assert.match(STYLE, /\.man-main p\{max-width:70ch;\}/, 'prose measure about 70ch');
});

test('R2: Overview — key figures as two definition lists, safety values in their chips, how-to line, small photos', () => {
  const ov = panel('overview');
  assert.doesNotMatch(HTML, /stat-box|stat-val|class="two-col/, 'the stat cards are gone');
  const dl = [...ov.matchAll(/<dl class="kv">([\s\S]*?)<\/dl>/g)].map(m => m[1]);
  assert.equal(dl.length, 2);
  assert.equal(dl.join('').match(/<dt>/g).length, 10, 'the same ten figures');
  assert.match(ov, /<dd><span class="warn-val" data-fs="battLowVolt"><span data-tok="settings\.battLowVolt">22\.0<\/span>V auto RTL<\/span><\/dd>/);
  assert.match(ov, /<dd><span class="crit-val"><span data-fs="battCrtVolt"><span data-tok="settings\.battCrtVolt">21\.0<\/span>V QLand here<\/span><\/span><\/dd>/);
  assert.match(ov, /<dd><span data-fs="battArmVolt"><span data-tok="settings\.battArmVolt">24\.6<\/span>V<\/span><\/dd>/);
  assert.match(ov, /<p class="man-howto">[\s\S]*href="#emergency"[\s\S]*href="index\.html"[\s\S]*<\/p>/, 'points to Emergency and Tools');
  assert.match(ov, /<div class="man-photo-row">/);
  assert.match(STYLE, /\.man-photo-row \.man-photo img\{height:200px;/, 'modest image size');
});

test('R3: callouts use the base component only, never stacked; long ones have a lead and a disclosure', () => {
  assert.doesNotMatch(HTML, /safety-box/);
  for (const m of BODY.matchAll(/class="alert ([\w-]+)"/g)) assert.match(m[1], /^alert-(info|warn|danger)$/);
  // no callout directly followed by another callout (stacked callouts were merged or turned into prose)
  assert.doesNotMatch(BODY, /class="alert alert-\w+"[^>]*>(?:(?!<div)[\s\S])*?<\/div>\s*<div class="alert /, 'stacked callouts');
  assert.ok((BODY.match(/<details class="man-more">/g) || []).length >= 3, 'lead + disclosure');
  assert.ok((panel('overview').match(/class="alert /g) || []).length <= 1, 'Overview: one callout');
  assert.doesNotMatch(BODY, /class="card accent"/, 'orange marks interaction only');
});

test('R4: step texts flow inline — only the step title is a block', () => {
  const base = readText('css/base.css');
  assert.match(base, /\.step-body>strong\{display:block;/);
  assert.doesNotMatch(base + STYLE, /\.step-body strong\{[^}]*display:block/);
  assert.doesNotMatch(STYLE, /\.step|\.proc-step/, 'no page rule overrides the step component');
  // the two steps of the WP26 brief keep their inline bold phrases inside the paragraph
  assert.match(panel('procedures'), /<p>Static IP verified [^<]*<code>192\.168\.144\.X<\/code>[\s\S]*?<strong>arm switch DISARMED; throttle low<\/strong>\. The app enforces this for a normal start\.<\/p>/);
  assert.match(panel('procedures'), /normally <strong>OFF<\/strong> before the client launches/);
});

test('R7: tables in a scroll wrapper, no inline styles in the static markup', () => {
  assert.doesNotMatch(BODY, /\sstyle="/, 'no static inline style');
  const tables = (BODY.match(/<table\b/g) || []).length, wrapped = (BODY.match(/<div class="tbl-wrap"><table\b/g) || []).length;
  assert.equal(wrapped, tables, 'every table scrolls on a phone');
  assert.doesNotMatch(BODY, /<td class="(warn|crit)-val"/, 'value chips inside the cell, so the cell keeps its padding');
});

test('R5: "On this page" has no hard-coded list in the source', () => {
  assert.match(BODY, /<details class="man-toc" id="man-toc" hidden><summary>On this page<\/summary><ol id="man-toc-list"><\/ol><\/details>/);
  assert.match(BODY, /<aside class="man-aside" id="man-aside" aria-label="On this page"><\/aside>/);
  assert.match(STYLE, /@media\(min-width:1200px\)\{[^}]*\.content\.man-content\{/, 'side column from 1200 px');
});

// ── behaviour (jsdom) ──
const BASE = 'https://melonno.github.io/vtol-manual/';
function pageHtml() {
  return HTML.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + readText(src).replace(/<\/script/gi, '<\\/script') + '</script>');
}
function open(JSDOM, opts) {
  const errors = [];
  const dom = new JSDOM(pageHtml(), { url: BASE + 'manual.html' + ((opts && opts.hash) || ''), runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {}; w.Element.prototype.scrollIntoView = function () { w.__scrolled = this; };
      w.matchMedia = () => ({ matches: !!(opts && opts.wide), addListener() {}, addEventListener() {} });
      w.addEventListener('error', e => errors.push(String(e.message)));
    } });
  return { w: dom.window, d: dom.window.document, errors };
}
const tick = () => new Promise(r => setTimeout(r, 20));
const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

test('R5 (jsdom): the list is built from the open tab\'s headings, opens the anchor through showTab, and follows the tab', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, { hash: '#flightmodes' });
  t.after(() => w.close());
  await tick();
  const toc = d.getElementById('man-toc'), links = () => [...d.querySelectorAll('#man-toc-list a')];
  const heads = [...d.querySelectorAll('#tab-flightmodes .section-title')];
  assert.deepEqual(links().map(a => a.textContent), heads.map(h => h.textContent.trim()), 'one entry per section heading');
  assert.ok(links().every(a => a.getAttribute('href') === '#flightmodes/' + a.dataset.anchor && d.getElementById(a.dataset.anchor)));
  // narrow screen: a closed disclosure right under the tab title
  assert.equal(toc.parentNode.id, 'tab-flightmodes');
  assert.ok(toc.previousElementSibling.classList.contains('man-head'));
  assert.equal(toc.open, false); assert.equal(toc.hidden, false);
  toc.open = true;
  links().find(a => a.dataset.anchor === 'failsafe').click();
  assert.equal(w.location.hash, '#flightmodes/failsafe', 'hash route through showTab');
  assert.equal(w.__scrolled.id, 'failsafe', 'scrolled to the heading');
  assert.equal(toc.open, false, 'closes after a choice on a phone');
  // another tab: the list follows, rendered headings (Callouts) get ids
  w.showTab('callouts');
  assert.equal(toc.parentNode.id, 'tab-callouts');
  const co = [...d.querySelectorAll('#tab-callouts .section-title')];
  assert.ok(co.length >= 5 && co.every(h => h.id), 'rendered headings have ids');
  assert.deepEqual(links().map(a => a.textContent), co.map(h => h.textContent.trim()));
  // the Emergency tab has no section headings: no list
  w.showTab('emergency');
  assert.equal(toc.hidden, true);
  // a deep link still opens its tab and anchor
  w.location.hash = '#relay/relay-ports';
  await tick();
  assert.ok(d.getElementById('tab-relay').classList.contains('active'));
  assert.equal(w.__scrolled.id, 'relay-ports');
  assert.deepEqual(errors, []);
});

test('R5 (jsdom): wide screen — the list sits open in the side column', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, { hash: '#aircraft', wide: true });
  t.after(() => w.close());
  await tick();
  const toc = d.getElementById('man-toc');
  assert.equal(toc.parentNode.id, 'man-aside');
  assert.equal(toc.open, true);
  assert.ok(d.querySelector('#man-toc-list a[data-anchor="ac-battery"]'));
  assert.ok(d.querySelectorAll('#man-toc-list a.active').length <= 1);
  assert.deepEqual(errors, []);
});

test('R9 (jsdom): search ignores the list, still opens and marks a hit; Overview failsafe phrases still turn DISABLED', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to run this check'); return; }
  const { w, d, errors } = open(JSDOM, { hash: '#flightmodes' });
  t.after(() => w.close());
  await tick();
  w.manSearch('Mission Planner Is the Heartbeat');
  const hits = w.searchHits;
  assert.equal(hits.length, 1, 'the heading only, not its copy in the list');
  assert.equal(w.manGoTo(0), 'flightmodes');
  assert.ok(d.querySelector('#gcs-heartbeat mark.search-hit'));
  w.VtolStore.update(s => { s.paramFile = { name: 'sample.param', importedAt: '2026-10-17T10:00:00.000Z', params: { BATT_LOW_VOLT: 0 } }; });
  await tick();
  const low = d.querySelector('#tab-overview [data-fs="battLowVolt"]');
  assert.equal(txt(low), 'LOW-BATT FAILSAFE: DISABLED (sample.param; reference 22.0V auto RTL)');
  assert.ok(low.classList.contains('crit-val'), 'red over its amber chip');
  w.VtolStore.update(s => { delete s.paramFile; });
  await tick();
  assert.equal(txt(low), '22.0V auto RTL');
  assert.ok(low.classList.contains('warn-val') && !low.classList.contains('crit-val'), 'back to the amber chip');
  assert.deepEqual(errors, []);
});
