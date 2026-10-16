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
  // Extension (WP11): flights (flight records) and maintenance (mark-done records) are collections like the others.
  const COLLECTIONS = ['archive', 'weatherFavorites', 'battLog', 'packs', 'clients', 'links', 'flights', 'maintenance'];
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
      },
      // Extension (WP11, R4/R5): flight records and maintenance mark-done records. The optional key paramFile
      // ({name, importedAt, params: {NAME: number}}) is absent until a .param file is imported.
      flights: [],
      maintenance: []
    };
  }

  // ── validation ──
  // Stored and imported data is untrusted (other devices, hand-edited files): numbers must be numbers and enums
  // must be known values before any page renders them. Bad records are dropped, bad settings fall back to the
  // default; every such repair is reported through takeIssues() so the page can show it.
  const ENUM = {
    role: ['carrier', 'mast', 'client'], chem: ['lipo', 'liion', 'life'], source: ['manual', 'tlog', 'bin', 'gcs']
  };
  const NUM_SETTINGS = ['battCrtVolt', 'manualRtlVolt', 'hardLimitVolt', 'storageVoltPerCell', 'checklistExpiryHours',
    'windGoMaxMs', 'windCautionMaxMs', 'gustMaxMs'];
  let pendingIssues = [];

  const num = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN;
  const str = v => (v === null || v === undefined) ? '' : String(v);
  const short = v => { const t = str(typeof v === 'object' ? JSON.stringify(v) : v); return t.length > 40 ? t.slice(0, 40) + '…' : t; };

  // mode 'load' (data already on this device): a default profile with a bad field is repaired from the default.
  // mode 'import' (incoming file, or a form): any invalid record is dropped, so it can never reset a valid local
  // record — not even for the default profile ids (WP01 verification round 2, finding 1).
  function cleanPack(r, issues, mode) {
    const def = mode === 'import' ? null : defaults().packs.find(p => p.id === r.id);
    const out = Object.assign({}, r, { id: str(r.id), label: str(r.label || r.id) });
    const bad = [];
    const cells = num(r.cells);
    if (Number.isInteger(cells) && cells >= 1 && cells <= 24) out.cells = cells; else bad.push('cells');
    if (ENUM.chem.includes(r.chem)) out.chem = r.chem; else bad.push('chem');
    if (ENUM.role.includes(r.role)) out.role = r.role; else bad.push('role');
    const given = v => !(v === null || v === undefined || v === '');
    const cap = num(r.capacityMah), capOk = isFinite(cap) && cap > 0;
    const cyc = num(r.cycles), cycOk = Number.isInteger(cyc) && cyc >= 0;
    out.capacityMah = capOk ? cap : null;       // empty = unknown (TBD)
    out.cycles = cycOk ? cyc : 0;
    // On load a bad optional value is coerced (as before); on import / in a form it is an error like any other.
    if (mode === 'import' && given(r.capacityMah) && !capOk) bad.push('capacityMah');
    if (mode === 'import' && given(r.cycles) && !cycOk) bad.push('cycles');
    out.purchased = str(r.purchased); out.notes = str(r.notes);
    if (!bad.length) return out;
    if (!def) { issues.push(`Pack "${short(out.label)}" dropped: invalid ${bad.join(', ')}`); return null; }
    bad.forEach(k => { out[k] = def[k]; });
    issues.push(`Pack "${short(out.label)}": invalid ${bad.join(', ')} — reset to the default profile value`);
    return out;
  }

  // Client and link profiles (C1.3). [path, type, options]; null / '' = unknown (TBD) unless required.
  // Ranges are plausibility bounds against garbage, not operating limits.
  const FIELDS = {
    clients: [
      ['name', 'text', { required: true }],
      ['sizeIn', 'num', { min: 0.5, max: 100 }],
      ['fc', 'text'], ['firmware', 'text'],
      ['vtx.band', 'text'],
      ['vtx.channel', 'int', { min: 1, max: 99 }],
      ['vtx.freqMHz', 'num', { min: 1, max: 100000 }],
      ['vtx.powerMw', 'num', { min: 0.01, max: 100000 }],
      ['videoStandard', 'enum', { values: ['PAL', 'NTSC'] }],
      ['elrs.band', 'enum', { values: ['868', '915', '2.4', 'gemini'] }],
      ['elrs.packetRateHz', 'num', { min: 1, max: 10000 }],
      ['elrs.modelId', 'int', { min: 0, max: 255 }],
      ['elrs.telemetryRatio', 'int', { min: 0, max: 1024 }],    // 1:N; 0 = off
      ['elrs.geminiRx', 'bool'],
      ['failsafe.type', 'enum', { values: ['gps_rescue', 'land', 'drop'] }],
      ['failsafe.minSats', 'int', { min: 0, max: 64 }],
      ['failsafe.delayS', 'num', { min: 0, max: 600 }],
      ['packId', 'ref'],
      ['notes', 'text']
    ],
    links: [
      ['name', 'text', { required: true }],
      ['kind', 'enum', { values: ['video', 'rc', 'gcs'], required: true }],
      ['freqMHz', 'num', { min: 1, max: 100000 }],
      ['txPowerDbm', 'num', { min: -60, max: 60 }],
      ['txGainDbi', 'num', { min: -30, max: 60 }],
      ['rxGainDbi', 'num', { min: -30, max: 60 }],
      ['rxSensDbm', 'num', { min: -200, max: 0 }],
      ['marginDb', 'num', { min: 0, max: 100 }],
      ['antenna', 'enum', { values: ['dual_patch', 'omni', 'dipole'] }],
      ['notes', 'text']
    ]
  };
  const getPath = (o, p) => p.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), o);
  function setPath(o, p, val) {
    const ks = p.split('.'), last = ks.pop();
    ks.forEach(k => { o[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) ? Object.assign({}, o[k]) : {}; o = o[k]; });
    o[last] = val;
  }
  // One field value → { ok, v } (v = the coerced value).
  function cleanField(type, opt, raw) {
    opt = opt || {};
    const empty = raw === null || raw === undefined || raw === '';
    if (type === 'text') {
      if (empty) return { ok: !opt.required, v: '' };
      if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false };
      const t = String(raw);
      return { ok: !opt.required || t.trim() !== '', v: t };
    }
    if (type === 'bool') {
      if (empty) return { ok: true, v: false };
      if (raw === true || raw === 'true') return { ok: true, v: true };
      if (raw === false || raw === 'false') return { ok: true, v: false };
      return { ok: false };
    }
    if (empty) return { ok: !opt.required, v: null };
    if (type === 'num' || type === 'int') {
      const v = num(raw);
      const ok = isFinite(v) && (type === 'num' || Number.isInteger(v)) && (opt.min === undefined || v >= opt.min) && (opt.max === undefined || v <= opt.max);
      return ok ? { ok, v } : { ok: false };
    }
    if (type === 'enum') {
      const v = typeof raw === 'number' ? String(raw) : raw;
      return opt.values.includes(v) ? { ok: true, v } : { ok: false };
    }
    if (type === 'ref') return typeof raw === 'string' ? { ok: true, v: raw } : { ok: false };
    return { ok: false };
  }
  const FALLBACK = { text: '', bool: false };
  // Same modes as cleanPack. On load a non-default profile keeps its record with the bad optional field set to
  // unknown (TBD); a bad required field (name, kind) drops it.
  function cleanProfile(coll, label, r, issues, mode) {
    const def = mode === 'import' ? null : defaults()[coll].find(p => p.id === r.id);
    const out = Object.assign({}, r, { id: str(r.id) });
    const bad = [];
    let badRequired = false;
    FIELDS[coll].forEach(([path, type, opt]) => {
      const res = cleanField(type, opt, getPath(r, path));
      if (res.ok) { setPath(out, path, res.v); return; }
      bad.push(path);
      if (opt && opt.required) badRequired = true;
      setPath(out, path, def ? getPath(def, path) : (type in FALLBACK ? FALLBACK[type] : null));
    });
    if (!bad.length) return out;
    const name = short(r.name || r.id);
    if (mode === 'import' || (badRequired && !def)) { issues.push(`${label} "${name}" dropped: invalid ${bad.join(', ')}`); return null; }
    issues.push(`${label} "${name}": invalid ${bad.join(', ')} — ${def ? 'reset to the default profile value' : 'set to TBD'}`);
    return out;
  }
  function cleanBatt(r, issues) {
    const out = Object.assign({}, r, { id: str(r.id) });
    for (const k of ['start', 'min', 'rest']) {
      const v = num(r[k]);
      if (!isFinite(v)) { issues.push(`Battery entry ${short(r.date)} dropped: invalid ${k} (${short(r[k])})`); return null; }
      out[k] = v;
    }
    const sag = num(r.sag); out.sag = isFinite(sag) ? sag : +(out.start - out.min).toFixed(2);
    if ('usedMah' in r) { const u = num(r.usedMah); out.usedMah = isFinite(u) && u >= 0 ? u : null; }   // optional (WP11: entries from GCS telemetry)
    out.packId = str(r.packId || ID.carrierPack);
    out.source = ENUM.source.includes(r.source) ? r.source : 'manual';
    ['date', 'flight', 'time', 'notes'].forEach(k => { out[k] = str(r[k]); });
    return out;
  }
  function cleanArchive(r) {
    const ms = num(r.durationMs);
    return Object.assign({}, r, { id: str(r.id), date: str(r.date), duration: str(r.duration), durationMs: isFinite(ms) ? ms : null,
      status: str(r.status), notes: str(r.notes) });
  }
  function cleanFavorite(r, issues) {
    const lat = num(r.lat), lon = num(r.lon);
    if (!(isFinite(lat) && Math.abs(lat) <= 90 && isFinite(lon) && Math.abs(lon) <= 180)) {
      issues.push(`Saved location "${short(r.name)}" dropped: invalid coordinates`); return null;
    }
    return Object.assign({}, r, { id: str(r.id), lat, lon, name: str(r.name) });
  }
  // ── WP11 extensions: flight records, maintenance records, param file ──
  // Summaries are display data: flat objects of short strings / finite numbers / booleans / null, nested one level.
  function cleanSummary(s, depth) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const out = {};
    Object.keys(s).slice(0, 40).forEach(k => {
      const v = s[k];
      if (v === null || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'number') out[k] = isFinite(v) ? v : null;
      else if (typeof v === 'string') out[k] = v.slice(0, 200);
      else if (!depth && typeof v === 'object' && !Array.isArray(v)) out[k] = cleanSummary(v, 1);
    });
    return out;
  }
  function cleanFlight(r) {
    return Object.assign({}, r, { id: str(r.id), date: str(r.date), label: str(r.label), notes: str(r.notes), archiveId: str(r.archiveId),
      battIds: Array.isArray(r.battIds) ? r.battIds.filter(x => typeof x === 'string').slice(0, 20) : [],
      logSummary: cleanSummary(r.logSummary), gcsSummary: cleanSummary(r.gcsSummary) });
  }
  function cleanMaint(r, issues) {
    if (typeof r.taskId !== 'string' || !r.taskId || !/^\d{4}-\d{2}-\d{2}$/.test(str(r.doneDate))) {
      issues.push(`Maintenance record ${short(r.taskId)} dropped: invalid task or date`); return null;
    }
    return Object.assign({}, r, { id: str(r.id), taskId: r.taskId, doneDate: str(r.doneDate), markedAt: str(r.markedAt), notes: str(r.notes) });
  }
  const PARAM_NAME = /^[A-Z][A-Z0-9_]{0,15}$/;
  // store.paramFile → valid copy, or null. A bad name or a non-number makes the whole record invalid.
  function cleanParamFile(pf) {
    if (!pf || typeof pf !== 'object' || Array.isArray(pf) || typeof pf.name !== 'string' || !isFinite(Date.parse(pf.importedAt))) return null;
    if (!pf.params || typeof pf.params !== 'object' || Array.isArray(pf.params)) return null;
    const params = {};
    for (const k of Object.keys(pf.params)) {
      const v = pf.params[k];
      if (!PARAM_NAME.test(k) || typeof v !== 'number' || !isFinite(v)) return null;
      params[k] = v;
    }
    return { name: pf.name.slice(0, 200), importedAt: String(pf.importedAt), params };
  }

  const CLEAN = { packs: cleanPack, flights: cleanFlight, maintenance: cleanMaint, battLog: cleanBatt, archive: cleanArchive, weatherFavorites: cleanFavorite,
    clients: (r, issues, mode) => cleanProfile('clients', 'Client', r, issues, mode),
    links: (r, issues, mode) => cleanProfile('links', 'Link', r, issues, mode) };

  // mode: 'load' (repair, default) or 'import' (drop invalid records).
  function cleanRecord(coll, r, issues, mode) {
    if (!r || typeof r !== 'object' || r.id == null || r.id === '') return null;
    if (r.deleted) return { id: str(r.id), deleted: true, updatedAt: str(r.updatedAt) };
    const out = CLEAN[coll](r, issues, mode || 'load');
    if (out && r.updatedAt != null) out.updatedAt = str(r.updatedAt);
    return out;
  }

  // Validate one record from a form, as strictly as an import. → { record (null when invalid), issues: [text] }
  function validateRecord(coll, rec) {
    const issues = [];
    if (!CLEAN[coll] || !rec || typeof rec !== 'object') return { record: null, issues: ['invalid record'] };
    const record = cleanRecord(coll, Object.assign({}, rec, { id: rec.id || 'new' }), issues, 'import');
    return { record, issues };
  }

  // Settings object → valid settings. base: values to fall back to (local settings, or defaults).
  function cleanSettings(s, base, issues) {
    const out = Object.assign({}, base, s && typeof s === 'object' ? s : {});
    NUM_SETTINGS.forEach(k => {
      const v = num(out[k]);
      if (isFinite(v) && v > 0) out[k] = v;
      else { issues.push(`Setting ${k} was invalid (${short(out[k])}) — kept ${base[k]}`); out[k] = base[k]; }
    });
    ['activeClientId', 'activeCarrierPackId'].forEach(k => { if (typeof out[k] !== 'string') out[k] = base[k]; });
    if (typeof out.updatedAt !== 'string') delete out.updatedAt;
    return out;
  }

  // Fill missing parts, validate every record and setting, drop expired tombstones. Repairs go to `issues`.
  function normalize(s, nowMs, issues) {
    issues = issues || [];
    const d = defaults();
    const out = (s && typeof s === 'object') ? s : {};
    out.schemaVersion = SCHEMA_VERSION;
    if (typeof out.updatedAt !== 'string') out.updatedAt = d.updatedAt;
    const cutoff = (nowMs || Date.now()) - TOMBSTONE_MS;
    COLLECTIONS.forEach(c => {
      if (!Array.isArray(out[c])) out[c] = d[c];
      out[c] = out[c].map(r => cleanRecord(c, r, issues))
        .filter(r => r && !(r.deleted && Date.parse(r.updatedAt || 0) < cutoff));
    });
    out.settings = cleanSettings(out.settings, d.settings, issues);
    if (out.paramFile !== undefined && out.paramFile !== null) {
      const pf = cleanParamFile(out.paramFile);
      if (!pf) issues.push('Parameter file record was invalid — removed (import the .param file again)');
      out.paramFile = pf;
    }
    if (out.paramFile === null) delete out.paramFile;
    return out;
  }

  // Repairs made since the last call (load-time or import-time), for a visible notice. Clears the list.
  function takeIssues() { const t = pendingIssues; pendingIssues = []; return t; }

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
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) {
        // Corrupt store: keep a copy for manual recovery, continue with defaults.
        try { setItem(KEY + '_corrupt_' + Date.now(), raw); } catch (_) { /* ignore */ }
        pendingIssues.push('Stored data was unreadable — started from defaults (a copy was kept under ' + KEY + '_corrupt_*)');
        return defaults();
      }
      const issues = [];
      const s = normalize(parsed, Date.now(), issues);
      if (issues.length) { pendingIssues.push(...issues); save(s); }   // persist the repair once
      return s;
    }
    let s;
    try { s = normalize(migrateLegacy(), Date.now(), pendingIssues); } catch (e) { return defaults(); }
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
  // Invalid records are rejected here, before they can overwrite a valid local copy.
  function coerceIncoming(obj, issues) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Not a VTOL data file');
    const inc = {};
    const arr = k => Array.isArray(obj[k]) ? obj[k].filter(r => r && typeof r === 'object') : [];
    inc.archive = arr('archive').map(legacyArchiveEntry);
    inc.weatherFavorites = arr('weatherFavorites').map(legacyFavorite);
    inc.battLog = arr('battLog').map(e => legacyBattEntry(e, ID.carrierPack));
    ['packs', 'clients', 'links', 'flights', 'maintenance'].forEach(k => { inc[k] = arr(k); });
    COLLECTIONS.forEach(c => { inc[c] = inc[c].map(r => cleanRecord(c, r, issues, 'import')).filter(Boolean); });
    inc.settings = obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings) ? obj.settings : null;
    inc.paramFile = null;
    if (obj.paramFile !== undefined && obj.paramFile !== null) {
      inc.paramFile = cleanParamFile(obj.paramFile);
      if (!inc.paramFile) issues.push('Parameter file record in the import was invalid — ignored');
    }
    return inc;
  }

  function mergeStores(local, incomingObj) {
    const issues = [];
    const inc = coerceIncoming(incomingObj, issues);
    const stats = { added: 0, updated: 0, deleted: 0, settings: false, issues };   // + paramFile: true when taken (WP11)
    COLLECTIONS.forEach(c => { local[c] = mergeLists(local[c], inc[c], stats); });
    // Settings are one record, stamped with settings.updatedAt only when a user edits them (never in defaults()).
    // Incoming settings replace local ones only when they carry a stamp newer than the local stamp: settings that
    // were never edited on the other device never overwrite edited local thresholds. Invalid values keep the local value.
    if (inc.settings && typeof inc.settings.updatedAt === 'string' && inc.settings.updatedAt > ((local.settings && local.settings.updatedAt) || '')) {
      local.settings = cleanSettings(inc.settings, local.settings, issues);
      stats.settings = true;
    }
    // The param file is one record: the incoming one wins only when it was imported later (WP11 extension).
    if (inc.paramFile && inc.paramFile.importedAt > ((local.paramFile && local.paramFile.importedAt) || '')) {
      local.paramFile = inc.paramFile;
      stats.paramFile = true;
    }
    return { store: normalize(local, Date.now(), issues), stats };
  }

  function exportJSON() { return JSON.stringify(load(), null, 2); }

  // Merge a JSON string into the stored data (never replaces local records wholesale). Throws on invalid JSON.
  // opts {merge:true} per C1 — merging is the only mode. Counts and rejected records of the last import:
  // importJSON.lastStats {added, updated, deleted, settings, issues}. Throws when the merged store cannot be saved.
  function importJSON(text, opts) {
    const obj = JSON.parse(text);
    const res = mergeStores(load(), obj);
    importJSON.lastStats = res.stats;
    if (!save(res.store)) throw new Error('the merged data could not be saved (browser storage full or blocked) — nothing was imported');
    return res.store;
  }

  return {
    KEY, SCHEMA_VERSION, IDS: ID,
    load, save, update, uid, defaults, exportJSON, importJSON,
    live, find, upsert, remove, mergeStores, takeIssues, validateRecord, FIELDS,
    _setStorage(s) { storageOverride = s; }
  };
});
