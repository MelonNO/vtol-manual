'use strict';
// Diagram definitions for scripts/diagrams/build.js: each entry returns { h, heading, sub, title, desc, source, body } for lib.doc().
const { P, t, lines, box, group, line, pill } = require('./lib.js');
const D = {};
const rect = (x, y, w, h, fill, o = {}) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"' + (o.op != null ? ' fill-opacity="' + o.op + '"' : '') + (o.stroke ? ' stroke="' + o.stroke + '"' : '') + (o.dash ? ' stroke-dasharray="' + o.dash + '"' : '') + (o.rx ? ' rx="' + o.rx + '"' : '') + '/>';

// ── D9 CARRIER ANTENNA LAYOUT ── plan §9.3 D9; patch boresights from relay/rfmodel.js (PATCH_BORESIGHTS); relay design layout notes, test 7.
D['d09-antenna-layout'] = () => {
  const b = [];
  let y = 78;
  b.push(lines(18, y, [{ s: 'Schematic. Mounting positions and', o: { fill: P.amber, weight: 'bold' } }, { s: 'separations: TBD — from own annotated', o: { fill: P.amber } }, { s: 'photos and relay-design test 7.', o: { fill: P.amber } }], { maxw: 364 }));
  // Top view
  y = 150;
  b.push(t(18, y, 'TOP VIEW', { weight: 'bold', fill: P.muted }));
  const cx = 120, wy = y + 80;
  b.push('<polygon points="' + cx + ',' + (y + 22) + ' ' + (cx + 10) + ',' + (y + 40) + ' ' + (cx + 10) + ',' + (y + 200) + ' ' + (cx - 10) + ',' + (y + 200) + ' ' + (cx - 10) + ',' + (y + 40) + '" fill="' + P.surf2 + '" stroke="' + P.dim + '"/>');
  b.push('<polygon points="' + (cx - 10) + ',' + (wy - 12) + ' ' + (cx - 100) + ',' + (wy + 2) + ' ' + (cx - 96) + ',' + (wy + 22) + ' ' + (cx - 10) + ',' + (wy + 16) + ' ' + (cx + 10) + ',' + (wy + 16) + ' ' + (cx + 96) + ',' + (wy + 22) + ' ' + (cx + 100) + ',' + (wy + 2) + ' ' + (cx + 10) + ',' + (wy - 12) + '" fill="' + P.surf2 + '" stroke="' + P.dim + '"/>');
  b.push('<polygon points="' + (cx - 40) + ',' + (y + 192) + ' ' + (cx + 40) + ',' + (y + 192) + ' ' + (cx + 40) + ',' + (y + 204) + ' ' + (cx - 40) + ',' + (y + 204) + '" fill="' + P.surf2 + '" stroke="' + P.dim + '"/>');
  b.push(t(cx, y + 18, 'FWD ▲', { anchor: 'middle', fill: P.muted, size: 14 }));
  b.push(line([[cx + 14, wy + 40], [cx + 116, wy + 40]], { c: P.red, w: 3 }));
  b.push(line([[cx + 14, wy + 54], [cx + 116, wy + 54]], { c: P.red, w: 3, dash: '6,4' }));
  b.push(lines(cx + 124, wy + 36, [{ s: 'VRX patch', o: { fill: P.red, weight: 'bold' } }, { s: 'boresights →', o: { fill: P.red } }, { s: 'right wing', o: { fill: P.red } }], { maxw: 110 }));
  if (0) b.push('<path d="M' + (cx + 150) + ',' + (y + 150) + ' A60,60 0 0,0 ' + (cx + 150) + ',' + (y + 30) + '" fill="none" stroke="' + P.muted + '" stroke-width="1.5" stroke-dasharray="4,4" marker-end="url(#ah-muted)"/>');
  b.push(lines(cx + 124, y + 182, [{ s: 'orbit centre', o: { fill: P.muted } }, { s: 'on the right', o: { fill: P.muted } }, { s: '(clockwise)', o: { fill: P.muted } }], { maxw: 150 }));
  // Front view
  y = 400;
  b.push(t(18, y, 'REAR VIEW (looking forward)', { weight: 'bold', fill: P.muted, maxw: 364 }));
  const fx = 130, fy = y + 70;
  b.push(rect(fx - 110, fy - 4, 220, 8, P.surf2, { stroke: P.dim }));
  b.push('<circle cx="' + fx + '" cy="' + fy + '" r="16" fill="' + P.surf2 + '" stroke="' + P.dim + '"/>');
  b.push(line([[fx, fy], [fx, fy - 52]], { c: P.muted, w: 1, dash: '3,3', end: false }));
  b.push(t(fx + 6, fy - 44, 'up 0°', { fill: P.muted }));
  b.push(line([[fx + 18, fy - 14], [fx + 120, fy - 14]], { c: P.red, w: 3 }));
  b.push(t(fx + 128, fy - 10, 'patch 1: 90°', { fill: P.red, maxw: 130 }));
  b.push(line([[fx + 14, fy + 14], [fx + 86, fy + 86]], { c: P.red, w: 3, dash: '6,4' }));
  b.push(lines(fx + 94, fy + 76, [{ s: 'patch 2: 135°', o: { fill: P.red } }, { s: '(45° down)', o: { fill: P.red } }], { maxw: 150 }));
  y = fy + 130;
  b.push(lines(18, y, ['Both patches face the inward (right)', 'side: fly the orbit so the operating', 'area is on the right (clockwise seen', 'from above). Model: coverage map,', { s: 'cos^3.5 pattern per patch.', o: { fill: P.muted } }], { maxw: 364 }));
  y += 5 * 18 + 22;
  // Antenna list
  b.push(t(18, y, 'ANTENNAS ON THE CARRIER', { weight: 'bold', fill: P.muted }));
  y += 10;
  const rows = [
    ['HM30 air unit antennas', 'GCS IP link · HM30 band TBD', P.text],
    ['VRX patches ×2', 'client video · band per client', P.red],
    ['ELRS TX module antenna', 'client RC · 868 / 915 / 2.4', P.accent],
    ['ELRS RX 915 antenna', 'carrier backup (close range)', P.muted],
    ['GPS', 'carrier FC', P.green]
  ];
  rows.forEach(r => {
    b.push(box(18, y, 364, 44, { align: 'left', top: 18, stroke: r[2], lines: [{ s: r[0], o: { weight: 'bold', fill: r[2] } }, { s: r[1] + ' · pos. TBD', o: { fill: P.muted } }], lh: 18 }));
    y += 50;
  });
  y += 14;
  b.push(t(18, y, 'CO-SITE (one airframe)', { weight: 'bold', fill: P.amber }));
  b.push(lines(18, y + 22, ['HM30, ELRS TX module and VRX run at', 'the same time. Test 7 (VRX picture +', 'RSSI at full power) and the cleanest', 'analog channel: TBD.', '25 MHz harmonics of the switch / W5500', 'land on 5800 MHz and near GPS L1', '(1575.42 MHz): keep GPS and VRX away', 'from the relay PCB (shield can room).'], { maxw: 364 }));
  y += 22 + 8 * 18;
  return { h: y + 16, heading: 'D9 · CARRIER ANTENNA LAYOUT', sub: 'Schematic · positions TBD',
    title: 'D9 — Carrier antenna layout (schematic): VRX patch orientation, antenna list, co-site notes',
    desc: 'Schematic top and rear views of the Heewing T2 Cruza. The two VRX patches face the right wing: patch 1 boresight horizontal to the right (90° from up), patch 2 right and 45° down (135°), as modelled in the coverage map (cos^3.5 per patch); fly the orbit with the operating area on the right (clockwise seen from above). '
      + 'Antennas: HM30 air unit (GCS IP link, band TBD), VRX patches (client video, band per client), ELRS TX module (client RC, 868/915/2.4 GHz), ELRS RX 915 (carrier backup, close range), GPS. Mounting positions and separation distances: TBD from own annotated photos and relay-design test 7. '
      + 'Co-site: HM30, ELRS TX module and VRX share one airframe; test 7 result and the cleanest analog channel TBD; 25 MHz harmonics of the switch and W5500 land on 5800 MHz and near GPS L1, so keep GPS and VRX away from the relay PCB.',
    source: 'Sources: plan §9.3 D9, §6.1.3 item 6 (co-site), §8.1; relay/rfmodel.js PATCH_BORESIGHTS and PATCH_N; relay design "PCB stackup and layout rules", test 7.', body: b };
};

