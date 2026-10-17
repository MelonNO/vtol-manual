'use strict';
// WP07 R1/R2/R3/R6: img/diagrams/*.svg (well-formed, ≤ 60 KB, accessible, palette comment, phone-readable, content
// against plan §3.4 / §4 / §9.3 and the relay design) and their use in manual.html; inline SVGs and Tools charts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readText } = require('../repo-files.js');
const { wellFormed } = require('./xml.js');

const DIR = path.join(ROOT, 'img', 'diagrams');
const FILES = {
  D1: 'd01-system-overview', D2: 'd02-relay-electronics', D3: 'd03-network-map', D4: 'd04-rc-path-timeline', D5: 'd05-bridge-states',
  D6: 'd06-client-failsafe', D7: 'd07-carrier-failsafe', D8: 'd08-bandwidth-budget', D8b: 'd08b-camera-logic', D9: 'd09-antenna-layout',
  D10: 'd10-ground-station', D11: 'd11-wiring-harness', D12: 'd12-troubleshooting', D13: 'd13-coverage-intersection', D14: 'd14-crew-swimlane',
  D15: 'd15-video-field-timing'
};
const svg = id => readText('img/diagrams/' + FILES[id] + '.svg');
// Visible text of an SVG (title/desc/comments excluded) for content checks.
const visible = s => s.replace(/<title[\s\S]*?<\/title>|<desc[\s\S]*?<\/desc>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const PALETTE = ['#0f0f0f', '#1a1a1a', '#222222', '#2a2a2a', '#333333', '#444444', '#e8e8e8', '#777777', '#f97316', '#facc15', '#ef4444', '#22c55e'];
const PHONE_CONTENT_PX = 332;   // 360 px viewport minus the manual's 14 px side padding

test('R1/R6: every D1–D15 file exists, is well-formed, ≤ 60 KB, accessible, uses only the palette (with the mapping comment)', () => {
  const onDisk = fs.readdirSync(DIR).filter(f => f.endsWith('.svg')).sort();
  assert.deepEqual(onDisk, Object.values(FILES).map(f => f + '.svg').sort(), 'exactly the 16 diagram files');
  for (const id of Object.keys(FILES)) {
    const f = path.join(DIR, FILES[id] + '.svg'), s = svg(id);
    assert.ok(fs.statSync(f).size <= 60 * 1024, id + ' ≤ 60 KB');
    const wf = wellFormed(s);
    assert.ok(wf.ok, id + ' well-formed: ' + wf.error);
    assert.equal(wf.root, 'svg');
    assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]* role="img"/, id + ' role=img');
    assert.match(s, /<title id="title">[^<]{20,}<\/title>/, id + ' title');
    assert.match(s, /<desc id="desc">[^<]{80,}<\/desc>/, id + ' desc');
    assert.match(s, /aria-labelledby="title desc"/, id);
    assert.match(s, /<!-- Palette:[\s\S]*#f97316 = accent[\s\S]*-->/, id + ' palette mapping comment');
    assert.match(s, /<!-- Sources: /, id + ' sources comment');
    assert.doesNotMatch(s, /var\(--/, id + ': standalone SVG uses hex values, not page variables');
    const colours = new Set((s.replace(/<!--[\s\S]*?-->/g, '').match(/#[0-9a-fA-F]{6}\b/g) || []).map(c => c.toLowerCase()));
    for (const c of colours) assert.ok(PALETTE.includes(c), id + ' uses only palette colours: ' + c);
    assert.doesNotMatch(s, /NaN|undefined/, id);
  }
});

test('R1 readability: text ≥ 11 CSS px at a 360 px viewport (fit-to-width images, 400-unit viewBox)', () => {
  for (const id of Object.keys(FILES)) {
    const s = svg(id);
    const vbW = +s.match(/viewBox="0 0 (\d+) \d+"/)[1];
    const sizes = [+s.match(/<svg [^>]*font-size="([\d.]+)"/)[1]].concat([...s.matchAll(/font-size="([\d.]+)"/g)].map(m => +m[1]));
    const minF = Math.min(...sizes);
    assert.ok(minF * PHONE_CONTENT_PX / vbW >= 11, id + ': ' + minF + ' units in ' + vbW + ' → ' + (minF * PHONE_CONTENT_PX / vbW).toFixed(1) + ' px');
  }
});

test('R1 content: D2 switch ports P1–P5, VLAN map, priorities, power and LEDs (relay design, plan §3.4)', () => {
  const t = visible(svg('D2'));
  assert.match(t, /KSZ8795/); assert.match(t, /W5500/); assert.match(t, /STM32G030/); assert.match(t, /STM32N657/);
  const ports = { P1: /HM30 air unit/, P2: /W5500 \(RC bridge\)/, P3: /IP camera/, P4: /spare/, P5: /video board \(N6\)/ };
  for (const [p, re] of Object.entries(ports)) assert.match(t, new RegExp(p + ' ' + re.source), p);
  assert.match(t, /P2 RC bridge ↔ P1 only/); assert.match(t, /P3 camera → P1 \(and P5 if needed\)/); assert.match(t, /P4 spare → P1 \(and P5 if needed\)/);
  assert.match(t, /1 RC status \(P2\) 2 client video \(P5\) 3 camera \(P3\)/);
  assert.match(t, /VIN 6–26 V/); assert.match(t, /CRSF single-wire 400 kbaud/); assert.match(t, /SPI 32 MHz/); assert.match(t, /CAM_ENABLE/);
  assert.match(t, /PG8 heartbeat/); assert.match(t, /PG10 decoder lock/); assert.match(t, /PG0 Ethernet link/);
  assert.match(t, /TVP5150 \/ TW9900/); assert.match(t, /BT\.656/); assert.match(t, /RTP 5600/);
});

test('R1 content: D1 four links, D3 every port, D4 stage latencies', () => {
  const d1 = visible(svg('D1'));
  assert.match(d1, /HM30 IP LINK/); assert.match(d1, /CLIENT RC ELRS 868 \/ 915 \/ 2\.4 or Gemini/); assert.match(d1, /CLIENT VIDEO analog, band per client/); assert.match(d1, /ELRS 915 MHz close range/);
  assert.match(d1, /P1/); assert.match(d1, /P2/); assert.match(d1, /P3/); assert.match(d1, /P4/); assert.match(d1, /P5/);
  assert.match(d1, /Carrier failsafe: SIYI \/ GCS loss only/);
  const d3 = visible(svg('D3'));
  for (const p of ['5600', '5601', '5602', '5770', '19856', '47800', '8554', '192.168.144.12', '.11', '.26']) assert.ok(d3.includes(p), 'D3 ' + p);
  assert.match(d3, /IP TBD \(e\.g\. \.20\)/); assert.match(d3, /IP TBD \(e\.g\. \.21\)/); assert.match(d3, /only while CAM_ENABLE = 1/);
  assert.match(d3, /MP must not listen on 5600/);
  const d4 = visible(svg('D4'));
  for (const v of ['1–8 ms', 'every 4–5 ms', 'unknown — measure', 'under 1 ms', 'up to 1 CRSF period (4–5 ms)', 'about 0.65 ms', '1 ELRS packet interval', '0x3A']) assert.ok(d4.includes(v), 'D4 ' + v);
});

test('R1 content: D5 bridge state machine (relay design state table)', () => {
  const t = visible(svg('D5'));
  const order = ['BOOT', 'WAIT_GCS', 'START', 'RUN', 'FAILSAFE'].map(s => t.indexOf(s + ' CRSF'));
  assert.ok(order.every(i => i >= 0) && order.every((v, i) => !i || v > order[i - 1]), 'states in order ' + order);
  for (const s of ['peripherals and W5500 up', '5 consecutive valid packets', 'ModelID sent × 3', 'no valid packet for T_hold', 'start 250 ms', 'immediately', 'CRSF: ModelID × 3', 'CRSF: none (silent)', 'UNREACHABLE', '300 ms', 'about 100 ms'])
    assert.ok(t.includes(s), 'D5 ' + s);
  assert.equal((t.match(/LED pattern: TBD \(firmware\)/g) || []).length, 5, 'LED pattern TBD per state');
});

test('R1 content: D6 client failsafe chain with TBD times; D7 carrier failsafe per plan §4 (QLand, no RC-loss action)', () => {
  const d6 = visible(svg('D6'));
  assert.match(d6, /T_hold: start value 250 ms/); assert.match(d6, /TBD — measure \(test 6\)/); assert.match(d6, /RX timeout: TBD per client/);
  assert.equal((d6.match(/TBD — test 6/g) || []).length, 4, 'total per cause TBD');
  const d7 = visible(svg('D7'));
  assert.match(d7, /SIYI \/ MP LINK LOST — PRIMARY/); assert.match(d7, /no GCS heartbeat 5 s/); assert.match(d7, /FS_GCS_ENABL = 2/); assert.match(d7, /RTL \(FS_LONG_ACTN = 1\)/);
  assert.match(d7, /915 MHz BACKUP LOST/); assert.match(d7, /NONE — RC ignored/); assert.match(d7, /THR_FAILSAFE = 2/);
  assert.match(d7, /BATTERY CRITICAL 22\.2 V/); assert.match(d7, /Loiter → QLand/);
  assert.match(d7, /BATT_LOW_VOLT = 0 \(not set\)/); assert.match(d7, /manual RTL at 23\.0 V/);
  assert.match(d7, /Q_TRANS_FAIL 4 s/); assert.match(d7, /QLand at the current position \(Q_TRANS_FAIL_ACT = 0\) — VERIFY/);
  assert.match(d7, /0 s GCS heartbeat lost/); assert.match(d7, /5 s RTL in any mode/); assert.match(d7, /120 m REL/); assert.match(d7, /Q-mode RTL behaviour: TBD/);
  assert.doesNotMatch(d7, /FBWA|1\.5 s|QHOVER\s*\(Q_TRANS|→ QHOVER \(auto/i, 'no RC failsafe cascade, transition fail is not an automatic QHOVER');
});

test('R1 content: D8 / D8b bandwidth and camera logic (values TBD, CAM_ENABLE rules, firmware request marked)', () => {
  const d8 = visible(svg('D8'));
  assert.match(d8, /NOT TO SCALE/); assert.match(d8, /RC uplink ≈ 100–130 kbit\/s/); assert.match(d8, /P3 ingress cap TBD \(Q13\)/); assert.match(d8, /HM30 capacity \(TBD\)/);
  assert.match(d8, /camera OFF while the client is armed/);
  const b = visible(svg('D8b'));
  assert.match(b, /rc_up flags bit 0 = CAM_ENABLE/); assert.match(b, /within one packet/); assert.match(b, /power-up: OFF/); assert.match(b, /GCS stream lost: forced OFF/);
  assert.match(b, /status packet \(10 Hz\)/); assert.match(b, /CAMERA STATE MISMATCH/); assert.match(b, /FIRMWARE REQUEST — not implemented/);
});

test('R1 content: D9–D15 (positions TBD, no invented numbers; field timing per the relay design)', () => {
  const d9 = visible(svg('D9'));
  assert.match(d9, /patch 1: 90°/); assert.match(d9, /patch 2: 135°/); assert.equal((d9.match(/pos\. TBD/g) || []).length, 5);
  assert.match(visible(svg('D11')), /VBAT_TX inside 6–16\.8 V/);
  const d12 = visible(svg('D12'));
  assert.match(d12, /NO CLIENT RC/); assert.match(d12, /NO CLIENT VIDEO/); assert.match(d12, /RESUME only/); assert.match(d12, /UDP 5601/); assert.match(d12, /UDP 5602/);
  assert.match(visible(svg('D13')), /video polygon ∩ RC polygon/);
  const d14 = visible(svg('D14'));
  for (const c of ['"MP LIVE"', '"FPV READY"', '"TRANSITION FAIL"', '"BRIDGE FAILSAFE"', '"APP DOWN"', '"FPV LANDED"', '"ABORT ABORT ABORT"']) assert.ok(d14.includes(c), 'D14 ' + c);
  const d15 = visible(svg('D15'));
  for (const v of ['18.4 ms', '15.3 ms', '9 × 32 lines', '704×288', '59.94 Hz', '≤ 3 ms', '25 ms']) assert.ok(d15.includes(v), 'D15 ' + v);
});

test('diagram files: no removed-relay terms or corrected safety facts', () => {
  const BAD = [/nomad relay/i, /DBR4 (RX|receiver)/i, /HDMI/i, /\d\s?m AGL/i, /all 4 motors/i, /cruise motor/i, /0 = QHOVER/i, /AUTO (mode )?only/i, /re-?bind/i, /sub-drone/i, /FS_SHORT_TIMEOUT/];
  for (const id of Object.keys(FILES)) for (const re of BAD) assert.doesNotMatch(svg(id), re, id + ' ' + re);
});

test('R2: every manual diagram slot is filled with its image and a caption', () => {
  const html = readText('manual.html');
  const slots = [...html.matchAll(/<div class="diagram-slot" data-diagram="(D\d+b?)">([\s\S]*?)<\/div>\n/g)];
  assert.equal(slots.length, 17, 'D1–D15, D8b, and D5 twice');
  assert.deepEqual([...new Set(slots.map(m => m[1]))].sort(), Object.keys(FILES).sort());
  for (const [, id, body] of slots) {
    const src = 'img/diagrams/' + FILES[id] + '.svg';
    assert.ok(body.includes('<img src="' + src + '"'), id + ' image');
    assert.match(body, /loading="lazy"/, id);
    const a = body.match(/ alt="([^"]{60,})"/);
    assert.ok(a, id + ' alt text');
    const s = svg(id), w = s.match(/ width="(\d+)" height="(\d+)"/);
    assert.ok(body.includes('width="' + w[1] + '" height="' + w[2] + '"'), id + ' width/height against layout shift');
    assert.match(body, new RegExp('<figcaption><strong>' + id + '</strong> · .{30,}</figcaption>'), id + ' caption');
  }
  assert.doesNotMatch(html, /\.diagram-slot::before/, 'placeholder style gone');
});

test('R3: manual inline SVGs use CSS variables, role/title/desc, readable text with a min-width, symbols for quad icons', () => {
  const html = readText('manual.html');
  const svgs = [...html.matchAll(/<svg viewBox="0 0 (\d+) (\d+)"[^>]*>[\s\S]*?<\/svg>/g)];
  assert.equal(svgs.length, 4, 'motors, mission profile, line of sight, orbit (gauge and GPS Rescue are generated)');
  const MW = { 'mw-560': 560, 'mw-600': 600, 'mw-780': 780 };
  for (const m of svgs) {
    const s = m[0], vbW = +m[1];
    const wf = wellFormed(s);
    assert.ok(wf.ok, 'inline svg well-formed: ' + wf.error);
    assert.match(s, /role="img" aria-labelledby="(svg-[\w-]+-t) (svg-[\w-]+-d)"/);
    assert.match(s, /<title id="svg-[\w-]+-t">[^<]+<\/title><desc id="svg-[\w-]+-d">[^<]+<\/desc>/);
    assert.doesNotMatch(s.replace(/href="#[\w-]+"|url\(#[\w-]+\)/g, ''), /#[0-9a-fA-F]{3,8}\b/, 'no hex colours');
    const cls = s.match(/class="man-svg (mw-\d+)"/);
    assert.ok(cls && MW[cls[1]], 'min-width class');
    const minF = Math.min(...[...s.matchAll(/font-size="([\d.]+)"/g)].map(x => +x[1]));
    assert.ok(minF * MW[cls[1]] / vbW >= 11, 'text ≥ 11 px at min-width: ' + minF + ' × ' + MW[cls[1]] + ' / ' + vbW);
    for (const k of Object.keys(MW)) if (s.includes(k)) assert.match(html, new RegExp('\\.' + k + '\\{min-width:' + MW[k] + 'px;\\}'));
  }
  assert.match(html, /<symbol id="sym-quad"/);
  assert.ok((html.match(/<use href="#sym-quad"/g) || []).length >= 2, 'quad icon reused');
  assert.equal((html.match(/<circle cx="-8" cy="-8"/g) || []).length, 1, 'quad drawing defined once');
  // specific fixes
  assert.match(html, /TILT AXIS/); assert.match(html, /CW \/ CCW: TBD/); assert.match(html, /TILT — SIDE VIEW/); assert.match(html, /80° Q_TILT_MAX/);
  assert.doesNotMatch(html, /pusher motor/i, 'F5');
  assert.match(html, /corridor clear to 60 m/); assert.match(html, /ABORT: no airspeed in 3 s → QHOVER/); assert.match(html, /back-transition glide ≈100–130 m \(10 s\)/); assert.match(html, />REL m</);
  assert.match(html, /1st Fresnel radius/); assert.match(html, /HM30 · MAVLink · RC · video/); assert.match(html, /patch beam/); assert.match(html, /ALWAYS/); assert.match(html, /BODY SHADOW/);
  assert.doesNotMatch(html, /868MHz RC · SIYI video|2\.4GHz · 5\.8GHz/, 'obsolete orbit labels gone');
  // generated: gauge (R4) and GPS Rescue (R3) containers, rendered from the profiles
  assert.match(html, /id="ac-batt-gauge"/); assert.match(html, /VtolDiagrams\.batteryGauge\(pack, manCtx\.settings/);
  assert.match(html, /id="ref-rescue-svg"/); assert.match(html, /VtolDiagrams\.gpsRescue\(p\)/);
  const order = ['js/tools-core.js', 'js/diagrams.js'].map(f => html.indexOf('<script src="' + f + '">'));
  assert.ok(order[0] > 0 && order[1] > order[0] && order[1] < html.indexOf('<script id="manual-core">'), 'tools-core then diagrams, before the page code');
});

test('R5: Tools charts come from js/diagrams.js with profile thresholds, overlays and the wind hints', () => {
  const html = readText('index.html');
  assert.ok(html.indexOf('<script src="js/diagrams.js">') > html.indexOf('<script src="js/tools-core.js">'));
  assert.match(html, /VtolDiagrams\.battTrend\(entries, pack, store\.settings\)/);
  assert.match(html, /VtolDiagrams\.battSparkline\(e, pack, store\.settings\)/);
  assert.match(html, /VtolDiagrams\.windCompass\(dir, speed, gust, c, wxLimits\(\)\)/);
  assert.match(html, /windCompassSVG\(dir, wind, wS\.c, gusts\)/);
  assert.match(html, /VtolDiagrams\.timeChart\(values, times/);
  assert.match(html, /function binOverlay\(d\)/);
  assert.equal((html.match(/binChart\([^\n]*?,ov\)\)/g) || []).length, 3, 'voltage, altitude and airspeed charts get the overlay');
  const fn = name => { const i = html.indexOf('function ' + name + '('); return html.slice(i, html.indexOf('\n}\n', i)); };
  for (const f of ['battTrendSVG', 'battSparkline', 'binChart', 'binOverlay', 'windCompassSVG']) assert.doesNotMatch(fn(f), /#[0-9a-fA-F]{3,8}\b/, f + ' has no hex colours');
  assert.doesNotMatch(html, /'#60a5fa',70/, 'airspeed chart colour is a token');
});
