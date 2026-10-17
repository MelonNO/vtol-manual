// Internal link and asset check (WP10 R1). Plain Node, no packages.
//   node scripts/check-links.mjs        exit 1 and list every broken internal reference
//
// Checked:
//   - every HTML page (src / href / srcset / CSS url(), same parser as the precache test: test/pwa/assets.js):
//     the file exists; a fragment (#x, page.html#x) resolves in the target page (see fragmentOk); SVG <use href="#x">
//   - every stylesheet (url()), the web manifest, and the quoted asset paths in page scripts (js/, data/, relay/)
//   - every Markdown file: relative links [text](path) and the files they point to
// External URLs (http:, https:, mailto:, data:) are not fetched: the suite must work offline, and CI must not
// depend on third-party sites.
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { ROOT, isMain, readText, repoFiles, report } from './check-lib.mjs';

const require = createRequire(import.meta.url);
const { htmlRefsFromText, resolveRef } = require('../test/pwa/assets.js');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const exists = (root, rel) => existsSync(join(root, rel));

// Same rules as test/pwa/assets.js (cssRefs / manifestRefs / scriptRefs), reading from `root`.
function cssRefs(root, f) {
  return [...readText(f, root).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
    .map(m => ({ ref: m[1], path: resolveRef(f, m[1]) }));
}
function manifestRefs(root, f) {
  const m = JSON.parse(readText(f, root)), refs = [];
  (m.icons || []).forEach(i => refs.push(i.src));
  refs.push(m.start_url);
  (m.shortcuts || []).forEach(s => { refs.push(s.url); (s.icons || []).forEach(i => refs.push(i.src)); });
  return refs.filter(Boolean).map(ref => ({ ref, path: resolveRef(f, ref) }));
}
function scriptRefs(root, f) {
  return [...readText(f, root).matchAll(/['"`]((?:\.\.?\/)?(?:img|icons|fonts|css|js|data|relay|tools)\/[\w./-]+\.(?:svg|png|webp|jpe?g|woff2|css|js|html))['"`]/g)]
    .map(m => ({ ref: m[1], path: posix.normalize(m[1].startsWith('.') ? posix.join(posix.dirname(f), m[1]) : m[1]) }));
}

// The local scripts a page loads (for hash routes that its code handles).
function pageScripts(page, html) {
  return [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)]
    .map(m => posix.normalize(posix.join(posix.dirname(page), m[1])))
    .filter(p => !EXTERNAL.test(p));
}

// A fragment of `page` is fine when it names an element id, a tab panel (manual/Tools deep links: #emergency →
// #tab-emergency, #tab/anchor), or a hash route that the page's own code handles (a quoted literal such as
// '#emergency-only' in the page's inline scripts or in one of its local scripts).
function fragmentOk(root, page, frag, cache) {
  if (!frag) return true;
  if (!cache.has(page)) {
    const html = readText(page, root);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const code = [...inline, ...pageScripts(page, html).filter(s => exists(root, s)).map(s => readText(s, root))].join('\n');
    cache.set(page, { ids, code });
  }
  const { ids, code } = cache.get(page);
  const f = decodeURIComponent(frag), first = f.split('/')[0];
  if (ids.has(f) || ids.has(first) || ids.has('tab-' + first)) return true;
  if (f.includes('/') && (ids.has(f.split('/').pop()))) return true;
  const lit = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"\`]#?${lit}['"\`/]`).test(code);
}

// Markdown links outside code (fenced blocks and inline code are skipped).
function markdownLinks(text) {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
  return [...prose.matchAll(/\[(?:[^\]\n]|\][^(\n])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map(m => m[1]);
}

export function checkLinks(root = ROOT) {
  const files = repoFiles(root), problems = [], cache = new Map();
  const pages = files.filter(f => f.endsWith('.html'));
  for (const page of pages) {
    const html = readText(page, root);
    for (const r of htmlRefsFromText(page, html)) {
      if (!exists(root, r.path)) problems.push(`${page}: "${r.ref}" → ${r.path} does not exist`);
    }
    // fragments: <a href="#x">, <a href="page.html#x">, SVG <use href="#x">
    const noScript = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    for (const m of noScript.matchAll(/<(a|use)\b[^>]*\s(?:xlink:)?href="([^"]*#[^"]*)"/g)) {
      const [target, frag] = m[2].split('#');
      if (EXTERNAL.test(target)) continue;
      const tpage = target ? posix.normalize(posix.join(posix.dirname(page), target)) : page;
      if (!exists(root, tpage)) continue;                                  // reported above as a missing file
      if (tpage.endsWith('.html') && !fragmentOk(root, tpage, frag, cache)) problems.push(`${page}: "${m[2]}" → no id or route "${frag}" in ${tpage}`);
    }
  }
  for (const f of files) {
    let refs = [];
    if (f.endsWith('.css')) refs = cssRefs(root, f);
    else if (f.endsWith('.webmanifest')) refs = manifestRefs(root, f);
    else if (/^(js|data|relay)\/.*\.js$/.test(f) && !f.includes('/vendor/')) refs = scriptRefs(root, f);
    for (const r of refs) if (r.path && !exists(root, r.path)) problems.push(`${f}: "${r.ref}" → ${r.path} does not exist`);
  }
  for (const md of files.filter(f => f.endsWith('.md'))) {
    for (const link of markdownLinks(readText(md, root))) {
      if (EXTERNAL.test(link) || link.startsWith('#')) continue;
      const [target, frag] = link.split('#');
      const rel = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(md), decodeURIComponent(target)));
      if (!exists(root, rel)) { problems.push(`${md}: link "${link}" → ${rel} does not exist`); continue; }
      if (frag && rel.endsWith('.html') && statSync(join(root, rel)).isFile() && !fragmentOk(root, rel, frag, cache)) {
        problems.push(`${md}: link "${link}" → no id or route "${frag}" in ${rel}`);
      }
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  report('check-links', checkLinks(), 'every internal link and asset resolves');
}
