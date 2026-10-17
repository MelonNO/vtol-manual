'use strict';
// Diagram definitions for scripts/diagrams/build.js: each entry returns { h, heading, sub, title, desc, source, body } for lib.doc().
const { P, t, lines, box, group, line, pill } = require('./lib.js');
const D = {};

// ── D1 SYSTEM OVERVIEW ── plan §3.1 (Mermaid draft), §3.2 links table; relay design "System overview".
D['d01-system-overview'] = () => {
  const b = [];
  // Ground station
  b.push(group(8, 62, 384, 196, 'GROUND STATION — WINDOWS LAPTOP'));
  b.push(box(18, 92, 168, 66, { title: 'EdgeTX radio', lines: ['USB joystick', 'RF modules OFF'] }));
  b.push(box(214, 92, 168, 66, { title: 'GCS app', lines: ['RC sender + status', 'rc_up · UDP 5770'], stroke: P.accent }));
  b.push(line([[186, 125], [212, 125]], { c: P.dim }));
  b.push(box(18, 174, 168, 72, { title: 'Mission Planner', lines: ['MAVLink UDPCI', '.12 : 19856'], stroke: P.green }));
  b.push(box(214, 174, 168, 72, { title: 'Video viewer', lines: ['UDP 5601 viewer', 'UDP 5602 MP HUD'], stroke: P.red }));
  // Mast / backup
  b.push(line([[102, 258], [102, 286]], { c: P.dim, end: false }));
  b.push(t(110, 278, 'Ethernet', { fill: P.muted }));
  b.push(box(18, 288, 168, 52, { title: 'HM30 ground unit', lines: ['on the mast'] }));
  b.push(box(250, 288, 132, 52, { title: 'Nomad 915', lines: ['backup TX'], stroke: P.muted }));
  // Links
  b.push(line([[102, 340], [102, 448]], { c: P.text, w: 4, start: true }));
  b.push(lines(112, 366, [{ s: 'HM30 IP LINK', o: { weight: 'bold' } }, 'MAVLink · RC UDP', 'client video RTP', 'camera stream', { s: 'HM30 band: TBD', o: { fill: P.muted } }], { maxw: 196 }));
  b.push(line([[316, 340], [316, 448]], { c: P.muted, dash: '6,5' }));
  b.push(lines(324, 370, [{ s: 'ELRS', o: { weight: 'bold', fill: P.muted } }, { s: '915 MHz', o: { fill: P.muted } }, { s: 'close', o: { fill: P.muted } }, { s: 'range', o: { fill: P.muted } }], { maxw: 70 }));
  // Carrier
  b.push(group(8, 450, 384, 450, 'CARRIER — HEEWING T2 CRUZA'));
  b.push(box(18, 476, 168, 50, { title: 'HM30 air unit', lines: ['192.168.144.11'] }));
  b.push(box(234, 476, 148, 50, { title: 'ELRS RX 915', lines: ['backup RC'], stroke: P.muted }));
  b.push(box(234, 556, 148, 50, { title: 'ArduPlane FC', lines: ['QuadPlane'], stroke: P.green }));
  b.push(line([[308, 526], [308, 554]], { c: P.muted }));
  b.push(line([[186, 500], [208, 500], [208, 590], [232, 590]], { c: P.green, start: true }));
  b.push(t(212, 622, 'MAVLink', { fill: P.green, maxw: 120 }));
  b.push(t(212, 640, '(not via relay)', { fill: P.muted, maxw: 175 }));
  // Relay PCB
  b.push(line([[102, 526], [102, 666]], { c: P.text, w: 3, start: true }));
  b.push(t(110, 600, 'P1', { weight: 'bold' }));
  b.push(group(18, 668, 364, 132, 'RELAY PCB', { stroke: P.accent, labelFill: P.accent }));
  b.push(box(28, 676 + 20, 344, 30, { title: 'KSZ8795 5-port switch · VLANs', rx: 2 }));
  b.push(box(28, 746, 112, 44, { lines: ['Net/RC', 'W5500 + G0'], stroke: P.accent, size: 14, lh: 17 }));
  b.push(box(150, 746, 112, 44, { lines: ['Video N6', 'STM32N657'], stroke: P.red, size: 14, lh: 17 }));
  b.push(line([[84, 726], [84, 744]], { c: P.dim, end: false })); b.push(t(90, 740, 'P2', { size: 14, fill: P.muted }));
  b.push(line([[206, 726], [206, 744]], { c: P.dim, end: false })); b.push(t(212, 740, 'P5', { size: 14, fill: P.muted }));
  b.push(line([[290, 728], [290, 818]], { c: P.amber, start: true }));
  b.push(t(296, 760, 'P3', { fill: P.amber }));
  b.push(line([[350, 726], [350, 744]], { c: P.muted, end: false }));
  b.push(t(338, 762, 'P4', { fill: P.muted }));
  b.push(t(322, 780, 'spare', { fill: P.muted }));
  // Below the PCB
  b.push(line([[84, 790], [84, 818]], { c: P.accent }));
  b.push(t(90, 810, 'CRSF', { fill: P.accent }));
  b.push(box(18, 820, 132, 66, { title: 'ELRS TX', lines: ['module', '868/915/2.4'], stroke: P.accent }));
  b.push(box(160, 820, 104, 66, { title: 'VRX', lines: ['band per', 'client'], stroke: P.red }));
  b.push(line([[206, 818], [206, 792]], { c: P.red }));
  b.push(t(212, 812, 'CVBS', { fill: P.red }));
  b.push(box(274, 820, 108, 66, { title: 'IP camera', lines: ['.26 · RTSP', 'CAM_ENABLE'], stroke: P.amber }));
  // Client links
  b.push(line([[84, 886], [84, 1004]], { c: P.accent, dash: '7,5', w: 2.5 }));
  b.push(line([[212, 1004], [212, 888]], { c: P.red, dash: '7,5', w: 2.5 }));
  b.push(lines(92, 918, [{ s: 'CLIENT RC', o: { weight: 'bold', fill: P.accent } }, { s: 'ELRS 868 /', o: { fill: P.accent } }, { s: '915 / 2.4', o: { fill: P.accent } }, { s: 'or Gemini', o: { fill: P.accent } }], { maxw: 110 }));
  b.push(lines(220, 918, [{ s: 'CLIENT VIDEO', o: { weight: 'bold', fill: P.red } }, { s: 'analog, band', o: { fill: P.red } }, { s: 'per client', o: { fill: P.red } }, { s: '(5.8 GHz default)', o: { fill: P.red } }], { maxw: 172 }));
  // Client
  b.push(group(8, 1006, 384, 116, 'CLIENT — ANY ANALOG FPV DRONE'));
  b.push(box(18, 1034, 132, 50, { title: 'ELRS RX', lines: ['CRSF'], stroke: P.accent }));
  b.push(box(160, 1034, 104, 50, { title: 'Analog', lines: ['VTX'], stroke: P.red }));
  b.push(box(274, 1034, 108, 50, { title: 'FC', lines: ['e.g. BF'] }));
  b.push(line([[84, 1084], [84, 1104], [328, 1104], [328, 1086]], { c: P.dim }));
  // Legend
  const ly = 1150;
  b.push(line([[18, ly], [52, ly]], { c: P.text, w: 4, end: false })); b.push(t(60, ly + 5, 'HM30 IP link (only GCS link)'));
  b.push(line([[18, ly + 22], [52, ly + 22]], { c: P.accent, dash: '7,5', end: false })); b.push(t(60, ly + 27, 'client RC (ELRS)'));
  b.push(line([[18, ly + 44], [52, ly + 44]], { c: P.red, dash: '7,5', end: false })); b.push(t(60, ly + 49, 'client video (analog)'));
  b.push(line([[18, ly + 66], [52, ly + 66]], { c: P.muted, dash: '6,5', end: false })); b.push(t(60, ly + 71, 'carrier backup, close range only'));
  b.push(t(18, ly + 98, 'Link failsafe: SIYI / GCS loss only.', { fill: P.muted, maxw: 364 }));
  b.push(t(18, ly + 118, 'Battery: low → RTL, critical → QLand.', { fill: P.muted, maxw: 364 }));
  return { h: 1282, heading: 'D1 · SYSTEM OVERVIEW', sub: 'GCS ↔ HM30 ↔ carrier ↔ client',
    title: 'D1 — System overview: ground station, carrier and client with all four links',
    desc: 'Windows laptop with the EdgeTX radio (USB joystick, RF off), the GCS companion app (rc_up on UDP 5770), Mission Planner (UDPCI 192.168.144.12:19856) and the video viewer (UDP 5601, MP HUD 5602), Ethernet to the HM30 ground unit on the mast. '
      + 'The HM30 IP link is the only GCS link and carries MAVLink, RC UDP, client video RTP and the camera stream. A 915 MHz Nomad is the carrier\'s close-range backup to an ELRS RX on the ArduPlane FC. '
      + 'On the carrier the HM30 air unit connects to the FC (MAVLink, not through the relay) and to switch port P1 of the relay PCB (KSZ8795): P2 net/RC board (W5500 + STM32G030) drives the ELRS TX module over CRSF, P5 video board (STM32N657) takes CVBS from the VRX, P3 the IP camera (gated by CAM_ENABLE), P4 spare. '
      + 'Client RC: ELRS 868/915/2.4 GHz or Gemini to the client ELRS RX and FC. Client video: analog VTX, band per client (5.8 GHz default), to the carrier VRX. HM30 band: TBD (link profile).',
    source: 'Sources: plan §3.1 (diagram draft), §3.2 (links), §3.3 (addresses); relay design "System overview", "Ethernet".', body: b };
};

