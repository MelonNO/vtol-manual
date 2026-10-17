'use strict';
// Diagram definitions for scripts/diagrams/build.js: each entry returns { h, heading, sub, title, desc, source, body } for lib.doc().
const { P, t, lines, box, group, line, pill } = require('./lib.js');
const D = {};

// Vertical stage card: title, detail lines, value line (coloured).
function stage(b, y, o) {
  const items = [{ s: o.title, o: { weight: 'bold', fill: o.tc || P.text } }].concat((o.lines || []).map(s => typeof s === 'string' ? { s, o: {} } : s));
  if (o.value) items.push({ s: o.value, o: { weight: 'bold', fill: o.vc || P.accent } });
  const h = 16 + items.length * 19;
  b.push(box(o.x || 18, y, o.w || 364, h, { align: 'left', top: 20, lines: items, lh: 19, stroke: o.stroke || P.border2 }));
  return y + h;
}

// ── D4 RC PATH TIMELINE ── plan §9.3 draft D4; relay design "Latency and link budget" (RC path), "Firmware architecture".
D['d04-rc-path-timeline'] = () => {
  const b = [];
  let y = 70;
  const gap = (lbl, c) => { b.push(line([[200, y], [200, y + 22]], { c: c || P.accent })); if (lbl) b.push(t(208, y + 16, lbl, { fill: P.muted, maxw: 180 })); y += 24; };
  y = stage(b, y, { title: '1 · USB controller → GCS app', lines: ['EdgeTX radio, HID report'], value: '1–8 ms (estimate)' }); gap();
  y = stage(b, y, { title: '2 · GCS app sends rc_up', lines: ['36 B to UDP 5770, 200–250 Hz,', 'on absolute deadlines'], value: 'every 4–5 ms' }); gap('HM30');
  y = stage(b, y, { title: '3 · HM30 uplink', lines: ['radio link, ground → air'], value: 'unknown — measure (UDP echo)', vc: P.amber, stroke: P.amber }); gap('P1 → P2');
  y = stage(b, y, { title: '4 · Switch, W5500, G0', lines: ['check magic, version, CRC,', 'source IP, seq; store with time'], value: 'under 1 ms (estimate)' }); gap();
  y = stage(b, y, { title: '5 · Wait for the next CRSF slot', lines: ['G0 TIM2 locked to the module\'s', 'timing frame 0x3A (rate, offset)'], value: 'up to 1 CRSF period (4–5 ms)' }); gap('CRSF');
  y = stage(b, y, { title: '6 · CRSF RC frame to the module', lines: ['26 B at 400 kbaud, single wire'], value: 'about 0.65 ms' }); gap('ELRS RF');
  y = stage(b, y, { title: '7 · ELRS air packet → client RX', lines: ['client RX → client FC'], value: '1 ELRS packet interval', stroke: P.accent }); y += 18;
  y = stage(b, y, { title: 'Back to the GCS app', tc: P.green, lines: ['10 Hz status (echoed t_gcs_us →', 'RTT) + forwarded CRSF telemetry'], value: 'status / telemetry downlink', vc: P.green, stroke: P.green }); y += 18;
  b.push(lines(18, y + 6, [{ s: 'End-to-end RC latency: TBD —', o: { fill: P.amber, weight: 'bold' } }, { s: 'measure (latency budget, RF & Comms).', o: { fill: P.amber } }, { s: 'No valid packet for T_hold (start', o: { fill: P.muted } }, { s: '250 ms) → bridge FAILSAFE (D5, D6).', o: { fill: P.muted } }], { maxw: 364 }));
  return { h: y + 84, heading: 'D4 · RC PATH TIMELINE', sub: 'Controller → client, latency per stage',
    title: 'D4 — RC path timeline: controller, GCS app, HM30, bridge, CRSF slot, ELRS, client, with the latency of each stage',
    desc: '1: USB controller to the GCS app, HID report, 1–8 ms (estimate). 2: the app sends a 36-byte rc_up to UDP 5770 every 4–5 ms (200–250 Hz, absolute deadlines). 3: HM30 uplink, unknown, measure with the UDP echo test. '
      + '4: switch P1 to P2, W5500 and G0 check magic, version, CRC, source IP and sequence and store the packet with a time stamp, under 1 ms (estimate). 5: wait for the next CRSF slot, up to one CRSF period (4–5 ms); the G0 locks its TIM2 to the ELRS timing frame 0x3A. '
      + '6: CRSF RC frame, 26 bytes at 400 kbaud, about 0.65 ms. 7: ELRS air packet to the client receiver and FC, one ELRS packet interval. The bridge returns a 10 Hz status (RTT from the echoed t_gcs_us) and forwarded CRSF telemetry. End-to-end latency TBD (measure).',
    source: 'Sources: plan §9.3 draft D4; relay design "Latency and link budget" RC path table, "Firmware architecture" (G0 bridge).', body: b };
};

