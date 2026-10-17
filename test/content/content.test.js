'use strict';
// WP05 R1/R2/R9: schema, forbidden terms and failsafe intent of data/content.js (contract C5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../data/content.js');

const { ROOT, readText } = require('../repo-files.js');
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;   // safe in HTML ids and data attributes

// Every string in the content, with its path.
function strings(v, p, out) {
  out = out || [];
  if (typeof v === 'string') out.push([p, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, p + '[' + i + ']', out));
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => strings(v[k], p + '.' + k, out));
  return out;
}
function ids(v, out) {
  out = out || [];
  if (Array.isArray(v)) v.forEach(x => ids(x, out));
  else if (v && typeof v === 'object') { if (typeof v.id === 'string') out.push(v.id); Object.keys(v).forEach(k => { if (k !== 'id') ids(v[k], out); }); }
  return out;
}

// Removed relay chain and corrected safety facts (plan §4, §13.2, §13.3; WP05 R2, R11d).
const FORBIDDEN = [
  /nomad relay/i, /relay nomad/i, /DBR4 receiver/i, /hold left button/i, /left button/i,
  /CVBS\s*(→|->)\s*HDMI/i, /HDMI\s*(→|->)\s*IP/i, /SIYI HDMI/i, /192\.168\.144\.25\b/, /MPV RTSP/i, /MPV\.net/i, /mpv\.conf/i,
  /re-?bind/i, /sub-drone/i, /relay bind/i, /bind(ing)? every (pre)?flight/i, /required every (pre)?flight/i,
  /120\s?m AGL/i, /all 4 motors/i, /props \(all 4\)/i, /rear pair/i, /cruise motor/i,
  /FS_SHORT/i, /1\.5\s?s/i, /AUTO only/i,   // FS_SHORT*: allowed only in the owner's failsafe copy block (see the scan) /do not touch TX/i, /T2 Ranger/i, /2\.4\s?GHz relay/i, /868\s?(→|->)\s?2\.4/i
];

