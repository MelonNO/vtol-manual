'use strict';
// Computed styles of page elements in jsdom (WP09 R2; since WP23 used by test/design/components.test.js).
// jsdom computes the cascade but does not substitute var(): every same-origin stylesheet (<link> and <style>) is
// inlined and var(--x[, fallback]) is replaced by the value of the :root custom property (the only place the pages
// define tokens). Plain top-level :root rules give the default look; with { sun: true } the :root[data-sun] overrides
// are applied on top (sunlight mode). Scripts are not run. jsdom is optional (not a repo dependency): see loadJsdom().
// The WP09 snapshot of the pre-WP09 look (fixtures/computed-before.json, "no visual change") was retired by the owner
// decision of 2026-10-18 (redesign; docs/tasks/04-REDESIGN-CONTEXT.md §1).
const fs = require('node:fs');
const path = require('node:path');
const { toLf } = require('../repo-files.js');

// Custom properties declared by top-level rules whose selector is exactly `sel` (default ':root'), in source order
// (later wins). Rules inside @media and rules with other selectors are ignored.
function rootTokens(cssTexts, sel = ':root') {
  const tokens = {};
  for (const css of cssTexts) {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let i = 0;
    while (i < flat.length) {
      const open = flat.indexOf('{', i);
      if (open < 0) break;
      const s = flat.slice(i, open).replace(/^[\s\S]*[};]/, '').trim();
      let j = open + 1, depth = 1;   // find the matching close brace
      while (j < flat.length && depth) { if (flat[j] === '{') depth++; else if (flat[j] === '}') depth--; j++; }
      const body = flat.slice(open + 1, j - 1);
      if (s === sel && body.indexOf('{') < 0) {
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) tokens[m[1]] = m[2].trim();
      }
      i = j;
    }
  }
  return tokens;
}

// The token set of a mode: the :root tokens, plus (sun) the :root[data-sun] overrides.
function modeTokens(cssTexts, sun) {
  return sun ? { ...rootTokens(cssTexts), ...rootTokens(cssTexts, ':root[data-sun]') } : rootTokens(cssTexts);
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

// Every screen stylesheet of the page in document order: [{ kind: 'link'|'style', css }].
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

// { selector: { prop: value } | null } for one page under rootDir. `extraHtml` is appended to <body> (fixture
// elements that the page only renders from script, e.g. a callout).
function computeStyles(rootDir, page, JSDOM, selectors, props, opts = {}) {
  let html = toLf(fs.readFileSync(path.join(rootDir, page), 'utf8'));
  const list = sheets(rootDir, page, html);
  const tokens = modeTokens(list.map(s => s.css), opts.sun);
  // Remove scripts, links and styles; re-insert every stylesheet as one resolved <style> block in the same order.
  html = html.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
  const css = list.map(s => substitute(s.css.replace(/@import[^;]+;/g, ''), tokens)).join('\n');
  html = html.replace(/<head>/i, '<head><style>' + css + '</style>');
  if (opts.extraHtml) html = html.replace(/<\/body>/i, opts.extraHtml + '</body>');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const w = dom.window, out = {};
  for (const sel of selectors) {
    const el = w.document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const cs = w.getComputedStyle(el), o = {};
    for (const p of props) o[p] = cs.getPropertyValue(p);
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

module.exports = { rootTokens, modeTokens, substitute, sheets, computeStyles, loadJsdom };
