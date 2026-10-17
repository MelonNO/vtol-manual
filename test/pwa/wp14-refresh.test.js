'use strict';
// WP14 rework round 2 — F8: an in-session store change (param-file import / clear through the real UI handlers) refreshes
// every safety surface at once, without a reload: header, failsafe banner, emergency modal (= kneeboard and
// emergency-only content), checklists, battery analysis. Same for the manual. F9: a disabled failsafe never shows a bare
// "auto RTL" phrase. jsdom test: skipped unless VTOL_JSDOM (or a local jsdom) is available, like the WP09 style check.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readText } = require('../repo-files.js');
const { loadJsdom } = require('./computed-style.js');

const BASE = 'https://melonno.github.io/vtol-manual/';
const GCS_STUB = "self.GcsClient = { BASE: 'http://127.0.0.1:47800', start() {}, stop() {}, isConnected() { return false; } };";
// The page with every local <script src> inlined (jsdom loads no files here), the GCS client stubbed.
function pageHtml(page) {
  return readText(page).replace(/<script src="([^"]+)"><\/script>/g, (m, src) =>
    '<script>' + (src === 'js/gcs-client.js' ? GCS_STUB : readText(src).replace(/<\/script/gi, '<\\/script')) + '</script>');
}
function open(JSDOM, page, storage) {
  const errors = [];
  const dom = new JSDOM(pageHtml(page), { url: BASE + page, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {}; w.print = () => {};
      w.matchMedia = () => ({ matches: false, addListener() {}, addEventListener() {} });
      w.addEventListener('error', e => errors.push(String(e.message)));
      Object.keys(storage || {}).forEach(k => w.localStorage.setItem(k, storage[k]));
    } });
  return { w: dom.window, d: dom.window.document, errors };
}
const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const until = async (fn, ms) => { const end = Date.now() + (ms || 3000); while (!fn()) { if (Date.now() > end) return false; await new Promise(r => setTimeout(r, 20)); } return true; };

test('F8: Tools — importing sample.param through the PARAMS tab UI refreshes header, banner, emergency cards, checklists and analysis at once; CLEAR restores them', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path to run this check'); return; }
  const S = require('../../js/store.js'), st = S.defaults();
  st.battLog = [{ id: 'a', packId: st.packs[0].id, date: '2026-10-10', flight: '1', start: 25.1, min: 22.6, rest: 23.4, time: '', notes: '', sag: 2.5, source: 'manual' }];
  const { w, d, errors } = open(JSDOM, 'index.html', { vtol_store: JSON.stringify(st), vtol_active_tab: 'battlog' });
  const card = () => txt(d.getElementById('emerg-batt'));
  // before: reference values
  assert.equal(txt(d.getElementById('hdr-low')), '22.0V auto RTL');
  assert.equal(txt(d.getElementById('hdr-crit')), '21.0V QLand here');
  assert.ok(d.getElementById('fs-alert').hidden);
  assert.match(card(), /22\.0V → AUTO RTL \(FAILSAFE\)/);
  w.renderBattLog();
  // the real UI: choose the file in #pf-file, click IMPORT (paramImport) — no render function is called by the test
  const input = d.getElementById('pf-file');
  Object.defineProperty(input, 'files', { value: [new w.File([readText('test/fixtures/sample.param')], 'sample.param')] });
  d.querySelector('button[onclick="paramImport()"]').click();
  assert.ok(await until(() => /parameters imported/.test(txt(d.getElementById('pf-status')))), 'import finished');
  assert.equal(txt(d.getElementById('hdr-low')), 'DISABLED in sample.param (BATT_LOW_VOLT = 0)');
  assert.equal(txt(d.getElementById('hdr-crit')), '22.2V QLand here');
  assert.equal(d.getElementById('fs-alert').hidden, false);
  assert.match(txt(d.getElementById('fs-alert')), /LOW-BATTERY FAILSAFE DISABLED in imported file sample\.param \(BATT_LOW_VOLT = 0\) — differs from reference 22\.0 V/);
  assert.match(card(), /LOW-BATT FAILSAFE DISABLED — NO AUTO RTL/);
  assert.match(card(), /22\.2V → AUTO QLAND HERE/);
  assert.doesNotMatch(card(), /AUTO RTL \(FAILSAFE\)|21\.0V → AUTO QLAND/);
  assert.match(txt(d.getElementById('det-site-home-lz-flight')), /LOW-BATTERY FAILSAFE DISABLED in sample\.param/, 'checklists rebuilt');
  assert.match(txt(d.getElementById('bl-analysis')), /BATT_LOW_VOLT DISABLED in sample\.param/, 'battery analysis');
  assert.match(txt(d.getElementById('emerg-list')), /LOW-BATTERY FAILSAFE DISABLED/, 'modal / kneeboard list (design intent)');
  // CLEAR PARAM FILE through its button (confirm stubbed true)
  d.querySelector('button[onclick="paramClear()"]').click();
  assert.equal(txt(d.getElementById('hdr-low')), '22.0V auto RTL');
  assert.equal(txt(d.getElementById('hdr-crit')), '21.0V QLand here');
  assert.ok(d.getElementById('fs-alert').hidden);
  assert.match(card(), /22\.0V → AUTO RTL \(FAILSAFE\)/);
  assert.match(card(), /21\.0V → AUTO QLAND HERE/);
  assert.doesNotMatch(txt(d.getElementById('bl-analysis')), /DISABLED/);
  // a settings edit through its input refreshes the cards too (same central path)
  const crt = d.getElementById('pset-crt'); crt.value = '21.2'; crt.dispatchEvent(new w.Event('change'));
  assert.match(card(), /21\.2V → AUTO QLAND HERE/);
  assert.deepEqual(errors, []);
  w.close();
});