// ── D10 GROUND STATION LAYOUT ── plan §9.3 D10, §3.1, §6.1.6, S-02a; manual crew table; data/content.js checklist C.
D['d10-ground-station'] = () => {
  const b = [];
  let y = 72;
  b.push(box(18, y, 170, 82, { title: 'MAST', lines: ['HM30 ground unit', '6S 3000 mAh'], stroke: P.text }));
  b.push(lines(200, y + 20, [{ s: 'link LED blue =', o: { fill: P.muted } }, { s: 'linked; check', o: { fill: P.muted } }, { s: 'mast battery V', o: { fill: P.muted } }], { maxw: 180 }));
  y += 82;
  b.push(line([[103, y], [103, y + 40]], { c: P.dim, w: 3 }));
  b.push(t(112, y + 26, 'Ethernet (static IP .X)', { fill: P.muted, maxw: 270 }));
  y += 42;
  b.push(group(8, y, 384, 236, 'GCS LAPTOP (Windows)', { stroke: P.text, labelFill: P.text }));
  b.push(box(18, y + 32, 172, 100, { title: 'Screen A', lines: ['Mission Planner', 'MAVLink UDPCI', 'never close in', 'flight'], stroke: P.green, lh: 18 }));
  b.push(box(210, y + 32, 172, 100, { title: 'Screen B (USB-C)', lines: ['client video', '(5601 or MP HUD', '5602) + GCS app', 'status bar'], stroke: P.red, lh: 18 }));
  b.push(lines(18, y + 156, [{ s: 'Screen use per crew agreement.', o: { fill: P.muted } }, { s: 'Power: mains where possible; never', o: { fill: P.amber } }, { s: 'sleep / hibernate, lid: do nothing.', o: { fill: P.amber } }, { s: 'App warns ON BATTERY / SAVER.', o: { fill: P.amber } }], { maxw: 364 }));
  y += 236;
  b.push(line([[300, y], [300, y + 40]], { c: P.dim, w: 3, start: true }));
  b.push(t(308, y + 26, 'USB', { fill: P.muted }));
  y += 42;
  b.push(group(8, y, 186, 200, 'CARRIER PILOT', { stroke: P.green, labelFill: P.green }));
  b.push(group(206, y, 186, 200, 'FPV PILOT', { stroke: P.accent, labelFill: P.accent }));
  b.push(lines(18, y + 46, ['Mission Planner', '(primary control)', { s: 'Nomad 915: close', o: { fill: P.muted } }, { s: 'range backup only', o: { fill: P.muted } }, '', 'watches carrier,', 'orbit, battery'], { maxw: 170, lh: 19 }));
  b.push(box(216, y + 32, 166, 66, { title: 'EdgeTX radio', lines: ['USB joystick', 'RF modules OFF'], stroke: P.accent, lh: 18 }));
  b.push(lines(216, y + 122, ['flies the client', 'through the app;', 'watches video and', 'app alarms'], { maxw: 170, lh: 19 }));
  y += 200;
  b.push(lines(18, y + 26, [{ s: 'Both pilots co-located, within', o: { weight: 'bold' } }, { s: 'speaking distance: direct verbal', o: { weight: 'bold' } }, { s: 'calls only (no radio / earpiece).', o: { weight: 'bold' } }, '', { s: 'Cables: Ethernet mast → laptop,', o: { fill: P.muted } }, { s: 'USB radio → laptop, USB-C screen.', o: { fill: P.muted } }, { s: 'Distances and positions: per site.', o: { fill: P.muted } }], { maxw: 364 }));
  y += 26 + 7 * 18;
  return { h: y + 14, heading: 'D10 · GROUND STATION', sub: 'Mast, laptop, screens, controller, crew',
    title: 'D10 — Ground station layout: mast with HM30, GCS laptop and second screen, controller, crew positions, cables',
    desc: 'HM30 ground unit on the mast with a 6S 3000 mAh pack, Ethernet to the Windows GCS laptop (static IP). Screen A: Mission Planner (MAVLink UDPCI, never closed in flight). Screen B over USB-C: client video (viewer on UDP 5601 or the MP HUD on 5602) and the GCS app status bar; which screen shows what is agreed by the crew. '
      + 'The laptop runs on mains where possible and never sleeps or hibernates (lid action: do nothing); the app warns when on battery or battery saver. Carrier Pilot: Mission Planner as primary control, the 915 Nomad only as close-range backup. '
      + 'FPV Pilot: the EdgeTX radio on USB as a joystick with its RF modules off, flies the client through the app and watches video and alarms. Both pilots are co-located within speaking distance, direct verbal calls only. Positions and distances are per site.',
    source: 'Sources: plan §9.3 D10, §3.1, §4 S-02a, §6.1.6; manual Overview crew table, Crew Training; data/content.js checklist C (gs-mast, gs-mp-connect second screen via USB-C, gs-laptop-sleep).', body: b };
};

