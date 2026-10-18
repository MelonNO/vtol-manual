'use strict';
// WP09 R4 / R6 / R7 / R10: js/field.js — version line (param file from the store), sunlight toggle + persistence,
// screen wake lock (feature-detected, held only while wanted and visible), QR code (vendored MIT library).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, readText } = require('../repo-files.js');
const F = require('../../js/field.js');
const qrcode = require('../../js/vendor/qrcode-generator/qrcode.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('R4: version line = app · content · param file (name + import date from store.paramFile, else TBD); escaped', () => {
  const V = { app: '2.0.0-dev', content: '2026-10-16', paramFile: 'TBD' };
  const pf = { name: 'carrier.param', importedAt: new Date(2026, 9, 14, 12, 30).toISOString(), params: {} };
  assert.deepEqual(F.paramFileText(pf, 'TBD'), { text: 'carrier.param 2026-10-14', tbd: false });
  assert.deepEqual(F.paramFileText(null, 'TBD'), { text: 'TBD', tbd: true });
  assert.deepEqual(F.paramFileText({ name: 'x.param', importedAt: 'not a date' }, 'TBD'), { text: 'TBD', tbd: true });
  assert.deepEqual(F.paramFileText(null, undefined), { text: 'TBD', tbd: true });
  assert.equal(F.versionLineHTML(V, null), 'APP 2.0.0-dev · CONTENT 2026-10-16 · PARAM FILE <span class="vf-tbd">TBD</span>');
  assert.equal(F.versionLineHTML(V, pf), 'APP 2.0.0-dev · CONTENT 2026-10-16 · PARAM FILE carrier.param 2026-10-14');
  const evil = F.versionLineHTML(V, { name: '<img src=x onerror=alert(1)>', importedAt: pf.importedAt });
  assert.doesNotMatch(evil, /<img/);
  assert.match(evil, /&lt;img src=x onerror=alert\(1\)&gt; 2026-10-14/);
});

// js/field.js in a vm with a minimal document / navigator / localStorage.
function loadField(opts) {
  opts = opts || {};
  const attrs = new Map(), store = new Map(Object.entries(opts.storage || {})), docListeners = {}, winListeners = {};
  const buttons = [{ attrs: new Map(), setAttribute(k, v) { this.attrs.set(k, String(v)); }, addEventListener(t, fn) { this.click = fn; } }];
  const versionEls = [{ innerHTML: '', classList: { add() {} } }];
  const wake = { requests: 0, releases: 0 };
  const document = {
    readyState: 'complete', visibilityState: 'visible', currentScript: { src: 'https://melonno.github.io/vtol-manual/js/field.js' },
    documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), hasAttribute: k => attrs.has(k), classList: { add() {}, remove() {} } },
    querySelectorAll: sel => (sel === '[data-vf-sun]' ? buttons : sel === '[data-vf-version]' ? versionEls : []),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }
  };
  const navigator = opts.noWake ? {} : {
    wakeLock: { request: () => { wake.requests++; const l = { released: false, listeners: [], addEventListener(t, fn) { this.listeners.push(fn); },
      release() { wake.releases++; this.released = true; this.listeners.forEach(f => f()); return Promise.resolve(); } }; wake.last = l; return Promise.resolve(l); } }
  };
  const window = {
    document, navigator, isSecureContext: false, VTOL_VERSION: { app: '2.0.0-dev', content: '2026-10-16', paramFile: 'TBD' },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); }, URL, console, setTimeout, setInterval, clearTimeout
  };
  window.self = window;
  const ctx = vm.createContext(Object.assign(window, { document, navigator, URL }));
  vm.runInContext(readText('js/field.js'), ctx, { filename: 'field.js' });
  const fire = (t, target) => ((target === 'win' ? winListeners : docListeners)[t] || []).forEach(fn => fn({ key: opts.eventKey }));
  return { F: ctx.VtolField, attrs, store, buttons, versionEls, wake, document, fire };
}

test('R7: sunlight toggle sets <html data-sun>, persists in localStorage and is applied at load (before render)', () => {
  const a = loadField();
  assert.equal(a.attrs.has('data-sun'), false);
  a.buttons[0].click();
  assert.equal(a.attrs.has('data-sun'), true);
  assert.equal(a.store.get('vtol_sunlight'), '1');
  assert.equal(a.buttons[0].attrs.get('aria-pressed'), 'true');
  a.buttons[0].click();
  assert.equal(a.attrs.has('data-sun'), false);
  assert.equal(a.store.has('vtol_sunlight'), false);
  const b = loadField({ storage: { vtol_sunlight: '1' } });
  assert.equal(b.attrs.has('data-sun'), true, 'persisted setting applied when the script loads');
});

