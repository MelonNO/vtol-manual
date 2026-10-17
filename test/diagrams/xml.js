'use strict';
// Minimal XML well-formedness checker for the diagram tests (no npm dependencies allowed).
// Checks: one root element, balanced and correctly nested tags, quoted and unique attributes, no '<' in attribute
// values, valid entity / character references, comments without '--', no stray '<' or '&' in text.
// Returns { ok: true, root } or { ok: false, error }.
const NAME = /^[A-Za-z_:][\w.:-]*$/;
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;

function checkText(t, at) {
  if (t.indexOf('<') >= 0) return 'stray "<" at ' + at;
  for (let i = t.indexOf('&'); i >= 0; i = t.indexOf('&', i + 1)) if (!ENTITY.test(t.slice(i))) return 'bad entity at ' + (at + i) + ': ' + t.slice(i, i + 12);
  return null;
}

function wellFormed(src) {
  let s = String(src), i = 0, root = null, rootClosed = false;
  const stack = [];
  const fail = e => ({ ok: false, error: e });
  if (s.startsWith('<?xml')) { const e = s.indexOf('?>'); if (e < 0) return fail('unterminated XML declaration'); i = e + 2; }
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const text = s.slice(i, lt < 0 ? s.length : lt);
    const te = checkText(text, i);
    if (te) return fail(te);
    if (text.trim() && !stack.length) return fail('text outside the root element at ' + i);
    if (lt < 0) break;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt + 4);
      if (e < 0) return fail('unterminated comment at ' + lt);
      const body = s.slice(lt + 4, e);
      if (body.indexOf('--') >= 0 || body.endsWith('-')) return fail('"--" inside a comment at ' + lt);
      i = e + 3; continue;
    }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); if (e < 0) return fail('unterminated CDATA'); i = e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); if (e < 0) return fail('unterminated PI'); i = e + 2; continue; }
    if (s.startsWith('<!', lt)) return fail('DOCTYPE / declaration not expected at ' + lt);
    // tag: find the closing '>' outside quotes
    let j = lt + 1, q = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === q) q = null; else if (c === '<') return fail('"<" in attribute value at ' + j); }
      else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
    }
    if (j >= s.length) return fail('unterminated tag at ' + lt);
    let tag = s.slice(lt + 1, j);
    i = j + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) return fail('end tag </' + name + '> does not match <' + open + '> at ' + lt);
      if (!stack.length) rootClosed = true;
      continue;
    }
    const selfClose = tag.endsWith('/');
    if (selfClose) tag = tag.slice(0, -1);
    const m = tag.match(/^([^\s/>]+)([\s\S]*)$/);
    if (!m || !NAME.test(m[1])) return fail('bad tag name at ' + lt + ': ' + tag.slice(0, 20));
    if (rootClosed) return fail('second root element <' + m[1] + '>');
    const seen = new Set();
    let rest = m[2];
    const ATTR = /^\s+([A-Za-z_:][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/;
    for (;;) {
      if (!rest.trim()) break;
      const a = rest.match(ATTR);
      if (!a) return fail('bad attribute syntax in <' + m[1] + '> at ' + lt + ': ' + rest.trim().slice(0, 30));
      if (seen.has(a[1])) return fail('duplicate attribute ' + a[1] + ' in <' + m[1] + '>');
      seen.add(a[1]);
      const ve = checkText(a[3] !== undefined ? a[3] : a[4], lt);
      if (ve) return fail('attribute ' + a[1] + ': ' + ve);
      rest = rest.slice(a[0].length);
    }
    if (!root) root = m[1];
    if (!selfClose) stack.push(m[1]);
    else if (!stack.length) rootClosed = true;
  }
  if (stack.length) return fail('unclosed <' + stack[stack.length - 1] + '>');
  if (!root) return fail('no root element');
  return { ok: true, root };
}

module.exports = { wellFormed };
