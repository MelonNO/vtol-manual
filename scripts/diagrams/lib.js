'use strict';
// Tiny SVG authoring helpers for img/diagrams/*.svg (WP07). Output is plain, hand-editable SVG.
const P = { bg: '#0f0f0f', surf: '#1a1a1a', surf2: '#222222', border: '#2a2a2a', border2: '#333333', text: '#e8e8e8',
  muted: '#777777', accent: '#f97316', amber: '#facc15', red: '#ef4444', green: '#22c55e', dim: '#444444' };
const NAME = Object.fromEntries(Object.entries(P).map(([k, v]) => [v, k]));
const CW = 0.6;          // monospace advance estimate (em)
const MINF = 14;         // minimum font size in these 400-wide diagrams
const warnings = [];
let cur = '';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r = v => Math.round(v * 10) / 10;
const tw = (s, size) => String(s).length * size * CW;

function check(s, size, avail, where) {
  if (size < MINF) warnings.push(cur + ': font ' + size + ' < ' + MINF + ' "' + s + '"');
  if (avail != null && tw(s, size) > avail + 0.5) warnings.push(cur + ': overflow ' + Math.round(tw(s, size)) + '>' + Math.round(avail) + ' "' + s + '" ' + (where || ''));
}

// Text. o: size, fill, anchor (start|middle|end), weight, maxw (width check)
function t(x, y, s, o = {}) {
  const size = o.size || MINF;
  check(s, size, o.maxw, '');
  return '<text x="' + r(x) + '" y="' + r(y) + '"' + (size !== MINF ? ' font-size="' + size + '"' : '') + (o.fill && o.fill !== P.text ? ' fill="' + o.fill + '"' : '')
    + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.weight ? ' font-weight="' + o.weight + '"' : '') + (o.italic ? ' font-style="italic"' : '') + '>' + esc(s) + '</text>';
}
function lines(x, y, arr, o = {}) {
  const size = o.size || MINF, lh = o.lh || Math.round(size * 1.3);
  return arr.map((s, i) => {
    const it = typeof s === 'string' ? { s } : s;
    return t(x, y + i * lh, it.s, Object.assign({}, o, it.o || {}));
  }).join('');
}
// Box with an optional bold title and centred (or left) lines.
function box(x, y, w, h, o = {}) {
  const size = o.size || MINF, lh = o.lh || Math.round(size * 1.3), pad = 6;
  let s = '<rect x="' + r(x) + '" y="' + r(y) + '" width="' + r(w) + '" height="' + r(h) + '" rx="' + (o.rx == null ? 3 : o.rx) + '" fill="' + (o.fill || P.surf2) + '" stroke="' + (o.stroke || P.border2) + '"'
    + (o.sw ? ' stroke-width="' + o.sw + '"' : '') + (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + '/>';
  const items = [];
  if (o.title) items.push({ s: o.title, o: { weight: 'bold', fill: o.titleFill || P.text } });
  (o.lines || []).forEach(l => items.push(typeof l === 'string' ? { s: l, o: { fill: o.lineFill || P.text } } : l));
  const total = items.length * lh;
  const left = o.align === 'left';
  let yy = o.top != null ? y + o.top : y + (h - total) / 2 + size * 0.8;
  items.forEach(it => {
    s += t(left ? x + pad + 2 : x + w / 2, yy, it.s, Object.assign({ size, anchor: left ? undefined : 'middle', maxw: w - 2 * pad }, it.o || {}));
    yy += lh;
  });
  return s;
}
// Group frame with a label in its top-left corner.
function group(x, y, w, h, label, o = {}) {
  return '<rect x="' + r(x) + '" y="' + r(y) + '" width="' + r(w) + '" height="' + r(h) + '" rx="4" fill="' + (o.fill || 'none') + '" stroke="' + (o.stroke || P.dim) + '"' + (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + '/>'
    + (label ? t(x + 8, y + 20, label, { weight: 'bold', fill: o.labelFill || P.muted, maxw: w - 16 }) : '');
}
// Line / polyline with arrowheads. o: c, w, dash, end (default true), start
function line(pts, o = {}) {
  const c = o.c || P.text, n = NAME[c] || 'text';
  const end = o.end === undefined ? true : o.end;
  return '<polyline points="' + pts.map(p => r(p[0]) + ',' + r(p[1])).join(' ') + '" fill="none" stroke="' + c + '" stroke-width="' + (o.w || 2) + '"'
    + (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + ' stroke-linejoin="round"'
    + (end ? ' marker-end="url(#ah-' + n + ')"' : '') + (o.start ? ' marker-start="url(#ah-' + n + ')"' : '') + '/>';
}
// Small pill label with background (for link labels over lines).
function pill(x, y, s, o = {}) {
  const size = o.size || MINF, w = tw(s, size) + 10, h = size + 8;
  const ax = o.anchor === 'start' ? x : o.anchor === 'end' ? x - w : x - w / 2;
  return '<rect x="' + r(ax) + '" y="' + r(y - h / 2) + '" width="' + r(w) + '" height="' + h + '" rx="3" fill="' + (o.fill || P.surf) + '" stroke="' + (o.stroke || 'none') + '"/>'
    + t(ax + w / 2, y + size * 0.35, s, { size, fill: o.c || P.text, anchor: 'middle', weight: o.weight });
}

function markers() {
  return '<defs>' + Object.entries(P).map(([k, v]) =>
    '<marker id="ah-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + v + '"/></marker>').join('') + '</defs>';
}

const PALETTE_COMMENT = '<!-- Palette: standalone SVG cannot read the page CSS variables, so it uses the same values as the :root tokens in css/base.css (muted: the manual value).\n'
  + '     Token names below are the CSS custom properties without their two leading dashes (XML comments may not contain a double dash):\n'
  + '     #0f0f0f = bg · #1a1a1a = surface · #222222 = surface2 · #333333 = border2 · #444444 = dim · #2a2a2a = border\n'
  +'     #e8e8e8 = text · #777777 = muted · #f97316 = accent · #facc15 = amber · #ef4444 = red · #22c55e = green -->';

function doc(file, o) {
  const w = o.w || 400, h = o.h;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" role="img" aria-labelledby="title desc"'
    + ' font-family="\'Share Tech Mono\', Consolas, \'DejaVu Sans Mono\', Menlo, monospace" font-size="' + MINF + '" fill="' + P.text + '">\n'
    + '<title id="title">' + esc(o.title) + '</title>\n<desc id="desc">' + esc(o.desc) + '</desc>\n' + PALETTE_COMMENT + '\n'
    + '<!-- ' + esc(o.source || '') + ' -->\n'
    + markers() + '\n<rect width="' + w + '" height="' + h + '" fill="' + P.surf + '"/>\n'
    + t(14, 28, o.heading, { size: 17, weight: 'bold', fill: P.accent, maxw: w - 28 }) + '\n'
    + (o.sub ? lines(14, 50, [].concat(o.sub), { fill: P.muted, maxw: w - 28 }) + '\n' : '')
    + o.body.join('\n') + '\n</svg>\n';
}

module.exports = { P, t, lines, box, group, line, pill, doc, warnings, setCur: n => { cur = n; }, tw, MINF };
