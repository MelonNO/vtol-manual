'use strict';
// WP09 R2: css/base.css holds the shared tokens and base element styles, and moving them out of the pages caused no
// visual change. Computed styles of 10+ key elements per page are compared, in jsdom, with a snapshot taken from the
// pages before WP09 (test/pwa/fixtures/computed-before.json, written by `node test/pwa/computed-style.js <pre-WP09 tree>`).
// jsdom is not a repository dependency: set VTOL_JSDOM=<path to the jsdom package> (or have jsdom resolvable); otherwise
// the computed-style test is skipped and only the static token check runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROOT, readText } = require('../repo-files.js');
const { PAGES, PROPS, rootTokens, computeKeyStyles, loadJsdom } = require('./computed-style.js');

const BEFORE = JSON.parse(readText('test/pwa/fixtures/computed-before.json'));

test('R2: css/base.css :root tokens are exactly the values the pages used before (index.html / map / latency clock)', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(rootTokens([readText('css/base.css')])).filter(([k]) => !/^--(paper|ink|vf-zoom)$/.test(k))), {
    '--bg': '#0f0f0f', '--surface': '#1a1a1a', '--surface2': '#222', '--border': '#2a2a2a', '--border2': '#333',
    '--text': '#e8e8e8', '--muted': '#666', '--accent': '#f97316', '--amber': '#facc15', '--red': '#ef4444',
    '--green': '#22c55e', '--dim': '#444', '--mono': "'Share Tech Mono',monospace", '--head': "'Oswald',sans-serif"
  });
  assert.equal(rootTokens([readText('manual.html').match(/<style>([\s\S]*?)<\/style>/)[1]])['--muted'], '#777', 'the manual keeps its own --muted');
});

test('R2: computed styles of the key elements are unchanged (jsdom, every page)', t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path to run this check'); return; }
  let n = 0;
  for (const page of Object.keys(PAGES)) {
    const now = computeKeyStyles(ROOT, page, JSDOM);
    assert.ok(Object.keys(now).length >= 10, page + ': at least 10 key elements');
    for (const sel of Object.keys(now)) {
      assert.ok(now[sel], page + ' ' + sel + ' exists');
      for (const p of PROPS) { assert.equal(now[sel][p], BEFORE[page][sel][p], page + ' ' + sel + ' ' + p); n++; }
    }
  }
  assert.ok(n > 500, n + ' property values compared');
});
