// Antenna geometry, terrain LOS, client/GCS coverage, intersection and orbit sweep
// (WP02 R3, R4, R5, R8, R9, R11).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../relay/rfmodel.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);
const flat = h => () => h;
const VIDEO = M.DEFAULT_PROFILES.links.find(l => l.kind === 'video');
const RC_NULL = M.DEFAULT_PROFILES.links.find(l => l.kind === 'rc');
const RC_FILLED = Object.assign({}, RC_NULL, { txPowerDbm: 20, txGainDbi: 0, rxGainDbi: 0, rxSensDbm: -100, antenna: 'omni' });

test('nedToBody pitch sign (MAP-03): nose up 10°, level target ahead → below the nose', () => {
  const b = M.nedToBody([1, 0, 0], 0, 10, 0);
  near(b[0], Math.cos(10 * Math.PI / 180), 1e-12);
  near(b[2], Math.sin(10 * Math.PI / 180), 1e-12);
  assert.ok(b[2] > 0, 'body z > 0');
  // nose down 10°: the same target is above the nose
  assert.ok(M.nedToBody([1, 0, 0], 0, -10, 0)[2] < 0);
  // target straight below, nose up 10° → it appears behind (x < 0) in the body frame
  assert.ok(M.nedToBody([0, 0, 1], 0, 10, 0)[0] < 0);
});

test('nedToBody yaw and roll', () => {
  // heading 90°: a target to the east is straight ahead
  const e = M.nedToBody([0, 1, 0], 90, 0, 0);
  near(e[0], 1, 1e-12); near(e[1], 0, 1e-12);
  // roll +90° (right wing down): a target straight below lies along the right wing (+y)
  const d = M.nedToBody([0, 0, 1], 0, 0, 90);
  near(d[1], 1, 1e-12); near(d[2], 0, 1e-12);
  // rotation keeps unit length
  const v = M.nedToBody(M.brgToNed(123, 300, 900), 37, 8, -25);
  near(Math.hypot(...v), 1, 1e-12);
});

test('antenna patterns', () => {
  // dual patch: peak towards the right wing, nothing towards the left wing
  near(M.antennaFactor('dual_patch', [0, 1, 0]), 1, 1e-12);
  assert.equal(M.antennaFactor('dual_patch', [0, -1, 0]), 0);
  // vertical dipole: peak at the horizon, null straight down
  near(M.antennaFactor('dipole', [1, 0, 0]), 1, 1e-12);
  assert.equal(M.antennaFactor('dipole', [0, 0, 1]), 0);
  assert.equal(M.antennaFactor('omni', [0, 0, 1]), 1);
  // facing text derived from the model (MAP-15)
  const f = M.antennaFacing('dual_patch', 30);
  assert.equal(f.text, 'right'); near(f.absDeg, 120, 1e-9);
  assert.equal(M.antennaFacing('dipole', 0).absDeg, null);
});

test('traceRay: flat terrain reaches the RF limit', () => {
  const r = M.traceRay({ lat: 60, lon: 10, hAsl: 100, brg: 0, maxR: 1000, step: 25, fHz: 5.8e9,
    k: 0.6, elev: flat(0), targetAgl: 3 });
  assert.equal(r.limit, 'rf'); assert.equal(r.range, 1000); assert.deepEqual(r.shadows, []);
});

test('traceRay: ridge blocks, then shadow re-acquired beyond (MAP-05)', () => {
  // 40 m ridge at 400–450 m from a 60 m radio over flat ground. Close behind the ridge is in
  // its shadow; far enough out the LOS clears the ridge again.
  const elev = (lat, lon) => { const d = M.distM(60, 10, lat, lon); return d >= 400 && d <= 450 ? 40 : 0; };
  const r = M.traceRay({ lat: 60, lon: 10, hAsl: 60, brg: 0, maxR: 3000, step: 25, fHz: 5.8e9,
    k: 0.6, elev, targetAgl: 3 });
  assert.equal(r.limit, 'terrain');
  assert.ok(r.range >= 400 && r.range < 500, 'edge just behind the ridge: ' + r.range);
  assert.equal(r.shadows.length, 1, 're-acquired segment');
  // 60 − 57·450/d ≥ 40 (+ Fresnel) → d ≳ 1.3 km; then visible out to maxR
  assert.ok(r.shadows[0][0] > 1200 && r.shadows[0][0] < 1600, 'shadow ends at ' + r.shadows[0][0]);
  assert.equal(r.shadows[0][1], 3000);
});