// ── D11 CARRIER WIRING HARNESS ── plan §9.3 D11, §3.4 item 4, §6.1.4 connectors; relay design "Connectors", "CVBS input".
D['d11-wiring-harness'] = () => {
  const b = [];
  let y = 72;
  b.push(box(18, y, 364, 50, { title: 'Carrier battery 6S 7000 mAh', lines: ['one pack powers every carrier system'], stroke: P.green, lh: 18 }));
  y += 50;
  b.push(t(18, y + 26, 'POWER', { weight: 'bold', fill: P.green }));
  const bus = 34;
  b.push(line([[bus, y], [bus, y + 300]], { c: P.green, w: 3, end: false }));
  const taps = [
    ['FC + ESCs', 'M1 / M2 tilt, M4 tail', P.text],
    ['HM30 air unit', 'supply: per HM30 manual (TBD)', P.text],
    ['Relay PCB · XT30', 'VIN 6–26 V (full 6S 25.2 V)', P.accent],
    ['IP camera', 'supply: TBD', P.amber],
    ['VRX', 'supply: TBD', P.red]
  ];
  taps.forEach((tp, i) => {
    const yy = y + 40 + i * 54;
    b.push(line([[bus, yy + 22], [58, yy + 22]], { c: P.green }));
    b.push(box(60, yy, 322, 46, { align: 'left', top: 19, stroke: tp[2], lines: [{ s: tp[0], o: { weight: 'bold' } }, { s: tp[1], o: { fill: /TBD/.test(tp[1]) ? P.amber : P.muted } }], lh: 18 }));
  });
  y += 40 + taps.length * 54 + 16;
  b.push(t(18, y, 'SIGNAL RUNS', { weight: 'bold', fill: P.muted }));
  y += 12;
  const runs = [
    { c: P.text, h: 'HM30 air ↔ relay P1', l: ['Ethernet, HM30 connector', '(pinout per HM30 manual)'] },
    { c: P.amber, h: 'IP camera ↔ relay P3', l: ['JST-GH 4-pin TX+ TX− RX+ RX−:', 're-terminate the camera cable,', 'keep the pairs twisted'] },
    { c: P.muted, h: 'Spare ↔ relay P4', l: ['JST-GH 4-pin TX+ TX− RX+ RX−'] },
    { c: P.accent, h: 'Relay CRSF → ELRS TX module', l: ['JST-GH 4-pin VBAT_TX, GND, CRSF,', 'spare. Nomad: VBAT_TX inside', '6–16.8 V; > 250 mW needs XT30', 'supply (2S–4S). Peak A: TBD'] },
    { c: P.red, h: 'VRX → relay CVBS in', l: ['SMA or JST-GH 2-pin. Never', 'goggles in parallel on one VRX', 'output (input is terminated)'] },
    { c: P.green, h: 'HM30 air ↔ FC', l: ['MAVLink (carrier control,', 'not through the relay)'] },
    { c: P.muted, h: 'ELRS RX 915 → FC · GPS → FC', l: ['carrier backup RC, navigation'] }
  ];
  runs.forEach(rn => {
    const h = 12 + (rn.l.length + 1) * 18;
    b.push(box(18, y, 364, h, { align: 'left', top: 20, stroke: rn.c, lines: [{ s: rn.h, o: { weight: 'bold', fill: rn.c } }].concat(rn.l.map(s => ({ s, o: { fill: /TBD/.test(s) ? P.amber : P.text } }))), lh: 18 }));
    y += h + 8;
  });
  b.push(t(18, y + 14, 'Lock every JST-GH; check leads at', { fill: P.muted, maxw: 364 }));
  b.push(t(18, y + 32, 'each maintenance interval.', { fill: P.muted, maxw: 364 }));
  return { h: y + 48, heading: 'D11 · CARRIER WIRING HARNESS', sub: 'Power taps and signal runs',
    title: 'D11 — Carrier wiring harness: battery to FC/ESC, XT30 to the relay PCB, Ethernet runs, CRSF lead, CVBS lead',
    desc: 'The 6S 7000 mAh carrier battery powers every system: FC and ESCs (M1, M2 tilt, M4 tail), the HM30 air unit (supply per HM30 manual, TBD), the relay PCB through its XT30 (VIN 6–26 V), the IP camera (supply TBD) and the VRX (supply TBD). '
      + 'Signal runs: HM30 air unit Ethernet to relay P1; IP camera to P3 on JST-GH 4-pin TX+ TX− RX+ RX− (re-terminated, pairs twisted); spare P4 on JST-GH 4-pin; relay CRSF JST-GH 4-pin (VBAT_TX, GND, CRSF, spare) to the ELRS TX module — for the Nomad VBAT_TX must be within 6–16.8 V and above 250 mW it needs the XT30 supply (2S–4S), peak current TBD; '
      + 'VRX to the relay CVBS input on SMA or JST-GH 2-pin, never with goggles in parallel; HM30 air unit to the FC for MAVLink (not through the relay); ELRS RX 915 and GPS to the FC.',
    source: 'Sources: plan §9.3 D11, §3.4 item 4, §6.1.4 (connectors, power); relay design "Connectors", "CVBS input", "Ethernet"; manual Aircraft battery table, Relay tab connectors.', body: b };
};

