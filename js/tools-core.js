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
          if (r.Curr != null) bat.c.push(r.Curr);
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
        if (t > 0 && m != null) modes.push({ t, mode: m });
      } else if (n === 'MSG') {
        const r = binRecord(p, fmt.fmt, fmt.labels);
        const t = r.TimeUS || 0, txt = r.Message || r.Msg || '';
        if (txt.trim().length > 1) msgs.push({ t, text: txt.trim() });
      }
      i += fmt.len;
    }
    if (!firstT) firstT = bat.t[0] || gps.t[0] || 0;
    if (!lastT) lastT = bat.t[bat.t.length - 1] || gps.t[gps.t.length - 1] || 0;
    return { bat, gps, pos, arsp, modes, msgs, firstT, lastT };
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

  // Old format {"A-3": true} keyed by section id + item index → stable item ids. Tick times are unknown (ts null).
  function clMigrateLegacy(legacy, sections, nowMs, id) {
    const st = clNew(nowMs, id);
    st.session.migrated = true;
    sections.forEach(sec => sec.items.forEach((item, i) => {
      if (legacy && legacy[sec.id + '-' + i] === true) st.items[item.id] = { checked: true, ts: null };
    }));
    return st;
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

  return {
    localDateStr, fmtHMAtOffset,
    BATT_CHEM, RETURN_MARGIN_V, chemOf, packThresholds, voltRange, battStats, recommendBattLow,
    minVoltLevel, sagLevel, healthClass,
    parseTlog, mavFrame,
    GPS_UTC_LEAP_SECONDS, gpsToUnixMs, binRecord, parseBin, binStartUnixMs, binBatterySeries, chartXFractions,
    hourlyIndex, skyDesc, compass, windStatus, precipStatus, icingStatus, RELAY_WIND_HEIGHTS_M, relayWindRows, distanceKm,
    sunTimes,
    clNew, clNormalize, clMigrateLegacy, clCheckedCount, clIsExpired, clToggle
  };
});
