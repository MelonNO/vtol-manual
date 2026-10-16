// Mission parsing and playback (WP02 R6: MAP-01 / MAP-14).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../relay/rfmodel.js');

const fx = name => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);

test("manual's 7-WP template parses to 7 items", () => {
  const m = M.parseMission(fx('template-7wp.waypoints'));
  assert.equal(m.items.length, 7);
  assert.deepEqual(m.items.map(i => i.name),
    ['VTOL_TAKEOFF', 'WAYPOINT', 'LOITER_TO_ALT', 'WAYPOINT', 'LOITER_TO_ALT', 'WAYPOINT', 'VTOL_LAND']);
  assert.deepEqual(m.home, { lat: 59.9123, lon: 10.7012, alt: 152 });
  assert.ok(m.items.every(i => i.ref === 'rel'));
});

test('all NAV commands, frames, whitespace, non-NAV ignored', () => {
  const m = M.parseMission(fx('frames-mixed.waypoints'));          // space separated
  assert.deepEqual(m.items.map(i => i.cmd), [22, 16, 16, 18, 19, 82, 17, 21]);
  assert.equal(m.ignored, 2, 'DO_CHANGE_SPEED and DO_JUMP ignored');
  assert.deepEqual(m.items.map(i => i.ref), ['rel', 'amsl', 'terrain', 'rel', 'rel', 'rel', 'rel', 'rel']);
  // 0,0 coordinates = current position
  assert.equal(m.items[0].samePos, true);
  assert.equal(m.items[0].lat, 59.9);
  assert.equal(m.items[7].lat, m.items[6].lat);
  assert.deepEqual(Object.keys(M.NAV_CMDS).map(Number), [16, 17, 18, 19, 21, 22, 31, 82, 84, 85]);
  // CRLF + tabs also parse
  const crlf = fx('template-7wp.waypoints').replace(/\n/g, '\r\n');
  assert.equal(M.parseMission(crlf).items.length, 7);
});

test('altitude frames resolve to AMSL', () => {
  const m = M.resolveMissionAlts(M.parseMission(fx('frames-mixed.waypoints')), () => 70);
  assert.equal(m.homeAmsl, 100);
  assert.equal(m.items[0].altAmsl, 130, 'REL = home + 30');
  assert.equal(m.items[1].altAmsl, 250, 'AMSL as given');
  assert.equal(m.items[2].altAmsl, 110, 'terrain 70 + 40');
});

function run(mission, start, opt, maxS = 2000, dt = 0.5) {
  const ms = M.missionStart(mission, start);
  const trace = [];
  for (let t = 0; t < maxS && !ms.done; t += dt) {
    M.missionStep(ms, dt, opt);
    trace.push({ t: t + dt, idx: ms.idx, alt: ms.altAmsl, lat: ms.lat, lon: ms.lon, phase: ms.phase });
  }
  return { ms, trace };
}

test('7-WP playback visits every item and lands', () => {
  const m = M.resolveMissionAlts(M.parseMission(fx('template-7wp.waypoints')), () => null);
  const { ms, trace } = run(m, { lat: m.home.lat, lon: m.home.lon, altAmsl: 152 }, { speed: 15, loiterR: 200 });
  assert.equal(ms.done, true);
  near(ms.altAmsl, 152, 1e-9, 'landed at home altitude');
  const visited = new Set(trace.map(s => s.idx));
  for (let i = 0; i < 7; i++) assert.ok(visited.has(i), 'item ' + i);
  // VTOL_TAKEOFF climbs 25 m at 5 m/s → 5 s
  const firstLeg = trace.findIndex(s => s.idx === 1);
  near(trace[firstLeg].t, 5, 0.5);
});

test('altitude is interpolated along a waypoint leg (no jumps)', () => {
  const m = { items: [{ cmd: 16, name: 'WAYPOINT', lat: 60.01, lon: 10, altAmsl: 200, p1: 0, p2: 0, p3: 0 }] };
  const { trace } = run(m, { lat: 60, lon: 10, altAmsl: 100 }, { speed: 15, loiterR: 200 });
  const mid = trace[Math.floor(trace.length / 2)];
  assert.ok(mid.alt > 120 && mid.alt < 180, 'mid-leg altitude ' + mid.alt);
  for (let i = 1; i < trace.length; i++) assert.ok(Math.abs(trace[i].alt - trace[i - 1].alt) < 10);
});

test('LOITER_TO_ALT orbits until the altitude is reached at 5 m/s', () => {
  const m = { items: [{ cmd: 31, name: 'LOITER_TO_ALT', lat: 60, lon: 10, altAmsl: 400, p1: 1, p2: 150, p3: 0 }] };
  const { ms, trace } = run(m, { lat: 60, lon: 10, altAmsl: 100 }, { speed: 15, loiterR: 200 });
  assert.equal(ms.done, true);
  near(trace[trace.length - 1].t, 300 / 5, 1.5, 'climb time');
  // all in orbit at r = 150
  const r = M.distM(60, 10, trace[10].lat, trace[10].lon);
  near(r, 150, 1);
});

test('LOITER_TURNS does N turns, LOITER_TIME holds N s, LOITER_UNLIM never ends', () => {
  const turns = { items: [{ cmd: 18, name: 'LOITER_TURNS', lat: 60, lon: 10, altAmsl: 100, p1: 2, p2: 0, p3: 100 }] };
  const a = run(turns, { lat: 60, lon: 10, altAmsl: 100 }, { speed: 10, loiterR: 200 });
  near(a.trace[a.trace.length - 1].t, 2 * 2 * Math.PI * 100 / 10, 1, 'two turns at r=100');
  const time = { items: [{ cmd: 19, name: 'LOITER_TIME', lat: 60, lon: 10, altAmsl: 100, p1: 30, p2: 0, p3: 0 }] };
  const b = run(time, { lat: 60, lon: 10, altAmsl: 100 }, { speed: 15, loiterR: 200 });
  near(b.trace[b.trace.length - 1].t, 30, 0.6);
  near(M.distM(60, 10, b.trace[5].lat, b.trace[5].lon), 200, 1, 'default radius used');
  const unlim = { items: [{ cmd: 17, name: 'LOITER_UNLIM', lat: 60, lon: 10, altAmsl: 100, p1: 0, p2: 0, p3: 0 }] };
  const c = run(unlim, { lat: 60, lon: 10, altAmsl: 100 }, { speed: 15, loiterR: 200 }, 600);
  assert.equal(c.ms.done, false);
  // counter-clockwise for a negative radius
  const ccw = { items: [{ cmd: 18, name: 'LOITER_TURNS', lat: 60, lon: 10, altAmsl: 100, p1: 1, p2: 0, p3: -100 }] };
  const d = run(ccw, { lat: 60.0009, lon: 10, altAmsl: 100 }, { speed: 10, loiterR: 200 }, 4);
  assert.ok(d.ms.roll < 0);
});
