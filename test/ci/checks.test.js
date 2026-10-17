'use strict';
// WP10 R1: the CI checks in scripts/check-*.mjs pass on the repository, and each one really detects what it is for
// (checked on small throw-away fixture trees, so a check that silently passes everything fails here).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ROOT } = require('../repo-files.js');

const load = name => import(pathToFileURL(path.join(ROOT, 'scripts', name)).href);

// A temporary tree outside any git repository (the checks then walk the directory).
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-check-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('check-links: the repository has no broken internal link or asset', async () => {
  const { checkLinks } = await load('check-links.mjs');
  assert.deepEqual(checkLinks(), []);
});

test('check-links: detects a missing asset, a bad fragment and a broken Markdown link; accepts tab and hash routes', async () => {
  const { checkLinks } = await load('check-links.mjs');
  const dir = fixture({
    'index.html': '<a href="manual.html#emergency">ok tab</a><a href="manual.html#comms/net">ok tab/anchor</a>'
      + '<a href="#emergency-only">route</a><img src="img/missing.png"><a href="manual.html#nowhere">bad</a>'
      + '<svg><use href="#sym-x"/></svg><script src="js/app.js"></script>',
    'manual.html': '<div id="tab-emergency"></div><div id="net"></div>',
    'js/app.js': "const HASH = '#emergency-only';",
    'README.md': 'See [the manual](manual.html), [the plan](docs/missing.md) and `[code](nope.md)`.\n```\n[fenced](nope.md)\n```\n'
  });
  try {
    const p = checkLinks(dir).join('\n');
    assert.match(p, /index\.html: "img\/missing\.png" → img\/missing\.png does not exist/);
    assert.match(p, /index\.html: "manual\.html#nowhere" → no id or route "nowhere"/);
    assert.match(p, /index\.html: "#sym-x" → no id or route "sym-x"/);
    assert.match(p, /README\.md: link "docs\/missing\.md"/);
    assert.doesNotMatch(p, /#emergency"|comms\/net|emergency-only|nope\.md|README\.md: link "manual\.html"/);
    assert.equal(p.split('\n').length, 4, p);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check-images: the repository is within budget; an oversize photo or diagram is reported', async () => {
  const { checkImages, RASTER_MAX, SVG_MAX } = await load('check-images.mjs');
  assert.deepEqual(checkImages(), []);
  assert.equal(RASTER_MAX, 250 * 1024);
  assert.equal(SVG_MAX, 60 * 1024);
  const dir = fixture({
    'img/big.jpg': Buffer.alloc(RASTER_MAX + 1), 'img/ok.webp': Buffer.alloc(RASTER_MAX),
    'img/diagrams/d99.svg': '<svg>' + ' '.repeat(SVG_MAX) + '</svg>', 'img/small.svg': '<svg/>'
  });
  try {
    const p = checkImages(dir);
    assert.equal(p.length, 2, p.join('\n'));
    assert.match(p[0], /^img\/big\.jpg: 250\.0 KiB > 250 KiB budget$/);
    assert.match(p[1], /^img\/diagrams\/d99\.svg: .* > 60 KiB budget$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check-colours: no hex colour in inline SVG or inline styles; standalone SVG files are exempt', async () => {
  const { checkColours } = await load('check-colours.mjs');
  assert.deepEqual(checkColours(), []);
  const dir = fixture({
    'index.html': '<svg viewBox="0 0 10 10"><rect fill="var(--accent)"/><circle fill="#f97316"/><use href="#abc"/>'
      + '<path style="stroke:url(#grad)"/></svg><div style="color:#fff">x</div><p>#123 is not markup</p>',
    'js/chart.js': "const s = '<line x1=\"0\" stroke=\"#ef4444\"/>' + '<text fill=\"var(--muted)\">#ace</text>';",
    'img/diagrams/d01.svg': '<svg><rect fill="#0f0f0f"/></svg>',
    'archive/old.html': '<svg><rect fill="#000"/></svg>'
  });
  try {
    const p = checkColours(dir);
    assert.equal(p.length, 3, p.join('\n'));
    assert.match(p.join('\n'), /index\.html:1: hex colour #f97316 in SVG <circle>/);
    assert.match(p.join('\n'), /index\.html:1: hex colour #fff in an inline style/);
    assert.match(p.join('\n'), /js\/chart\.js:1: hex colour #ef4444 in SVG <line>/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