// ── D5 BRIDGE STATE MACHINE ── plan §9.3 draft D5; relay design G0 state table and watchdog; contract C2 (UNREACHABLE).
D['d05-bridge-states'] = () => {
  const b = [];
  const st = [
    { n: 'BOOT', crsf: 'CRSF: none', c: P.muted },
    { n: 'WAIT_GCS', crsf: 'CRSF: none', c: P.amber },
    { n: 'START', crsf: 'CRSF: ModelID × 3', c: P.accent },
    { n: 'RUN', crsf: 'CRSF: RC frame every tick', c: P.green },
    { n: 'FAILSAFE', crsf: 'CRSF: none (silent)', c: P.red }
  ];
  const tr = ['peripherals and W5500 up', '5 consecutive valid packets', 'ModelID sent × 3', 'no valid packet for T_hold', ''];
  let y = 72;
  const ys = [];
  st.forEach((s, i) => {
    ys.push(y);
    b.push(box(18, y, 300, 70, { align: 'left', top: 22, stroke: s.c, sw: 2, lines: [{ s: s.n, o: { weight: 'bold', fill: s.c, size: 16 } }, { s: s.crsf }, { s: 'LED pattern: TBD (firmware)', o: { fill: P.muted } }], lh: 20 }));
    y += 70;
    if (tr[i]) {
      b.push(line([[110, y], [110, y + 44]], { c: P.text }));
      b.push(t(120, y + 20, tr[i], { maxw: 270 }));
      if (i === 3) b.push(t(120, y + 38, '(start 250 ms)', { fill: P.muted }));
      y += 46;
    }
  });
  // FAILSAFE → WAIT_GCS immediately (loop on the right)
  b.push(line([[318, ys[4] + 35], [360, ys[4] + 35], [360, ys[1] + 35], [320, ys[1] + 35]], { c: P.red }));
  b.push(t(352, ys[2] + 60, 'immediately', { fill: P.red, anchor: 'end', maxw: 120 }));
  y += 22;
  b.push(lines(18, y, [{ s: 'Valid packet: right magic, version,', o: {} }, 'CRC, source IP, increasing seq.', { s: 'Watchdog (IWDG, about 100 ms):', o: { fill: P.muted } }, { s: 'resets the G0 → BOOT if the scheduler', o: { fill: P.muted } }, { s: 'or the W5500 stops.', o: { fill: P.muted } }], { maxw: 364 }));
  y += 108;
  b.push(box(18, y, 364, 84, { align: 'left', top: 20, stroke: P.dim, dash: '5,4', lines: [{ s: 'App-side state: UNREACHABLE', o: { weight: 'bold' } }, 'no bridge status within 300 ms —', 'normal before streaming: the bridge', 'only answers a GCS that streams.'], lh: 18 }));
  y += 84;
  return { h: y + 20, heading: 'D5 · BRIDGE STATE MACHINE', sub: 'G0 RC bridge · LED patterns TBD',
    title: 'D5 — RC bridge (G0) state machine: BOOT, WAIT_GCS, START, RUN, FAILSAFE, with the CRSF output and LED pattern per state',
    desc: 'BOOT (no CRSF) → WAIT_GCS when the peripherals and the W5500 are up. WAIT_GCS (no CRSF) → START after 5 consecutive valid packets. START sends ModelID three times → RUN. RUN sends an RC frame on every scheduler tick → FAILSAFE when no valid packet arrives for T_hold (start value 250 ms). '
      + 'FAILSAFE is silent and returns immediately to WAIT_GCS. A valid packet has the right magic, version, CRC, source IP and an increasing sequence number. The watchdog (about 100 ms) resets the G0 to BOOT if the scheduler or the W5500 stops. '
      + 'LED pattern per state: TBD, to be defined by the bridge firmware. The GCS app shows UNREACHABLE when no bridge status arrives within 300 ms, which is normal before streaming.',
    source: 'Sources: plan §9.3 draft D5, §6.1.4; relay design "Firmware architecture" G0 state table and watchdog; contract C2 bridge.state; manual Pre-Arm bridge table.', body: b };
};

