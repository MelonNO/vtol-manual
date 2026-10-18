'use strict';
// WP23 R1 / R7c: WCAG 2 contrast of the colour tokens, in normal and sunlight mode (docs/design/README.md "Contrast").
// Text tokens ≥ 4.5:1 on --bg, --surface and --surface2; --red (large / bold text and non-text only) and --dim
// (non-text only: control boundaries, icons) ≥ 3:1; callout and badge text ≥ 4.5:1 on its tinted background.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { modeTokens, substitute } = require('../pwa/computed-style.js');
const { contrast } = require('./design-lib.js');

const CSS = readText('css/base.css');
const SURFACES = ['--bg', '--surface', '--surface2'];
const TEXT = ['--text', '--text-2', '--muted', '--accent', '--amber', '--green', '--red-fg', '--blue', '--orange-lt'];
const LARGE_OR_NONTEXT = ['--red', '--dim'];
// [text token, tint token]: callout labels and bodies, badges, chips, IMMEDIATE / CLEAN-UP blocks
const ON_TINT = [['--text', '--red-bg'], ['--text', '--amber-bg'], ['--text', '--accent-bg'], ['--text', '--green-bg'],
  ['--red-fg', '--red-bg'], ['--amber', '--amber-bg'], ['--accent', '--accent-bg'], ['--green', '--green-bg'],
  ['--blue', '--blue-bg'], ['--orange-lt', '--accent-bg'], ['--muted', '--red-bg'], ['--muted', '--amber-bg']];

function table(sun) {
  const raw = modeTokens([CSS], sun), t = {};
  for (const k of Object.keys(raw)) t[k] = substitute(raw[k], raw);
  const rows = [];
  for (const f of TEXT) for (const b of SURFACES) rows.push({ fg: f, bg: b, min: 4.5, ratio: contrast(t[f], t[b]) });
  for (const f of LARGE_OR_NONTEXT) for (const b of SURFACES) rows.push({ fg: f, bg: b, min: 3, ratio: contrast(t[f], t[b]) });
  // a tint sits on the page, on a card or on a raised surface (WP28: --surface2 too): check all three
  for (const [f, tint] of ON_TINT) for (const b of SURFACES) rows.push({ fg: f, bg: tint + ' over ' + b, min: 4.5, ratio: contrast(t[f], t[tint], t[b]) });
  return rows;
}

for (const [mode, sun] of [['normal', false], ['sunlight', true]]) {
  test('R7c: WCAG contrast of the colour tokens — ' + mode + ' mode', () => {
    const rows = table(sun);
    assert.ok(rows.length >= 55, rows.length + ' pairs');
    const bad = rows.filter(r => !(r.ratio >= r.min)).map(r => r.fg + ' on ' + r.bg + ' = ' + r.ratio.toFixed(2) + ':1 < ' + r.min);
    assert.deepEqual(bad, []);
  });
}

module.exports = { table };