test('C5 shape: all top-level parts exist', () => {
  for (const k of ['designIntent', 'checklists', 'postflight', 'emergencies', 'emergencyNotes', 'failsafeTable', 'network', 'callouts']) assert.ok(C[k], k);
  assert.ok(C.checklists.preflight && C.checklists.turnaround);
  assert.deepEqual(C.checklists.preflight.sections.map(s => s.id), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(C.checklists.preflight.sections[4].name, 'CLIENT');
});

test('every id is unique and well-formed; checklist items have s and t', () => {
  const all = ids(C);
  assert.ok(all.length > 100);
  const dup = all.filter((x, i) => all.indexOf(x) !== i);
  assert.deepEqual(dup, [], 'duplicate ids');
  for (const id of all) assert.match(id, ID_RE, id);
  for (const list of Object.values(C.checklists)) {
    assert.ok(list.goText && list.title);
    for (const sec of list.sections) {
      assert.ok(sec.id && sec.name && sec.items.length);
      for (const it of sec.items) {
        assert.ok(it.id && it.s && it.t, it.id);
        assert.ok(it.s.length <= 40, 'short title ' + it.id);
        if (it.copy) assert.ok(it.n, 'copy item needs n: ' + it.id);
        (it.extras || []).forEach(e => assert.ok(e.label && e.val, it.id));
      }
    }
  }
});

test('emergencies: immediate ≤ 6 short phrases, clean-up present; the §6.1.8 scenarios exist', () => {
  for (const e of C.emergencies) {
    assert.ok(e.id && e.title && e.pill, e.id);
    assert.ok(Array.isArray(e.immediate) && e.immediate.length >= 1 && e.immediate.length <= 6, e.id + ' immediate count');
    for (const s of e.immediate) assert.ok(s.length <= 60, e.id + ' immediate phrase too long: ' + s);
    assert.ok(Array.isArray(e.cleanup) && e.cleanup.length >= 1, e.id + ' cleanup');
  }
  const titles = C.emergencies.map(e => e.title).join(' | ');
  for (const re of [/SIYI \/ GCS Link Loss/, /Client RC Loss/, /Video Loss/, /Relay PCB Fault/, /GCS App \/ Controller Failure/, /Carrier Camera Loss/, /Transition Failure/, /Battery Low \/ Critical/]) assert.match(titles, re);
  const v = C.emergencies.find(e => e.id === 'emerg-video');
  assert.match(v.cleanup.join(' '), /\(a\) Analog RF/);
  assert.match(v.cleanup.join(' '), /\(b\) Digital chain/);
});

test('failsafe intent: SIYI card = RTL after 5 s in all modes, first and primary', () => {
  const siyi = C.emergencies[0];
  assert.equal(siyi.id, 'emerg-gcs');
  assert.equal(siyi.priority, 'primary');
  const txt = [siyi.title, siyi.summary].concat(siyi.immediate, siyi.cleanup).join(' ');
  assert.match(txt, /5 s/);
  assert.match(txt, /RTL/);
  assert.match(txt, /any mode|every mode|all modes/i);
  assert.match(siyi.immediate.join(' '), /5 s → AUTO \[\[RTL\]\] \/ \[\[QRTL\]\] — ANY MODE/);   // WP14: QRTL in VTOL modes (plan §15.2)
  assert.match(siyi.immediate.join(' '), /HOME LZ CLEAR — AUTO VTOL LANDING/);
  assert.match(siyi.immediate.join(' '), /CLIENT FAILSAFE/);
  assert.match(siyi.cleanup.join(' '), /forced OFF/, 'camera forced off on GCS loss');
  assert.match(siyi.cleanup.join(' '), /laptop asleep|sleep/i, 'S-02a causes');
});

test('failsafe intent: 915 loss is a note, not an emergency; close-in case kept', () => {
  const all = C.emergencies.map(e => (e.title + ' ' + e.pill + ' ' + e.id)).join(' ');
  assert.doesNotMatch(all, /915/, 'no emergency card for the 915 link');
  const note = C.emergencyNotes.find(n => n.id === 'note-915-lost');
  assert.ok(note);
  assert.equal(note.kind, 'note');
  assert.match(note.text, /expected, no action/);
  assert.match(note.closeIn.steps.join(' '), /TAKE OVER IN MP/);
  assert.match(note.closeIn.note, /drifts with the wind/);   // WP14: plan §15.2 behaviour, test still to confirm it
  assert.match(note.closeIn.note, /\[\[VERIFY — S-01a/);
});

test('WP05 rework F1: app/controller card — airborne client only via RESUME (arm switch ARMED), never DISARMED / normal start', () => {
  const card = C.emergencies.find(e => e.id === 'emerg-app');
  const all = [card.title, card.summary].concat(card.immediate, card.cleanup);
  const imm = card.immediate.join(' | ');
  assert.match(imm, /AIRBORNE: NEVER NORMAL START/);
  assert.match(imm, /IF TAKING OVER: RESUME ONLY — ARM SWITCH ARMED/);
  const airborne = all.filter(s => /airborne/i.test(s));
  assert.ok(airborne.length >= 2);
  for (const s of airborne) {
    assert.match(s, /RESUME|NEVER/i, 'airborne case must point to RESUME: ' + s);
    if (/DISARMED/.test(s)) assert.match(s, /never/i, 'airborne + DISARMED only as a prohibition: ' + s);
  }
  const resume = card.cleanup.find(s => /\*\*RESUME \(client airborne\)\*\*/.test(s));
  assert.ok(resume, 'clean-up names the RESUME (client airborne) start path');
  assert.match(resume, /arm switch ARMED/);
  assert.match(resume, /`RESUME`/);
  assert.match(resume, /`THROTTLE`/);
  const ground = card.cleanup.find(s => /Client on the GROUND/.test(s));
  assert.match(ground, /normal start — arm switch DISARMED/);
  assert.doesNotMatch(ground, /airborne/i);
  // Nowhere in the content: a restart instruction that pairs an airborne client with the DISARMED start.
  for (const [p, s] of strings(C, 'VtolContent')) {
    if (/airborne/i.test(s) && /DISARMED/.test(s)) assert.match(s, /never/i, p);
  }
});

// WP14 (plan §15.1 / §15.2): supersedes WP05 F8 — the reference param file has Q_TRANS_FAIL = 8, Q_TRANS_FAIL_ACT = 1 (QRTL).
test('Rev C: transition timeout 8 s → QRTL home (Q_TRANS_FAIL_ACT = 1), never QHOVER / QLand; WP2 → home kept clear', () => {
  const row = C.failsafeTable.rows.find(r => r.id === 'fs-trans');
  assert.match(row.detection, /`Q_TRANS_FAIL` 8 s/);
  assert.match(row.action, /`Q_TRANS_FAIL_ACT` = 1 → transition cancelled → \*\*\[\[QRTL\]\] home\*\*/);
  assert.match(row.action, /never QHOVER/);
  assert.match(row.pilot, /QHOVER\]\] at 2–3 s/);
  assert.match(row.pilot, /WP2 → home clear/);
  const card = C.emergencies.find(e => e.id === 'emerg-trans');
  assert.match(card.summary, /\*\*8 s\*\*/); assert.match(card.summary, /QRTL home/); assert.match(card.summary, /never falls back to QHOVER/);
  assert.match(card.immediate.join(' '), /NO ACTION BY 8 s → AUTO \[\[QRTL\]\] HOME/);
  assert.match(card.immediate[0], /\[\[QHOVER\]\] — switch now/);
  assert.doesNotMatch(JSON.stringify(C), /Q_TRANS_FAIL_ACT[^"]{0,20}(→|->)\s*\[\[(QHOVER|QLAND)\]\]/);
  assert.doesNotMatch(JSON.stringify(C), /Q_TRANS_FAIL_ACT = 0|Q_TRANS_FAIL \(?4 s/);
});

test('WP05 rework F2/F3/F7: video decision time, relay PCB → SIYI card, S-02b', () => {
  const v = C.emergencies.find(e => e.id === 'emerg-video');
  assert.ok(v.immediate.includes('WAIT 10 SECONDS'));
  assert.match(v.cleanup.join(' '), /10 s wait above \(current procedure value\)/);
  assert.match(v.cleanup.join(' '), /\[\[TBD — measure, then review the 10 s\]\]/);
  const pcb = C.emergencies.find(e => e.id === 'emerg-relay-pcb');
  assert.match(pcb.cleanup.join(' '), /If MP telemetry also drops → SIYI \/ GCS LOSS card/);
  assert.match(C.emergencies[0].cleanup.join(' '), /S-02b: .*sysid 255/);
});

test('failsafe table (§6.1.5): SIYI → RTL all modes; 915 → none (THR_FAILSAFE = 2)', () => {
  const rows = C.failsafeTable.rows;
  assert.equal(rows.length, 5);
  const siyi = rows.find(r => r.id === 'fs-siyi'), r915 = rows.find(r => r.id === 'fs-915');
  assert.match(siyi.detection, /5 s/);
  assert.match(siyi.detection, /all modes/);
  assert.match(siyi.action, /RTL/);
  assert.match(r915.action, /None/);
  assert.match(r915.action, /THR_FAILSAFE` = 2/);
  assert.match(C.designIntent.text, /only link whose loss triggers a carrier failsafe/);
});

// WP14 R12: exactly the owner's list (VTOL Manual Changes Needed to Match Carrier Params, 2026-10-17), with its comments.
const OWNER_FAILSAFE_BLOCK = [
  'THR_FAILSAFE = 2      (RC loss detected, NO failsafe action)',
  'THR_FS_VALUE = 950',
  'FS_SHORT_ACTN = 0     (no change in AUTO/GUIDED; CIRCLE in manual modes)',
  'FS_SHORT_TIMEOUT = 1.5',
  'FS_LONG_ACTN = 1      (long failsafe -> RTL)',
  'FS_LONG_TIMEOUT = 5',
  'FS_GCS_ENABL = 2      (GCS failsafe in ALL modes)',
  'BATT_LOW_VOLT = 22.0  (low -> RTL home)',
  'BATT_FS_LOW_ACT = 1',
  'BATT_CRT_VOLT = 21.0  (critical -> Loiter to QLand HERE)',
  'BATT_FS_CRT_ACT = 6',
  'BATT_FS_VOLTSRC = 1   (sag-compensated voltage)',
  'BATT_ARM_VOLT = 24.6',
  'Q_TRANS_FAIL = 8      (transition timeout, s)',
  'Q_TRANS_FAIL_ACT = 1  (timeout -> QRTL home)'
].join('\n');
test('R12: "Failsafe params verified" copy block = exactly the owner\'s list; every value equals the reference param file', () => {
  const d = C.checklists.preflight.sections.find(s => s.id === 'D');
  const fs = d.items.find(i => i.id === 'carrier-failsafe-params');
  assert.ok(fs.copy && fs.w);
  assert.equal(fs.n, OWNER_FAILSAFE_BLOCK);
  assert.equal(C.failsafeParams, OWNER_FAILSAFE_BLOCK);
  const ref = require('../../data/params-reference.js').params;
  for (const line of fs.n.split('\n')) {
    const m = line.match(/^([A-Z_]+) = ([\d.]+)/);
    assert.ok(m, line);
    assert.equal(ref[m[1]], Number(m[2]), m[1] + ' = reference');
  }
});

test('copy blocks (R3): viewer + MP HUD in PAL and NTSC on ports 5601 / 5602, camera .26, sdp', () => {
  const c = C.checklists.preflight.sections.find(s => s.id === 'C');
  const vid = c.items.find(i => i.id === 'gs-client-video');
  const vals = vid.extras.map(e => e.label + ' ' + e.val);
  assert.ok(vals.some(v => /VIEWER · PAL/.test(v) && /udpsrc port=5601/.test(v) && /width=768,height=576/.test(v) && /autovideosink/.test(v)));
  assert.ok(vals.some(v => /VIEWER · NTSC/.test(v) && /udpsrc port=5601/.test(v) && /width=640,height=480/.test(v)));
  assert.ok(vals.some(v => /MP HUD · PAL/.test(v) && /udpsrc port=5602/.test(v) && /appsink name=outsink/.test(v)));
  assert.ok(vals.some(v => /MP HUD · NTSC/.test(v) && /udpsrc port=5602/.test(v) && /width=640,height=480,format=BGRA/.test(v)));
  assert.ok(vals.some(v => /\.sdp/.test(v) && /m=video 5601 RTP\/AVP 96/.test(v) && /a=rtpmap:96 H264\/90000/.test(v)));
  for (const v of vals) assert.doesNotMatch(v, /rtpjitterbuffer/);
  const cam = c.items.find(i => i.id === 'gs-carrier-camera');
  assert.match(cam.n, /rtsp:\/\/192\.168\.144\.26:8554\/main\.264/);
  assert.match(cam.t, /Switch the camera on in the GCS app first/);
});

test('required new checklist items (§6.2.1) and removed old ones', () => {
  const all = Object.values(C.checklists).flatMap(l => l.sections.flatMap(s => s.items.map(i => i.id)));
  for (const id of ['build-relay-pcb', 'gs-app', 'gs-laptop-sleep', 'gs-client-video', 'gs-carrier-camera', 'carrier-bridge-run', 'carrier-camera-sortie',
    'client-profile', 'client-vtx', 'client-elrs', 'client-failsafe', 'ta-bridge-run', 'ta-viewer-restart', 'ta-camera']) assert.ok(all.includes(id), id);
  for (const id of ['gs-mpv-conf', 'gs-mpv-stream', 'fpv-relay-bind', 'ta-fpv-relay-bind', 'ta-mpv-stream', 'gs-gstreamer', 'ta-gstreamer']) assert.ok(!all.includes(id), id);
  const props = C.checklists.preflight.sections[1].items.find(i => i.id === 'build-props');
  assert.match(props.t, /3 motors \(M1\/M2 tilt, M4 tail\)/);
  const pf = JSON.stringify(C.postflight);
  assert.match(pf, /Relay PCB temperature/);
  assert.match(pf, /Save GCS app session log/);
});

test('auto rules on items exist in VtolRender.AUTO_RULES', () => {
  const R = require('../../js/render-content.js');
  const autos = Object.values(C.checklists).flatMap(l => l.sections.flatMap(s => s.items.filter(i => i.auto).map(i => i.auto)));
  assert.ok(autos.length >= 7);
  for (const a of autos) assert.ok(R.AUTO_RULES[a], a);
});

test('forbidden-terms scan: content strings', () => {
  const hits = [];
  // WP14 R12: the owner's "Failsafe params verified" block lists FS_SHORT_ACTN / FS_SHORT_TIMEOUT = 1.5 verbatim.
  const di = C.checklists.preflight.sections[3].items.findIndex(i => i.id === 'carrier-failsafe-params');
  const OWNER_BLOCK = new Set(['VtolContent.failsafeParams', 'VtolContent.checklists.preflight.sections[3].items[' + di + '].n']);
  for (const [p, s] of strings(C, 'VtolContent')) for (const re of FORBIDDEN) {
    if (OWNER_BLOCK.has(p) && (String(re) === '/FS_SHORT/i' || String(re) === '/1\\.5\\s?s/i')) continue;
    if (re.test(s)) hits.push(p + ' ~ ' + re + ' :: ' + s.slice(0, 80));
  }
  assert.deepEqual(hits, []);
  assert.ok(di >= 0 && C.checklists.preflight.sections[3].id === 'D', 'the exemption path points at the copy block');
});

test('forbidden-terms scan: index.html, data/ and js/ (acceptance grep)', () => {
  // The scan regexes themselves live in test/, so they are not scanned.
  const files = ['index.html'].concat(fs.readdirSync(path.join(ROOT, 'data')).map(f => 'data/' + f), fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
  const OLD = [/nomad relay/i, /DBR4 receiver/i, /hold left button/i, /CVBS\s*(→|->)\s*HDMI/i, /SIYI HDMI/i, /HDMI\s*(→|->)\s*IP/i, /192\.168\.144\.25\b/, /MPV RTSP/i, /MPV\.net/i, /mpv\.conf/i, /re-bind/i, /sub-drone/i, /rear pair/i, /120\s?m AGL/i, /all 4 motors/i];
  const hits = [];
  for (const f of files) {
    const lines = readText(f).split('\n');
    lines.forEach((l, i) => OLD.forEach(re => { if (re.test(l)) hits.push(f + ':' + (i + 1) + ' ' + re); }));
  }
  assert.deepEqual(hits, []);
});

test('every placeholder is a visible [[TBD — …]] marker (no bare "TBD" in content)', () => {
  for (const [p, s] of strings(C, 'VtolContent')) {
    const bare = s.replace(/\[\[TBD[^\]]*\]\]/g, '');
    assert.doesNotMatch(bare, /\bTBD\b/, p);
  }
});

test('network table (§3.3) includes the TBD relay IPs and the C2/C3 local ports', () => {
  const n = C.network.rows;
  const byId = id => n.find(r => r.id === id);
  assert.match(byId('net-n6').ip, /\[\[TBD/);
  assert.match(byId('net-bridge').ip, /\[\[TBD/);
  assert.match(byId('net-bridge').port, /5770/);
  assert.match(byId('net-n6').port, /5600/);
  assert.match(byId('net-fanout').port, /5601.*5602/);
  assert.match(byId('net-api').port, /47800/);
  assert.match(byId('net-hm30-ground').ip, /192\.168\.144\.12/);
});

test('callouts: the new §6.1.9 / §14.2 phrases exist', () => {
  const calls = C.callouts.groups.flatMap(g => g.rows.map(r => r.call)).concat(C.callouts.abort.rows.map(r => r.call));
  for (const c of ['RC LINK DEGRADED', 'BRIDGE FAILSAFE', 'VIDEO DIGITAL LOST', 'VIDEO SNOW', 'APP DOWN', 'CAMERA ON', 'CAMERA OFF',
    'FPV FAILSAFE', 'FPV RTH', 'FPV LINK WEAK', 'FPV SATS LOW', 'FPV TELEMETRY LOST']) assert.ok(calls.includes(c), c);
  assert.ok(!calls.includes('NO VIDEO'));
});
