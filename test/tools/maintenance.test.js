'use strict';
// WP11 R4 (maintenance), R8 (challenge–response helpers), R9 (latency stats), R6 (weather extras / airspace links).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../js/tools-core.js');

const task = id => T.MAINT_TASKS.find(t => t.id === id);
const flights = dates => dates.map((date, i) => ({ date, updatedAt: date + 'T12:00:0' + (i % 10) + '.000Z' }));

test('maintenance tasks follow the manual intervals (5 / 10 / 25 flights or monthly, client 5)', () => {
  assert.deepEqual(T.MAINT_TASKS.map(t => [t.id, t.flights, t.months]),
    [['carrier-5', 5, null], ['carrier-10', 10, null], ['carrier-25', 25, 1], ['client-5', 5, null]]);
});

test('maintStatus: flights since the last mark-done → ok / soon / due / overdue', () => {
  const t5 = task('carrier-5');
  assert.equal(T.maintStatus(t5, flights(['2026-10-01', '2026-10-02', '2026-10-03']), null, '2026-10-16').status, 'ok');
  assert.equal(T.maintStatus(t5, flights(['a', 'b', 'c', 'd'].map(() => '2026-10-02')), null, '2026-10-16').status, 'soon');
  const five = flights(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  const due = T.maintStatus(t5, five, null, '2026-10-16');
  assert.deepEqual([due.status, due.since, due.left, due.neverDone], ['due', 5, 0, true]);
  assert.equal(T.maintStatus(t5, five.concat(flights(['2026-10-06'])), null, '2026-10-16').status, 'overdue');
  const last = { taskId: 'carrier-5', doneDate: '2026-10-03', markedAt: '2026-10-03T12:00:03.000Z' };
  const after = T.maintStatus(t5, five, last, '2026-10-16');
  assert.equal(after.since, 2, 'entries after the done date (same-day entry logged before the mark-done is not counted)');
  assert.equal(after.status, 'ok');
  const sameDayLater = T.maintStatus(t5, five, Object.assign({}, last, { markedAt: '2026-10-03T11:00:00.000Z' }), '2026-10-16');
  assert.equal(sameDayLater.since, 3);
});

test('monthly rule: due on the date one month after, overdue after it', () => {
  const t25 = task('carrier-25'), last = { doneDate: '2026-09-16', markedAt: '2026-09-16T08:00:00Z' };
  assert.equal(T.maintStatus(t25, [], last, '2026-10-15').status, 'ok');
  const d = T.maintStatus(t25, [], last, '2026-10-16');
  assert.deepEqual([d.status, d.dueDate], ['due', '2026-10-16']);
  assert.equal(T.maintStatus(t25, [], last, '2026-10-17').status, 'overdue');
  assert.equal(T.maintStatus(t25, [], null, '2026-10-17').calendarUnknown, true);
  assert.equal(T.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(T.addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(T.addMonths('bad', 1), null);
});

test('maintLast picks the latest live record of the task', () => {
  const recs = [{ taskId: 'carrier-5', doneDate: '2026-10-01', markedAt: 'a' }, { taskId: 'carrier-5', doneDate: '2026-10-05', markedAt: 'b' },
    { taskId: 'carrier-5', doneDate: '2026-10-09', deleted: true }, { taskId: 'carrier-10', doneDate: '2026-10-10' }];
  assert.equal(T.maintLast(recs, 'carrier-5').doneDate, '2026-10-05');
  assert.equal(T.maintLast(recs, 'client-5:x'), null);
});

test('challenge–response helpers: item order, next open item, speech text', () => {
  const list = { sections: [{ id: 'A', name: 'SITE', items: [{ id: 'a1', s: 'Airspace', t: 'Check **NOTAM**' }, { id: 'a2', t: 'Only text' }] },
    { id: 'B', name: 'BUILD', items: [{ id: 'b1', s: 'Props', t: '`M1`', w: true }] }] };
  const items = T.crItems(list);
  assert.deepEqual(items.map(i => [i.id, i.secId, i.s, i.t, i.w]), [['a1', 'A', 'Airspace', 'Check **NOTAM**', false], ['a2', 'A', 'Only text', '', false], ['b1', 'B', 'Props', '`M1`', true]]);
  const st = { items: { a1: { checked: true, ts: 'x' } } };
  assert.equal(T.crNextOpen(items, st, 0), 1);
  assert.equal(T.crNextOpen(items, { items: { a1: {}, a2: {}, b1: {} } }, 0), -1);
  assert.equal(T.crNextOpen(items, st, 2), 2);
  assert.equal(T.speechText('Switch to [[QHOVER]], set `Q_RTL_ALT` **now**'), 'Switch to QHOVER, set Q_RTL_ALT now');
});

test('latency stats (relay-design test 2: mean and worst of 20 samples)', () => {
  assert.equal(T.LATENCY_SAMPLES, 20);
  assert.deepEqual(T.latencyStats([100, 120, '110', -5, 'x', null]), { n: 4, mean: 82.5, worst: 120, best: 0 });
  assert.deepEqual(T.latencyStats([]), { n: 0, mean: null, worst: null, best: null });
  assert.match(T.fmtClockMs(new Date(2026, 9, 16, 9, 5, 7, 42).getTime()), /^09:05:07\.042$/);
});

test('cloud cover / visibility where the model provides them; airspace links are https', () => {
  const h = { cloud_cover: [10, 80], cloud_cover_low: [0, 65], visibility: [24000, 900] };
  assert.deepEqual(T.cloudVis(h, 1), { cloudTotalPct: 80, cloudLowPct: 65, visibilityM: 900 });
  assert.deepEqual(T.cloudVis({ cloud_cover: [5] }, 0), { cloudTotalPct: 5, cloudLowPct: null, visibilityM: null });
  assert.deepEqual(T.cloudVis(null, 0), { cloudTotalPct: null, cloudLowPct: null, visibilityM: null });
  assert.ok(T.AIRSPACE_LINKS.length >= 3);
  for (const l of T.AIRSPACE_LINKS) assert.match(l.url, /^https:\/\//);
  assert.ok(T.AIRSPACE_LINKS.some(l => /ippc\.no/.test(l.url)), 'NOTAM source');
});
