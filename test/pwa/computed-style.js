'use strict';
// WP09 R2 helper: computed styles of key elements of each page, for the "no visual change" check of css/base.css.
// jsdom computes the cascade but does not substitute var(): every same-origin stylesheet (<link> and <style>) is
// inlined and var(--x[, fallback]) is replaced by the value of the :root custom property (the only place the pages
// define tokens; :root rules inside @media or with extra selectors such as [data-sun] are ignored, i.e. the default
// screen look). Scripts are not run. jsdom is optional (not a repo dependency): see base-css.test.js.
const fs = require('node:fs');
const path = require('node:path');
const { toLf } = require('../repo-files.js');

// Ten key elements per page (static markup, present without scripts) and the properties compared.
const PAGES = {
  'index.html': ['body', 'header', '.hdr-title', '.hdr-meta', 'nav button', '.nav-manual-btn', '.content', '.section-title', '.card', '.cl-hdr-title', 'footer'],
  'manual.html': ['body', 'header', '.hdr-title', '.hdr-meta', 'nav button', '.nav-tools-btn', '.content', '.card', 'td', '.warn-val', 'footer'],
  'relay/map.html': ['body', '#hdr', '.hdr-title', '.hs', '.nav-btn', '#sb', '.pnl', '.pnl h2', '.info-txt', '.btn', '#cursor-bar'],
  'tools/latency-clock.html': ['body', '.title', '.btn', '#clock', '.box', '.k', '.card', '.card h2', 'li', 'label', 'input[type=number]']
};
const PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'border-top-color', 'border-bottom-color', 'border-left-color', 'border-left-width', 'padding-top', 'padding-left', 'margin-top'];

// :root custom properties declared by plain top-level `:root{…}` rules, in source order (later wins).
function rootTokens(cssTexts) {
  const tokens = {};
  for (const css of cssTexts) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0, i = 0;
    while (i < flat.length) {
      const open = flat.indexOf('{', i);
      if (open < 0) break;
      const sel = flat.slice(i, open).replace(/^[\s\S]*[};]/, '').trim();
      // find the matching close brace
      let j = open + 1; depth = 1;
      while (j < flat.length && depth) { if (flat[j] === '{') depth++; else if (flat[j] === '}') depth--; j++; }
      const body = flat.slice(open + 1, j - 1);
      if (sel === ':root' && body.indexOf('{') < 0) {
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) tokens[m[1]] = m[2].trim();
      }
      i = j;
    }
  }
  return tokens;
}

// var(--x) / var(--x, fallback) → token value (nested vars resolved too).
function substitute(css, tokens) {
  let prev;
  do {
    prev = css;
    css = css.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m, name, fb) => (name in tokens ? tokens[name] : (fb !== undefined ? fb.trim() : m)));
  } while (css !== prev);
  return css;
}

// Every stylesheet of the page in document order: [{ kind: 'link'|'style', css }].
function sheets(rootDir, page, html) {
  const out = [];
  const re = /<link\b[^>]*rel="stylesheet"[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/g;
  for (const m of html.matchAll(re)) {
    if (m[0].startsWith('<link')) {
      const href = (m[0].match(/href="([^"]+)"/) || [])[1];
      const media = (m[0].match(/media="([^"]+)"/) || [])[1];
      if (!href || /^https?:/.test(href) || (media && media !== 'all' && media !== 'screen')) continue;
      const f = path.resolve(rootDir, path.dirname(page), href);
      out.push({ kind: 'link', css: fs.existsSync(f) ? toLf(fs.readFileSync(f, 'utf8')) : '' });
    } else out.push({ kind: 'style', css: m[1] });
  }
  return out;
}

// { selector: { prop: value } } for one page under rootDir.
function computeKeyStyles(rootDir, page, JSDOM) {
  let html = toLf(fs.readFileSync(path.join(rootDir, page), 'utf8'));
  const list = sheets(rootDir, page, html);
  const tokens = rootTokens(list.map(s => s.css));
  // Remove scripts, links and styles; re-insert every stylesheet as one resolved <style> block in the same order.
  html = html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  const css = list.map(s => substitute(s.css.replace(/@import[^;]+;/g, ''), tokens)).join('\n');
  html = html.replace(/<head>/i, '<head><style>' + css + '</style>');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const w = dom.window, out = {};
  for (const sel of PAGES[page]) {
    const el = w.document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = w.getComputedStyle(el), o = {};
    for (const p of PROPS) o[p] = cs.getPropertyValue(p);
    out[sel] = o;
  }
  dom.window.close();
  return out;
}

// jsdom from $VTOL_JSDOM (path to the jsdom package), a normal require, or null.
function loadJsdom() {
  const tries = [process.env.VTOL_JSDOM, 'jsdom'].filter(Boolean);
  for (const t of tries) { try { return require(t).JSDOM; } catch (e) { /* next */ } }
  return null;
}

module.exports = { PAGES, PROPS, rootTokens, substitute, computeKeyStyles, loadJsdom };

// Fixture writer: node test/pwa/computed-style.js <rootDir> <out.json>  (run once on the pre-WP09 tree)
if (require.main === module) {
  const JSDOM = loadJsdom();
  if (!JSDOM) { console.error('set VTOL_JSDOM to the jsdom package path'); process.exit(2); }
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
  const res = {};
  for (const p of Object.keys(PAGES)) res[p] = computeKeyStyles(root, p, JSDOM);
  const txt = JSON.stringify(res, null, 1) + '\n';
  if (process.argv[3]) fs.writeFileSync(process.argv[3], txt); else process.stdout.write(txt);
}
