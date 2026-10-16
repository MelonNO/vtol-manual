// Shared page helpers (contract C4) — global VtolCommon in the browser, module.exports in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolCommon = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Escape any value for use in HTML text or a quoted attribute.
  function escH(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad2 = n => String(n).padStart(2, '0');

  // Local 24 h time 'HH:MM' from a Date, epoch ms or ISO string. opts.date → 'DD Mon HH:MM'. '' when invalid.
  function fmtTime(value, opts) {
    const d = value instanceof Date ? value : new Date(value);
    if (value === null || value === undefined || isNaN(d.getTime())) return '';
    const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return opts && opts.date ? pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + hm : hm;
  }

  // Elapsed time 'MM:SS' (minutes keep counting past 59).
  function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  // Emergency card clean-up section toggle (button directly precedes its section).
  function toggleCleanup(btn) {
    const el = btn.nextElementSibling;
    const open = el.classList.toggle('visible');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = (open ? '▼' : '▶') + '  CLEAN-UP — LOOK UP AFTER SITUATION STABLE';
  }

  // Legacy copy path: works on http:// and where the Clipboard API is blocked.
  function execCopy(text) {
    if (typeof document === 'undefined' || !document.body) return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // Copy text; resolves true on success, false when both the Clipboard API and the fallback fail. Never rejects.
  function copyToClipboard(text) {
    text = String(text);
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      return nav.clipboard.writeText(text).then(() => true, () => execCopy(text));
    }
    return Promise.resolve(execCopy(text));
  }

  return { escH, fmtTime, fmtDuration, toggleCleanup, copyToClipboard };
});