// ── D6 CLIENT FAILSAFE TIMELINE ── plan §6.1.5 (client failsafe chain), §9.3 draft D6; relay design "Bandwidth and failsafe", test 6.
D['d06-client-failsafe'] = () => {
  const b = [];
  let y = 70;
  b.push(box(18, y, 364, 110, { align: 'left', top: 22, stroke: P.red, sw: 2, lines: [{ s: 'CAUSE (t = 0)', o: { weight: 'bold', fill: P.red } }, '• GCS app stops / crashes', '• controller unplugged', '• HM30 link lost', '• bridge watchdog / G0 reset'], lh: 19 }));
  y += 110;
  const steps = [
    { title: 'Bridge goes silent after T_hold', lines: ['no valid rc_up → FAILSAFE,', 'no more CRSF to the module'], value: 'T_hold: start value 250 ms', c: P.accent },
    { title: 'ELRS TX module reacts to the', lines: ['silent handset (stops sending)'], value: 'TBD — measure (test 6)', vc: P.amber, c: P.amber },
    { title: 'Client RX failsafe', lines: ['no packets from the module'], value: 'RX timeout: TBD per client', vc: P.amber, c: P.amber },
    { title: 'Client FC failsafe (per profile)', lines: ['e.g. Betaflight stage 1 → GPS', 'Rescue. Reference client #1:', 'delay 2.5 s (1.5 s + 1 s)'], value: 'profile: failsafe delay', c: P.accent },
    { title: 'Client returns or lands', lines: ['per its failsafe type (GPS Rescue', 'recommended; drop only in', 'cleared areas)'], c: P.green }
  ];
  steps.forEach(s => {
    b.push(line([[200, y], [200, y + 24]], { c: P.text }));
    y += 26;
    y = stage(b, y, { title: s.title, lines: s.lines, value: s.value, vc: s.vc, stroke: s.c });
  });
  y += 24;
  b.push(t(18, y, 'TOTAL TIME TO CLIENT FAILSAFE', { weight: 'bold', fill: P.amber }));
  y += 10;
  const causes = ['GCS app killed', 'controller unplugged', 'HM30 unplugged / lost', 'G0 reset'];
  causes.forEach((c, i) => {
    const yy = y + 8 + i * 30;
    b.push('<rect x="18" y="' + yy + '" width="364" height="26" fill="' + P.surf2 + '" stroke="' + P.border2 + '"/>');
    b.push(t(26, yy + 18, c, { maxw: 200 }));
    b.push(t(374, yy + 18, 'TBD — test 6', { anchor: 'end', fill: P.amber, weight: 'bold' }));
  });
  y += 8 + causes.length * 30 + 22;
  b.push(lines(18, y, [{ s: 'Only T_hold is designed; measure the', o: { fill: P.muted } }, { s: 'total per cause (relay-design test 6).', o: { fill: P.muted } }, { s: 'HM30 loss: the carrier also RTLs', o: {} }, { s: 'after 5 s and the camera is forced off.', o: {} }, { s: 'No default sticks at boot: 5 valid', o: { fill: P.muted } }, { s: 'packets before any CRSF.', o: { fill: P.muted } }], { maxw: 364 }));
  y += 6 * 18;
  return { h: y + 12, heading: 'D6 · CLIENT FAILSAFE TIMELINE', sub: 'GCS stream stops → client failsafe',
    title: 'D6 — Client failsafe timeline through the relay, with the time of each stage and the measured total per cause',
    desc: 'Cause at t = 0: the GCS app stops or crashes, the controller is unplugged, the HM30 link is lost, or the bridge watchdog fires / the G0 resets. The bridge goes silent after T_hold (start value 250 ms): FAILSAFE, no more CRSF. '
      + 'The ELRS TX module reacts to the silent handset (time TBD, measure in relay-design test 6). Client receiver failsafe (timeout TBD per client). Client FC failsafe per profile, e.g. Betaflight stage 1 then GPS Rescue; Reference client #1: delay 2.5 s (1.5 s + 1 s). The client returns or lands per its failsafe type. '
      + 'Total time per cause: TBD (test 6). On HM30 loss the carrier also RTLs after 5 s and the camera is forced off. The bridge sends no CRSF until it has 5 consecutive valid packets.',
    source: 'Sources: plan §6.1.5 client failsafe chain, §9.3 draft D6; relay design "Bandwidth and failsafe", "Boot behaviour", test 6; data/content.js clientFailsafeChain; client profile default (C1.3) and BF dump failsafe_delay.', body: b };
};

