'use strict';
// WP06 PM amendments: one transition number (3 s), one power-up order, GPS Rescue landing phase (not a motor cut).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../data/content.js');
const { HTML } = require('./helpers.js');

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
};
const all = strings(C);

test('MAN-06: transition abort time is 3 s everywhere (callouts, cards, manual)', () => {
  const co = C.callouts.groups.flatMap(g => g.rows).find(r => r.id === 'co-transition-fail');
  assert.equal(co.trigger, 'No airspeed build within 3 s');
  for (const s of all) assert.doesNotMatch(s, /airspeed[^.]*\b2\s?s\b|\b2\s?s\b[^.]*airspeed/i, s);
  assert.doesNotMatch(HTML, /airspeed[^<.]*\b2\s?s\b/i);
});

test('power-up order: the Tools checklist follows plan §6.1.6 (carrier at step 4, Nomad last) with the bench-test TBD', () => {
  const items = Object.values(C.checklists).flatMap(l => l.sections.flatMap(s => s.items));
  const b = items.find(i => i.id === 'build-battery-power');
  assert.match(b.t, /\*\*step 4\*\*/);
  assert.match(b.t, /915 Nomad comes last \(8\)/);
  assert.match(b.t, /Allow GPS fix time after step 4, before arming/);
  assert.doesNotMatch(b.t, /early/i);
  assert.match(b.n, /\[\[TBD — confirm by bench test/);
  for (const s of all) assert.doesNotMatch(s, /power on (the )?carrier (drone )?early/i, s);
  assert.match(HTML, /<strong>Carrier battery<\/strong><p>[^<]*Allow GPS fix time from here, before arming/);
  assert.match(HTML, /<strong>915 MHz Nomad \(last\)/);
});

test('GPS Rescue: landing phase from 4 m (gps_rescue_landing_alt), VERIFY — never "motor cut at 4m"', () => {
  const card = C.emergencies.find(e => e.id === 'emerg-client-rc');
  const s = card.cleanup.find(x => /gps_rescue_landing_alt/.test(x));
  assert.match(s, /landing phase from 4 m \(gps_rescue_landing_alt\) \[\[VERIFY — /);
  for (const x of all) assert.doesNotMatch(x, /motor cut at 4/i, x);
  assert.doesNotMatch(HTML, /motors? cut at 4|>MOTOR CUT</i);
  assert.match(HTML, /Landing phase from 4 m \(<code>gps_rescue_landing_alt = 4<\/code>/);
});