test('traceRay: Fresnel clearance k·F1 + margin shortens a grazing path', () => {
  // A 2.5 m bump at 500 m; radio 30 m, target 3 m AGL. Geometric LOS clears the bump for
  // every target; the 868 MHz Fresnel zone does not for targets just behind it.
  const elev = (lat, lon) => { const d = M.distM(60, 10, lat, lon); return d > 490 && d < 510 ? 2.5 : 0; };
  const base = { lat: 60, lon: 10, hAsl: 30, brg: 0, maxR: 2000, step: 10, elev, targetAgl: 3 };
  const geo = M.traceRay(Object.assign({}, base, { fHz: null }));
  const fres = M.traceRay(Object.assign({}, base, { fHz: 868e6, k: 0.6 }));
  const marg = M.traceRay(Object.assign({}, base, { fHz: null, marginM: 5 }));
  assert.equal(geo.range, 2000);
  assert.ok(fres.range < 600 && fres.limit === 'terrain', `fresnel ${fres.range} < geometric ${geo.range}`);
  assert.ok(marg.range < geo.range, 'user margin also shortens');
  const k0 = M.traceRay(Object.assign({}, base, { fHz: 868e6, k: 0 }));
  assert.equal(k0.range, geo.range, 'k = 0 equals geometric');
});

test('traceRay: missing terrain → nodata, RF only', () => {
  const r = M.traceRay({ lat: 60, lon: 10, hAsl: 100, brg: 0, maxR: 500, step: 25, fHz: 5.8e9,
    elev: () => null, targetAgl: 3 });
  assert.equal(r.limit, 'nodata'); assert.equal(r.range, 500);
});

const base = (o) => Object.assign({ lat: 60, lon: 10, hAsl: 120, hdg: 0, pitch: 0, roll: 0, clientAgl: 3,
  nBrg: 36, step: 20, k: 0.6, marginM: 0, elev: flat(0) }, o);

test('depression from real ASL heights (MAP-04): only height above local terrain matters', () => {
  const low = M.clientCoverage(base({ hAsl: 120, elev: flat(0), video: VIDEO, rc: RC_FILLED }));
  const high = M.clientCoverage(base({ hAsl: 620, elev: flat(500), video: VIDEO, rc: RC_FILLED }));
  assert.deepEqual(high.video.ranges, low.video.ranges);
  // and the height does matter: a much lower carrier changes the dual-patch footprint
  const lower = M.clientCoverage(base({ hAsl: 23, video: VIDEO, rc: RC_FILLED }));
  assert.notDeepEqual(lower.video.ranges, low.video.ranges);
});

test('video polygon: patches face right, nothing behind them', () => {
  const c = M.clientCoverage(base({ video: VIDEO, rc: RC_NULL }));
  const r = c.video.ranges;              // 36 bearings, 10° apart; heading 0 → right wing = east
  assert.ok(r[9] > 0, 'east (boresight) has coverage');
  // west (behind the patches): only the patch 45° down still sees a small area under the carrier
  assert.ok(r[27] < r[9] / 5, `west ${r[27]} << east ${r[9]}`);
  // carrier only 20 m above the client: nothing at all behind the patches
  const low = M.clientCoverage(base({ hAsl: 23, video: VIDEO, rc: RC_NULL }));
  assert.equal(low.video.ranges[27], 0);
  assert.equal(low.video.radials[27].limit, 'antnull');
  assert.ok(r[9] <= c.video.R0 + 1e-6);
  // VTX power override grows the footprint
  const hi = M.clientCoverage(base({ video: VIDEO, rc: RC_NULL, vtxDbm: 25 }));
  assert.ok(hi.video.ranges[9] > r[9]);
});