// ── D7 CARRIER FAILSAFE MATRIX + SIYI-LOSS TIMELINE ── plan §4, §6.1.5 (QLand correction, brief R11b), §9.2 row 1.
D['d07-carrier-failsafe'] = () => {
  const b = [];
  let y = 70;
  const card = (o) => {
    const items = [{ s: o.event, o: { weight: 'bold', fill: o.c, size: 15 } }]
      .concat(o.detect.map((s, i) => ({ s: (i ? '         ' : 'Detect:  ') + s, o: {} })))
      .concat(o.act.map((s, i) => ({ s: (i ? '         ' : 'Carrier: ') + s, o: { fill: /TBD|VERIFY/.test(s) ? P.amber : (o.ac || P.text), weight: i ? undefined : 'bold' } })))
      .concat(o.pilot.map((s, i) => ({ s: (i ? '         ' : 'Pilot:   ') + s, o: { fill: P.muted } })));
    const h = 14 + items.length * 19;
    b.push(box(18, y, 364, h, { align: 'left', top: 21, lines: items, lh: 19, stroke: o.c, sw: o.primary ? 2.5 : 1 }));
    y += h + 10;
  };
  card({ primary: true, c: P.red, event: 'SIYI / MP LINK LOST — PRIMARY', detect: ['no GCS heartbeat 5 s', '(FS_LONG_TIMEOUT), all modes', '(FS_GCS_ENABL = 2)'], act: ['RTL (FS_LONG_ACTN = 1)', 'Q-mode RTL: TBD (SITL)'], ac: P.red, pilot: ['monitor; Nomad only', 'if close range'] });
  card({ c: P.muted, event: '915 MHz BACKUP LOST', detect: ['ELRS RX failsafe'], act: ['NONE — RC ignored', '(THR_FAILSAFE = 2)'], pilot: ['none beyond close range;', 'close-in: take over in MP', '(QLOITER / QLAND)'] });
  card({ c: P.red, event: 'BATTERY CRITICAL 22.2 V', detect: ['BATT_CRT_VOLT'], act: ['Loiter → QLand at the', 'current position'], pilot: ['clear the area below'] });
  card({ c: P.amber, event: 'BATTERY LOW', detect: ['BATT_LOW_VOLT = 0 (not set)'], act: ['none'], pilot: ['manual RTL at 23.0 V;', 'RTL active before 22.5 V'] });
  card({ c: P.amber, event: 'TRANSITION FAIL', detect: ['Q_TRANS_FAIL 4 s'], act: ['QLand at the current', 'position (Q_TRANS_FAIL_ACT', '= 0) — VERIFY firmware'], ac: P.amber, pilot: ['no airspeed in 3 s →', 'QHOVER before 4 s'] });
  y += 8;
  b.push(t(18, y + 6, 'SIYI-LOSS TIMELINE', { weight: 'bold', fill: P.red }));
  y += 20;
  const tl = [
    ['0 s', 'GCS heartbeat lost (MP closed,', 'laptop asleep, cable, HM30).', 'Client RC + video lost too →', 'client fails safe; camera off.'],
    ['5 s', 'RTL in any mode', '(FS_LONG_ACTN = 1).'],
    ['→', 'climb to RTL_ALTITUDE 120 m', 'REL (above home), return.'],
    ['→', 'back-transition and land per', 'the Q settings — Q-mode RTL', 'behaviour: TBD (param file +', 'SITL test, S-02).']
  ];
  tl.forEach((row, i) => {
    const h = row.length * 19 + 6;
    b.push('<circle cx="40" cy="' + (y + 14) + '" r="6" fill="' + (i === 1 ? P.red : P.surf2) + '" stroke="' + P.red + '" stroke-width="2"/>');
    if (i < tl.length - 1) b.push('<line x1="40" y1="' + (y + 20) + '" x2="40" y2="' + (y + h + 8) + '" stroke="' + P.red + '" stroke-width="2"/>');
    b.push(t(56, y + 19, row[0], { weight: 'bold', fill: P.red }));
    b.push(lines(104, y + 19, row.slice(1).map((s, k) => ({ s, o: { fill: i === 3 && k > 0 ? P.amber : P.text } })), { maxw: 278, lh: 19 }));
    y += h + 8;
  });
  b.push(t(18, y + 14, 'Values: param file + default settings.', { fill: P.muted, maxw: 364 }));
  return { h: y + 30, heading: 'D7 · CARRIER FAILSAFE', sub: 'Fails safe ONLY on SIYI / GCS loss',
    title: 'D7 — Carrier failsafe matrix and SIYI-loss timeline (replaces the old RC failsafe cascade)',
    desc: 'SIYI / Mission Planner link lost (primary): no GCS heartbeat for FS_LONG_TIMEOUT = 5 s in all modes (FS_GCS_ENABL = 2) → RTL (FS_LONG_ACTN = 1); Q-mode RTL behaviour TBD (SITL); pilot monitors, Nomad only within close range. '
      + '915 MHz backup lost: ELRS RX failsafe → no action, RC ignored (THR_FAILSAFE = 2); beyond close range no pilot action, close-in take over in Mission Planner (QLOITER / QLAND). Battery critical 22.2 V (BATT_CRT_VOLT) → Loiter then QLand at the current position; clear the area below. '
      + 'Battery low: BATT_LOW_VOLT = 0, not set, no action; manual RTL at 23.0 V, RTL active before the 22.5 V hard limit. Transition fail: Q_TRANS_FAIL 4 s → Q_TRANS_FAIL_ACT = 0 → QLand at the current position (VERIFY against the firmware); the pilot switches to QHOVER if airspeed has not built within 3 s. '
      + 'SIYI-loss timeline: 0 s heartbeat lost (client RC and video lost too, client fails safe, camera forced off); 5 s RTL in any mode; climb to RTL_ALTITUDE 120 m REL and return; back-transition and land per the Q settings (Q-mode behaviour TBD).',
    source: 'Sources: plan §4 (design intent, S-01, S-02, S-03), §6.1.5 failsafe table, §9.2 row 1, §13.1; brief R11b (Q_TRANS_FAIL_ACT 0 = QLand, VERIFY); data/content.js failsafeTable; manual Flight Modes.', body: b };
};

