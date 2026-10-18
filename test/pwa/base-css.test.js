'use strict';
// css/base.css tokens (WP23 R1 / R7 a–b).
// History: WP09 R2 pinned the look — the computed styles of key elements had to equal a snapshot of the pre-WP09
// pages (fixtures/computed-before.json) and the tokens had to keep their old values. That pinning was SUPERSEDED by
// the owner decision of 2026-10-18 (make the site cleaner, more readable, prettier; docs/tasks/04-REDESIGN-CONTEXT.md
// §1): WP23 retired the snapshot and replaced it with design-system tests — this file (semantic colours unchanged,
// type / spacing / radius tokens present, colours only as tokens) and test/design/ (WCAG contrast, one definition per
// shared component, computed styles of key elements, fonts, styleguide).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { rootTokens } = require('./computed-style.js');

const CSS = readText('css/base.css');
const T = rootTokens([CSS]);

test('R7a: the four semantic colour values are unchanged (manifest, standalone SVGs and tests use them)', () => {
  assert.equal(T['--accent'], '#f97316');
  assert.equal(T['--red'], '#ef4444');
  assert.equal(T['--green'], '#22c55e');
  assert.equal(T['--amber'], '#facc15');
  assert.equal(T['--bg'], JSON.parse(readText('manifest.webmanifest')).background_color, '--bg = manifest background_color');
  // sunlight mode must not redefine them either
  const sun = rootTokens([CSS], ':root[data-sun]');
  for (const k of ['--accent', '--red', '--green', '--amber']) assert.ok(!(k in sun), 'sunlight mode keeps ' + k);
});

test('R7b: type, line-height, spacing, radius, surface, tint and font-family tokens exist with the documented values', () => {
  const px = { '--fs-xs': 12, '--fs-sm': 14, '--fs-md': 16, '--fs-lg': 18, '--fs-xl': 22, '--fs-2xl': 28,
    '--sp-1': 4, '--sp-2': 8, '--sp-3': 12, '--sp-4': 16, '--sp-5': 24, '--sp-6': 32, '--sp-7': 48 };
  for (const [k, v] of Object.entries(px)) assert.equal(T[k], v + 'px', k);
  const sizes = Object.keys(T).filter(k => /^--fs-/.test(k)).map(k => parseFloat(T[k]));
  assert.equal(sizes.length, 6, 'six type steps');
  assert.ok(Math.min(...sizes) >= 12, 'minimum text size 12 px');
  for (const k of ['--lh-tight', '--lh-body']) assert.match(T[k], /^1\.\d+$/, k);
  for (const k of ['--r-sm', '--r-md']) assert.match(T[k], /^\d+px$/, k);
  assert.ok(parseFloat(T['--r-sm']) < parseFloat(T['--r-md']), 'two radii, small < medium');
  for (const k of ['--bg', '--surface', '--surface2', '--border', '--border2', '--text', '--text-2', '--muted', '--dim']) assert.match(T[k], /^#[0-9a-f]{3,6}$/i, k);
  for (const k of ['--accent-bg', '--red-bg', '--amber-bg', '--green-bg', '--blue-bg']) assert.match(T[k], /^rgba\(/, k + ' tint');
  assert.match(T['--sans'], /^'IBM Plex Sans',/);
  assert.match(T['--head'], /^'Oswald',/);
  assert.match(T['--mono'], /^'Share Tech Mono',/);
  // every token has a one-line comment (declarations on their own line end in /* … */; grouped spacing has one)
  const block = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')));
  for (const line of block.split('\n').filter(l => /^\s*--/.test(l))) assert.match(line, /\/\*.+\*\/\s*$|^\s*--sp-1:/, 'comment: ' + line.trim());
});

test('R7b: body text uses the sans token at --fs-md; colours in css/base.css are defined in the :root token blocks only', () => {
  assert.match(CSS, /\nbody\{font-family:var\(--sans\);[^}]*font-size:var\(--fs-md\);/);
  const outside = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root(\[[^\]]*\])?\s*\{[^}]*\}/g, '');
  assert.doesNotMatch(outside, /rgba?\(/i, 'no rgba() colour outside the :root token blocks');
  assert.doesNotMatch(outside, /#[0-9a-f]{3,8}\b/i, 'no hex colour outside the :root token blocks');
  assert.equal(T['--shadow'], 'rgba(0,0,0,.6)');   // WP14 R12c(e): the toast shadow is a token
});