test('RC polygon is TBD with a null sensitivity, drawn when filled (R8)', () => {
  const tbd = M.clientCoverage(base({ video: VIDEO, rc: RC_NULL }));
  assert.ok(tbd.rc.tbd.includes('rxSensDbm'));
  assert.equal(tbd.rc.ranges, undefined);
  assert.equal(tbd.op, null, 'no operating area without RC');
  const ok = M.clientCoverage(base({ video: VIDEO, rc: RC_FILLED }));
  assert.equal(ok.rc.ranges.length, 36);
  assert.ok(ok.rc.ranges.every(v => v > 0), 'omni RC covers every bearing');
});

test('operating area = video ∩ RC on a synthetic case (R8)', () => {
  // RC: small omni circle. Video: dual patch. Intersection = per-bearing minimum.
  const rcSmall = Object.assign({}, RC_FILLED, { rxSensDbm: -70 });   // short range
  const c = M.clientCoverage(base({ video: VIDEO, rc: rcSmall }));
  const v = c.video.ranges, r = c.rc.ranges;
  c.op.forEach((o, i) => assert.equal(o, Math.min(v[i], r[i])));
  assert.ok(c.op[27] < c.op[9], 'behind the patches: smaller operating area');
  assert.ok(c.op[9] > 0 && c.op[9] <= r[9]);
  assert.equal(c.opBy[9], r[9] < v[9] ? 'rc' : 'video');
  assert.deepEqual(M.intersectRanges([1, 5, 3], [2, 4, 3]), [1, 4, 3]);
  assert.equal(M.intersectRanges([1], [1, 2]), null);
  const poly = M.starPolygon(60, 10, c.op);
  assert.equal(poly.length, 36);
  const zero = M.starPolygon(60, 10, new Array(36).fill(0));
  near(M.distM(60, 10, zero[27][0], zero[27][1]), 30, 0.5, 'minimum drawn radius');
});

test('client below forest canopy loses range (R9)', () => {
  const open = M.clientCoverage(base({ video: VIDEO, rc: RC_FILLED, canopy: () => 0 }));
  const forest = M.clientCoverage(base({ video: VIDEO, rc: RC_FILLED, canopy: () => 15 }));
  assert.ok(forest.video.ranges[9] < open.video.ranges[9]);
  assert.ok(forest.rc.ranges[0] < open.rc.ranges[0]);
});

test('GCS coverage: geometry only with TBD note, budget-limited when complete (R9)', () => {
  const hm30 = M.DEFAULT_PROFILES.links.find(l => l.kind === 'gcs');
  const o = { lat: 60, lon: 10, antH: 2, maxR: 5000, carrierAsl: 120, nBrg: 8, step: 50, k: 0.6,
    elev: flat(0), canopy: () => 0 };
  const geo = M.gcsCoverage(Object.assign({ profile: hm30 }, o));
  assert.equal(geo.budgetOk, false);
  assert.ok(geo.notes.some(n => /TBD/.test(n)));
  assert.ok(geo.ranges.every(r => r === 5000), 'flat earth, high carrier: geometry reaches max range');
  const set = Object.assign({}, hm30, { freqMHz: 2400, txPowerDbm: 0, txGainDbi: 0, rxGainDbi: 0, rxSensDbm: -80 });
  const bud = M.gcsCoverage(Object.assign({ profile: set }, o));
  assert.equal(bud.budgetOk, true);
  assert.ok(bud.R0 < 5000 && bud.ranges[0] <= bud.R0);
  // GCS below the canopy: foliage loss shortens the budget-limited range
  const forest = M.gcsCoverage(Object.assign({ profile: set }, o, { canopy: () => 15 }));
  assert.ok(forest.inForest);
  assert.ok(forest.ranges[0] < bud.ranges[0]);
});

