/* relay/rfmodel.js — pure maths for the relay coverage map (relay/map.html).
 * No DOM access. Loaded by <script src> in the page (global RfModel) and by Node tests (require).
 * Units: metres, degrees, dB, Hz unless a name says otherwise (freqMHz, txPowerDbm, …).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RfModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const EARTH_R = 6371000;
const EARTH_R_EFF = EARTH_R * 4 / 3;          // standard refraction (k = 4/3)
const C_MS = 299792458;
const WEBM_CIRC = 2 * Math.PI * 6378137;      // Web-Mercator equator length
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const isNum = v => typeof v === 'number' && isFinite(v);

// ─── Default profiles ─────────────────────────────────────────────────────────
// These MIRROR VtolStore.defaults() / VtolStore.IDS in js/store.js (contract C1.3 / C1.4) and are
// only used when js/store.js is not loaded. Keep them identical: test/map/defaults.test.js checks it.
const DEFAULT_PROFILES = {
  packs: [
    { id: 'pack-carrier-6s-7000', label: 'Carrier 6S 7000', role: 'carrier', cells: 6, chem: 'lipo',
      capacityMah: 7000, cycles: 0, purchased: '', notes: '' },
    { id: 'pack-mast-6s-3000', label: 'Mast 6S 3000', role: 'mast', cells: 6, chem: 'lipo',
      capacityMah: 3000, cycles: 0, purchased: '', notes: '' },
    { id: 'pack-client-ref-6s-1300', label: 'Ref client 6S 1300', role: 'client', cells: 6, chem: 'lipo',
      capacityMah: 1300, cycles: 0, purchased: '', notes: '' },
  ],
  clients: [
    { id: 'client-ref-1', name: 'Reference client #1', sizeIn: 7,
      fc: 'Matek F405 STD (clone)', firmware: 'Betaflight 4.5.2',
      vtx: { band: 'R', channel: 5, freqMHz: 5806, powerMw: 25 },
      videoStandard: null,
      elrs: { band: '2.4', packetRateHz: null, modelId: null, telemetryRatio: null, geminiRx: false },
      failsafe: { type: 'gps_rescue', minSats: 8, delayS: 2.5 },
      packId: 'pack-client-ref-6s-1300', notes: '' },
  ],
  links: [
    { id: 'link-client-video-58', name: 'Client video 5.8 GHz', kind: 'video', freqMHz: 5800,
      txPowerDbm: 14.0, txGainDbi: 2.0, rxGainDbi: 10.0, rxSensDbm: -85, marginDb: 6,
      antenna: 'dual_patch', notes: '' },
    { id: 'link-elrs-rc', name: 'ELRS RC (set me)', kind: 'rc', freqMHz: 2440,
      txPowerDbm: null, txGainDbi: null, rxGainDbi: null, rxSensDbm: null, marginDb: 6,
      antenna: 'dipole', notes: '' },
    { id: 'link-siyi-hm30', name: 'SIYI HM30 (set me)', kind: 'gcs', freqMHz: null,
      txPowerDbm: null, txGainDbi: null, rxGainDbi: null, rxSensDbm: null, marginDb: 6,
      antenna: null, notes: null },
  ],
};

// ─── Geodesy (spherical earth) ────────────────────────────────────────────────
function dest(lat, lon, brg, dist) {
  const d = dist / EARTH_R, θ = brg * D2R;
  const φ1 = lat * D2R, λ1 = lon * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
                             Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [φ2 * R2D, λ2 * R2D];
}

function distM(la1, lo1, la2, lo2) {
  const φ1 = la1 * D2R, φ2 = la2 * D2R;
  const a = Math.sin((la2 - la1) * D2R / 2) ** 2
          + Math.cos(φ1) * Math.cos(φ2) * Math.sin((lo2 - lo1) * D2R / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingTo(la1, lo1, la2, lo2) {
  const φ1 = la1 * D2R, φ2 = la2 * D2R, dλ = (lo2 - lo1) * D2R;
  return (Math.atan2(Math.sin(dλ) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)) * R2D + 360) % 360;
}

// ─── Web-Mercator tile maths ──────────────────────────────────────────────────
function tileFrac(lat, lon, z) {
  const n = 2 ** z, s = Math.sin(lat * D2R);
  return { xf: (lon + 180) / 360 * n,
           yf: (1 - Math.log((1 + s) / (1 - s)) / (2 * Math.PI)) / 2 * n };
}
function tileOf(lat, lon, z) {
  const { xf, yf } = tileFrac(lat, lon, z);
  return [Math.floor(xf), Math.floor(yf)];
}
function tilePixel(lat, lon, tx, ty, z, size = 256) {
  const { xf, yf } = tileFrac(lat, lon, z);
  const cl = v => Math.min(size - 1, Math.max(0, Math.floor(v)));
  return [cl((xf - tx) * size), cl((yf - ty) * size)];
}
function tileKey(z, tx, ty) { return z + '/' + tx + '/' + ty; }
// Tile index range covering a lat/lon box (north = smaller y).
function tilesForBounds(s, w, n, e, z) {
  const [tx1, ty1] = tileOf(n, w, z), [tx2, ty2] = tileOf(s, e, z);
  return { tx1, ty1, tx2, ty2, count: Math.max(0, (tx2 - tx1 + 1) * (ty2 - ty1 + 1)) };
}
// Ground size of one pixel (m) at latitude `lat`, zoom z. z11 = 76 m at the equator, 38 m at 60°N.
function mPerPixel(lat, z, size = 256) { return WEBM_CIRC * Math.cos(lat * D2R) / (size * 2 ** z); }
// AWS / Mapzen "Terrarium" PNG encoding.
function terrariumM(r, g, b) { return r * 256 + g + b / 256 - 32768; }

// ─── RF basics ────────────────────────────────────────────────────────────────
function dbmToMw(dbm) { return 10 ** (dbm / 10); }
function mwToDbm(mw) { return 10 * Math.log10(mw); }
// Free-space path loss, d in m, f in Hz (plan §8.2-2).
function fsplDb(dM, fHz) { return 20 * Math.log10(dM) + 20 * Math.log10(fHz) - 147.55; }
function rangeForLossM(lossDb, fHz) { return 10 ** ((lossDb - 20 * Math.log10(fHz) + 147.55) / 20); }

// LinkProfile fields needed for a link budget. null = unknown (TBD) → no budget.
const LINK_FIELDS = ['freqMHz', 'txPowerDbm', 'txGainDbi', 'rxGainDbi', 'rxSensDbm', 'marginDb'];
const FIELD_LABELS = { freqMHz: 'frequency', txPowerDbm: 'TX power', txGainDbi: 'TX gain',
                       rxGainDbi: 'RX gain', rxSensDbm: 'sensitivity', marginDb: 'fade margin' };
function missingFields(p, ov) {
  const q = Object.assign({}, p, ov);
  return LINK_FIELDS.filter(f => !isNum(q[f]));
}
// Maximum allowed path loss (dB), or null when the profile is incomplete. `ov` overrides fields.
function linkBudgetDb(p, ov) {
  if (!p || missingFields(p, ov).length) return null;
  const q = Object.assign({}, p, ov);
  return q.txPowerDbm + q.txGainDbi + q.rxGainDbi - q.rxSensDbm - q.marginDb;
}
// Free-space range at peak antenna gain (m), or null.
function linkRangeM(p, ov) {
  const b = linkBudgetDb(p, ov);
  return b === null ? null : rangeForLossM(b, Object.assign({}, p, ov).freqMHz * 1e6);
}

// First Fresnel-zone radius (m) at d1/d2 from the ends (plan §8.2-3).
function fresnelR1(d1, d2, fHz) {
  if (!(d1 > 0 && d2 > 0 && fHz > 0)) return 0;
  return Math.sqrt((C_MS / fHz) * d1 * d2 / (d1 + d2));
}

// Foliage loss — Weissberger's modified exponential decay model (plan §8.2-4, MAP-16):
//   L = 0.45 · f^0.284 · d           0  < d ≤ 14 m
//   L = 1.33 · f^0.284 · d^0.588     14 < d ≤ 400 m        (L in dB, f in GHz, d = foliage depth in m)
// Valid 230 MHz – 95 GHz, foliage depth ≤ 400 m (deeper paths are clamped to 400 m: beyond that,
// diffraction over the canopy dominates and the model no longer applies).
// Source: M. A. Weissberger, "An Initial Critical Summary of Models for Predicting the Attenuation
// of Radio Waves by Trees", ESD-TR-81-101, Electromagnetic Compatibility Analysis Center,
// Annapolis MD, July 1982.
function foliageLossDb(fHz, depthM) {
  if (!(depthM > 0) || !(fHz > 0)) return 0;
  const fG = (fHz / 1e9) ** 0.284, d = Math.min(depthM, 400);
  return d <= 14 ? 0.45 * fG * d : 1.33 * fG * d ** 0.588;
}

// ─── Antenna geometry ─────────────────────────────────────────────────────────
// Carrier VRX dual patches (body frame, x fwd / y right / z down): one facing the right wing,
// one right + 45° down. Pattern cos^PATCH_N per patch (unchanged from the previous map).
const PATCH_N = 3.5;
const PATCH_BORESIGHTS = [[0, 1, 0], [0, Math.SQRT1_2, Math.SQRT1_2]];

// Unit vector (NED) from the carrier towards a target `dstM` away on bearing `brg`,
// `depM` metres below the carrier (negative = above).
function brgToNed(brg, depM, dstM) {
  const B = brg * D2R, da = Math.atan2(depM, Math.max(dstM, 1)), ca = Math.cos(da);
  return [Math.cos(B) * ca, Math.sin(B) * ca, Math.sin(da)];
}

// NED → body (FRD): body = Rx(roll)·Ry(pitch)·Rz(yaw)·n, nose-up pitch and right-wing-down roll
// positive. MAP-03: pitch row signs fixed — x2 = x1·cθ − z1·sθ, z2 = x1·sθ + z1·cθ
// (θ = +10°, level target ahead → body z > 0, i.e. below the nose).
function nedToBody(n, hdg, pitch, roll) {
  const ψ = hdg * D2R, θ = pitch * D2R, φ = roll * D2R;
  const cψ = Math.cos(ψ), sψ = Math.sin(ψ), cθ = Math.cos(θ), sθ = Math.sin(θ),
        cφ = Math.cos(φ), sφ = Math.sin(φ);
  const x1 = n[0] * cψ + n[1] * sψ, y1 = -n[0] * sψ + n[1] * cψ, z1 = n[2];
  const x2 = x1 * cθ - z1 * sθ, y2 = y1, z2 = x1 * sθ + z1 * cθ;
  return [x2, y2 * cφ + z2 * sφ, -y2 * sφ + z2 * cφ];
}

function patchGain(b, bs, n = PATCH_N) {
  return Math.max(b[0] * bs[0] + b[1] * bs[1] + b[2] * bs[2], 0) ** n;
}

// Relative field-strength factor (0…1, 1 = peak gain) of the carrier antenna towards body
// direction b. Range scales linearly with it (received power ∝ G / d²).
//   dual_patch — the patch pair above (max of the two)
//   dipole     — half-wave dipole along the body z axis (vertical in level flight):
//                F(θ) = cos(π/2·cosθ) / sinθ, θ from the dipole axis
//   omni / unset — 1
function antennaFactor(kind, b) {
  if (kind === 'dual_patch')
    return Math.sqrt(Math.max(...PATCH_BORESIGHTS.map(bs => patchGain(b, bs))));
  if (kind === 'dipole') {
    const c = Math.max(-1, Math.min(1, b[2])), s = Math.sqrt(1 - c * c);
    return s < 1e-6 ? 0 : Math.abs(Math.cos(Math.PI / 2 * c) / s);
  }
  return 1;
}

// Where the antenna "faces", derived from the model (MAP-15). hdg = carrier heading.
function antennaFacing(kind, hdg) {
  if (kind === 'dual_patch') {
    const sx = PATCH_BORESIGHTS.reduce((a, b) => a + b[0], 0);
    const sy = PATCH_BORESIGHTS.reduce((a, b) => a + b[1], 0);
    const rel = (Math.atan2(sy, sx) * R2D + 360) % 360;
    const side = ['nose', 'right', 'tail', 'left'][Math.round(rel / 90) % 4];
    return { text: side, absDeg: ((hdg || 0) + rel + 360) % 360 };
  }
  if (kind === 'dipole') return { text: 'omni (vertical dipole)', absDeg: null };
  return { text: 'omni', absDeg: null };
}

// ─── Terrain line of sight along one radial ───────────────────────────────────
// Samples every `step` metres (callers pass ≤ the DEM pixel size, MAP-05) out to maxR
// (8 × step across stretches without terrain data).
// Target i is visible when every earlier sample j clears the earth-curved LOS line by
//   k · F1(d_j, d_i − d_j, f) + marginM                 (Fresnel clearance, plan §8.2-3)
// and reach(d, info) (the RF check) is true. The coverage edge is the first failure
// (ray stops there, as before). After a terrain block the scan continues to report
// "shadow re-acquired" intervals [d0, d1] — not coverage.
//
// o: { lat, lon, hAsl, brg, maxR, step, fHz (null → no Fresnel term), k, marginM,
//      elev(lat, lon) → m | null, groundFallback (m, used where elev is null),
//      targetAgl | targetAsl, canopy(lat, lon) → canopy height m (optional),
//      reach(d, {groundAsl, canopyM, targetAsl}) → bool (optional) }
// → { range, limit: 'rf'|'terrain'|'nodata'|'antnull', shadows }
function traceRay(o) {
  const lam = o.fHz > 0 ? C_MS / o.fHz : 0, k = isNum(o.k) ? o.k : 0.6, mg = o.marginM || 0;
  const twoRe = 2 * EARTH_R_EFF;
  const d = [], blk = [], tgt = [], known = [];
  // Exact fast path. Dividing the condition by d_j separates it:
  //   (blk_j − los_ij) / d_j = a_j − b_i,   a_j = (blk_j − h)/d_j − d_j/2Re,   b_i = (t_i − h)/d_i − d_i/2Re
  // and the clearance per metre is bounded: clr_ij / d_j ≤ c_j = k·√(λ/d_j) + margin/d_j.
  // So max a_j > b_i → blocked, max(a_j + c_j) ≤ b_i → clear; only the band between runs the loop.
  let maxA = -Infinity, maxU = -Infinity, slow = 0;
  function clear(i) {
    const b = (tgt[i] - o.hAsl) / d[i] - d[i] / twoRe;
    if (maxA > b) return false;
    if (maxU <= b) return true;
    slow++;
    for (let j = 0; j < i; j++) {
      if (!known[j]) continue;
      const frac = d[j] / d[i];
      const los = o.hAsl + (tgt[i] - o.hAsl) * frac - d[j] * (d[i] - d[j]) / twoRe;
      const clr = (lam ? k * Math.sqrt(lam * d[j] * (d[i] - d[j]) / d[i]) : 0) + mg;
      if (blk[j] > los - clr) return false;
    }
    return true;
  }
  let range = 0, limit = null, noData = false, run = null, slowAtEdge = 0;
  const shadows = [];
  for (let i = 0, dist = 0; dist < o.maxR; i++) {
    // Adaptive spacing: `step` (≤ DEM pixel) where terrain is known; 8 × step across samples
    // without terrain data — there is no DEM pixel to miss there, only the RF check. The long
    // step is taken only if its far end is still without data, so the ray never jumps into a
    // loaded tile (tiles are 256 px; only a < 8 px corner clip can be passed over).
    let next = Math.min(o.maxR, dist + o.step), la, lo, e, coarse = false;
    if (i && !known[i - 1]) {
      const far = Math.min(o.maxR, dist + 8 * o.step);
      [la, lo] = dest(o.lat, o.lon, o.brg, far);
      e = o.elev(la, lo);
      if (!isNum(e)) { next = far; coarse = true; }
    }
    if (!coarse) { [la, lo] = dest(o.lat, o.lon, o.brg, next); e = o.elev(la, lo); }
    dist = next;
    d[i] = dist;
    known[i] = isNum(e);
    const g = known[i] ? e : (o.groundFallback || 0);
    const c = o.canopy ? (o.canopy(la, lo) || 0) : 0;
    const tAsl = isNum(o.targetAsl) ? o.targetAsl : g + o.targetAgl;
    blk[i] = g + c;
    tgt[i] = Math.max(tAsl, g + c);                   // below the canopy: LOS to the canopy top
    const vis = clear(i), rf = o.reach ? o.reach(dist, { groundAsl: g, canopyM: c, targetAsl: tAsl }) : true;
    if (known[i]) {                                   // sample i is an obstacle for every later target
      const a = (blk[i] - o.hAsl) / dist - dist / twoRe;
      if (a > maxA) maxA = a;
      const u = a + (lam ? k * Math.sqrt(lam / dist) : 0) + mg / dist;
      if (u > maxU) maxU = u;
    }
    if (limit === null) {
      if (!known[i]) noData = true;
      if (vis && rf) { range = dist; continue; }
      limit = !vis ? 'terrain' : (range === 0 ? 'antnull' : 'rf');
      if (limit !== 'terrain') break;
      slowAtEdge = slow;
    } else {
      const half = (d[i] - d[i - 1]) / 2;
      if (vis && rf) {
        if (!run) run = [Math.max(0, dist - half), dist];
        run[1] = Math.min(o.maxR, dist + half);
      } else if (run) { shadows.push(run); run = null; }
      if (slow - slowAtEdge > SHADOW_BUDGET) break;   // shadows are optional: stop when costly
    }
  }
  if (run) shadows.push(run);
  if (limit === null) limit = 'rf';
  if (noData && limit !== 'terrain') limit = 'nodata';
  return { range, limit, shadows };
}
// Max exact LOS evaluations spent per ray on the optional "shadow re-acquired" scan.
const SHADOW_BUDGET = 200;

// Sample spacing that never exceeds the DEM pixel size anywhere on a ray of length maxR.
function demStep(lat, maxR, z) {
  const latMax = Math.min(85, Math.abs(lat) + maxR / 111320);
  return mPerPixel(latMax, z);
}

// ─── Client links: video, RC and the operating area (plan §8.1 / §8.2) ───────
// Radials from the carrier for one link. The carrier-end antenna pattern comes from
// profile.antenna; the client end is omni. The depression angle at each evaluated
// point uses real heights: hAsl − (terrain + clientAgl) (MAP-04).
// o: { lat, lon, hAsl, hdg, pitch, roll, clientAgl, nBrg, step, k, marginM, elev, canopy,
//      groundFallback }
// → { tbd: [missing fields] } or { R0, fHz, radials, ranges }
function linkRadials(o, profile, ov) {
  if (!profile) return { tbd: LINK_FIELDS.slice() };
  const miss = missingFields(profile, ov);
  if (miss.length) return { tbd: miss };
  const R0 = linkRangeM(profile, ov), fHz = profile.freqMHz * 1e6;
  const nBrg = o.nBrg || 72, radials = [];
  for (let i = 0; i < nBrg; i++) {
    const brg = i * 360 / nBrg;
    const reach = (dd, inf) => {
      const dep = o.hAsl - inf.targetAsl;
      const f = antennaFactor(profile.antenna, nedToBody(brgToNed(brg, dep, dd), o.hdg || 0, o.pitch || 0, o.roll || 0));
      if (f < 0.05) return false;
      let loss = 0;
      const under = inf.canopyM - o.clientAgl;           // client below the canopy top
      if (under > 0) {
        const sinE = Math.max(dep, 0) / Math.hypot(dd, dep);
        loss = foliageLossDb(fHz, under / Math.max(sinE, 0.03));
      }
      return dd <= R0 * f * 10 ** (-loss / 20);
    };
    radials.push(traceRay({ lat: o.lat, lon: o.lon, hAsl: o.hAsl, brg, maxR: R0, step: o.step,
      fHz, k: o.k, marginM: o.marginM, elev: o.elev, canopy: o.canopy, groundFallback: o.groundFallback,
      targetAgl: o.clientAgl, reach }));
  }
  return { R0, fHz, radials, ranges: radials.map(r => r.range) };
}

// Intersection of two star-shaped polygons sharing the centre and bearings: per-bearing min.
function intersectRanges(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  return a.map((r, i) => Math.min(r, b[i]));
}

// video ∩ RC → "OPERATING AREA". vtxDbm overrides the video profile's TX power.
function clientCoverage(o) {
  const video = linkRadials(o, o.video, isNum(o.vtxDbm) ? { txPowerDbm: o.vtxDbm } : null);
  const rc = linkRadials(o, o.rc, null);
  const op = (video.ranges && rc.ranges) ? intersectRanges(video.ranges, rc.ranges) : null;
  const opBy = op ? op.map((r, i) => (rc.ranges[i] < video.ranges[i] ? 'rc' : 'video')) : null;
  return { video, rc, op, opBy };
}

function starPolygon(lat, lon, ranges, minR = 30) {
  const n = ranges.length;
  return ranges.map((r, i) => dest(lat, lon, i * 360 / n, Math.max(r, minR))
    .map(v => Math.round(v * 1e6) / 1e6));
}

// ─── GCS ↔ carrier (HM30) coverage ────────────────────────────────────────────
// Where can the carrier (at carrierAsl) be seen from the GCS mast? Uses the HM30 link
// budget when the profile is complete, else geometry only (MAP-16).
// o: { lat, lon, antH, maxR, carrierAsl, profile, nBrg, step, k, marginM, elev, canopy }
function gcsCoverage(o) {
  const p = o.profile || {};
  const miss = missingFields(p), budgetOk = miss.length === 0;
  const fHz = isNum(p.freqMHz) ? p.freqMHz * 1e6 : null;
  const R0 = budgetOk ? linkRangeM(p) : null;
  const maxR = R0 ? Math.min(o.maxR, R0) : o.maxR;
  const gTer = o.elev(o.lat, o.lon);
  const gGround = isNum(gTer) ? gTer : 0;
  const gCan = o.canopy ? (o.canopy(o.lat, o.lon) || 0) : 0;
  const inForest = gCan > o.antH;
  // Antenna below the canopy: the signal leaves through (gCan − antH) m of foliage, then
  // continues from the canopy top.
  const origin = gGround + Math.max(o.antH, gCan);
  const notes = [];
  if (!budgetOk) notes.push('HM30 link budget TBD — geometry only (set ' + miss.map(f => FIELD_LABELS[f]).join(', ') + ')');
  if (!fHz) notes.push('Fresnel clearance not applied — HM30 frequency TBD');
  if (inForest && !budgetOk) notes.push('GCS below canopy: foliage loss not applied (budget TBD)');
  const nBrg = o.nBrg || 72, radials = [];
  for (let i = 0; i < nBrg; i++) {
    const reach = (dd, inf) => {
      if (!budgetOk) return true;
      let loss = 0;
      if (inForest) {
        const dV = Math.max(inf.targetAsl - origin, 1);
        loss = foliageLossDb(fHz, (gCan - o.antH) / Math.max(dV / Math.hypot(dd, dV), 0.03));
      }
      return dd <= R0 * 10 ** (-loss / 20);
    };
    radials.push(traceRay({ lat: o.lat, lon: o.lon, hAsl: origin, brg: i * 360 / nBrg, maxR,
      step: o.step, fHz, k: o.k, marginM: o.marginM, elev: o.elev, canopy: o.canopy,
      groundFallback: gGround, targetAsl: o.carrierAsl, reach }));
  }
  return { radials, ranges: radials.map(r => r.range), budgetOk, R0, fHz, inForest, notes };
}

// ─── Orbit sweep accumulation (plan §8.2-8) ──────────────────────────────────
// A lat/lon grid; every snapshot polygon increments the cells whose centre it contains.
// worst case = cells inside every snapshot (intersection), best case = inside any (union).
function gridCreate(s, w, n, e, cellM) {
  const midLat = (s + n) / 2;
  const dLat = cellM / 111320, dLon = cellM / (111320 * Math.max(0.01, Math.cos(midLat * D2R)));
  const ny = Math.max(1, Math.ceil((n - s) / dLat)), nx = Math.max(1, Math.ceil((e - w) / dLon));
  return { s, w, n: s + ny * dLat, e: w + nx * dLon, dLat, dLon, nx, ny,
           counts: new Uint16Array(nx * ny), snaps: 0 };
}
// Scan-line fill (lat/lon treated as planar — fine at a few km).
function gridAddPolygon(g, poly) {
  g.snaps++;
  const m = poly.length;
  for (let row = 0; row < g.ny; row++) {
    const y = g.s + (row + 0.5) * g.dLat, xs = [];
    for (let i = 0, j = m - 1; i < m; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.w) / g.dLon - 0.5));
      const c1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.w) / g.dLon - 0.5));
      for (let c = c0; c <= c1; c++) g.counts[row * g.nx + c]++;
    }
  }
  return g;
}
// Horizontal runs of cells matching `mode` ('worst' | 'best') → rectangles [[lat,lon]×4].
function gridRings(g, mode) {
  const rings = [];
  if (!g.snaps) return rings;
  const hit = mode === 'worst' ? c => c === g.snaps : c => c > 0;
  for (let row = 0; row < g.ny; row++) {
    let c0 = -1;
    for (let c = 0; c <= g.nx; c++) {
      const on = c < g.nx && hit(g.counts[row * g.nx + c]);
      if (on && c0 < 0) c0 = c;
      if (!on && c0 >= 0) {
        const s = g.s + row * g.dLat, n = s + g.dLat, w = g.w + c0 * g.dLon, e = g.w + c * g.dLon;
        rings.push([[s, w], [n, w], [n, e], [s, e]]);
        c0 = -1;
      }
    }
  }
  return rings;
}
function gridCellCount(g, mode) {
  let n = 0;
  for (const c of g.counts) if (mode === 'worst' ? (g.snaps && c === g.snaps) : c > 0) n++;
  return n;
}

// ─── Mission files (QGC WPL 110, Mission Planner .waypoints) ─────────────────
// Columns: seq current frame cmd p1 p2 p3 p4 lat lon alt autocontinue (any whitespace).
// Line seq 0 is HOME (AMSL altitude). Accepted NAV commands with coordinates (MAP-01):
const NAV_CMDS = {
  16: 'WAYPOINT', 17: 'LOITER_UNLIM', 18: 'LOITER_TURNS', 19: 'LOITER_TIME', 21: 'LAND',
  22: 'TAKEOFF', 31: 'LOITER_TO_ALT', 82: 'SPLINE_WAYPOINT', 84: 'VTOL_TAKEOFF', 85: 'VTOL_LAND',
};
// Frames: 0 = AMSL, 3 = relative to home, 10 = terrain (AGL); the _INT variants 5/6/11 likewise.
const FRAME_REF = { 0: 'amsl', 5: 'amsl', 3: 'rel', 6: 'rel', 10: 'terrain', 11: 'terrain' };

function parseMission(text) {
  const out = { home: null, items: [], ignored: 0, warnings: [] };
  let last = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || /^QGC/i.test(line)) continue;
    const p = line.split(/\s+/);
    if (p.length < 12) { out.ignored++; continue; }
    const seq = parseInt(p[0], 10), frame = parseInt(p[2], 10), cmd = parseInt(p[3], 10);
    const num = p.slice(4, 11).map(Number);
    if (!isFinite(seq) || !isFinite(cmd) || num.some(v => !isFinite(v))) { out.ignored++; continue; }
    const [p1, p2, p3, p4, lat, lon, alt] = num;
    if (seq === 0) { out.home = { lat, lon, alt }; last = out.home; continue; }
    if (!(cmd in NAV_CMDS)) { out.ignored++; continue; }
    let ref = FRAME_REF[frame];
    if (!ref) { ref = 'rel'; out.warnings.push(`item ${seq}: frame ${frame} unknown — treated as relative`); }
    const item = { seq, cmd, name: NAV_CMDS[cmd], frame, ref, p1, p2, p3, p4, lat, lon, alt, samePos: false };
    if (Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7) {
      // 0,0 = "at the current position" (typical for (VTOL_)TAKEOFF / LAND)
      if (!last) { out.ignored++; continue; }
      item.lat = last.lat; item.lon = last.lon; item.samePos = true;
    }
    out.items.push(item); last = item;
  }
  return out;
}

// Absolute (AMSL) altitude of every item. elev(lat, lon) → m | null.
function resolveMissionAlts(mission, elev) {
  const h = mission.home;
  const homeGround = h ? (isNum(elev(h.lat, h.lon)) ? elev(h.lat, h.lon) : null) : null;
  const homeAmsl = h && h.alt ? h.alt : (homeGround !== null ? homeGround : 0);
  for (const it of mission.items) {
    if (it.ref === 'amsl') it.altAmsl = it.alt;
    else if (it.ref === 'terrain') {
      const e = elev(it.lat, it.lon);
      it.altAmsl = (isNum(e) ? e : homeAmsl) + it.alt;
      it.altApprox = !isNum(e);
    } else it.altAmsl = homeAmsl + it.alt;
  }
  mission.homeAmsl = homeAmsl;
  return mission;
}

// ─── Mission playback (MAP-14) ───────────────────────────────────────────────
// Climb/sink: TECS_CLMB_MAX = TECS_SINK_MAX = 5 m/s (manual, aircraft parameters). The same
// rate is used for the VTOL climb/descent phases (approximation; Q_ climb rates not in the manual).
const SIM_CLIMB_MS = 5, SIM_SINK_MS = 5, GRAV = 9.81;
const LOITER_CMDS = [17, 18, 19, 31];

function missionStart(mission, pos) {
  return { items: mission.items, idx: 0, leg: null, orbit: null, done: !mission.items.length,
           lat: pos.lat, lon: pos.lon, altAmsl: pos.altAmsl, hdg: pos.hdg || 0, roll: 0, phase: 'start' };
}

function rateTo(cur, target, dt) {
  const up = SIM_CLIMB_MS * dt, dn = SIM_SINK_MS * dt;
  return target > cur ? Math.min(target, cur + up) : Math.max(target, cur - dn);
}

// Advance the playback by dt seconds. opt: { speed (m/s), loiterR (m, used when the item has none) }.
function missionStep(ms, dt, opt) {
  if (ms.done) return ms;
  const it = ms.items[ms.idx];
  if (!it) { ms.done = true; return ms; }
  const v = opt.speed, step = v * dt, dist = distM(ms.lat, ms.lon, it.lat, it.lon);
  const next = () => {
    ms.idx++; ms.leg = null; ms.orbit = null;
    if (ms.idx >= ms.items.length) { ms.done = true; ms.phase = 'done'; }
  };
  const flyToward = () => {
    ms.hdg = bearingTo(ms.lat, ms.lon, it.lat, it.lon);
    [ms.lat, ms.lon] = dest(ms.lat, ms.lon, ms.hdg, Math.min(step, dist));
    ms.roll = 0;
  };
  ms.roll = 0;
  if (it.cmd === 84) {                                   // VTOL_TAKEOFF: vertical at current position
    ms.phase = 'vtol climb';
    ms.altAmsl = rateTo(ms.altAmsl, it.altAmsl, dt);
    if (ms.altAmsl === it.altAmsl) next();
  } else if (it.cmd === 85) {                            // VTOL_LAND: fly to point, descend vertically
    if (dist > step) { ms.phase = 'approach'; flyToward(); }
    else {
      ms.lat = it.lat; ms.lon = it.lon; ms.phase = 'vtol descent';
      ms.altAmsl = rateTo(ms.altAmsl, it.altAmsl, dt);
      if (ms.altAmsl === it.altAmsl) next();
    }
  } else if (LOITER_CMDS.includes(it.cmd)) {
    const rp = it.cmd === 31 ? it.p2 : it.p3;           // radius param (negative = counter-clockwise)
    const R = Math.abs(rp) || opt.loiterR, dir = rp < 0 ? -1 : 1;
    if (!ms.orbit) {
      if (it.cmd !== 31) ms.altAmsl = rateTo(ms.altAmsl, it.altAmsl, dt);
      if (dist > R + step) { ms.phase = 'to loiter'; flyToward(); return ms; }
      if (dist < R - step) {                             // inside the circle: fly out to it
        ms.phase = 'to loiter';
        if (dist > 1) ms.hdg = bearingTo(it.lat, it.lon, ms.lat, ms.lon);
        [ms.lat, ms.lon] = dest(ms.lat, ms.lon, ms.hdg, step);
        return ms;
      }
      // within one step of the circle: join it (moves at most one step radially)
      ms.orbit = { ang: bearingTo(it.lat, it.lon, ms.lat, ms.lon) * D2R, swept: 0, t: 0 };
    }
    const o = ms.orbit, w = v / R * dt;
    o.ang += dir * w; o.swept += w; o.t += dt;
    [ms.lat, ms.lon] = dest(it.lat, it.lon, o.ang * R2D, R);
    ms.hdg = ((o.ang * R2D + dir * 90) % 360 + 360) % 360;
    ms.roll = dir * Math.atan2(v * v, R * GRAV) * R2D;
    ms.altAmsl = rateTo(ms.altAmsl, it.altAmsl, dt);
    ms.phase = it.name.toLowerCase();
    const reached = ms.altAmsl === it.altAmsl;
    if ((it.cmd === 31 && reached) ||
        (it.cmd === 18 && o.swept >= 2 * Math.PI * Math.max(it.p1, 0) - 1e-9) ||
        (it.cmd === 19 && o.t >= it.p1 - 1e-9)) next();
  } else {                                               // WAYPOINT / SPLINE / TAKEOFF / LAND
    if (!ms.leg) ms.leg = { fromAlt: ms.altAmsl, d0: Math.max(dist, 1e-9) };
    ms.phase = it.name.toLowerCase();
    if (dist <= step) { ms.lat = it.lat; ms.lon = it.lon; ms.altAmsl = it.altAmsl; next(); }
    else {
      flyToward();
      const frac = Math.min(1, 1 - (dist - step) / ms.leg.d0);
      ms.altAmsl = ms.leg.fromAlt + (it.altAmsl - ms.leg.fromAlt) * frac;   // interpolated (MAP-14)
    }
  }
  return ms;
}

// ─── Live data helpers (plan §8.3 / §14.5) ───────────────────────────────────
// LQ below 70 % = "FPV LINK WEAK" (manual, callouts table).
const LQ_WEAK_PCT = 70;
function lqClass(lq) { return isNum(lq) ? (lq < LQ_WEAK_PCT ? 'weak' : 'ok') : 'unknown'; }
function pruneTrail(trail, nowMs, keepMs = 300000) {
  let i = 0;
  while (i < trail.length && nowMs - trail[i].t > keepMs) i++;
  return i ? trail.slice(i) : trail;
}
// Average LQ per grid cell of client positions → [{s, w, n, e, count, lq}].
function binSamples(samples, cellM) {
  const pts = samples.filter(s => isNum(s.lat) && isNum(s.lon));
  if (!pts.length) return [];
  const dLat = cellM / 111320, dLon = cellM / (111320 * Math.max(0.01, Math.cos(pts[0].lat * D2R)));
  const cells = new Map();
  for (const p of pts) {
    const iy = Math.floor(p.lat / dLat), ix = Math.floor(p.lon / dLon), key = iy + ',' + ix;
    let c = cells.get(key);
    if (!c) cells.set(key, c = { s: iy * dLat, w: ix * dLon, n: (iy + 1) * dLat, e: (ix + 1) * dLon,
                                 count: 0, lqSum: 0, lqN: 0 });
    c.count++;
    if (isNum(p.lq)) { c.lqSum += p.lq; c.lqN++; }
  }
  return [...cells.values()].map(c => ({ s: c.s, w: c.w, n: c.n, e: c.e, count: c.count,
                                         lq: c.lqN ? c.lqSum / c.lqN : null }));
}

// ─── Vegetation from topo-map tile colours (MAP-11) ──────────────────────────
// Forest fill colour of the Kartverket topo map, measured on z13 tiles over forest in Innlandet
// (61.0N 11.4E, 60.5N 11.9E), 2026-10-16: ≈ RGB(210,224,150). Hill shading changes brightness
// but keeps the channel differences, so a pixel is forest when G−R 8…16, G−B 69…77, G 165…240.
// Fields, open land, water, marsh and roads in the same tiles fall outside this range.
// (Only Norgeskart is sampled: its CC BY 4.0 licence allows fetching tiles that are not on screen;
// other topo sources' tile policies do not — see relay/map.html, MAP-08.)
const FOREST_RGB = {
  norgeskart: { gr: [8, 16], gb: [69, 77], g: [165, 240] },
};
function isForestColour(r, g, b, src) {
  const f = FOREST_RGB[src];
  if (!f) return false;
  const gr = g - r, gb = g - b;
  return gr >= f.gr[0] && gr <= f.gr[1] && gb >= f.gb[0] && gb <= f.gb[1] && g >= f.g[0] && g <= f.g[1];
}

function pointInPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fmtFreq(mhz) {
  if (!isNum(mhz)) return 'TBD';
  return mhz >= 1000 ? +(mhz / 1000).toFixed(2) + ' GHz' : +mhz.toFixed(1) + ' MHz';
}

return {
  EARTH_R, EARTH_R_EFF, C_MS, DEFAULT_PROFILES, LINK_FIELDS, FIELD_LABELS, NAV_CMDS, FRAME_REF, PATCH_N,
  PATCH_BORESIGHTS, SIM_CLIMB_MS, SIM_SINK_MS, LQ_WEAK_PCT, FOREST_RGB,
  isNum, dest, distM, bearingTo,
  tileFrac, tileOf, tilePixel, tileKey, tilesForBounds, mPerPixel, terrariumM, demStep,
  dbmToMw, mwToDbm, fsplDb, rangeForLossM, missingFields, linkBudgetDb, linkRangeM,
  fresnelR1, foliageLossDb,
  brgToNed, nedToBody, patchGain, antennaFactor, antennaFacing,
  traceRay, linkRadials, intersectRanges, clientCoverage, starPolygon, gcsCoverage,
  gridCreate, gridAddPolygon, gridRings, gridCellCount,
  parseMission, resolveMissionAlts, missionStart, missionStep,
  lqClass, pruneTrail, binSamples, isForestColour, pointInPoly, fmtFreq,
};
});
