/* data/content.js — shared operational content (contract C5): global VtolContent in the browser, module.exports in Node.
 *
 * One source for the Tools page (index.html) and the manual (manual.html, WP06). Written for the new relay
 * (two-board relay PCB, GCS companion app) and the owner's carrier failsafe intent (plan §1.1, §4):
 * the carrier fails safe ONLY on SIYI / GCS link loss; the 915 MHz link is close-range backup.
 * Sources: docs/SOFTWARE-IMPROVEMENT-PLAN.md (Rev B) §3.3, §4, §6.1.5, §6.1.6, §6.1.8, §6.1.9, §6.2, §7.4, §14.2,
 * the relay design document, and the previous manual / Tools content. Unknown values are TBD — never invent numbers.
 *
 * TEXT MARKUP (rendered by js/render-content.js, which escapes everything first):
 *   `code`            → <code>
 *   **bold**          → <strong>
 *   [[QHOVER]] …      → flight-mode badge (modes listed in VtolRender.MODES)
 *   [[anything else]] → amber emphasis (.warn-val); every placeholder is written [[TBD — what is needed]]
 *   {client.vtx.freqMHz}, {settings.battCrtVolt} … → value from the active client profile / settings;
 *                       null or unknown → amber "TBD"
 * COPY BLOCKS (item.n with copy:true, extras[].val): plain text, copied verbatim. Tokens are resolved; no markup.
 *
 * IDS: every item has a stable, unique id. Checklist ids are the keys of saved tick state — never reuse or
 * renumber them. An item whose check changed meaning gets a new id.
 * item.w = amber warning flag · item.copy = n is a copy block · item.auto = live hint rule (VtolRender.AUTO_RULES).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VtolContent = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Video pipelines (plan §7.4). Ports per contract C3: the GCS app receives the N6 stream on UDP 5600 and
  // re-sends it to 127.0.0.1:5601 (standalone viewer) and 127.0.0.1:5602 (Mission Planner HUD).
  const RTP_CAPS = 'caps="application/x-rtp,media=video,clock-rate=90000,encoding-name=H264,payload=96"';
  const DECODE = 'rtph264depay ! h264parse ! avdec_h264 max-threads=1 ! videoconvert ! videoscale';
  const PIPE = {
    viewerPal: 'gst-launch-1.0 udpsrc port=5601 ' + RTP_CAPS + ' ! ' + DECODE + ' ! video/x-raw,width=768,height=576 ! autovideosink sync=false',
    viewerNtsc: 'gst-launch-1.0 udpsrc port=5601 ' + RTP_CAPS + ' ! ' + DECODE + ' ! video/x-raw,width=640,height=480 ! autovideosink sync=false',
    mpHudPal: 'udpsrc port=5602 ' + RTP_CAPS + ' ! ' + DECODE + ' ! video/x-raw,width=768,height=576,format=BGRA ! appsink name=outsink sync=false',
    mpHudNtsc: 'udpsrc port=5602 ' + RTP_CAPS + ' ! ' + DECODE + ' ! video/x-raw,width=640,height=480,format=BGRA ! appsink name=outsink sync=false',
    carrierCamera: 'rtspsrc location=rtsp://192.168.144.26:8554/main.264 latency=41 udp-reconnect=1 timeout=0 do-retransmission=false ! application/x-rtp ! decodebin3 ! queue max-size-buffers=1 leaky=2 ! videoconvert ! video/x-raw,format=BGRA ! appsink name=outsink sync=false'
  };
  const SDP = 'v=0\no=- 0 0 IN IP4 0.0.0.0\ns=Relay client video\nc=IN IP4 0.0.0.0\nt=0 0\nm=video 5601 RTP/AVP 96\na=rtpmap:96 H264/90000';

  // Corrected failsafe parameter block (plan §6.2.1 D, §4 S-01/S-02/S-03, §13.1).
  const FAILSAFE_PARAMS = [
    'THR_FAILSAFE = 2  (RC loss ignored — by design; no RC failsafe action)',
    'THR_FS_VALUE = 950  (throttle loss threshold)',
    'FS_GCS_ENABL = 2  (SIYI loss → failsafe in all modes)',
    'FS_LONG_TIMEOUT = 5  (seconds without GCS heartbeat)',
    'FS_LONG_ACTN = 1  (RTL on SIYI loss)',
    'BATT_CRT_VOLT = {settings.battCrtVolt}  (critical voltage, V)',
    'BATT_FS_CRT_ACT = 6  (critical → Loiter to QLand at current position)'
  ].join('\n');

  const designIntent = {
    id: 'design-intent',
    title: 'Carrier failsafe — design intent',
    text: 'The SIYI HM30 link (Mission Planner) is the **primary control link** and the **only link whose loss triggers a carrier failsafe**. The 915 MHz Nomad link is **close-range backup control** (takeoff, landing, or HM30 trouble near the field). Losing it beyond close range is **expected and requires no action**; the aircraft ignores RC while it is absent.'
  };

  // ── CHECKLISTS ── (plan §6.2.1; sections A–E, E renamed CLIENT)
  const preflight = {
    id: 'preflight',
    title: 'Pre-Flight Check',
    goText: '// GO — ALL ITEMS COMPLETE — CLEAR TO ARM //',
    sections: [
      { id: 'A', name: 'SITE', items: [
        { id: 'site-airspace', s: 'Airspace verified & pilots briefed', t: 'Airspace verified — NOTAMs checked, operation permitted. Remote piloting through the relay is covered by the operator\'s authorisation (Luftfartstilsynet). Both pilots briefed on roles and emergency actions.', w: true },
        { id: 'site-wind', s: 'Wind within limits', t: 'Wind within limits — crosswind acceptable for VTOL.', n: 'Wind vane active — carrier will weathervane into wind automatically.' },
        { id: 'site-lz', s: 'Landing zone clear', t: 'VTOL landing zone clear — 5m radius, level, no obstacles.' }
      ] },
      { id: 'B', name: 'VTOL BUILD', items: [
        { id: 'build-airframe', s: 'Airframe inspected', t: 'Carrier drone (Heewing T2 Cruza) assembled and inspected — no cracks at tilt motor mounts or wing joins.' },
        { id: 'build-pitot-cover', s: 'Pitot cover on', t: 'Pitot cover installed.', n: 'Leave on until pitot calibration step.', w: true },
        { id: 'build-relay-pcb', s: 'Relay PCB secured', t: 'Relay PCB mount secure, connectors locked (JST-GH, HM30 Ethernet, XT30, CRSF lead). Antennas: VRX patches facing inward, ELRS TX module antenna fitted.', n: 'Never plug goggles in parallel with the relay on one VRX output (CVBS lead).', w: true },
        { id: 'build-props', s: 'Props tight, rotation correct', t: 'All props tight — correct rotation direction confirmed for all 3 motors (M1/M2 tilt, M4 tail).', n: 'M1/M2: wing tilt-motor props. M4: tail lift-motor prop (VTOL only).', w: true }
      ] },
      { id: 'C', name: 'GROUND STATION & POWER-UP', items: [
        { id: 'gs-charged', s: 'All devices charged', t: 'All controllers, TX units and EcoFlow charged and ready.' },
        { id: 'gs-mast', s: 'Mast up and powered', t: 'HM30 mast erected and powered — 6S 3000mAh secured to mast.' },
        { id: 'gs-ethernet', s: 'Ethernet connected', t: 'Ethernet cable connected mast → laptop.' },
        { id: 'gs-hm30-link', s: 'HM30 linked, battery OK', t: 'HM30 ground unit linked — verify LED is blue. Check mast battery voltage.' },
        { id: 'gs-subnet', s: 'Laptop IP verified', t: 'Ethernet network adapter: static IP on the HM30 subnet.', n: 'IP `192.168.144.X`, mask `255.255.255.0`. X must not clash with any relay address (suggested `.100`; final address [[TBD — decide at bring-up]]).' },
        { id: 'gs-laptop-sleep', s: 'Laptop will not sleep', t: 'Power plan: never sleep or hibernate, on battery or mains. Lid-close action "do nothing". Laptop on mains where possible.', n: 'Mission Planner is the carrier\'s GCS heartbeat: closing MP, sleep/hibernate or a pulled cable = carrier RTL after 5 s (FS_GCS_ENABL = 2).', w: true },
        { id: 'gs-app', s: 'GCS app started', t: 'GCS companion app running. Controller detected, arm switch DISARMED, throttle low, bridge reachable (RTT shown).', n: 'The FPV pilot\'s EdgeTX radio is a USB joystick only: internal and external RF modules OFF in the GCS-RELAY model. A radio transmitting ELRS could fight the relay for the client.', w: true, auto: 'app-controller-safe' },
        { id: 'fpv-battery', s: 'Client battery connected', t: 'Client battery connected — voltage nominal (power-up step 3: VTX on, ELRS RX waiting).' },
        { id: 'build-battery-power', s: 'Battery secured & power on', t: 'Battery secured — strap tight, no movement. Connect the carrier battery at power-up **step 4**: after the HM30 ground unit (1), the laptop and GCS app — arm switch DISARMED, throttle low (2) and the client (3); the 915 Nomad comes last (8). Allow GPS fix time after step 4, before arming.', n: 'Power-up order: Manual → Procedures → Power-Up Sequence. Do not arm yet. The relay bridge stays silent (WAIT_GCS) until the GCS app stream arrives — it never sends default sticks. Final power-up order with the relay: [[TBD — confirm by bench test, plan §6.1.6]].' },
        { id: 'gs-mp-connect', s: 'Mission Planner connected', t: 'Mission Planner open — second screen via USB-C. Select **UDPCI** in MP connection dropdown. Never close MP in flight.', n: 'No other program may send MAVLink as GCS sysid 255 on this network (S-02b) — it would mask the SIYI failsafe.', extras: [{ label: 'IP', val: '192.168.144.12' }, { label: 'Port', val: '19856' }] },
        { id: 'gs-client-video', s: 'Client video viewer', t: 'Client video arrives as RTP/UDP. The GCS app receives UDP 5600 and re-sends it to `127.0.0.1:5601` (standalone viewer) and `127.0.0.1:5602` (MP HUD: right-click avionics screen → Video → Set GStreamer Source). Use the variant for the client\'s video standard: **{client.videoStandard}**.', n: 'Mission Planner holds UDP 5600 by default: while the app\'s fan-out runs, MP must NOT listen on 5600 — its HUD source uses port 5602, the standalone viewer 5601. Windows GStreamer pipelines from plan §7.4 — verify on the target laptop. No rtpjitterbuffer. mpv with the .sdp file: verify its latency matches GStreamer before relying on it.', w: true, extras: [
          { label: 'VIEWER · PAL (UDP 5601)', val: PIPE.viewerPal },
          { label: 'VIEWER · NTSC (UDP 5601)', val: PIPE.viewerNtsc },
          { label: 'MP HUD · PAL (UDP 5602)', val: PIPE.mpHudPal },
          { label: 'MP HUD · NTSC (UDP 5602)', val: PIPE.mpHudNtsc },
          { label: 'client-video.sdp (mpv)', val: SDP }
        ] },
        { id: 'gs-carrier-camera', s: 'Carrier camera (GStreamer in MP)', t: 'Carrier IP camera (`.26`, via relay switch P3). **Switch the camera on in the GCS app first** (default OFF). Verify the picture, then set it to the state planned for the sortie. MP\'s HUD takes one GStreamer source at a time.', n: PIPE.carrierCamera, copy: true, w: true }
      ] },
      { id: 'D', name: 'CARRIER DRONE', items: [
        { id: 'carrier-compass', s: 'Compass calibrated', t: 'Compass calibration — Mission Planner: Initial Setup → Mandatory Hardware → Compass → Start. Rotate through all axes. Verify no compass errors.' },
        { id: 'carrier-home', s: 'Home position set', t: 'Home position set correctly — verify on map.' },
        { id: 'carrier-mission', s: 'Mission verified', t: 'Mission loaded and verified on map — all 7 waypoints in correct positions.' },
        { id: 'carrier-failsafe-params', s: 'Failsafe params verified', t: 'Failsafe parameters verified in Mission Planner Full Parameter List. The carrier fails safe only on SIYI / GCS loss (RTL after 5 s, all modes); 915 MHz loss is ignored by design.', n: FAILSAFE_PARAMS, w: true, copy: true },
        { id: 'carrier-servo-check', s: 'Servo check (MANUAL)', t: 'Switch to MANUAL via Mission Planner GCS. Verify ailerons, elevator and rudder move fully and in correct direction. Switch back to QHOVER when done.', n: 'MANUAL must never be used in flight.', w: true },
        { id: 'carrier-mode-cycle', s: 'Mode cycle verified', t: '915 backup radio (Nomad) on, RC visible in MP. Cycle through all 3 mode-switch positions, confirm QHOVER / FBWB / AUTO update in Mission Planner. Verify tilt servos rotate forward on FBWB.' },
        { id: 'carrier-pitot-cal', s: 'Pitot calibrated, cover removed', t: 'Pitot calibration — Mission Planner: Preflight_Calibration → Do Action. Verify "Airspeed 1 calibrated" in Messages. Confirm airspeed stable and below 2 m/s. Remove pitot cover.', w: true },
        { id: 'carrier-auto-wp', s: 'Correct AUTO waypoint selected', t: 'Verify correct starting waypoint for AUTO mode. If launching without co-pilot, WP 1 must NOT be the active waypoint.', w: true },
        { id: 'carrier-bridge-run', s: 'Bridge in RUN', t: 'GCS app shows bridge state RUN, ModelID accepted, timing-frame lock (sync offset ≈ 0).', w: true, auto: 'bridge-run' },
        { id: 'carrier-camera-sortie', s: 'Camera state set for sortie', t: 'Carrier camera normally OFF before the client launches (FPV mode), unless relay-design test 9 has passed. The app must report the same state as requested.', w: true, auto: 'camera-sortie' }
      ] },
      { id: 'E', name: 'CLIENT', items: [
        { id: 'client-profile', s: 'Client profile selected', t: 'Active client profile: **{client.name}** ({client.fc}, {client.firmware}). It drives the VTX, ELRS, failsafe and battery values below — change it on the PROFILES tab.' },
        { id: 'fpv-props', s: 'Client props checked', t: 'Client props tight — correct rotation direction.', n: 'Check motor bell screws and prop nuts.' },
        { id: 'client-vtx', s: 'VTX on, correct band/channel', t: 'Client VTX on **{client.vtx.band}{client.vtx.channel} · {client.vtx.freqMHz} MHz · {client.vtx.powerMw} mW**. Video visible in the viewer, decoder lock LED on.', n: 'Must show live view — not static or blank. Expected video standard: {client.videoStandard}.', w: true, auto: 'video-lock' },
        { id: 'client-elrs', s: 'ELRS link up', t: 'Client ELRS RX ({client.elrs.band}) linked to the relay\'s ELRS TX module by binding phrase / model match — set once per client, nothing to do before each flight. The app shows client LQ/RSSI if telemetry is enabled; otherwise read LQ on the client OSD.', n: 'Telemetry needs telemetry enabled on the client FC and a non-zero ELRS telemetry ratio (profile: {client.elrs.telemetryRatio}).', w: true, auto: 'client-link' },
        { id: 'client-gps-ready', s: 'Client GPS ready', t: 'Client GPS has at least {client.failsafe.minSats} satellites.', w: true, auto: 'client-sats' },
        { id: 'client-failsafe', s: 'Client failsafe known', t: 'Client failsafe: **{client.failsafe.type}**, delay {client.failsafe.delayS} s, minimum {client.failsafe.minSats} sats. Measured total failsafe time through the relay: [[TBD — relay-design test 6, per cause]].', n: 'GPS Rescue clients: the flight mode must not show `?` (GPS Rescue configured but no fix).', w: true, auto: 'client-rescue-ready' }
      ] }
    ]
  };

  const turnaround = {
    id: 'turnaround',
    title: 'Turnaround Check',
    goText: '// GO — TURNAROUND COMPLETE — CLEAR TO ARM //',
    sections: [
      { id: 'T1', name: 'CARRIER — BATTERY & INSPECTION', items: [
        { id: 'ta-airframe', s: 'Airframe inspected', t: 'Quick visual — check tilt motor mounts, wing joins, props for damage from previous flight.' },
        { id: 'ta-battery-swap', s: 'Battery swapped', t: 'Remove used battery, record landing voltage, place on charger immediately. Install fresh battery — strap tight, verify above 25.0V.', n: 'Used batteries must be set to charge before the next flight begins.', w: true },
        { id: 'ta-power-gps', s: 'Power on, GPS acquiring', t: 'Power on carrier drone. Allow GPS to re-acquire fix before proceeding.' }
      ] },
      { id: 'T2', name: 'CARRIER — PRE-ARM', items: [
        { id: 'ta-home', s: 'Home position reset', t: 'Home position updated on map — verify correct location.' },
        { id: 'ta-mission', s: 'Mission verified', t: 'Mission still loaded and correct — all 7 waypoints in correct positions.' },
        { id: 'ta-auto-wp', s: 'Correct AUTO waypoint selected', t: 'Verify correct starting waypoint for AUTO. If no co-pilot, WP 1 must NOT be active.', w: true },
        { id: 'ta-servo-check', s: 'Servo check (MANUAL)', t: 'Switch to MANUAL via Mission Planner GCS. Verify ailerons, elevator and rudder move fully and correctly. Switch back to QHOVER when done.', n: 'MANUAL must never be used in flight.', w: true },
        { id: 'ta-pitot-cal', s: 'Pitot calibrated, cover removed', t: 'Pitot calibration — Mission Planner: Preflight_Calibration → Do Action. Verify "Airspeed 1 calibrated". Confirm airspeed below 2 m/s. Remove pitot cover.', w: true },
        { id: 'ta-mode-cycle', s: 'Mode cycle verified', t: 'Cycle all 3 mode-switch positions on the 915 backup radio. Confirm QHOVER / FBWB / AUTO in Mission Planner. Verify tilt servos rotate on FBWB.' },
        { id: 'ta-bridge-run', s: 'Bridge back in RUN', t: 'After the carrier power cycle the bridge restarts (BOOT → WAIT_GCS → START → RUN). Confirm RUN in the GCS app.', w: true, auto: 'bridge-run' },
        { id: 'ta-viewer-restart', s: 'Viewer restarted if needed', t: 'The video board restarts the stream after a carrier power cycle. Restart the viewer (GStreamer / MP HUD source) if the client picture does not return.' },
        { id: 'ta-camera', s: 'Camera re-enabled if needed', t: 'A carrier power cycle resets the camera to OFF. Re-enable it in the GCS app only if the sortie plan needs it.', auto: 'camera-sortie' }
      ] },
      { id: 'T3', name: 'CLIENT', items: [
        { id: 'ta-fpv-battery', s: 'Client battery swapped', t: 'Remove used client battery, place on charger. Install fresh pack. Verify voltage nominal.' },
        { id: 'ta-fpv-props', s: 'Client props checked', t: 'Quick visual — props undamaged, tight.' },
        { id: 'ta-client-vtx', s: 'VTX on, video confirmed', t: 'Client VTX on {client.vtx.band}{client.vtx.channel} · {client.vtx.freqMHz} MHz. Verify the client feed in the viewer.', n: 'Must show live view — not static or blank.', w: true, auto: 'video-lock' },
        { id: 'ta-client-elrs', s: 'ELRS link up', t: 'Client ELRS RX ({client.elrs.band}) linked through the relay — the binding phrase is set once, nothing to do per flight. Check LQ in the app or on the client OSD.', w: true, auto: 'client-link' }
      ] }
    ]
  };

  // ── POST-FLIGHT ── (plan §6.2.1 post-flight)
  const postflight = [
    { id: 'pf-immediate', title: 'Immediate Post-Landing', style: 'accent', steps: [
      { id: 'pf-disarm-carrier', s: 'Disarm carrier', t: 'Confirm disarmed in Mission Planner. All motors stopped. Do not approach until disarmed.' },
      { id: 'pf-disarm-client', s: 'Disarm client', t: 'Co-pilot confirms the client is disarmed. Props stopped.' },
      { id: 'pf-carrier-batt', s: 'Disconnect carrier battery', t: 'Disconnect 6S pack. All systems power down (FC, HM30 air unit, relay PCB, camera). Record landing voltage.' },
      { id: 'pf-client-batt', s: 'Disconnect client battery', t: 'Record client landing voltage.' }
    ] },
    { id: 'pf-teardown', title: 'Ground Station Teardown', steps: [
      { id: 'pf-mast-batt', s: 'Check mast battery voltage', t: 'Disconnect and measure 6S 3000mAh mast battery. Below [[21.0V]]: charge immediately, do not store discharged.' },
      { id: 'pf-app-log', s: 'Save GCS app session log', t: 'Save the GCS companion app session log (RC out, status, telemetry, alarms) for debrief, then close the app.' },
      { id: 'pf-hm30-off', s: 'Power down HM30 ground unit', t: 'Disconnect ethernet. Remove mast battery safely.' },
      { id: 'pf-mast-down', s: 'Lower and secure mast', t: 'Confirm HM30 and cabling secured before transport.' },
      { id: 'pf-mp-close', s: 'Close Mission Planner', t: 'Save log if required.' }
    ] },
    { id: 'pf-inspection', title: 'Inspection', steps: [
      { id: 'pf-airframe', s: 'Carrier airframe', t: 'Inspect tilt motor mounts, wing joins, prop blades, connectors. Check for heat or smell from ESCs/motors.' },
      { id: 'pf-carrier-pack', s: 'Carrier battery', t: 'Check for puffing, heat, damage. Store at 22.8V (3.8V/cell) if not flying within 48h. Never store discharged — BATT_CRT voltage ({settings.battCrtVolt}V) is not a storage target.' },
      { id: 'pf-relay-pcb', s: 'Relay PCB', t: 'Relay PCB temperature and smell; connector security (JST-GH, HM30 Ethernet, CRSF lead). Inspect VRX patches and the ELRS module antenna.' },
      { id: 'pf-client', s: 'Client', t: 'Inspect props, motors, frame.' }
    ] }
  ];

  // ── EMERGENCIES ── (plan §6.1.8; IMMEDIATE ≤ 6 short phrases, from memory; CLEAN-UP read from the screen)
  const emergencies = [
    { id: 'emerg-gcs', pill: 'SIYI / GCS LOSS', priority: 'primary',
      title: 'SIYI / GCS Link Loss (HM30) — primary carrier failsafe',
      summary: 'The only link whose loss triggers a carrier failsafe: no GCS heartbeat for 5 s → RTL in any mode (FS_GCS_ENABL = 2, FS_LONG_TIMEOUT = 5, FS_LONG_ACTN = 1). HM30 loss also cuts client RC and video.',
      immediate: [
        'CHECK MP · CABLE · HM30 LED',
        'SIYI LOST 5 s → [[RTL]] AUTOMATIC — ANY MODE',
        'NOMAD (915) ONLY IF CLOSE',
        'CLIENT FAILSAFE FIRES TOO',
        'CALL "CARRIER RTL" · "FPV FAILSAFE"'
      ],
      cleanup: [
        'Causes (S-02a): Mission Planner closed or crashed, laptop asleep or hibernating, Ethernet cable pulled, or HM30 link lost. Each one stops the GCS heartbeat → RTL after FS_LONG_TIMEOUT (5 s), in every mode.',
        'RTL climbs to RTL_ALTITUDE (120m REL, above home) and returns. Behaviour when RTL triggers in a Q-mode: [[TBD — check Q_RTL_MODE / Q_OPTIONS in the param file, then SITL test]].',
        'Check the Ethernet cable mast → laptop and reseat both ends. Check the HM30 ground unit LED (blue = linked). Check mast battery voltage — below 21.0V the HM30 may brown out.',
        'Restart the MP UDPCI connection: IP `192.168.144.12` / Port `19856`. Do not re-enter AUTO until GCS telemetry is stable for 30+ seconds.',
        'The client fails safe at the same time: the bridge goes silent after T_hold and the client\'s own failsafe ({client.failsafe.type}) runs. Do not rely on the carrier camera to watch the client return — it is forced OFF when the GCS stream is lost and stays off until the stream is back and the pilot re-enables it.',
        'Use the 915 backup radio only within close range. Beyond close range its loss is expected and harmless.',
        'S-02b: no other program may send GCS heartbeats as MAVLink sysid 255 (the Mission Planner default). It would keep the carrier "happy" while MP is dead and mask this failsafe. The GCS companion app never uses sysid 255.',
        'Whether the HM30 also reports RADIO_STATUS remrssi (S-02c): [[TBD — check with the MP MAVLink Inspector]]. The heartbeat timeout applies either way.'
      ] },
    { id: 'emerg-client-rc', pill: 'CLIENT RC LOSS',
      title: 'Client RC Loss — RC uplink (GCS app → HM30 → bridge → ELRS)',
      summary: 'The client stops receiving RC through the relay. Its own failsafe fires after the relay goes silent; the carrier is not affected.',
      immediate: [
        'FPV PILOT: HANDS OFF',
        'CARRIER: HOLD ORBIT',
        'CHECK GCS APP STATUS',
        'CLIENT FAILSAFE FIRES (t ≈ [[TBD — measured, test 6]])',
        'WATCH VIDEO / OSD'
      ],
      cleanup: [
        'Diagnose from the GCS app status: no packets out → app or controller · RTT gone → HM30 link · bridge FAILSAFE → bridge watchdog / T_hold (start value 250 ms) · LQ low with bridge RUN → ELRS RF: range, band, orbit geometry.',
        'Client failsafe ({client.failsafe.type}, delay {client.failsafe.delayS} s, needs {client.failsafe.minSats}+ sats). Reference client #1 GPS Rescue: climbs 30m, cruises home at 100m / 7.5 m/s [[VERIFY — Betaflight 4.5: with altitude mode CURRENT_ALT the 100 m return altitude may not apply (it is the FIXED_ALT value)]], landing phase from 4 m (gps_rescue_landing_alt) [[VERIFY — Betaflight 4.5 docs: landing-phase altitude, not a confirmed motor cut]].',
        'The carrier camera is forced off if the GCS stream was lost; re-enable it only once the stream is back.',
        'Keep the carrier on station until the client has landed — it may be returning toward its home point.',
        'Confirm the client is disarmed before anyone approaches it on the ground.',
        'Log the cause and the time to client failsafe (input for relay-design test 6).'
      ] },
    { id: 'emerg-video', pill: 'VIDEO LOSS',
      title: 'Video Loss — Client (analog RF or digital chain)',
      summary: 'Snow or noise = analog RF (client VTX → carrier VRX). Frozen or black picture without snow = digital chain (video board, HM30, viewer). RC is independent of the video board.',
      immediate: [
        'FPV PILOT: ZERO INPUTS — hover',
        'CALL "VIDEO SNOW" OR "VIDEO DIGITAL LOST"',
        'SNOW: CARRIER REDUCE RANGE',
        'WAIT 10 SECONDS',
        'STILL LOST: CLIENT RETURN HOME'
      ],
      cleanup: [
        '(a) Analog RF — snow: client VTX on {client.vtx.band}{client.vtx.channel} / {client.vtx.freqMHz} MHz? VRX patches facing inward toward the operating area? Reduce range or move the orbit.',
        '(b) Digital chain — frozen or black: check the video board (N6) decoder-lock LED, then the encoder/video board, then the HM30 link (RTT in the GCS app). The Link tab shows decoder lock if the bridge reports it.',
        'A video-board reset does not affect RC. Decision time: the 10 s wait above (current procedure value). Video-board restart / recovery time: [[TBD — measure, then review the 10 s]].',
        'Viewer restart: stop and restart the GStreamer viewer (UDP 5601) or the MP HUD source (UDP 5602). Pipelines: Pre-Flight → C → Client video viewer.',
        'Verify video in the viewer before the client re-arms.'
      ] },
    { id: 'emerg-relay-pcb', pill: 'RELAY PCB',
      title: 'Relay PCB Fault',
      summary: 'Video board (N6) and net/RC board (bridge) are independent: a video-board fault does not stop RC; a net/RC board fault stops RC and the client fails safe.',
      immediate: [
        'CHECK APP: BRIDGE STATE + VIDEO',
        'VIDEO ONLY: RC STILL WORKS — RECALL CLIENT',
        'BRIDGE DOWN: CLIENT FAILSAFE FIRES',
        'CARRIER: HOLD ORBIT',
        'END RELAY SORTIE'
      ],
      cleanup: [
        'Bridge states: BOOT → WAIT_GCS → START (ModelID ×3) → RUN. No valid packet for T_hold (start value 250 ms) → FAILSAFE (silent) → WAIT_GCS.',
        'Bridge and video-board LED patterns: [[TBD — to be defined by the relay firmware (plan §6.1.4)]].',
        'The RC path never touches the video board: RC keeps running while video reboots or is reflashed. VLAN isolation keeps camera and spare-port traffic away from the RC bridge.',
        'Carrier control (Mission Planner over the HM30 to the FC) does not pass through the relay PCB (plan §3.1). If MP telemetry also drops → SIYI / GCS LOSS card.',
        'Recall the client if the bridge does not return to RUN, FAILSAFE repeats, or video does not return.',
        'After landing: relay PCB temperature/smell, connectors, firmware versions (bridge status packet), save the app session log.'
      ] },
    { id: 'emerg-app', pill: 'APP / CONTROLLER',
      title: 'GCS App / Controller Failure',
      summary: 'Controller unplugged or app crash → the app stops sending → the bridge goes silent → client failsafe. The app never resumes by itself. Two start paths: normal start (client on the ground) and RESUME (client airborne).',
      immediate: [
        'CLIENT FAILSAFE FIRES — BRIDGE SILENT',
        'FPV PILOT: HANDS OFF',
        'CARRIER: HOLD ORBIT',
        'CLIENT AIRBORNE: NEVER NORMAL START',
        'IF TAKING OVER: RESUME ONLY — ARM SWITCH ARMED',
        'WATCH VIDEO / OSD'
      ],
      cleanup: [
        'Chain: app stops → bridge FAILSAFE after T_hold → ELRS TX module silent → client RX failsafe → client FC failsafe ({client.failsafe.type}).',
        'Client AIRBORNE: **never use the normal start**. The normal start needs the arm switch DISARMED, so its first packet would disarm the client in mid-air. The only way back is **RESUME (client airborne)**: hold the arm switch ARMED, check the live arm/throttle preview, type `RESUME` — and `THROTTLE` as well if the throttle is at minimum. The client then gets exactly the controller values.',
        'Use RESUME only if taking over is safer than letting the client\'s own failsafe ({client.failsafe.type}) finish. Otherwise leave the app stopped until the client is on the ground.',
        'Client on the GROUND (disarmed): normal start — arm switch DISARMED, throttle low (app start interlock).',
        'Mission Planner is separate: if only the app crashed, the carrier is unaffected. If the laptop froze or slept, the MP heartbeat is lost too → SIYI / GCS LOSS card.',
        'After landing: save the app session log, check the controller USB cable and the EdgeTX GCS-RELAY model (RF modules OFF).'
      ] },
    { id: 'emerg-camera', pill: 'CAMERA LOSS', priority: 'low',
      title: 'Carrier Camera Loss — low criticality',
      summary: 'Usually by design: the camera is switched by CAM_ENABLE (default OFF) and forced OFF when the GCS stream is lost.',
      immediate: [
        'LOW PRIORITY — FLY THE AIRCRAFT',
        'CHECK APP: CAMERA REQUESTED vs REPORTED',
        'GCS STREAM LOST? CAMERA OFF BY DESIGN'
      ],
      cleanup: [
        'By design? CAM_ENABLE off in the app, or forced off because the GCS stream was lost (the status packet / Link tab shows the reported camera state). Re-enable only once the stream is back.',
        'A carrier power cycle resets the camera to OFF.',
        'Then the P3 ingress rate limit at the relay switch: [[TBD — P3 limit value (plan Q13)]].',
        'Then restart the RTSP stream: MP → Video → Set GStreamer Source with the `.26` pipeline (Pre-Flight → C).',
        'Camera ON during FPV flight only if relay-design test 9 has passed.'
      ] },
    { id: 'emerg-trans', pill: 'TRANSITION',
      title: 'Transition Failure — VTOL → FW',
      summary: 'Automatic action: Q_TRANS_FAIL elapsed (4 s) → Q_TRANS_FAIL_ACT = 0 → **QLAND at the current position**, not QHOVER (ArduPlane source: -1 warn only, 0 QLand, 1 QRTL). [[VERIFY — against the firmware version and param file in use]]. Switching to QHOVER first ends the transition attempt.',
      immediate: [
        '[[QHOVER]] — switch now',
        'GAIN ALTITUDE — full VTOL power',
        'NO ACTION BY 4 s → AUTO [[QLAND]] HERE',
        'HOLD — assess before any retry'
      ],
      cleanup: [
        'Automatic action: Q_TRANS_FAIL (4 s) → Q_TRANS_FAIL_ACT = 0 → **QLAND at the current position** — not QHOVER ([[VERIFY — against the firmware version in use]]). If it has started, clear the area below; switch to QHOVER only if that spot is unsafe.',
        'Check pitot — airspeed reading in MP? Zero = blocked/disconnected. Do not retry without airspeed data.',
        'Check tilt servos — switch to FBWB and observe in MP. Do the M1/M2 tilt motors rotate forward?',
        'Check battery — sufficient for another transition attempt plus VTOL recovery?',
        'Check wind — transition into wind (airspeed builds fastest); avoid a tailwind transition.',
        'If retrying: climb to 60m+ in QHOVER first. Clear 300m corridor ahead. Monitor airspeed immediately on AUTO.',
        'Log failure phase: no airspeed build in 3s vs pitch-down upset. Note battery voltage.'
      ] },
    { id: 'emerg-batt', pill: 'BATTERY',
      title: 'Battery Critical — Carrier',
      summary: 'No BATT_LOW warning is configured. BATT_CRT_VOLT triggers Loiter → QLand at the current position, not home.',
      immediate: [
        '{settings.manualRtlVolt}V → [[RTL]] NOW — CLIENT RETURNS',
        '{settings.hardLimitVolt}V → RTL MUST BE ACTIVE',
        '{settings.battCrtVolt}V → AUTOLAND HERE — not home',
        'CLEAR AREA BELOW'
      ],
      cleanup: [
        'Call "CARRIER BATT — RTL SOON" so the FPV pilot brings the client back first; the relay ends when the carrier leaves.',
        'Log landing voltage in battery log — note start voltage and any anomalies.',
        'Inspect battery for puffing, heat, smell. If any present — quarantine, do not charge.',
        'Allow pack to cool 30 minutes minimum before charging.',
        'Review: was RTL initiated on time? Use battery log analysis to check sag vs previous flights.',
        'Set BATT_LOW_VOLT using the battery log recommendation in the Tools page.'
      ] }
  ];

  // Notes shown with the emergencies but NOT emergency cards (plan §4 S-01, §6.1.8).
  const emergencyNotes = [
    { id: 'note-915-lost', kind: 'note', pill: '915 BACKUP LOST',
      title: '915 MHz backup link lost — note, not an emergency',
      text: 'Beyond close range: **expected, no action**. The carrier ignores RC while it is absent (THR_FAILSAFE = 2) and continues under Mission Planner control over the SIYI link.',
      closeIn: {
        title: 'Close-in case: 915 lost during a manual takeoff or landing on the Nomad',
        steps: ['TAKE OVER IN MP — [[QLOITER]] / [[QLAND]]'],
        note: 'What QHOVER does when the 915 link drops during a manual phase: [[TBD — S-01a bench/SITL test result]].'
      } }
  ];

  // ── FAILSAFE TABLE ── (plan §6.1.5)
  const failsafeTable = {
    id: 'failsafe-table',
    columns: ['Event', 'Detection', 'Carrier action', 'Pilot action'],
    rows: [
      { id: 'fs-siyi', primary: true, event: '**SIYI / Mission Planner link lost**', detection: 'No GCS heartbeat for `FS_LONG_TIMEOUT` = 5 s (plus HM30 `remrssi = 0` if the HM30 reports it), **all modes**', action: '`FS_LONG_ACTN` = 1 → **[[RTL]]** (Q-mode behaviour: [[TBD — per param file + SITL test]])', pilot: 'Monitor; use the Nomad only if within close range' },
      { id: 'fs-915', event: '915 MHz backup link lost', detection: 'ELRS RX failsafe', action: '**None** — RC ignored (`THR_FAILSAFE` = 2)', pilot: 'None beyond close range; during manual phases, take over in MP (S-01a)' },
      { id: 'fs-batt-crit', event: 'Battery critical {settings.battCrtVolt} V', detection: '`BATT_CRT_VOLT`', action: 'Loiter → QLand at current position', pilot: 'Clear the area below' },
      { id: 'fs-batt-low', event: 'Battery low', detection: '`BATT_LOW_VOLT` = 0 (not set)', action: 'None', pilot: 'Manual RTL at {settings.manualRtlVolt} V' },
      { id: 'fs-trans', event: 'Transition fail', detection: '`Q_TRANS_FAIL` 4 s', action: '`Q_TRANS_FAIL_ACT` = 0 → **[[QLAND]] at current position** (ArduPlane source: -1 warn only, 0 QLand, 1 QRTL; [[VERIFY — against the firmware version in use]])', pilot: 'Switch to [[QHOVER]] and climb (emergency card); if QLand has started, clear the area below' }
    ]
  };

  // Client failsafe chain through the relay (plan §6.1.5 "New: client failsafe chain").
  const clientFailsafeChain = {
    id: 'client-failsafe-chain',
    title: 'Client failsafe chain',
    steps: [
      'GCS app stops sending, **or** the HM30 link is lost, **or** the bridge watchdog fires',
      'Bridge goes silent after T_hold (start value 250 ms)',
      'ELRS TX module stops sending ([[TBD — behaviour to be measured]])',
      'Client RX failsafe',
      'Client FC failsafe ({client.failsafe.type})'
    ],
    total: 'Total time = [[TBD — measured, relay-design test 6, per cause]]',
    note: 'The relay never sends default sticks at boot: the bridge waits for 5 valid packets before any CRSF.'
  };

  // ── NETWORK ── (plan §3.3 — proposed, confirm before flight; ports per contracts C2/C3)
  const network = {
    id: 'network',
    title: 'Network and port map (proposed — confirm before flight)',
    columns: ['Device', 'IP', 'Port / protocol', 'Direction', 'Notes'],
    rows: [
      { id: 'net-laptop', device: 'Laptop', ip: '`192.168.144.X` / 24', port: '—', dir: '—', notes: 'Static IP. **X must not clash** with any address below. Suggested `.100`; final [[TBD — decide at bring-up]].' },
      { id: 'net-hm30-air', device: 'HM30 air unit', ip: '`192.168.144.11`', port: '—', dir: '—', notes: 'Unchanged' },
      { id: 'net-hm30-ground', device: 'HM30 ground unit', ip: '`192.168.144.12`', port: 'UDP 19856 (MAVLink)', dir: '↔', notes: 'Unchanged; Mission Planner UDPCI' },
      { id: 'net-camera', device: 'IP camera', ip: '`192.168.144.26`', port: 'RTSP 8554 `/main.264`', dir: 'camera → GCS', notes: 'Via relay switch **P3**. VLAN: reaches only P1. Ingress rate-limited ([[TBD — limit value]]). **Only passes traffic while `CAM_ENABLE` = 1** in the GCS RC stream.' },
      { id: 'net-spare', device: 'Spare port', ip: '—', port: '—', dir: '—', notes: 'Switch **P4** (JST-GH). VLAN: reaches only P1. What may be connected and its bandwidth cap: [[TBD]].' },
      { id: 'net-n6', device: 'N6 video board', ip: '[[TBD — e.g. .20]]', port: 'RTP/UDP **5600** at the GCS', dir: 'carrier → GCS', notes: 'Destination IP and port stored in N6 flash' },
      { id: 'net-bridge', device: 'RC bridge (W5500)', ip: '[[TBD — e.g. .21]]', port: 'UDP **5770** at the bridge', dir: 'GCS → carrier (RC); carrier → GCS (status + CRSF telemetry)', notes: '36-byte `rc_up` packets at 200–250 Hz; replies go to the source IP:port of the latest valid `rc_up`' },
      { id: 'net-fanout', device: 'GCS app video fan-out', ip: '`127.0.0.1`', port: 'UDP **5601** (viewer) · **5602** (MP HUD)', dir: 'app → local viewers', notes: 'Only one Windows process can bind UDP 5600: the GCS app receives it and re-sends locally. Mission Planner must not listen on 5600 while the fan-out runs (MP HUD on 5602).' },
      { id: 'net-api', device: 'GCS app local API', ip: '`127.0.0.1`', port: 'HTTP **47800** (`/api/v1/…`)', dir: 'app → browser', notes: 'Read-only status for the Tools Link tab and the map' }
    ]
  };

  // ── CALLOUTS ── (manual callouts updated + plan §6.1.6, §6.1.9, §14.2)
  const callouts = {
    id: 'callouts',
    intro: 'Both pilots are co-located at all times. All in-flight communication is **direct verbal only**. One to five words per call; the recipient acknowledges with "COPY" or by repeating the key word. With the relay, the GCS app raises the client alarms — the callout phrase is the same.',
    groups: [
      { id: 'co-prearm', title: 'Pre-Arm & Setup', rows: [
        { id: 'co-power-on', trigger: 'Carrier powered on, GPS acquiring', who: 'Carrier Pilot', call: 'CARRIER POWER ON' },
        { id: 'co-mp-live', trigger: 'MP connected, telemetry live', who: 'Carrier Pilot', call: 'MP LIVE' },
        { id: 'co-fpv-ready', trigger: 'Client ELRS linked through the relay (bridge RUN), video in the viewer', who: 'FPV Pilot', call: 'FPV READY' },
        { id: 'co-checklist-go', trigger: 'Preflight checklist GO', who: 'Carrier Pilot', call: 'CHECKLIST GO' },
        { id: 'co-fpv-go', trigger: 'FPV Pilot ready to fly', who: 'FPV Pilot', call: 'FPV GO' },
        { id: 'co-arming', trigger: 'Both GO — about to arm carrier', who: 'Carrier Pilot', call: 'ARMING' },
        { id: 'co-armed', trigger: 'Carrier armed confirmed in MP', who: 'FPV Pilot (monitors MP)', call: 'ARMED' }
      ] },
      { id: 'co-takeoff', title: 'Takeoff & Transition', rows: [
        { id: 'co-taking-off', trigger: 'VTOL takeoff / mission start', who: 'Carrier Pilot', call: 'TAKING OFF' },
        { id: 'co-stable', trigger: 'Carrier airborne, stable hover', who: 'FPV Pilot (monitors MP)', call: 'STABLE' },
        { id: 'co-transitioning', trigger: 'Transition commencing', who: 'Carrier Pilot', call: 'TRANSITIONING' },
        { id: 'co-clean-transition', trigger: 'Airspeed >11 m/s, wings level', who: 'FPV Pilot (monitors MP)', call: 'CLEAN TRANSITION' },
        { id: 'co-advancing-wp', trigger: 'Co-pilot advancing mission WP1→WP2', who: 'FPV Pilot', call: 'ADVANCING WAYPOINT' },
        { id: 'co-transition-fail', trigger: 'No airspeed build within 3 s', who: 'Either pilot', call: 'TRANSITION FAIL — QHOVER', note: 'Carrier Pilot acts immediately' },
        { id: 'co-on-station', trigger: 'Carrier at relay altitude, loitering', who: 'FPV Pilot (monitors MP)', call: 'CARRIER ON STATION' }
      ] },
      { id: 'co-relay', title: 'Relay Operations', rows: [
        { id: 'co-fpv-airborne', trigger: 'Client armed and airborne', who: 'FPV Pilot', call: 'FPV AIRBORNE' },
        { id: 'co-relay-solid', trigger: 'Relay confirmed stable: bridge RUN, client LQ good, clean video', who: 'FPV Pilot', call: 'RELAY SOLID' },
        { id: 'co-rc-degraded', trigger: 'GCS app status bar: RTT or uplink loss above the alarm thresholds ([[TBD — thresholds, plan §7.5]])', who: 'FPV Pilot', call: 'RC LINK DEGRADED' },
        { id: 'co-link-weak', trigger: 'Client LQ <70% or RSSI < -90dBm', who: 'FPV Pilot', call: 'FPV LINK WEAK' },
        { id: 'co-bridge-failsafe', trigger: 'Bridge state FAILSAFE in the GCS app', who: 'FPV Pilot', call: 'BRIDGE FAILSAFE' },
        { id: 'co-app-down', trigger: 'GCS app closed or crashed, or controller disconnected', who: 'FPV Pilot', call: 'APP DOWN' },
        { id: 'co-video-snow', trigger: 'Client video turns to snow / noise (analog RF)', who: 'FPV Pilot', call: 'VIDEO SNOW' },
        { id: 'co-video-digital', trigger: 'Client picture frozen or black without snow (video board / HM30 / viewer)', who: 'FPV Pilot', call: 'VIDEO DIGITAL LOST' },
        { id: 'co-fpv-batt', trigger: 'Client battery at its low threshold (Reference client #1: 21.0V, 3.5V/cell)', who: 'FPV Pilot', call: 'FPV BATT LOW — RETURNING', note: 'Begin return immediately' },
        { id: 'co-sats-low', trigger: 'Client GPS sats below {client.failsafe.minSats}', who: 'FPV Pilot', call: 'FPV SATS LOW', note: 'GPS Rescue may not work' },
        { id: 'co-fpv-rth', trigger: 'Client flight mode RTH (GPS Rescue / return active)', who: 'FPV Pilot', call: 'FPV RTH' },
        { id: 'co-telemetry-lost', trigger: 'No client telemetry for > 2 s while the app streams RC in FPV mode', who: 'FPV Pilot', call: 'FPV TELEMETRY LOST' },
        { id: 'co-camera-on', trigger: 'Carrier camera switched on — Carrier Pilot requests, FPV Pilot confirms the client is in a stable hover or landed', who: 'Carrier Pilot', call: 'CAMERA ON' },
        { id: 'co-camera-off', trigger: 'Carrier camera switched off', who: 'Carrier Pilot', call: 'CAMERA OFF' },
        { id: 'co-carrier-batt', trigger: 'Carrier battery at {settings.manualRtlVolt}V', who: 'Carrier Pilot', call: 'CARRIER BATT — RTL SOON', note: 'FPV Pilot initiates the client return' },
        { id: 'co-fpv-returning', trigger: 'Client heading back to home', who: 'FPV Pilot', call: 'FPV RETURNING' },
        { id: 'co-fpv-landed', trigger: 'Client landed and disarmed', who: 'FPV Pilot', call: 'FPV LANDED' }
      ] },
      { id: 'co-recovery', title: 'Carrier Recovery', rows: [
        { id: 'co-carrier-rtl', trigger: 'Initiating carrier RTL', who: 'Carrier Pilot', call: 'CARRIER RTL' },
        { id: 'co-back-transition', trigger: 'Carrier back-transitioning', who: 'Carrier Pilot', call: 'BACK-TRANSITIONING' },
        { id: 'co-descending', trigger: 'Carrier in final VTOL descent', who: 'Carrier Pilot', call: 'DESCENDING' },
        { id: 'co-zone-clear', trigger: 'Landing zone clear, all clear below', who: 'FPV Pilot', call: 'ZONE CLEAR' },
        { id: 'co-landed', trigger: 'Carrier touchdown', who: 'Carrier Pilot', call: 'LANDED' },
        { id: 'co-safe', trigger: 'Carrier disarmed, props stopped', who: 'Carrier Pilot', call: 'SAFE' }
      ] }
    ],
    abort: {
      id: 'co-abort', title: 'Either Pilot May Call an Abort',
      text: 'Any abort call is acted on immediately by the Carrier Pilot — no discussion in the air. Debrief after landing.',
      rows: [
        { id: 'co-abort-abort', call: 'ABORT ABORT ABORT', meaning: 'Full mission abort. Carrier Pilot: QHOVER if in VTOL phase, or RTL if in cruise. FPV Pilot: land the client immediately or send it home.' },
        { id: 'co-carrier-rtl-now', call: 'CARRIER RTL NOW', meaning: 'Carrier emergency RTL — Carrier Pilot activates by any means available: Mission Planner, or the 915 backup radio\'s RTL button when within close range.' },
        { id: 'co-fpv-failsafe', call: 'FPV FAILSAFE', meaning: 'Client failsafe active (flight mode `!FS!`). Carrier Pilot holds orbit. FPV Pilot watches video / OSD — **hands off the controller**.' },
        { id: 'co-clear-zone', call: 'CLEAR THE ZONE', meaning: 'Aircraft descending into landing zone — all personnel move clear immediately, no exceptions.' }
      ]
    }
  };

  return {
    version: 1,
    designIntent,
    checklists: { preflight, turnaround },
    postflight,
    emergencies,
    emergencyNotes,
    failsafeTable,
    clientFailsafeChain,
    network,
    callouts,
    pipelines: PIPE,
    sdp: SDP,
    failsafeParams: FAILSAFE_PARAMS
  };
});
