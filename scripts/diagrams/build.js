'use strict';
// Regenerates the WP07 diagrams with plain Node (no npm packages):
//   node scripts/diagrams/build.js           write img/diagrams/*.svg and update manual.html (diagram slots + inline SVGs)
//   node scripts/diagrams/build.js --check   regenerate in memory and compare; exit 1 if anything differs
// Comparison ignores CRLF vs LF only (a Windows checkout may convert line endings); otherwise byte-for-byte.
// See scripts/diagrams/README.md.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const inline = require('./inline.js');
const slots = require('./slots.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SVG_DIR = path.join(ROOT, 'img', 'diagrams');
const MANUAL = path.join(ROOT, 'manual.html');
const MODULES = ['d1-3', 'd4-8', 'd9-15'];
const lf = s => s.replace(/\r\n/g, '\n');

// { name: svgText } for every standalone diagram, in file-name order.
function generateSvgs() {
  const all = Object.assign({}, ...MODULES.map(m => require('./' + m + '.js')));
  const out = {};
  for (const name of Object.keys(all).sort()) {
    L.setCur(name);
    out[name] = L.doc(name, all[name]());
  }
  return out;
}

// manual.html with the diagram slots and the inline SVG blocks regenerated.
function generateManual(html, svgs) {
  return inline.apply(slots.apply(lf(html), svgs));
}

function main() {
  const check = process.argv.includes('--check');
  const svgs = generateSvgs();
  const diffs = [];
  const want = new Set(Object.keys(svgs).map(n => n + '.svg'));
  if (fs.existsSync(SVG_DIR)) for (const f of fs.readdirSync(SVG_DIR)) if (f.endsWith('.svg') && !want.has(f)) diffs.push('img/diagrams/' + f + ' is not produced by the generator');
  for (const [name, svg] of Object.entries(svgs)) {
    const f = path.join(SVG_DIR, name + '.svg');
    const cur = fs.existsSync(f) ? lf(fs.readFileSync(f, 'utf8')) : null;
    if (cur === svg) continue;
    if (check) diffs.push('img/diagrams/' + name + '.svg ' + (cur === null ? 'missing' : 'differs'));
    else { fs.mkdirSync(SVG_DIR, { recursive: true }); fs.writeFileSync(f, svg); console.log('wrote img/diagrams/' + name + '.svg (' + (svg.length / 1024).toFixed(1) + ' KB)'); }
  }
  const html = lf(fs.readFileSync(MANUAL, 'utf8'));
  const next = generateManual(html, svgs);
  if (next !== html) {
    if (check) diffs.push('manual.html diagram slots / inline SVGs differ');
    else { fs.writeFileSync(MANUAL, next); console.log('updated manual.html'); }
  }
  L.warnings.forEach(w => console.log('layout warning: ' + w));
  if (check) {
    if (diffs.length) { diffs.forEach(d => console.log('DIFF ' + d)); console.log('Run: node scripts/diagrams/build.js'); process.exit(1); }
    console.log('diagrams up to date (' + Object.keys(svgs).length + ' SVG files, manual slots and inline SVGs)');
  }
}

if (require.main === module) main();
module.exports = { generateSvgs, generateManual, ROOT, SVG_DIR, MANUAL };
