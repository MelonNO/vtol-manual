'use strict';
// WP10 rework F1/F2: the CI steps that pipe test output must fail when a test fails. The step scripts are taken
// VERBATIM from .github/workflows/ci.yml and run on throw-away trees with a failing / passing test.
//   - bash step (jsdom tests): run with plain `bash -e` (GitHub's default, no pipefail) — it must protect itself.
//   - pwsh step (pytest ×5, Windows only): run the way GitHub's pwsh shell runs it ($ErrorActionPreference = 'stop'
//     first, `exit $LASTEXITCODE` last). Needs a Python with pytest: $VTOL_PYTHON or `python` (see notHere()).
// Plus a static rule over every workflow: a bash step that pipes output sets pipefail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, readText } = require('../repo-files.js');

const WF = path.join(ROOT, '.github', 'workflows');

// Steps of a workflow file: [{ name, shell, run, job, runsOn }] — a small line-based reader for our own files.
function steps(file) {
  const lines = readText(path.join('.github', 'workflows', file)).split('\n');
  const out = [];
  let job = null, runsOn = null, cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^ {2}([\w-]+):\s*$/.exec(l)) && lines.slice(0, i).some(x => /^jobs:/.test(x))) { job = m[1]; runsOn = null; continue; }
    if ((m = /^ {4}runs-on:\s*(\S+)/.exec(l))) { runsOn = m[1]; continue; }
    if ((m = /^ {6}- (?:name|run|uses):/.exec(l))) { cur = { name: '', shell: null, run: '', job, runsOn }; out.push(cur); }
    if (!cur) continue;
    if ((m = /^ {6}(?:- )?name:\s*(.*)$/.exec(l))) cur.name = m[1];
    if ((m = /^ {8}shell:\s*(\S+)/.exec(l))) cur.shell = m[1];
    if ((m = /^ {6}(?:- | {2})run:\s*(.*)$/.exec(l))) {
      if (m[1] === '|' || m[1] === '>') {                                  // block scalar: the more-indented lines
        const body = [];
        for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || /^ {10}/.test(lines[j])); j++) body.push(lines[j].slice(10));
        cur.run = (m[1] === '>' ? body.join(' ') : body.join('\n')).trim() + '\n';
      } else cur.run = m[1] + '\n';
    }
  }
  return out;
}
const step = (file, prefix) => {
  const s = steps(file).find(x => x.name.startsWith(prefix));
  assert.ok(s, 'step not found: ' + prefix);
  return s;
};
function tmpTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-wf-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
// The child `node --test` must not think it runs inside this test run (node:test sets NODE_TEST_CONTEXT).
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}
// Where a step cannot run (no bash; the pwsh step off Windows or without pytest) the test reports a diagnostic and
// passes, so the CI rule "no skipped test with jsdom" stays about jsdom. The python-windows CI job runs this file with
// VTOL_REQUIRE_WORKFLOW_TEST=1, where an unavailable tool is a failure instead.
function notHere(t, why) {
  if (process.env.VTOL_REQUIRE_WORKFLOW_TEST === '1') assert.fail('cannot run this check here: ' + why);
  t.diagnostic('not run here: ' + why);
}
const bashOk = () => spawnSync('bash', ['-c', 'exit 0']).status === 0;

test('static: every bash step that pipes output sets pipefail (GitHub default `bash -e` has none)', () => {
  for (const file of fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f))) {
    for (const s of steps(file)) {
      const isPwsh = s.shell === 'pwsh' || s.shell === 'powershell' || (!s.shell && /windows/.test(s.runsOn || ''));
      if (!s.run || isPwsh) continue;
      const code = s.run.replace(/'[^'\n]*'|"[^"\n]*"/g, '""');      // ignore | inside quoted strings
      if (/(^|[^|])\|(?!\|)/m.test(code)) {
        assert.match(s.run, /set -o pipefail|set -[a-z]*o pipefail/, `${file} "${s.name}" pipes output without pipefail`);
      }
    }
  }
  assert.equal(step('ci.yml', 'All unit tests with jsdom').shell, 'bash');
});

