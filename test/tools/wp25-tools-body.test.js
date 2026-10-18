'use strict';
// WP25 (redesign wave 3) — Tools page body: no inline styles in the markup, typed buttons, the checklist toolbar and
// row structure the kneeboard print relies on, and a jsdom run of the real page (tick, detail, battery entry, every
// tab, emergency modal closed at load with IMMEDIATE cards before the design intent). The jsdom part is skipped
// without VTOL_JSDOM, like the other jsdom checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { loadJsdom } = require('../pwa/computed-style.js');

const HTML = readText('index.html');
const markup = HTML.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/, '');
const style = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));

test('R1: no static inline style in index.html markup; every button has a type', () => {
  assert.doesNotMatch(markup, /\sstyle="/, 'inline style in the markup');
  for (const b of markup.match(/<button\b[^>]*>/g) || []) assert.match(b, /\stype="button"/, b);
  // buttons built by the page script carry a type too
  const script = HTML.slice(HTML.indexOf('<script>\nconst { escH'));
  for (const b of script.match(/<button(?![\w-])[^>]*>/g) || []) assert.match(b, /type="button"/, b);
});

test('R1/M5: page rules use tokens, no hex colours, --dim never as a text colour', () => {
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b(?![\w-])(?=[^{}]*;)/i, 'no hex colour in page rules');
  assert.doesNotMatch(style, /(?<![\w-])color:var\(--dim\)/, '--dim is non-text only');
  assert.doesNotMatch(style, /infinite/, 'no infinite animation');
  assert.doesNotMatch(HTML, /'#1f0a0a'|'#1f1a08'|'#0a1f0e'|#ea6b0a/, 'old hard-coded status backgrounds gone');
});

test('R2: checklist toolbar — title is a direct child of .cl-hdr (kneeboard print), START is the primary action, More menu on a phone', () => {
  for (const [tab, more] of [['preflight', 'cl-more-pf'], ['turnaround', 'cl-more-ta']]) {
    const p = markup.slice(markup.indexOf('<div id="tab-' + tab + '"'));
    assert.match(p, /<div class="cl-hdr">\s*<h2 class="cl-hdr-title">/, tab);
    assert.match(p, new RegExp('<input type="checkbox" id="' + more + '" class="cl-more-cb sr-only"'));
    assert.match(p, new RegExp('<label for="' + more + '" class="btn btn-sm cl-more-btn"'));
  }
  assert.match(markup, /class="btn btn-primary btn-sm" id="pf-start-btn" onclick="pfTimerToggle\(\)">START</);
  assert.match(style, /\.cl-more-cb:checked~\.cl-tools\{display:flex;\}/);
  assert.match(style, /\.cl-progress-label\{[^}]*white-space:nowrap/, 'M1: progress label on one line');
  // rows: the title takes the width, detail zone ≥ 44 px, rows ≥ 50 px, checkbox 24 × 24
  assert.match(style, /\.ci\{[^}]*min-height:52px/);
  assert.match(style, /\.ci\.done\{min-height:52px;\}/, 'ticked rows stay ≥ 50 px');
  assert.match(style, /\.cl-more-btn,\.cl-more-cb\{display:none;\}/, 'More checkbox not in the desktop tab order');
  assert.match(HTML, /modal\.scrollTop \+= el\.getBoundingClientRect\(\)\.top - \(hdr \? hdr\.getBoundingClientRect\(\)\.bottom/, 'emergJump offsets by the sticky header');
  assert.match(style, /\.ci-left\{flex:1;/);
  assert.match(style, /\.ci-right\{flex:0 0 120px;/);
  assert.match(style, /\.ci-right\{flex-basis:52px;/);
  assert.match(style, /\.ci-box\{width:24px;height:24px;/);
  assert.match(style, /\.cl-section-name\{[^}]*color:var\(--text\) !important/, 'section titles in the text colour');
});

test('M7: the Checklists sub-tab row is sticky on a phone (page-scoped until WP28)', () => {
  assert.match(style, /@media\(max-width:600px\)\{[\s\S]*body>#nav\.tn-has-sub\{position:sticky;top:0;/);
});

function open(JSDOM, storage) {
  const errors = [];
  const html = HTML.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + (src === 'js/gcs-client.js'
    ? "self.GcsClient = { BASE: 'http://127.0.0.1:47800', start() {}, stop() {}, isConnected() { return false; } };"
    : readText(src).replace(/<\/script/gi, '<\\/script')) + '</script>');
  const dom = new JSDOM(html, { url: 'https://melonno.github.io/vtol-manual/index.html', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {}; w.print = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
      w.fetch = () => Promise.reject(new w.TypeError('offline'));
      w.addEventListener('error', e => errors.push(String(e.message)));
      Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k]));
    } });
  return { w: dom.window, d: dom.window.document, errors };
}

test('R7 (jsdom): tick an item, open a detail, save a battery entry, switch every tab, emergency modal', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path'); return; }
  const { w, d, errors } = open(JSDOM);
  try {
  await new Promise(r => setTimeout(r, 30));
  // emergency modal closed at load (inline display none: emergIsOpen() and css/print.css read it)
  assert.equal(d.getElementById('emerg-modal').style.display, 'none');
  assert.equal(w.emergIsOpen(), false);
  // the empty notices are hidden by CSS (:empty) until the script fills them
  assert.match(style, /#store-notice:empty,#info-notice:empty,\.cl-notice:empty,#mp-fetch-status:empty\{display:none;\}/);
  assert.equal(d.getElementById('cl-notice').textContent, '');
  // tick and detail
  const row = d.querySelector('#cl-container .ci'), left = row.querySelector('.ci-left');
  left.click();
  assert.ok(row.classList.contains('done'));
  assert.equal(left.getAttribute('aria-pressed'), 'true');
  assert.match(d.getElementById('pl').textContent, /^1 \/ \d+ ITEMS COMPLETE$/);
  const row2 = [...d.querySelectorAll('#cl-container .ci')].find(r => !r.classList.contains('done') && r.querySelector('.ci-right[aria-controls]'));
  row2.querySelector('.ci-right').click();
  assert.ok(d.getElementById('det-' + row2.dataset.id).classList.contains('visible'));
  assert.equal(row2.querySelector('.ci-right').getAttribute('aria-expanded'), 'true');
  // timer: class instead of inline colours on the button
  const sb = d.getElementById('pf-start-btn');
  w.pfTimerToggle(); assert.equal(sb.textContent, 'STOP'); assert.ok(sb.classList.contains('running'));
  w.pfTimerReset(); assert.equal(sb.textContent, 'START'); assert.ok(!sb.classList.contains('running'));
  // battery entry through the form
  const set = (id, v) => { d.getElementById(id).value = v; };
  set('bl-date', '2026-10-18'); set('bl-start', '25.1'); set('bl-min', '22.6'); set('bl-rest', '23.3'); set('bl-time', '18');
  d.querySelector('button[onclick="logBattery()"]').click();
  assert.equal(d.querySelectorAll('#bl-log-table tbody tr').length, 1, 'one log row');
  assert.equal(d.getElementById('bl-log-empty').style.display, 'none');
  const an = d.getElementById('bl-analysis').textContent.replace(/\s+/g, ' ');
  assert.match(an, /Suggested manual RTL trigger \(pilot, OSD raw voltage\)/);
  assert.match(an, /Configured failsafes — not changed from this log: BATT_LOW_VOLT 22\.0V → automatic RTL/);
  assert.doesNotMatch(d.getElementById('bl-analysis').innerHTML, /\sstyle="/, 'analysis without inline styles');
  // every tab
  for (const b of d.querySelectorAll('nav button[onclick^="switchTab("]')) {
    b.click();
    const name = /switchTab\('([^']+)'/.exec(b.getAttribute('onclick'))[1];
    assert.ok(d.getElementById('tab-' + name).classList.contains('active'), name);
  }
  // emergency modal: IMMEDIATE cards first, the design intent after them
  d.getElementById('emerg-fab').click();
  assert.equal(w.emergIsOpen(), true);
  const list = d.getElementById('emerg-list');
  assert.ok(list.firstElementChild.classList.contains('emerg-card'), 'first child is an emergency card');
  assert.ok(list.lastElementChild.classList.contains('design-intent'), 'design intent last');
  // Rework round 1 F1: a jump puts the card top (title + IMMEDIATE badge) just below the sticky header.
  // jsdom has no layout: stub the rectangles (header bottom 95 px, card top 1200 px on screen, modal at 0).
  const modal = d.getElementById('emerg-modal'), hdr = modal.querySelector('.emerg-modal-hdr');
  const card = d.getElementById(list.querySelector('.emerg-card:last-of-type') ? [...list.querySelectorAll('.emerg-card')].pop().id : list.firstElementChild.id);
  hdr.getBoundingClientRect = () => ({ top: 0, bottom: 95, left: 0, right: 390, height: 95, width: 390 });
  card.getBoundingClientRect = () => ({ top: 1200, bottom: 1600, left: 0, right: 390, height: 400, width: 390 });
  modal.scrollTop = 0;
  w.emergJump(card.id);
  assert.equal(modal.scrollTop, 1200 - 95 - 16, 'card top lands 16 px under the header, never under it');
  w.closeEmerg();
  assert.equal(w.emergIsOpen(), false);
  // Rework round 1: the phone More menu closes after an action, on an outside tap and on Escape
  const cb = d.getElementById('cl-more-pf');
  cb.checked = true; d.querySelector('#tab-preflight .cl-tools button').click(); assert.equal(cb.checked, false, 'closed after an action');
  cb.checked = true; d.querySelector('#cl-container .ci-right').click(); assert.equal(cb.checked, false, 'closed by a tap outside');
  cb.checked = true; d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert.equal(cb.checked, false, 'closed on Escape');
  d.querySelector('label[for="cl-more-pf"]').click(); assert.equal(cb.checked, true, 'the label still opens it');
  assert.deepEqual(errors, []);
  } finally { w.close(); }
});
