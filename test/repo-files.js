'use strict';
// Shared by every test that reads repository files as text. A Windows checkout may have CRLF
// line endings (core.autocrlf=true, or a clone made before .gitattributes forced LF), so text is
// normalised to LF here: regexes over file text then behave as on GitHub Pages / CI (LF).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// CRLF -> LF.
function toLf(s) {
  return s.replace(/\r\n/g, '\n');
}

// A repository file as LF text; `rel` is relative to the repo root (or absolute).
function readText(rel) {
  return toLf(fs.readFileSync(path.resolve(ROOT, rel), 'utf8'));
}

module.exports = { ROOT, toLf, readText };
