'use strict';
// Inline SVG diagrams of manual.html (plan §9.2): motors, mission profile, line of sight / Fresnel, orbit top view.
// CSS variables only, text ≥ 13 viewBox units with a min-width class (≥ 11 px when scrolled on a phone),
// role="img" + <title>/<desc>, quad icons via <use href="#sym-quad"> (symbol defined once at the top of manual.html).
// blocks() → { motors, mission, los, orbit }: each '<div class="dg-scroll">…</div></div>' block as it stands in the page.
// apply(html) replaces the four existing blocks (found by their aria-labelledby ids) and returns the new page text.
const r = v => Math.round(v * 10) / 10;
const T = (x, y, s, o = {}) => '<text x="' + r(x) + '" y="' + r(y) + '" font-size="' + (o.size || 13) + '" fill="' + (o.fill || 'var(--text)') + '"' + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '') + (o.weight ? ' font-weight="' + o.weight + '"' : '') + (o.ls ? ' letter-spacing="' + o.ls + '"' : '') + (o.rot ? ' transform="rotate(' + o.rot + ' ' + r(x) + ' ' + r(y) + ')"' : '') + '>' + s + '</text>';
const marker = (id, c) => '<marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + c + '"/></marker>';
const wrap = (svg, cap) => '<div class="dg-scroll">\n  ' + svg + '\n  <div class="dg-cap">' + cap + '</div></div>';