// ── D12 TROUBLESHOOTING TREES ── plan §6.1.8 (client RC loss and video loss clean-up), §9.3 D12; data/content.js emergencies; app alarms.
function tree(b, y, title, color, steps) {
  b.push(t(18, y, title, { weight: 'bold', fill: color, size: 16 }));
  y += 14;
  steps.forEach((s, i) => {
    const qh = 18 + s.q.length * 19;
    b.push(box(18, y, 364, qh, { align: 'left', top: 21, stroke: color, sw: 1.5, lines: s.q.map((x, k) => ({ s: x, o: { weight: k ? undefined : 'bold' } })), lh: 19 }));
    y += qh;
    b.push(line([[40, y], [40, y + 18], [56, y + 18]], { c: P.red }));
    b.push(t(46, y + 14, '', {}));
    const rh = 18 + s.no.length * 19;
    b.push(box(58, y + 4, 324, rh, { align: 'left', top: 21, stroke: P.red, dash: '5,3', lines: s.no.map((x, k) => ({ s: (k ? '' : s.nl + ' → ') + x, o: { fill: k ? P.text : P.red, weight: k ? undefined : 'bold' } })), lh: 19 }));
    y += 4 + rh;
    if (i < steps.length - 1) {
      b.push(line([[200, y + 2], [200, y + 26]], { c: P.green }));
      b.push(t(208, y + 20, s.yl || 'YES', { fill: P.green, weight: 'bold' }));
      y += 28;
    }
  });
  return y;
}
D['d12-troubleshooting'] = () => {
  const b = [];
  let y = 84;
  y = tree(b, y, 'NO CLIENT RC', P.accent, [
    { q: ['App sending? (status bar: stream', 'on; no APP DOWN alarm)'], nl: 'NO', no: ['app or controller', 'RC STREAM STOPPED / CONTROLLER', 'DISCONNECTED / RC SENDER DEAD.', 'Client airborne: RESUME only.'] },
    { q: ['Bridge status / RTT shown?'], nl: 'NO', no: ['HM30 link (NO BRIDGE STATUS)', 'MP telemetry gone too → SIYI /', 'GCS LOSS card.'] },
    { q: ['Bridge state RUN?'], nl: 'NO', no: ['bridge FAILSAFE / WAIT_GCS', 'watchdog or T_hold (250 ms) —', 'BRIDGE FAILSAFE; relay PCB card.'] },
    { q: ['Client LQ good (≥ 70 %)?'], nl: 'NO', no: ['ELRS RF: range, band, orbit', 'geometry — FPV LINK WEAK.', 'No telemetry: FPV TELEMETRY LOST', '→ watch video / OSD.'], yl: '' }
  ]);
  y += 48;
  y = tree(b, y, 'NO CLIENT VIDEO', P.red, [
    { q: ['Picture clean (no snow / noise)?'], nl: 'NO', no: ['analog RF — VIDEO SNOW', 'VTX band / channel per profile?', 'VRX patches inward? Reduce range', 'or move the orbit.'] },
    { q: ['Decoder locked? (N6 LED PG10;', 'app, if the bridge reports it)'], nl: 'NO', no: ['CVBS lead, VRX, VTX power;', 'then the video board (N6).', 'RC is not affected.'] },
    { q: ['RTT / MP telemetry OK?'], nl: 'NO', no: ['HM30 link — SIYI / GCS LOSS', 'card if MP is lost too.'] },
    { q: ['Viewer running on the right port?'], nl: 'NO', no: ['restart viewer (UDP 5601) or MP', 'HUD source (UDP 5602); MP must', 'not listen on 5600.'] }
  ]);
  y += 30;
  b.push(lines(18, y, [{ s: 'Still lost after the card\'s wait →', o: { fill: P.amber } }, { s: 'client returns home. Bridge LED', o: { fill: P.amber } }, { s: 'patterns: TBD (firmware).', o: { fill: P.amber } }], { maxw: 364 }));
  return { h: y + 64, heading: 'D12 · TROUBLESHOOTING TREES', sub: 'From the GCS app status and the LEDs',
    title: 'D12 — Troubleshooting trees: "No client RC" and "No client video", using the GCS app status and the relay LEDs',
    desc: 'No client RC: 1. Is the app sending (stream on, no APP DOWN alarm)? No → app or controller (RC STREAM STOPPED, CONTROLLER DISCONNECTED, RC SENDER DEAD); client airborne: RESUME only. 2. Bridge status and RTT shown? No → HM30 link (NO BRIDGE STATUS); if MP telemetry is lost too, use the SIYI / GCS loss card. '
      + '3. Bridge state RUN? No → bridge FAILSAFE or WAIT_GCS: watchdog or T_hold (250 ms), relay PCB card. 4. Client LQ good (at least 70 %)? No → ELRS RF: range, band, orbit geometry (FPV LINK WEAK); no telemetry → FPV TELEMETRY LOST, watch video and OSD. '
      + 'No client video: 1. Picture without snow? No → analog RF (VIDEO SNOW): VTX band and channel, VRX patches inward, reduce range or move the orbit. 2. Decoder locked (N6 LED PG10, or the app if the bridge reports it)? No → CVBS lead, VRX, VTX power, then the video board; RC is not affected. '
      + '3. RTT and MP telemetry OK? No → HM30 link. 4. Viewer on the right port? No → restart the viewer (UDP 5601) or the MP HUD source (UDP 5602); Mission Planner must not listen on 5600. Bridge LED patterns TBD.',
    source: 'Sources: plan §6.1.8 (client RC loss diagnosis, video loss a/b), §9.3 D12, §7.5; data/content.js emergencies emerg-client-rc, emerg-video, emerg-relay-pcb; manual Pre-Arm alarm table; relay design LEDs.', body: b };
};

