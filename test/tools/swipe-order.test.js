'use strict';
// Tools page swipe navigation (PM follow-up to WP07): the swipe order is the nav order and covers every tab.
// A hard-coded copy of the tab list went stale when tabs were added; the order is now read from the nav buttons.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');

const HTML = readText('index.html');
const NAV = HTML.slice(HTML.indexOf('<nav'), HTML.indexOf('</nav>'));
const navButtons = [...NAV.matchAll(/<button[^>]*onclick="(switchTab\('[\w-]+',this\))"/g)].map(m => m[1]);
const navOrder = navButtons.map(o => o.match(/switchTab\('([\w-]+)'/)[1]);
const panels = [...HTML.matchAll(/<div id="tab-([\w-]+)" class="tab-panel"/g)].map(m => m[1]);

// Run the page's navTabOrder() against a stub document holding the parsed nav buttons.
function pageNavTabOrder() {
  const i = HTML.indexOf('function navTabOrder() {');
  assert.ok(i > 0, 'navTabOrder() exists');
  const src = HTML.slice(i, HTML.indexOf('\n}\n', i) + 2);
  const document = {
    querySelectorAll(sel) {
      assert.equal(sel, 'nav button[onclick^="switchTab"]');
      return navButtons.map(o => ({ getAttribute: a => (a === 'onclick' ? o : null) }));
    }
  };
  return new Function('document', src + '\nreturn navTabOrder();')(document);
}

test('every Tools tab panel has exactly one nav button, and vice versa', () => {
  assert.equal(new Set(navOrder).size, navOrder.length, 'no duplicate nav buttons');
  assert.deepEqual([...navOrder].sort(), [...panels].sort());
  for (const t of ['preflight', 'turnaround', 'postflight', 'link', 'battlog', 'tlog', 'flights', 'params', 'weather', 'profiles']) assert.ok(navOrder.includes(t), t);
});

test('swipe order = nav order, read from the nav (no hard-coded tab list)', () => {
  assert.deepEqual(pageNavTabOrder(), navOrder);
  const swipe = HTML.slice(HTML.indexOf('// ── SWIPE TAB NAVIGATION ──'), HTML.indexOf('// ── EMERGENCY QUICK-JUMP ──'));
  assert.match(swipe, /const TABS = navTabOrder\(\);/);
  assert.doesNotMatch(swipe, /\['preflight',/, 'no stale literal list');
});
