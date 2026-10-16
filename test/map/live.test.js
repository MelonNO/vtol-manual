// GcsClient (contract C2) and live-data helpers (WP02 R12, R13).
const test = require('node:test');
const assert = require('node:assert/strict');
const GcsClient = require('../../js/gcs-client.js');
const M = require('../../relay/rfmodel.js');

// Manual clock: timers run only when the test advances them.
function fakeTimers() {
  let now = 0, id = 0;
  const q = new Map();
  return {
    setTimeout: (fn, ms) => { q.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: i => q.delete(i),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [k, v] of q) if (v.at <= end && (!next || v.at < next[1].at)) next = [k, v];
        if (!next) break;
        q.delete(next[0]); now = next[1].at; next[1].fn();
        await new Promise(r => setImmediate(r));
      }
      now = end;
      await new Promise(r => setImmediate(r));
    },
  };
}
const flush = () => new Promise(r => setImmediate(r));
const json = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

test('BASE and API shape', () => {
  assert.equal(GcsClient.BASE, 'http://127.0.0.1:47800');
  assert.equal(typeof GcsClient.start, 'function');
  assert.equal(typeof GcsClient.stop, 'function');
});

test('app absent: backoff doubles up to 3 s, never connects, never throws', async () => {
  const t = fakeTimers(), calls = [], conn = [];
  const fetch = url => { calls.push(url); return Promise.reject(new TypeError('connection refused')); };
  const s = GcsClient.start({ onConnection: c => conn.push(c) }, { fetch, EventSource: null, ...t });
  await flush();
  await t.advance(20000);
  GcsClient.stop();
  assert.deepEqual(conn, [false]);
  assert.ok(calls.every(u => u.endsWith('/api/v1/health')));
  assert.deepEqual(s.delays.slice(0, 4), [500, 1000, 2000, 3000]);
  assert.ok(s.delays.every(d => d <= 3000));
  const n = calls.length;
  await t.advance(10000);
  assert.equal(calls.length, n, 'stop() halts polling');
});

test('app present without SSE: connects and polls /status at 2 Hz', async () => {
  const t = fakeTimers(), statuses = [], conn = [];
  let up = true, statusCalls = 0;
  const fetch = url => {
    if (!up) return Promise.reject(new Error('down'));
    if (url.endsWith('/health')) return json({ ok: true, app: 'vtol-gcs', version: '2.0.0' });
    statusCalls++;
    return json({ carrier: { lat: 1, lon: 2 } });
  };
  GcsClient.start({ onStatus: s => statuses.push(s), onConnection: c => conn.push(c) },
    { fetch, EventSource: null, ...t });
  await flush(); await flush();
  await t.advance(2000);
  assert.deepEqual(conn, [false, true]);
  assert.ok(statusCalls >= 4 && statusCalls <= 6, 'about 2 Hz: ' + statusCalls);
  assert.equal(statuses[0].carrier.lat, 1);
  up = false;                                   // app stops → disconnected, back to health polling
  await t.advance(1000);
  assert.deepEqual(conn, [false, true, false]);
  GcsClient.stop();
});

test('SSE used when available; falls back to polling on error', async () => {
  const t = fakeTimers(), statuses = [], alarms = [];
  let es = null, statusCalls = 0;
  class FakeES {
    constructor(url) { this.url = url; this.l = {}; es = this; }
    addEventListener(n, fn) { this.l[n] = fn; }
    close() { this.closed = true; }
  }
  const fetch = url => url.endsWith('/health') ? json({ ok: true }) : (statusCalls++, json({ n: statusCalls }));
  GcsClient.start({ onStatus: s => statuses.push(s), onAlarm: a => alarms.push(a), onStatus2: null },
    { fetch, EventSource: FakeES, ...t });
  await flush(); await flush();
  assert.equal(es.url, 'http://127.0.0.1:47800/api/v1/events');
  es.l.status({ data: '{"bridge":{"state":"RUN"}}' });
  es.l.alarm({ data: '{"id":"client_failsafe","severity":"crit"}' });
  es.l.status({ data: 'not json' });            // ignored, no throw
  assert.equal(statuses[0].bridge.state, 'RUN');
  assert.equal(alarms[0].id, 'client_failsafe');
  assert.equal(statusCalls, 0);
  es.onerror();
  await flush(); await flush();
  assert.ok(es.closed);
  assert.ok(statusCalls >= 1, 'polling /status after SSE failure');
  GcsClient.stop();
});

test('consumer callback errors are contained', async () => {
  const t = fakeTimers();
  const fetch = url => url.endsWith('/health') ? json({ ok: true }) : json({});
  GcsClient.start({ onStatus() { throw new Error('boom'); }, onConnection() { throw new Error('boom'); } },
    { fetch, EventSource: null, ...t });
  await flush(); await flush();
  await t.advance(1000);
  GcsClient.stop();
});

test('LQ classes, trail pruning and heatmap binning (R12, R13)', () => {
  assert.equal(M.lqClass(100), 'ok');
  assert.equal(M.lqClass(70), 'ok');
  assert.equal(M.lqClass(69), 'weak');
  assert.equal(M.lqClass(null), 'unknown');
  const trail = [{ t: 0 }, { t: 100000 }, { t: 350000 }];
  assert.deepEqual(M.pruneTrail(trail, 400000).map(p => p.t), [100000, 350000]);
  const cells = M.binSamples([
    { lat: 60.00001, lon: 10.00001, lq: 100 }, { lat: 60.00002, lon: 10.00002, lq: 50 },
    { lat: 60.01, lon: 10.01, lq: null }, { lat: null, lon: 10, lq: 90 },
  ], 25);
  assert.equal(cells.length, 2);
  const a = cells.find(c => c.count === 2);
  assert.equal(a.lq, 75);
  assert.equal(cells.find(c => c.count === 1).lq, null);
});
