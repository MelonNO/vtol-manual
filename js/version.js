// Version stamp shared by all pages (contract C4).
// app: software version · content: date of the last operational-content review · paramFile: ArduPlane param file the content was checked against.
(function (root) {
  const VTOL_VERSION = { app: '2.0.0-dev', content: '2026-10-16', paramFile: 'TBD' };
  if (typeof module === 'object' && module.exports) module.exports = VTOL_VERSION;
  else root.VTOL_VERSION = VTOL_VERSION;
})(typeof self !== 'undefined' ? self : this);
