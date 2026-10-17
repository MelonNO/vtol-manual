'use strict';
// WP09 R3/R11 helper: runs sw.js in a Node vm with a fake service-worker global (CacheStorage, fetch, events).
// fetch reads the repository files (online) or rejects (offline); importScripts loads repo files into the same context.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('../repo-files.js');

const ORIGIN = 'https://melonno.github.io';
const SCOPE = ORIGIN + '/vtol-manual/';
const SW_URL = SCOPE + 'sw.js';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

// Repo-relative path of a same-origin URL inside the scope ('' → index.html), or null.
function repoPath(url) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !u.pathname.startsWith('/vtol-manual/')) return null;
  const rel = decodeURIComponent(u.pathname.slice('/vtol-manual/'.length));
  return rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel;
}

function basic(res) { Object.defineProperty(res, 'type', { value: 'basic' }); return res; }

function makeEnv(opts) {
  opts = opts || {};
  const listeners = {};
  const caches = new Map();
  const log = { fetched: [], skipWaiting: 0, claimed: 0 };
  const env = { online: opts.online !== false, hang: false, overrides: {} };   // overrides: { repoPath: body }

  class Req extends Request {
    constructor(input, init) { super(typeof input === 'string' ? new URL(input, SW_URL).href : input, init); }
  }
  const keyOf = r => (typeof r === 'string' ? new URL(r, SW_URL).href : r.url);
  class FakeCache {
    constructor() { this.m = new Map(); }
    match(r, o) {
      const k = keyOf(r), strip = s => s.split('?')[0];
      let hit = this.m.get(k);
      if (!hit && o && o.ignoreSearch) for (const [kk, v] of this.m) if (strip(kk) === strip(k)) { hit = v; break; }
      return Promise.resolve(hit ? hit.clone() : undefined);
    }
    put(r, res) { this.m.set(keyOf(r), res.clone()); return Promise.resolve(); }
    addAll(list) {
      return Promise.all(list.map(r => sandbox.fetch(r).then(res => { if (!res.ok) throw new TypeError('addAll: ' + res.status + ' ' + keyOf(r)); this.m.set(keyOf(r), res); })));
    }
    keys() { return Promise.resolve([...this.m.keys()].map(k => new Request(k))); }
  }
  const cacheStorage = {
    open: n => { if (!caches.has(n)) caches.set(n, new FakeCache()); return Promise.resolve(caches.get(n)); },
    keys: () => Promise.resolve([...caches.keys()]),
    delete: n => Promise.resolve(caches.delete(n)),
    match: r => Promise.resolve(undefined)
  };
  function fakeFetch(r) {
    const url = keyOf(r);
    log.fetched.push(url);
    if (env.hang) return new Promise(() => {});
    if (!env.online) return Promise.reject(new TypeError('Failed to fetch (offline)'));
    const rel = repoPath(url);
    if (rel === null) return Promise.resolve(new Response('cross-origin', { status: 200 }));
    if (Object.prototype.hasOwnProperty.call(env.overrides, rel)) {   // a string body, or { status, body }
      const o = env.overrides[rel], obj = o && typeof o === 'object';
      return Promise.resolve(basic(new Response(obj ? o.body : o, { status: obj ? o.status : 200 })));
    }
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return Promise.resolve(basic(new Response('not found', { status: 404 })));
    return Promise.resolve(basic(new Response(fs.readFileSync(f), { status: 200, headers: { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' } })));
  }
  const sandbox = {
    console, URL, Request: Req, Response, Headers, Promise, TypeError, Error,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 50)), clearTimeout,   // 4 s network timeout → 50 ms in the test
    caches: cacheStorage,
    fetch: fakeFetch,
    location: new URL(SW_URL),
    clients: { claim: () => { log.claimed++; return Promise.resolve(); } },
    skipWaiting: () => { log.skipWaiting++; return Promise.resolve(); },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    importScripts: (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, new URL(f, SW_URL).pathname.slice('/vtol-manual/'.length)), 'utf8'), ctx))
  };
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), ctx, { filename: 'sw.js' });

  // Dispatch a lifecycle event; resolves when every waitUntil promise has settled.
  async function lifecycle(type, data) {
    const waits = [];
    const ev = { data, waitUntil: p => waits.push(p) };
    (listeners[type] || []).forEach(fn => fn(ev));
    await Promise.all(waits);
  }
  // Dispatch a fetch; resolves to { handled, response, waits }.
  async function request(url, init) {
    let responded = null;
    const waits = [];
    const ev = { request: new Req(url, init), respondWith: p => { responded = Promise.resolve(p); }, waitUntil: p => waits.push(p) };
    (listeners.fetch || []).forEach(fn => fn(ev));
    if (!responded) return { handled: false, response: null, waits };
    return { handled: true, response: await responded, waits };
  }
  return { env, log, caches, sandbox, lifecycle, request, ctx, SCOPE };
}

module.exports = { makeEnv, repoPath, ORIGIN, SCOPE, SW_URL };