// ── D8 BANDWIDTH BUDGET ── plan §6.1.4 bandwidth budget, §3.4; relay design "Bandwidth and failsafe", test 9.
D['d08-bandwidth-budget'] = () => {
  const b = [];
  let y = 80;
  b.push(lines(18, y, [{ s: 'NOT TO SCALE — values TBD until the', o: { fill: P.amber, weight: 'bold' } }, { s: 'HM30 capacity is measured (Q13).', o: { fill: P.amber } }], { maxw: 364 }));
  b.push('<line x1="18" y1="' + (y + 34) + '" x2="50" y2="' + (y + 34) + '" stroke="' + P.text + '" stroke-width="2" stroke-dasharray="3,3"/>');
  b.push(t(58, y + 39, '= HM30 capacity (TBD)', { maxw: 320 }));
  y += 70;
  const bar = (label, segs, note) => {
    b.push(t(18, y, label, { weight: 'bold' }));
    y += 12;
    let x = 18;
    segs.forEach(s => {
      b.push('<rect x="' + x + '" y="' + y + '" width="' + s.w + '" height="40" fill="' + s.c + '" fill-opacity="' + (s.op || 0.35) + '" stroke="' + s.c + '"' + (s.dash ? ' stroke-dasharray="4,3"' : '') + '/>');
      if (s.l) b.push(t(x + s.w / 2, y + 25, s.l, { anchor: 'middle', maxw: s.w - 4, fill: s.tc || P.text }));
      x += s.w;
    });
    b.push('<line x1="382" y1="' + (y - 8) + '" x2="382" y2="' + (y + 48) + '" stroke="' + P.text + '" stroke-width="2" stroke-dasharray="3,3"/>');
    y += 52;
    b.push(lines(18, y, note, { maxw: 364 }));
    y += note.length * 19 + 18;
  };
  bar('FPV MODE — camera off', [
    { w: 190, c: P.red, l: 'N6 video' }, { w: 26, c: P.accent, l: 'RC' }, { w: 44, c: P.green, l: 'MAV' }, { w: 104, c: P.muted, l: 'margin', op: 0.12, dash: true }
  ], [{ s: 'N6 CBR: TBD (below HM30 capacity)', o: { fill: P.red } }, { s: 'RC uplink ≈ 100–130 kbit/s', o: { fill: P.accent } }, { s: 'MAVLink: TBD · margin: TBD', o: { fill: P.green } }, { s: 'camera: OFF (P3 disabled / minimum)', o: { fill: P.amber } }]);
  bar('CAMERA MODE — camera on at its cap', [
    { w: 150, c: P.red, l: 'N6 video' }, { w: 96, c: P.amber, l: 'camera' }, { w: 26, c: P.accent, l: 'RC' }, { w: 44, c: P.green, l: 'MAV' }, { w: 48, c: P.muted, l: '', op: 0.12, dash: true }
  ], [{ s: 'camera: P3 ingress cap TBD (Q13)', o: { fill: P.amber } }, { s: 'everything ≤ HM30 capacity (TBD)', o: {} }]);
  y += 6;
  b.push(lines(18, y, [{ s: 'The HM30 radio is the bottleneck,', o: { weight: 'bold' } }, 'not the 100 Mbit cable: switch', 'priorities only order packets on', 'the cable (RC → video → camera).', '', { s: 'Until measured: camera OFF while the', o: { fill: P.amber } }, { s: 'client is armed. Test 9 must show', o: { fill: P.amber } }, { s: 'FPV latency unchanged with the', o: { fill: P.amber } }, { s: 'camera at its cap — if it fails:', o: { fill: P.amber } }, { s: 'camera off whenever the client is', o: { fill: P.amber } }, { s: 'airborne.', o: { fill: P.amber } }], { maxw: 364, lh: 19 }));
  y += 11 * 19;
  return { h: y + 12, heading: 'D8 · BANDWIDTH BUDGET', sub: 'HM30 capacity split · FPV vs camera mode',
    title: 'D8 — Bandwidth budget: HM30 capacity split in FPV mode (camera off) and camera mode (camera at its P3 cap)',
    desc: 'Not to scale; all values TBD until the HM30 capacity is measured (open question Q13). FPV mode: N6 client video at a constant bitrate below the HM30 capacity (TBD), RC uplink about 100–130 kbit/s, MAVLink TBD, margin TBD, camera off (P3 disabled or at minimum). '
      + 'Camera mode: the same plus the IP camera at its P3 ingress cap (TBD); the total must stay below the HM30 capacity. The HM30 radio, not the 100 Mbit cable, is the bottleneck: switch priorities (RC, then video, then camera) only order packets on the cable. '
      + 'Until measured the camera is off while the client is armed; relay-design test 9 must show unchanged FPV latency with the camera at its cap, otherwise the rule becomes camera off whenever the client is airborne.',
    source: 'Sources: plan §6.1.4 bandwidth budget, §3.4 item 1; relay design "Bandwidth and failsafe" (RC 64 B × 200–250 Hz), "Camera on/off", test 9; manual RF & Comms bandwidth table.', body: b };
};