// ── D13 COVERAGE INTERSECTION ── plan §8.1, §8.2 item 8, §6.1.9 (Mission Planning), §9.3 D13.
D['d13-coverage-intersection'] = () => {
  const b = [];
  let y = 70;
  b.push(t(18, y + 6, 'ONE CARRIER POSITION', { weight: 'bold', fill: P.muted }));
  const cx = 200, cy = y + 150;
  b.push('<ellipse cx="' + (cx - 30) + '" cy="' + cy + '" rx="140" ry="105" fill="' + P.red + '" fill-opacity="0.10" stroke="' + P.red + '" stroke-width="2"/>');
  b.push('<ellipse cx="' + (cx + 40) + '" cy="' + (cy + 10) + '" rx="130" ry="95" fill="' + P.accent + '" fill-opacity="0.10" stroke="' + P.accent + '" stroke-width="2" stroke-dasharray="7,4"/>');
  b.push('<clipPath id="cv"><ellipse cx="' + (cx - 30) + '" cy="' + cy + '" rx="140" ry="105"/></clipPath>');
  b.push('<ellipse cx="' + (cx + 40) + '" cy="' + (cy + 10) + '" rx="130" ry="95" fill="' + P.green + '" fill-opacity="0.35" clip-path="url(#cv)"/>');
  b.push(t(cx + 5, cy - 4, 'OPERATING', { anchor: 'middle', weight: 'bold' }));
  b.push(t(cx + 5, cy + 14, 'AREA', { anchor: 'middle', weight: 'bold' }));
  b.push(t(cx - 150, cy - 70, 'video', { fill: P.red, weight: 'bold' }));
  b.push(t(cx + 156, cy - 66, 'RC', { fill: P.accent, weight: 'bold', anchor: 'end' }));
  b.push('<polygon points="' + cx + ',' + (cy + 52) + ' ' + (cx - 7) + ',' + (cy + 66) + ' ' + (cx + 7) + ',' + (cy + 66) + '" fill="' + P.text + '"/>');
  b.push(t(cx + 12, cy + 64, 'carrier', { fill: P.text }));
  y = cy + 128;
  b.push(lines(18, y, [{ s: 'video polygon ∩ RC polygon', o: { weight: 'bold' } }, 'Each from its own band, power and', 'antennas (client + link profiles).', 'Fly the client only inside both.'], { maxw: 364 }));
  y += 4 * 18 + 26;
  b.push(t(18, y, 'ORBIT SWEEP (one full orbit)', { weight: 'bold', fill: P.muted, maxw: 364 }));
  const ox = 200, oy = y + 140;
  b.push('<circle cx="' + ox + '" cy="' + oy + '" r="120" fill="' + P.green + '" fill-opacity="0.08" stroke="' + P.green + '" stroke-dasharray="6,5"/>');
  b.push('<circle cx="' + ox + '" cy="' + oy + '" r="62" fill="' + P.green + '" fill-opacity="0.35" stroke="' + P.green + '" stroke-width="2"/>');
  b.push('<circle cx="' + ox + '" cy="' + oy + '" r="90" fill="none" stroke="' + P.text + '" stroke-width="1.5" stroke-dasharray="3,4"/>');
  b.push('<polygon points="' + (ox + 90) + ',' + (oy - 8) + ' ' + (ox + 82) + ',' + (oy + 6) + ' ' + (ox + 98) + ',' + (oy + 6) + '" fill="' + P.text + '"/>');
  b.push(t(ox, oy - 4, 'ALWAYS', { anchor: 'middle', weight: 'bold' }));
  b.push(t(ox, oy + 14, 'COVERED', { anchor: 'middle', weight: 'bold' }));
  b.push(t(ox, oy - 98, 'carrier orbit', { anchor: 'middle', fill: P.muted }));
  b.push(t(ox, oy + 116, 'best case (union)', { anchor: 'middle', fill: P.green }));
  y = oy + 150;
  b.push(lines(18, y, [{ s: 'Inner zone = worst case: covered at', o: { weight: 'bold', fill: P.green } }, { s: 'every point of the orbit.', o: { weight: 'bold', fill: P.green } }, 'Outer = best case: covered at some', 'point only. Keep the client inside', 'the inner zone and inside the orbit.', { s: 'Shapes illustrative — use the MAP', o: { fill: P.amber } }, { s: 'for each site and client.', o: { fill: P.amber } }], { maxw: 364 }));
  y += 7 * 18;
  return { h: y + 16, heading: 'D13 · COVERAGE INTERSECTION', sub: 'Operating area = video ∩ RC',
    title: 'D13 — Coverage intersection: video polygon ∩ RC polygon = operating area; orbit-sweep inner zone',
    desc: 'For one carrier position the client video coverage and the client RC coverage are separate polygons, each from its own band, power and antennas (client and link profiles); the operating area is their intersection. Over one full orbit the map accumulates the worst case (intersection: covered at every point of the orbit, the always-covered inner zone) and the best case (union: covered at some point only). '
      + 'Keep the client inside the inner zone and inside the orbit. Shapes are illustrative; use the coverage map for each site and client.',
    source: 'Sources: plan §8.1 (three links, intersection), §8.2 item 8 (orbit sweep), §6.1.9 Mission Planning, §9.3 D13; manual Mission Planning "Operating Area — Video ∩ RC".', body: b };
};

