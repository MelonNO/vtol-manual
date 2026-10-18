'use strict';
// Helpers for the design-system tests (WP23): CSS selector lists, the components section of css/base.css, WCAG
// contrast. Plain Node, no packages.
const { readText } = require('../repo-files.js');

const COMP_START = '/* ── 4. COMPONENTS', COMP_END = '/* ── end of components ── */';

// The components section of css/base.css (text between the two markers).
function componentsCss(css = readText('css/base.css')) {
  const a = css.indexOf(COMP_START), b = css.indexOf(COMP_END);
  if (a < 0 || b < a) throw new Error('css/base.css: components section markers not found');
  return css.slice(a, b);
}

// Every selector of a stylesheet, normalised (whitespace collapsed), including those inside @media / @supports.
// @keyframes rules count as one selector "@keyframes <name>"; their from / to / % steps are skipped.
function selectors(css) {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  let i = 0;
  const walk = (start, end) => {
    i = start;
    while (i < end) {
      const open = flat.indexOf('{', i);
      if (open < 0 || open >= end) break;
      const pre = flat.slice(i, open).replace(/^[\s\S]*[};]/, '').trim();
      let j = open + 1, depth = 1;
      while (j < end && depth) { if (flat[j] === '{') depth++; else if (flat[j] === '}') depth--; j++; }
      if (/^@(media|supports)\b/.test(pre)) { walk(open + 1, j - 1); }
      else if (/^@keyframes\b/.test(pre)) out.add(pre.replace(/\s+/g, ' '));
      else if (pre && !pre.startsWith('@')) for (const s of splitTop(pre)) { const n = s.trim().replace(/\s*([>+~])\s*/g, ' $1 ').replace(/\s+/g, ' '); if (n) out.add(n); }
      i = j;
    }
  };
  walk(0, flat.length);
  return out;
}

// Split a selector list on its top-level commas (not those inside :is() / :where() / :not()).
function splitTop(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  return out.concat(cur);
}

// The <style> blocks of a page, joined.
function pageStyles(html) { return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'); }

// '#rgb' / '#rrggbb' / 'rgba(r,g,b,a)' → [r, g, b, a]
function parseColour(c) {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { let h = m[1]; if (h.length === 3) h = h.replace(/./g, x => x + x); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)).concat(1); }
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error('not a colour: ' + c);
}
// A translucent colour composited over an opaque one.
function over(fg, bg) { const a = fg[3]; return [0, 1, 2].map(k => fg[k] * a + bg[k] * (1 - a)).concat(1); }
function luminance(rgb) {
  const [r, g, b] = rgb.slice(0, 3).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// WCAG 2 contrast ratio of two colours (strings or arrays); a translucent background is composited over `base`.
function contrast(fg, bg, base) {
  let f = typeof fg === 'string' ? parseColour(fg) : fg, b = typeof bg === 'string' ? parseColour(bg) : bg;
  if (b[3] < 1) b = over(b, typeof base === 'string' ? parseColour(base) : base);
  if (f[3] < 1) f = over(f, b);
  const [x, y] = [luminance(f), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

module.exports = { COMP_START, COMP_END, componentsCss, selectors, pageStyles, parseColour, contrast };
