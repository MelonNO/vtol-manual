'use strict';
// WP09 R1 / R2 / R4 / R5 / R7 / R8 (static checks): self-hosted fonts, CSPs, css/base.css on every page, no duplicated
// token blocks, manifest + icons, mode toggle, version line, service-worker hook, print stylesheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readText } = require('../repo-files.js');
const { rootTokens } = require('./computed-style.js');

const PAGES = { 'index.html': '', 'manual.html': '', 'relay/map.html': '../', 'tools/latency-clock.html': '../' };
const csp = html => ((html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '')
  .split(';').map(s => s.trim()).filter(Boolean).reduce((o, d) => { const [k, ...v] = d.split(/\s+/); o[k] = v; return o; }, {});
// Width / height of a PNG from its IHDR chunk.
const pngSize = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('R1: no Google Fonts anywhere; @font-face in css/base.css points at the self-hosted woff2 files; OFL licences present', () => {
  for (const f of [...Object.keys(PAGES), 'css/base.css', 'css/print.css', 'sw.js']) {
    assert.doesNotMatch(readText(f), /fonts\.googleapis|fonts\.gstatic|@import/, f);
  }
  const css = readText('css/base.css');
  const faces = [...css.matchAll(/@font-face\{([^}]+)\}/g)].map(m => m[1]);
  assert.equal(faces.length, 3);
  for (const fam of ['Oswald', 'Share Tech Mono']) assert.ok(faces.some(f => f.includes("font-family:'" + fam + "'")), fam);
  assert.ok(faces.filter(f => f.includes("'Oswald'")).every(f => /font-weight:200 700/.test(f)), 'Oswald variable file covers 400/600/700');
  for (const m of css.matchAll(/url\(\.\.\/(fonts\/[\w.-]+\.woff2)\)/g)) {
    const buf = fs.readFileSync(path.join(ROOT, m[1]));
    assert.equal(buf.toString('latin1', 0, 4), 'wOF2', m[1] + ' is WOFF2');
  }
  for (const f of ['fonts/OFL-Oswald.txt', 'fonts/OFL-ShareTechMono.txt']) assert.match(readText(f), /SIL OPEN FONT LICENSE Version 1\.1/i, f);
  assert.match(readText('fonts/README.md'), /fonts\.gstatic\.com\/s\/oswald/);
});

test('R1: every page has a tight CSP: fonts self only, no Google hosts, worker / manifest self, object none', () => {
  for (const f of Object.keys(PAGES)) {
    const c = csp(readText(f));
    assert.deepEqual(c['default-src'], ["'self'"], f);
    assert.deepEqual(c['font-src'], ["'self'"], f + ' font-src');
    assert.ok(!JSON.stringify(c).includes('google'), f);
    assert.deepEqual(c['object-src'], ["'none'"], f);
    assert.deepEqual(c['base-uri'], ["'self'"], f);
    for (const d of ['worker-src', 'manifest-src']) assert.deepEqual(c[d] || c['default-src'], ["'self'"], f + ' ' + d);
    assert.ok(!c['style-src'] || c['style-src'].every(s => s === "'self'" || s === "'unsafe-inline'"), f + ' style-src');
  }
  const idx = csp(readText('index.html'))['connect-src'];
  for (const h of ['https://api.open-meteo.com', 'https://nominatim.openstreetmap.org', 'http://127.0.0.1:47800']) assert.ok(idx.includes(h), 'index connect-src keeps ' + h);
  assert.deepEqual(csp(readText('manual.html'))['connect-src'], ["'self'"]);
});