// ── D2 RELAY ELECTRONICS ── plan §9.3 draft D2, §3.4; relay design "Relay electronics", "Power tree", "Ethernet", "Control output", "Connectors".
D['d02-relay-electronics'] = () => {
  const b = [];
  // Power input
  b.push(box(18, 66, 364, 44, { title: 'Carrier battery bus · VIN 6–26 V', lines: [], stroke: P.green }));
  b.push(line([[200, 110], [200, 130]], { c: P.green }));
  b.push(t(208, 126, 'XT30', { fill: P.green }));
  // NET/RC BOARD
  b.push(group(8, 132, 384, 470, 'NET/RC BOARD', { stroke: P.accent, labelFill: P.accent }));
  b.push(box(18, 160, 364, 44, { lines: ['Fuse + reverse FET + TVS'], stroke: P.green }));
  b.push(box(18, 218, 176, 52, { lines: ['3.3V_RC buck', 'switch, W5500, G0'], stroke: P.green, lh: 18 }));
  b.push(box(206, 218, 176, 52, { lines: ['VBAT_TX buck', 'TX module supply'], stroke: P.green, lh: 18 }));
  b.push(line([[106, 204], [106, 216]], { c: P.green })); b.push(line([[294, 204], [294, 216]], { c: P.green }));
  // Switch
  b.push(box(18, 290, 364, 58, { title: 'KSZ8795 5-port switch', lines: ['VLANs · P1 priority · P3 limit'], stroke: P.text, lh: 19 }));
  b.push(box(18, 372, 150, 48, { title: 'W5500', lines: ['UDP 5770'] }));
  b.push(line([[94, 348], [94, 370]], { c: P.text, start: true }));
  b.push(t(100, 364, 'P2', { weight: 'bold' }));
  b.push(box(18, 440, 150, 66, { title: 'STM32G030', lines: ['bridge (G0)', 'TIM2 + IWDG'], stroke: P.accent }));
  b.push(line([[94, 420], [94, 438]], { c: P.dim, start: true }));
  b.push(t(100, 434, 'SPI 32 MHz', { fill: P.muted }));
  b.push(line([[168, 470], [210, 470], [210, 350]], { c: P.amber }));
  b.push(lines(218, 452, ['SPI config,', 'CAM_ENABLE →', 'P3 on / limit'], { fill: P.amber, maxw: 170 }));
  b.push(t(218, 506, 'LEDs: RC state,', { fill: P.muted, maxw: 170 }));
  b.push(t(218, 524, 'link (TBD)', { fill: P.muted, maxw: 170 }));
  b.push(line([[94, 506], [94, 560]], { c: P.accent }));
  b.push(t(102, 532, 'CRSF single-wire', { fill: P.accent, maxw: 180 }));
  b.push(t(102, 550, '400 kbaud', { fill: P.accent }));
  b.push(box(18, 562, 364, 30, { lines: ['JST-GH: VBAT_TX · GND · CRSF · spare'], rx: 2, size: 14 }));
  b.push(line([[382, 244], [388, 244], [388, 577], [384, 577]], { c: P.green, w: 1.5 }));
  b.push(line([[200, 592], [200, 618]], { c: P.accent }));
  b.push(box(110, 620, 180, 48, { title: 'ELRS TX module', lines: ['any band'], stroke: P.accent }));
  // Ports out of the switch (left side, external)
  b.push(t(18, 692, 'SWITCH PORTS', { weight: 'bold', fill: P.muted }));
  const rows = [
    ['P1', 'HM30 air unit', 'transformer · HM30 conn.', P.text],
    ['P2', 'W5500 (RC bridge)', 'on board, capacitors', P.accent],
    ['P3', 'IP camera', 'JST-GH 4-pin TX±/RX±', P.amber],
    ['P4', 'spare', 'JST-GH 4-pin TX±/RX±', P.muted],
    ['P5', 'video board (N6)', 'RMII via B2B connector', P.red]
  ];
  rows.forEach((rw, i) => {
    const y = 704 + i * 46;
    b.push(box(18, y, 44, 38, { title: rw[0], stroke: rw[3], titleFill: rw[3] }));
    b.push(t(72, y + 16, rw[1], { weight: 'bold', maxw: 310 }));
    b.push(t(72, y + 33, rw[2], { fill: P.muted, maxw: 310 }));
  });
  // VLAN map
  let y = 948;
  b.push(t(18, y, 'VLAN MAP (port-based)', { weight: 'bold', fill: P.muted }));
  b.push(lines(18, y + 22, ['P2 RC bridge ↔ P1 only', 'P3 camera → P1 (and P5 if needed)', 'P4 spare → P1 (and P5 if needed)', 'Camera / spare traffic and broadcasts', 'never reach the RC bridge.'], { maxw: 364 }));
  y = 1076;
  b.push(t(18, y, 'P1 EGRESS PRIORITY', { weight: 'bold', fill: P.muted }));
  b.push(lines(18, y + 22, [{ s: '1  RC status (P2)', o: { fill: P.accent } }, { s: '2  client video (P5)', o: { fill: P.red } }, { s: '3  camera (P3), rate-limited', o: { fill: P.amber } }], { maxw: 364 }));
  b.push(t(18, y + 92, 'The HM30 radio is the bottleneck.', { fill: P.muted, maxw: 364 }));
  // VIDEO BOARD
  y = 1196;
  b.push(group(8, y, 384, 296, 'VIDEO BOARD', { stroke: P.red, labelFill: P.red }));
  b.push(t(150, y + 20, 'VIN via B2B, own rails', { fill: P.green, maxw: 236 }));
  b.push(box(18, y + 32, 364, 44, { title: 'CVBS in · SMA + JST-GH 2-pin', lines: [{ s: 'from the VRX (band per client)', o: { fill: P.muted } }], stroke: P.red, lh: 19 }));
  b.push(line([[200, y + 76], [200, y + 104]], { c: P.red }));
  b.push(box(18, y + 106, 364, 44, { title: 'TVP5150 / TW9900 decoder', lines: [], stroke: P.red }));
  b.push(line([[200, y + 150], [200, y + 172]], { c: P.red }));
  b.push(t(208, y + 166, 'BT.656', { fill: P.red }));
  b.push(box(18, y + 174, 364, 52, { title: 'STM32N657 (N6)', lines: ['H.264 per field · RTP 5600'], stroke: P.red, lh: 19 }));
  b.push(line([[200, y + 226], [200, y + 248]], { c: P.red }));
  b.push(t(208, y + 242, 'RMII → switch P5', { fill: P.red, maxw: 180 }));
  b.push(t(18, y + 270, 'LEDs: PG8 heartbeat · PG10', { fill: P.muted, maxw: 364 }));
  b.push(t(18, y + 288, 'decoder lock · PG0 Ethernet link', { fill: P.muted, maxw: 364 }));
  y = 1516;
  b.push(lines(18, y, [{ s: 'Boards share only VIN and the RMII', o: { weight: 'bold' } }, 'link (B2B). RC enters P1, leaves P2', 'inside the switch: it never touches', 'the N6, so RC keeps running while the', 'video board resets or is reflashed.', { s: 'Test 5 proves it (incl. P3 flood).', o: { fill: P.muted } }], { maxw: 364 }));
  return { h: 1626, heading: 'D2 · RELAY ELECTRONICS', sub: ['Two boards · KSZ8795 · ports P1–P5'],
    title: 'D2 — Relay electronics block diagram: net/RC board, video board, KSZ8795 switch ports P1–P5, VLANs, power, LEDs',
    desc: 'VIN 6–26 V from the carrier battery bus (XT30) through fuse, reverse-polarity FET and TVS on the net/RC board, then the 3.3V_RC buck (switch, W5500, G0), the VBAT_TX buck (ELRS TX module) and VIN through the board-to-board connector to the video board. '
      + 'KSZ8795 switch: P1 HM30 air unit (transformer), P2 W5500 RC bridge (capacitor-coupled), P3 IP camera (JST-GH 4-pin), P4 spare (JST-GH 4-pin), P5 RMII to the N6. W5500 (UDP 5770) to STM32G030 bridge over SPI 32 MHz; G0 configures the switch over SPI and applies CAM_ENABLE to P3; G0 drives the ELRS TX module over single-wire CRSF at 400 kbaud (JST-GH VBAT_TX, GND, CRSF, spare). '
      + 'VLANs: P2 to P1 only; P3 and P4 to P1 (and P5 if needed). P1 egress priority: RC status, client video, camera. Video board: CVBS (SMA + JST-GH 2-pin) → TVP5150 / TW9900 → BT.656 → STM32N657 H.264, RTP to UDP 5600 → RMII P5. LEDs PG8 heartbeat, PG10 decoder lock, PG0 Ethernet link; bridge LEDs RC state and link, patterns TBD.',
    source: 'Sources: plan §9.3 D2 draft, §3.4 item 1; relay design "Relay electronics", "Power tree", "Ethernet", "Control output to the TX module", "MCU core" (LEDs), "Connectors".', body: b };
};