test('R4: the version line reads store.paramFile without side effects', () => {
  const pf = { name: 'carrier.param', importedAt: new Date(2026, 9, 14, 9, 0).toISOString(), params: { BATT_LOW_VOLT: 0 } };
  const a = loadField({ storage: { vtol_store: JSON.stringify({ schemaVersion: 2, paramFile: pf }) } });
  assert.equal(a.versionEls[0].innerHTML, 'APP 2.0.0-dev · CONTENT 2026-10-16 · PARAM FILE carrier.param 2026-10-14');
  assert.equal(a.store.get('vtol_store'), JSON.stringify({ schemaVersion: 2, paramFile: pf }), 'store untouched');
  const b = loadField({ storage: { vtol_store: '{broken' } });
  assert.match(b.versionEls[0].innerHTML, /PARAM FILE <span class="vf-tbd">TBD<\/span>/);
});

test('R6: wake lock requested while wanted, released when not, re-taken when the page is visible again; no API → no error', async () => {
  const a = loadField();
  a.F.setWake(true); await sleep(1);
  assert.equal(a.wake.requests, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.F.wakeState())), { supported: true, want: true, held: true });
  a.F.setWake(true); await sleep(1);
  assert.equal(a.wake.requests, 1, 'not requested twice');
  // the browser releases the lock when the page is hidden; visible again → requested again
  a.wake.last.release(); a.document.visibilityState = 'hidden'; a.fire('visibilitychange'); await sleep(1);
  assert.equal(a.wake.requests, 1);
  a.document.visibilityState = 'visible'; a.fire('visibilitychange'); await sleep(1);
  assert.equal(a.wake.requests, 2);
  a.F.setWake(false); await sleep(1);
  assert.equal(a.wake.releases, 2);
  assert.equal(a.F.wakeState().held, false);
  // released while the request is still pending
  a.F.setWake(true); a.F.setWake(false); await sleep(1);
  assert.equal(a.F.wakeState().held, false);
  const b = loadField({ noWake: true });
  b.F.setWake(true);
  assert.deepEqual(JSON.parse(JSON.stringify(b.F.wakeState())), { supported: false, want: true, held: false });
});

test('R6: the Tools page asks for the wake lock on the checklist tabs, challenge–response, the emergency modal and emergency-only mode', () => {
  const html = readText('index.html');
  assert.match(html, /const WAKE_TABS = \['preflight', 'turnaround', 'postflight'\];/);
  assert.match(html, /VtolField\.setWake\(WAKE_TABS\.includes\(name\) \|\| emergIsOpen\(\) \|\| !!cr \|\| document\.documentElement\.classList\.contains\('vf-eo'\)\);/);
  for (const fn of ['function switchTab', 'function openEmerg', 'function closeEmerg', 'function crOpen', 'function crClose']) {
    const body = html.slice(html.indexOf(fn), html.indexOf('\n}', html.indexOf(fn)) + 2);
    assert.match(body, /wakeSync\(\)/, fn);
  }
});

test('R10: QR code of the live site — vendored qrcode-generator (MIT, licence file), SVG with tokens only, modules match the library', () => {
  assert.match(readText('js/vendor/qrcode-generator/LICENSE'), /^MIT License[\s\S]*Kazuhiko Arase[\s\S]*Permission is hereby granted, free of charge/);
  assert.match(readText('js/vendor/qrcode-generator/qrcode.js'), /Licensed under the MIT license/);
  assert.equal(F.SITE_URL, 'https://melonno.github.io/vtol-manual/');
  const svg = F.qrSvg(F.SITE_URL);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1" role="img"/);
  assert.match(svg, /<title>QR code: https:\/\/melonno\.github\.io\/vtol-manual\/<\/title>/);
  assert.match(svg, /fill="var\(--paper\)"/); assert.match(svg, /fill="var\(--ink\)"/);
  assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b/i, 'no hex colours');
  // rebuild the module matrix from the path and compare with the library
  const qr = qrcode(0, 'M'); qr.addData(F.SITE_URL); qr.make();
  const n = qr.getModuleCount(), dark = new Set();
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) for (let i = 0; i < +m[3]; i++) dark.add((+m[2] - 4) + ',' + (+m[1] - 4 + i));
  let mismatch = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c) !== dark.has(r + ',' + c)) mismatch++;
  assert.equal(mismatch, 0);
  assert.equal(+svg.match(/viewBox="0 0 (\d+)/)[1], n + 8, '4-module quiet zone');
  // the Tools footer menu
  const html = readText('index.html');
  assert.match(html, /<details class="vf-share" data-vf-share>\s*<summary>SHARE \/ KNEEBOARD<\/summary>/);
  assert.ok(html.indexOf('<details class="vf-share"') > html.indexOf('<footer'), 'inside the footer');
  assert.ok(html.indexOf('<footer') > 0);
  assert.ok(html.includes('<script src="js/vendor/qrcode-generator/qrcode.js"></script>'));
});
