/* js/field.js — field-use features shared by every page (plan §5.5 SW-04, §10.2 F-3/F-4/F-5/F-6/F-8; WP09).
 * Global VtolField in the browser, module.exports in Node (pure helpers are unit-tested).
 * Loaded in <head> (before the page renders) so the sunlight mode applies without a flash; the rest starts on
 * DOMContentLoaded:
 *   - service worker registration + "New version available — RELOAD" toast when a new worker is waiting;
 *   - version line in every [data-vf-version] element: app · content · param file (store.paramFile if imported);
 *   - sunlight / high-contrast toggle on every [data-vf-sun] button (persisted in localStorage 'vtol_sunlight');
 *   - screen wake lock (feature-detected) for the pages that ask for it (setWake);
 *   - "Share / kneeboard" menus ([data-vf-share]): QR code of the live site and PRINT KNEEBOARD.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolField = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const SITE_URL = 'https://melonno.github.io/vtol-manual/';   // the live suite (README.md)
  const SUN_KEY = 'vtol_sunlight';
  const STORE_KEY = 'vtol_store';                                // contract C1 (read only here)
  const doc = typeof document !== 'undefined' ? document : null;
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  // Site root = the folder above js/ (the same for index.html, relay/map.html and tools/*.html).
  const SCRIPT_SRC = doc && doc.currentScript && doc.currentScript.src ? doc.currentScript.src : null;
  const BASE = SCRIPT_SRC ? new URL('..', SCRIPT_SRC).href : null;

  function escH(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  const pad2 = n => String(n).padStart(2, '0');

  // ══════════ SUNLIGHT / HIGH-CONTRAST MODE (F-5) — <html data-sun>, tokens in css/base.css ══════════
  function sunOn() { return lsGet(SUN_KEY) === '1'; }
  function applySun(on) {
    if (!doc) return;
    if (on) doc.documentElement.setAttribute('data-sun', ''); else doc.documentElement.removeAttribute('data-sun');
    doc.querySelectorAll('[data-vf-sun]').forEach(b => {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = on ? 'Sunlight mode on — tap for the normal dark style' : 'Sunlight mode: white on black, larger text, thicker lines';
    });
  }
  function setSun(on) { lsSet(SUN_KEY, on ? '1' : null); applySun(!!on); }
  function toggleSun() { setSun(!(doc && doc.documentElement.hasAttribute('data-sun'))); }
  applySun(sunOn());   // at load, before the first paint

  // ══════════ VERSION LINE (F-3): VTOL_VERSION app / content + the imported param file ══════════
  // Local date YYYY-MM-DD of an ISO time, or null.
  function isoDate(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const d = new Date(t);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // { text, tbd }: "<name> <date>" from store.paramFile (contract C1.5), else the VTOL_VERSION.paramFile fallback.
  function paramFileText(pf, fallback) {
    const date = pf && typeof pf === 'object' && pf.name ? isoDate(pf.importedAt) : null;
    if (date) return { text: String(pf.name) + ' ' + date, tbd: false };
    const fb = fallback === undefined || fallback === null || fallback === '' ? 'TBD' : String(fallback);
    return { text: fb, tbd: fb === 'TBD' };
  }
  // The store's paramFile, read without side effects (no migration, no save), or null.
  function readParamFile() {
    try { const s = JSON.parse(lsGet(STORE_KEY)); return s && s.paramFile && typeof s.paramFile === 'object' ? s.paramFile : null; } catch (e) { return null; }
  }
  function versionParts(V, pf) {
    V = V || {};
    const p = paramFileText(pf, V.paramFile);
    const val = v => (v === undefined || v === null || v === '' ? 'TBD' : String(v));
    return [
      { k: 'APP', v: val(V.app), tbd: !V.app },
      { k: 'CONTENT', v: val(V.content), tbd: !V.content },
      { k: 'PARAM FILE', v: p.text, tbd: p.tbd }
    ];
  }
  function versionLineHTML(V, pf) {
    return versionParts(V, pf).map(x => escH(x.k) + ' ' + (x.tbd ? '<span class="vf-tbd">' + escH(x.v) + '</span>' : escH(x.v))).join(' · ');
  }
  function renderVersion() {
    if (!doc) return;
    const html = versionLineHTML(root.VTOL_VERSION, readParamFile());
    doc.querySelectorAll('[data-vf-version]').forEach(el => { el.classList.add('vf-ver'); el.innerHTML = html; });
  }

  // ══════════ SERVICE WORKER + UPDATE TOAST (SW-04 / F-3) ══════════
  let toastEl = null, wantReload = false;
  function showUpdate(reg) {
    if (!doc || !doc.body) return null;
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.className = 'vf-toast';
      toastEl.setAttribute('role', 'alert');
      toastEl.innerHTML = '<span>NEW VERSION AVAILABLE —</span><button type="button" class="vf-reload">RELOAD</button><button type="button" class="vf-later" aria-label="Later">LATER</button>';
      toastEl.querySelector('.vf-later').addEventListener('click', () => { toastEl.hidden = true; });
      doc.body.appendChild(toastEl);
    }
    toastEl.querySelector('.vf-reload').onclick = () => {
      wantReload = true;
      const w = reg && reg.waiting;
      if (w) { w.postMessage({ type: 'SKIP_WAITING' }); setTimeout(() => root.location.reload(), 3000); }   // controllerchange normally reloads first
      else root.location.reload();
    };
    toastEl.hidden = false;
    return toastEl;
  }
  function watchRegistration(reg) {
    if (reg.waiting && nav.serviceWorker.controller) showUpdate(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && nav.serviceWorker.controller) showUpdate(reg); });
    });
    // Look for a new version when the page comes back to the foreground, and every 30 min while it stays open.
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
  }
  function registerSW() {
    if (!doc || !nav || !('serviceWorker' in nav) || !BASE || !root.isSecureContext) return Promise.resolve(null);
    // Reload only when the user asked (RELOAD); the first install's clients.claim() also fires controllerchange.
    let reloading = false;
    nav.serviceWorker.addEventListener('controllerchange', () => { if (wantReload && !reloading) { reloading = true; root.location.reload(); } });
    return nav.serviceWorker.register(BASE + 'sw.js', { updateViaCache: 'none' })
      .then(reg => { watchRegistration(reg); return reg; })
      .catch(() => null);
  }

  // ══════════ SCREEN WAKE LOCK (F-4) — feature-detected; held only while wanted and the page is visible ══════════
  const wake = { want: false, lock: null, pending: false };
  function syncWake() {
    const wl = nav && nav.wakeLock;
    if (!wl || typeof wl.request !== 'function') return;
    if (wake.want && doc.visibilityState === 'visible' && !wake.lock && !wake.pending) {
      wake.pending = true;
      wl.request('screen').then(lock => {
        wake.pending = false; wake.lock = lock;
        lock.addEventListener('release', () => { if (wake.lock === lock) wake.lock = null; });
        if (!wake.want) releaseWake();
      }, () => { wake.pending = false; });
    } else if (!wake.want && wake.lock) releaseWake();
  }
  function releaseWake() {
    const l = wake.lock; wake.lock = null;
    if (l) l.release().catch(() => {});
  }
  function setWake(on) { wake.want = !!on; syncWake(); }
  function wakeState() {
    return { supported: !!(nav && nav.wakeLock && typeof nav.wakeLock.request === 'function'), want: wake.want, held: !!wake.lock };
  }

  // ══════════ QR CODE (F-8) — vendored qrcode-generator (MIT), drawn as SVG with the --ink / --paper tokens ══════════
  function qrLib() {
    if (root && typeof root.qrcode === 'function') return root.qrcode;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./vendor/qrcode-generator/qrcode.js');
    return null;
  }
  // SVG markup of a QR code (error correction M, 4-module quiet zone); null when the library is not loaded.
  function qrSvg(text, title) {
    const Q = qrLib();
    if (!Q) return null;
    const qr = Q(0, 'M');
    qr.addData(String(text));
    qr.make();
    const n = qr.getModuleCount(), q = 4, size = n + 2 * q;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        let run = 1;
        while (c + run < n && qr.isDark(r, c + run)) run++;
        d += 'M' + (c + q) + ' ' + (r + q) + 'h' + run + 'v1h-' + run + 'z';
        c += run - 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" role="img" shape-rendering="crispEdges">'
      + '<title>' + escH(title || 'QR code: ' + text) + '</title>'
      + '<rect width="' + size + '" height="' + size + '" fill="var(--paper)"/><path d="' + d + '" fill="var(--ink)"/></svg>';
  }

  // ══════════ SHARE / KNEEBOARD MENU + PRINT (F-6, F-8) ══════════
  function fillShare(menu) {
    const box = menu.querySelector('.vf-qr');
    if (box && !box.firstChild) box.innerHTML = qrSvg(SITE_URL, 'QR code: ' + SITE_URL) || '<span class="vf-tbd">QR generator not loaded</span>';
    menu.querySelectorAll('[data-vf-site]').forEach(el => { el.textContent = SITE_URL; });
  }
  // Print the kneeboard (css/print.css, <html class="vf-kb">): pre-flight + turnaround checklists and emergency cards.
  function printKneeboard() {
    if (!doc) return;
    const h = doc.documentElement;
    h.classList.add('vf-kb');
    const done = () => { h.classList.remove('vf-kb'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    try { root.print(); } catch (e) { done(); }
  }

  // ══════════ START ══════════
  function init() {
    applySun(sunOn());
    doc.querySelectorAll('[data-vf-sun]').forEach(b => b.addEventListener('click', toggleSun));
    doc.querySelectorAll('[data-vf-share]').forEach(m => {
      m.addEventListener('toggle', () => { if (m.open) fillShare(m); });
      if (m.open) fillShare(m);
    });
    doc.querySelectorAll('[data-vf-print-kb]').forEach(b => b.addEventListener('click', printKneeboard));
    renderVersion();
    root.addEventListener('storage', e => {
      if (e.key === SUN_KEY) applySun(sunOn());          // another tab or page toggled it
      if (e.key === STORE_KEY) renderVersion();
    });
    root.addEventListener('vtol-store-changed', renderVersion);
    doc.addEventListener('visibilitychange', syncWake);
    registerSW();
  }
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
  }

  return {
    SITE_URL, SUN_KEY, sunOn, setSun, toggleSun, applySun,
    paramFileText, versionParts, versionLineHTML, renderVersion,
    registerSW, showUpdate, setWake, wakeState, qrSvg, printKneeboard
  };
});
