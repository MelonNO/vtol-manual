// Entry point for `node --test test/`. Node 24 resolves a directory argument as a module
// (test/index.js) instead of searching it, so this file loads every *.test.js below test/.
// (`node --test "test/**/*.test.js"` runs the same tests without this file.)
const fs = require('node:fs');
const path = require('node:path');

(function load(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'fixtures' && e.name !== 'node_modules') load(p); }
    else if (e.name.endsWith('.test.js')) require(p);
  }
})(__dirname);
