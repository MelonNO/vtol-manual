/* js/gcs-client.js — client for the GCS companion app's local, read-only API (contract C2).
 *
 *   GcsClient.start({ onStatus(s), onAlarm(a), onConnection(bool) }); GcsClient.stop(); GcsClient.BASE
 *
 * - While disconnected: polls /api/v1/health with exponential backoff (0.5 s doubling, capped at 3 s).
 * - When connected: Server-Sent Events from /api/v1/events ('status' ≈ 5 Hz, 'alarm');
 *   if SSE is unavailable or fails, polls /api/v1/status at 2 Hz.
 * - Never throws and never logs: an absent app just reads as "not connected". No unhandled promise rejections:
 *   every async step is started through run(), which swallows a rejection (WP14 R12b).
 * Used by relay/map.html (live layer) and the Tools page "Link" tab.
 * The optional second argument of start() injects { fetch, EventSource, setTimeout, clearTimeout,
 * document } for tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GcsClient = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const BASE = 'http://127.0.0.1:47800';
const HEALTH_MIN_MS = 500, HEALTH_MAX_MS = 3000, POLL_MS = 500, TIMEOUT_MS = 2000;

let session = null;

function Session(h, env) {
  this.h = h || {};
  this.fetch = env.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
  this.ES = 'EventSource' in env ? env.EventSource : (root.EventSource || null);
  // Called as plain functions, never as methods of this object: a browser's window.setTimeout called with
  // another `this` throws "Illegal invocation" (the cause of the WP09 "Uncaught (in promise)" console noise).
  const st = env.setTimeout || root.setTimeout || setTimeout, ct = env.clearTimeout || root.clearTimeout || clearTimeout;
  this.setT = (fn, ms) => st(fn, ms);
  this.clrT = id => ct(id);
  this.doc = 'document' in env ? env.document : (root.document || null);
  this.alive = true; this.connected = false; this.delay = HEALTH_MIN_MS;
  this.timer = null; this.es = null; this.delays = [];   // delays: backoff history (tests)
}

Session.prototype.call = function (name, arg) {
  try { if (typeof this.h[name] === 'function') this.h[name](arg); } catch (_) { /* consumer bug: ignore */ }
};

// Start a (possibly async) step; a rejection or throw is swallowed, so nothing ever reaches the console.
Session.prototype.run = function (fn) {
  try {
    const r = fn.call(this);
    if (r && typeof r.then === 'function') r.then(null, () => { /* app absent / consumer bug: ignore */ });
  } catch (_) { /* ignore */ }
};

Session.prototype.schedule = function (fn, ms) {
  if (!this.alive) return;
  this.clrT(this.timer);
  this.timer = this.setT(() => { this.timer = null; if (this.alive) this.run(fn); }, ms);
};

Session.prototype.getJSON = async function (path) {
  if (!this.fetch) return null;
  let ctl = null, t = null;
  try {
    if (typeof AbortController === 'function') {
      ctl = new AbortController();
      t = this.setT(() => ctl.abort(), TIMEOUT_MS);
    }
    const r = await this.fetch(BASE + path, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  } finally { if (t !== null) this.clrT(t); }
};

Session.prototype.setConnected = function (on) {
  if (this.connected === on) return;
  this.connected = on;
  this.call('onConnection', on);
};

Session.prototype.health = async function () {
  if (this.doc && this.doc.hidden) { this.schedule(this.health, HEALTH_MAX_MS); return; }
  const j = await this.getJSON('/api/v1/health');
  if (!this.alive) return;
  if (j && j.ok === true) {
    this.delay = HEALTH_MIN_MS;
    this.setConnected(true);
    this.openStream();
  } else {
    this.delays.push(this.delay);
    this.schedule(this.health, this.delay);
    this.delay = Math.min(this.delay * 2, HEALTH_MAX_MS);
  }
};

Session.prototype.openStream = function () {
  if (!this.ES) { this.run(this.poll); return; }
  let es;
  try { es = new this.ES(BASE + '/api/v1/events'); } catch (_) { this.run(this.poll); return; }
  this.es = es;
  const parse = (e, cb) => { try { this.call(cb, JSON.parse(e.data)); } catch (_) { /* bad frame */ } };
  es.addEventListener('status', e => parse(e, 'onStatus'));
  es.addEventListener('alarm', e => parse(e, 'onAlarm'));
  es.onerror = () => {               // fall back to polling /status (C2)
    this.closeStream();
    if (this.alive) this.run(this.poll);
  };
};

Session.prototype.closeStream = function () {
  if (this.es) { try { this.es.close(); } catch (_) { /* ignore */ } this.es = null; }
};

Session.prototype.poll = async function () {
  const s = await this.getJSON('/api/v1/status');
  if (!this.alive) return;
  if (s) { this.call('onStatus', s); this.schedule(this.poll, POLL_MS); }
  else { this.setConnected(false); this.delay = HEALTH_MIN_MS; this.schedule(this.health, HEALTH_MIN_MS); }   // never a tight loop when /status keeps failing
};

Session.prototype.end = function () {
  this.alive = false;
  this.clrT(this.timer); this.timer = null;
  this.closeStream();
};

function start(handlers, env) {
  stop();
  session = new Session(handlers, env || {});
  session.call('onConnection', false);
  session.run(session.health);
  return session;
}

function stop() {
  if (session) { session.end(); session = null; }
}

function isConnected() { return !!(session && session.connected); }

return { BASE, start, stop, isConnected, HEALTH_MIN_MS, HEALTH_MAX_MS, POLL_MS };
});
