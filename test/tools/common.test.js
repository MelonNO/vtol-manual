'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../js/common.js');
const V = require('../../js/version.js');

test('escH escapes HTML text and attribute metacharacters', () => {
  assert.equal(C.escH('<img src=x onerror="alert(1)">&\''), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  assert.equal(C.escH(null), '');
  assert.equal(C.escH(undefined), '');
  assert.equal(C.escH(22.5), '22.5');
});

test('fmtTime gives local HH:MM (optionally with date), empty for invalid input', () => {
  const d = new Date(2025, 4, 7, 9, 5);
  assert.equal(C.fmtTime(d), '09:05');
  assert.equal(C.fmtTime(d.getTime()), '09:05');
  assert.equal(C.fmtTime(d.toISOString()), '09:05');
  assert.equal(C.fmtTime(d, { date: true }), '07 May 09:05');
  assert.equal(C.fmtTime('garbage'), '');
  assert.equal(C.fmtTime(null), '');
});

test('fmtDuration formats MM:SS', () => {
  assert.equal(C.fmtDuration(0), '00:00');
  assert.equal(C.fmtDuration(65_400), '01:05');
  assert.equal(C.fmtDuration(125 * 60_000), '125:00');
});

test('copyToClipboard resolves true via the Clipboard API, false when it and the fallback fail', async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    let written = null;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: t => { written = t; return Promise.resolve(); } } } });
    assert.equal(await C.copyToClipboard('abc'), true);
    assert.equal(written, 'abc');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } } });
    assert.equal(await C.copyToClipboard('abc'), false);   // no document in Node → fallback fails too, but never rejects
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc); else delete globalThis.navigator;
  }
});

test('toggleCleanup toggles the next sibling and the button label', () => {
  const sib = { cls: new Set(), classList: null };
  sib.classList = { toggle: c => (sib.cls.has(c) ? (sib.cls.delete(c), false) : (sib.cls.add(c), true)) };
  const btn = { nextElementSibling: sib, attrs: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, textContent: '' };
  C.toggleCleanup(btn);
  assert.ok(sib.cls.has('visible'));
  assert.match(btn.textContent, /^▼/);
  assert.equal(btn.attrs['aria-expanded'], 'true');
  C.toggleCleanup(btn);
  assert.match(btn.textContent, /^▶/);
});

test('VTOL_VERSION has app, content date and paramFile', () => {
  assert.equal(V.app, '2.0.0');
  assert.match(V.content, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(V.paramFile, '2026-10-17 (reference)');   // WP14 rework F5: the reference param file the content was checked against
});