test('R1: the map CSP allows exactly the tile / terrain hosts the page uses (img + fetch) and the local GCS API', () => {
  const html = readText('relay/map.html'), c = csp(html);
  const hosts = new Set([...html.matchAll(/'(https:\/\/[^'/`]+)\//g), ...html.matchAll(/`(https:\/\/[^`/]+)\//g)].map(m => m[1].replace(/^https:\/\/\{s\}\./, 'https://*.')));
  assert.ok(hosts.size >= 6, [...hosts].join(' '));
  for (const h of hosts) {
    assert.ok(c['img-src'].includes(h), 'img-src ' + h);
    assert.ok(c['connect-src'].includes(h), 'connect-src ' + h);
  }
  assert.ok(c['connect-src'].includes('http://127.0.0.1:47800'));
  assert.ok(c['img-src'].includes('blob:'), 'offline tiles from IndexedDB are blob: URLs');
});

test('R2: every page links css/base.css before its own <style>, and no longer repeats a base token with the same value', () => {
  const base = rootTokens([readText('css/base.css')]);
  for (const k of ['--bg', '--surface', '--surface2', '--border', '--border2', '--text', '--muted', '--accent', '--amber', '--red', '--green', '--dim', '--mono', '--head']) assert.ok(base[k], k);
  for (const [f, up] of Object.entries(PAGES)) {
    const html = readText(f);
    const link = html.indexOf('<link rel="stylesheet" href="' + up + 'css/base.css">'), style = html.indexOf('<style>');
    assert.ok(link > 0 && style > link, f + ': base.css linked before the page style');
    const own = rootTokens([...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]));
    for (const [k, v] of Object.entries(own)) assert.notEqual(base[k], v, f + ' repeats ' + k + ': ' + v);
    assert.doesNotMatch(html, /\*\{box-sizing:border-box;margin:0;padding:0;?\}/, f + ': base reset moved to css/base.css');
  }
});

test('R5: manifest (name, short name, theme #f97316, background #0f0f0f, start ./index.html, standalone) and icons 192/512 + maskable', () => {
  const m = JSON.parse(readText('manifest.webmanifest'));
  assert.ok(m.name && m.short_name && m.short_name.length <= 12);
  assert.equal(m.theme_color, '#f97316');
  assert.equal(m.background_color, '#0f0f0f');
  assert.equal(m.start_url, './index.html');
  assert.equal(m.display, 'standalone');
  const want = { 'any 192': 192, 'any 512': 512, 'maskable 192': 192, 'maskable 512': 512 };
  for (const i of m.icons) {
    const [w, h] = pngSize(i.src);
    assert.equal(i.sizes, w + 'x' + h, i.src);
    delete want[i.purpose + ' ' + w];
  }
  assert.deepEqual(want, {}, 'all four icons');
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  assert.ok(m.shortcuts.some(s => s.url === './index.html#emergency-only'));
  for (const [f, up] of Object.entries(PAGES)) {
    const html = readText(f);
    assert.ok(html.includes('<link rel="manifest" href="' + up + 'manifest.webmanifest">'), f + ' manifest');
    assert.ok(html.includes('<meta name="theme-color" content="#f97316">'), f + ' theme-color');
  }
  assert.match(readText('scripts/gen-icons.py'), /from PIL import Image/);
});

test('R4/R7: every page loads js/field.js in <head>, has a ☀ sunlight toggle and a version line; SW registration only in js/field.js', () => {
  for (const [f, up] of Object.entries(PAGES)) {
    const html = readText(f), head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes('<script src="' + up + 'js/field.js"></script>'), f + ' field.js in head');
    assert.match(html, /<button type="button" class="[^"]+" data-vf-sun aria-pressed="false" aria-label="Sunlight mode">/, f + ' toggle');
    assert.match(html, /data-vf-version/, f + ' version line');
    assert.ok(html.includes('src="' + up + 'js/version.js"'), f + ' VTOL_VERSION loaded');
    assert.doesNotMatch(html, /serviceWorker\.register/, f);
  }
  assert.match(readText('js/field.js'), /serviceWorker\.register\(BASE \+ 'sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.match(readText('js/field.js'), /NEW VERSION AVAILABLE —<\/span><button type="button" class="vf-reload">RELOAD<\/button>/);
});

test('R7: sunlight mode = token overrides in css/base.css (white on black, bigger text, thicker lines, inline SVG strokes)', () => {
  const css = readText('css/base.css');
  const sun = (css.match(/:root\[data-sun\]\{([^}]+)\}/) || [])[1] || '';
  for (const [k, v] of [['--bg', '#000'], ['--surface', '#000'], ['--text', '#fff'], ['--vf-zoom', '1.15']]) assert.match(sun, new RegExp(k + ':' + v + ';'), k);
  assert.match(css, /\.vf-zoom\{zoom:var\(--vf-zoom\);\}/);
  assert.match(css, /:root\[data-sun\] svg :is\(line,path,polyline,polygon,rect,circle,ellipse\)\[stroke\]:not\(\[stroke-width\]\)\{stroke-width:2;\}/);
  assert.match(css, /:root\[data-sun\] :is\(td,th\)\{border-bottom-width:2px;\}/);
  for (const f of ['index.html', 'manual.html', 'relay/map.html', 'tools/latency-clock.html']) assert.match(readText(f), /class="[^"]*\bvf-zoom\b/, f + ' marks its content for the text scale');
});

test('R8: print stylesheet linked (media=print) by the Tools page and the manual; kneeboard rules for checklists and emergency cards', () => {
  for (const [f, href] of [['index.html', 'css/print.css'], ['manual.html', 'css/print.css']]) assert.ok(readText(f).includes('<link rel="stylesheet" href="' + href + '" media="print">'), f);
  const p = readText('css/print.css');
  assert.match(p, /--text:var\(--ink\)/);
  assert.match(p, /:root\.vf-kb #tab-preflight, :root\.vf-kb #tab-turnaround \{ display:block !important; \}/);
  // WP14 R12c(b): a page break after the pre-flight list only — never after the last block (no footer-only page)
  assert.match(p, /:root\.vf-kb #tab-preflight \{ break-after:page; \}/);
  assert.doesNotMatch(p, /#tab-turnaround[^{]*\{[^}]*break-after:page/);
  assert.match(p, /:root\.vf-kb footer \{ break-before:avoid;/);
  // WP14 R12c(c): the comment says the emergency cards print first
  assert.match(p, /emergency cards from the \(closed\) modal: static, printed FIRST/);
  assert.doesNotMatch(p, /static, after the checklists/);
  assert.match(p, /:root\.vf-kb #emerg-modal \{ display:block !important; position:static !important;/);
  assert.match(p, /:root\.vf-kb \.emerg-card \{[^}]*break-inside:avoid/);
  assert.match(p, /\.emerg-cleanup \{ display:block !important;/);
  assert.match(p, /^nav, #nav, #emerg-fab,/m);
  assert.match(readText('index.html'), /data-vf-print-kb/);
});