function blocks() {
  const B = {};

  // ── 1. Motor configuration ──
  {
    const mx = [60, 196, 332];
    let s = '<svg viewBox="0 0 640 384" xmlns="http://www.w3.org/2000/svg" class="man-svg mw-560" role="img" aria-labelledby="svg-motors-t svg-motors-d">'
      + '<title id="svg-motors-t">Heewing T2 Cruza motor configuration — top view and tilt side view</title>'
      + '<desc id="svg-motors-d">Three motors: M1 and M2 on the wings tilt about the spanwise tilt axis from 0° (vertical lift) forward; M4 on the tail gives VTOL lift only and stops after the transition. Propeller rotation directions: TBD, confirm on the airframe; the front pair must turn in opposite directions. Side view: 0° in VTOL, 80° = Q_TILT_MAX during the transition until airspeed, fully forward in fixed-wing flight; tilt rate 40°/s.</desc>'
      + '<defs>' + marker('mot-ah-amber', 'var(--amber)') + marker('mot-ah-text', 'var(--text)') + marker('mot-ah-green', 'var(--green)') + marker('mot-ah-accent', 'var(--accent)') + '</defs>'
      + T(16, 22, 'MOTORS — TOP VIEW', { size: 14, fill: 'var(--muted)', ls: 2 })
      + '<line x1="' + mx[1] + '" y1="44" x2="' + mx[1] + '" y2="30" stroke="var(--muted)" marker-end="url(#mot-ah-text)"/>' + T(mx[1] + 10, 40, 'FWD', { fill: 'var(--muted)' })
      + '<rect x="184" y="48" width="24" height="196" rx="10" fill="var(--surface2)" stroke="var(--dim)" stroke-width="1.5"/>'
      + '<polygon points="196,104 30,128 44,150 184,126 208,126 348,150 362,128" fill="var(--surface2)" stroke="var(--dim)" stroke-width="1.5"/>'
      + '<line x1="14" y1="128" x2="378" y2="128" stroke="var(--amber)" stroke-dasharray="6,4"/>' + T(240, 120, 'TILT AXIS', { fill: 'var(--amber)' })
      + [[mx[0], 128, 'M1'], [mx[2], 128, 'M2']].map(([x, y, n]) => '<circle cx="' + x + '" cy="' + y + '" r="28" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5"/>'
        + T(x, y - 2, n, { size: 15, fill: 'var(--accent)', anchor: 'middle', weight: 'bold' }) + T(x, y + 14, 'TILT', { fill: 'var(--accent)', anchor: 'middle' })
        + '<path d="M' + (x - 30) + ',' + (y - 24) + ' A38,38 0 0,1 ' + (x + 30) + ',' + (y - 24) + '" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4,3" marker-start="url(#mot-ah-amber)" marker-end="url(#mot-ah-amber)"/>').join('')
      + '<circle cx="' + mx[1] + '" cy="268" r="26" fill="var(--surface)" stroke="var(--text)" stroke-width="2"/>'
      + T(mx[1], 266, 'M4', { size: 15, anchor: 'middle', weight: 'bold' }) + T(mx[1], 282, 'LIFT', { anchor: 'middle' })
      + '<path d="M' + (mx[1] - 28) + ',' + (268 + 26) + ' A38,38 0 0,0 ' + (mx[1] + 28) + ',' + (268 + 26) + '" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="4,3" marker-start="url(#mot-ah-amber)" marker-end="url(#mot-ah-amber)"/>'
      + T(16, 186, 'prop rotation', { fill: 'var(--amber)' }) + T(16, 202, 'CW / CCW: TBD', { fill: 'var(--amber)', weight: 'bold' }) + T(16, 218, 'confirm on the', { fill: 'var(--amber)' }) + T(16, 234, 'airframe', { fill: 'var(--amber)' })
      // side-view inset
      + '<rect x="398" y="34" width="230" height="250" fill="var(--bg)" stroke="var(--border2)"/>'
      + T(410, 56, 'TILT — SIDE VIEW', { size: 14, fill: 'var(--muted)', ls: 1 }) + T(612, 56, 'FWD →', { fill: 'var(--muted)', anchor: 'end' })
      + '<line x1="420" y1="214" x2="600" y2="214" stroke="var(--dim)" stroke-width="6" stroke-linecap="round"/>' + T(424, 240, 'wing', { fill: 'var(--muted)' })
      + '<circle cx="470" cy="214" r="6" fill="var(--accent)"/>'
      + '<line x1="470" y1="214" x2="470" y2="100" stroke="var(--green)" stroke-width="3" marker-end="url(#mot-ah-green)"/>' + T(480, 96, '0° VTOL lift', { fill: 'var(--green)', weight: 'bold' })
      + '<line x1="470" y1="214" x2="' + r(470 + 110 * Math.sin(80 * Math.PI / 180)) + '" y2="' + r(214 - 110 * Math.cos(80 * Math.PI / 180)) + '" stroke="var(--amber)" stroke-width="3" marker-end="url(#mot-ah-amber)"/>'
      + T(500, 170, '80° Q_TILT_MAX', { fill: 'var(--amber)', weight: 'bold' }) + T(500, 154, 'transition:', { fill: 'var(--amber)' })
      + '<line x1="470" y1="214" x2="590" y2="214" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5,4" marker-end="url(#mot-ah-accent)"/>'
      + T(500, 268, 'FW: fully forward', { fill: 'var(--accent)' })
      + T(410, 128, 'rate', { fill: 'var(--muted)' }) + T(410, 144, '40°/s', { fill: 'var(--muted)' })
      + T(16, 316, 'M1/M2 wing motors: VTOL lift (0°) and fixed-wing thrust.') + T(16, 334, 'M4 tail: VTOL lift only, stops when the transition is complete.')
      + T(16, 352, 'Q_TILT_MAX = tilt held during the transition until airspeed', { fill: 'var(--muted)' }) + T(16, 370, '(ArduPilot tilt-rotor guide) — VERIFY against the param file.', { fill: 'var(--amber)' })
      + '</svg>';
    B.motors = wrap(s, 'Tri tilt-rotor (<code>Q_FRAME_CLASS</code> 7): M1/M2 tilt, M4 lift only. Prop directions: <span class="warn-val">TBD — confirm on the airframe</span> (ArduPilot: the front pair must turn in opposite directions, or roll and pitch inputs cause adverse yaw).');
  }


  // ── 3. Mission altitude profile ──
  {
    const G = 300, Y = m => G - m * 1.6;
    const X = [110, 260, 400, 540, 680, 790, 860];
    const wp = (i, m, big) => '<circle cx="' + X[i] + '" cy="' + r(Y(m)) + '" r="' + (big ? 9 : 7) + '" fill="' + (big ? 'var(--accent)' : 'var(--bg)') + '" stroke="var(--accent)" stroke-width="2.5"/>';
    const rangeBar = (x, a, b) => '<line x1="' + x + '" y1="' + r(Y(a)) + '" x2="' + x + '" y2="' + r(Y(b)) + '" stroke="var(--amber)" stroke-width="4"/>';
    let s = '<svg viewBox="0 0 900 420" xmlns="http://www.w3.org/2000/svg" class="man-svg mw-780" role="img" aria-labelledby="svg-mission-t svg-mission-d">'
      + '<title id="svg-mission-t">7-waypoint mission altitude profile (REL m), with distances, transition corridor, abort branch and back-transition</title>'
      + '<desc id="svg-mission-d">Altitude scale 0–150 m REL. WP1 VTOL_TAKEOFF 20–30 m at the launch point. Transition corridor WP1 to WP2, 100–200 m into wind, clear of obstacles to 60 m; WP2 WAYPOINT 50–80 m, 300 m or more clear beyond. Abort: no airspeed within 3 s → QHOVER; Q_TRANS_FAIL 4 s → automatic QLand (verify). WP3 LOITER_TO_ALT climbs to the relay altitude (60–140 m, per site); WP4 sortie-specific orbit centre at relay altitude; WP5 LOITER_TO_ALT 30–40 m, 400 m or more upwind of the landing zone; WP6 WAYPOINT 20–25 m; back-transition glide about 100–130 m (10 s); WP7 VTOL_LAND. Horizontal distances not to scale.</desc>'
      + '<defs>' + marker('mis-ah-red', 'var(--red)') + marker('mis-ah-muted', 'var(--muted)') + '</defs>';
    [0, 25, 50, 75, 100, 125, 150].forEach(m => { s += '<line x1="70" y1="' + Y(m) + '" x2="890" y2="' + Y(m) + '" stroke="var(--border2)" stroke-width="' + (m ? 0.5 : 1.5) + '"' + (m ? ' stroke-dasharray="3,6"' : '') + '/>' + T(62, Y(m) + 4, String(m), { fill: 'var(--muted)', anchor: 'end' }); });
    s += T(62, 40, 'REL m', { fill: 'var(--muted)', anchor: 'end' });
    // corridor and relay band
    s += '<rect x="110" y="' + Y(60) + '" width="150" height="' + r(60 * 1.6) + '" fill="var(--green)" fill-opacity="0.08" stroke="var(--green)" stroke-dasharray="4,4"/>'
      + T(130, Y(12), 'corridor clear to 60 m', { fill: 'var(--green)' })
      + '<rect x="400" y="' + Y(140) + '" width="200" height="' + r(80 * 1.6) + '" fill="var(--accent)" fill-opacity="0.07"/>'
      + T(408, Y(140) + 16, 'relay altitude 60–140 m', { fill: 'var(--accent)' }) + T(408, Y(140) + 32, '(per site — relay table)', { fill: 'var(--muted)' });
    // path
    s += '<line x1="' + X[0] + '" y1="' + G + '" x2="' + X[0] + '" y2="' + Y(25) + '" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5,3"/>'
      + '<polyline points="' + X[0] + ',' + Y(25) + ' ' + X[1] + ',' + Y(65) + ' ' + X[2] + ',' + Y(100) + ' ' + X[3] + ',' + Y(100) + ' ' + X[4] + ',' + Y(35) + ' ' + X[5] + ',' + Y(22) + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>'
      + '<line x1="' + X[5] + '" y1="' + Y(22) + '" x2="' + X[6] + '" y2="' + Y(22) + '" stroke="var(--accent)" stroke-width="2.5" stroke-dasharray="2,3"/>'
      + '<line x1="' + X[6] + '" y1="' + Y(22) + '" x2="' + X[6] + '" y2="' + G + '" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5,3"/>';
    s += rangeBar(X[0] - 14, 20, 30) + rangeBar(X[1] + 14, 50, 80) + rangeBar(X[4] + 14, 30, 40) + rangeBar(X[5] - 14, 20, 25);
    s += wp(0, 0) + wp(1, 65) + wp(2, 100) + wp(3, 100, true) + wp(4, 35) + wp(5, 22) + wp(6, 0);
    // abort branch
    const ax = 190, ay = Y(25 + (65 - 25) * (190 - 110) / 150);
    s += '<polyline points="' + ax + ',' + r(ay) + ' 180,92" fill="none" stroke="var(--red)" stroke-width="2" stroke-dasharray="4,3" marker-end="url(#mis-ah-red)"/>'
      + T(84, 64, 'ABORT: no airspeed in 3 s → QHOVER', { fill: 'var(--red)', weight: 'bold' }) + T(84, 82, '(4 s: automatic QLand — VERIFY)', { fill: 'var(--amber)' });
    // WP labels
    const names = ['VTOL_TAKEOFF', 'WAYPOINT', 'LOITER_TO_ALT', 'WAYPOINT', 'LOITER_TO_ALT', 'WAYPOINT', 'VTOL_LAND'];
    const alts = ['20–30 m', '50–80 m', 'relay alt', 'relay alt', '30–40 m', '20–25 m', '0 m'];
    const lift = [0, 65, 100, 100, 35, 22, 0];
    X.forEach((x, i) => {
      s += T(x, Y(lift[i]) - 14, 'WP' + (i + 1), { fill: i === 3 ? 'var(--text)' : 'var(--accent)', anchor: 'middle', weight: 'bold', size: 14 });
      s += T(x, G + 18 + (i % 2) * 15, names[i], { fill: 'var(--muted)', anchor: 'middle' });
    });
    s += T(X[0] + 22, Y(25) + 4, alts[0], { fill: 'var(--amber)' }) + T(X[1] + 22, Y(80) - 4, alts[1], { fill: 'var(--amber)' })
      + T(X[4] + 22, Y(40) - 4, alts[4], { fill: 'var(--amber)' }) + T(X[5] - 22, Y(25) - 8, alts[5], { fill: 'var(--amber)', anchor: 'end' })
      + T(X[3], Y(100) + 26, 'sortie-specific', { fill: 'var(--muted)', anchor: 'middle' });
    // distances
    const dist = (a, b, y, label) => '<line x1="' + a + '" y1="' + y + '" x2="' + b + '" y2="' + y + '" stroke="var(--muted)" marker-start="url(#mis-ah-muted)" marker-end="url(#mis-ah-muted)"/>' + T((a + b) / 2, y + 16, label, { fill: 'var(--muted)', anchor: 'middle' });
    s += dist(X[0], X[1], 352, '100–200 m into wind') + dist(X[1], X[1] + 120, 380, '300 m+ clear beyond')
      + dist(X[4], X[6], 352, '400 m+ upwind of LZ') + '<line x1="' + X[5] + '" y1="380" x2="' + X[6] + '" y2="380" stroke="var(--accent)" marker-start="url(#mis-ah-muted)" marker-end="url(#mis-ah-muted)"/>' + T(X[6] + 20, 400, 'back-transition glide ≈100–130 m (10 s)', { fill: 'var(--accent)', anchor: 'end' });
    s += T(890, 26, 'horizontal: not to scale', { fill: 'var(--muted)', anchor: 'end' })
      + '</svg>';
    B.mission = wrap(s, 'Altitudes from the 7-WP template (Mission Planning). Relay altitude per site (relay-altitude table). Scroll sideways on a phone.');
  }


  // ── 5. RF line of sight with the Fresnel zone and both links ──
  {
    const ell = (x1, y1, x2, y2, ry, c, op) => {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return '<ellipse cx="' + r(mx) + '" cy="' + r(my) + '" rx="' + r(len / 2) + '" ry="' + ry + '" transform="rotate(' + r(ang) + ' ' + r(mx) + ' ' + r(my) + ')" fill="' + c + '" fill-opacity="' + op + '" stroke="' + c + '" stroke-dasharray="5,4"/>';
    };
    const lo = [200, 196], hi = [200, 66], cl = [640, 246], gs = [64, 196];
    let s = '<svg viewBox="0 0 700 392" xmlns="http://www.w3.org/2000/svg" class="man-svg mw-600" role="img" aria-labelledby="svg-los-t svg-los-d">'
      + '<title id="svg-los-t">RF line of sight and Fresnel zone — why relay altitude matters, for both links</title>'
      + '<desc id="svg-los-d">Two links: the HM30 IP link between the ground station mast and the carrier, and the client links (ELRS RC and analog video) between the carrier and the client. With the carrier low, the straight line to the client just clears the terrain but the first Fresnel zone is obstructed, so the link fades. With the carrier high, the line and the Fresnel zone are clear. Keep at least 60 % of the first Fresnel zone radius clear; lower bands need a larger zone.</desc>';
    s += '<rect x="0" y="270" width="700" height="122" fill="var(--surface)"/><line x1="10" y1="270" x2="690" y2="270" stroke="var(--border2)"/>';
    s += ell(lo[0], lo[1], cl[0], cl[1], 26, 'var(--red)', 0.12) + ell(hi[0], hi[1], cl[0], cl[1], 26, 'var(--green)', 0.08);
    s += '<polygon points="230,270 300,232 340,216 380,232 450,270" fill="var(--surface2)" stroke="var(--dim)"/>' + T(340, 256, 'TERRAIN', { fill: 'var(--muted)', anchor: 'middle' });
    s += '<path d="M318,224 L340,216 L362,224 L352,214 L340,206 L328,214 Z" fill="var(--red)" fill-opacity="0.45"/>';
    s += '<line x1="' + gs[0] + '" y1="270" x2="' + gs[0] + '" y2="' + gs[1] + '" stroke="var(--text)" stroke-width="2"/>' + T(gs[0], 288, 'GCS MAST', { fill: 'var(--muted)', anchor: 'middle' })
      + '<line x1="' + gs[0] + '" y1="' + gs[1] + '" x2="' + lo[0] + '" y2="' + lo[1] + '" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="6,4"/>'
      + '<line x1="' + gs[0] + '" y1="' + gs[1] + '" x2="' + hi[0] + '" y2="' + hi[1] + '" stroke="var(--text)" stroke-width="2"/>'
      + T(108, 116, 'HM30', { rot: -44, weight: 'bold' })
      + '<line x1="' + lo[0] + '" y1="' + lo[1] + '" x2="' + cl[0] + '" y2="' + cl[1] + '" stroke="var(--red)" stroke-width="1.5" stroke-dasharray="6,4"/>'
      + '<line x1="' + hi[0] + '" y1="' + hi[1] + '" x2="' + cl[0] + '" y2="' + cl[1] + '" stroke="var(--green)" stroke-width="2"/>';
    const plane = (x, y, c) => '<polygon points="' + (x - 14) + ',' + y + ' ' + (x + 14) + ',' + y + ' ' + (x + 18) + ',' + (y - 4) + ' ' + (x - 10) + ',' + (y - 4) + '" fill="' + c + '"/><line x1="' + (x - 10) + '" y1="' + (y - 2) + '" x2="' + (x - 14) + '" y2="' + (y - 12) + '" stroke="' + c + '" stroke-width="3"/>';
    s += plane(hi[0], hi[1], 'var(--accent)') + T(hi[0], hi[1] - 18, 'CARRIER HIGH', { fill: 'var(--accent)', anchor: 'middle', weight: 'bold' })
      + plane(lo[0], lo[1], 'var(--accent)') + T(lo[0] - 4, lo[1] + 22, 'CARRIER LOW', { fill: 'var(--accent)', anchor: 'middle', weight: 'bold' })
      + '<use href="#sym-quad" x="' + (cl[0] - 14) + '" y="' + (cl[1] - 14) + '" width="28" height="28" class="q-green"/>' + T(cl[0], cl[1] + 30, 'CLIENT', { fill: 'var(--green)', anchor: 'middle', weight: 'bold' });
    s += T(410, 120, 'HIGH: line and Fresnel zone clear', { fill: 'var(--green)', weight: 'bold' })
      + T(430, 296, 'LOW: line clears, but the', { fill: 'var(--red)', weight: 'bold' }) + T(430, 312, 'Fresnel zone is blocked → fades', { fill: 'var(--red)' });
    s += T(16, 340, 'Client links: RC ELRS <tspan data-tok="client.elrs.band">2.4 GHz</tspan> · video <tspan data-tok="client.vtx.freqMHz">5806</tspan> MHz · GCS link: HM30.', { fill: 'var(--text)' })
      + T(16, 360, '1st Fresnel radius r1 = √(λ·d1·d2 / (d1 + d2)); keep ≥ 60 % of r1 clear (map k = 0.6).', { fill: 'var(--muted)' })
      + T(16, 380, 'Lower bands (868 / 915 MHz) need a larger zone; the more demanding link sets the altitude.', { fill: 'var(--muted)' })
      + '</svg>';
    B.los = wrap(s, 'Both links need line of sight <strong>and</strong> a clear Fresnel zone. Bands come from the active client profile.');
  }

  // ── 6. Orbit geometry, top view ──
  {
    const C = [380, 214], R = 140, Rin = 66;
    const phi = 225 * Math.PI / 180, cr = [C[0] + R * Math.cos(phi), C[1] + R * Math.sin(phi)];
    const cone = [10, 80].map(a => [cr[0] + 160 * Math.cos(a * Math.PI / 180), cr[1] + 160 * Math.sin(a * Math.PI / 180)]);
    const gs = [70, 402], cli = [350, 250];
    const d = [C[0] - gs[0], C[1] - gs[1]], dl = Math.hypot(d[0], d[1]), sh = [C[0] - R * d[0] / dl, C[1] - R * d[1] / dl];
    let s = '<svg viewBox="0 0 640 520" xmlns="http://www.w3.org/2000/svg" class="man-svg mw-560" role="img" aria-labelledby="svg-orbit-t svg-orbit-d">'
      + '<title id="svg-orbit-t">Relay orbit geometry, top view: links, patch beam, always-covered inner zone, body shadow and wind drift</title>'
      + '<desc id="svg-orbit-d">The carrier flies a clockwise orbit (150–250 m radius, check on the map) around the client\'s operating area. Its two VRX patches face the right wing, inward, with a beam of about 70°. The HM30 link (MAVLink, RC, video) runs from the ground station to the carrier; the client video and client RC run between the carrier and the client. The inner zone from the map\'s orbit sweep is covered at every point of the orbit: keep the client there, inside the orbit. Where the carrier passes between the ground station and the client, the airframe can shadow both links for a moment. Wind makes the orbit drift downwind.</desc>'
      + '<defs>' + marker('orb-ah-accent', 'var(--accent)') + marker('orb-ah-muted', 'var(--muted)') + '</defs>';
    s += '<circle cx="' + C[0] + '" cy="' + C[1] + '" r="' + R + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="8,6"/>';
    s += '<circle cx="' + C[0] + '" cy="' + C[1] + '" r="' + Rin + '" fill="var(--green)" fill-opacity="0.2" stroke="var(--green)" stroke-width="1.5"/>'
      + T(C[0] + 22, C[1] - 18, 'ALWAYS', { fill: 'var(--green)', anchor: 'middle', weight: 'bold' }) + T(C[0] + 22, C[1] - 2, 'COVERED', { fill: 'var(--green)', anchor: 'middle', weight: 'bold' });
    [[0, 'R'], [90, 'D'], [180, 'L']].forEach(([deg]) => {   // clockwise direction marks
      const a = deg * Math.PI / 180, p = [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)], t = [-Math.sin(a), Math.cos(a)];
      s += '<line x1="' + r(p[0] - t[0] * 10) + '" y1="' + r(p[1] - t[1] * 10) + '" x2="' + r(p[0] + t[0] * 10) + '" y2="' + r(p[1] + t[1] * 10) + '" stroke="var(--accent)" stroke-width="2" marker-end="url(#orb-ah-accent)"/>';
    });
    s += '<polygon points="' + r(cr[0]) + ',' + r(cr[1]) + ' ' + r(cone[0][0]) + ',' + r(cone[0][1]) + ' ' + r(cone[1][0]) + ',' + r(cone[1][1]) + '" fill="var(--amber)" fill-opacity="0.12" stroke="var(--amber)" stroke-dasharray="3,3"/>'
      + T(300, 140, 'patch beam', { fill: 'var(--amber)' }) + T(300, 156, '≈70°', { fill: 'var(--amber)' });
    s += '<g transform="translate(' + r(cr[0]) + ',' + r(cr[1]) + ') rotate(45)"><polygon points="0,-15 -7,8 0,4 7,8" fill="var(--accent)"/></g>'
      + T(cr[0] - 12, cr[1] - 18, 'CARRIER', { fill: 'var(--accent)', anchor: 'end', weight: 'bold' });
    s += '<use href="#sym-quad" x="' + (cli[0] - 13) + '" y="' + (cli[1] - 13) + '" width="26" height="26" class="q-green"/>' + T(cli[0] - 22, cli[1] + 5, 'CLIENT', { fill: 'var(--green)', weight: 'bold', anchor: 'end' });
    s += '<rect x="' + (gs[0] - 50) + '" y="' + (gs[1] - 6) + '" width="100" height="40" fill="var(--surface2)" stroke="var(--dim)"/>' + T(gs[0], gs[1] + 19, 'GCS', { anchor: 'middle', weight: 'bold' })
      + '<line x1="' + gs[0] + '" y1="' + (gs[1] - 6) + '" x2="' + r(cr[0]) + '" y2="' + r(cr[1]) + '" stroke="var(--text)" stroke-width="1.5" stroke-dasharray="7,4"/>'
      + T(150, 272, 'HM30 · MAVLink · RC · video', { rot: -58.5 });
    s += '<line x1="' + r(cr[0]) + '" y1="' + r(cr[1]) + '" x2="' + cli[0] + '" y2="' + cli[1] + '" stroke="var(--red)" stroke-width="1.5" stroke-dasharray="7,4"/>';
    s += '<circle cx="' + r(sh[0]) + '" cy="' + r(sh[1]) + '" r="8" fill="none" stroke="var(--amber)" stroke-width="2"/>' + '<line x1="' + r(sh[0]) + '" y1="' + r(sh[1] + 8) + '" x2="' + r(sh[0]) + '" y2="376" stroke="var(--amber)" stroke-dasharray="2,3"/>' + T(sh[0] - 20, 392, '⚠ BODY SHADOW: carrier between', { fill: 'var(--amber)', weight: 'bold' }) + T(sh[0] - 20, 408, 'GCS and client — brief null', { fill: 'var(--amber)' });
    s += '<line x1="' + C[0] + '" y1="' + C[1] + '" x2="' + (C[0] + R) + '" y2="' + C[1] + '" stroke="var(--muted)" stroke-dasharray="2,4"/>' + T(C[0] + 70, C[1] + 18, '150–250 m', { fill: 'var(--muted)', anchor: 'middle' });
    s += '<line x1="470" y1="40" x2="560" y2="40" stroke="var(--muted)" stroke-width="2" marker-end="url(#orb-ah-muted)"/>' + T(470, 30, 'WIND', { fill: 'var(--muted)', weight: 'bold' }) + T(470, 62, 'orbit drifts downwind', { fill: 'var(--muted)' });
    s += T(16, 26, 'RELAY ORBIT — TOP VIEW', { size: 14, fill: 'var(--muted)', ls: 2 }) + T(16, 46, 'clockwise: patches face inward', { fill: 'var(--muted)' });
    s += T(16, 470, 'Client links: video <tspan data-tok="client.vtx.freqMHz">5806</tspan> MHz · RC ELRS <tspan data-tok="client.elrs.band">2.4 GHz</tspan>.', { fill: 'var(--text)' })
      + T(16, 490, 'Keep the client inside the orbit, in the inner zone (map orbit sweep).', { fill: 'var(--green)', weight: 'bold' })
      + T(16, 510, 'Ground link — white dashed · client links — red dashed · patch beam — amber.', { fill: 'var(--muted)' })
      + '</svg>';
    B.orbit = wrap(s, 'Inner zone from the coverage MAP\'s orbit sweep (worst case over one orbit). Bands come from the active client profile.');
  }


  return B;
}

const IDS = { motors: 'svg-motors-t', mission: 'svg-mission-t', los: 'svg-los-t', orbit: 'svg-orbit-t' };
// Locate a block: the '<div class="dg-scroll">' before its <svg … aria-labelledby="<id> …"> up to the closing '</div></div>'.
function locate(html, key) {
  const k = html.indexOf('aria-labelledby="' + IDS[key] + ' ');
  if (k < 0) throw new Error('inline block not found in manual.html: ' + key);
  const i = html.lastIndexOf('<div class="dg-scroll">', k), j = html.indexOf('</div></div>', k);
  if (i < 0 || j < 0) throw new Error('inline block frame not found: ' + key);
  return [i, j + '</div></div>'.length];
}
function apply(html) {
  const B = blocks();
  for (const key of Object.keys(IDS)) { const [i, j] = locate(html, key); html = html.slice(0, i) + B[key] + html.slice(j); }
  return html;
}
module.exports = { blocks, apply, locate, IDS };
