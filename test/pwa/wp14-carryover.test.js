'use strict';
// WP14 R12b / R12c: carry-overs from the WP09 verification (docs/tasks/reports/WP09-VERIFY-round1.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { htmlRefsFromText } = require('./assets.js');

test('R12b: GcsClient with the app absent (rejecting fetch, browser-strict timers) — no unhandled rejection, keeps polling', async () => {
  const GcsClient = require('../../js/gcs-client.js');
  const unhandled = [];
  const onUnhandled = r => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  // Browser semantics: window.setTimeout / clearTimeout throw "Illegal invocation" when called as a method of another object.
  const timers = new Set();
  const strictSet = function (fn, ms) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); const id = setTimeout(fn, Math.min(ms, 5)); timers.add(id); return id; };
  const strictClear = function (id) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); clearTimeout(id); timers.delete(id); };
  let calls = 0;
  const fetch = () => { calls++; return Promise.reject(new TypeError('Failed to fetch')); };
  const conn = [];
  try {
    GcsClient.start({ onConnection: c => conn.push(c), onStatus: () => { throw new Error('consumer bug'); } }, { fetch, EventSource: null, setTimeout: strictSet, clearTimeout: strictClear, document: null });
    await new Promise(r => setTimeout(r, 120));
    await new Promise(r => setImmediate(r));
    assert.ok(calls >= 3, 'health polled repeatedly (' + calls + ')');
    assert.deepEqual(conn, [false], 'reads as "not connected", never connects');
    assert.equal(GcsClient.isConnected(), false);
  } finally {
    GcsClient.stop();
    for (const id of timers) clearTimeout(id);
    await new Promise(r => setTimeout(r, 10));
    process.removeListener('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled.map(String), [], 'no unhandled promise rejection');
});

test('R12b: an async step that rejects is swallowed by the session (no rejection escapes)', async () => {
  const GcsClient = require('../../js/gcs-client.js');
  const unhandled = [];
  const onUnhandled = r => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  try {
    // health → connected → stream: EventSource constructor throws → poll; /status fetch throws synchronously
    let n = 0;
    const fetch = url => { n++; if (/health/.test(url)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); throw new Error('sync throw'); };
    const s = GcsClient.start({}, { fetch, EventSource: function () { throw new Error('no SSE'); }, document: null });
    await new Promise(r => setTimeout(r, 30));
    assert.ok(n >= 2);
    s.end();
  } finally { GcsClient.stop(); await new Promise(r => setTimeout(r, 10)); process.removeListener('unhandledRejection', onUnhandled); }
  assert.deepEqual(unhandled.map(String), []);
});

test('R12c(a): the map header keeps its phone height — the three header buttons stack in one column at ≤ 600 px', () => {
  const m = readText('relay/map.html');
  const media = m.match(/@media \(max-width:600px\)\{\.hdr-title\{[\s\S]*?\n\s*button\.nav-btn\{[^}]*\}\}/);
  assert.ok(media, 'phone media rule');
  assert.match(media[0], /\.nav-btns\{flex-direction:column\}/);
  assert.match(media[0], /\.nav-btn\{min-height:44px;/);
  // measured in Edge at 360×640 (report): header 218 → 134 px, map 422 → 506 px (pre-WP09: 162 / 478)
});

test('R12c(d): the asset scanner flags a plain <img> jpg even when a <picture> on the same page uses that jpg', () => {
  const html = '<picture><source srcset="img/x.webp" type="image/webp"><img src="img/x.jpg"></picture>\n<p>text</p><img src="img/x.jpg">';
  const refs = htmlRefsFromText('index.html', html).filter(r => r.path === 'img/x.jpg');
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(r => r.picture), [true, false], 'only the <img> inside the <picture> is a fallback');
  // an <img> in a picture WITHOUT a webp source is not a fallback either
  assert.deepEqual(htmlRefsFromText('index.html', '<picture><img src="img/y.jpg"></picture>').map(r => r.picture), [false]);
});
