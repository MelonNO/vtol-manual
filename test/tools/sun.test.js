'use strict';
// IDX-15: sun times against the U.S. Naval Observatory "Sun and Moon Data for One Day" service
// (https://aa.usno.navy.mil/api/rstt/oneday?date=<date>&coords=<lat>,<lon>&tz=<offset h>), fetched 2026-10-16.
// USNO rounds to the minute; tolerance 2 min.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
function near(date, offsetSec, expectHM) {
  assert.ok(date instanceof Date, 'expected a Date, got ' + date);
  const got = toMin(T.fmtHMAtOffset(date, offsetSec)), exp = toMin(expectHM);
  const diff = Math.min(Math.abs(got - exp), 1440 - Math.abs(got - exp));   // across midnight
  assert.ok(diff <= 2, `got ${T.fmtHMAtOffset(date, offsetSec)}, USNO ${expectHM}`);
}

const CASES = [
  // [label, date (local noon at the place), lat, lon, utc offset s, civil dawn, rise, set, civil dusk]
  ['60.0N 10.8E summer solstice (CEST)', '2024-06-21T10:00:00Z', 60.0, 10.8, 7200, '02:06', '03:53', '22:45', '00:31'],
  ['60.0N 10.8E winter solstice (CET)', '2024-12-21T11:00:00Z', 60.0, 10.8, 3600, '08:21', '09:19', '15:11', '16:09'],
  ['37.8N 122.4W summer solstice (PDT)', '2024-06-21T19:00:00Z', 37.8, -122.4, -25200, '05:17', '05:48', '20:35', '21:06'],
  ['37.8N 122.4W winter solstice (PST)', '2024-12-21T20:00:00Z', 37.8, -122.4, -28800, '06:52', '07:22', '16:54', '17:24']
];

for (const [label, iso, lat, lon, off, dawn, rise, set, dusk] of CASES) {
  test('sunTimes ' + label, () => {
    const s = T.sunTimes(new Date(iso), lat, lon);
    near(s.civilDawn, off, dawn);
    near(s.sunrise, off, rise);
    near(s.sunset, off, set);
    near(s.civilDusk, off, dusk);
    assert.ok(s.sunrise < s.sunset && s.civilDawn < s.sunrise && s.sunset < s.civilDusk);
  });
}

test('sunTimes: result does not depend on the time of day within the solar day', () => {
  const a = T.sunTimes(new Date('2024-12-21T15:00:00Z'), 37.8, -122.4);   // 07:00 local
  const b = T.sunTimes(new Date('2024-12-22T03:00:00Z'), 37.8, -122.4);   // 19:00 local
  assert.ok(Math.abs(a.sunset - b.sunset) < 60000);
});

test('sunTimes: polar day and polar night', () => {
  const day = T.sunTimes(new Date('2024-06-21T10:00:00Z'), 78.2, 15.6);
  assert.equal(day.sunrise, 'never_sets'); assert.equal(day.civilDusk, 'never_sets');
  const night = T.sunTimes(new Date('2024-12-21T10:00:00Z'), 78.2, 15.6);
  assert.equal(night.sunrise, 'never_rises');
});

test('fmtHMAtOffset formats at the given UTC offset', () => {
  assert.equal(T.fmtHMAtOffset(new Date('2024-06-21T23:30:00Z'), 7200), '01:30');
  assert.equal(T.fmtHMAtOffset(new Date('2024-06-21T03:05:00Z'), -25200), '20:05');
});
