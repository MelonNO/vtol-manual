'use strict';
// Shared helpers for the manual tests: the page source and its pure navigation module (script#manual-core).
const { ROOT, readText } = require('../repo-files.js');

const HTML = readText('manual.html');   // LF, whatever the checkout's line endings

// ManualCore is an inline UMD block in manual.html, so it can be tested without a browser.
function loadManualCore() {
  const m = HTML.match(/<script id="manual-core">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('script#manual-core not found in manual.html');
  // Same realm as the tests (vm contexts would give objects another prototype chain).
  const mod = { exports: {} };
  new Function('module', 'exports', 'self', m[1])(mod, mod.exports, undefined);
  return mod.exports;
}

// The optional "History: previous relay (removed)" note is the only place old-relay terms may appear.
function withoutHistoryNote(html) {
  return html.replace(/<section id="history-previous-relay"[\s\S]*?<\/section>/g, '');
}

module.exports = { ROOT, HTML, loadManualCore, withoutHistoryNote };
