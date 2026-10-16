'use strict';
// WP06 R10 (MAN-12) / R12: hash deep links, tab resolution, dropdown scroll rule and the search helper.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadManualCore } = require('./helpers.js');

const MC = loadManualCore();

test('tab list: unique ids, relay and clients present, fpv is an alias of clients', () => {
  assert.equal(new Set(MC.TAB_IDS).size, MC.TAB_IDS.length);
  for (const t of ['overview', 'aircraft', 'flightmodes', 'relay', 'clients', 'procedures', 'mission', 'callouts', 'missionplan', 'crew', 'maintenance', 'comms', 'prearm', 'abbrev', 'emergency']) {
    assert.ok(MC.TAB_IDS.includes(t), t);
  }
  assert.ok(!MC.TAB_IDS.includes('fpv'), 'old FPV tab is gone');
  assert.equal(MC.resolveTab('fpv'), 'clients');
  assert.equal(MC.resolveTab('FPV'), 'clients');
  assert.equal(MC.resolveTab('relay'), 'relay');
  assert.equal(MC.resolveTab('nope'), null);
  assert.equal(MC.resolveTab(''), null);
  assert.equal(MC.resolveTab(null), null);
  assert.equal(MC.resolveTab('constructor'), null);
  assert.equal(MC.resolveTab('__proto__'), null);
});

test('parseHash: #tab and #tab/anchor', () => {
  assert.deepEqual(MC.parseHash('#relay'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('relay'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('#emergency/emerg-gcs'), { tab: 'emergency', anchor: 'emerg-gcs' });
  assert.deepEqual(MC.parseHash('#relay/relay-ports'), { tab: 'relay', anchor: 'relay-ports' });
  assert.deepEqual(MC.parseHash('#fpv'), { tab: 'clients', anchor: null });
  assert.deepEqual(MC.parseHash('#fpv/ref-client'), { tab: 'clients', anchor: 'ref-client' });
  assert.deepEqual(MC.parseHash('#Comms'), { tab: 'comms', anchor: null });
  assert.deepEqual(MC.parseHash('#relay%2Frelay-ports'), { tab: 'relay', anchor: 'relay-ports' });
});

test('parseHash: invalid or unsafe input', () => {
  for (const h of ['', '#', null, undefined, '#nonsense', '#/relay', '#%E0%A4%A', '#tab-relay', '#relay-ports']) assert.equal(MC.parseHash(h), null, String(h));
  // A bad anchor keeps the tab but drops the anchor (it is used with getElementById only, still never trusted).
  assert.deepEqual(MC.parseHash('#relay/<img src=x>'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('#relay/a b'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('#relay/1abc'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('#relay/'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.parseHash('#relay/' + 'a'.repeat(200)), { tab: 'relay', anchor: null });
});

test('hashFor round-trips with parseHash', () => {
  assert.equal(MC.hashFor('relay'), '#relay');
  assert.equal(MC.hashFor('emergency', 'emerg-app'), '#emergency/emerg-app');
  assert.equal(MC.hashFor('fpv'), '#clients');
  assert.equal(MC.hashFor('bogus'), '#overview');
  assert.equal(MC.hashFor('relay', 'bad anchor'), '#relay');
  for (const t of MC.TAB_IDS) assert.deepEqual(MC.parseHash(MC.hashFor(t, 'x-1')), { tab: t, anchor: 'x-1' });
});

test('initialTab: hash beats the stored last tab, which beats the default', () => {
  assert.deepEqual(MC.initialTab('#procedures/power-up', 'relay'), { tab: 'procedures', anchor: 'power-up' });
  assert.deepEqual(MC.initialTab('', 'relay'), { tab: 'relay', anchor: null });
  assert.deepEqual(MC.initialTab('#junk', 'maintenance'), { tab: 'maintenance', anchor: null });
  assert.deepEqual(MC.initialTab('', 'fpv'), { tab: 'clients', anchor: null });
  assert.deepEqual(MC.initialTab('', null), { tab: 'overview', anchor: null });
  assert.deepEqual(MC.initialTab('', 'garbage'), { tab: 'overview', anchor: null });
});

test('dropdown closes only after a scroll of more than 40 px', () => {
  assert.equal(MC.dropdownShouldClose(100, 100), false);
  assert.equal(MC.dropdownShouldClose(100, 140), false);
  assert.equal(MC.dropdownShouldClose(100, 141), true);
  assert.equal(MC.dropdownShouldClose(100, 59), true);
  assert.equal(MC.dropdownShouldClose(100, 75), false);
  assert.equal(MC.dropdownShouldClose(0, 10, 5), true);
});

test('search finds a term inside a non-active tab and locates it exactly', () => {
  // Entries as the page builds them: every text node of every tab panel, active or not.
  const entries = [
    { tab: 'overview', section: 'Aircraft & Mission', text: 'The Heewing T2 Cruza is a fixed-wing tilt-rotor VTOL.' },
    { tab: 'relay', section: 'Switch Ports P1–P5', text: 'Microchip KSZ8795 5-port Ethernet switch · WIZnet W5500' },
    { tab: 'emergency', section: null, text: 'Restart the MP UDPCI connection.' }
  ];
  const hits = MC.search(entries, 'ksz8795');
  assert.equal(hits.length, 1);
  const h = hits[0];
  assert.equal(h.tab, 'relay');
  assert.equal(h.index, 1);
  assert.equal(h.section, 'Switch Ports P1–P5');
  assert.equal(entries[1].text.substr(h.start, h.length), 'KSZ8795', 'start/length point at the original-case match');
  assert.equal(h.match, 'KSZ8795');
  assert.equal(h.before + h.match + h.after, entries[1].text);
  const e = MC.search(entries, '  UDPCI ');
  assert.equal(e[0].tab, 'emergency');
  assert.equal(e[0].section, null);
});

test('search: empty query, limit, duplicates, snippets', () => {
  assert.deepEqual(MC.search([{ tab: 'a', text: 'x' }], ''), []);
  assert.deepEqual(MC.search([{ tab: 'a', text: 'x' }], '   '), []);
  assert.deepEqual(MC.search(null, 'x'), []);
  const many = Array.from({ length: 40 }, (_, i) => ({ tab: 'comms', section: 'S' + i, text: 'HM30 link ' + i }));
  assert.equal(MC.search(many, 'hm30').length, 25, 'default limit 25');
  assert.equal(MC.search(many, 'hm30', 3).length, 3);
  const dup = [{ tab: 'comms', section: 'A', text: 'same text' }, { tab: 'comms', section: 'A', text: 'same text' }, { tab: 'relay', section: 'A', text: 'same text' }];
  assert.equal(MC.search(dup, 'same').length, 2, 'identical snippet in the same section listed once');
  const long = 'a'.repeat(100) + 'NEEDLE' + 'b'.repeat(200);
  const s = MC.search([{ tab: 'abbrev', text: long }], 'needle')[0];
  assert.ok(s.before.startsWith('…') && s.before.length === 56 && s.after.endsWith('…') && s.after.length === 96);
  assert.equal(s.start, 100);
  // Regex characters are literal.
  assert.equal(MC.search([{ tab: 'abbrev', text: 'BT.656 (8 lines)' }], '(8')[0].match, '(8');
  assert.equal(MC.search([{ tab: 'abbrev', text: 'BT0656' }], 'BT.656').length, 0);
});

test('tab labels for search results', () => {
  assert.equal(MC.tabLabel('relay'), 'Relay Electronics');
  assert.equal(MC.tabLabel('clients'), 'Client Drones');
  assert.equal(MC.tabLabel('x'), 'x');
});
