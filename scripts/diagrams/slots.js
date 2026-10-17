'use strict';
// Diagram slots of manual.html (plan §9.3, WP07 R2): each <div class="diagram-slot" data-diagram="Dx"> holds a figure with
// the image from img/diagrams/, its width/height (from the SVG), a descriptive alt text and a caption.
// apply(html, svgs) rebuilds every slot's content; svgs = { 'd01-system-overview': '<svg …', … } (for the image size).
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const S = {
  D1: ['d01-system-overview', 'System overview — ground station, HM30, carrier and client with all four links. The carrier fails safe only on SIYI / GCS loss.',
    'Diagram D1: the Windows ground station (EdgeTX radio as USB joystick, GCS app sending rc_up to UDP 5770, Mission Planner UDPCI, video viewer on UDP 5601 and MP HUD on 5602) reaches the carrier only over the HM30 IP link. On the carrier the HM30 air unit feeds the FC (MAVLink) and relay switch port P1; P2 net/RC board drives the ELRS TX module over CRSF, P5 video board takes CVBS from the VRX, P3 is the IP camera, P4 spare. Client RC on ELRS 868/915/2.4 GHz; client video analog, band per client. The 915 MHz Nomad is close-range backup only.'],
  D2: ['d02-relay-electronics', 'Relay PCB — net/RC board (KSZ8795, W5500, STM32G030), video board (decoder, STM32N657), ports P1–P5, VLAN map, power, LEDs.',
    'Diagram D2: VIN 6–26 V through fuse, reverse FET and TVS; 3.3V_RC and VBAT_TX bucks; KSZ8795 switch with P1 HM30, P2 W5500 (capacitor-coupled), P3 IP camera and P4 spare on JST-GH 4-pin, P5 RMII to the N6; G0 talks SPI to the W5500 and the switch (CAM_ENABLE) and drives CRSF at 400 kbaud to the ELRS TX module; VLANs keep P3/P4 away from P2; P1 egress priority RC, video, camera; video board CVBS → TVP5150/TW9900 → BT.656 → N6 H.264 → RTP 5600; LEDs PG8, PG10, PG0.'],
  D3: ['d03-network-map', 'Network and port map — every IP, port, protocol and direction (proposed; confirm before flight).',
    'Diagram D3: laptop 192.168.144.X with the local fan-out of UDP 5600 to 5601 (viewer) and 5602 (MP HUD) and the read-only API on 47800; HM30 ground .12 with UDP 19856 MAVLink; HM30 air .11 to switch P1; P5 N6 sends RTP to 5600 at the GCS; P2 RC bridge on UDP 5770 receives rc_up and returns status and telemetry; P3 camera .26 RTSP 8554 only while CAM_ENABLE = 1; P4 spare. Mission Planner must not listen on UDP 5600 while the fan-out runs.'],
  D4: ['d04-rc-path-timeline', 'RC path — controller → GCS app → HM30 → bridge → CRSF slot → ELRS → client, with the latency of each stage.',
    'Diagram D4: stage latencies — controller to app 1–8 ms (estimate); rc_up every 4–5 ms; HM30 uplink unknown (measure); switch, W5500 and G0 under 1 ms; wait for the CRSF slot up to one CRSF period; 26-byte CRSF frame about 0.65 ms; one ELRS packet interval to the client; 10 Hz status and telemetry back. End-to-end TBD.'],
  D5: ['d05-bridge-states', 'Bridge state machine — BOOT → WAIT_GCS → START → RUN → FAILSAFE → WAIT_GCS. LED patterns: TBD (firmware).',
    'Diagram D5: BOOT (no CRSF) to WAIT_GCS when the peripherals and W5500 are up; WAIT_GCS to START after 5 consecutive valid packets; START sends ModelID three times then RUN; RUN sends RC frames every tick and goes to FAILSAFE when no valid packet arrives for T_hold (start 250 ms); FAILSAFE is silent and returns immediately to WAIT_GCS. Watchdog about 100 ms resets to BOOT. App shows UNREACHABLE without status for 300 ms. LED patterns TBD.'],
  D6: ['d06-client-failsafe', 'Client failsafe timeline — stream stops → T_hold → TX module → RX failsafe → client FC failsafe. Measured times per cause: TBD (test 6).',
    'Diagram D6: causes (app stops, controller unplugged, HM30 lost, bridge watchdog); bridge silent after T_hold (start 250 ms); ELRS TX module reaction TBD; client RX failsafe timeout TBD; client FC failsafe per profile (Reference client #1: GPS Rescue after 2.5 s); total per cause TBD from relay-design test 6.'],
  D7: ['d07-carrier-failsafe', 'Carrier failsafe matrix and SIYI-loss timeline — replaces the old RC failsafe cascade. Only SIYI / GCS loss triggers a link failsafe (never the 915 MHz link); battery low → RTL, critical → QLand here.',
    'Diagram D7: SIYI / MP link lost for 5 s in any mode → RTL in fixed-wing modes, QRTL in VTOL modes, RTL ends with an automatic VTOL landing at home; 915 MHz backup lost → no action (THR_FAILSAFE = 2), QHOVER drifts with the wind, close-in take over in MP; battery low 22.0 V → automatic RTL (manual RTL at 23.0 V first); battery critical 21.0 V → Loiter then QLand here, not home; transition fail after 8 s → QRTL home, pilot reverts to QHOVER within 3 s. Timeline: 0 s heartbeat lost, 5 s RTL / QRTL, climb to 120 m REL, return, automatic VTOL landing at home.'],
  D8: ['d08-bandwidth-budget', 'Bandwidth budget — HM30 capacity split in FPV mode (camera off) and camera mode (camera at its P3 cap). Not to scale; values TBD (Q13).',
    'Diagram D8: two bars, not to scale. FPV mode: N6 video CBR, RC uplink about 100–130 kbit/s, MAVLink, margin, camera off. Camera mode adds the IP camera at its P3 ingress cap. Everything must stay below the measured HM30 capacity (TBD). Until test 9 passes: camera off while the client is armed.'],
  D8b: ['d08b-camera-logic', 'Camera on/off — CAM_ENABLE from the GCS app → G0 → switch P3, with read-back; the client-gated variant is a firmware request.',
    'Diagram D8b: the app request (key k, default off) travels as CAM_ENABLE bit 0 in every rc_up; the G0 applies it within one packet: P3 enabled and capped, or disabled / at minimum; the G0 reads the switch back and reports the actual state in the 10 Hz status; the app compares requested and reported (mismatch after 1 s). Off at power-up, forced off when the GCS stream is lost. Proposed variant (not implemented): on with no stream since boot, off after a lost stream.'],
  D9: ['d09-antenna-layout', 'Carrier antenna layout — schematic; mounting positions and separations TBD (own photos, test 7). VRX patches face the right wing (inward).',
    'Diagram D9: schematic top and rear views; VRX patch 1 boresight horizontal right (90°), patch 2 right and 45° down (135°), orbit centre on the right (clockwise). Antennas: HM30 air unit, VRX patches, ELRS TX module, ELRS RX 915, GPS — positions TBD. Co-site test 7 TBD; 25 MHz harmonics near 5800 MHz and GPS L1.'],
  D10: ['d10-ground-station', 'Ground station layout — mast with the HM30, GCS laptop and second screen, EdgeTX radio, crew positions and cables.',
    'Diagram D10: HM30 ground unit on the mast (6S 3000 mAh), Ethernet to the Windows laptop; screen A Mission Planner, screen B over USB-C client video and GCS app status (per crew agreement); laptop on mains, never sleeps; Carrier Pilot with MP and the Nomad 915 for close range; FPV Pilot with the EdgeTX radio as USB joystick, RF off; both co-located, verbal calls only.'],
  D11: ['d11-wiring-harness', 'Carrier wiring harness — power taps from the 6S pack and every signal run (Ethernet, CRSF, CVBS, MAVLink). Unknown supplies TBD.',
    'Diagram D11: the 6S 7000 mAh pack powers FC and ESCs, HM30 air unit (supply TBD), relay PCB via XT30 (6–26 V), IP camera and VRX (supplies TBD). Signal runs: HM30 to P1; camera to P3 and spare to P4 on JST-GH 4-pin; CRSF JST-GH (VBAT_TX, GND, CRSF, spare) to the ELRS TX module, Nomad 6–16.8 V; VRX to the CVBS input, never goggles in parallel; HM30 to FC MAVLink; ELRS RX 915 and GPS to the FC.'],
  D12: ['d12-troubleshooting', 'Troubleshooting trees — "No client RC" and "No client video", from the GCS app status and the relay LEDs.',
    'Diagram D12: no client RC — app sending? bridge status and RTT shown? bridge RUN? client LQ at least 70 %? each "no" leads to app/controller, HM30 link, bridge failsafe or ELRS RF. No client video — clean picture? decoder locked? RTT and MP telemetry OK? viewer on the right port (5601, MP HUD 5602, MP not on 5600)?'],
  D13: ['d13-coverage-intersection', 'Coverage intersection — operating area = video ∩ RC; the orbit sweep\'s inner zone is covered at every point of the orbit. Illustrative: use the MAP.',
    'Diagram D13: overlapping video and RC coverage polygons with the operating area at their intersection; below, the orbit sweep with the always-covered inner zone (worst case over a full orbit) and the best-case union outside it.'],
  D14: ['d14-crew-swimlane', 'Crew swim-lane — Carrier Pilot and FPV Pilot actions and callouts per phase (phrases as on the Callouts tab).',
    'Diagram D14: two lanes, Carrier Pilot and FPV Pilot, for setup and pre-arm, takeoff and transition, relay operations and recovery, with the actions and the callout phrases of each phase; either pilot may call ABORT ABORT ABORT.'],
  D15: ['d15-video-field-timing', 'Video field timing — one PAL/NTSC field → slices → packets; the relay adds about one field time.',
    'Diagram D15: a PAL field arrives over 18.4 ms as 9 slices of 32 lines (NTSC 7 slices, 15.3 ms); each slice is encoded and sent as soon as it is complete, the last packet at most 3 ms after the last active line (test 1). Relay electronics add about 20 ms; the HM30 and the GCS dominate.']
};

function dims(file, svgs) {
  const svg = svgs[file];
  if (!svg) throw new Error('no SVG for ' + file);
  return { w: +svg.match(/width="(\d+)"/)[1], h: +svg.match(/height="(\d+)"/)[1] };
}

function apply(html, svgs) {
  let n = 0;
  html = html.replace(/<div class="diagram-slot" data-diagram="(D\d+b?)">[\s\S]*?<\/div>(?=\n)/g, (m, d) => {
    const s = S[d];
    if (!s) throw new Error('no entry for ' + d);
    const { w, h } = dims(s[0], svgs);
    n++;
    return '<div class="diagram-slot" data-diagram="' + d + '"><figure class="dg"><a href="img/diagrams/' + s[0] + '.svg" target="_blank" rel="noopener">'
      + '<img src="img/diagrams/' + s[0] + '.svg" width="' + w + '" height="' + h + '" loading="lazy" decoding="async" alt="' + esc(s[2]) + '"></a>'
      + '<figcaption><strong>' + d + '</strong> · ' + esc(s[1]) + ' Tap to open full size.</figcaption></figure></div>';
  });
  if (n !== 17) throw new Error('expected 17 diagram slots, found ' + n);
  return html;
}

module.exports = { apply, SLOTS: S };
