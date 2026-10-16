// Shared browser data store (contract C1) — global VtolStore in the browser, module.exports in Node.
// One versioned JSON object in localStorage['vtol_store'], shared by every page on this origin.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolStore = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const KEY = 'vtol_store';
  const SCHEMA_VERSION = 2;
  const TOMBSTONE_MS = 30 * 86400000;                 // keep deleted-record markers for 30 days
  const COLLECTIONS = ['archive', 'weatherFavorites', 'battLog', 'packs', 'clients', 'links'];
  const LEGACY_KEYS = ['vtol_battlog', 'vtol_pf_archive', 'vtol_wx_fav', 'vtol_batt_type'];
  const GIST_KEYS = ['vtol_gh_pat', 'vtol_gh_gist_id', 'vtol_last_sync'];   // Gist sync removed (plan Q11)

  const ID = {
    carrierPack: 'pack-carrier-6s-7000',
    mastPack: 'pack-mast-6s-3000',
    clientPack: 'pack-client-ref-6s-1300',
    refClient: 'client-ref-1',
    videoLink: 'link-client-video-58',
    rcLink: 'link-elrs-rc',
    gcsLink: 'link-siyi-hm30'
  };

  // ── storage access (injectable for Node tests) ──
  let storageOverride = null;
  function storage() {
    if (storageOverride) return storageOverride;
    try { return root && root.localStorage ? root.localStorage : null; } catch (e) { return null; }
  }
  function getItem(k) { try { const s = storage(); return s ? s.getItem(k) : null; } catch (e) { return null; } }
  function setItem(k, v) { const s = storage(); if (!s) throw new Error('localStorage unavailable'); s.setItem(k, v); }
  function removeItem(k) { try { const s = storage(); if (s) s.removeItem(k); } catch (e) { /* ignore */ } }
  function readJSON(k) { try { const t = getItem(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

  function uid() {
    let rnd = '';
    try {
      const a = new Uint32Array(2);
      root.crypto.getRandomValues(a);
      rnd = a[0].toString(36) + a[1].toString(36);
    } catch (e) {
      rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return Date.now().toString(36) + '-' + rnd.slice(0, 8);
  }

  // Deterministic id for legacy records (no id): importing the same old data twice must not duplicate it.
  function hashId(prefix, str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return prefix + '-' + h.toString(36);
  }

  function defaults() {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      archive: [],
      weatherFavorites: [],
      battLog: [],
      packs: [
        { id: ID.carrierPack, label: 'Carrier 6S 7000', role: 'carrier', cells: 6, chem: 'lipo', capacityMah: 7000, cycles: 0, purchased: '', notes: '' },
        { id: ID.mastPack, label: 'Mast 6S 3000', role: 'mast', cells: 6, chem: 'lipo', capacityMah: 3000, cycles: 0, purchased: '', notes: '' },
        { id: ID.clientPack, label: 'Ref client 6S 1300', role: 'client', cells: 6, chem: 'lipo', capacityMah: 1300, cycles: 0, purchased: '', notes: '' }
      ],
      clients: [{
        id: ID.refClient, name: 'Reference client #1',
        sizeIn: 7,                                   // manual: 7"+ quad
        fc: 'Matek F405 STD (clone)', firmware: 'Betaflight 4.5.2',
        vtx: { band: 'R', channel: 5, freqMHz: 5806, powerMw: 25 },
        videoStandard: null,
        elrs: { band: '2.4', packetRateHz: null, modelId: null, telemetryRatio: null, geminiRx: false },
        failsafe: { type: 'gps_rescue', minSats: 8, delayS: 2.5 },
        packId: ID.clientPack, notes: ''
      }],
      links: [
        { id: ID.videoLink, name: 'Client video 5.8 GHz', kind: 'video', freqMHz: 5800, txPowerDbm: 14.0, txGainDbi: 2.0, rxGainDbi: 10.0,
          rxSensDbm: -85, marginDb: 6, antenna: 'dual_patch', notes: '' },
        { id: ID.rcLink, name: 'ELRS RC (set me)', kind: 'rc', freqMHz: 2440, txPowerDbm: null, txGainDbi: null, rxGainDbi: null,
          rxSensDbm: null, marginDb: 6, antenna: 'dipole', notes: '' },
        { id: ID.gcsLink, name: 'SIYI HM30 (set me)', kind: 'gcs', freqMHz: null, txPowerDbm: null, txGainDbi: null, rxGainDbi: null,
          rxSensDbm: null, marginDb: 6, antenna: null, notes: null }
      ],
      settings: {
        activeClientId: ID.refClient,
        activeCarrierPackId: ID.carrierPack,
        battCrtVolt: 22.2, manualRtlVolt: 23.0, hardLimitVolt: 22.5,
        storageVoltPerCell: 3.80,
        checklistExpiryHours: 6,
        // settings.updatedAt (ISO) is added when the user edits a setting; used for import merging.
        // Extension (WP01, R19): weather wind limits, m/s. GO ≤ windGoMaxMs < CAUTION ≤ windCautionMaxMs < NO-GO; gust > gustMaxMs = NO-GO.
        windGoMaxMs: 5, windCautionMaxMs: 8, gustMaxMs: 10
      }
    };
  }

  // Fill missing parts so consumers can rely on the shape; drop expired tombstones.
  function normalize(s, nowMs) {
    const d = defaults();
    const out = (s && typeof s === 'object') ? s : {};
    out.schemaVersion = SCHEMA_VERSION;
    if (typeof out.updatedAt !== 'string') out.updatedAt = d.updatedAt;
    const cutoff = (nowMs || Date.now()) - TOMBSTONE_MS;
    COLLECTIONS.forEach(c => {
      if (!Array.isArray(out[c])) out[c] = d[c];
      out[c] = out[c].filter(r => r && typeof r === 'object' && r.id != null &&
        !(r.deleted && Date.parse(r.updatedAt || 0) < cutoff));
    });
    out.settings = Object.assign({}, d.settings, out.settings && typeof out.settings === 'object' ? out.settings : {});
    return out;
  }

  function legacyBattEntry(e, packId) {
    const r = Object.assign({}, e);
    r.id = r.id || hashId('bl', JSON.stringify([e.date, e.flight, e.start, e.min, e.rest, e.time, e.notes]));
    r.packId = r.packId || packId;
    r.source = r.source || 'manual';
    return r;
  }
  function legacyArchiveEntry(e) {
    return Object.assign({}, e, { id: e.id || hashId('arc', String(e.date)) });
  }
  function legacyFavorite(f) {
    return Object.assign({}, f, { id: f.id || hashId('fav', f.lat + ',' + f.lon) });
  }

  // Build a store from the pre-v2 localStorage keys.
  function migrateLegacy() {
    const s = defaults();
    const carrier = s.packs.find(p => p.id === ID.carrierPack);
    const bt = readJSON('vtol_batt_type');
    if (bt && typeof bt === 'object') {
      if (Number.isInteger(+bt.cells) && +bt.cells > 0) carrier.cells = +bt.cells;
      if (['lipo', 'liion', 'life'].includes(bt.chem)) carrier.chem = bt.chem;
    }
    const bl = readJSON('vtol_battlog');
    if (Array.isArray(bl)) s.battLog = bl.filter(e => e && typeof e === 'object').map(e => legacyBattEntry(e, ID.carrierPack));
    const ar = readJSON('vtol_pf_archive');
    if (Array.isArray(ar)) s.archive = ar.filter(e => e && typeof e === 'object').map(legacyArchiveEntry);
    const fav = readJSON('vtol_wx_fav');
    if (Array.isArray(fav)) s.weatherFavorites = fav.filter(f => f && typeof f === 'object').map(legacyFavorite);
    return s;
  }

  function fire(store) {
    try {
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('vtol-store-changed', { detail: store }));
      }
    } catch (e) { /* no event target (Node) */ }
  }

  // Persist; returns true on success (false e.g. on quota errors or when storage is unavailable).
  function save(store) {
    store.schemaVersion = SCHEMA_VERSION;
    store.updatedAt = new Date().toISOString();
    try { setItem(KEY, JSON.stringify(store)); } catch (e) { return false; }
    fire(store);
    return true;
  }

  function load() {
    GIST_KEYS.forEach(removeItem);
    const raw = getItem(KEY);
    if (raw) {
      try { return normalize(JSON.parse(raw)); }
      catch (e) {
        // Corrupt store: keep a copy for manual recovery, continue with defaults.
        try { setItem(KEY + '_corrupt_' + Date.now(), raw); } catch (_) { /* ignore */ }
        return defaults();
      }
    }
    let s;
    try { s = normalize(migrateLegacy()); } catch (e) { return defaults(); }
    if (save(s)) LEGACY_KEYS.forEach(removeItem);   // legacy keys go only after a successful save
    return s;
  }

  function update(fn) {
    const s = load();
    fn(s);
    save(s);
    return s;
  }

  // ── record helpers ──
  function live(list) { return (list || []).filter(r => r && !r.deleted); }
  function find(store, coll, id) { return live(store[coll]).find(r => r.id === id) || null; }
  function upsert(store, coll, rec) {
    rec.id = rec.id || uid();
    rec.updatedAt = new Date().toISOString();
    const list = store[coll], i = list.findIndex(r => r.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    return rec;
  }
  function remove(store, coll, id) {
    const list = store[coll], i = list.findIndex(r => r.id === id);
    const tomb = { id, deleted: true, updatedAt: new Date().toISOString() };
    if (i >= 0) list[i] = tomb; else list.push(tomb);
  }

  // ── merge ──
  // Records are matched by id. The newer updatedAt wins (missing = oldest); on a tie the local record stays.
  // Records missing from the incoming side are never removed. A tombstone only wins when it is newer.
  function mergeLists(local, incoming, stats) {
    const out = local.slice();
    const index = new Map(out.map((r, i) => [r.id, i]));
    incoming.forEach(r => {
      if (!r || typeof r !== 'object' || r.id == null) return;
      if (!index.has(r.id)) {
        index.set(r.id, out.length); out.push(r);
        if (!r.deleted) stats.added++;
        return;
      }
      const i = index.get(r.id), cur = out[i];
      if ((r.updatedAt || '') > (cur.updatedAt || '')) {
        out[i] = r;
        if (r.deleted && !cur.deleted) stats.deleted++; else stats.updated++;
      }
    });
    return out;
  }

  // Bring an imported object (v2 store or legacy {archive, weatherFavorites, battLog?}) to store shape.
  function coerceIncoming(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Not a VTOL data file');
    const inc = {};
    const arr = k => Array.isArray(obj[k]) ? obj[k].filter(r => r && typeof r === 'object') : [];
    inc.archive = arr('archive').map(legacyArchiveEntry);
    inc.weatherFavorites = arr('weatherFavorites').map(legacyFavorite);
    inc.battLog = arr('battLog').map(e => legacyBattEntry(e, ID.carrierPack));
    ['packs', 'clients', 'links'].forEach(k => { inc[k] = arr(k).filter(r => r.id != null); });
    inc.settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : null;
    inc.updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
    return inc;
  }

  function mergeStores(local, incomingObj) {
    const inc = coerceIncoming(incomingObj);
    const stats = { added: 0, updated: 0, deleted: 0 };
    COLLECTIONS.forEach(c => { local[c] = mergeLists(local[c], inc[c], stats); });
    // Settings are one record: settings.updatedAt is set when a user edits them (never in defaults()).
    // Incoming settings win when edited more recently than the local ones (a file without that stamp counts as of its own updatedAt).
    if (inc.settings) {
      const incAt = inc.settings.updatedAt || inc.updatedAt, localAt = (local.settings && local.settings.updatedAt) || '';
      if (incAt > localAt) local.settings = Object.assign({}, local.settings, inc.settings, { updatedAt: incAt });
    }
    return { store: normalize(local), stats };
  }

  function exportJSON() { return JSON.stringify(load(), null, 2); }

  // Merge a JSON string into the stored data (never replaces local records wholesale). Throws on invalid JSON.
  function importJSON(str, opts) {
    const obj = JSON.parse(str);
    const res = mergeStores(load(), obj);
    save(res.store);
    importJSON.lastStats = res.stats;
    return res.store;
  }

  return {
    KEY, SCHEMA_VERSION, IDS: ID,
    load, save, update, uid, defaults, exportJSON, importJSON,
    live, find, upsert, remove, mergeStores,
    _setStorage(s) { storageOverride = s; }
  };
});
