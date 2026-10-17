'use strict';
// The committed diagrams are exactly what scripts/diagrams/ generates (byte-for-byte, CRLF/LF-insensitive).
// Fix: node scripts/diagrams/build.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('../repo-files.js');
const B = require('../../scripts/diagrams/build.js');

test('img/diagrams/*.svg match the generator output', () => {
  const svgs = B.generateSvgs();
  assert.equal(Object.keys(svgs).length, 16);
  const onDisk = fs.readdirSync(B.SVG_DIR).filter(f => f.endsWith('.svg')).sort();
  assert.deepEqual(onDisk, Object.keys(svgs).map(n => n + '.svg').sort(), 'no extra or missing files');
  for (const [name, svg] of Object.entries(svgs)) assert.ok(readText('img/diagrams/' + name + '.svg') === svg, name + ' is out of date — run node scripts/diagrams/build.js');
});

test('manual.html diagram slots and inline SVGs match the generator output', () => {
  const html = readText('manual.html');
  const next = B.generateManual(html, B.generateSvgs());
  assert.ok(next === html, 'manual.html is out of date — run node scripts/diagrams/build.js');
});

test('the generator uses only Node built-ins', () => {
  const dir = path.join(B.ROOT, 'scripts', 'diagrams');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    for (const m of readText('scripts/diagrams/' + f).matchAll(/require\('([^']+)'\)/g)) assert.ok(/^\.\/|^(fs|path)$/.test(m[1]), f + ' requires ' + m[1]);
  }
});
