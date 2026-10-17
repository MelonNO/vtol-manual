/* js/emergency-only.js — "Emergency only" mode of the Tools page (plan §10.2 F-7; WP09 R9).
 * index.html#emergency-only           → one large button per scenario (fills the screen, no scrolling)
 * index.html#emergency-only/<card id> → that scenario's IMMEDIATE actions only, text sized to fit the screen
 * Content: VtolContent.emergencies / emergencyNotes (data/content.js), text through VtolRender.fmt (tokens, TBD markers).
 * Global VtolEmergOnly in the browser, module.exports in Node (the HTML builders are unit-tested).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolEmergOnly = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const HASH = '#emergency-only';

  function escH(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Scenarios in display order: the emergency cards, then the notes (e.g. the 915 backup note).
  function scenarios(content) {
    const c = content || {};
    return (c.emergencies || []).map(e => ({ kind: 'card', item: e })).concat((c.emergencyNotes || []).map(n => ({ kind: 'note', item: n })));
  }
  // Route from a location hash: null (mode off), { id: null } (list) or { id } (one scenario).
  function parseHash(hash) {
    hash = String(hash || '');
    if (hash === HASH) return { id: null };
    if (hash.indexOf(HASH + '/') === 0) return { id: decodeURIComponent(hash.slice(HASH.length + 1)) || null };
    return null;
  }

  // List screen: one button per scenario (primary red, notes amber).
  function listHTML(content) {
    return scenarios(content).map(s => {
      const cls = s.kind === 'note' ? ' class="note"' : (s.item.priority === 'primary' ? ' class="primary"' : '');
      return '<button type="button"' + cls + ' data-eo="' + escH(s.item.id) + '">' + escH(s.item.pill || s.item.title) + '</button>';
    }).join('');
  }
  // Scenario screen body: immediate steps only (notes: the short text and the close-in steps). fmt: text → HTML.
  function cardHTML(s, fmt) {
    const f = fmt || escH;
    const step = (t, i) => '<div class="eo-step"><span class="n">' + (i + 1) + '</span><span>' + f(t) + '</span></div>';
    if (s.kind === 'note') {
      const n = s.item, c = n.closeIn;
      return '<div class="eo-text">' + f(n.text) + '</div>' + (c ? '<div class="eo-text">' + f(c.title) + '</div>' + c.steps.map(step).join('') : '');
    }
    return s.item.immediate.map(step).join('');
  }

  // Largest font size (px, maxPx…minPx) at which el's content fits without scrolling. Returns the size used.
  function fitText(el, maxPx, minPx) {
    let lo = minPx, hi = maxPx, best = minPx;
    const fits = px => { el.style.fontSize = px + 'px'; return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1; };
    if (!el.clientHeight) { el.style.fontSize = maxPx + 'px'; return maxPx; }   // not laid out (hidden): try again on show
    while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if (fits(mid)) { best = mid; lo = mid; } else hi = mid; }
    if (!fits(best)) { el.style.overflowY = 'auto'; return best; }   // very long content: scroll rather than cut text
    el.style.overflowY = '';
    return best;
  }

  // Mount on the page. opts: { el: the .eo-view element, content: VtolContent, fmt(text) → HTML, onChange(active) }.
  function mount(opts) {
    const el = opts.el, doc = el.ownerDocument, win = doc.defaultView;
    const title = el.querySelector('.eo-title'), body = el.querySelector('.eo-body');
    let active = false;
    function render() {
      const route = parseHash(win.location.hash);
      const on = route !== null;
      doc.documentElement.classList.toggle('vf-eo', on);
      if (on !== active) { active = on; if (opts.onChange) opts.onChange(on); }
      if (!on) { body.innerHTML = ''; return; }
      const list = scenarios(opts.content), idx = route.id ? list.findIndex(s => s.item.id === route.id) : -1;
      if (idx < 0) {
        title.textContent = '⚠ EMERGENCY — IMMEDIATE ACTIONS';
        body.innerHTML = '<div class="eo-list">' + listHTML(opts.content) + '</div>';
        body.querySelectorAll('[data-eo]').forEach(b => b.addEventListener('click', () => { win.location.hash = HASH + '/' + encodeURIComponent(b.dataset.eo); }));
        return;
      }
      const s = list[idx], fmt = t => opts.fmt ? opts.fmt(t) : escH(t);
      title.innerHTML = (s.kind === 'note' ? 'NOTE · ' : '⚠ ') + escH(s.item.pill || s.item.title);
      body.innerHTML = '<div class="eo-card' + (s.kind === 'note' ? ' note' : '') + '"><div class="eo-card-title">' + fmt(s.item.title) + '</div>'
        + '<div class="eo-steps">' + cardHTML(s, fmt) + '</div></div>'
        + '<div class="eo-nav"><button type="button" class="eo-all">◀ ALL</button><button type="button" class="eo-next">NEXT ▶</button></div>';
      body.querySelector('.eo-all').addEventListener('click', () => { win.location.hash = HASH; });
      body.querySelector('.eo-next').addEventListener('click', () => { win.location.hash = HASH + '/' + encodeURIComponent(list[(idx + 1) % list.length].item.id); });
      fitText(body.querySelector('.eo-steps'), 44, 13);
    }
    win.addEventListener('hashchange', render);
    win.addEventListener('resize', () => { const st = body.querySelector('.eo-steps'); if (st) fitText(st, 44, 13); });
    el.querySelector('.eo-exit').addEventListener('click', () => {
      win.history.replaceState(null, '', win.location.pathname + win.location.search);
      render();
    });
    render();
    return { render, isActive: () => active };
  }

  return { HASH, scenarios, parseHash, listHTML, cardHTML, fitText, mount };
});
