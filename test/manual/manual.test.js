'use strict';
// WP06 R1–R12: structure and safety content of manual.html (static source checks; the jsdom smoke test covers rendering).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, HTML, loadManualCore, withoutHistoryNote } = require('./helpers.js');
const C = require('../../data/content.js');

const MC = loadManualCore();
const SRC = withoutHistoryNote(HTML);
const stripTags = s => s.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const panel = id => { const m = HTML.match(new RegExp('<div id="tab-' + id + '" class="tab-panel">([\\s\\S]*?)\\n</div>\\n')); return m ? m[1] : ''; };

// Removed relay chain, corrected safety facts and old manual defects (plan §4, §5.2, §13.2, §13.3).
const FORBIDDEN = [
  /nomad relay/i, /relay nomad/i, /DBR4 (RX|receiver)/i, /carrier relay TX/i, /ground relay TX/i, /hold (the )?left button/i, /LEFT button on (the )?carrier/i,
  /CVBS\s*(→|->|&rarr;)\s*HDMI/i, /HDMI\s*(→|->)\s*IP/i, /SIYI HDMI/i, /SIYI switch/i, /192\.168\.144\.25\b/, /MPV\.net/i, /MPV RTSP/i,
  /re-?bind/i, /sub-drone/i, /relay bind/i, /bind(ing)? every (pre)?flight/i, /required every (pre)?flight/i, /every preflight/i,
  /868\s?(MHz)?\s?(→|->)\s?2\.4/i, /2\.4\s?GHz relay/i, /FPV TX \(2\.4/i, /zero interface with ArduPlane/i,
  /\d\s?m AGL/i, /relative to home( point)? \(AGL\)/i,/all 4 motors/i, /props \(all 4\)/i, /rear (pair|motors?)/i, /cruise motor/i, /T2 Ranger/i, /T2 VTOL\b/,
  // FS_SHORT_TIMEOUT is allowed again (WP14): the owner's Rev C document keeps it as GCS-failsafe timing.
  /AUTO (mode )?only/i, /do not touch TX/i, /0 = QHOVER/i, /aborts? to QHOVER/i, /(?<!never )falls back to QHOVER/i,
  /sets the home point/i, /Crosswind or slightly downwind/i, /Reversing the sequence/i, /Power TX before aircraft/i,
  /fpv_drone\.jpg/, /5-inch racing/i, /30\s?km/i, /1\.2\s?m wingspan/i, /REV A\b/, /TAKE OVER ONLY BY RESUME/
];

test('forbidden-terms scan of manual.html (outside the optional history note)', () => {
  const hits = [];
  SRC.split(/\r?\n/).forEach((l, i) => FORBIDDEN.forEach(re => { if (re.test(l)) hits.push((i + 1) + ': ' + re + ' :: ' + l.trim().slice(0, 100)); }));
  assert.deepEqual(hits, []);
});

test('every nav item resolves to an existing tab panel, and every tab has a nav item', () => {
  const panels = [...HTML.matchAll(/<div id="tab-([a-z]+)" class="tab-panel">/g)].map(m => m[1]);
  assert.equal(new Set(panels).size, panels.length, 'no duplicate panels');
  const nav = HTML.slice(HTML.indexOf('<nav id="nav"'), HTML.indexOf('</nav>'));
  const items = [...nav.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  assert.ok(items.length >= 15);
  for (const t of items) {
    assert.ok(panels.includes(t), 'nav item ' + t + ' has a panel');
    assert.equal(MC.resolveTab(t), t, 'nav item ' + t + ' is a known tab');
  }
  assert.deepEqual([...panels].sort(), [...MC.TAB_IDS].sort(), 'ManualCore.TABS matches the panels');
  assert.deepEqual([...items].sort(), [...MC.TAB_IDS].sort(), 'one nav item per tab');
  // Old inline handlers with hard-coded tab names are gone (one source: data-tab).
  assert.doesNotMatch(nav, /(switchTab|selectNavItem)\('/);
  // Relay Electronics and Client Drones sit under Aircraft ▾.
  const aircraft = nav.slice(nav.indexOf('>Aircraft <'), nav.indexOf('>Operations <'));
  for (const t of ['aircraft', 'flightmodes', 'relay', 'clients']) assert.match(aircraft, new RegExp('data-tab="' + t + '"'));
});

test('static ids are unique; every in-page anchor used by the manual exists', () => {
  const ids = [...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, []);
  // Rendered content ids must not collide with static ids (the renderers add these).
  const rendered = ['design-intent', 'failsafe-table', 'client-failsafe-chain', 'network'].concat(C.emergencies.map(e => e.id), C.emergencyNotes.map(n => n.id));
  for (const id of rendered) assert.ok(!ids.includes(id), 'static id collides with rendered id ' + id);
});

test('scripts: shared helpers load before the page code; VtolCommon / VtolRender used, no private escH', () => {
  const order = ['js/version.js', 'js/common.js', 'js/store.js', 'data/content.js', 'js/render-content.js'].map(s => HTML.indexOf('<script src="' + s + '">'));
  assert.ok(order.every(i => i > 0), 'all shared scripts loaded');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'load order');
  assert.ok(order[4] < HTML.indexOf('<script id="manual-core">'));
  assert.doesNotMatch(HTML, /function escH\(/, 'no private escH copy');
  assert.match(HTML, /VtolCommon\.escH/);
  assert.match(HTML, /VtolCommon\.toggleCleanup/);
  assert.match(HTML, /VTOL_VERSION/);
});

test('shared operational content is rendered from data/content.js, not duplicated (R1, R3, R7, R8)', () => {
  for (const id of ['fm-intent', 'fm-failsafe', 'fm-client-chain', 'comms-network', 'emerg-list', 'emerg-pills', 'callouts-body', 'comms-pipelines']) {
    assert.match(HTML, new RegExp('id="' + id + '"'), id);
  }
  for (const call of ['designIntent(C.designIntent', 'failsafeTable(C.failsafeTable', 'clientFailsafeChain(C.clientFailsafeChain', 'networkTable(C.network', 'emergencies(C.emergencies, C.emergencyNotes', 'emergencyPills(C.emergencies', 'callouts(C.callouts']) {
    assert.ok(HTML.includes(call), 'renders ' + call);
  }
  // No static copies of the shared texts in the page source.
  const text = stripTags(HTML);
  for (const e of C.emergencies) for (const s of e.immediate) assert.ok(!text.includes(s.replace(/\[\[|\]\]/g, '')) || s.length < 12, 'emergency text duplicated: ' + s);
  assert.doesNotMatch(HTML, /class="emerg-imm-step"/, 'no static emergency cards');
  for (const g of C.callouts.groups) for (const r of g.rows) assert.ok(!HTML.includes('<td><strong>"' + r.call + '"</strong>'), 'callout table row duplicated: ' + r.call);
  for (const r of C.network.rows) assert.ok(!HTML.includes('<td>' + r.device + '</td><td>' + r.ip.replace(/`([^`]+)`/g, '<code>$1</code>')), 'network row duplicated: ' + r.device);
  assert.doesNotMatch(HTML, /<td>Mission Planner UDPCI port<\/td>|rtsp:\/\/192\.168\.144\.26:8554\/main\.264<\/code><\/td><\/tr>/, 'old static network table gone');
});

test('Flight Modes: design intent first, failsafe slot D7, old RC cascade removed, S-01a / S-02a/b/c / S-03 documented (R1)', () => {
  const fm = panel('flightmodes');
  assert.ok(fm.indexOf('id="fm-intent"') < fm.indexOf('Mode Switch'), 'design intent at the top');
  assert.match(fm, /<div class="diagram-slot" data-diagram="D7">/);
  assert.match(fm, /<div class="diagram-slot" data-diagram="D6">/);
  assert.doesNotMatch(HTML, /RC LINK-LOSS FAILSAFE CASCADE|FBWA ACTIVE/i, 'RC failsafe cascade SVG deleted');
  const t = stripTags(fm);
  assert.match(t, /usable only within close range/i);
  assert.match(t, /QHOVER.*FBWB.*AUTO/);
  assert.match(t, /left button/i);
  assert.match(t, /S-01a/); assert.match(t, /drifts with the wind/); assert.match(t, /VERIFY — S-01a/);   // WP14: plan §15.2 behaviour
  assert.match(t, /Never close Mission Planner in flight/);
  assert.match(t, /never sleep or hibernate/i);
  assert.match(t, /sysid 255/);
  assert.match(t, /MAVLink Inspector/); assert.match(t, /RADIO_STATUS/); assert.match(t, /TBD — S-02c/);
  assert.match(t, /FS_SHORT_ACTN 0 CIRCLE \/ no change/);
  assert.match(t, /not FBWA/);
});

// WP14 (plan §15.1 / §15.2, reference param file): Q_TRANS_FAIL = 8 s, Q_TRANS_FAIL_ACT = 1 → QRTL home (supersedes R11b a).
test('Q_TRANS_FAIL_ACT = 1 is QRTL home everywhere, never QHOVER (Rev C)', () => {
  const t = stripTags(HTML);
  const qtf = [...t.matchAll(/[^.]{0,120}Q_TRANS_FAIL_ACT[^.]{0,160}/g)].map(m => m[0]);
  assert.ok(qtf.length >= 3, 'Q_TRANS_FAIL_ACT mentioned in aircraft, mission planning and glossary');
  for (const s of qtf) {
    assert.match(s, /QRTL|Q_TRANS_FAIL_ACT = 1\b/, s);
    assert.doesNotMatch(s, /= ?0 ?(→|=)? ?(QHOVER|QLand)/i, s);
  }
  assert.match(stripTags(panel('aircraft')), /Q_TRANS_FAIL 8 s .*Q_TRANS_FAIL_ACT 1 = QRTL .*QRTL home/);
});

test('GCS app start paths: normal start on the ground, RESUME for an airborne client, never DISARMED airborne (R11b b)', () => {
  const proc = panel('procedures');
  assert.match(proc, /id="gcs-app-start"/);
  const t = stripTags(proc);
  assert.match(t, /Normal start Client on the ground/);
  assert.match(t, /RESUME \(client airborne\)/);
  assert.match(t, /arm switch ARMED/);
  assert.match(t, /type RESUME/); assert.match(t, /THROTTLE/);
  assert.match(t, /Client airborne: never use the normal start/);
  assert.match(t, /never starts or resumes by itself/);
  // Every text block that mentions an airborne client together with DISARMED must be a prohibition.
  const blocks = [...SRC.matchAll(/<(td|p|li)[^>]*>([\s\S]*?)<\/\1>/g)].map(m => stripTags(m[2]));
  const airborne = blocks.filter(b => /airborne/i.test(b));
  assert.ok(airborne.length >= 5);
  for (const b of airborne) if (/DISARMED/.test(b)) assert.match(b, /never/i, b);
});

test('Relay Electronics chapter (R4)', () => {
  const r = panel('relay');
  const t = stripTags(r);
  for (const p of ['P1', 'P2', 'P3', 'P4', 'P5']) assert.match(t, new RegExp(p + ' '), p);
  assert.match(t, /Independence rule/);
  assert.match(t, /CAM_ENABLE/);
  assert.match(t, /Default off at power-up/);
  assert.match(t, /FIRMWARE REQUEST \(not implemented\)/);
  assert.match(t, /Heartbeat/); assert.match(t, /Decoder lock/); assert.match(t, /Ethernet link/);
  assert.match(t, /6–26 V/); assert.match(t, /6–16\.8 V/);
  assert.match(t, /STM32G030/); assert.match(t, /STM32N657/);
  const tests = r.slice(r.indexOf('id="relay-tests-table"'));
  for (let i = 1; i <= 9; i++) assert.match(tests, new RegExp('<tr><td>' + i + '</td>'), 'acceptance test ' + i);
  assert.equal((tests.slice(0, tests.indexOf('</table>')).match(/warn-val">TBD</g) || []).length, 9, 'measured column TBD for tests 1–9');
  for (const d of ['D2', 'D4', 'D5', 'D8', 'D8b', 'D15']) assert.match(r, new RegExp('data-diagram="' + d + '"'), d);
});

test('diagram slots D1–D15 exist for WP07', () => {
  for (const d of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D8b', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15']) {
    assert.match(HTML, new RegExp('<div class="diagram-slot" data-diagram="' + d + '">'), d);
  }
});

test('RF & Comms: chains, Nkom column, bandwidth and latency budgets, D1 (R3)', () => {
  const t = stripTags(panel('comms'));
  assert.match(t, /RC Uplink/); assert.match(t, /Video Downlink/); assert.match(t, /Carrier Camera/); assert.match(t, /Carrier Backup Link — 915 MHz/);
  assert.match(HTML, /Permitted in Norway \(band \/ max power \/ duty cycle\)/);
  assert.match(HTML, /TBD — Nkom check \(Q14\)/);
  assert.match(t, /FPV mode \(camera off\)/); assert.match(t, /Camera mode \(camera on\)/);
  assert.match(t, /Estimate from an earlier analysis, unmeasured/);
  assert.match(t, /expected and needs no action/);
});

test('Client Drones, Overview, photos and defects (R2, R6, R10)', () => {
  const cl = stripTags(panel('clients'));
  assert.match(cl, /Requirements for a client/);
  assert.match(cl, /Reference Client #1/);
  assert.match(cl, /0\.7 km at boresight/);
  assert.match(cl, /When the link returns, stick input above the threshold \(30%\) ends the rescue — only do so deliberately/);
  assert.match(panel('clients'), /id="clients-table"/);
  const ov = stripTags(panel('overview'));
  assert.match(ov, /relaying client video \(analog VRX → H\.264 over the HM30\) and client RC \(GCS → HM30 → relay bridge → ELRS TX module\)/);
  assert.match(ov, /EdgeTX radio as USB joystick/);
  assert.match(ov, /if the client sends telemetry/i);
  // Images: <picture> with webp + jpg, the neutral client drawing, sizes against layout shift.
  assert.match(HTML, /<picture><source srcset="img\/t2_vtol\.webp" type="image\/webp"><img src="img\/t2_vtol\.jpg" width="1280" height="662"/);
  assert.match(HTML, /src="img\/client_drone\.svg" width="400" height="400"/);
  for (const f of ['t2_vtol2', 'matek_f405', 'siyi_hm30']) assert.match(HTML, new RegExp('srcset="img/' + f + '\\.webp"'));
  for (const m of HTML.matchAll(/<(?:img|source) [^>]*src(?:set)?="(img\/[^"]+)"/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1]);
  // MAN-05: 3 motors, Q_FRAME_CLASS 7 = Tri.
  assert.match(stripTags(panel('aircraft')), /7 = Tri/);
  assert.match(stripTags(panel('procedures')), /All 3 motors \(M1, M2, M4\)/);
  // MAN-06: one number (3 s) and one direction (into wind) in the manual's own text.
  assert.doesNotMatch(stripTags(HTML), /2–3s|2-3s/);
  assert.match(stripTags(panel('missionplan')), /transition into wind/);
  // MAN-08: home is set at arming.
  assert.match(stripTags(panel('missionplan')), /ArduPilot sets home when the carrier is armed/);
  // MAN-13: pre-arm values flagged; MAN-15: version from VTOL_VERSION.
  assert.match(panel('prearm'), /data-ver="paramFile"/);
  assert.match(HTML, /'DOC-RC-001 · REV ' \+ V\.app/);
});

test('image credits: every photo has a credits row; representative images say so (WP22 R1, R2, R5)', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'img', 'README.md'), 'utf8');
  const photos = [...new Set([...HTML.matchAll(/<img [^>]*src="img\/([^"/]+\.jpg)"/g)].map(m => m[1]))];
  assert.ok(photos.length >= 6, 'photos found: ' + photos.join(', '));
  for (const f of photos) assert.match(readme, new RegExp('^\\| `' + f.replace(/\./g, '\\.') + '`', 'm'), f + ' has a credits row');
  const reps = [...HTML.matchAll(/<img [^>]*src="img\/(rep_[^"]+)"[^>]*>/g)];
  assert.ok(reps.length >= 2);
  for (const m of reps) assert.match(m[0], /alt="Representative image, not /, m[1] + ' alt text says representative');
  // The manual's Image Credits table (Reference ▾ Abbreviations) has a row for every photo, vendor images included.
  assert.match(panel('abbrev'), /id="image-credits"[\s\S]*<table id="image-credits-table">/);
  const table = HTML.slice(HTML.indexOf('<table id="image-credits-table">'), HTML.indexOf('</table>', HTML.indexOf('<table id="image-credits-table">')));
  const rows = [...table.matchAll(/<tr data-img="([^"]+)">([\s\S]*?)<\/tr>/g)].map(m => ({ imgs: m[1].split(' '), html: m[2] }));
  for (const f of photos) assert.ok(rows.some(r => r.imgs.includes(f.replace(/\.jpg$/, ''))), f + ' has a row in the Image Credits table');
  // Visible attribution of each representative image: caption credit line and credits row name the README's author and licence.
  for (const m of reps) {
    const f = m[1].replace(/\.jpg$/, ''), at = HTML.indexOf('img/' + f + '.jpg');
    const cells = readme.split(/\r?\n/).find(l => l.startsWith('| `' + f + '.jpg`')).split(' | ');
    const author = cells[2].replace(/\s*\(.*$/, ''), licence = cells[3].match(/CC BY(-SA)? \d\.\d/)[0];
    const fig = HTML.slice(HTML.lastIndexOf('<figure', at), HTML.indexOf('</figure>', at));
    const credit = (fig.match(/<span class="credit">([\s\S]*?)<\/span><\/figcaption>/) || [])[1] || '';
    assert.match(fig, /<figcaption>Representative image:/, f + ' caption says representative');
    for (const s of [author, licence, 'href="#abbrev/image-credits"']) assert.ok(credit.includes(s), f + ' caption credit names ' + s);
    const row = rows.find(r => r.imgs.includes(f));
    for (const s of [author, licence]) assert.ok(row.html.includes(s), f + ' credits row names ' + s);
  }
});

test('image credits: attribution links are legible — token colour, contrast ≥ 4.5:1 in normal and sunlight mode (WP22 R5)', () => {
  // The links in the caption credit lines and in the Image Credits table must not fall back to the UA link blue.
  const style = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));
  const rule = [...style.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(m => {
    const sel = m[1].split(',').map(s => s.trim());
    return sel.includes('.man-photo figcaption a') && sel.includes('#image-credits-table a') && /(^|;)color:var\(--[\w-]+\)/.test(m[2]);
  });
  assert.ok(rule, 'a color:var(--token) rule for ".man-photo figcaption a" and "#image-credits-table a"');
  const token = rule[2].match(/(?:^|;)color:var\((--[\w-]+)\)/)[1];
  // Token values from css/base.css: :root, then the sunlight overrides of :root[data-sun].
  const css = fs.readFileSync(path.join(ROOT, 'css', 'base.css'), 'utf8');
  const block = sel => { const m = css.match(new RegExp(sel.replace(/[[\]]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return Object.fromEntries([...m[1].matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,6})/gi)].map(x => [x[1], x[2]])); };
  const normal = block(':root'), sun = { ...normal, ...block(':root[data-sun]') };
  const lum = hex => { let h = hex.slice(1); if (h.length === 3) h = h.replace(/./g, c => c + c);
    const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // Captions sit on .man-photo (--surface2), the credits table on the page (--bg).
  for (const [name, t] of [['normal', normal], ['sunlight', sun]]) for (const bg of ['--surface2', '--bg']) {
    const r = ratio(t[token], t[bg]);
    assert.ok(r >= 4.5, name + ': ' + token + ' ' + t[token] + ' on ' + bg + ' ' + t[bg] + ' = ' + r.toFixed(2) + ':1');
  }
});

test('Pre-Arm Ref: Relay & GCS app section lists every app alarm and bridge state (R8)', () => {
  const t = stripTags(panel('prearm'));
  const alarms = ['rc_sender_dead', 'rc_stream_stopped', 'controller_disconnected', 'bridge_no_status', 'bridge_not_run', 'client_failsafe', 'client_rth', 'client_telemetry_stale', 'client_link_weak', 'client_batt_low', 'client_sats_low', 'client_rescue_not_ready', 'rtt_high', 'rtt_rising_camera', 'camera_mismatch', 'send_jitter_high', 'gcs_on_battery', 'gcs_battery_saver'];
  for (const a of alarms) assert.match(t, new RegExp('\\(\\s*' + a + '\\s*\\)'), a);
  for (const s of ['BOOT', 'WAIT_GCS', 'START', 'RUN', 'FAILSAFE', 'UNREACHABLE']) assert.match(t, new RegExp(s), s);
});

test('Procedures: power-up order (8 steps, Nomad last), bind once, EdgeTX RF-off box, app status duty (R5)', () => {
  const p = panel('procedures');
  const pu = p.slice(p.indexOf('id="power-up"'), p.indexOf('id="carrier-only"'));
  assert.equal((pu.match(/<div class="step-n">/g) || []).length, 8);
  assert.match(pu, /<div class="step-n">8<\/div><div class="step-body"><strong>915 MHz Nomad \(last\)/);
  assert.match(pu, /TBD — confirm by bench test/);
  const t = stripTags(p);
  assert.match(t, /no bind before each flight/);
  assert.match(t, /binding phrase/);
  assert.match(p, /id="edgetx-rf-off"/);
  assert.match(t, /internal RF OFF , external RF OFF/);
  assert.match(t, /RTT, client LQ, bridge state, camera state/);
  assert.match(t, /RC LINK DEGRADED/);
  assert.match(t, /CAMERA ON/);
});

test('Glossary additions (R9)', () => {
  const t = stripTags(panel('abbrev'));
  for (const term of ['N6', 'G0', 'W5500', 'KSZ8795', 'RMII', 'BT.656', 'CVBS', 'PAL / NTSC', 'Field vs frame', 'H.264', 'RTP', 'RTSP vs RTP', 'SDP', 'CRSF frame', 'ModelID', 'Timing frame (0x3A)', 'T_hold', 'LQ', 'RSSI dBm', 'Packet rate', 'Binding phrase', 'Model match', 'QoS / 802.1p', 'REL']) {
    assert.ok(t.includes(' ' + term + ' '), term);
  }
});
