// Flight Tools pure logic — global ToolsCore in the browser, module.exports in Node (tests in test/tools/).
// No DOM access here. Colour choice stays in the page: functions return a level ('ok'|'warn'|'crit', 'go'|'caution'|'nogo').
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ToolsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad2 = n => String(n).padStart(2, '0');

  // Local calendar date 'YYYY-MM-DD' of an epoch-ms time (browser time zone, not UTC).
  function localDateStr(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // 'HH:MM' of an instant at a fixed UTC offset (seconds), e.g. Open-Meteo utc_offset_seconds.
  function fmtHMAtOffset(date, offsetSec) {
    const d = new Date(date.getTime() + offsetSec * 1000);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }

  // ══════════════ BATTERY ══════════════
  // Per-cell chemistry limits (V). low = longevity floor, critical = hard floor.
  const BATT_CHEM = {
    lipo:  { full: 4.20, nominal: 3.70, low: 3.35, critical: 3.10, name: 'LiPo' },
    liion: { full: 4.20, nominal: 3.60, low: 3.20, critical: 2.90, name: 'Li-Ion' },
    life:  { full: 3.65, nominal: 3.30, low: 3.00, critical: 2.70, name: 'LiFe' }
  };
  const RETURN_MARGIN_V = 0.8;   // BATT_LOW_VOLT = avg landing voltage + this return margin

  function chemOf(pack) { return BATT_CHEM[pack && pack.chem] || BATT_CHEM.lipo; }

  // Pack thresholds. Carrier operational thresholds (settings) apply only to role 'carrier'.
  // The storage target uses settings.storageVoltPerCell, which is a LiPo figure: null (TBD) for other chemistries.
  function packThresholds(pack, settings) {
    const cells = pack.cells, chem = chemOf(pack), carrier = pack.role === 'carrier';
    return {
      cells, chem, carrier,
      fullV: chem.full * cells, lowV: chem.low * cells, critV: chem.critical * cells,
      storageV: pack.chem === 'lipo' ? settings.storageVoltPerCell * cells : null,
      crtV: carrier ? settings.battCrtVolt : null,
      rtlV: carrier ? settings.manualRtlVolt : null,
      hardV: carrier ? settings.hardLimitVolt : null
    };
  }

  // Plausible pack-voltage window for log parsing (sag below the hard floor, slight overcharge above full).
  function voltRange(pack) {
    const chem = chemOf(pack);
    return { minV: chem.critical * pack.cells * 0.85, maxV: chem.full * pack.cells * 1.05 };
  }

  function battStats(entries) {
    if (!entries || !entries.length) return null;
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const mins = entries.map(e => +e.min), sags = entries.map(e => +e.sag), starts = entries.map(e => +e.start);
    return {
      n: entries.length,
      avgStart: avg(starts), avgMin: avg(mins), lowestMin: Math.min(...mins),
      avgSag: avg(sags), worstSag: Math.max(...sags)
    };
  }

  // Recommended BATT_LOW_VOLT for a carrier pack: avg landing + return margin, never below the manual RTL
  // voltage. The margin is measured to BATT_CRT_VOLT (the ArduPilot critical failsafe), not to the chemistry floor.
  // Returns null for non-carrier packs (no ArduPilot recommendation).
  function recommendBattLow(entries, pack, settings) {
    if (pack.role !== 'carrier') return null;
    const st = battStats(entries);
    if (!st) return null;
    const raw = st.avgMin + RETURN_MARGIN_V;
    const recV = Math.max(raw, settings.manualRtlVolt);
    return {
      recV, perCellV: recV / pack.cells,
      crtV: settings.battCrtVolt, marginToCrtV: recV - settings.battCrtVolt,
      rtlFloorV: settings.manualRtlVolt, flooredByRtl: raw < settings.manualRtlVolt,
      chemFloorV: chemOf(pack).critical * pack.cells,
      avgMin: st.avgMin
    };
  }

  const LEVEL_RANK = { ok: 0, warn: 1, crit: 2 };
  const worst = (a, b) => LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;

  // Landing (min) voltage classification. Per-cell chemistry for every pack; carrier packs also use hardLimitVolt / manualRtlVolt.
  function minVoltLevel(v, pack, settings) {
    const chem = chemOf(pack), pc = v / pack.cells;
    let lvl = pc < chem.critical + 0.05 ? 'crit' : pc < chem.low + 0.10 ? 'warn' : 'ok';
    if (pack.role === 'carrier') {
      lvl = worst(lvl, v < settings.hardLimitVolt ? 'crit' : v < settings.manualRtlVolt ? 'warn' : 'ok');
    }
    return lvl;
  }

  function sagLevel(sag, cells) {
    return sag > cells * 0.35 ? 'crit' : sag > cells * 0.2 ? 'warn' : 'ok';
  }

  function healthClass(avgMin, pack) {
    const chem = chemOf(pack), pc = avgMin / pack.cells;
    if (pc < chem.critical + 0.05) return { level: 'crit', text: 'CRITICAL — Landing voltage is deep in the SEI damage zone. This pack is being harmed. Inspect and consider retirement.' };
    if (pc < chem.low + 0.05) return { level: 'crit', text: 'LOW — Landing voltage is below the longevity floor. Repeated use here accelerates capacity loss and IR rise.' };
    if (pc < chem.low + 0.10) return { level: 'warn', text: 'MARGINAL — Landing voltage is in the lower end of the acceptable range. Monitor for capacity fade.' };
    return { level: 'ok', text: 'HEALTHY — Landing voltages are within normal range for this chemistry.' };
  }

  // ══════════════ MAVLINK .TLOG ══════════════
  // A .tlog is a sequence of records: 8-byte big-endian µs Unix timestamp + one MAVLink v1/v2 frame.
  const MAV_STX_V1 = 0xFE, MAV_STX_V2 = 0xFD;
  const MAV_IFLAG_SIGNED = 0x01, MAV_SIGNATURE_LEN = 13;
  const MAV_TYPE_GCS = 6, MAV_AUTOPILOT_INVALID = 8, MAV_MODE_FLAG_SAFETY_ARMED = 0x80;
  const MSG_HEARTBEAT = 0, MSG_SYS_STATUS = 1, MSG_BATTERY_STATUS = 147;

  function tlogTsMs(buf, pos) {
    if (pos < 0 || pos + 8 > buf.length) return null;
    const hi = ((buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]) >>> 0;
    const lo = ((buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7]) >>> 0;
    const ms = (hi * 4294967296 + lo) / 1000;
    const y = new Date(ms).getUTCFullYear();
    return (y >= 2015 && y <= 2040) ? ms : null;
  }

  // Frame header at p → {msgid, sysid, payloadOff, paylen, frameLen, signed} or null when it does not fit.
  function mavFrame(buf, p) {
    if (p + 1 >= buf.length) return null;
    const paylen = buf[p + 1];
    let f;
    if (buf[p] === MAV_STX_V1) {
      if (p + 6 > buf.length) return null;
      f = { msgid: buf[p + 5], sysid: buf[p + 3], payloadOff: p + 6, paylen, frameLen: 8 + paylen, signed: false };
    } else if (buf[p] === MAV_STX_V2) {
      if (p + 10 > buf.length) return null;
      const signed = (buf[p + 2] & MAV_IFLAG_SIGNED) !== 0;
      f = { msgid: buf[p + 7] | (buf[p + 8] << 8) | (buf[p + 9] << 16), sysid: buf[p + 5], payloadOff: p + 10, paylen,
            frameLen: 12 + paylen + (signed ? MAV_SIGNATURE_LEN : 0), signed };
    } else return null;
    return p + f.frameLen <= buf.length ? f : null;
  }

  // MAVLink 2 truncates trailing zero bytes: read missing payload bytes as 0.
  function pByte(buf, f, off) { return off < f.paylen ? buf[f.payloadOff + off] : 0; }
  function pU16(buf, f, off) { return pByte(buf, f, off) | (pByte(buf, f, off + 1) << 8); }

  // Extract battery voltages and flight time. opts: {minV, maxV} plausible pack range (see voltRange).
  // Duration = armed time (vehicle HEARTBEAT base_mode bit 0x80) when the log contains it, else first→last timestamp.
  function parseTlog(buf, opts) {
    const minMv = opts.minV * 1000, maxMv = opts.maxV * 1000;
    const volts = [];
    let firstTs = null, lastTs = null, frames = 0, signedFrames = 0;
    let sawArmed = false, armedSince = null, armedMs = 0;
    let pos = 0;
    while (pos + 9 < buf.length) {
      const stx = buf[pos + 8];
      const ts = (stx === MAV_STX_V1 || stx === MAV_STX_V2) ? tlogTsMs(buf, pos) : null;
      const f = ts !== null ? mavFrame(buf, pos + 8) : null;
      if (!f) { pos++; continue; }
      frames++;
      if (f.signed) signedFrames++;
      if (firstTs === null) firstTs = ts;
      lastTs = ts;
      if (f.msgid === MSG_HEARTBEAT) {
        const type = pByte(buf, f, 4), autopilot = pByte(buf, f, 5), baseMode = pByte(buf, f, 6);
        if (type !== MAV_TYPE_GCS && autopilot !== MAV_AUTOPILOT_INVALID) {
          const armed = (baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0;
          if (armed && armedSince === null) { armedSince = ts; sawArmed = true; }
          else if (!armed && armedSince !== null) { armedMs += ts - armedSince; armedSince = null; }
        }
      } else if (f.msgid === MSG_SYS_STATUS) {
        const mV = pU16(buf, f, 14);                               // voltage_battery
        if (mV > 0 && mV < 65535 && mV >= minMv && mV <= maxMv) volts.push(mV);
      } else if (f.msgid === MSG_BATTERY_STATUS && pByte(buf, f, 32) === 0) {   // battery id 0 only
        const mV = pU16(buf, f, 10);                               // voltages[0]
        if (mV > 0 && mV < 65535 && mV >= minMv && mV <= maxMv) volts.push(mV);
      }
      pos += 8 + f.frameLen;
    }
    if (armedSince !== null && lastTs !== null) armedMs += lastTs - armedSince;
    if (volts.length < 2) return null;

    let durationMin, durationSource;
    if (sawArmed && armedMs > 0) { durationMin = armedMs / 60000; durationSource = 'armed'; }
    else if (firstTs !== null && lastTs > firstTs) { durationMin = (lastTs - firstTs) / 60000; durationSource = 'log'; }
    else { durationMin = volts.length / 60; durationSource = 'samples'; }

    return {
      startV: volts[0] / 1000, minV: Math.min(...volts) / 1000, endV: volts[volts.length - 1] / 1000,
      durationMin, durationSource,
      date: localDateStr(firstTs !== null ? firstTs : Date.now()),
      frames, signedFrames
    };
  }

  // ══════════════ ARDUPILOT .BIN (DataFlash) ══════════════
  const BIN_SZ = { a: 64, b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, f: 4, d: 8, n: 4, N: 16, Z: 64, c: 2, C: 2, e: 4, E: 4, L: 4, M: 1, q: 8, Q: 8 };
  const GPS_EPOCH_UNIX_MS = 315964800000;   // 1980-01-06T00:00:00Z
  // GPS time runs ahead of UTC by the accumulated leap seconds: 18 s since 2017-01-01 (IERS Bulletin C).
  // Update if a new leap second is announced.
  const GPS_UTC_LEAP_SECONDS = 18;

  function gpsToUnixMs(week, weekMs) {
    return GPS_EPOCH_UNIX_MS + week * 604800000 + (weekMs || 0) - GPS_UTC_LEAP_SECONDS * 1000;
  }

  function binStr(buf, off, max) {
    let s = '';
    for (let k = 0; k < max && off + k < buf.length; k++) { const c = buf[off + k]; if (!c) break; s += String.fromCharCode(c); }
    return s;
  }

  function binRecord(payload, fmtStr, labels) {
    const rec = {}, view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let o = 0;
    for (let k = 0; k < fmtStr.length && o < payload.byteLength; k++) {
      const fc = fmtStr[k], lbl = labels[k] || ('f' + k), sz = BIN_SZ[fc] || 1;
      if (o + sz > payload.byteLength) break;
      let v = null;
      switch (fc) {
        case 'b': v = view.getInt8(o); break;
        case 'B': case 'M': v = view.getUint8(o); break;
        case 'h': v = view.getInt16(o, true); break;
        case 'H': v = view.getUint16(o, true); break;
        case 'c': v = view.getInt16(o, true) / 100; break;
        case 'C': v = view.getUint16(o, true) / 100; break;
        case 'i': v = view.getInt32(o, true); break;
        case 'I': v = view.getUint32(o, true); break;
        case 'e': v = view.getInt32(o, true) / 100; break;
        case 'E': v = view.getUint32(o, true) / 100; break;
        case 'L': v = view.getInt32(o, true) * 1e-7; break;
        case 'f': v = view.getFloat32(o, true); break;
        case 'd': v = view.getFloat64(o, true); break;
        case 'q': case 'Q': { const lo = view.getUint32(o, true), hi = view.getUint32(o + 4, true); v = hi * 4294967296 + lo; break; }
        case 'n': v = binStr(payload, o, 4); break;
        case 'N': v = binStr(payload, o, 16); break;
        case 'Z': v = binStr(payload, o, 64); break;
      }
      rec[lbl] = v; o += sz;
    }
    return rec;
  }

  function parseBin(buf) {
    const H1 = 0xA3, H2 = 0x95, FMT = 0x80;
    const fmts = {};
    const bat = { t: [], v: [], c: [], ct: [] };
    const cur = { t: [], a: [] };                    // current with its own timestamps (bat.c has none)
    const gps = { t: [], alt: [], sats: [], hdop: [], spd: [], lat: [], lng: [], gwk: [], gms: [] };
    const pos = { t: [], relHome: [], alt: [] };    // POS.RelHomeAlt = EKF altitude relative to home (not AGL)
    const arsp = { t: [], v: [] };
    const modes = [], msgs = [];
    let firstT = 0, lastT = 0, i = 0;

    while (i < buf.length - 2) {
      if (buf[i] !== H1 || buf[i + 1] !== H2) { i++; continue; }
      const type = buf[i + 2];
      if (type === FMT) {
        if (i + 89 > buf.length) { i++; continue; }
        fmts[buf[i + 3]] = { name: binStr(buf, i + 5, 4).trim(), len: buf[i + 4], fmt: binStr(buf, i + 9, 16),
          labels: binStr(buf, i + 25, 64).split(',').map(s => s.trim()) };
        i += 89;
        continue;
      }
      const fmt = fmts[type];
      if (!fmt || fmt.len < 3 || i + fmt.len > buf.length) { i++; continue; }
      const p = buf.subarray(i + 3, i + fmt.len);
      const n = fmt.name.toUpperCase();
      if (n === 'BAT' || n === 'BATT') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const inst = r.Inst != null ? r.Inst : r.Instance;
        if ((inst == null || inst === 0) && r.Volt > 3 && r.Volt < 60) {      // first battery monitor only
          const t = r.TimeUS || 0;
          if (!firstT) firstT = t; lastT = Math.max(lastT, t);
          bat.t.push(t); bat.v.push(r.Volt);
          if (r.Curr != null) { bat.c.push(r.Curr); cur.t.push(t); cur.a.push(r.Curr); }
          if (r.CurrTot != null) bat.ct.push(r.CurrTot);
        }
      } else if (n === 'GPS' || n === 'GPS2') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0;
        if (t > 0 && r.NSats != null) {
          if (!firstT) firstT = t; lastT = Math.max(lastT, t);
          gps.t.push(t); gps.sats.push(r.NSats); gps.hdop.push(r.HDop || 99);
          gps.alt.push(r.Alt != null ? r.Alt : null);
          gps.spd.push(r.Spd != null ? r.Spd : null);
          gps.lat.push(r.Lat != null ? r.Lat : null);
          gps.lng.push(r.Lng != null ? r.Lng : null);
          if (r.GWk > 100) { gps.gwk.push(r.GWk); gps.gms.push(r.GMS || 0); }
        }
      } else if (n === 'POS') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0;
        if (t > 0 && r.RelHomeAlt != null && isFinite(r.RelHomeAlt)) {
          pos.t.push(t); pos.relHome.push(r.RelHomeAlt);
          if (r.Alt != null) pos.alt.push(r.Alt);
        }
      } else if (n === 'ARSP' || n === 'ASPD') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0, v = r.Airspeed != null ? r.Airspeed : r.Aspd;
        if (t > 0 && v != null && v >= 0 && v < 120) { arsp.t.push(t); arsp.v.push(v); }
      } else if (n === 'MODE') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0, m = r.Mode != null ? r.Mode : r.ModeNum;
        if (t > 0 && m != null) modes.push(r.Rsn != null ? { t, mode: m, reason: r.Rsn } : { t, mode: m });   // Rsn = ModeReason (newer logs)
      } else if (n === 'MSG') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0, txt = r.Message || r.Msg || '';
        if (txt.trim().length > 1) msgs.push({ t, text: txt.trim() });
      }
      i += fmt.len;
    }
    if (!firstT) firstT = bat.t[0] || gps.t[0] || 0;
    if (!lastT) lastT = bat.t[bat.t.length - 1] || gps.t[gps.t.length - 1] || 0;
    return { bat, cur, gps, pos, arsp, modes, msgs, firstT, lastT };
  }

  // Wall-clock start (Unix ms, UTC) from the first valid GPS week/ms, or null.
  function binStartUnixMs(d) {
    const idx = d.gps.gwk.findIndex(w => w > 100);
    return idx < 0 ? null : gpsToUnixMs(d.gps.gwk[idx], d.gps.gms[idx]);
  }

  // Battery samples inside the plausible window of the pack: {v, t}.
  function binBatterySeries(d, pack) {
    const r = voltRange(pack), v = [], t = [];
    d.bat.v.forEach((x, k) => { if (x > r.minV && x < r.maxV) { v.push(x); t.push(d.bat.t[k]); } });
    return { v, t };
  }

  // Chart x positions (0..1) for a series of µs timestamps; spread by index when all timestamps are equal.
  function chartXFractions(times) {
    const n = times.length, span = n ? times[n - 1] - times[0] : 0;
    if (n < 2) return times.map(() => 0);
    if (!(span > 0)) return times.map((_, i) => i / (n - 1));
    return times.map(t => (t - times[0]) / span);
  }

  // ══════════════ WEATHER ══════════════
  // Open-Meteo 'current.time' is 15-minute aligned (…T18:15) while hourly times are …T18:00, both local
  // ISO strings in the location's time zone. Floor to the hour; fall back to the last hour <= current.
  function hourlyIndex(times, currentTime) {
    if (!Array.isArray(times) || !times.length || typeof currentTime !== 'string') return 0;
    const hour = currentTime.slice(0, 13) + ':00';
    const exact = times.indexOf(hour);
    if (exact >= 0) return exact;
    let best = 0;
    for (let i = 0; i < times.length; i++) { if (times[i] <= currentTime) best = i; else break; }
    return best;
  }

  const WMO = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',
    51:'Light drizzle',53:'Moderate drizzle',55:'Dense drizzle',56:'Light freezing drizzle',57:'Heavy freezing drizzle',
    61:'Slight rain',63:'Moderate rain',65:'Heavy rain',66:'Light freezing rain',67:'Heavy freezing rain',
    71:'Slight snow',73:'Moderate snow',75:'Heavy snow',77:'Snow grains',
    80:'Slight showers',81:'Moderate showers',82:'Violent showers',85:'Slight snow showers',86:'Heavy snow showers',
    95:'Thunderstorm',96:'Thunderstorm + hail',99:'Thunderstorm + heavy hail'};
  function skyDesc(code) { return WMO[code] || 'Unknown'; }

  const DIRS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compass(deg) { return DIRS[((Math.round(deg / 22.5) % 16) + 16) % 16]; }

  // limits: settings {windGoMaxMs, windCautionMaxMs, gustMaxMs}. Gust may be null (not available aloft).
  function windStatus(w, g, limits) {
    if (w > limits.windCautionMaxMs || (g != null && g > limits.gustMaxMs)) return { s: 'NO-GO', level: 'nogo' };
    if (w > limits.windGoMaxMs) return { s: 'CAUTION', level: 'caution' };
    return { s: 'GO', level: 'go' };
  }

  function precipStatus(code, mm) {
    if (code >= 95) return { s: 'NO-GO', label: 'Thunderstorm', level: 'nogo' };
    if (code >= 85) return { s: 'NO-GO', label: 'Snow showers', level: 'nogo' };
    if (code >= 71) return { s: 'NO-GO', label: 'Snow', level: 'nogo' };
    if (code === 66 || code === 67) return { s: 'NO-GO', label: 'Freezing rain', level: 'nogo' };
    if (code === 82 || code >= 63 || mm > 4) return { s: 'NO-GO', label: skyDesc(code), level: 'nogo' };
    if (code >= 51 || mm > 0) return { s: 'CAUTION', label: skyDesc(code), level: 'caution' };
    return { s: 'GO', label: 'None', level: 'go' };
  }

  // Icing risk label: NIL / LOW / MOD / HIGH ('--' when no temperature).
  function icingStatus(t, rh) {
    if (t === null || t === undefined) return { label: '--', level: 'none' };
    if (t > 2 || t < -25) return { label: 'NIL', level: 'go' };
    const r = rh || 0;
    if (t >= -2 && t <= 2 && r >= 80) return { label: 'HIGH', level: 'nogo' };
    if (t >= -10 && t < -2 && r >= 80) return { label: 'MOD', level: 'caution' };
    if (r >= 60) return { label: 'LOW', level: 'caution' };
    return { label: 'NIL', level: 'go' };
  }

  const RELAY_WIND_HEIGHTS_M = [80, 120, 180];
  // Wind aloft rows from Open-Meteo hourly wind_speed_XXm / wind_direction_XXm at index idx. No gusts aloft.
  function relayWindRows(hourly, idx, limits) {
    return RELAY_WIND_HEIGHTS_M.map(hm => {
      const sp = hourly && hourly['wind_speed_' + hm + 'm'], dr = hourly && hourly['wind_direction_' + hm + 'm'];
      const speed = sp && sp[idx] != null ? sp[idx] : null, dir = dr && dr[idx] != null ? dr[idx] : null;
      return { heightM: hm, speed, dir, status: speed == null ? null : windStatus(speed, null, limits) };
    });
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // ══════════════ SUN TIMES ══════════════
  /*
   Subset of SunCalc (https://github.com/mourner/suncalc), adapted.
   Copyright (c) 2014, Vladimir Agafonkin. All rights reserved.
   Redistribution and use in source and binary forms, with or without modification, are permitted provided
   that the following conditions are met:
   1. Redistributions of source code must retain the above copyright notice, this list of conditions and the
      following disclaimer.
   2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
      following disclaimer in the documentation and/or other materials provided with the distribution.
   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
   WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
   PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY
   DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
   OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   (SunCalc is BSD-2-Clause licensed.)
  */
  const SC = (function () {
    const PI = Math.PI, sin = Math.sin, cos = Math.cos, asin = Math.asin, acos = Math.acos;
    const rad = PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
    const e = rad * 23.4397;                                            // obliquity of the Earth
    const toJulian = date => date.valueOf() / dayMs - 0.5 + J1970;
    const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
    const toDays = date => toJulian(date) - J2000;
    const declination = (l, b) => asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
    const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
    function eclipticLongitude(M) {
      const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));   // equation of center
      const P = rad * 102.9372;                                                    // perihelion of the Earth
      return M + C + P + PI;
    }
    const julianCycle = (d, lw) => Math.round(d - J0 - lw / (2 * PI));
    const approxTransit = (Ht, lw, n) => J0 + (Ht + lw) / (2 * PI) + n;
    const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    const cosHourAngle = (h, phi, d) => (sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d));

    // Rise/set pair for the solar altitude angleDeg on the solar day nearest to `date`.
    // Returns Dates, or 'never_rises' / 'never_sets' when the sun stays below / above that altitude all day.
    function riseSet(date, lat, lng, angleDeg) {
      const lw = rad * -lng, phi = rad * lat, d = toDays(date);
      const n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
      const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0);
      const Jnoon = solarTransitJ(ds, M, L);
      const x = cosHourAngle(angleDeg * rad, phi, dec);
      if (x > 1) return { rise: 'never_rises', set: 'never_rises' };
      if (x < -1) return { rise: 'never_sets', set: 'never_sets' };
      const Jset = solarTransitJ(approxTransit(acos(x), lw, n), M, L);
      return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
    }
    return { riseSet };
  })();

  // {civilDawn, sunrise, sunset, civilDusk}: Date or 'never_rises' / 'never_sets'.
  function sunTimes(date, lat, lon) {
    const sun = SC.riseSet(date, lat, lon, -0.833), civil = SC.riseSet(date, lat, lon, -6);
    return { civilDawn: civil.rise, sunrise: sun.rise, sunset: sun.set, civilDusk: civil.set };
  }

  // ══════════════ CHECKLIST STATE ══════════════
  // State: { session: {id, startedAt ISO, migrated?}, items: { [itemId]: {checked:true, ts: ISO|null} } }
  function clNew(nowMs, id) {
    return { session: { id, startedAt: new Date(nowMs).toISOString() }, items: {} };
  }

  function clNormalize(raw) {
    if (!raw || typeof raw !== 'object' || !raw.session || typeof raw.items !== 'object' || !raw.items) return null;
    const items = {};
    Object.keys(raw.items).forEach(k => {
      const it = raw.items[k];
      if (it && it.checked) items[k] = { checked: true, ts: typeof it.ts === 'string' ? it.ts : null };
    });
    return { session: Object.assign({}, raw.session), items };
  }

  function clCheckedCount(state) { return Object.keys(state.items).length; }

  // Expired = has ticks and the session started more than `hours` ago (or has no valid start time).
  function clIsExpired(state, nowMs, hours) {
    if (!clCheckedCount(state)) return false;
    const t = Date.parse(state.session && state.session.startedAt);
    if (!isFinite(t)) return true;
    return nowMs - t > hours * 3600000;
  }

  // Tick or untick. The first tick of an empty checklist starts a new session.
  function clToggle(state, itemId, checked, nowMs, newSessionId) {
    if (checked) {
      if (!clCheckedCount(state)) state.session = { id: newSessionId, startedAt: new Date(nowMs).toISOString() };
      state.items[itemId] = { checked: true, ts: new Date(nowMs).toISOString() };
    } else {
      delete state.items[itemId];
    }
    return state;
  }

  // ══════════════ CHALLENGE–RESPONSE MODE ══════════════
  // Flat, ordered item list of a checklist (VtolContent list) for the one-item-at-a-time mode.
  function crItems(list) {
    const out = [];
    list.sections.forEach(sec => sec.items.forEach(it => out.push({ id: it.id, secId: sec.id, secName: sec.name, s: it.s || it.t || '', t: it.s ? (it.t || '') : '', w: !!it.w })));
    return out;
  }
  // Index of the first unchecked item at or after `from` (no wrap), or -1.
  function crNextOpen(items, state, from) {
    for (let i = Math.max(0, from || 0); i < items.length; i++) if (!(state.items && state.items[items[i].id])) return i;
    return -1;
  }
  // Content markup ([[…]], `…`, **…**) → plain words for speech synthesis.
  function speechText(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  // ══════════════ PARAMETER FILE (plan §10.1 A-3) ══════════════
  // Expected values = the values the manual and the plan rely on. Sources per row; never edit a value without one.
  // TODO(content): move EXPECTED_PARAMS into VtolContent (data/content.js) — WP05 left no `expectedParams` slot and
  // data/content.js was being changed by WP06 in parallel, so the table lives here for now (WP11).
  const PARAM_SRC_FS = 'plan §13.1 / §6.1.5; data/content.js failsafe params';
  const PARAM_SRC_MAN = 'manual.html Aircraft tab';
  const PARAM_SRC_NOTES = 'ai/PROJECT_CONTEXT.txt (project param notes; the manual gives only the switch positions)';
  const EXPECTED_PARAMS = [
    { name: 'THR_FAILSAFE', value: 2, meaning: '2 = EnabledNoFailsafe: RC loss ignored, no failsafe action (by design, plan §1.1)', source: PARAM_SRC_FS },
    { name: 'FS_GCS_ENABL', value: 2, meaning: '2 = Heartbeat and REMRSSI: SIYI / GCS loss → failsafe in all modes', source: PARAM_SRC_FS },
    { name: 'FS_LONG_TIMEOUT', value: 5, unit: 's', meaning: 'GCS heartbeat loss → failsafe after 5 s', source: PARAM_SRC_FS },
    { name: 'FS_LONG_ACTN', value: 1, meaning: '1 = ReturnToLaunch', source: PARAM_SRC_FS },
    { name: 'BATT_CRT_VOLT', value: 22.2, unit: 'V', meaning: 'critical battery failsafe voltage (pack)', source: PARAM_SRC_FS + '; ' + PARAM_SRC_MAN },
    { name: 'BATT_FS_CRT_ACT', value: 6, meaning: 'documented as Loiter → QLand at the current position (not re-verified, plan §13.1)', source: PARAM_SRC_FS },
    { name: 'BATT_LOW_VOLT', value: 0, unit: 'V', meaning: '0 = not set: no automatic low-battery warning (manual RTL at 23.0 V)', source: PARAM_SRC_MAN + '; plan §6.1.5' },
    { name: 'RTL_ALTITUDE', value: 120, unit: 'm', meaning: 'RTL target altitude above home', source: 'plan §13.1; ' + PARAM_SRC_MAN },
    { name: 'Q_RTL_ALT', value: 70, unit: 'm', meaning: 'VTOL RTL altitude', source: PARAM_SRC_MAN },
    { name: 'Q_TRANS_FAIL', value: 4, unit: 's', meaning: 'transition timeout (not re-verified, plan §13.1)', source: PARAM_SRC_MAN + '; plan §6.1.5' },
    { name: 'Q_TRANS_FAIL_ACT', value: 0, meaning: '0 = QLand at the current position (−1 warn only · 1 QRTL) — not QHOVER', source: 'plan §13.1 (ArduPlane quadplane.cpp)' },
    { name: 'Q_ASSIST_SPEED', value: 9, unit: 'm/s', meaning: 'VTOL assist below this airspeed in FW modes', source: PARAM_SRC_MAN },
    { name: 'Q_ASSIST_ALT', value: 25, unit: 'm', meaning: 'VTOL assist below this altitude (altitude reference: VERIFY, plan S-04)', source: PARAM_SRC_MAN },
    { name: 'Q_FRAME_CLASS', value: 7, meaning: '7 = Tri (not re-verified, plan §13.1)', source: PARAM_SRC_MAN },
    { name: 'Q_TILT_MASK', value: 3, meaning: 'motors 1 and 2 (front pair) tilt', source: PARAM_SRC_MAN },
    { name: 'AIRSPEED_CRUISE', value: 13, unit: 'm/s', meaning: 'cruise airspeed', source: PARAM_SRC_MAN },
    { name: 'AIRSPEED_MIN', value: 11, unit: 'm/s', meaning: 'minimum airspeed (also the .bin transition-time target)', source: PARAM_SRC_MAN },
    { name: 'AIRSPEED_MAX', value: 22, unit: 'm/s', meaning: 'maximum airspeed', source: PARAM_SRC_MAN },
    { name: 'FENCE_ENABLE', value: 0, meaning: '0 = geofence disabled (intentional for now)', source: 'CLAUDE.md known issues; manual pre-arm table' },
    { name: 'FLTMODE1', value: 18, meaning: '18 = QHOVER (Nomad switch position 1)', source: PARAM_SRC_NOTES },
    { name: 'FLTMODE2', value: null, meaning: 'TBD — the project notes give 11 (= RTL in ArduPlane numbering) but call it QLOITER (= 19); confirm from the param file', source: PARAM_SRC_NOTES },
    { name: 'FLTMODE3', value: 6, meaning: '6 = FBWB', source: PARAM_SRC_NOTES },
    { name: 'FLTMODE4', value: 6, meaning: '6 = FBWB (Nomad switch position 2)', source: PARAM_SRC_NOTES },
    { name: 'FLTMODE5', value: 0, meaning: '0 = MANUAL (GCS only, never in flight)', source: PARAM_SRC_NOTES },
    { name: 'FLTMODE6', value: 10, meaning: '10 = AUTO (Nomad switch position 3)', source: PARAM_SRC_NOTES }
  ];

  const PARAM_NAME_RE = /^[A-Z][A-Z0-9_]{0,15}$/;
  const PARAM_NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  // ArduPilot parameter file → {params: {NAME: number}, count, errors: [{line, text}], duplicates: [NAME]}.
  // Accepts Mission Planner "NAME,VALUE", MAVProxy "NAME VALUE" and QGC ".params" "sysid compid NAME VALUE type".
  // '#' starts a comment.
  function parseParamFile(text) {
    const params = {}, errors = [], duplicates = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) return;
      let f = line.split(/[\s,]+/).filter(Boolean);
      if (f.length >= 4 && /^\d+$/.test(f[0]) && /^\d+$/.test(f[1])) f = f.slice(2);   // QGC: sysid compid …
      const name = (f[0] || '').toUpperCase();
      if (f.length < 2 || !PARAM_NAME_RE.test(name) || !PARAM_NUM_RE.test(f[1])) { errors.push({ line: i + 1, text: raw.slice(0, 80) }); return; }
      if (Object.prototype.hasOwnProperty.call(params, name)) duplicates.push(name);
      params[name] = Number(f[1]);
    });
    return { params, count: Object.keys(params).length, errors, duplicates };
  }

  // Param values are float32 on the autopilot (22.2 is stored as 22.200000763): compare with a small tolerance.
  function paramEq(a, b) { return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b)); }

  // Rows: {name, expected, actual, unit, meaning, source, status}; status 'match' | 'differs' | 'missing' |
  // 'undocumented' (no documented value: shown, never judged). summary counts per status.
  function compareParams(params, expected) {
    params = params || {};
    const rows = (expected || EXPECTED_PARAMS).map(e => {
      const has = Object.prototype.hasOwnProperty.call(params, e.name), actual = has ? params[e.name] : null;
      const status = e.value === null || e.value === undefined ? 'undocumented' : !has ? 'missing' : paramEq(actual, e.value) ? 'match' : 'differs';
      return { name: e.name, expected: e.value === undefined ? null : e.value, actual, unit: e.unit || '', meaning: e.meaning || '', source: e.source || '', status };
    });
    const summary = { match: 0, differs: 0, missing: 0, undocumented: 0 };
    rows.forEach(r => { summary[r.status]++; });
    return { rows, summary };
  }

  // store.paramFile record. name: file name; nowMs: import time.
  function paramFileRecord(name, parsed, nowMs) {
    return { name: String(name || 'unnamed.param'), importedAt: new Date(nowMs).toISOString(), params: Object.assign({}, parsed.params) };
  }
  // Label for any page: "verified against param file <name> <YYYY-MM-DD HH:MM>" (local time), or null without a file.
  function paramFileLabel(pf) {
    if (!pf || !pf.name || !isFinite(Date.parse(pf.importedAt))) return null;
    const d = new Date(pf.importedAt);
    return 'verified against param file ' + pf.name + ' ' + localDateStr(d.getTime()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  // Value of a parameter from the imported file, else the documented value. → {value, source: 'file'|'documented'} or null.
  function paramValue(pf, name) {
    if (pf && pf.params && Object.prototype.hasOwnProperty.call(pf.params, name) && isFinite(pf.params[name])) return { value: pf.params[name], source: 'file' };
    const e = EXPECTED_PARAMS.find(x => x.name === name);
    return e && e.value !== null ? { value: e.value, source: 'documented' } : null;
  }

  // ══════════════ .BIN FLIGHT ANALYSIS (plan §10.4) ══════════════
  // ArduPlane mode numbers (ArduPlane/mode.h, master, read 2026-10-16).
  const PLANE_MODES = { 0: 'MANUAL', 1: 'CIRCLE', 2: 'STABILIZE', 3: 'TRAINING', 4: 'ACRO', 5: 'FBWA', 6: 'FBWB', 7: 'CRUISE', 8: 'AUTOTUNE',
    10: 'AUTO', 11: 'RTL', 12: 'LOITER', 13: 'TAKEOFF', 14: 'AVOID_ADSB', 15: 'GUIDED', 16: 'INITIALISING', 17: 'QSTABILIZE', 18: 'QHOVER',
    19: 'QLOITER', 20: 'QLAND', 21: 'QRTL', 22: 'QAUTOTUNE', 23: 'QACRO', 24: 'THERMAL', 25: 'LOITER_QLAND', 26: 'AUTOLAND' };
  const Q_MODES = [17, 18, 19, 20, 21, 22, 23];
  // 'vtol' (Q-modes), 'fw' (every other flight mode), 'unknown' (INITIALISING or unknown number).
  // AUTO / RTL / GUIDED can fly VTOL segments; this classification uses the mode only.
  function modeClass(m) { return Q_MODES.includes(m) ? 'vtol' : (PLANE_MODES[m] && m !== 16) ? 'fw' : 'unknown'; }

  // ModeReason (libraries/AP_Vehicle/ModeReason.h, master, read 2026-10-16): the reasons that mean a failsafe.
  const MODE_REASON = { 0: 'UNKNOWN', 1: 'RC_COMMAND', 2: 'GCS_COMMAND', 3: 'RADIO_FAILSAFE', 4: 'BATTERY_FAILSAFE', 5: 'GCS_FAILSAFE',
    6: 'EKF_FAILSAFE', 7: 'GPS_GLITCH', 8: 'MISSION_END', 10: 'FENCE_BREACHED', 11: 'TERRAIN_FAILSAFE', 19: 'CRASH_FAILSAFE',
    23: 'VTOL_FAILED_TRANSITION', 24: 'VTOL_FAILED_TAKEOFF', 25: 'FAILSAFE', 26: 'INITIALISED', 39: 'RTL_COMPLETE_SWITCHING_TO_VTOL_LAND_RTL',
    41: 'MISSION_CMD', 44: 'QRTL_INSTEAD_OF_RTL', 46: 'LOITER_ALT_REACHED_QLAND', 47: 'LOITER_ALT_IN_VTOL', 48: 'RADIO_FAILSAFE_RECOVERY',
    49: 'QLAND_INSTEAD_OF_RTL', 50: 'DEADRECKON_FAILSAFE', 51: 'MODE_TAKEOFF_FAILSAFE', 53: 'AUX_FUNCTION' };
  const FAILSAFE_REASONS = [3, 5, 6, 10, 11, 19, 23, 24, 25, 50, 51];
  const BATTERY_REASONS = [4];

  // MSG text → event kinds. Texts per ArduPlane source: "Alt assist …", "Angle assist …" (VTOL_Assist.cpp);
  // "Transition started …", "Transition airspeed reached …", "Transition done", "Transition failed, exceeded time limit".
  const MSG_KINDS = [
    ['assist', /\bassist\b/i],
    ['transition', /transition/i],
    ['failsafe', /fail\s*-?safe|\bfailed\b|\blost\b/i],
    ['battery', /\bbatt|battery|low voltage|voltage low/i]
  ];
  function msgKinds(text) { return MSG_KINDS.filter(([, re]) => re.test(text)).map(([k]) => k); }

  // Analysis of a parseBin() result. opts.airspeedMin (m/s): AIRSPEED_MIN for the transition time (param file or
  // documented value). Times: µs log time; tSec = seconds since the log start.
  function binAnalyze(d, opts) {
    opts = opts || {};
    const aMin = typeof opts.airspeedMin === 'number' && isFinite(opts.airspeedMin) ? opts.airspeedMin : null;
    const T0 = d.firstT || 0, rel = t => (t - T0) / 1e6;
    const modes = (d.modes || []).slice().sort((a, b) => a.t - b.t);
    const arsp = d.arsp || { t: [], v: [] }, hasArsp = arsp.t.length > 0;
    const msgs = d.msgs || [];
    const mName = m => PLANE_MODES[m] || ('MODE_' + m);
    const segEnd = k => k + 1 < modes.length ? modes[k + 1].t : Math.max(d.lastT || 0, modes[k].t);

    // Transitions (mode class changes) and the end of each forward transition.
    const transitions = [];
    for (let k = 1; k < modes.length; k++) {
      const a = modeClass(modes[k - 1].mode), b = modeClass(modes[k].mode);
      if (a === b || a === 'unknown' || b === 'unknown') continue;
      const t = modes[k].t, tEnd = segEnd(k);
      const tr = { t, tSec: rel(t), dir: b === 'fw' ? 'forward' : 'back', from: mName(modes[k - 1].mode), to: mName(modes[k].mode),
        reason: modes[k].reason != null ? (MODE_REASON[modes[k].reason] || 'REASON_' + modes[k].reason) : null,
        airspeedMin: aMin, timeToMinS: null, reached: null, endT: null, endBy: null };
      if (tr.dir === 'forward') {
        if (hasArsp && aMin !== null) {
          const i = arsp.t.findIndex((x, j) => x >= t && x <= tEnd && arsp.v[j] >= aMin);
          tr.reached = i >= 0;
          if (i >= 0) { tr.timeToMinS = (arsp.t[i] - t) / 1e6; tr.endT = arsp.t[i]; tr.endBy = 'airspeed'; }
        }
        if (tr.endT === null) {
          const m = msgs.find(x => x.t >= t && x.t <= tEnd && /^Transition (FW )?done/i.test(x.text));
          if (m) { tr.endT = m.t; tr.endBy = 'msg'; }
        }
      }
      transitions.push(tr);
    }

    // Events: MSG texts and failsafe / battery mode reasons.
    const events = [];
    msgs.forEach(m => { const kinds = msgKinds(m.text); if (kinds.length) events.push({ t: m.t, tSec: rel(m.t), kinds, source: 'MSG', text: m.text }); });
    modes.forEach(m => {
      if (m.reason == null) return;
      const bat = BATTERY_REASONS.includes(m.reason), fs = FAILSAFE_REASONS.includes(m.reason);
      if (!bat && !fs) return;
      const kinds = bat ? ['battery', 'failsafe'] : m.reason === 23 ? ['failsafe', 'transition'] : ['failsafe'];
      events.push({ t: m.t, tSec: rel(m.t), kinds, source: 'MODE', text: 'Mode ' + mName(m.mode) + ' — reason ' + (MODE_REASON[m.reason] || m.reason) });
    });
    events.sort((a, b) => a.t - b.t);

    // Phase segments: Q-mode → vtol; FW mode → fw, except a forward transition window (mode change → AIRSPEED_MIN
    // reached, or "Transition done"). Without either the window is unknown and the segment counts as fw.
    const segs = [];
    let transitionUnknown = 0;
    modes.forEach((m, k) => {
      const cls = modeClass(m.mode), t1 = segEnd(k);
      if (cls === 'unknown') return;
      const tr = transitions.find(x => x.t === m.t && x.dir === 'forward');
      if (tr) {
        if (tr.endT !== null) { segs.push({ t0: m.t, t1: tr.endT, phase: 'transition' }); segs.push({ t0: tr.endT, t1, phase: 'fw' }); return; }
        if (tr.reached === false) { segs.push({ t0: m.t, t1, phase: 'transition' }); return; }   // never reached AIRSPEED_MIN in this mode
        transitionUnknown++;
      }
      segs.push({ t0: m.t, t1, phase: cls });
    });
    const cur = d.cur || { t: [], a: [] };
    const phases = { vtol: { maxA: null, n: 0 }, transition: { maxA: null, n: 0 }, fw: { maxA: null, n: 0 } };
    cur.t.forEach((t, i) => {
      const a = cur.a[i];
      if (!(isFinite(a) && a >= 0 && a < 500)) return;
      const s = segs.find(x => t >= x.t0 && t < x.t1) || (segs.length && t === segs[segs.length - 1].t1 ? segs[segs.length - 1] : null);
      if (!s) return;
      const p = phases[s.phase];
      p.n++; if (p.maxA === null || a > p.maxA) p.maxA = a;
    });
    return { transitions, events, phases, transitionUnknown, hasArsp, airspeedMin: aMin };
  }

  // Battery-log fields from a .bin for a pack: {start, min, rest (= end of log), sag, time (min, text), date|null, durationMin}.
  function binBattEntry(d, pack) {
    const s = binBatterySeries(d, pack);
    if (s.v.length < 2) return null;
    const start = s.v[0], end = s.v[s.v.length - 1], min = Math.min(...s.v);
    const durationMin = Math.max(0, (s.t[s.t.length - 1] - s.t[0]) / 60e6);
    const startMs = binStartUnixMs(d);
    return { start: +start.toFixed(2), min: +min.toFixed(2), rest: +end.toFixed(2), sag: +(start - min).toFixed(2),
      time: String(Math.round(durationMin)), durationMin, date: startMs !== null ? localDateStr(startMs) : null };
  }

  // Compact .bin summary for a flight record.
  function binSummary(d, an, file, pack) {
    const e = binBattEntry(d, pack), startMs = binStartUnixMs(d);
    return { kind: 'bin', file: String(file || ''), start: startMs !== null ? new Date(startMs).toISOString() : null,
      durationS: Math.max(0, Math.round(((d.lastT || 0) - (d.firstT || 0)) / 1e6)),
      startV: e ? e.start : null, minV: e ? e.min : null, endV: e ? e.rest : null,
      transitions: an.transitions.length, events: an.events.length,
      maxA: { vtol: an.phases.vtol.maxA, transition: an.phases.transition.maxA, fw: an.phases.fw.maxA } };
  }

  // ══════════════ GCS SESSION LOG (gcs/README.md "Session log schema", vtol-gcs-session/1) ══════════════
  // One JSON object per line; every record has t (ISO UTC), mono_s, type. Unknown types and fields are ignored.
  function parseSessionLog(text) {
    const s = { schema: null, version: null, startIso: null, endIso: null, firstMono: null, lastMono: null,
      lines: 0, bad: 0, ignored: 0, ended: false,
      rtt: { t: [], v: [] }, loss: { t: [], v: [] }, lq: { t: [], v: [] }, lqStatus: { t: [], v: [] },
      battV: { t: [], v: [] }, usedMah: { t: [], v: [] }, armed: { t: [], v: [] },
      bridge: [], alarms: [], modes: [] };
    const fin = v => typeof v === 'number' && isFinite(v);
    const push = (ser, m, v) => { if (fin(v)) { ser.t.push(m); ser.v.push(v); } };
    String(text || '').split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      s.lines++;
      let r;
      try { r = JSON.parse(line); } catch (e) { s.bad++; return; }
      if (!r || typeof r !== 'object' || typeof r.type !== 'string' || !fin(r.mono_s)) { s.bad++; return; }
      const m = r.mono_s;
      if (s.firstMono === null || m < s.firstMono) { s.firstMono = m; if (typeof r.t === 'string') s.startIso = r.t; }
      if (s.lastMono === null || m >= s.lastMono) { s.lastMono = m; if (typeof r.t === 'string') s.endIso = r.t; }
      switch (r.type) {
        case 'session_start':
          s.schema = typeof r.schema === 'string' ? r.schema : null; s.version = typeof r.version === 'string' ? r.version : null; break;
        case 'status': {
          const st = r.status && typeof r.status === 'object' ? r.status : {};
          const b = st.bridge && typeof st.bridge === 'object' ? st.bridge : {};
          push(s.rtt, m, b.rtt_ms); push(s.loss, m, b.uplink_loss_pct);
          const lk = st.client && st.client.link;
          if (lk && typeof lk === 'object') push(s.lqStatus, m, lk.lq_pct);
          if (typeof b.state === 'string') s.bridge.push({ m, state: b.state });
          break;
        }
        case 'telemetry':
          if (r.kind === 'link') push(s.lq, m, r.lq_pct);
          else if (r.kind === 'battery') { push(s.battV, m, r.voltage_v); push(s.usedMah, m, r.used_mah); }
          else if (r.kind === 'flight_mode' && typeof r.armed === 'boolean') { s.armed.t.push(m); s.armed.v.push(r.armed); }
          break;
        case 'bridge_state': if (typeof r.to === 'string') s.bridge.push({ m, state: r.to }); break;
        case 'alarm':
          s.alarms.push({ m, t: typeof r.t === 'string' ? r.t : null, id: String(r.id === undefined ? '' : r.id), severity: r.severity === 'crit' ? 'crit' : r.severity === 'warn' ? 'warn' : String(r.severity || ''),
            text: String(r.text === undefined ? '' : r.text), active: r.active !== false });
          break;
        case 'mode': s.modes.push({ m, mode: String(r.mode || ''), startPath: r.start_path == null ? null : String(r.start_path) }); break;
        case 'session_end': s.ended = true; break;
        default: s.ignored++;
      }
    });
    // Bridge-state timeline: consecutive identical states merged, sorted by time.
    s.bridge.sort((a, b) => a.m - b.m);
    s.bridgeTimeline = [];
    s.bridge.forEach(x => { const last = s.bridgeTimeline[s.bridgeTimeline.length - 1]; if (!last || last.state !== x.state) s.bridgeTimeline.push({ m: x.m, state: x.state }); });
    s.bridgeTimeline.forEach((x, i, a) => { x.end = i + 1 < a.length ? a[i + 1].m : s.lastMono; });
    if (!s.lq.t.length) s.lq = s.lqStatus;   // no decoded link frames: the LQ inside /status
    s.durationS = s.firstMono !== null ? s.lastMono - s.firstMono : 0;
    return s;
  }

  const seriesStat = ser => {
    if (!ser.v.length) return { min: null, max: null, avg: null };
    return { min: Math.min(...ser.v), max: Math.max(...ser.v), avg: ser.v.reduce((a, b) => a + b, 0) / ser.v.length };
  };
  // Armed time (s) from flight_mode telemetry, or null when the log has no armed state.
  function sessionArmedS(s) {
    if (!s.armed.t.length) return null;
    let total = 0, since = null;
    s.armed.t.forEach((m, i) => {
      if (s.armed.v[i] && since === null) since = m;
      else if (!s.armed.v[i] && since !== null) { total += m - since; since = null; }
    });
    if (since !== null) total += s.lastMono - since;
    return total;
  }
  // Client battery-log fields from telemetry: {start, min, rest (= last), sag, time, date, usedMah|null, durationSource}.
  function sessionBattEntry(s, pack) {
    const r = pack ? voltRange(pack) : { minV: 0, maxV: Infinity }, v = [], t = [];
    s.battV.v.forEach((x, i) => { if (x > r.minV && x < r.maxV) { v.push(x); t.push(s.battV.t[i]); } });
    if (v.length < 2) return null;
    const start = v[0], end = v[v.length - 1], min = Math.min(...v);
    const u = s.usedMah.v.filter(x => x >= 0);
    const usedMah = u.length >= 2 && u[u.length - 1] >= u[0] ? Math.round(u[u.length - 1] - u[0]) : null;
    const armed = sessionArmedS(s), durS = armed !== null && armed > 0 ? armed : t[t.length - 1] - t[0];
    const ms = Date.parse(s.startIso);
    return { start: +start.toFixed(2), min: +min.toFixed(2), rest: +end.toFixed(2), sag: +(start - min).toFixed(2),
      time: String(Math.round(durS / 60)), durationSource: armed !== null && armed > 0 ? 'armed' : 'telemetry span',
      date: isFinite(ms) ? localDateStr(ms) : null, usedMah };
  }
  function sessionSummary(s, file) {
    const rtt = seriesStat(s.rtt), loss = seriesStat(s.loss), lq = seriesStat(s.lq), bv = seriesStat(s.battV);
    return { kind: 'gcs', file: String(file || ''), start: s.startIso, durationS: Math.round(s.durationS || 0),
      rttMaxMs: rtt.max, rttAvgMs: rtt.avg !== null ? +rtt.avg.toFixed(1) : null, lossMaxPct: loss.max, lqMinPct: lq.min,
      battMinV: bv.min, critAlarms: s.alarms.filter(a => a.active && a.severity === 'crit').length,
      alarms: s.alarms.filter(a => a.active).length, failsafe: s.bridgeTimeline.some(x => x.state === 'FAILSAFE') };
  }

  // ══════════════ MAINTENANCE (plan §10.3) ══════════════
  // Intervals from the manual's Maintenance tab: "Carrier — Every 5 Flights", "Every 10 Flights",
  // "Every 25 Flights or Monthly" and the FPV (client) drone's "Every 5 Flights" section.
  const MAINT_TASKS = [
    { id: 'carrier-5', target: 'carrier', title: 'Carrier — every 5 flights', flights: 5, months: null },
    { id: 'carrier-10', target: 'carrier', title: 'Carrier — every 10 flights', flights: 10, months: null },
    { id: 'carrier-25', target: 'carrier', title: 'Carrier — every 25 flights or monthly', flights: 25, months: 1 },
    { id: 'client-5', target: 'client', title: 'Client drone — every 5 flights', flights: 5, months: null }
  ];
  // 'YYYY-MM-DD' + n calendar months (day clamped to the month's end).
  function addMonths(dateStr, n) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    if (!y || !m || !d) return null;
    const ym = y * 12 + (m - 1) + n, ny = Math.floor(ym / 12), nm = ym % 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return ny + '-' + pad2(nm + 1) + '-' + pad2(Math.min(d, last));
  }
  // Latest live mark-done record of a task: {taskId, doneDate, markedAt, …} or null.
  function maintLast(records, taskId) {
    return (records || []).filter(r => r && !r.deleted && r.taskId === taskId)
      .sort((a, b) => (b.doneDate || '').localeCompare(a.doneDate || '') || (b.markedAt || '').localeCompare(a.markedAt || ''))[0] || null;
  }
  // Status of one task. entries: battery-log entries of that aircraft ({date, updatedAt}). A flight counts as after
  // the maintenance when its date is later, or on the same date and logged after the mark-done.
  // status: 'ok' | 'soon' (1 flight left) | 'due' (do it before the next flight) | 'overdue' (flown past the interval
  // or past the monthly date).
  function maintStatus(task, entries, last, todayStr) {
    const after = e => !last || String(e.date) > last.doneDate || (String(e.date) === last.doneDate && String(e.updatedAt || '') > String(last.markedAt || ''));
    const since = (entries || []).filter(after).length;
    const left = task.flights - since;
    let status = left < 0 ? 'overdue' : left === 0 ? 'due' : left === 1 ? 'soon' : 'ok';
    let dueDate = null;
    if (task.months && last) {
      dueDate = addMonths(last.doneDate, task.months);
      if (todayStr > dueDate) status = 'overdue';
      else if (todayStr === dueDate && status !== 'overdue') status = 'due';
    }
    return { since, left, status, dueDate, neverDone: !last, calendarUnknown: !!task.months && !last };
  }

  // ══════════════ LATENCY TEST (relay design test 2) ══════════════
  // "Glass-to-glass video: stopwatch filmed at 240 fps with the GCS screen, 20 samples — record mean and worst case."
  const LATENCY_SAMPLES = 20;
  function latencyStats(samples) {
    const v = (samples || []).map(Number).filter(x => isFinite(x) && x >= 0);
    if (!v.length) return { n: 0, mean: null, worst: null, best: null };
    return { n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, worst: Math.max(...v), best: Math.min(...v) };
  }
  // 'HH:MM:SS.mmm' (local) of epoch ms.
  function fmtClockMs(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  // ══════════════ WEATHER EXTRAS / AIRSPACE (plan §10.5) ══════════════
  // Cloud cover and visibility for hourly index idx (Open-Meteo hourly cloud_cover, cloud_cover_low [%],
  // visibility [m]); null when the model does not provide the variable.
  function cloudVis(hourly, idx) {
    const g = k => hourly && Array.isArray(hourly[k]) && hourly[k][idx] != null && isFinite(hourly[k][idx]) ? hourly[k][idx] : null;
    return { cloudTotalPct: g('cloud_cover'), cloudLowPct: g('cloud_cover_low'), visibilityM: g('visibility') };
  }
  // Official Norwegian airspace / NOTAM sources — verified on the web 2026-10-16:
  // - Luftfartstilsynet "No-drone zones" page (https://luftfartstilsynet.no/en/drones/no-drone-zones/) links to
  //   dronesoner.no (UAS geographical zones), IPPC.no ("NOTAM can be checked at IPPC.no"), the AIP and Avinor's drone map.
  // - https://www.ippc.no/ippc/index.jsp = "IPPC – Norwegian Aerodrome Info", © Avinor Flysikring AS: briefing, NOTAM,
  //   flight planning (linked as "Open IPPC here" from Avinor's AIS portal https://partner.avinor.no/en/ais/homepage/).
  // - https://partner.avinor.no/en/ais/aip/ = "AIP – Norway" (avinor.no/en/ais/aipnorway/ now redirects here).
  // - https://www.avinor.no/en/practical-info/drone/dronekart/ = Avinor "Drone map" page (5 km airport zones), linked
  //   from the Luftfartstilsynet page.
  const AIRSPACE_LINKS = [
    { id: 'notam', label: 'NOTAM — IPPC (Avinor)', url: 'https://www.ippc.no/ippc/index.jsp', note: 'Briefing, NOTAM and temporary restricted areas' },
    { id: 'dronesoner', label: 'Drone zones — dronesoner.no', url: 'https://dronesoner.no/', note: 'UAS geographical zones (linked by Luftfartstilsynet)' },
    { id: 'caa-zones', label: 'Luftfartstilsynet — no-drone zones', url: 'https://luftfartstilsynet.no/en/drones/no-drone-zones/', note: 'Where drones may fly; links to all sources' },
    { id: 'avinor-dronemap', label: 'Avinor drone map', url: 'https://www.avinor.no/en/practical-info/drone/dronekart/', note: 'Airport zones and contacts' },
    { id: 'aip', label: 'AIP Norway (Avinor AIS)', url: 'https://partner.avinor.no/en/ais/aip/', note: 'Restricted and danger areas' }
  ];

  return {
    localDateStr, fmtHMAtOffset,
    BATT_CHEM, RETURN_MARGIN_V, chemOf, packThresholds, voltRange, battStats, recommendBattLow,
    minVoltLevel, sagLevel, healthClass,
    parseTlog, mavFrame,
    GPS_UTC_LEAP_SECONDS, gpsToUnixMs, binRecord, parseBin, binStartUnixMs, binBatterySeries, chartXFractions,
    hourlyIndex, skyDesc, compass, windStatus, precipStatus, icingStatus, RELAY_WIND_HEIGHTS_M, relayWindRows, distanceKm,
    sunTimes,
    clNew, clNormalize, clCheckedCount, clIsExpired, clToggle,
    crItems, crNextOpen, speechText,
    EXPECTED_PARAMS, parseParamFile, paramEq, compareParams, paramFileRecord, paramFileLabel, paramValue,
    PLANE_MODES, modeClass, MODE_REASON, msgKinds, binAnalyze, binBattEntry, binSummary,
    parseSessionLog, sessionArmedS, sessionBattEntry, sessionSummary,
    MAINT_TASKS, addMonths, maintLast, maintStatus,
    LATENCY_SAMPLES, latencyStats, fmtClockMs,
    cloudVis, AIRSPACE_LINKS
  };
});