// ── D14 CREW SWIM-LANE ── plan §9.3 D14, §6.1.9; manual Crew Training / Procedures; data/content.js callouts.
D['d14-crew-swimlane'] = () => {
  const b = [];
  let y = 70;
  b.push(box(18, y, 177, 34, { title: 'CARRIER PILOT', titleFill: P.green, stroke: P.green }));
  b.push(box(205, y, 177, 34, { title: 'FPV PILOT', titleFill: P.accent, stroke: P.accent }));
  y += 46;
  const phases = [
    { n: '1 · SETUP & PRE-ARM', cp: ['power-up order', 'MP connected', '"MP LIVE"', 'checklist', '"CHECKLIST GO"', '"ARMING"'], fp: ['app normal start', '(arm DISARMED)', 'bridge RUN, video', '"FPV READY"', '"FPV GO"'] },
    { n: '2 · TAKEOFF & TRANSITION', cp: ['QHOVER takeoff', '"TAKING OFF"', 'FBWB transition', '"TRANSITIONING"', 'no airspeed in 3 s', '→ QHOVER', '"TRANSITION FAIL"'], fp: ['monitors MP', '"STABLE"', '"CLEAN TRANSITION"', 'advances WP1→WP2', '"ADVANCING', ' WAYPOINT"', '"CARRIER ON STATION"'] },
    { n: '3 · RELAY OPERATIONS', cp: ['AUTO / GUIDED orbit,', 'client on near side', 'battery: at RTL V', '"CARRIER BATT —', ' RTL SOON"', 'camera request', '"CAMERA ON / OFF"'], fp: ['flies the client', '"FPV AIRBORNE"', '"RELAY SOLID"', 'app alarms →', '"RC LINK DEGRADED"', '"FPV LINK WEAK"', '"BRIDGE FAILSAFE"', '"APP DOWN"', '"VIDEO SNOW" /', '"VIDEO DIGITAL LOST"', '"FPV BATT LOW —', ' RETURNING"'] },
    { n: '4 · RECOVERY', cp: ['"CARRIER RTL"', '"BACK-', ' TRANSITIONING"', '"DESCENDING"', '"LANDED"', '"SAFE"'], fp: ['client home first', '"FPV RETURNING"', '"FPV LANDED"', 'then assists in MP', '"ZONE CLEAR"'] }
  ];
  phases.forEach(ph => {
    b.push(rect(8, y, 384, 26, P.surf2, { stroke: P.dim }));
    b.push(t(16, y + 18, ph.n, { weight: 'bold', maxw: 370 }));
    y += 34;
    const n = Math.max(ph.cp.length, ph.fp.length);
    const col = (arr, x, c) => arr.forEach((s, i) => b.push(t(x, y + 14 + i * 19, s, { fill: s.trim().startsWith('"') || /^ \S/.test(s) && s.endsWith('"') ? c : P.text, weight: s.trim().startsWith('"') || (/^ \S/.test(s) && s.endsWith('"')) ? 'bold' : undefined, maxw: 177 })));
    col(ph.cp, 18, P.green);
    col(ph.fp, 205, P.accent);
    b.push('<line x1="200" y1="' + (y - 4) + '" x2="200" y2="' + (y + n * 19) + '" stroke="' + P.dim + '"/>');
    y += n * 19 + 12;
  });
  b.push(box(18, y, 364, 60, { align: 'left', top: 20, stroke: P.red, sw: 2, lines: [{ s: 'EITHER PILOT: "ABORT ABORT ABORT"', o: { weight: 'bold', fill: P.red } }, 'Carrier Pilot acts at once: QHOVER', 'in VTOL phase, RTL in cruise.'], lh: 18 }));
  y += 72;
  b.push(t(18, y + 6, 'Bold = callout. Full list: Callouts tab.', { fill: P.muted, maxw: 364 }));
  return { h: y + 22, heading: 'D14 · CREW SWIM-LANE', sub: 'Actions and calls per phase',
    title: 'D14 — Crew swim-lane per phase: Carrier Pilot and FPV Pilot actions and callouts',
    desc: 'Setup and pre-arm: Carrier Pilot follows the power-up order, connects Mission Planner ("MP LIVE"), runs the checklist ("CHECKLIST GO", "ARMING"); FPV Pilot does the app normal start with the arm switch DISARMED, checks bridge RUN and video ("FPV READY", "FPV GO"). '
      + 'Takeoff and transition: Carrier Pilot takes off in QHOVER ("TAKING OFF"), transitions in FBWB ("TRANSITIONING"), reverts to QHOVER if airspeed has not built within 3 s ("TRANSITION FAIL"); FPV Pilot monitors MP ("STABLE", "CLEAN TRANSITION"), advances WP1 to WP2 ("ADVANCING WAYPOINT", "CARRIER ON STATION"). '
      + 'Relay operations: Carrier Pilot manages the orbit with the client on the near side, watches the battery ("CARRIER BATT — RTL SOON") and requests the camera ("CAMERA ON / OFF"); FPV Pilot flies the client ("FPV AIRBORNE", "RELAY SOLID") and calls the app alarms ("RC LINK DEGRADED", "FPV LINK WEAK", "BRIDGE FAILSAFE", "APP DOWN", "VIDEO SNOW" or "VIDEO DIGITAL LOST", "FPV BATT LOW — RETURNING"). '
      + 'Recovery: FPV Pilot brings the client home first ("FPV RETURNING", "FPV LANDED") and calls "ZONE CLEAR"; Carrier Pilot: "CARRIER RTL", "BACK-TRANSITIONING", "DESCENDING", "LANDED", "SAFE". Either pilot may call "ABORT ABORT ABORT".',
    source: 'Sources: plan §9.3 D14, §6.1.9; manual Overview crew table, Procedures, Crew Training; data/content.js callouts (phrases verbatim).', body: b };
};