// ── D8b CAMERA ON/OFF LOGIC ── plan §3.4 items 1 and 3; relay design "Camera on/off"; contract C3 flags; app behaviour (manual Relay tab).
D['d08b-camera-logic'] = () => {
  const b = [];
  let y = 70;
  y = stage(b, y, { title: 'GCS app: camera request', lines: ['key k toggles; default OFF;', 'refuses ON while the client is', '(or may be) armed — app default'], stroke: P.amber });
  b.push(line([[200, y], [200, y + 24]], { c: P.amber })); y += 26;
  y = stage(b, y, { title: 'rc_up flags bit 0 = CAM_ENABLE', lines: ['in every packet, UDP 5770'], stroke: P.amber });
  b.push(line([[200, y], [200, y + 24]], { c: P.amber })); y += 26;
  y = stage(b, y, { title: 'G0 bridge', lines: ['applies a change within one', 'packet, via SPI to the switch'], stroke: P.amber });
  b.push(line([[200, y], [200, y + 24]], { c: P.amber })); y += 26;
  y = stage(b, y, { title: 'Switch port P3', lines: [{ s: 'ON: P3 enabled, capped by the', o: { fill: P.green } }, { s: '    ingress limit (TBD, Q13)', o: { fill: P.green } }, { s: 'OFF: P3 receive disabled or', o: { fill: P.red } }, { s: '    limit at minimum', o: { fill: P.red } }, 'camera stays powered → resumes', 'at once, no reboot'], stroke: P.amber });
  b.push(line([[200, y], [200, y + 24]], { c: P.green })); y += 26;
  y = stage(b, y, { title: 'G0 reads the registers back', lines: ['status packet (10 Hz), flags bit 0', '= camera read-back (actual state)'], stroke: P.green });
  b.push(line([[200, y], [200, y + 24]], { c: P.green })); y += 26;
  y = stage(b, y, { title: 'App shows requested vs reported', lines: ['differ > 1 s → CAMERA STATE', 'MISMATCH (warn)'], stroke: P.green });
  y += 20;
  b.push(t(18, y, 'RULES (current relay design)', { weight: 'bold' }));
  b.push(lines(18, y + 22, ['• power-up: OFF (default)', { s: '• GCS stream lost: forced OFF —', o: { fill: P.red } }, { s: '  re-enable once the stream is back', o: { fill: P.red } }, '• test 9: camera traffic on P1 stops', '  within one RC packet of OFF'], { maxw: 364, lh: 19 }));
  y += 22 + 5 * 19 + 14;
  const rows = [['no GCS stream since boot', 'ON (cap)'], ['RC stream running', 'CAM_ENABLE'], ['stream lost after running', 'OFF'], ['new stream after loss', 'CAM_ENABLE']];
  const h = 52 + rows.length * 28;
  b.push(box(18, y, 364, h, { align: 'left', top: 20, stroke: P.amber, dash: '6,4', lines: [{ s: 'FIRMWARE REQUEST — not implemented', o: { weight: 'bold', fill: P.amber } }, { s: 'client-gated variant (owner Q12):', o: { fill: P.muted } }], lh: 19 }));
  rows.forEach((r, i) => {
    const yy = y + 50 + i * 28;
    b.push(t(28, yy + 16, r[0], { maxw: 230 }));
    b.push(t(372, yy + 16, r[1], { anchor: 'end', weight: 'bold', fill: r[1] === 'OFF' ? P.red : r[1].startsWith('ON') ? P.green : P.amber }));
  });
  y += h;
  return { h: y + 20, heading: 'D8b · CAMERA ON/OFF LOGIC', sub: 'CAM_ENABLE → G0 → switch port P3',
    title: 'D8b — Camera on/off logic: CAM_ENABLE from the GCS app through the G0 bridge to switch port P3, with read-back',
    desc: 'The GCS app holds the camera request (key k, default OFF; with its default setting it refuses ON while the client is or may be armed). The request travels as bit 0 (CAM_ENABLE) of the rc_up flags in every packet to UDP 5770. The G0 applies a change within one packet over SPI to the switch. '
      + 'P3 ON: enabled and capped by its ingress rate limit (value TBD, Q13); OFF: receive disabled or limit at minimum. The camera stays powered and resumes at once. The G0 reads the switch registers back and reports the actual state in the 10 Hz status packet (flags bit 0); the app shows requested versus reported and raises CAMERA STATE MISMATCH after more than 1 s. '
      + 'Rules: OFF at power-up; forced OFF when the GCS stream is lost, re-enable once the stream is back; test 9: camera traffic on P1 stops within one RC packet. Firmware request, not implemented (owner decision Q12): no stream since boot → ON at its cap; stream running → follows CAM_ENABLE; stream lost after running → OFF; new stream → follows CAM_ENABLE.',
    source: 'Sources: plan §3.4 items 1 and 3 (firmware request), §6.1.4; relay design "Camera on/off (from the GCS)", test 9; contract C3 rc_up / status flags; manual Relay tab (app behaviour).', body: b };
};

module.exports = D;
