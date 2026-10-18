/* js/render-content.js — renderers for the shared content (contract C5): global VtolRender in the browser,
 * module.exports in Node.
 *
 * Pure functions: data (data/content.js) + context → HTML string. No DOM access, no globals written.
 * Everything is escaped first; the small markup set of data/content.js is applied afterwards, and template
 * tokens ({client.…}, {settings.…}) are filled last with escaped values, so profile text can never inject markup.
 *
 *   ctx = VtolRender.ctxFrom(store)        → { client, settings, clientPack } (active client profile)
 *   fmt(text, ctx) / plain(text, ctx)      → HTML / plain text with tokens resolved (null or unknown → TBD)
 *   checklist(list, state, ctx, opts)      → sections for the Tools checklist engine (index.html)
 *   emergencyCard(e, ctx, {compact}), emergencyNote(n, ctx), emergencyPills(list, notes)
 *   failsafeTable, clientFailsafeChain, networkTable, callouts, designIntent, postflight
 *   autoHint(ruleId, status, ctx)          → { state:'ok'|'fail'|'unknown', text } (checklist automation)
 *   linkStatus(status, ctx)                → Link tab view of a C2 status object
 * The shared classes (tables in .tbl-wrap, callout tables .co-table, the emergency family, cards, markers) are base
 * components in css/base.css; the checklist rows (.ci, .cl-section…) and the Link panels (.lk-…) are styled by index.html.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolRender = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Same as VtolCommon.escH (kept internal so this module has no load-order dependency).
  function escH(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MODES = { QHOVER: 'm-qhov', QLOITER: 'm-qhov', QLAND: 'm-rtl', QRTL: 'm-rtl', RTL: 'm-rtl', FBWB: 'm-fbwb', AUTO: 'm-auto', MANUAL: 'm-man' };
  const TBD = 'TBD';
  const TBD_HTML = '<span class="warn-val">TBD</span>';
  const TOKEN_RE = /\{((?:client|settings|clientPack)\.[A-Za-z0-9_.]+)\}/g;

  // ── context and tokens ──
  const live = l => (Array.isArray(l) ? l : []).filter(r => r && typeof r === 'object' && !r.deleted);
  function ctxFrom(store) {
    const settings = (store && store.settings) || {};
    const client = live(store && store.clients).find(c => c.id === settings.activeClientId) || null;
    const clientPack = client ? live(store && store.packs).find(p => p.id === client.packId) || null : null;
    return { client, settings, clientPack };
  }

  const LABEL = {
    'client.failsafe.type': { gps_rescue: 'GPS Rescue', land: 'Land', drop: 'Drop' },
    'client.elrs.band': { '868': '868 MHz', '915': '915 MHz', '2.4': '2.4 GHz', gemini: 'Gemini' }
  };
  function formatToken(path, v) {
    if (LABEL[path]) return LABEL[path][v] || null;
    if (path === 'client.elrs.geminiRx') return v ? 'yes' : 'no';
    if (path === 'client.elrs.telemetryRatio') return v === 0 ? 'Off' : '1:' + v;
    if (typeof v === 'number' && /^settings\.\w*PerCell$/.test(path)) return v.toFixed(2);
    if (typeof v === 'number' && /^settings\.\w*Volt$/.test(path)) return v.toFixed(1);
    return String(v);
  }
  // Resolved token text, or null when the value is unknown (null / missing / not a scalar).
  function tokenValue(path, ctx) {
    const parts = String(path).split('.');
    let v = ctx || {};
    for (const p of parts) {
      if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, p)) return null;
      v = v[p];
    }
    if (v === null || v === undefined || v === '' || typeof v === 'object' || (typeof v === 'number' && !isFinite(v))) return null;
    const out = formatToken(path, v);
    return out === null || out === '' ? null : out;
  }

  // Content text → HTML (see the markup list in data/content.js).
  function fmt(text, ctx) {
    let h = escH(text);
    h = h.replace(/\[\[([^\]]+)\]\]/g, (m, inner) => MODES[inner] ? '<span class="mbadge ' + MODES[inner] + '">' + inner + '</span>' : '<span class="warn-val">' + inner + '</span>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return h.replace(TOKEN_RE, (m, path) => { const v = tokenValue(path, ctx); return v === null ? TBD_HTML : escH(v); });
  }
  // Copy-block text → plain text (tokens resolved, unknown → "TBD"). Escape before inserting into HTML.
  function plain(text, ctx) {
    return String(text === null || text === undefined ? '' : text).replace(TOKEN_RE, (m, path) => { const v = tokenValue(path, ctx); return v === null ? TBD : v; });
  }

  // ── checklists ──
  // opts: { colors: {A:'#hex',…}, prefix: id prefix of the section progress counters }
  // The section colour is passed to the page CSS as the custom property --sec (only the letter badge uses it).
  // state: { items: { [itemId]: {checked, ts} } } (WP01 engine; ToolsCore.cl*)
  function checklistItem(item, sec, listName, saved, ctx) {
    const hasDetail = !!(item.t || item.n || (item.extras && item.extras.length));
    const noteCls = item.copy ? ' copy-val' : (item.w ? ' w' : '');
    const note = item.n ? '<span class="ci-note' + noteCls + '"' + (item.copy ? ' onclick="copyVal(this,event)"' : '') + '>'
      + (item.copy ? escH(plain(item.n, ctx)) : fmt(item.n, ctx)) + '</span>' : '';
    const extras = (item.extras || []).map(e => '<div class="ci-extra"><span class="ci-extra-label">' + fmt(e.label, ctx)
      + '</span><span class="ci-note copy-val" onclick="copyVal(this,event)">' + escH(plain(e.val, ctx)) + '</span></div>').join('');
    const id = escH(item.id);
    const row = '<div class="ci' + (saved ? ' done' : '') + (item.w ? ' warn-item' : '') + '" data-id="' + id + '" data-sec="' + escH(sec.id) + '" data-list="' + escH(listName) + '">'
      + '<div class="ci-left" onclick="toggleCI(this.closest(\'.ci\'),event)"><div class="ci-box"></div><span class="ci-short">' + fmt(item.s || item.t, ctx) + '</span>'
      + (item.w ? '<span class="ci-warn-dot">!</span>' : '')
      + (item.auto ? '<span class="ci-auto" data-auto="' + escH(item.auto) + '" hidden></span>' : '')
      + '<span class="ci-ts"></span></div>'
      + '<div class="ci-right' + (hasDetail ? '' : ' no-detail') + '"' + (hasDetail ? ' onclick="toggleDetail(this.closest(\'.ci\').dataset.id,this,event)"' : '') + '>'
      + (hasDetail ? '<span class="expand-icon">▶</span><span class="expand-hint">DETAILS</span>' : '') + '</div></div>';
    const detail = hasDetail ? '<div class="ci-detail" id="det-' + id + '"><span class="ci-detail-text">' + fmt(item.t || '', ctx) + '</span>' + note + extras + '<span class="ci-checked-at"></span></div>' : '';
    return row + detail;
  }
  function checklistSection(sec, listName, state, ctx, opts) {
    opts = opts || {};
    const sc = opts.colors && opts.colors[sec.id];
    const secVar = typeof sc === 'string' && /^#[0-9a-f]{3,8}$/i.test(sc) ? ' style="--sec:' + sc + '"' : '';
    const items = (state && state.items) || {};
    return '<div class="cl-section" id="cls-' + escH(sec.id) + '"' + secVar + '>'
      + '<div class="cl-section-hdr"><span class="cl-section-letter">' + escH(sec.id) + '</span>'
      + '<span class="cl-section-name">' + fmt(sec.name, ctx) + '</span><span class="cl-section-prog" id="' + escH((opts.prefix || '') + sec.id) + '"></span></div>'
      + sec.items.map(it => checklistItem(it, sec, listName, items[it.id], ctx)).join('') + '</div>';
  }
  function checklist(list, state, ctx, opts) {
    return list.sections.map(sec => checklistSection(sec, list.id, state, ctx, opts)).join('');
  }
  function checklistItemIds(list) {
    const ids = [];
    list.sections.forEach(sec => sec.items.forEach(it => ids.push(it.id)));
    return ids;
  }

  // ── post-flight ──
  function postflight(sections, ctx) {
    return sections.map(sec => '<div class="section-title">' + fmt(sec.title, ctx) + '</div><div class="card' + (sec.style ? ' ' + escH(sec.style) : '') + '" id="' + escH(sec.id) + '">'
      + sec.steps.map((st, i) => '<div class="step" id="' + escH(st.id) + '"><div class="step-n">' + (i + 1) + '</div><div class="step-body"><strong>' + fmt(st.s, ctx) + '</strong><p>' + fmt(st.t, ctx) + '</p></div></div>').join('')
      + '</div>').join('');
  }

  // ── emergencies ──
  const CLEANUP_BTN = '<button type="button" class="emerg-cleanup-btn" aria-expanded="false" onclick="toggleCleanup(this)">▶ &nbsp;CLEAN-UP — LOOK UP AFTER SITUATION STABLE</button>';
  // Full card (manual) shows the summary; compact (Tools modal) shows only the memory items and clean-up.
  function emergencyCard(e, ctx, opts) {
    const compact = !!(opts && opts.compact);
    const cls = 'card danger emerg-card' + (e.priority === 'primary' ? ' emerg-primary' : '') + (e.priority === 'low' ? ' emerg-low' : '');
    return '<div id="' + escH(e.id) + '" class="' + cls + '">'
      + '<div class="emerg-hdr">' + fmt(e.title, ctx) + '</div>'
      + (!compact && e.summary ? '<p class="emerg-summary">' + fmt(e.summary, ctx) + '</p>' : '')
      + '<div class="emerg-imm"><div class="emerg-imm-badge">IMMEDIATE — FROM MEMORY</div>'
      + e.immediate.map((s, i) => '<div class="emerg-imm-step"><div class="n">' + (i + 1) + '</div><div>' + fmt(s, ctx) + '</div></div>').join('') + '</div>'
      + CLEANUP_BTN
      + '<div class="emerg-cleanup"><div class="emerg-cu-label">CLEAN-UP · NOT FOR MEMORY</div>'
      + e.cleanup.map((s, i) => '<div class="emerg-cu-step"><div class="n">' + (i + 1) + '</div><div class="t">' + fmt(s, ctx) + '</div></div>').join('') + '</div>'
      + '</div>';
  }
  function emergencyNote(n, ctx) {
    const c = n.closeIn;
    return '<div id="' + escH(n.id) + '" class="card amber emerg-note">'
      + '<div class="card-title">' + fmt(n.title, ctx) + '</div><p class="emerg-note-text">' + fmt(n.text, ctx) + '</p>'
      + (c ? '<div class="emerg-note-close"><div class="emerg-cu-label">CLOSE-IN CASE</div><div class="emerg-note-close-title">' + fmt(c.title, ctx) + '</div>'
        + c.steps.map((s, i) => '<div class="emerg-imm-step"><div class="n">' + (i + 1) + '</div><div>' + fmt(s, ctx) + '</div></div>').join('')
        + (c.note ? '<p class="emerg-note-text">' + fmt(c.note, ctx) + '</p>' : '') + '</div>' : '')
      + '</div>';
  }
  function emergencyPills(list, notes) {
    const pill = (x, cls) => '<button type="button" class="emerg-pill' + cls + '" data-target="' + escH(x.id) + '" onclick="emergJump(this.dataset.target)">' + escH(x.pill || x.title) + '</button>';
    return list.map(e => pill(e, e.priority === 'primary' ? ' primary' : '')).join('') + (notes || []).map(n => pill(n, ' note')).join('');
  }
  function emergencies(list, notes, ctx, opts) {
    return list.map(e => emergencyCard(e, ctx, opts)).join('') + (notes || []).map(n => emergencyNote(n, ctx)).join('');
  }

  // ── tables ──
  function table(columns, rows, keys, ctx, cls, rowCls) {
    return '<div class="tbl-wrap"><table class="' + cls + '"><thead><tr>' + columns.map(c => '<th>' + escH(c) + '</th>').join('') + '</tr></thead><tbody>'
      + rows.map(r => '<tr id="' + escH(r.id) + '"' + (rowCls && rowCls(r) ? ' class="' + rowCls(r) + '"' : '') + '>' + keys.map(k => '<td>' + fmt(r[k], ctx) + '</td>').join('') + '</tr>').join('')
      + '</tbody></table></div>';
  }
  function failsafeTable(ft, ctx) {
    return table(ft.columns, ft.rows, ['event', 'detection', 'action', 'pilot'], ctx, 'fs-table', r => r.primary ? 'fs-primary' : '');
  }
  function networkTable(net, ctx) {
    return table(net.columns, net.rows, ['device', 'ip', 'port', 'dir', 'notes'], ctx, 'net-table');
  }
  function clientFailsafeChain(ch, ctx) {
    return '<div class="card" id="' + escH(ch.id) + '"><div class="card-title">' + fmt(ch.title, ctx) + '</div>'
      + ch.steps.map((s, i) => '<div class="proc-step"><span class="n">' + (i + 1) + '</span><span class="t">' + fmt(s, ctx) + '</span></div>').join('')
      + '<p><strong>' + fmt(ch.total, ctx) + '</strong></p><p>' + fmt(ch.note, ctx) + '</p></div>';
  }
  function designIntent(d, ctx) {
    return '<div class="card design-intent" id="' + escH(d.id) + '"><div class="card-title">' + fmt(d.title, ctx) + '</div><p>' + fmt(d.text, ctx) + '</p></div>';
  }
  function callouts(c, ctx) {
    const groups = c.groups.map(g => '<div class="section-title" id="' + escH(g.id) + '">' + fmt(g.title, ctx) + '</div><div class="tbl-wrap"><table class="co-table">'
      + '<thead><tr><th class="co-trig">Trigger</th><th class="co-who">Who calls</th><th>Callout</th></tr></thead><tbody>'
      + g.rows.map(r => '<tr id="' + escH(r.id) + '"><td>' + fmt(r.trigger, ctx) + '</td><td>' + fmt(r.who, ctx) + '</td><td><strong>"' + fmt(r.call, ctx) + '"</strong>'
        + (r.note ? ' — ' + fmt(r.note, ctx) : '') + '</td></tr>').join('') + '</tbody></table></div>').join('');
    const a = c.abort;
    const abort = a ? '<div class="section-title" id="' + escH(a.id) + '-calls">Abort Calls</div><div class="card danger" id="' + escH(a.id) + '"><div class="card-title">' + fmt(a.title, ctx) + '</div><p>' + fmt(a.text, ctx) + '</p>'
      + '<div class="tbl-wrap"><table class="co-table"><thead><tr><th class="co-call">Callout</th><th>Meaning &amp; immediate action</th></tr></thead><tbody>'
      + a.rows.map(r => '<tr id="' + escH(r.id) + '"><td><strong>"' + fmt(r.call, ctx) + '"</strong></td><td>' + fmt(r.meaning, ctx) + '</td></tr>').join('') + '</tbody></table></div></div>' : '';
    return (c.intro ? '<p>' + fmt(c.intro, ctx) + '</p>' : '') + groups + abort;
  }

  // Header doc-id line (plain text, for textContent).
  function headerDocId(ctx) {
    const band = tokenValue('client.elrs.band', ctx);
    return 'HEEWING T2 CRUZA · ARDUPLANE · ELRS 915 (carrier) · ELRS ' + (band || TBD) + ' (client) · SIYI HM30';
  }

  // ── live status (contract C2) ──
  function get(o, path) {
    let v = o;
    for (const p of path.split('.')) { if (v === null || v === undefined || typeof v !== 'object') return null; v = v[p]; }
    return v === undefined ? null : v;
  }
  const isNum = v => typeof v === 'number' && isFinite(v);

  // Checklist automation rules (plan §14.7). The pilot still ticks every item by hand.
  const AUTO_RULES = {
    'bridge-run': {
      label: 'Bridge state RUN',
      run(s) {
        const st = get(s, 'bridge.state');
        if (!st) return ['unknown', 'bridge state unknown'];
        return st === 'RUN' ? ['ok', 'bridge RUN'] : ['fail', 'bridge ' + st];
      }
    },
    'app-controller-safe': {
      label: 'Controller connected, arm switch safe, throttle low',
      run(s) {
        const c = get(s, 'controller.connected'), a = get(s, 'controller.arm_switch_safe'), t = get(s, 'controller.throttle_low');
        if (c === false) return ['fail', 'controller not connected'];
        if (a === false) return ['fail', 'arm switch not safe'];
        if (t === false) return ['fail', 'throttle not low'];
        if (c === true && a === true && t === true) return ['ok', 'controller safe'];
        return ['unknown', 'controller state unknown'];
      }
    },
    'client-rescue-ready': {
      label: 'Client GPS Rescue ready (no "?" in the flight mode)',
      run(s, ctx) {
        const type = get(ctx, 'client.failsafe.type');
        if (type && type !== 'gps_rescue') return ['unknown', 'client failsafe is not GPS Rescue'];
        const nr = get(s, 'client.flight_mode.rescue_not_ready');
        if (nr === true) return ['fail', 'rescue NOT ready'];
        if (nr === false) return ['ok', 'rescue ready'];
        return ['unknown', 'no client flight mode'];
      }
    },
    'client-sats': {
      label: 'Client satellites ≥ profile minimum',
      run(s, ctx) {
        const sats = get(s, 'client.gps.sats'), min = get(ctx, 'client.failsafe.minSats');
        if (!isNum(sats)) return ['unknown', 'no client GPS'];
        if (!isNum(min)) return ['unknown', sats + ' sats (profile minimum TBD)'];
        return sats >= min ? ['ok', sats + ' sats ≥ ' + min] : ['fail', sats + ' sats < ' + min];
      }
    },
    // Sortie plan: FPV sortie → camera OFF (unless relay-design test 9 passed); carrier-only sortie → camera may be ON.
    // The app mode tells which one is flown; a camera ON in FPV mode can be planned (test 9), so it is "?" not "✗".
    'camera-sortie': {
      label: 'Carrier camera state matches the sortie (reported = requested; OFF for FPV)',
      run(s) {
        const rq = get(s, 'bridge.camera.requested'), rp = get(s, 'bridge.camera.reported'), mode = get(s, 'app.mode');
        if (typeof rq !== 'boolean' || typeof rp !== 'boolean') return ['unknown', 'camera state unknown'];
        if (rq !== rp) return ['fail', 'camera requested ' + (rq ? 'ON' : 'OFF') + ' ≠ reported ' + (rp ? 'ON' : 'OFF')];
        if (!rp) return ['ok', 'camera OFF'];
        if (mode === 'carrier_only') return ['ok', 'camera ON — carrier-only sortie'];
        return ['unknown', 'camera ON — OK only if the sortie plan needs it (FPV: only after relay-design test 9)'];
      }
    },
    'video-lock': {
      label: 'Video decoder lock, standard as in the profile',
      run(s, ctx) {
        const lock = get(s, 'video.decoder_lock'), std = get(s, 'video.standard'), exp = get(ctx, 'client.videoStandard');
        if (lock === false) return ['fail', 'no decoder lock'];
        if (lock !== true) return ['unknown', 'decoder lock not reported'];
        if (std && std !== 'null' && exp && std !== exp) return ['fail', 'video ' + std + ', profile expects ' + exp];
        return ['ok', 'decoder lock' + (std && std !== 'null' ? ' · ' + std : '')];
      }
    },
    'client-link': {
      label: 'Client ELRS link quality ≥ 70 %',
      run(s) {
        const lq = get(s, 'client.link.lq_pct');
        if (!isNum(lq)) return ['unknown', 'no client link telemetry'];
        return lq >= 70 ? ['ok', 'LQ ' + lq + ' %'] : ['fail', 'LQ ' + lq + ' % < 70 %'];
      }
    }
  };
  function autoHint(ruleId, status, ctx) {
    const r = AUTO_RULES[ruleId];
    if (!r || !status || typeof status !== 'object') return { state: 'unknown', text: 'no data' };
    let res;
    try { res = r.run(status, ctx || {}); } catch (e) { res = ['unknown', 'no data']; }
    return { state: res[0], text: res[1] };
  }
  // Short label for a hint (plain text): "AUTO ✓" / "AUTO ✗" / "AUTO ?".
  function autoHintLabel(h) {
    return 'AUTO ' + (h.state === 'ok' ? '✓' : h.state === 'fail' ? '✗' : '?');
  }

  // Link tab: full view of one status object. Unknown (null) values show as "—".
  const DASH = '<span class="lk-na">—</span>';
  function n(v, d, unit) {
    if (!isNum(v)) return v === null || v === undefined || v === '' ? DASH : escH(v);
    return escH(d === undefined ? String(v) : v.toFixed(d)) + (unit ? ' ' + unit : '');
  }
  const yn = (v, yes, no) => v === true ? escH(yes || 'YES') : v === false ? escH(no || 'NO') : DASH;
  function row(k, v, cls) { return '<div class="lk-row' + (cls ? ' ' + cls : '') + '"><span class="lk-k">' + escH(k) + '</span><span class="lk-v">' + v + '</span></div>'; }
  function panel(title, body, cls) { return '<div class="lk-panel' + (cls ? ' ' + cls : '') + '"><div class="lk-title">' + escH(title) + '</div>' + body + '</div>'; }
  const BRIDGE_CLS = { RUN: 'ok', START: 'warn', WAIT_GCS: 'warn', BOOT: 'warn', FAILSAFE: 'crit', UNREACHABLE: 'crit' };

  function linkStatus(s, ctx) {
    s = s && typeof s === 'object' ? s : {};
    ctx = ctx || {};
    const st = get(s, 'bridge.state');
    const bridge = row('State', st ? '<span class="lk-badge ' + (BRIDGE_CLS[st] || 'warn') + '">' + escH(st) + '</span>' : DASH)
      + row('RTT', n(get(s, 'bridge.rtt_ms'), 1, 'ms'))
      + row('Uplink loss', n(get(s, 'bridge.uplink_loss_pct'), 1, '%'))
      + row('Send jitter p99', n(get(s, 'bridge.send_jitter_ms_p99'), 2, 'ms'), get(s, 'bridge.send_jitter_ms_p99') > 2 ? 'warn' : '')
      + row('Status age', n(get(s, 'bridge.status_age_ms'), 0, 'ms'), get(s, 'bridge.status_age_ms') > 300 ? 'crit' : '')
      + row('Timing lock', yn(get(s, 'bridge.timing_locked'), 'LOCKED', 'NOT LOCKED'), get(s, 'bridge.timing_locked') === false ? 'warn' : '')
      + row('Sync offset', n(get(s, 'bridge.sync_offset_us'), 1, 'µs'))
      + row('Bridge firmware', n(get(s, 'bridge.fw_version')));

    const rq = get(s, 'bridge.camera.requested'), rp = get(s, 'bridge.camera.reported');
    const mismatch = typeof rq === 'boolean' && typeof rp === 'boolean' && rq !== rp;
    const camera = row('Requested', yn(rq, 'ON', 'OFF')) + row('Reported', yn(rp, 'ON', 'OFF'), mismatch ? 'crit' : '')
      + (mismatch ? row('Camera', '<span class="lk-badge crit">MISMATCH</span>', 'crit') : '');

    const cc = get(s, 'controller.connected'), asafe = get(s, 'controller.arm_switch_safe'), tl = get(s, 'controller.throttle_low');
    const controller = row('Connected', yn(cc), cc === false ? 'crit' : '') + row('Name', n(get(s, 'controller.name')))
      + row('Arm switch', yn(asafe, 'SAFE', 'NOT SAFE'), asafe === false ? 'warn' : '') + row('Throttle', yn(tl, 'LOW', 'NOT LOW'), tl === false ? 'warn' : '');

    const vstd = get(s, 'video.standard'), exp = get(ctx, 'client.videoStandard'), lock = get(s, 'video.decoder_lock');
    const stdKnown = vstd && vstd !== 'null';
    const video = row('Standard', stdKnown ? escH(vstd) : DASH, stdKnown && exp && vstd !== exp ? 'warn' : '')
      + row('Profile expects', exp ? escH(exp) : TBD_HTML)
      + row('Decoder lock', yn(lock, 'LOCK', 'NO LOCK'), lock === false ? 'crit' : '') + row('RX', n(get(s, 'video.rx_kbps'), 0, 'kbit/s'));

    const L = 'client.link.';
    const lq = get(s, L + 'lq_pct'), r1 = get(s, L + 'rssi1_dbm'), r2 = get(s, L + 'rssi2_dbm'), tage = get(s, 'client.telemetry_age_ms');
    const link = row('LQ', n(lq, 0, '%'), isNum(lq) && lq < 70 ? 'crit' : '')
      + row('RSSI 1 / 2', n(r1, 0, 'dBm') + ' / ' + n(r2, 0, 'dBm'), (isNum(r1) && r1 < -90) || (isNum(r2) && r2 < -90) ? 'warn' : '')
      + row('SNR', n(get(s, L + 'snr_db'), 0, 'dB')) + row('TX power', n(get(s, L + 'tx_power_mw'), 0, 'mW')) + row('RF mode', n(get(s, L + 'rf_mode')))
      + row('Downlink RSSI / LQ / SNR', n(get(s, L + 'dl_rssi_dbm'), 0, 'dBm') + ' / ' + n(get(s, L + 'dl_lq_pct'), 0, '%') + ' / ' + n(get(s, L + 'dl_snr_db'), 0, 'dB'))
      + row('Telemetry age', n(tage, 0, 'ms'), isNum(tage) && tage > 2000 && st === 'RUN' ? 'crit' : '');

    const sats = get(s, 'client.gps.sats'), minSats = get(ctx, 'client.failsafe.minSats');
    const gps = row('Satellites', n(sats, 0) + (isNum(minSats) ? ' <span class="lk-na">(min ' + escH(minSats) + ')</span>' : ''), isNum(sats) && isNum(minSats) && sats < minSats ? 'crit' : '')
      + row('Altitude', n(get(s, 'client.gps.alt_m'), 1, 'm')) + row('Speed', n(get(s, 'client.gps.gspd_kmh'), 1, 'km/h'))
      + row('Heading', n(get(s, 'client.gps.hdg_deg'), 0, '°')) + row('Position', n(get(s, 'client.gps.lat'), 5) + ', ' + n(get(s, 'client.gps.lon'), 5));

    const volt = get(s, 'client.battery.voltage_v'), cells = get(ctx, 'clientPack.cells');
    const batt = row('Voltage', n(volt, 2, 'V') + (isNum(volt) && isNum(cells) && cells > 0 ? ' <span class="lk-na">(' + (volt / cells).toFixed(2) + ' V/cell, ' + escH(cells) + 'S)</span>' : ''))
      + row('Current', n(get(s, 'client.battery.current_a'), 1, 'A')) + row('Used', n(get(s, 'client.battery.used_mah'), 0, 'mAh'))
      + row('Remaining', n(get(s, 'client.battery.remaining_pct'), 0, '%'));

    const fs = get(s, 'client.flight_mode.failsafe'), armed = get(s, 'client.flight_mode.armed'), rnr = get(s, 'client.flight_mode.rescue_not_ready');
    const mode = row('Raw mode', n(get(s, 'client.flight_mode.raw')))
      + row('Failsafe', fs === true ? '<span class="lk-badge crit">FAILSAFE</span>' : yn(fs), fs === true ? 'crit' : '')
      + row('Armed', yn(armed)) + row('Rescue not ready', yn(rnr), rnr === true ? 'warn' : '');

    const alarms = Array.isArray(s.alarms) ? s.alarms.filter(a => a && typeof a === 'object') : [];
    const alarmHtml = alarms.length ? alarms.map(a => '<div class="lk-alarm ' + (a.severity === 'crit' ? 'crit' : 'warn') + '"><span class="lk-badge ' + (a.severity === 'crit' ? 'crit' : 'warn') + '">' + escH(a.severity === 'crit' ? 'CRIT' : 'WARN') + '</span> '
      + '<strong>' + escH(a.text || a.id) + '</strong>' + (a.since ? ' <span class="lk-na">since ' + escH(a.since) + '</span>' : '') + '</div>').join('')
      : '<div class="lk-row"><span class="lk-k">No active alarms</span></div>';

    const app = get(s, 'app') || {};
    // app.start_path (C2.1): "resume" = the confirmed RESUME (client airborne) start, with the arm switch ARMED.
    const sp = app.start_path;
    const startPath = sp === 'resume' ? '<span class="lk-badge warn">RESUME (CLIENT AIRBORNE)</span>' : sp === 'normal' ? 'NORMAL' : (sp === null || sp === undefined ? DASH : escH(sp));
    const head = '<div class="lk-meta">APP ' + n(app.version) + ' · MODE ' + n(app.mode) + ' · START ' + startPath + ' · STREAMING ' + yn(app.streaming) + ' · ' + n(s.time_utc)
      + ' · CLIENT PROFILE ' + (get(ctx, 'client.name') ? escH(get(ctx, 'client.name')) : TBD_HTML)
      + (get(s, 'client.profile_id') && get(ctx, 'client.id') && get(s, 'client.profile_id') !== get(ctx, 'client.id') ? ' <span class="warn-val">(app uses profile ' + escH(get(s, 'client.profile_id')) + ')</span>' : '') + '</div>';

    return head + panel('ALARMS', alarmHtml, alarms.some(a => a.severity === 'crit') ? 'crit' : '')
      + '<div class="lk-grid">' + panel('BRIDGE', bridge) + panel('CARRIER CAMERA', camera, mismatch ? 'crit' : '') + panel('CONTROLLER', controller)
      + panel('VIDEO', video) + panel('CLIENT LINK', link) + panel('CLIENT GPS', gps) + panel('CLIENT BATTERY', batt) + panel('CLIENT FLIGHT MODE', mode, fs === true ? 'crit' : '') + '</div>';
  }

  return {
    MODES, TBD, escH, ctxFrom, tokenValue, fmt, plain,
    checklist, checklistSection, checklistItem, checklistItemIds,
    postflight, emergencyCard, emergencyNote, emergencyPills, emergencies,
    failsafeTable, networkTable, clientFailsafeChain, designIntent, callouts, headerDocId,
    AUTO_RULES, autoHint, autoHintLabel, linkStatus
  };
});
