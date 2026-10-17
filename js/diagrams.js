/* js/diagrams.js — SVG chart and diagram generators (global VtolDiagrams in the browser, module.exports in Node).
 *
 * Pure functions: data in → SVG string out, no DOM access. Every generator:
 *   - returns well-formed SVG with role="img" and a <title> (plus <desc> where useful);
 *   - takes colours from the page's CSS variables only (var(--accent) …) — no hex colours, so the page palette applies;
 *   - XML-escapes every piece of text it inserts (dates, mode names, log messages, profile labels);
 *   - keeps text ≥ 11 CSS px at the size it is shown (plan §9.2): fixed-size charts are drawn 1:1, wide charts carry
 *     a min-width so they scroll inside an overflow-x wrapper on a phone instead of shrinking.
 * Unknown values (null) are never drawn as numbers: they are skipped or shown as "TBD".
 * Battery thresholds come from ToolsCore.packThresholds / minVoltLevel (js/tools-core.js, loaded before this file).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolDiagrams = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function core() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./tools-core.js');
    return root && root.ToolsCore;
  }

  // ── helpers ──
  const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => XML_ESC[c]); }
  const isNum = v => typeof v === 'number' && isFinite(v);
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  const r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // "Nice" tick values covering [lo, hi] with about n intervals.
  function niceTicks(lo, hi, n) {
    if (!isNum(lo) || !isNum(hi)) return [];
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }
    const raw = (hi - lo) / (n || 4), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function tickLabel(v) { return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : String(+v.toFixed(2)); }

  // m:ss (rounded to whole seconds first, so 59.6 s is 1:00).
  function mmss(s) { if (!isNum(s)) return '—'; const r = Math.round(Math.max(0, s)); return Math.floor(r / 60) + ':' + String(r % 60).padStart(2, '0'); }

  function open(w, h, title, desc, extra) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" role="img"' + (extra || '') + '>'
      + '<title>' + esc(title) + '</title>' + (desc ? '<desc>' + esc(desc) + '</desc>' : '');
  }
  function txt(x, y, s, o) {
    o = o || {};
    return '<text x="' + r1(x) + '" y="' + r1(y) + '" font-size="' + (o.size || 12) + '" fill="' + (o.fill || 'var(--text)') + '"'
      + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.weight ? ' font-weight="' + o.weight + '"' : '') + '>' + esc(s) + '</text>';
  }

  const LEVEL_FILL = { ok: 'var(--green)', warn: 'var(--amber)', crit: 'var(--red)' };
  const LEVEL_TEXT = { ok: 'OK', warn: 'LOW', crit: 'CRIT' };

  // Greedy word wrap for SVG text: lines of at most `width` user units at font `size` (monospace advance ≤ 0.6 em:
  // Share Tech Mono is 0.54 em, the fallbacks up to 0.6). A word longer than a line is split.
  function wrapText(s, size, width) {
    const max = Math.max(4, Math.floor(width / (0.6 * size)));
    const lines = [];
    let cur = '';
    String(s).split(/\s+/).filter(Boolean).forEach(w => {
      while (w.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // ══════════════ BATTERY GAUGE (plan §9.2, MAN-14, §15.3) ══════════════
  // From the pack profile (carrier, mast or client) and the settings — pass ToolsCore.effectiveSettings(…) so an imported
  // param file takes precedence (C1.6). opts.battLowVolt overrides settings.battLowVolt. Carrier markers (plan §15.3):
  // BATT_ARM_VOLT, manual RTL, hard limit, BATT_LOW_VOLT (automatic RTL), BATT_CRT_VOLT (QLand here), storage; other
  // packs: storage and the chemistry longevity floor. Scale: chemistry hard floor → full charge.
  // 360 units wide, every text ≥ 14 units and wrapped to the width (no clipping): at a 360 px viewport the gauge is
  // 315–330 px wide (with / without a scrollbar), i.e. ≥ 12.2 px text; the page caps the width on desktop.
  // Zone names are visible text (a legend under the bar), not only tooltips.
  function batteryGauge(pack, settings, opts) {
    opts = opts || {};
    const TC = core();
    const th = TC.packThresholds(pack, settings || {});
    const cells = th.cells, chem = th.chem;
    const lo = th.critV, hi = th.fullV, W = 360, x0 = 18, x1 = 342, FS = 14;
    const X = v => x0 + (clamp(v, lo, hi) - lo) / (hi - lo || 1) * (x1 - x0);
    const pc = v => f2(v / cells) + ' V/cell';
    const lowIn = opts.battLowVolt !== undefined ? opts.battLowVolt : th.battLowV;
    const low = th.carrier && isNum(lowIn) && lowIn > 0 ? lowIn : null;

    // Zones (left to right). Carrier: the operating zone ends at the manual RTL voltage (MAN-14: "normal" no longer starts at it).
    let zones;
    if (th.carrier && isNum(th.rtlV) && isNum(th.hardV) && isNum(th.crtV)) {
      const lowEdge = low !== null && low > th.crtV && low < th.hardV ? low : null;
      zones = [
        { a: lo, b: th.crtV, fill: 'var(--red)', op: 0.45, name: 'Below BATT_CRT — automatic QLand here' }
      ].concat(lowEdge !== null ? [
        { a: th.crtV, b: lowEdge, fill: 'var(--red)', op: 0.32, name: 'Below BATT_LOW — automatic RTL' },
        { a: lowEdge, b: th.hardV, fill: 'var(--red)', op: 0.2, name: 'Past the hard limit — RTL must already be active' }
      ] : [
        { a: th.crtV, b: th.hardV, fill: 'var(--red)', op: 0.22, name: 'Past the hard limit — RTL must already be active' }
      ]).concat([
        { a: th.hardV, b: th.rtlV, fill: 'var(--amber)', op: 0.3, name: 'RTL now' },
        { a: th.rtlV, b: hi, fill: 'var(--green)', op: 0.2, name: 'Operate — RTL at ' + f1(th.rtlV) + ' V' }
      ]);
    } else {
      zones = [
        { a: lo, b: th.lowV, fill: 'var(--red)', op: 0.3, name: 'Below the longevity floor' },
        { a: th.lowV, b: hi, fill: 'var(--green)', op: 0.2, name: 'Usable range' }
      ];
    }
    zones = zones.filter(z => z.b > z.a);
    // Markers, highest voltage first (numbered in that order).
    const m = [];
    if (th.carrier) {
      if (isNum(th.armV)) m.push({ v: th.armV, c: 'var(--muted)', l: 'BATT_ARM_VOLT — arming refused below' });
      if (isNum(th.rtlV)) m.push({ v: th.rtlV, c: 'var(--accent)', l: 'MANUAL RTL — pilot starts the return (OSD raw voltage)' });
      if (isNum(th.hardV)) m.push({ v: th.hardV, c: 'var(--amber)', l: 'HARD LIMIT — RTL must be active' });
      if (low !== null) m.push({ v: low, c: 'var(--red)', l: 'BATT_LOW_VOLT — AUTOMATIC RTL (10 s below, sag-compensated)' });
      if (isNum(th.crtV)) m.push({ v: th.crtV, c: 'var(--red)', l: 'BATT_CRT_VOLT — Loiter → QLand HERE, not home' });
    } else {
      m.push({ v: th.lowV, c: 'var(--amber)', l: 'LONGEVITY FLOOR (' + chem.low + ' V/cell)' });
    }
    if (isNum(th.storageV)) m.push({ v: th.storageV, c: 'var(--green)', l: 'STORAGE (' + f2(th.storageV / cells) + ' V/cell setting)' });
    m.sort((a, b) => b.v - a.v);
    m.forEach((k, i) => { k.n = i + 1; });

    // Number badges above the bar, staggered when two markers are closer than one badge.
    const barY = 84, barH = 26, R = 10;
    const byX = m.slice().sort((a, b) => X(a.v) - X(b.v));
    let lastX = -1e9, lvl = 0;
    byX.forEach(k => { const x = X(k.v); lvl = x - lastX < 2 * R + 3 ? (lvl + 1) % 3 : 0; k.lvl = lvl; lastX = x; });

    const notes = [];
    if (th.carrier && low === null) notes.push({ c: 'var(--amber)', t: 'BATT_LOW_VOLT: TBD in the settings' });
    if (th.carrier) notes.push({ c: 'var(--muted)', t: 'Failsafes read the sag-compensated voltage (BATT_FS_VOLTSRC = 1); the OSD shows raw voltage, lower under load.' });
    if (th.carrier && !(isNum(th.rtlV) && isNum(th.hardV) && isNum(th.crtV))) notes.push({ c: 'var(--amber)', t: 'Carrier thresholds: TBD in the settings' });
    if (!isNum(th.storageV)) notes.push({ c: 'var(--amber)', t: 'Storage voltage for ' + chem.name + ': TBD (the setting is a LiPo value)' });

    // Layout, top → bottom: label, badges, bar, scale ends, zone legend, marker rows, notes, scale footnote.
    const LH = 18;                                                   // line height of 14-unit text
    const legW = W - (x0 + 22) - 8, rowW = W - (x0 + 28) - 8, noteW = W - x0 - 8;
    let y = barY + barH + 22;                                        // below the scale end labels
    const legend = zones.slice().reverse().map(z => {                // highest zone first, like the markers
      const lines = wrapText(f1(z.a) + '–' + f1(z.b) + ' V ' + z.name, FS, legW), top = y + 6;
      y = top + lines.length * LH; return { z, lines, top };
    });
    y += 14;
    const rows = m.map(k => {
      const lines = wrapText(k.l, FS, rowW), top = y;
      y = top + 22 + lines.length * LH + 6; return { k, lines, top };
    });
    const noteRows = notes.map(n => { const lines = wrapText(n.t, FS, noteW), top = y; y = top + lines.length * LH + 6; return { n, lines, top }; });
    const foot = wrapText('Scale: hard floor ' + chem.critical + ' → full ' + chem.full + ' V/cell (' + chem.name + ')', FS, noteW), footTop = y + 4;
    const H = Math.ceil(footTop + foot.length * LH + 6);

    const title = (opts.title || ((pack.label || 'Pack') + ' — ' + cells + 'S ' + chem.name)) + ' voltage gauge';
    let s = open(W, H, title, 'Scale ' + f1(lo) + ' V (hard floor ' + chem.critical + ' V/cell) to ' + f1(hi) + ' V (full ' + chem.full + ' V/cell). '
      + 'Zones: ' + zones.map(z => f1(z.a) + '–' + f1(z.b) + ' V ' + z.name).join('; ') + '. '
      + m.map(k => k.n + ': ' + f1(k.v) + ' V ' + k.l).join('; ') + (notes.length ? '. ' + notes.map(n => n.t).join('. ') : ''), ' class="dg-gauge"');
    const head = wrapText((pack.label || 'Pack') + ' · ' + cells + 'S ' + chem.name, FS, noteW - 20);   // a long pack label is cut (full text in <title>)
    s += txt(x0, 22, head[0] + (head.length > 1 ? ' …' : ''), { size: FS, fill: 'var(--muted)' });
    zones.forEach(z => {
      s += '<rect x="' + r1(X(z.a)) + '" y="' + barY + '" width="' + r1(X(z.b) - X(z.a)) + '" height="' + barH + '" fill="' + z.fill + '" fill-opacity="' + z.op + '"><title>' + esc(f1(z.a) + '–' + f1(z.b) + ' V: ' + z.name) + '</title></rect>';
    });
    s += '<rect x="' + x0 + '" y="' + barY + '" width="' + (x1 - x0) + '" height="' + barH + '" fill="none" stroke="var(--border2)"/>';
    m.forEach(k => {
      const x = r1(X(k.v)), cy = barY - 14 - k.lvl * (2 * R + 2);
      s += '<line x1="' + x + '" y1="' + (cy + R) + '" x2="' + x + '" y2="' + (barY + barH) + '" stroke="' + k.c + '" stroke-width="2"/>'
        + '<circle cx="' + x + '" cy="' + cy + '" r="' + R + '" fill="var(--surface)" stroke="' + k.c + '" stroke-width="1.5"/>'
        + txt(x, cy + 5, String(k.n), { size: FS, fill: k.c, anchor: 'middle', weight: 'bold' });
    });
    s += txt(x0, barY + barH + 18, f1(lo) + ' V floor', { size: FS, fill: 'var(--muted)' })
      + txt(x1, barY + barH + 18, f1(hi) + ' V full', { size: FS, fill: 'var(--muted)', anchor: 'end' });
    legend.forEach(({ z, lines, top }) => {
      s += '<rect x="' + x0 + '" y="' + top + '" width="14" height="14" fill="' + z.fill + '" fill-opacity="' + Math.min(0.9, z.op * 2.5).toFixed(2) + '" stroke="' + z.fill + '"/>';
      lines.forEach((t, i) => { s += txt(x0 + 22, top + 12 + i * LH, t, { size: FS }); });
    });
    rows.forEach(({ k, lines, top }) => {
      s += '<circle cx="' + (x0 + R) + '" cy="' + (top + 6) + '" r="' + R + '" fill="var(--surface)" stroke="' + k.c + '" stroke-width="1.5"/>'
        + txt(x0 + R, top + 11, String(k.n), { size: FS, fill: k.c, anchor: 'middle', weight: 'bold' })
        + txt(x0 + 28, top + 11, f1(k.v) + ' V · ' + pc(k.v), { size: 15, fill: k.c, weight: 'bold' });
      lines.forEach((t, i) => { s += txt(x0 + 28, top + 30 + i * LH, t, { size: FS }); });
    });
    noteRows.forEach(({ n, lines, top }) => { lines.forEach((t, i) => { s += txt(x0, top + 12 + i * LH, t, { size: FS, fill: n.c }); }); });
    foot.forEach((t, i) => { s += txt(x0, footTop + 12 + i * LH, t, { size: FS, fill: 'var(--muted)' }); });
    return s + '</svg>';
  }

  // ══════════════ BATTERY TREND (Tools → Battery Log) ══════════════
  // entries: battery-log entries newest first (as listed). Last `max` flights, oldest → newest, min (landing) voltage.
  // Profile thresholds as dashed lines, y-axis ticks, a <title> with date, values and level on every point.
  function battTrend(entries, pack, settings, opts) {
    opts = opts || {};
    const list = (entries || []).filter(e => e && isNum(+e.min));
    if (list.length < 2) return '';
    const TC = core(), th = TC.packThresholds(pack, settings || {});
    const n = Math.min(list.length, opts.max || 12), recent = list.slice(0, n).reverse();
    const lines = th.carrier
      ? [{ v: th.rtlV, c: 'var(--accent)', l: 'MANUAL RTL' }, { v: th.hardV, c: 'var(--amber)', l: 'HARD LIMIT' },
        { v: th.battLowV, c: 'var(--red)', l: 'BATT_LOW RTL' }, { v: th.crtV, c: 'var(--red)', l: 'BATT_CRT QLAND' }]
      : [{ v: th.lowV, c: 'var(--amber)', l: 'LONGEVITY FLOOR' }, { v: th.critV, c: 'var(--red)', l: 'HARD FLOOR' }];
    const vals = recent.map(e => +e.min).concat(lines.filter(L => isNum(L.v)).map(L => L.v));
    let lo = Math.min(th.critV, ...vals), hi = Math.max(th.fullV, ...vals);
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const W = 640, H = 190, ml = 46, mr = 150, mt = 12, mb = 30, cw = W - ml - mr, ch = H - mt - mb;
    const Y = v => mt + ch - (v - lo) / (hi - lo || 1) * ch;
    const Xi = i => ml + (n > 1 ? i * cw / (n - 1) : cw / 2);
    let s = open(W, H, 'Minimum (landing) voltage trend — last ' + n + ' flights, ' + (pack.label || '') + ', oldest to newest',
      'Points: ' + recent.map(e => e.date + ' ' + e.min + ' V').join(', '),
      ' class="dg-chart" style="display:block;width:100%;min-width:' + Math.ceil(W * 11 / 12) + 'px"');
    s += '<rect x="' + ml + '" y="' + mt + '" width="' + cw + '" height="' + ch + '" fill="var(--surface)" stroke="var(--border2)"/>';
    ticks.forEach(v => {
      const y = r1(Y(v));
      s += '<line x1="' + ml + '" y1="' + y + '" x2="' + (ml + cw) + '" y2="' + y + '" stroke="var(--border2)" stroke-width="0.5"/>'
        + txt(ml - 6, y + 4, tickLabel(v), { size: 12, fill: 'var(--muted)', anchor: 'end' });
    });
    s += txt(4, mt + 10, 'V', { size: 12, fill: 'var(--muted)' });
    let lastLabelY = -1e9;   // labels of close thresholds are stacked 14 units apart (lines are sorted high → low voltage)
    lines.filter(L => isNum(L.v)).sort((a, b) => b.v - a.v).forEach(L => {
      const y = r1(Y(L.v)), ly = Math.max(y + 4, lastLabelY + 14);
      lastLabelY = ly;
      s += '<line x1="' + ml + '" y1="' + y + '" x2="' + (ml + cw) + '" y2="' + y + '" stroke="' + L.c + '" stroke-dasharray="4,4"/>'
        + txt(ml + cw + 6, ly, f1(L.v) + ' ' + L.l, { size: 12, fill: L.c });
    });
    s += '<polyline points="' + recent.map((e, i) => r1(Xi(i)) + ',' + r1(Y(+e.min))).join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>';
    recent.forEach((e, i) => {
      const lv = TC.minVoltLevel(+e.min, pack, settings || {});
      s += '<circle cx="' + r1(Xi(i)) + '" cy="' + r1(Y(+e.min)) + '" r="5" fill="' + LEVEL_FILL[lv] + '" stroke="var(--bg)">'
        + '<title>' + esc((e.date || '?') + (e.flight ? ' · ' + e.flight : '') + ' — min ' + e.min + ' V (' + f2(+e.min / th.cells) + ' V/cell) — ' + LEVEL_TEXT[lv]) + '</title></circle>';
    });
    s += txt(ml, H - 8, recent[0].date || '', { size: 12, fill: 'var(--muted)' })
      + txt(ml + cw, H - 8, recent[n - 1].date || '', { size: 12, fill: 'var(--muted)', anchor: 'end' });
    return s + '</svg>';
  }

  // ══════════════ BATTERY SPARKLINE (one battery-log row) ══════════════
  // start → min → rest voltage, 1:1 size. Y ticks: full charge (top) and the chemistry hard floor (bottom); dashed line at
  // the profile threshold (manual RTL for a carrier pack, longevity floor otherwise). <title>: date and the three values.
  function battSparkline(e, pack, settings) {
    const TC = core(), th = TC.packThresholds(pack, settings || {});
    const sv = +e.start, mv = +e.min, rv = +e.rest;
    const W = 128, H = 36, ml = 34, mr = 6, mt = 5, mb = 5, cw = W - ml - mr, ch = H - mt - mb;
    const lo = Math.min(th.critV, sv, mv, rv), hi = Math.max(th.fullV, sv, mv, rv);
    const Y = v => r1(mt + ch - (clamp(v, lo, hi) - lo) / (hi - lo || 1) * ch);
    const lv = TC.minVoltLevel(mv, pack, settings || {});
    const c = lv === 'ok' ? 'var(--accent)' : LEVEL_FILL[lv];
    const thr = th.carrier ? th.rtlV : th.lowV;
    const label = (e.date || '?') + (e.flight ? ' · ' + e.flight : '') + ' — start ' + sv + ' V, min ' + mv + ' V, rest ' + rv + ' V — ' + LEVEL_TEXT[lv]
      + (isNum(thr) ? ' (' + (th.carrier ? 'manual RTL ' : 'longevity floor ') + f1(thr) + ' V dashed)' : '');
    let s = open(W, H, label, null, ' width="' + W + '" height="' + H + '" class="dg-spark" style="display:block;overflow:visible"');
    s += txt(ml - 4, mt + 8, f1(hi), { size: 11, fill: 'var(--muted)', anchor: 'end' })
      + txt(ml - 4, H - 1, f1(lo), { size: 11, fill: 'var(--muted)', anchor: 'end' })
      + '<line x1="' + (ml - 2) + '" y1="' + mt + '" x2="' + (ml - 2) + '" y2="' + (H - mb) + '" stroke="var(--border2)"/>';
    if (isNum(thr)) s += '<line x1="' + ml + '" y1="' + Y(thr) + '" x2="' + (W - mr) + '" y2="' + Y(thr) + '" stroke="' + (th.carrier ? 'var(--accent)' : 'var(--amber)') + '" stroke-width="0.8" stroke-dasharray="3,3"/>';
    const xs = [ml + 3, ml + cw / 2, W - mr - 3];
    s += '<polyline points="' + xs[0] + ',' + Y(sv) + ' ' + xs[1] + ',' + Y(mv) + ' ' + xs[2] + ',' + Y(rv) + '" fill="none" stroke="' + c + '" stroke-width="1.5" stroke-linejoin="round"/>'
      + '<circle cx="' + xs[0] + '" cy="' + Y(sv) + '" r="2" fill="' + c + '"/>'
      + '<circle cx="' + xs[1] + '" cy="' + Y(mv) + '" r="3" fill="' + c + '"/>'
      + '<circle cx="' + xs[2] + '" cy="' + Y(rv) + '" r="2" fill="' + c + '"/>';
    return s + '</svg>';
  }

  // ══════════════ WIND COMPASS (Tools → Weather) ══════════════
  // dir: direction the wind comes FROM (°), speed / gust in m/s, color: status colour (a CSS variable).
  // limits: { windGoMaxMs, windCautionMaxMs, gustMaxMs } from the settings.
  // Arrow: wind flow (tail at the FROM side). Hint: take off / land INTO wind = heading toward the FROM direction.
  // Gust-spread arc: outer ring, full circle = the gust no-go limit; solid = mean wind, light = mean → gust.
  const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function cardinal(d) { return CARD[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function arcPath(cx, cy, r, a0, a1) {   // degrees clockwise from north
    const p = a => [cx + r * Math.sin(a * Math.PI / 180), cy - r * Math.cos(a * Math.PI / 180)];
    if (a1 - a0 >= 359.99) a1 = a0 + 359.99;
    const [xa, ya] = p(a0), [xb, yb] = p(a1);
    return 'M' + r1(xa) + ',' + r1(ya) + ' A' + r + ',' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ',1 ' + r1(xb) + ',' + r1(yb);
  }
  function windCompass(dir, speed, gust, color, limits) {
    const c = color || 'var(--accent)', L = limits || {};
    const W = 170, H = 196, cx = 85, cy = 85, r = 52, rr = 66;
    const d = isNum(dir) ? ((dir % 360) + 360) % 360 : null;
    const full = isNum(L.gustMaxMs) && L.gustMaxMs > 0 ? L.gustMaxMs : null;
    const title = 'Wind ' + (isNum(speed) ? f1(speed) : '?') + ' m/s, gusts ' + (isNum(gust) ? f1(gust) : '?') + ' m/s, from '
      + (d === null ? '?' : Math.round(d) + '° ' + cardinal(d)) + (d === null ? '' : '. Take off and land into wind: heading ' + Math.round(d) + '° ' + cardinal(d));
    let s = open(W, H, title, full ? 'Outer ring: full circle = gust limit ' + full + ' m/s; solid = mean wind, light = spread up to the gust.' : null,
      ' width="' + W + '" height="' + H + '" class="dg-compass" style="flex-shrink:0;display:block"');
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + c + '" fill-opacity="0.12" stroke="' + c + '" stroke-opacity="0.35" stroke-width="1.5"/>';
    s += txt(cx, cy - r - 4, 'N', { size: 12, fill: 'var(--muted)', anchor: 'middle' }) + txt(cx, cy + r + 13, 'S', { size: 12, fill: 'var(--muted)', anchor: 'middle' })
      + txt(cx + r + 4, cy + 4, 'E', { size: 12, fill: 'var(--muted)' }) + txt(cx - r - 12, cy + 4, 'W', { size: 12, fill: 'var(--muted)' });
    // Gust-spread ring.
    if (full) {
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="none" stroke="var(--border2)" stroke-width="5"/>';
      const ang = v => clamp(v / full, 0, 1) * 360;
      if (isNum(speed) && speed > 0) s += '<path d="' + arcPath(cx, cy, rr, 0, ang(speed)) + '" fill="none" stroke="' + c + '" stroke-width="5"><title>' + esc('Mean wind ' + f1(speed) + ' m/s') + '</title></path>';
      if (isNum(gust) && isNum(speed) && gust > speed) s += '<path d="' + arcPath(cx, cy, rr, ang(speed), ang(gust)) + '" fill="none" stroke="' + c + '" stroke-opacity="0.4" stroke-width="5"><title>' + esc('Gust spread ' + f1(speed) + ' → ' + f1(gust) + ' m/s') + '</title></path>';
      [['windGoMaxMs', 'var(--green)'], ['windCautionMaxMs', 'var(--amber)']].forEach(([k, kc]) => {
        if (!isNum(L[k]) || L[k] >= full) return;
        const a = ang(L[k]) * Math.PI / 180;
        s += '<line x1="' + r1(cx + (rr - 6) * Math.sin(a)) + '" y1="' + r1(cy - (rr - 6) * Math.cos(a)) + '" x2="' + r1(cx + (rr + 6) * Math.sin(a)) + '" y2="' + r1(cy - (rr + 6) * Math.cos(a)) + '" stroke="' + kc + '" stroke-width="2"><title>' + esc(k + ' ' + L[k] + ' m/s') + '</title></line>';
      });
    }
    if (d !== null) {
      // Into-wind hint: a runway bar along the wind axis with a chevron toward the FROM side (the heading to take off / land).
      s += '<g transform="rotate(' + r1(d) + ' ' + cx + ' ' + cy + ')">'
        + '<rect x="' + (cx - 5) + '" y="' + (cy - r + 4) + '" width="10" height="' + (2 * r - 8) + '" fill="var(--text)" fill-opacity="0.08" stroke="var(--text)" stroke-opacity="0.3" stroke-dasharray="3,3"/>'
        + '<polygon points="' + cx + ',' + (cy - r + 2) + ' ' + (cx - 7) + ',' + (cy - r + 14) + ' ' + (cx + 7) + ',' + (cy - r + 14) + '" fill="var(--text)" fill-opacity="0.75"/>'
        + '<line x1="' + cx + '" y1="' + (cy - 26) + '" x2="' + cx + '" y2="' + (cy + 34) + '" stroke="' + c + '" stroke-width="3" stroke-linecap="round"/>'
        + '<polygon points="' + cx + ',' + (cy + 38) + ' ' + (cx - 7) + ',' + (cy + 26) + ' ' + (cx + 7) + ',' + (cy + 26) + '" fill="' + c + '"/>'
        + '</g>';
    }
    s += '<rect x="' + (cx - 24) + '" y="' + (cy - 12) + '" width="48" height="26" fill="var(--surface)" fill-opacity="0.85"/>'
      + txt(cx, cy + 6, isNum(speed) ? f1(speed) : '—', { size: 15, fill: c, anchor: 'middle', weight: 'bold' })
      + txt(cx, H - 26, 'G ' + (isNum(gust) ? f1(gust) : '—') + ' m/s' + (full ? ' · ring ' + full : ''), { size: 12, fill: 'var(--muted)', anchor: 'middle' })
      + txt(cx, H - 8, d === null ? 'INTO WIND: —' : '▲ INTO WIND ' + Math.round(d) + '° ' + cardinal(d), { size: 12, fill: 'var(--text)', anchor: 'middle' });
    return s + '</svg>';
  }

  // ══════════════ TIME-SERIES CHART (.bin and GCS session-log charts) ══════════════
  // values / times (µs, same length; null values skipped). opts:
  //   color (CSS var), height (default 120), label (title), unit,
  //   modes:  [{ t0, t1, name, cls: 'vtol'|'fw'|'transition'|'other' }] — mode timeline drawn as bands (µs),
  //   events: [{ t, kinds: ['transition'|'failsafe'|'battery'|…], text }] — vertical markers with a <title> (µs).
  // The chart is 700 units wide with 12-unit text and a 640 px min-width: put it in an overflow-x wrapper.
  const MODE_FILL = { vtol: 'var(--green)', fw: 'var(--accent)', transition: 'var(--amber)', other: 'var(--muted)' };
  function eventColor(kinds) {
    const k = kinds || [];
    return k.indexOf('failsafe') >= 0 ? 'var(--red)' : k.indexOf('battery') >= 0 ? 'var(--red)' : k.indexOf('transition') >= 0 ? 'var(--amber)' : 'var(--muted)';
  }
  function timeChart(values, times, opts) {
    opts = opts || {};
    const color = opts.color || 'var(--accent)';
    let vs = values || [], ts = times || [];
    if (vs.length > 600) {
      const step = vs.length / 600, v2 = [], t2 = [];
      for (let k = 0; k < 600; k++) { const i = Math.round(k * step); if (i < vs.length) { v2.push(vs[i]); t2.push(ts[i]); } }
      vs = v2; ts = t2;
    }
    const pts = [];
    vs.forEach((v, i) => { if (v !== null && v !== undefined && isNum(+v) && isNum(+ts[i])) pts.push([+ts[i], +v]); });
    if (pts.length < 2) return '';
    const modes = (opts.modes || []).filter(m => isNum(m.t0) && isNum(m.t1) && m.t1 > m.t0);
    const strip = modes.length ? 20 : 0;
    const W = 700, H = (opts.height || 120) + strip, ml = 50, mr = 8, mt = 6 + strip, mb = 22, cw = W - ml - mr, ch = H - mt - mb;
    const tMin = isNum(opts.t0) ? opts.t0 : pts[0][0], tMax = Math.max(pts[pts.length - 1][0], tMin + 1);
    let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
    const ticks = niceTicks(lo, hi, 3);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const X = t => ml + clamp((t - tMin) / (tMax - tMin), 0, 1) * cw, Y = v => mt + ch - (v - lo) / (hi - lo || 1) * ch;
    const durS = (tMax - tMin) / 1e6;
    let s = open(W, H, (opts.label || 'Time series') + (opts.unit ? ' (' + opts.unit + ')' : '') + ' — ' + mmss(durS) + (modes.length ? ', with flight-mode timeline' : '')
      + ((opts.events || []).length ? ' and ' + opts.events.length + ' marked events' : ''), null,
      ' class="dg-chart" style="display:block;width:100%;min-width:' + Math.ceil(W * 11 / 12) + 'px"');
    s += '<rect x="' + ml + '" y="' + mt + '" width="' + cw + '" height="' + ch + '" fill="var(--surface2)"/>';
    modes.forEach(m => {
      const xa = X(m.t0), xb = X(m.t1), w = xb - xa, f = MODE_FILL[m.cls] || MODE_FILL.other;
      if (w <= 0) return;
      const tt = esc(m.name + ' ' + mmss((m.t0 - tMin) / 1e6) + '–' + mmss((m.t1 - tMin) / 1e6));
      s += '<rect x="' + r1(xa) + '" y="' + mt + '" width="' + r1(w) + '" height="' + ch + '" fill="' + f + '" fill-opacity="0.07"/>'
        + '<rect x="' + r1(xa) + '" y="2" width="' + r1(w) + '" height="' + (strip - 4) + '" fill="' + f + '" fill-opacity="0.3" stroke="var(--surface)" stroke-width="1"><title>' + tt + '</title></rect>';
      if (w >= String(m.name).length * 7.4 + 6) s += txt(xa + 3, strip - 6, m.name, { size: 12 });
    });
    ticks.forEach(v => {
      const y = r1(Y(v));
      s += '<line x1="' + ml + '" y1="' + y + '" x2="' + (ml + cw) + '" y2="' + y + '" stroke="var(--border2)" stroke-width="0.5"/>'
        + txt(ml - 5, y + 4, tickLabel(v), { size: 12, fill: 'var(--muted)', anchor: 'end' });
    });
    niceTicks(0, durS, 5).forEach(sec => {
      if (sec < 0 || sec > durS) return;
      const x = r1(X(tMin + sec * 1e6));
      s += '<line x1="' + x + '" y1="' + (mt + ch) + '" x2="' + x + '" y2="' + (mt + ch + 4) + '" stroke="var(--muted)"/>'
        + txt(x, H - 6, mmss(sec), { size: 12, fill: 'var(--muted)', anchor: sec === 0 ? 'start' : 'middle' });
    });
    if (opts.unit) s += txt(4, mt + 11, opts.unit, { size: 12, fill: 'var(--muted)' });
    s += '<rect x="' + ml + '" y="' + mt + '" width="' + cw + '" height="' + ch + '" fill="none" stroke="var(--border2)" stroke-width="0.5"/>';
    s += '<polyline points="' + pts.map(p => r1(X(p[0])) + ',' + r1(Y(p[1]))).join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round"/>';
    (opts.events || []).forEach(e => {
      if (!isNum(e.t) || e.t < tMin || e.t > tMax) return;
      const x = r1(X(e.t)), ec = eventColor(e.kinds);
      s += '<g><title>' + esc(mmss((e.t - tMin) / 1e6) + ' · ' + (e.kinds || []).join('/') + ' · ' + e.text) + '</title>'
        + '<line x1="' + x + '" y1="' + mt + '" x2="' + x + '" y2="' + (mt + ch) + '" stroke="' + ec + '" stroke-width="1.5" stroke-dasharray="4,3"/>'
        + '<polygon points="' + x + ',' + (mt + 9) + ' ' + (x - 5) + ',' + mt + ' ' + (x + 5) + ',' + mt + '" fill="' + ec + '"/></g>';
    });
    return s + '</svg>';
  }

  // ══════════════ GPS RESCUE TRAJECTORY (manual → Client Drones, Reference client #1) ══════════════
  // p: { name, delayS, minSats (from the client profile), climbM, returnAltM, speedMs, descentDistM, descentRateMs,
  //      landingAltM, minDistM, altMode } — the rest from the client's Betaflight configuration. null → TBD.
  function gpsRescue(p) {
    p = p || {};
    const v = (x, u) => isNum(x) ? String(x) + (u || '') : 'TBD';
    const W = 640, H = 290, gy = 236, lx = 110, hx = 560, topY = 60;
    let s = open(W, H, 'GPS Rescue trajectory — ' + (p.name || 'client'),
      'Link lost, after ' + v(p.delayS, ' s') + ' the client climbs ' + v(p.climbM, ' m') + ' (' + (p.altMode || 'TBD') + '), cruises home at ' + v(p.returnAltM, ' m') + ' and '
      + v(p.speedMs, ' m/s') + ', starts the descent ' + v(p.descentDistM, ' m') + ' from home at ' + v(p.descentRateMs, ' m/s') + ', landing phase from ' + v(p.landingAltM, ' m')
      + '. Needs ' + v(p.minSats) + '+ satellites; does not start within ' + v(p.minDistM, ' m') + ' of home.',
      ' class="man-svg mw-560"');
    s += '<rect x="0" y="' + gy + '" width="' + W + '" height="' + (H - gy) + '" fill="var(--surface)"/>'
      + '<line x1="40" y1="' + gy + '" x2="' + (W - 20) + '" y2="' + gy + '" stroke="var(--border2)"/>'
      + '<line x1="40" y1="' + topY + '" x2="' + (W - 20) + '" y2="' + topY + '" stroke="var(--border2)" stroke-dasharray="4,7"/>';
    s += txt(36, topY + 4, v(p.returnAltM, ' m'), { size: 13, fill: 'var(--muted)', anchor: 'end' }) + txt(36, gy + 4, 'GND', { size: 13, fill: 'var(--muted)', anchor: 'end' });
    // Link-lost point (relative height is arbitrary: CURRENT_ALT climbs from wherever the client is).
    const ly = 168, cy = 120;
    s += '<use href="#sym-quad" x="' + (lx - 12) + '" y="' + (ly - 12) + '" width="24" height="24" class="q-accent"/>'
      + txt(lx, ly + 30, 'LINK LOST', { size: 13, fill: 'var(--red)', anchor: 'middle', weight: 'bold' })
      + txt(lx, ly + 46, '+ ' + v(p.delayS, ' s') + ' delay', { size: 13, fill: 'var(--red)', anchor: 'middle' });
    s += '<line x1="' + (lx - 26) + '" y1="' + ly + '" x2="' + (lx - 26) + '" y2="' + cy + '" stroke="var(--amber)" stroke-width="1.5"/>'
      + '<line x1="' + (lx - 31) + '" y1="' + ly + '" x2="' + (lx - 21) + '" y2="' + ly + '" stroke="var(--amber)"/>'
      + '<line x1="' + (lx - 31) + '" y1="' + cy + '" x2="' + (lx - 21) + '" y2="' + cy + '" stroke="var(--amber)"/>'
      + txt(lx - 32, (ly + cy) / 2 + 4, '+' + v(p.climbM, ' m'), { size: 13, fill: 'var(--amber)', anchor: 'end' });
    const dx = hx - 70;
    s += '<polyline points="' + lx + ',' + (ly - 14) + ' ' + lx + ',' + cy + ' ' + (lx + 30) + ',' + topY + ' ' + dx + ',' + topY + ' ' + (hx - 10) + ',' + (gy - 26) + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<line x1="' + (hx - 10) + '" y1="' + (gy - 26) + '" x2="' + hx + '" y2="' + gy + '" stroke="var(--red)" stroke-width="2" stroke-dasharray="4,3"/>'
      + '<circle cx="' + (hx - 10) + '" cy="' + (gy - 26) + '" r="4" fill="var(--red)"/>';
    s += txt((lx + dx) / 2, topY - 12, 'CRUISE HOME ' + v(p.speedMs, ' m/s') + ' AT ' + v(p.returnAltM, ' m') + ' REL', { size: 13, fill: 'var(--accent)', anchor: 'middle', weight: 'bold' })
      + txt(lx + 8, cy - 6, 'CLIMB (' + (p.altMode || 'TBD') + ')', { size: 13, fill: 'var(--accent)' })
      + txt(dx - 6, topY + 34, 'DESCENT ' + v(p.descentRateMs, ' m/s'), { size: 13, fill: 'var(--accent)', anchor: 'end' })
      + txt(dx - 6, topY + 52, 'from ' + v(p.descentDistM, ' m') + ' to home', { size: 13, fill: 'var(--accent)', anchor: 'end' })
      + txt(hx - 18, gy - 34, 'LANDING PHASE ' + v(p.landingAltM, ' m'), { size: 13, fill: 'var(--red)', anchor: 'end' });
    s += '<line x1="' + hx + '" y1="' + gy + '" x2="' + hx + '" y2="' + (gy - 22) + '" stroke="var(--text)" stroke-width="1.5"/>'
      + '<polygon points="' + hx + ',' + (gy - 22) + ' ' + (hx + 16) + ',' + (gy - 16) + ' ' + hx + ',' + (gy - 10) + '" fill="var(--text)"/>'
      + txt(hx, gy + 18, 'HOME', { size: 13, anchor: 'middle' })
      + txt(W / 2, H - 12, 'Needs ' + v(p.minSats) + '+ GPS sats · no rescue within ' + v(p.minDistM, ' m') + ' of home · not to scale', { size: 13, fill: 'var(--muted)', anchor: 'middle' });
    return s + '</svg>';
  }

  return { esc, niceTicks, mmss, cardinal, batteryGauge, battTrend, battSparkline, windCompass, timeChart, gpsRescue, MODE_FILL };
});
