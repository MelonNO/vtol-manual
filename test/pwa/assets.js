'use strict';
// WP09 R3 helper: every same-origin asset referenced by the precached pages, stylesheets, manifest and scripts.
const path = require('node:path');
const { readText } = require('../repo-files.js');

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;   // absolute URLs (http:, data:, mailto:, javascript:), protocol-relative, anchors
const norm = p => path.posix.normalize(p).replace(/^\.\//, '');

// Repo-relative path of a reference `ref` made from file `from` (repo-relative), or null when it is not a local asset.
function resolveRef(from, ref) {
  ref = String(ref).trim().replace(/[?#].*$/, '');
  if (SKIP.test(ref)) return null;
  return norm(path.posix.join(path.posix.dirname(from), ref));
}

// [{ from, ref, path, picture }] for one HTML page. picture: an <img> fallback inside <picture> next to a .webp <source>.
function htmlRefs(file) {
  // comments and inline script bodies are dropped (script code builds markup strings, not static references)
  const html = readText(file).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g, '<script$1></script>');
  const out = [];
  const add = (ref, picture) => { const p = resolveRef(file, ref); if (p) out.push({ from: file, ref, path: p, picture: !!picture }); };
  // <picture> blocks first, so their <img> fallbacks are known
  const pictureImgs = new Set();
  for (const m of html.matchAll(/<picture\b[\s\S]*?<\/picture>/g)) {
    if (/type="image\/webp"|\.webp/.test(m[0])) for (const i of m[0].matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)) pictureImgs.add(i[1]);
  }
  for (const m of html.matchAll(/<(?:script|img|source|link|a|iframe|video|audio)\b[^>]*>/g)) {
    const tag = m[0];
    for (const a of tag.matchAll(/\s(src|href)="([^"]*)"/g)) add(a[2], a[1] === 'src' && pictureImgs.has(a[2]));
    for (const a of tag.matchAll(/\ssrcset="([^"]*)"/g)) a[1].split(',').forEach(c => add(c.trim().split(/\s+/)[0]));
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) cssUrls(m[1]).forEach(u => add(u));
  return out;
}

function cssUrls(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(m => m[1]);
}
function cssRefs(file) {
  return cssUrls(readText(file)).map(ref => ({ from: file, ref, path: resolveRef(file, ref) })).filter(r => r.path);
}
function manifestRefs(file) {
  const m = JSON.parse(readText(file)), refs = [];
  const add = ref => { const p = resolveRef(file, ref); if (p) refs.push({ from: file, ref, path: p }); };
  (m.icons || []).forEach(i => add(i.src));
  add(m.start_url);
  (m.shortcuts || []).forEach(s => { add(s.url); (s.icons || []).forEach(i => add(i.src)); });
  return refs;
}
// Quoted relative asset paths in scripts (e.g. 'img/x.svg'); the service-worker scripts themselves are excluded.
function scriptRefs(file) {
  const out = [];
  for (const m of readText(file).matchAll(/['"`]((?:\.\.?\/)?(?:img|icons|fonts|css|js|data|relay|tools)\/[\w./-]+\.(?:svg|png|webp|jpe?g|woff2|css|js|html))['"`]/g)) {
    out.push({ from: file, ref: m[1], path: norm(m[1].startsWith('.') ? path.posix.join(path.posix.dirname(file), m[1]) : m[1]) });
  }
  return out;
}

// Every reference from the precached files. list: the precache list ('./x').
function allRefs(list) {
  const files = list.filter(a => a !== './').map(a => a.slice(2));
  const refs = [];
  for (const f of files) {
    if (f.endsWith('.html')) refs.push(...htmlRefs(f));
    else if (f.endsWith('.css')) refs.push(...cssRefs(f));
    else if (f.endsWith('.webmanifest')) refs.push(...manifestRefs(f));
    else if (f.endsWith('.js') && !f.includes('/vendor/')) refs.push(...scriptRefs(f));
  }
  return refs;
}

module.exports = { resolveRef, htmlRefs, cssRefs, manifestRefs, scriptRefs, allRefs };