test('orbit sweep: worst case = intersection, best case = union (R11)', () => {
  // two 0.01° squares overlapping by half
  const sq = (s, w) => [[s, w], [s + 0.01, w], [s + 0.01, w + 0.01], [s, w + 0.01]];
  const g = M.gridCreate(59.99, 9.99, 60.03, 10.03, 20);
  M.gridAddPolygon(g, sq(60, 10));
  M.gridAddPolygon(g, sq(60, 10.005));
  assert.equal(g.snaps, 2);
  const one = M.gridCreate(59.99, 9.99, 60.03, 10.03, 20);
  M.gridAddPolygon(one, sq(60, 10));
  const cellsSquare = M.gridCellCount(one, 'best');
  const worst = M.gridCellCount(g, 'worst'), best = M.gridCellCount(g, 'best');
  near(worst / cellsSquare, 0.5, 0.06, 'overlap is half a square');
  near(best / cellsSquare, 1.5, 0.06, 'union is 1.5 squares');
  const rings = M.gridRings(g, 'worst');
  assert.ok(rings.length > 0 && rings.every(r => r.length === 4));
  // ring rows: every worst-case cell lies inside both squares
  for (const r of rings) {
    const lon0 = r[0][1], lon1 = r[2][1];
    assert.ok(lon0 >= 10.005 - g.dLon && lon1 <= 10.01 + g.dLon);
  }
  assert.deepEqual(M.gridRings(M.gridCreate(0, 0, 1, 1, 5000), 'best'), []);
});

// Brute-force reference: the original O(n²) clearance check at fixed spacing, no fast path.
function refEdge(o) {
  const n = Math.ceil(o.maxR / o.step), lam = o.fHz ? M.C_MS / o.fHz : 0, d = [], blk = [], tgt = [];
  for (let i = 0; i < n; i++) {
    d[i] = Math.min(o.maxR, (i + 1) * o.step);
    const [la, lo] = M.dest(o.lat, o.lon, o.brg, d[i]);
    blk[i] = o.elev(la, lo); tgt[i] = blk[i] + o.targetAgl;
  }
  let range = 0;
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let j = 0; j < i && ok; j++) {
      const los = o.hAsl + (tgt[i] - o.hAsl) * d[j] / d[i] - d[j] * (d[i] - d[j]) / (2 * M.EARTH_R_EFF);
      const clr = (lam ? o.k * Math.sqrt(lam * d[j] * (d[i] - d[j]) / d[i]) : 0) + (o.marginM || 0);
      if (blk[j] > los - clr) ok = false;
    }
    if (!ok) return { range, limit: 'terrain' };
    range = d[i];
  }
  return { range, limit: 'rf' };
}

test('traceRay fast path gives exactly the brute-force edge on random terrain', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 40; t++) {
    const a1 = rnd() * 60, a2 = rnd() * 30, f1 = 200 + rnd() * 2000, f2 = 50 + rnd() * 500;
    const elev = (lat, lon) => { const x = M.distM(60, 10, lat, lon); return a1 * Math.sin(x / f1) + a2 * Math.sin(x / f2 + 1); };
    const o = { lat: 60, lon: 10, hAsl: 20 + rnd() * 150, brg: rnd() * 360, maxR: 3000 + rnd() * 6000, step: 30,
      fHz: [868e6, 2.44e9, 5.8e9][t % 3], k: 0.6, marginM: t % 4 ? 0 : 3, elev, targetAgl: 3 };
    const fast = M.traceRay(o), ref = refEdge(o);
    assert.equal(fast.range, ref.range, 'case ' + t);
    assert.equal(fast.limit, ref.limit, 'case ' + t);
  }
});

test('traceRay samples 8x coarser where there is no terrain data', () => {
  let calls = 0;
  const elev = (lat, lon) => { calls++; return M.distM(60, 10, lat, lon) < 1000 ? 0 : null; };
  const r = M.traceRay({ lat: 60, lon: 10, hAsl: 100, brg: 0, maxR: 10000, step: 25, fHz: 5.8e9, elev, targetAgl: 3 });
  assert.equal(r.limit, 'nodata'); assert.equal(r.range, 10000);
  assert.ok(calls < 40 + 9000 / 200 + 2, 'samples: ' + calls);
});

test('coarse steps never jump into a loaded tile (rework F5)', () => {
  // no data 1000–1100 m, then a 200 m ridge at 1100–1160 m: must be found despite the 8x step
  const elev = (lat, lon) => {
    const d = M.distM(60, 10, lat, lon);
    if (d >= 1000 && d < 1100) return null;
    return d >= 1100 && d < 1160 ? 200 : 0;
  };
  const r = M.traceRay({ lat: 60, lon: 10, hAsl: 100, brg: 0, maxR: 3000, step: 25, fHz: 5.8e9, elev, targetAgl: 3 });
  assert.equal(r.limit, 'terrain');
  assert.ok(r.range < 1200, 'edge at the ridge: ' + r.range);
});