test('F8 / F9: manual — a store write in the same tab re-renders it; a disabled failsafe phrase never says "auto RTL"', async t => {
  const JSDOM = loadJsdom();
  if (!JSDOM) { t.skip('jsdom not available — set VTOL_JSDOM to the jsdom package path to run this check'); return; }
  const { w, d, errors } = open(JSDOM, 'manual.html');
  const meta = () => txt(d.querySelector('.hdr-meta'));
  assert.match(meta(), /LOW VOLT 22\.0V auto RTL/);
  w.VtolStore.update(s => { s.paramFile = { name: 'sample.param', importedAt: '2026-10-17T10:00:00.000Z', params: { BATT_LOW_VOLT: 0, BATT_CRT_VOLT: 22.2 } }; });
  assert.match(meta(), /LOW VOLT LOW-BATT FAILSAFE: DISABLED \(sample\.param; reference 22\.0V auto RTL\)/);
  assert.match(meta(), /CRIT VOLT 22\.2V QLand here/);
  assert.equal(d.getElementById('man-fs-alert').hidden, false);
  // no phrase anywhere presents the disabled failsafe as active: every "auto RTL" next to it is inside the DISABLED text
  const body = d.body.cloneNode(true); body.querySelectorAll('script,style').forEach(x => x.remove());
  const all = txt(body);
  assert.doesNotMatch(all, /22\.0 ?V[^.;]{0,40}automatic RTL|\[reference — DISABLED/);
  assert.match(txt(d.getElementById('tab-flightmodes')), /LOW-BATT FAILSAFE: DISABLED \(sample\.param; reference 22\.0V auto RTL\)/);
  // cleared → the original phrases come back
  w.VtolStore.update(s => { delete s.paramFile; });
  assert.match(meta(), /LOW VOLT 22\.0V auto RTL/);
  assert.match(txt(d.getElementById('tab-flightmodes')), /At 22\.0V \(BATT_LOW_VOLT, 10 s below\) the carrier starts an automatic RTL/);
  assert.deepEqual(errors, []);
  w.close();
});