// ── D15 VIDEO FIELD TIMING ── relay design "Latency and link budget" (video path), "Firmware architecture" (N6), test 1; plan §9.3 D15.
D['d15-video-field-timing'] = () => {
  const b = [];
  let y = 72;
  b.push(t(18, y + 6, 'PAL FIELD (288 lines × 64 µs)', { weight: 'bold', maxw: 364 }));
  const x0 = 30, ms = 15.2;              // 1 ms = 15.2 units; 0–23 ms
  const X = v => x0 + v * ms;
  y += 26;
  // time axis
  const ay = y + 150;
  b.push('<line x1="' + x0 + '" y1="' + ay + '" x2="' + X(23) + '" y2="' + ay + '" stroke="' + P.muted + '"/>');
  [0, 5, 10, 15, 20].forEach(v => { b.push('<line x1="' + r(X(v)) + '" y1="' + ay + '" x2="' + r(X(v)) + '" y2="' + (ay + 5) + '" stroke="' + P.muted + '"/>'); b.push(t(X(v), ay + 20, String(v), { anchor: 'middle', fill: P.muted })); });
  b.push(t(X(23), ay + 20, 'ms', { anchor: 'end', fill: P.muted }));
  // rows
  b.push(t(x0, y + 12, 'lines in (slices of 32 lines)', { fill: P.muted, maxw: 360 }));
  const sl = 2.048;
  for (let i = 0; i < 9; i++) {
    b.push(rect(r(X(i * sl)), y + 20, r(sl * ms - 1), 26, P.red, { op: 0.35, stroke: P.red }));
    b.push(t(X(i * sl + sl / 2), y + 38, String(i + 1), { anchor: 'middle' }));
  }
  b.push(t(x0, y + 66, 'encode each slice (≤ 2 ms limit)', { fill: P.muted, maxw: 360 }));
  for (let i = 0; i < 9; i++) b.push(rect(r(X((i + 1) * sl)), y + 74, r(0.5 * ms), 14, P.accent, { op: 0.6 }));
  b.push(t(x0, y + 106, 'RTP packets out (≤ 1400 B)', { fill: P.muted, maxw: 360 }));
  for (let i = 0; i < 9; i++) b.push(rect(r(X((i + 1) * sl + 0.5)), y + 114, r(0.25 * ms), 14, P.green, { op: 0.8 }));
  // last-line marker and ≤3 ms bracket
  const tl = 18.4;
  b.push('<line x1="' + r(X(tl)) + '" y1="' + (y + 16) + '" x2="' + r(X(tl)) + '" y2="' + ay + '" stroke="' + P.text + '" stroke-dasharray="3,3"/>');
  b.push('<line x1="' + r(X(tl + 3)) + '" y1="' + (y + 70) + '" x2="' + r(X(tl + 3)) + '" y2="' + ay + '" stroke="' + P.amber + '" stroke-dasharray="3,3"/>');
  y = ay + 40;
  b.push(lines(18, y, [{ s: 'Dashed white: last active line at', o: {} }, { s: '18.4 ms. Dashed amber: last packet', o: { fill: P.amber } }, { s: '≤ 3 ms later (test 1 pass criterion).', o: { fill: P.amber } }, { s: 'Bar lengths of encode / send are', o: { fill: P.muted } }, { s: 'illustrative (estimates below).', o: { fill: P.muted } }], { maxw: 364 }));
  y += 5 * 18 + 22;
  b.push(t(18, y, 'WHY THE RELAY ADDS ≈ 1 FIELD', { weight: 'bold', fill: P.accent, maxw: 364 }));
  b.push(lines(18, y + 22, ['Each field is one H.264 picture. The', 'top line waits for the whole field', '(18.4 ms PAL, 15.3 ms NTSC); every', 'slice is encoded and sent as soon as', 'it is complete, so only ≈ 3 ms more', 'is added after the last line.', { s: 'Relay electronics ≈ 20 ms in total;', o: { weight: 'bold' } }, { s: 'the HM30 (150–180 ms, estimate) and', o: { fill: P.muted } }, { s: 'the GCS (10–50 ms) dominate.', o: { fill: P.muted } }], { maxw: 364 }));
  y += 22 + 9 * 18 + 16;
  const rows = [['', 'PAL', 'NTSC'], ['size', '704×288', '704×224*'], ['slices', '9 × 32 lines', '7'], ['field rate', '50 Hz', '59.94 Hz'], ['field time', '18.4 ms', '15.3 ms']];
  rows.forEach((rw, i) => {
    b.push(rect(18, y, 364, 24, i ? P.surf2 : P.surf, { stroke: P.border2 }));
    b.push(t(26, y + 17, rw[0], { fill: P.muted }));
    b.push(t(140, y + 17, rw[1], { weight: i ? undefined : 'bold' }));
    b.push(t(272, y + 17, rw[2], { weight: i ? undefined : 'bold' }));
    y += 24;
  });
  b.push(lines(18, y + 20, [{ s: '* cropped, or 704×240 if 16-line', o: { fill: P.muted } }, { s: '  slices work.', o: { fill: P.muted } }, 'Estimates: last slice encoded ≈ 0.5 ms;', '10–30 kB per field at 100 Mbit/s =', '0.8–2.4 ms. Picture starts in the', 'vertical blanking (≈ 1.6 ms).', { s: 'No field for 25 ms → last field is', o: { fill: P.amber } }, { s: 're-sent; decoder lost > 1 s → reset.', o: { fill: P.amber } }], { maxw: 364 }));
  y += 20 + 8 * 18;
  return { h: y + 10, heading: 'D15 · VIDEO FIELD TIMING', sub: 'One field → slices → packets',
    title: 'D15 — Video field timing: one PAL/NTSC field, its slices and packets, and why the relay adds about one field time',
    desc: 'A PAL field arrives over 18.4 ms (288 lines × 64 µs) as 9 slices of 32 lines (NTSC: 7 slices, 15.3 ms). The N6 encodes each slice as soon as it is complete (each slice must finish within 2 ms; the last slice about 0.5 ms, estimate) and sends RTP packets of at most 1400 bytes at once (10–30 kB per field at 100 Mbit/s = 0.8–2.4 ms). '
      + 'The last packet leaves at most 3 ms after the last active line (relay-design test 1). The top line waits for the whole field, so the relay adds about one field time; the relay electronics add about 20 ms in total, while the HM30 (about 150–180 ms, estimate) and the GCS (10–50 ms) dominate. '
      + 'PAL 704×288, 50 Hz; NTSC 704×224 cropped (or 704×240 with 16-line slices), 59.94 Hz. No field for 25 ms → the last field is re-sent; decoder lost for more than 1 s → reset.',
    source: 'Sources: relay design "Latency and link budget" (video path), "Firmware architecture" (N6 steps 3–7), test 1; plan §9.3 D15, §6.1.3 item 10.', body: b };
};
const r = v => Math.round(v * 10) / 10;

module.exports = D;
