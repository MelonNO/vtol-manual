'use strict';
// Tools page swipe navigation (PM follow-up to WP07; nav in groups since WP24): the swipe order is the nav order and
// covers every tab. A hard-coded copy of the tab list went stale when tabs were added; the order is read from the nav
// buttons. WP24 groups the ten tab buttons under five group buttons (Checklists · Link · Logs · Weather · Setup): every
// tab button sits in exactly one group's sub-tab row, and the swipe runs over all ten tabs in group order.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');

const HTML = readText('index.html');
const NAV = HTML.slice(HTML.indexOf('<nav'), HTML.indexOf('</nav>'));
const navButtons = [...NAV.matchAll(/<button[^>]*onclick="(switchTab\('[\w-]+',this\))"/g)].map(m => m[1]);
const navOrder = navButtons.map(o => o.match(/switchTab\('([\w-]+)'/)[1]);
const panels = [...HTML.matchAll(/<div id="tab-([\w-]+)" class="tab-panel"/g)].map(m => m[1]);
const GROUPS = { checklists: ['preflight', 'turnaround', 'postflight'], link: ['link'], logs: ['battlog', 'tlog', 'flights'], weather: ['weather'], setup: ['params', 'profiles'] };

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

test('WP24: five groups in order; every tab button sits in exactly one group sub-tab row', () => {
  const groups = [...NAV.matchAll(/<button type="button" class="tn-group" data-group="([\w-]+)" onclick="switchGroup\(this\.dataset\.group\)">([^<]+)<\/button>/g)];
  assert.deepEqual(groups.map(m => m[1]), Object.keys(GROUPS));
  assert.deepEqual(groups.map(m => m[2]), ['Checklists', 'Link', 'Logs', 'Weather', 'Setup']);
  for (const [g, tabs] of Object.entries(GROUPS)) {
    const row = NAV.match(new RegExp('<div class="tn-sub seg[^"]*" data-group="' + g + '">([\\s\\S]*?)</div>'));
    assert.ok(row, 'sub-tab row ' + g);
    assert.deepEqual([...row[1].matchAll(/switchTab\('([\w-]+)'/g)].map(m => m[1]), tabs, g);
    assert.equal(/tn-single/.test(row[0]), tabs.length === 1, g + ': a one-tab group has no visible sub-tab row');
  }
});

test('swipe order = nav order = group order over all ten tabs, read from the nav (no hard-coded tab list)', () => {
  assert.deepEqual(pageNavTabOrder(), navOrder);
  assert.deepEqual(navOrder, Object.values(GROUPS).flat(), 'group order');
  const swipe = HTML.slice(HTML.indexOf('// ── SWIPE TAB NAVIGATION ──'), HTML.indexOf('// ── EMERGENCY QUICK-JUMP ──'));
  assert.match(swipe, /const TABS = navTabOrder\(\);/);
  assert.doesNotMatch(swipe, /\['preflight',/, 'no stale literal list');
});