test('bash step "All unit tests with jsdom", verbatim under `bash -e`: a failing test fails it, a skipped test fails it, all passing passes', t => {
  if (!bashOk()) { notHere(t, 'bash not available'); return; }
  const s = step('ci.yml', 'All unit tests with jsdom');
  const run = (files) => {
    const dir = tmpTree({ ...files, 'test/index.js': "require('./a.test.js');\n", 'ci-step.sh': s.run });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-rt-'));
    try {
      const r = spawnSync('bash', ['-e', 'ci-step.sh'], {
        cwd: dir, encoding: 'utf8',
        env: childEnv({ RUNNER_TEMP: tmp.replace(/\\/g, '/'), VTOL_JSDOM: '',
          PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH })
      });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true }); }
  };
  const fail = run({ 'test/a.test.js': "require('node:test')('deliberately failing', () => { throw new Error('x'); });\n" });
  assert.notEqual(fail.status, 0, 'a failing test must fail the step:\n' + fail.out);
  assert.match(fail.out, /ℹ fail 1|# fail 1/);
  const skip = run({ 'test/a.test.js': "require('node:test')('skipped', t => t.skip('no jsdom'));\n" });
  assert.notEqual(skip.status, 0, 'a skipped test must fail the step:\n' + skip.out);
  assert.match(skip.out, /tests were skipped although jsdom is installed/);
  const ok = run({ 'test/a.test.js': "require('node:test')('passes', () => {});\n" });
  assert.equal(ok.status, 0, ok.out);
});

// A Python with pytest for the pwsh-step test, or null.
function pythonWithPytest() {
  for (const py of [process.env.VTOL_PYTHON, 'python'].filter(Boolean)) {
    if (spawnSync(py, ['-c', 'import pytest'], { encoding: 'utf8' }).status === 0) return py;
  }
  return null;
}

test('pwsh step "pytest gcs protocol, five consecutive runs", verbatim as GitHub runs it: fails on a failing test, annotates only the test id', t => {
  if (process.platform !== 'win32') { notHere(t, 'Windows PowerShell step: checked by the python-windows CI job'); return; }
  const py = pythonWithPytest();
  if (!py) { notHere(t, 'no Python with pytest (set VTOL_PYTHON)'); return; }
  const s = step('ci.yml', 'pytest gcs protocol, five consecutive runs');
  assert.equal(s.shell, 'pwsh');
  // GitHub's pwsh template: $ErrorActionPreference = 'stop' before, exit $LASTEXITCODE after the script
  const script = "$ErrorActionPreference = 'stop'\n" + s.run + "if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n";
  const run = testPy => {
    const dir = tmpTree({ 'gcs/tests/test_f.py': testPy, 'protocol/README.md': 'x\n', 'ci-step.ps1': script });
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-py-'));
    try {
      // the step calls `python`: point it at the Python that has pytest
      fs.writeFileSync(path.join(bin, 'python.cmd'), '@"' + (path.isAbsolute(py) ? py : 'py') + '" %*\r\n');
      const env = { ...process.env, PATH: (path.isAbsolute(py) ? bin + path.delimiter : '') + process.env.PATH };
      const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'ci-step.ps1'], { cwd: dir, encoding: 'utf8', env });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), logs: fs.readdirSync(path.join(dir, 'pytest-logs')).length };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); }
  };
  const failing = 'import logging\n\ndef test_ok():\n    pass\n\ndef test_bad():\n'
    + '    for i in range(12):\n        logging.getLogger("vtolgcs.sender").error("noise %d", i)\n    assert 1 == 2\n';
  const f = run(failing);
  assert.notEqual(f.status, 0, 'a failing test must fail the step:\n' + f.out);
  assert.equal(f.logs, 5, 'all five runs keep their log');
  const ann = f.out.split(/\r?\n/).filter(l => l.startsWith('::error::'));
  assert.deepEqual(ann, [
    '::error::gcs/tests/test_f.py::test_bad failed in run(s) 1, 2, 3, 4, 5 of 5',
    '::error::pytest failed in run(s) 1, 2, 3, 4, 5 of 5 (1 distinct failing test id(s)); full logs: artifact pytest-logs-windows'
  ], 'only the test id and the summary are annotated (no captured log lines):\n' + f.out);
  const p = run('def test_ok():\n    pass\n');
  assert.equal(p.status, 0, p.out);
  assert.equal(p.logs, 5);
});