// ── D3 NETWORK / IP AND PORT MAP ── plan §3.3; contract C2/C3; data/content.js network rows.
D['d03-network-map'] = () => {
  const b = [];
  b.push(group(8, 66, 384, 214, 'LAPTOP 192.168.144.X /24', { stroke: P.text, labelFill: P.text }));
  b.push(lines(18, 108, ['static IP, X must not clash', 'suggested .100 · final: TBD'], { fill: P.muted, maxw: 364 }));
  b.push(box(18, 140, 364, 128, { align: 'left', top: 22, lines: [
    { s: 'Local (127.0.0.1) on the laptop:', o: { weight: 'bold' } },
    { s: 'app receives UDP 5600, re-sends:', o: { fill: P.red } },
    { s: '  → 5601 standalone viewer', o: { fill: P.red } },
    { s: '  → 5602 Mission Planner HUD', o: { fill: P.red } },
    { s: 'app API HTTP 47800 (read-only)', o: { fill: P.muted } }
  ], lh: 20 }));
  b.push(line([[200, 280], [200, 304]], { c: P.dim, start: true }));
  b.push(t(208, 298, 'Ethernet', { fill: P.muted }));
  b.push(box(18, 306, 364, 52, { title: 'HM30 ground unit · 192.168.144.12', lines: ['UDP 19856 MAVLink ↔ MP UDPCI'], stroke: P.green, lh: 19 }));
  b.push(line([[200, 358], [200, 400]], { c: P.text, w: 4, start: true }));
  b.push(t(208, 384, 'HM30 IP link', { weight: 'bold' }));
  b.push(box(18, 402, 364, 40, { title: 'HM30 air unit · 192.168.144.11', lines: [] }));
  b.push(line([[200, 442], [200, 462]], { c: P.text, w: 2, start: true }));
  b.push(t(208, 458, 'P1', { weight: 'bold' }));
  b.push(box(18, 464, 364, 34, { title: 'Relay switch (KSZ8795)', lines: [], rx: 2 }));
  b.push(t(18, 514, 'switch ports:', { fill: P.muted }));
  const rows = [
    { c: P.red, port: 'P5', dev: 'N6 video board', ip: 'IP TBD (e.g. .20)', l: ['RTP/UDP → 5600 at the GCS', 'carrier → GCS'] },
    { c: P.accent, port: 'P2', dev: 'RC bridge (W5500)', ip: 'IP TBD (e.g. .21)', l: ['UDP 5770 at the bridge:', 'rc_up 36 B, 200–250 Hz ←', '→ status 10 Hz + CRSF telem.', 'to the rc_up source IP:port'] },
    { c: P.amber, port: 'P3', dev: 'IP camera', ip: '.26 (current)', l: ['RTSP 8554 /main.264 → GCS', 'only while CAM_ENABLE = 1', 'VLAN → P1 only, rate-limited'] },
    { c: P.muted, port: 'P4', dev: 'Spare port', ip: '—', l: ['VLAN → P1 only', 'use and cap: TBD'] }
  ];
  let y = 520;
  rows.forEach(rw => {
    const h = 44 + rw.l.length * 19;
    b.push(box(18, y, 50, h, { title: rw.port, stroke: rw.c, titleFill: rw.c }));
    b.push(box(76, y, 306, h, { align: 'left', top: 20, stroke: rw.c, lines: [{ s: rw.dev, o: { weight: 'bold' } }, { s: rw.ip, o: { fill: P.muted } }].concat(rw.l.map(s => ({ s, o: { fill: rw.c } }))), lh: 19 }));
    y += h + 12;
  });
  b.push(lines(18, y + 16, [{ s: 'Mission Planner holds UDP 5600 by', o: { fill: P.amber } }, { s: 'default: with the app\'s fan-out', o: { fill: P.amber } }, { s: 'running, MP must not listen on 5600', o: { fill: P.amber } }, { s: '— its HUD uses 5602, the viewer 5601.', o: { fill: P.amber } }], { maxw: 364 }));
  b.push(t(18, y + 110, 'Proposed map — confirm before flight.', { fill: P.muted, maxw: 364 }));
  return { h: y + 132, heading: 'D3 · NETWORK & PORT MAP', sub: ['HM30 subnet 192.168.144.x'],
    title: 'D3 — Network and port map: every IP, port, protocol and direction',
    desc: 'Laptop 192.168.144.X/24 (static, suggested .100, final TBD). On the laptop the GCS app receives the client video on UDP 5600 and re-sends it to 127.0.0.1:5601 (standalone viewer) and 127.0.0.1:5602 (Mission Planner HUD); local read-only API on HTTP 47800. '
      + 'HM30 ground unit 192.168.144.12, UDP 19856 MAVLink both ways (MP UDPCI). HM30 air unit 192.168.144.11 to switch P1. P5 N6 video board (IP TBD, e.g. .20) sends RTP/UDP to port 5600 at the GCS. P2 RC bridge W5500 (IP TBD, e.g. .21) listens on UDP 5770 for 36-byte rc_up packets at 200–250 Hz and replies with the 10 Hz status and CRSF telemetry to the source IP:port of the latest valid rc_up. '
      + 'P3 IP camera 192.168.144.26, RTSP 8554 /main.264 to the GCS, only while CAM_ENABLE = 1, VLAN to P1 only and rate-limited. P4 spare, VLAN to P1 only, use and cap TBD. Mission Planner must not listen on 5600 while the fan-out runs.',
    source: 'Sources: plan §3.3, §7.4; contracts C2 (port 47800), C3 (ports 5600/5601/5602/5770); data/content.js network; WP08b note (MP and UDP 5600).', body: b };
};

module.exports = D;
