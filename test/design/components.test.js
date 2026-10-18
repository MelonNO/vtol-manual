'use strict';
// WP23 R3 / R4 / R5 / R7d / R8: one definition per shared component (css/base.css section 4), the duplicate guard,
// motion, computed styles of key elements (jsdom, optional) and the styleguide page.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, readText } = require('../repo-files.js');
const { computeStyles, loadJsdom } = require('../pwa/computed-style.js');
const { componentsCss, selectors, pageStyles } = require('./design-lib.js');

const PAGES = ['index.html', 'manual.html', 'relay/map.html', 'tools/latency-clock.html'];
const BASE = readText('css/base.css');
const COMP = selectors(componentsCss(BASE));

// The rules that WP23 moved out of index.html and manual.html (they were defined in both; the manual-only members of
// the same component families moved with them). Header, nav and footer stay in the pages (WP24).
const MOVED = ['.content', '.tab-panel', '.tab-panel.active', '@keyframes fadeSlideIn', '.section-title', '.section-title:first-child',
  'p', 'p strong', 'p b', 'code', '.card', '.card.accent', '.card.amber', '.card.danger', '.card-title', '.card.amber .card-title',
  '.card.danger .card-title', '.tbl-wrap', 'table', 'th', 'td', 'td:first-child', 'tr:last-child td', '.val', '.warn-val', '.crit-val',
  '.alert', '.alert-danger', '.alert-warn', '.alert-info', '.alert::before', '.alert-danger::before', '.alert-warn::before',
  '.alert-info::before', '.alert strong', '.step', '.step-n', '.step-body', '.step-body > strong', '.step-body p', '.mbadge',
  '.m-qhov', '.m-fbwb', '.m-fbwa', '.m-auto', '.m-man', '.m-rtl', '.emerg-hdr', '.proc-step', '.proc-step .n', '.proc-step .t',
  '.emerg-imm', '.emerg-imm-badge', '.emerg-imm-step', '.emerg-imm-step:last-child', '.emerg-imm-step .n', '.emerg-cleanup-btn',
  '.emerg-cleanup-btn:hover', '.emerg-cleanup-btn.open', '.emerg-cleanup', '.emerg-cleanup.visible', '.emerg-cu-label',
  '.emerg-cu-step', '.emerg-cu-step:last-child', '.emerg-cu-step .n', '.emerg-cu-step .t', '.emerg-pills', '.emerg-pill',
  '.emerg-pill.primary', '.emerg-pill.note', '.emerg-card', '.emerg-primary', '.emerg-summary', '.emerg-note .emerg-note-text',
  '.emerg-note-close', '.emerg-note-close-title', '.emerg-note-close .emerg-imm-step', '.fs-primary td', '.sr-only'];

test('R3: every shared component is defined once, in the components section of css/base.css', () => {
  const missing = MOVED.filter(s => !COMP.has(s));
  assert.deepEqual(missing, [], 'in css/base.css section 4');
  // R4: the new component classes
  for (const s of ['.btn', '.btn-primary', '.btn-ghost', '.btn-danger', '.btn-sm', '.field', '.disclosure > summary', '.muted', '.mono', '.stack', '.cluster']) assert.ok(COMP.has(s), s);
  // header, nav and footer are WP24's: not in the components section
  for (const s of COMP) assert.doesNotMatch(s, /^(header|nav|footer)\b|\.hdr-|\.nav-/, s);
});

test('R7d: duplicate guard — no page <style> redefines a selector of the base components section', () => {
  for (const f of PAGES) {
    const clash = [...selectors(pageStyles(readText(f)))].filter(s => COMP.has(s));
    assert.deepEqual(clash, [], f);
  }
});

