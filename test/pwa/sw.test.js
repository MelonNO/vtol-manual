'use strict';
// WP09 R3 / R11: sw.js simulated in a Node vm (test/pwa/sw-sim.js): install precaches the list into a version-stamped
// cache, activation deletes old caches, every page and referenced asset loads OFFLINE from the cache, HTML and page code
// are network-first (with a timeout), other assets stale-while-revalidate, the GCS API / Open-Meteo / Nominatim are
// never intercepted or cached, and SKIP_WAITING activates a waiting worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readText } = require('../repo-files.js');
const { makeEnv, SCOPE } = require('./sw-sim.js');
const { allRefs } = require('./assets.js');
const VTOL_VERSION = require('../../js/version.js');

function precache() { const s = {}; new Function('self', readText('sw-precache.js'))(s); return s.VTOL_PRECACHE; }
const PC = precache();
const CACHE = 'vtol-manual-' + VTOL_VERSION.app + '-' + PC.hash;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function installed() {
  const sw = makeEnv();
  await sw.lifecycle('install');
  return sw;
}

test('install: precaches every listed asset into vtol-manual-<app version>-<content hash>; no skipWaiting (the page decides)', async () => {
  const sw = await installed();
  assert.deepEqual([...sw.caches.keys()], [CACHE]);
  const keys = [...sw.caches.get(CACHE).m.keys()];
  assert.equal(keys.length, PC.assets.length);
  for (const a of PC.assets) assert.ok(keys.includes(new URL(a, SCOPE).href), a);
  assert.equal(sw.log.skipWaiting, 0);
  assert.doesNotMatch(readText('sw.js'), /const ASSETS = \[/, 'no hand-written list in sw.js');
});

test('activate: deletes older vtol-manual-* caches (incl. the old v12 name), keeps other caches, claims the clients', async () => {
  const sw = await installed();
  await sw.sandbox.caches.open('vtol-manual-v12');
  await sw.sandbox.caches.open('vtol-manual-2.0.0-dev-0000000000000000');
  await sw.sandbox.caches.open('some-other-app');
  await sw.lifecycle('activate');
  assert.deepEqual([...sw.caches.keys()].sort(), [CACHE, 'some-other-app'].sort());
  assert.equal(sw.log.claimed, 1);
});

test('message SKIP_WAITING → skipWaiting() (the RELOAD button of the update toast)', async () => {
  const sw = await installed();
  await sw.lifecycle('message', { type: 'other' });
  assert.equal(sw.log.skipWaiting, 0);
  await sw.lifecycle('message', { type: 'SKIP_WAITING' });
  assert.equal(sw.log.skipWaiting, 1);
});

test('R11 OFFLINE: every page and every asset the pages reference is served from the cache', async () => {
  const sw = await installed();
  await sw.lifecycle('activate');
  sw.env.online = false;
  const urls = new Set(PC.assets.map(a => new URL(a, SCOPE).href));
  for (const r of allRefs(PC.assets)) if (fs.existsSync(path.join(ROOT, r.path)) && !/sw\.js$/.test(r.path)) {
    const webp = r.path.replace(/\.(jpe?g|png)$/, '.webp');
    urls.add(new URL(r.picture && PC.assets.includes('./' + webp) ? webp : r.path, SCOPE).href);
  }
  urls.add(SCOPE + 'index.html?utm=x');                    // query strings fall back to the cached page
  for (const u of urls) {
    const { handled, response } = await sw.request(u);
    assert.ok(handled, 'handled: ' + u);
    assert.equal(response.status, 200, 'offline 200: ' + u);
  }
  const page = await (await sw.request(SCOPE + 'manual.html')).response.text();
  assert.equal(page.replace(/\r\n/g, '\n'), readText('manual.html'), 'the cached manual is the repository file');
  const miss = await sw.request(SCOPE + 'docs/not-a-page.html');
  assert.equal(miss.response.status, 503, 'uncached page offline → 503 offline page');
  assert.match(await miss.response.text(), /OFFLINE/);
});

test('network-first for pages and page code: online answers come from the network and refresh the cache', async () => {
  const sw = await installed();
  sw.env.overrides['index.html'] = 'NEW INDEX';
  sw.env.overrides['js/tools-core.js'] = 'NEW CODE';
  assert.equal(await (await sw.request(SCOPE + 'index.html')).response.text(), 'NEW INDEX');
  assert.equal(await (await sw.request(SCOPE + 'js/tools-core.js')).response.text(), 'NEW CODE');
  await sleep(5);
  sw.env.online = false;
  assert.equal(await (await sw.request(SCOPE + 'index.html')).response.text(), 'NEW INDEX', 'cache refreshed by the network answer');
  // a weak signal: the network never answers → the cached copy after the timeout
  sw.env.online = true; sw.env.hang = true;
  assert.equal(await (await sw.request(SCOPE + 'js/tools-core.js')).response.text(), 'NEW CODE');
  // a server error (e.g. a 404 during a deploy) keeps the cached copy
  sw.env.hang = false; sw.env.overrides['manual.html'] = { status: 500, body: 'server error' };
  const r = (await sw.request(SCOPE + 'manual.html')).response;
  assert.equal(r.status, 200);
  assert.equal((await r.text()).replace(/\r\n/g, '\n'), readText('manual.html'));
});

test('stale-while-revalidate for other assets: the cached copy at once, the network copy for the next load', async () => {
  const sw = await installed();
  const u = SCOPE + 'img/diagrams/d01-system-overview.svg';
  sw.env.overrides['img/diagrams/d01-system-overview.svg'] = '<svg>new</svg>';
  const first = await sw.request(u);
  assert.equal(await first.response.text(), readText('img/diagrams/d01-system-overview.svg'), 'stale copy first');
  await Promise.all(first.waits);
  await sleep(5);
  assert.equal(await (await sw.request(u)).response.text(), '<svg>new</svg>', 'revalidated copy next time');
});

test('never intercepted or cached: the GCS app API (127.0.0.1:47800), Open-Meteo, Nominatim, map tiles; non-GET requests', async () => {
  const sw = await installed();
  for (const u of ['http://127.0.0.1:47800/api/v1/status', 'http://127.0.0.1:47800/api/v1/events', 'https://api.open-meteo.com/v1/forecast?latitude=60&longitude=10',
    'https://nominatim.openstreetmap.org/reverse?lat=60&lon=10', 'https://a.tile.openstreetmap.org/2/1/1.png', 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/1/1.png']) {
    const r = await sw.request(u);
    assert.equal(r.handled, false, u);
  }
  assert.equal((await sw.request(SCOPE + 'index.html', { method: 'POST', body: 'x' })).handled, false, 'POST');
  for (const c of sw.caches.values()) for (const k of c.m.keys()) assert.ok(k.startsWith(SCOPE), 'only same-origin entries: ' + k);
});

test('sw.js loads the version and the generated list with importScripts; cache name from VTOL_VERSION.app', () => {
  const s = readText('sw.js');
  assert.match(s, /importScripts\('\.\/js\/version\.js', '\.\/sw-precache\.js'\)/);
  assert.match(s, /CACHE_PREFIX \+ self\.VTOL_VERSION\.app \+ '-' \+ self\.VTOL_PRECACHE\.hash/);
  assert.match(s, /127\\\.0\\\.0\\\.1:47800/);
  assert.match(s, /open-meteo/);
  assert.match(s, /nominatim/);
});
