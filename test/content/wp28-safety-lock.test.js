'use strict';
// WP28 R2: copy edits of data/content.js can never silently change a value. Every item's safety tokens (numbers with
// units, parameter names, modes, IPs, TBD / VERIFY markers, {template} values) and the item structure (ids in order,
// w / copy / auto / priority flags) must equal the committed fixture. See test/content/safety-lock.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const C = require('../../data/content.js');
const { FIXTURE, tokens, lock } = require('./safety-lock.js');

const clone = o => JSON.parse(JSON.stringify(o));
const FIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// Human-readable differences between two locks (empty = equal).
// A missing key and an empty list are different (a dropped token-free step must show).
function diff(a, b) {
  const out = [];
  if (JSON.stringify(a.structure) !== JSON.stringify(b.structure)) {
    const n = Math.max(a.structure.length, b.structure.length);
    for (let i = 0; i < n; i++) if (a.structure[i] !== b.structure[i]) { out.push('structure[' + i + ']: ' + a.structure[i] + ' ≠ ' + b.structure[i]); break; }
  }
  for (const part of ['immediate', 'cleanup', 'tokens']) {
    for (const k of new Set(Object.keys(a[part] || {}).concat(Object.keys(b[part] || {})))) {
      const x = JSON.stringify((a[part] || {})[k]), y = JSON.stringify((b[part] || {})[k]);
      if (x !== y) out.push(part + ' ' + k + ':\n    fixture: ' + y + '\n    content: ' + x);
    }
  }
  return out;
}

test('R2: the extractor finds every kind of safety token', () => {
  assert.deepEqual(tokens('After 5 s (FS_LONG_TIMEOUT = 5) → [[RTL]] / QRTL at 192.168.144.12:19856, {settings.battLowVolt} V, [[TBD — x]], 3.8V/cell'),
    ['ip:192.168.144.12:19856', 'marker:TBD', 'mode:QRTL', 'mode:RTL', 'param:FS_LONG_TIMEOUT', 'tmpl:{settings.battLowVolt}', 'value:3.8V/cell', 'value:5', 'value:5 s'].sort());
  assert.deepEqual(tokens('Keep the home landing zone clear.'), []);
});

test('R2: data/content.js matches the safety-token lock (values, params, modes, IPs, markers, ids, flags)', () => {
  const d = diff(lock(C), FIX);
  assert.deepEqual(d, [], 'safety tokens changed — justify each one in a report, then regenerate with `node test/content/safety-lock.js --write`:\n' + d.join('\n'));
  assert.ok(FIX.structure.length > 140 && Object.keys(FIX.tokens).length > 150, 'the fixture covers the whole content');
  assert.equal(Object.keys(FIX.immediate).length, C.emergencies.length + 1, 'every scenario + the 915 close-in steps');
  assert.equal(Object.values(FIX.immediate).flat().length, C.emergencies.reduce((n, e) => n + e.immediate.length, 0) + 1);
});

test('R2: the lock catches a changed value, a dropped marker, a reordered IMMEDIATE step and a removed warning flag', () => {
  const m1 = clone(C); m1.emergencies[0].immediate[1] = m1.emergencies[0].immediate[1].replace('5 s', '6 s');
  const m2 = clone(C); m2.network.rows.find(r => r.id === 'net-n6').ip = 'e.g. .20';
  const m3 = clone(C); const imm = m3.emergencies.find(e => e.id === 'emerg-batt').immediate; [imm[2], imm[3]] = [imm[3], imm[2]];
  const m4 = clone(C); delete m4.checklists.preflight.sections[0].items[0].w;
  const m5 = clone(C); m5.checklists.preflight.sections[2].items.reverse();
  const m6 = clone(C); m6.failsafeTable.rows[0].action = m6.failsafeTable.rows[0].action.replace('[[QRTL]]', '[[QLAND]]');
  // round-1 verification cases: token-free IMMEDIATE steps dropped or swapped, a token-free clean-up step dropped,
  // a checklist item removed, an IMMEDIATE step reworded
  const m7 = clone(C); m7.emergencies.find(e => e.id === 'emerg-batt').immediate.pop();   // "CLEAR AREA BELOW"
  const m8 = clone(C); const rc = m8.emergencies.find(e => e.id === 'emerg-client-rc').immediate; [rc[0], rc[1]] = [rc[1], rc[0]];
  const m9 = clone(C); m9.emergencies.find(e => e.id === 'emerg-batt').cleanup.splice(5, 1);   // "Inspect battery …" (no token)
  const m10 = clone(C); m10.checklists.preflight.sections[0].items.splice(1, 1);
  const m11 = clone(C); m11.emergencies[0].immediate[3] = 'NOMAD (915) IF CLOSE';
  const m12 = clone(C); const cu = m12.emergencies.find(e => e.id === 'emerg-trans').cleanup; [cu[1], cu[2]] = [cu[2], cu[1]];
  for (const [name, m] of Object.entries({ m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12 })) assert.notDeepEqual(diff(lock(m), FIX), [], name);
  // wording alone does not trip it
  const ok = clone(C); ok.checklists.preflight.sections[0].items[1].t = 'Wind within limits; crosswind fine for VTOL.';
  assert.deepEqual(diff(lock(ok), lock(C)), []);
});
