// Colour lint for inline SVG and inline styles (WP10 R1; CLAUDE.md "Style conventions"). Plain Node, no packages.
//   node scripts/check-colours.mjs      exit 1 and list every hard-coded colour found
//
// Pages read their colours from the CSS variables in css/base.css (`fill="var(--accent)"`), so the sunlight mode and
// any palette change reach every drawing. This check fails on:
//   1. a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa) in any SVG element tag, in page markup or in a JS string that
//      builds SVG (the pages' inline scripts, js/*.js, data/*.js, relay/*.js);
//   2. a hex colour in an inline style="…" attribute in page markup.
// Exempt: standalone SVG files (img/**/*.svg, icons/): they cannot read page variables and use the same hex values as
// the tokens, with a palette comment (img/README.md). Vendored libraries and the archived manual are not checked.
import { ROOT, isMain, readText, repoFiles, report } from './check-lib.mjs';

const SVG_TAGS = 'svg|g|path|circle|ellipse|rect|line|polyline|polygon|text|tspan|use|symbol|defs|marker|pattern|' +
  'linearGradient|radialGradient|stop|mask|clipPath|filter|fe[A-Za-z]+|foreignObject|image';
const SVG_TAG = new RegExp(`<(?:${SVG_TAGS})\\b[^<>]*>`, 'g');
// A hex colour: '#', 3/4/6/8 hex digits, not part of a longer word; never an id reference (href="#…", url(#…)).
const HEX = /(?<!href=["']|url\()#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const SKIP = f => f.startsWith('archive/') || f.includes('/vendor/');

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

export function checkColours(root = ROOT) {
  const files = repoFiles(root).filter(f => !SKIP(f));
  const problems = [];
  const code = files.filter(f => f.endsWith('.html') || /^(js|data|relay)\/.*\.js$/.test(f));
  for (const f of code) {
    const text = readText(f, root);
    for (const tag of text.matchAll(SVG_TAG)) {
      for (const h of tag[0].matchAll(HEX)) problems.push(`${f}:${lineOf(text, tag.index)}: hex colour ${h[0]} in SVG <${tag[0].slice(1, 40).split(/[\s>]/)[0]}> — use var(--token)`);
    }
    if (f.endsWith('.html')) {
      for (const st of text.matchAll(/\sstyle="([^"]*)"/g)) {
        for (const h of st[1].matchAll(HEX)) problems.push(`${f}:${lineOf(text, st.index)}: hex colour ${h[0]} in an inline style — use var(--token)`);
      }
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  report('check-colours', checkColours(), 'no hard-coded colours in inline SVG or inline styles');
}
