'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');
const VtolStore = require('../../js/store.js');

const lim = VtolStore.defaults().settings;   // windGoMaxMs 5, windCautionMaxMs 8, gustMaxMs 10
const hours = Array.from({ length: 24 }, (_, i) => '2025-05-01T' + String(i).padStart(2, '0') + ':00');

test('IDX-05: hourlyIndex floors a 15-minute-aligned current.time to its hour', () => {
  assert.equal(T.hourlyIndex(hours, '2025-05-01T18:15'), 18);   // old indexOf() gave -1 → 0 (midnight)
  assert.equal(T.hourlyIndex(hours, '2025-05-01T18:45'), 18);
  assert.equal(T.hourlyIndex(hours, '2025-05-01T18:00'), 18);
  assert.equal(T.hourlyIndex(hours, '2025-05-01T00:15'), 0);
  assert.equal(T.hourlyIndex(hours, '2025-05-01T23:45'), 23);
});

test('hourlyIndex falls back to the last hour <= now, and to 0 for bad input', () => {
  const gappy = ['2025-05-01T00:00', '2025-05-01T03:00', '2025-05-01T06:00'];
  assert.equal(T.hourlyIndex(gappy, '2025-05-01T04:15'), 1);
  assert.equal(T.hourlyIndex(gappy, '2025-04-30T23:15'), 0);
  assert.equal(T.hourlyIndex([], '2025-05-01T04:15'), 0);
  assert.equal(T.hourlyIndex(hours, undefined), 0);
});

test('windStatus uses the configurable limits (defaults 5 / 8 / gust 10)', () => {
  assert.equal(T.windStatus(5, 9, lim).s, 'GO');
  assert.equal(T.windStatus(5.1, 9, lim).s, 'CAUTION');
  assert.equal(T.windStatus(8, 10, lim).s, 'CAUTION');
  assert.equal(T.windStatus(8.1, 9, lim).s, 'NO-GO');
  assert.equal(T.windStatus(3, 10.1, lim).s, 'NO-GO');
  assert.equal(T.windStatus(3, null, lim).level, 'go');       // no gust data aloft
  const strict = { windGoMaxMs: 3, windCautionMaxMs: 6, gustMaxMs: 8 };
  assert.equal(T.windStatus(4, 5, strict).s, 'CAUTION');
  assert.equal(T.windStatus(4, 8.5, strict).s, 'NO-GO');
});

test('relayWindRows reads wind_speed/direction at 80/120/180 m for the hour', () => {
  const h = { time: hours };
  for (const m of [80, 120, 180]) { h['wind_speed_' + m + 'm'] = hours.map((_, i) => i + m / 100); h['wind_direction_' + m + 'm'] = hours.map(() => 270); }
  const rows = T.relayWindRows(h, 18, lim);
  assert.deepEqual(rows.map(r => [r.heightM, r.speed, r.dir]), [[80, 18.8, 270], [120, 19.2, 270], [180, 19.8, 270]]);
  assert.ok(rows.every(r => r.status.s === 'NO-GO'));
  const missing = T.relayWindRows({ time: hours }, 0, lim);
  assert.ok(missing.every(r => r.speed === null && r.status === null));
  const calm = T.relayWindRows({ wind_speed_80m: [4], wind_direction_80m: [10] }, 0, lim);
  assert.equal(calm[0].status.s, 'GO');
});

test('precipStatus and icingStatus classification', () => {
  assert.deepEqual(T.precipStatus(0, 0), { s: 'GO', label: 'None', level: 'go' });
  assert.equal(T.precipStatus(51, 0.1).s, 'CAUTION');
  assert.equal(T.precipStatus(63, 1).s, 'NO-GO');
  assert.equal(T.precipStatus(2, 5).s, 'NO-GO');
  assert.equal(T.precipStatus(66, 0).label, 'Freezing rain');
  assert.equal(T.precipStatus(95, 0).label, 'Thunderstorm');
  assert.equal(T.icingStatus(0, 90).label, 'HIGH');
  assert.equal(T.icingStatus(-5, 85).label, 'MOD');
  assert.equal(T.icingStatus(-5, 65).label, 'LOW');
  assert.equal(T.icingStatus(5, 99).label, 'NIL');
  assert.equal(T.icingStatus(-30, 99).label, 'NIL');
  assert.equal(T.icingStatus(null, 50).label, '--');
});

test('compass, skyDesc, distanceKm', () => {
  assert.equal(T.compass(0), 'N'); assert.equal(T.compass(359), 'N'); assert.equal(T.compass(225), 'SW'); assert.equal(T.compass(200), 'SSW');
  assert.equal(T.skyDesc(3), 'Overcast'); assert.equal(T.skyDesc(1234), 'Unknown');
  assert.ok(Math.abs(T.distanceKm(60, 10.8, 61, 10.8) - 111.2) < 0.2);
  assert.equal(T.distanceKm(60, 10.8, 60, 10.8), 0);
});
