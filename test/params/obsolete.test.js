'use strict';
// WP14 R3: no obsolete carrier value survives in its safety context (plan §15.1 "Old value in docs" column), anywhere the
// field reads it: pages, shared content, shared JS, the map, the diagram generators and the generated diagrams.
// Also: every "PARAM = value" written in those files equals the reference parameter file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, readText } = require('../repo-files.js');
const REF = require('../../data/params-reference.js').params;

const ls = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter(f => re.test(f)).map(f => dir + '/' + f);
const FILES = ['index.html', 'manual.html', 'relay/map.html', 'relay/rfmodel.js', 'tools/latency-clock.html']
  .concat(ls('data', /\.js$/).filter(f => f !== 'data/params-reference.js'), ls('js', /\.js$/), ls('scripts/diagrams', /\.js$/), ls('img/diagrams', /\.svg$/));
// Text as a reader sees it: tags dropped, entities decoded, whitespace collapsed (markup cannot hide a value).
const plain = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');

// [description, regex] — each regex matches the OLD value in the context that made it a safety statement.
const OBSOLETE = [
  ['22.2 V as the critical voltage', /22\.2\s?V?[^.\n]{0,40}(crit|BATT_CRT|AUTOLAND|QLand)|(crit|BATT_CRT_VOLT|BATT_CRT)[^.\n]{0,25}22\.2/i],
  ['13 m/s cruise', /cruise[^.\n]{0,30}\b13\s?m\/s|\b13\s?m\/s[^.\n]{0,40}(cruise|AIRSPEED_CRUISE)|AIRSPEED_CRUISE[^.\n]{0,15}\b13\b|46\.8\s?km/i],
  ['11 m/s minimum airspeed', /(min|>|above)[^.\n]{0,30}\b11\s?m\/s|\b11\s?m\/s[^.\n]{0,40}(AIRSPEED_MIN|minimum|stall)|AIRSPEED_MIN[^.\n]{0,15}\b11\b/i],
  ['4 s transition fail', /Q_TRANS_FAIL(?!_)[^.\n]{0,20}\b4\s?s\b|Q_TRANS_FAIL(?!_)\s*=\s*4\b|\b4\s?s\b[^.\n]{0,40}(automatic|QLand|QLAND|transition fail)/i],
  ['QLand / QHOVER on transition fail', /Q_TRANS_FAIL_ACT`?\s*=\s*0|(transition (fail|timeout)|Q_TRANS_FAIL)[^.\n]{0,80}automatic[^.\n]{0,20}(QLand|QHOVER)|aborts? to QHOVER|(?<!never )falls back to QHOVER|0 = QHOVER/i],
  ['Q_RTL_ALT 70 m', /Q_RTL_ALT(?!_)[^.\n]{0,20}\b70(?!\d)|VTOL RTL altitude[^.\n]{0,30}\b70\s?m/i],
  ['Q_TRANSITION_MS 3000', /Q_TRANSITION_MS[^.\n]{0,20}3000|\b3000\s?ms/],
  ['Q_BACKTRANS_MS 10000 / 100–130 m glide', /Q_BACKTRANS_MS[^.\n]{0,20}(10000|10\s?s)|\b10000\s?ms|100[–-]130\s?m\b|10\s?s back-transition|back-transition[^.\n]{0,20}10\s?s\b/i],
  ['35 % trim throttle', /TRIM_THROTTLE[^.\n]{0,20}35|cruise throttle[^.\n]{0,40}35\s?%/i],
  ['hover thrust 0.272', /0\.272|27\.2\s?%/],
  ['tilt rate 40 deg/s', /\b40\s?(deg\/s|°\/s)/],
  ['"BATT_LOW_VOLT not set" / = 0', /BATT_LOW_VOLT[^.\n]{0,20}(not set|NOT SET|=\s?0\b)|No BATT_LOW|BATT_LOW not set/i],
  ['"no low-battery warning"', /no (automated |automatic )?low-battery warning|no warning voltage/i],
  ['"fence configured but disabled"', /configured but (intentionally )?disabled|geofence configured/i],
  ['the old BATT_LOW_VOLT recommendation', /Recommended BATT_LOW_VOLT|recommendBattLow|BATT_LOW_VOLT = \$\{|Set BATT_LOW_VOLT/],
  ['Q-mode RTL behaviour still TBD', /Q-mode (RTL )?behaviou?r: ?TBD|check Q_RTL_MODE \/ Q_OPTIONS/i],
  ['FLTMODE2 as QLOITER / TBD', /FLTMODE2[^.\n]{0,30}(QLOITER \(|TBD)/]
];

// Deliberate mentions of an old value: the store migration must recognise the pre-Rev C default to replace it (C1.6).
const ALLOW = [['js/store.js', /const OLD_BATT_CRT = 22\.2;/]];

test('R3: no obsolete value in its safety context in any page, content, script, map or diagram', () => {
  assert.ok(FILES.length > 30, FILES.length + ' files');
  const hits = [];
  for (const f of FILES) {
    const lines = plain(readText(f)).split('\n');
    lines.forEach((l, i) => { if (ALLOW.some(([af, ar]) => af === f && ar.test(l))) return; for (const [d, re] of OBSOLETE) if (re.test(l)) hits.push(f + ':' + (i + 1) + ' [' + d + '] ' + l.trim().slice(0, 140)); });
  }
  assert.deepEqual(hits, []);
});

test('R3: the scan really catches the old wording (regression guard of the regexes)', () => {
  const OLD = ['BATT_CRT_VOLT = 22.2V', 'CRIT VOLT 22.2V', 'Target cruise speed 13 m/s (46.8 km/h)', 'Stay above 11 m/s', 'Q_TRANS_FAIL 4s',
    'Q_TRANS_FAIL_ACT = 0 → QLand', 'auto-aborts at 4s → automatic QLand', 'Q_RTL_ALT 70m', 'Q_TRANSITION_MS 3000 ms', 'Q_BACKTRANS_MS 10000 ms',
    'glide ≈100–130 m', 'TRIM_THROTTLE 35%', 'Q_M_THST_HOVER 0.272', 'rate 40°/s', 'BATT_LOW_VOLT = 0 (not set)', 'No low-battery warning is configured',
    'geofence configured (ALT_MAX=100m) but intentionally disabled', 'Recommended BATT_LOW_VOLT', 'Q-mode RTL behaviour: TBD', 'FLTMODE2 TBD'];
  for (const s of OLD) assert.ok(OBSOLETE.some(([, re]) => re.test(s)), 'not caught: ' + s);
  const NEW = ['BATT_CRT_VOLT = 21.0V', 'Nominal 22.2V, full 25.2V', 'Target cruise speed 12 m/s (43.2 km/h)', 'Q_TRANS_FAIL 8 s', 'It never falls back to QHOVER',
    'ABORT: no airspeed in 3 s → QHOVER', 'Q_RTL_ALT 50m', 'RC uplink ≈ 100–130 kbit/s', 'FLTMODE2 = 11 RTL'];
  for (const s of NEW) assert.ok(!OBSOLETE.some(([, re]) => re.test(s)), 'false positive: ' + s);
});

// WP14 rework F1: pre-Rev C failsafe STATEMENTS (plan §15.2 / §15.3). Checked per sentence (a line split at ". "), because
// the wording varies: the qualifier that makes a statement correct may sit anywhere in the same sentence.
//   - "SIYI is the only failsafe" without saying it is the only LINK failsafe (battery failsafes exist since Rev C);
//   - RTL "in any / every / all mode(s)" without the QRTL of the VTOL modes;
//   - a list of what triggers a failsafe / an action that names the critical battery but not the low-battery RTL.
const FAILSAFE_STATEMENTS = [
  ['SIYI as the only failsafe (no "link" qualifier)', s => /\bonly\b/i.test(s) && /SIYI|GCS loss/.test(s) && /fail ?safe|fails safe|trigger/i.test(s) && !/\blink\b/i.test(s)],
  ['RTL in any / every mode without QRTL', s => /\bRTLs?\b/.test(s) && /\b(any|every|all) modes?\b/i.test(s) && !/QRTL/.test(s)],
  ['failsafe list with the critical but not the low battery', s => /\bonly\b/i.test(s) && /(battery critical|critical battery|BATT_CRT)/i.test(s) && /(fail ?safe|trigger|action)/i.test(s) && !/\b(low|BATT_LOW)/i.test(s)]
];
const sentences = text => text.split('\n').flatMap(l => l.split(/(?<!\b(?:incl|e\.g|i\.e|approx|vs)\.)(?<=[.!?])\s+(?=[A-Z(])/));

test('R3 / rework F1: no pre-Rev C failsafe statement (SIYI as the only failsafe, RTL in every mode, no low-battery RTL)', () => {
  const hits = [];
  for (const f of FILES) {
    sentences(plain(readText(f))).forEach(s => { for (const [d, fn] of FAILSAFE_STATEMENTS) if (fn(s)) hits.push(f + ' [' + d + '] ' + s.trim().slice(0, 160)); });
  }
  assert.deepEqual(hits, []);
});

test('rework F1: the statement checks catch the old wording and pass the Rev C wording', () => {
  const OLD = ['On this carrier only SIYI / GCS loss (RTL after 5 s) and battery critical trigger an action.',
    'Can explain: only SIYI / GCS loss triggers a carrier failsafe (RTL after 5 s, any mode); losing the 915 MHz backup is expected.',
    'Each one stops the GCS heartbeat → RTL after FS_LONG_TIMEOUT (5 s), in every mode.',
    'The carrier fails safe only on SIYI / GCS loss.', 'Carrier failsafe: SIYI / GCS loss only.'];
  for (const s of OLD) assert.ok(sentences(s).some(x => FAILSAFE_STATEMENTS.some(([, fn]) => fn(x))), 'not caught: ' + s);
  const NEW = ['The only link failsafe is SIYI / GCS loss (after 5 s in any mode: RTL in fixed-wing modes, QRTL in VTOL modes).',
    'The SIYI HM30 link is the only link whose loss triggers a carrier failsafe: RTL in fixed-wing modes, QRTL in VTOL modes.',
    'Battery failsafes: low 22.0V → automatic RTL; critical 21.0V → QLand at the current position.', 'Link failsafe: SIYI / GCS loss only.'];
  for (const s of NEW) assert.ok(!sentences(s).some(x => FAILSAFE_STATEMENTS.some(([, fn]) => fn(x))), 'false positive: ' + s);
});

// "NAME = value", "NAME value" and table cells "<code>NAME</code></td><td>value" for every parameter of the reference.
test('R3: every parameter value written in the pages, content, scripts and diagrams equals the reference param file', () => {
  const bad = [];
  for (const f of FILES.concat(['docs/reference/README.md'])) {
    const t = plain(readText(f));
    for (const m of t.matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b[\s`*]*(?:=|:)?\s*[`*]*\s*(-?\d+(?:\.\d+)?)(?![\d.]*\s?(?:kbit|MHz|dBm|°C|km\b))/g)) {
      const [, name, v] = m;
      if (!Object.prototype.hasOwnProperty.call(REF, name)) continue;
      if (Math.abs(REF[name] - Number(v)) > 1e-6) bad.push(f + ': ' + name + ' ' + v + ' (reference ' + REF[name] + ') … ' + t.slice(Math.max(0, m.index - 30), m.index + 70).replace(/\s+/g, ' '));
    }
  }
  assert.deepEqual(bad, []);
});