test('R4: buttons and the emergency controls are at least 44 px high; IMMEDIATE is bold and red-marked, CLEAN-UP amber and collapsible', () => {
  const rule = sel => { const m = componentsCss(BASE).match(new RegExp('\\n' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };
  for (const s of ['.btn', '.emerg-cleanup-btn', '.emerg-pill']) assert.match(rule(s), /min-height:44px/, s);
  assert.doesNotMatch(rule('.btn-sm'), /min-height/, '.btn-sm keeps the 44 px minimum of .btn');
  assert.match(rule('.emerg-imm'), /border-left:3px solid var\(--red\)/);
  assert.match(rule('.emerg-imm-step'), /font-weight:700/);
  assert.match(rule('.emerg-imm-step'), /color:var\(--text\)/);
  assert.match(rule('.emerg-cleanup'), /display:none;[^}]*border-left:3px solid var\(--amber\)/);
  assert.match(rule('.emerg-cleanup.visible'), /display:block/);
  assert.match(rule('.alert'), /color:var\(--text\)/, 'callout body text in --text, not in the colour');
  for (const s of ['.alert-danger', '.alert-warn', '.alert-info']) assert.match(rule(s), /background:var\(--[\w-]+-bg\)/, s + ' tinted');
});

test('R5: reduced motion turns off animations and transitions; no infinite animation in css/base.css', () => {
  assert.match(BASE, /@media \(prefers-reduced-motion: reduce\)\{\s*\*,\*::before,\*::after\{animation:none !important;transition:none !important;/);
  assert.doesNotMatch(BASE.replace(/\/\*[\s\S]*?\*\//g, ''), /infinite/);
  for (const f of PAGES) assert.ok(readText(f).includes('css/base.css"'), f + ' links css/base.css (so the motion rule reaches it)');
});

test('R2/R7: computed styles of key elements (jsdom): body font and size, callout, value chips, sunlight mode', t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path to run this check'); return; }
  const extra = '<div class="alert alert-warn" id="x-alert">t</div><span class="warn-val" id="x-tbd">TBD</span><code id="x-code">X</code>'
    + '<button class="btn" id="x-btn">B</button><div class="emerg-imm-step" id="x-imm">1</div>';
  const props = ['font-family', 'font-size', 'color', 'background-color', 'border-left-color', 'border-left-width', 'min-height', 'font-weight'];
  for (const page of PAGES) {
    const s = computeStyles(ROOT, page, JSDOM, ['body', '#x-alert', '#x-tbd', '#x-code', '#x-btn', '#x-imm'], props, { extraHtml: extra });
    assert.match(s.body['font-family'], /^"?IBM Plex Sans"?,/, page + ' body font');
    if (page !== 'relay/map.html') assert.equal(s.body['font-size'], '16px', page + ' body size');
    assert.equal(s['#x-alert']['border-left-color'], 'rgb(250, 204, 21)', page + ' .alert-warn edge amber');
    assert.equal(s['#x-alert'].color, 'rgb(232, 232, 232)', page + ' .alert-warn text --text');
    assert.equal(s['#x-tbd'].color, 'rgb(250, 204, 21)', page + ' .warn-val amber');
    assert.match(s['#x-code']['font-family'], /Share Tech Mono/, page + ' code monospace');
    assert.equal(s['#x-btn']['min-height'], '44px', page + ' .btn 44 px');
    assert.equal(s['#x-imm']['font-weight'], '700', page + ' IMMEDIATE bold');
  }
  const sun = computeStyles(ROOT, 'manual.html', JSDOM, ['body', 'td'], ['background-color', 'color'], { sun: true, extraHtml: '<table><tr><td>a</td><td>b</td></tr></table>' });
  assert.equal(sun.body['background-color'], 'rgb(0, 0, 0)', 'sunlight: black');
  assert.equal(sun.body.color, 'rgb(255, 255, 255)', 'sunlight: white text');
});

test('R8: docs/design/styleguide.html links css/base.css, has a sunlight toggle and the page CSP, shows every token, is not precached or linked from the field pages', () => {
  const html = readText('docs/design/styleguide.html');
  assert.ok(html.includes('<link rel="stylesheet" href="../../css/base.css">'));
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  for (const d of ["default-src 'self'", "font-src 'self'", "object-src 'none'", "base-uri 'self'"]) assert.ok(csp.includes(d), d);
  assert.match(html, /data-sg-sun/, 'sunlight toggle');
  const tokens = Object.keys(require('../pwa/computed-style.js').rootTokens([BASE]));
  const missing = tokens.filter(k => !html.includes(k));
  assert.deepEqual(missing, [], 'every :root token is shown');
  for (const c of ['card', 'alert-info', 'alert-warn', 'alert-danger', 'section-title', 'mbadge', 'warn-val', 'crit-val', 'step-n',
    'emerg-imm', 'emerg-cleanup', 'btn-primary', 'btn-ghost', 'btn-danger', 'btn-sm', 'field', 'disclosure', 'tbl-wrap']) assert.match(html, new RegExp('class="[^"]*\\b' + c + '\\b'), c);
  assert.ok(!readText('sw-precache.js').includes('styleguide'), 'not precached');
  for (const f of PAGES) assert.ok(!readText(f).includes('styleguide'), f + ' does not link the styleguide');
});
