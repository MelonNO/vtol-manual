'use strict';
// WP28 R2: safety-token lock for data/content.js. Used by wp28-safety-lock.test.js.
//
// For every content item (an object with an `id`; the top-level keys without one use their key) and every text
// field of it, extracts the safety tokens — IPs, parameter names, flight modes, TBD / VERIFY markers, numbers with
// their unit and {template} values — with the same patterns as the redesign programme's safety-token diff (each
// emergency IMMEDIATE step on its own, so their count and order are locked too). It also
// records the structure that copy edits must never change: item ids in order, and the w / copy / auto / priority /
// kind / primary flags. The result is compared with the committed fixture (fixtures/wp28-safety-lock.json).
//
// Regenerate the fixture ONLY for a change you justify in a report:   node test/content/safety-lock.js --write
// (the fixture of WP28 was generated from main's data/content.js before the WP28 copy pass).
const fs = require('node:fs');
const path = require('node:path');

const FIXTURE = path.join(__dirname, 'fixtures', 'wp28-safety-lock.json');
const UNITS = '(?:mAh|m/s|km/h|V/cell|V|ms|s|min|h|%|°|MHz|GHz|kHz|Hz|mW|W|dBm|dBi|dB|kg|g|km|m|mm|cm|A|S|px)';
const PATTERNS = [
  ['ip', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.(?:\d{1,3}|X)(?::\d+)?\b/g],
  ['tmpl', /\{(?:client|settings|clientPack)\.[A-Za-z0-9_.]+\}/g],
  ['param', /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g],
  ['mode', /\b(?:QHOVER|QLAND|QRTL|QLOITER|FBWA|FBWB|RTL|AUTO|LOITER|CRUISE|MANUAL|GUIDED|QLand|Loiter)\b/g],
  ['marker', /\b(?:TBD|VERIFY)\b/g],
  ['value', new RegExp('(?<![\\w.])\\d+(?:[.,]\\d+)?(?:\\s?' + UNITS + ')?(?![\\w.])', 'g')]
];
const FLAGS = ['w', 'copy', 'auto', 'priority', 'kind', 'primary', 'style'];

// Sorted token list of one text ("kind:token"); IPs, templates and params are blanked before the numbers are read.
function tokens(text) {
  let t = String(text);
  const out = [];
  for (const [kind, rx] of PATTERNS) {
    for (const m of t.matchAll(rx)) out.push(kind + ':' + m[0].replace(/\s+/g, ' '));
    if (kind === 'ip' || kind === 'tmpl' || kind === 'param') t = t.replace(rx, ' ');
  }
  return out.sort();
}

// All strings below v (arrays and objects without their own id), in order.
function texts(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => texts(x, out));
  else if (v && typeof v === 'object' && typeof v.id !== 'string') Object.keys(v).forEach(k => texts(v[k], out));
  return out;
}

// { tokens: { 'id/field': [...] }, structure: ['id flags', …] } of a VtolContent object.
function lock(C) {
  const tok = {}, structure = [];
  function item(obj, key) {
    const flags = FLAGS.filter(f => obj[f] !== undefined).map(f => f + '=' + obj[f]);
    structure.push(key + (flags.length ? ' ' + flags.join(' ') : ''));
    for (const f of Object.keys(obj)) {
      if (f === 'id') continue;
      if (f === 'immediate' && Array.isArray(obj[f])) {   // IMMEDIATE memory items: per step, so count and order are locked
        obj[f].forEach((step, i) => { tok[key + '/immediate#' + (i + 1)] = tokens(step); });
        continue;
      }
      const own = texts(obj[f], []);
      const list = [].concat(...own.map(tokens)).sort();
      if (list.length) tok[key + '/' + f] = list;
      walk(obj[f]);   // nested items with their own id
    }
  }
  function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string') item(v, v.id);
      else Object.keys(v).forEach(k => walk(v[k]));
    }
  }
  for (const k of Object.keys(C)) {
    const v = C[k];
    if (v && typeof v === 'object' && typeof v.id === 'string') item(v, v.id);
    else if (typeof v === 'string' || typeof v === 'number') { const list = tokens(v); if (list.length) tok['$' + k] = list; }
    else if (k === 'pipelines') Object.keys(v).forEach(p => { tok['$pipelines.' + p] = tokens(v[p]); });
    else walk(v);
  }
  return { tokens: tok, structure };
}

module.exports = { FIXTURE, tokens, lock };

if (require.main === module && process.argv.includes('--write')) {
  const C = require('../../data/content.js');
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, JSON.stringify(lock(C), null, 1) + '\n');
  console.log('wrote ' + FIXTURE);
}
