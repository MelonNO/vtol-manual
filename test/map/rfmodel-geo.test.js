// Geodesy, tile maths, RF basics, Fresnel and foliage (WP02 R2, R5, R9).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../relay/rfmodel.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);

test('dest / distM / bearingTo round-trip', () => {
  const [la, lo] = M.dest(60, 10, 45, 5000);
  near(M.distM(60, 10, la, lo), 5000, 0.01, 'distance');
  near(M.bearingTo(60, 10, la, lo), 45, 0.01, 'bearing');
  // 1° of latitude ≈ 111.19 km on a 6371 km sphere
  near(M.distM(0, 0, 1, 0), 111194.9, 0.5);
  near(M.bearingTo(0, 0, 0, 1), 90, 1e-9);
  near(M.bearingTo(1, 0, 0, 0), 180, 1e-9);
});

test('tile maths: tile index, pixel, bounds, pixel size', () => {
  assert.deepEqual(M.tileOf(0, 0, 1), [1, 1]);
  assert.deepEqual(M.tileOf(85, -180, 2), [0, 0]);
  const [tx, ty] = M.tileOf(59.9, 10.7, 11);
  const [px, py] = M.tilePixel(59.9, 10.7, tx, ty, 11);
  assert.ok(px >= 0 && px < 256 && py >= 0 && py < 256);
  const b = M.tilesForBounds(59.8, 10.6, 60.0, 10.9, 11);
  assert.ok(b.tx2 >= b.tx1 && b.ty2 >= b.ty1);
  assert.equal(b.count, (b.tx2 - b.tx1 + 1) * (b.ty2 - b.ty1 + 1));
  assert.equal(M.tileKey(11, 3, 4), '11/3/4');
  near(M.mPerPixel(0, 11), 76.44, 0.01, 'z11 equator');
  near(M.mPerPixel(60, 11), 38.22, 0.01, 'z11 at 60N');
  // demStep never exceeds the pixel size anywhere along the ray
  assert.ok(M.demStep(60, 15000, 11) <= M.mPerPixel(60, 11));
  assert.equal(M.terrariumM(128, 0, 0), 0);
  assert.equal(M.terrariumM(128, 100, 128), 100.5);
});

test('FSPL and range inversion', () => {
  // 1 km at 5.8 GHz: 60 + 195.27 − 147.55 = 107.72 dB
  near(M.fsplDb(1000, 5.8e9), 107.72, 0.01);
  near(M.rangeForLossM(M.fsplDb(1234, 2.44e9), 2.44e9), 1234, 1e-6);
});

test('link budget and range from a LinkProfile', () => {
  const video = M.DEFAULT_PROFILES.links.find(l => l.kind === 'video');
  assert.equal(M.linkBudgetDb(video), 14 + 2 + 10 + 85 - 6);
  // 105 dB at 5.8 GHz → ≈ 0.73 km (plan MAP-02: 25 mW reference client ≈ 0.7 km)
  near(M.linkRangeM(video), 732, 2);
  // overrides (VTX slider)
  assert.ok(M.linkRangeM(video, { txPowerDbm: 20 }) > M.linkRangeM(video));
  const rc = M.DEFAULT_PROFILES.links.find(l => l.kind === 'rc');
  assert.equal(M.linkBudgetDb(rc), null, 'null fields → no budget');
  assert.deepEqual(M.missingFields(rc), ['txPowerDbm', 'txGainDbi', 'rxGainDbi', 'rxSensDbm']);
  assert.equal(M.linkRangeM(Object.assign({}, rc, { txPowerDbm: 20, txGainDbi: 0, rxGainDbi: 0, rxSensDbm: -105 })) > 0, true);
});

test('dBm / mW', () => {
  near(M.mwToDbm(25), 13.98, 0.01);
  near(M.dbmToMw(30), 1000, 1e-9);
});

test('Fresnel radius matches the plan figures (MAP-05)', () => {
  // 3.6 km path, midpoint: 5.8 GHz ≈ 6.8 m, 868 MHz ≈ 17.6 m
  near(M.fresnelR1(1800, 1800, 5.8e9), 6.8, 0.05);
  near(M.fresnelR1(1800, 1800, 868e6), 17.6, 0.05);
  assert.equal(M.fresnelR1(0, 1000, 5.8e9), 0);
});

test('Weissberger foliage loss (R9)', () => {
  const fG = 5.8 ** 0.284;
  near(M.foliageLossDb(5.8e9, 10), 0.45 * fG * 10, 1e-9, 'short branch');
  near(M.foliageLossDb(5.8e9, 100), 1.33 * fG * 100 ** 0.588, 1e-9, 'long branch');
  // continuous at 14 m (within 0.1 dB)
  near(M.foliageLossDb(2.4e9, 14), M.foliageLossDb(2.4e9, 14.0001), 0.1);
  // frequency dependent: lower frequency → less loss
  assert.ok(M.foliageLossDb(868e6, 50) < M.foliageLossDb(2.44e9, 50));
  assert.ok(M.foliageLossDb(2.44e9, 50) < M.foliageLossDb(5.8e9, 50));
  // clamped at 400 m depth, zero for no foliage
  assert.equal(M.foliageLossDb(5.8e9, 1000), M.foliageLossDb(5.8e9, 400));
  assert.equal(M.foliageLossDb(5.8e9, 0), 0);
});

test('fmtFreq', () => {
  assert.equal(M.fmtFreq(5800), '5.8 GHz');
  assert.equal(M.fmtFreq(2440), '2.44 GHz');
  assert.equal(M.fmtFreq(868), '868 MHz');
  assert.equal(M.fmtFreq(null), 'TBD');
});

test('forest colour classification is source-specific (MAP-11)', () => {
  assert.ok(M.isForestColour(210, 224, 150, 'norgeskart'));
  assert.ok(M.isForestColour(217, 241, 164, 'opentopomap'));
  // shaded forest keeps the channel differences
  assert.ok(M.isForestColour(196, 210, 136, 'norgeskart'));
  // open land, water, white, generic park green → not forest
  assert.ok(!M.isForestColour(241, 236, 177, 'norgeskart'));
  assert.ok(!M.isForestColour(224, 254, 254, 'norgeskart'));
  assert.ok(!M.isForestColour(245, 245, 245, 'opentopomap'));
  assert.ok(!M.isForestColour(100, 180, 100, 'opentopomap'));
  assert.ok(!M.isForestColour(210, 224, 150, 'unknown-source'));
});
