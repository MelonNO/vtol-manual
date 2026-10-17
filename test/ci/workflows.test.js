'use strict';
// WP10 rework F1/F2: the CI steps that pipe test output must fail when a test fails. The step scripts are taken
// VERBATIM from .github/workflows/ci.yml and run on throw-away trees with a failing / passing test.
//   - bash step (jsdom tests): run with plain `bash -e` (GitHub's default, no pipefail) — it must protect itself.
//   - pwsh step (pytest ×5, Windows only): run the way GitHub's pwsh shell runs it ($ErrorActionPreference = 'stop'
//     first, `exit $LASTEXITCODE` last). Needs a Python with pytest: $VTOL_PYTHON or `python` (see notHere()).
// Plus a static rule over every workflow: a bash step that pipes output sets pipefail.
// WP17: static rules for the pytest steps (verbose, unbuffered, a step timeout below the job timeout, the
// headless-safe marker expression in the build), the job timeouts, pinned runner images and the action majors that
// run on Node 24; and the pwsh step on a tree with a hanging test (the real gcs/conftest.py watchdog must name,
// dump and fail it, and the step must annotate its id).
// WP18: the trees carry the real gcs/pyproject.toml, so pytest's rootdir is gcs/ as on GitHub (test ids "tests/...":
// the WP17 regexes expected "gcs/..." and annotated nothing on the real runner). Every failed id is annotated, also
// when the session dies after the failure; a GIL hang in a fixture teardown is annotated (verify F-A).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, readText } = require('../repo-files.js');

const WF = path.join(ROOT, '.github', 'workflows');
const workflowFiles = () => fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f));

// Steps of a workflow file: [{ name, shell, run, job, runsOn, jobTimeout, uses, timeout, env, if }] — a small
// line-based reader for our own files.
function steps(file) {
  const lines = readText(path.join('.github', 'workflows', file)).split('\n');
  const jobTimeouts = {};
  let job = null;
  for (const l of lines) {                                          // first pass: job timeouts (any order of keys)
    let m;
    if ((m = /^ {2}([\w-]+):\s*$/.exec(l))) job = m[1];
    else if (job && (m = /^ {4}timeout-minutes:\s*(\d+)/.exec(l))) jobTimeouts[job] = Number(m[1]);
  }
  const out = [];
  let runsOn = null, cur = null, inEnv = false;
  job = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^ {2}([\w-]+):\s*$/.exec(l)) && lines.slice(0, i).some(x => /^jobs:/.test(x))) {
      job = m[1]; runsOn = null; cur = null; continue;
    }
    if ((m = /^ {4}runs-on:\s*(\S+)/.exec(l))) { runsOn = m[1]; continue; }
    if ((m = /^ {6}- (?:name|run|uses):/.exec(l))) {
      cur = { name: '', shell: null, run: '', job, runsOn, jobTimeout: jobTimeouts[job] ?? null, uses: null,
        timeout: null, env: {}, if: null };
      out.push(cur);
    }
    if (!cur) continue;
    if (/^ {6}- /.test(l) || /^ {8}[\w-]+:/.test(l)) inEnv = /^ {8}env:\s*$/.test(l);
    else if (inEnv && (m = /^ {10}([\w-]+):\s*'?([^']*?)'?\s*$/.exec(l))) cur.env[m[1]] = m[2];
    if ((m = /^ {6}(?:- )?name:\s*(.*)$/.exec(l))) cur.name = m[1];
    if ((m = /^ {6}(?:- | {2})uses:\s*(\S+)/.exec(l))) cur.uses = m[1];
    if ((m = /^ {8}shell:\s*(\S+)/.exec(l))) cur.shell = m[1];
    if ((m = /^ {8}timeout-minutes:\s*(\d+)/.exec(l))) cur.timeout = Number(m[1]);
    if ((m = /^ {8}if:\s*(.*)$/.exec(l))) cur.if = m[1];
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
  for (const file of workflowFiles()) {
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

// WP17 R2: a hanging test must be visible in the live job log, and the logs must still be uploaded after a hang.
test('static (WP17 R2): every pytest step is verbose and unbuffered, with a step timeout below its job timeout', () => {
  const pytestSteps = workflowFiles().flatMap(f => steps(f).map(s => ({ ...s, file: f }))).filter(s => /-m pytest\b/.test(s.run));
  assert.ok(pytestSteps.length >= 3, 'expected the pytest steps of ci.yml and gcs-build.yml');
  for (const s of pytestSteps) {
    const where = `${s.file} "${s.name}"`;
    for (const cmd of s.run.split('\n').filter(l => /-m pytest\b/.test(l))) {
      const verbose = /\s-v\b/.test(cmd) || (/\s-rA\b/.test(cmd) && /--durations/.test(cmd));
      assert.ok(verbose, `${where}: pytest needs -v (or -rA plus --durations) so the running test is named: ${cmd}`);
      assert.ok(!/\s-q\b/.test(cmd), `${where}: -q hides the test names: ${cmd}`);
      const unbuffered = /python3?(\.exe)?\s+-u\s+-m pytest/.test(cmd) || s.env.PYTHONUNBUFFERED === '1';
      assert.ok(unbuffered, `${where}: pytest output must be unbuffered (python -u or PYTHONUNBUFFERED=1): ${cmd}`);
    }
    assert.ok(s.timeout, `${where}: no step timeout-minutes`);
    assert.ok(s.jobTimeout && s.timeout < s.jobTimeout,
      `${where}: step timeout ${s.timeout} must be below the job timeout ${s.jobTimeout}`);
  }
  // the Windows suites keep their logs (and the watchdog's stack dumps) after a failure or a hang
  for (const [file, prefix] of [['ci.yml', 'pytest gcs protocol, five consecutive runs'],
    ['gcs-build.yml', 'Tests, headless-safe suite']]) {
    const all = steps(file);
    const i = all.findIndex(x => x.name.startsWith(prefix));
    assert.ok(i >= 0, prefix);
    assert.equal(all[i].env.VTOLGCS_TEST_DUMP_DIR, 'pytest-logs', `${file}: stack dumps go to the uploaded folder`);
    const upload = all.slice(i + 1).find(x => /^actions\/upload-artifact@/.test(x.uses || '') && x.if === 'always()');
    assert.ok(upload, `${file}: an upload-artifact step with if: always() follows "${prefix}"`);
  }
});

test('static (WP17 R5): job timeouts; the build tests the headless-safe suite, the ×5 job the full suite', () => {
  assert.ok(step('gcs-build.yml', 'Tests, headless-safe suite').jobTimeout <= 30, 'GCS build job timeout must be <= 30 min');
  assert.ok(step('ci.yml', 'pytest gcs protocol, five consecutive runs').jobTimeout <= 45, 'CI Windows job timeout must be <= 45 min');
  for (const file of workflowFiles()) {
    const jobsWithout = [...new Set(steps(file).filter(s => !s.jobTimeout).map(s => s.job))];
    assert.deepEqual(jobsWithout, [], `${file}: every job has timeout-minutes`);
  }
  assert.match(step('gcs-build.yml', 'Tests, headless-safe suite').run, /-m pytest gcs protocol -m "not interactive_desktop" /);
  const five = step('ci.yml', 'pytest gcs protocol, five consecutive runs').run;
  assert.match(five, /for \(\$i = 1; \$i -le 5; \$i\+\+\)/);
  assert.doesNotMatch(five, /-m "?not interactive_desktop/, 'the ×5 job runs the full suite (the tests skip themselves)');
});

// WP17 R8: the current majors of the GitHub actions, all on the Node 24 runtime (verified on the release pages and in
// each tag's action.yml on 2026-10-17; the workflow headers cite them). An older major must not come back silently.
const ACTION_MAJORS = {
  'actions/checkout': 'v7', 'actions/setup-node': 'v7', 'actions/setup-python': 'v7',
  'actions/upload-artifact': 'v7', 'actions/download-artifact': 'v8'
};
test('static (WP17 R8): actions pinned to their Node 24 majors (release page cited); runner images pinned', () => {
  const seen = new Set();
  for (const file of workflowFiles()) {
    const text = readText(path.join('.github', 'workflows', file));
    for (const m of text.matchAll(/^\s*(?:- )?uses:\s*([\w.-]+\/[\w.-]+)@(\S+)/gm)) {
      assert.ok(m[1] in ACTION_MAJORS, `${file}: ${m[1]} has no verified major in this test: add it (Node 24 runtime)`);
      assert.equal(m[2], ACTION_MAJORS[m[1]], `${file}: ${m[1]}@${m[2]} (expected @${ACTION_MAJORS[m[1]]})`);
      const cite = new RegExp(`^#.*${m[1].replace('/', '\\/')}@${m[2]}\\s+https://github\\.com/${m[1]}/releases`, 'm');
      assert.match(text, cite, `${file}: the header comment cites the release page of ${m[1]}@${m[2]}`);
      seen.add(m[1]);
    }
    for (const m of text.matchAll(/^\s*runs-on:\s*(\S+)/gm)) {
      assert.match(m[1], /^(ubuntu-24\.04|windows-2025)$/, `${file}: runs-on ${m[1]} (pinned images, not *-latest)`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(ACTION_MAJORS).sort());
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

// GitHub runs `shell: pwsh` with PowerShell 7; use it when it is installed (the runners have it), else Windows
// PowerShell 5.1 (WP17 verify F5: native-stderr and Tee-Object encoding details differ between the two).
let psExe = null;
function powershell(t) {
  if (psExe === null) psExe = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'pwsh' : 'powershell';
  if (psExe !== 'pwsh') t.diagnostic('pwsh (PowerShell 7) not installed: the step runs under Windows PowerShell 5.1');
  return psExe;
}

test('pwsh step "pytest gcs protocol, five consecutive runs", verbatim as GitHub runs it: fails on a failing or hanging test, annotates only the test id', t => {
  if (process.platform !== 'win32') { notHere(t, 'Windows PowerShell step: checked by the python-windows CI job'); return; }
  const py = pythonWithPytest();
  if (!py) { notHere(t, 'no Python with pytest (set VTOL_PYTHON)'); return; }
  const ps = powershell(t);
  const five = step('ci.yml', 'pytest gcs protocol, five consecutive runs');
  assert.equal(five.shell, 'pwsh');
  // GitHub's pwsh template: $ErrorActionPreference = 'stop' before, exit $LASTEXITCODE after the script
  const pwshScript = s => "$ErrorActionPreference = 'stop'\n" + s.run + "if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n";
  const run = (testPy, extraFiles = {}, extraEnv = {}, s = five) => {
    const dir = tmpTree({ 'gcs/tests/test_f.py': testPy, 'gcs/pyproject.toml': readText('gcs/pyproject.toml'),
      'protocol/README.md': 'x\n', 'ci-step.ps1': pwshScript(s), ...extraFiles });
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-py-'));
    try {
      // the step calls `python`: point it at the Python that has pytest; the step's env: block applies too
      fs.writeFileSync(path.join(bin, 'python.cmd'), '@"' + (path.isAbsolute(py) ? py : 'py') + '" %*\r\n');
      const env = { ...process.env, ...s.env, ...extraEnv,
        PATH: (path.isAbsolute(py) ? bin + path.delimiter : '') + process.env.PATH };
      const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'ci-step.ps1'], { cwd: dir, encoding: 'utf8', env });
      const logs = fs.readdirSync(path.join(dir, 'pytest-logs'));
      const dumps = logs.includes('pytest-timeouts.txt')
        ? fs.readFileSync(path.join(dir, 'pytest-logs', 'pytest-timeouts.txt'), 'utf8') : '';
      return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), logs: logs.filter(f => /^(run-\d|build-tests)\.txt$/.test(f)).length, dumps };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); }
  };
  const annotations = out => out.split(/\r?\n/).filter(l => l.startsWith('::error::'));
  const failing = 'import logging\n\ndef test_ok():\n    pass\n\ndef test_bad():\n'
    + '    for i in range(12):\n        logging.getLogger("vtolgcs.sender").error("noise %d", i)\n    assert 1 == 2\n';
  const f = run(failing);
  assert.notEqual(f.status, 0, 'a failing test must fail the step:\n' + f.out);
  assert.equal(f.logs, 5, 'all five runs keep their log');
  assert.deepEqual(annotations(f.out), [
    '::error::gcs/tests/test_f.py::test_bad failed in run(s) 1, 2, 3, 4, 5 of 5',
    '::error::pytest failed in run(s) 1, 2, 3, 4, 5 of 5 (1 distinct failing test id(s)); full logs: artifact pytest-logs-windows'
  ], 'only the test id and the summary are annotated (no captured log lines):\n' + f.out);
  assert.match(f.out, /gcs[\\/]tests[\\/]test_f\.py::test_ok PASSED/, 'pytest -v names every test in the live log');
  // WP17: hanging tests, with the real gcs/conftest.py and short timeouts: one that releases the GIL (the Python
  // watchdog fails it, the run goes on) and one in native code holding the GIL (faulthandler's backstop dumps and
  // ends the run at 2 + 1 + 1 s; the step annotates the last START line before "Timeout (...)!")
  const hanging = 'import ctypes, time\n\ndef test_hangs():\n    while True:\n        time.sleep(0.05)\n\n'
    + 'def test_after():\n    pass\n\ndef test_native():\n    ctypes.PyDLL("kernel32").Sleep(600000)\n';
  const h = run(hanging, { 'gcs/conftest.py': readText('gcs/conftest.py') }, { VTOLGCS_TEST_TIMEOUT: '2',
    VTOLGCS_TEST_GRACE: '1', VTOLGCS_TEST_BACKSTOP_MARGIN: '1', VTOLGCS_LIVE_TEST_NAMES: '1' });
  assert.notEqual(h.status, 0, 'a hanging test must fail the step:\n' + h.out);
  assert.equal(h.logs, 5, 'all five runs keep their log');
  assert.deepEqual(annotations(h.out), [
    '::error::gcs/tests/test_f.py::test_hangs failed in run(s) 1, 2, 3, 4, 5 of 5',
    '::error::gcs/tests/test_f.py::test_native failed in run(s) 1, 2, 3, 4, 5 of 5',
    '::error::pytest failed in run(s) 1, 2, 3, 4, 5 of 5 (2 distinct failing test id(s)); full logs: artifact pytest-logs-windows'
  ], h.out);
  assert.match(h.out, /\+\+\+ TIMEOUT \[[0-9:]+\] gcs\/tests\/test_f\.py::test_hangs still running after 2 s/);
  assert.match(h.out, /in test_hangs/, 'the stack dump shows where it hangs');
  assert.match(h.out, /test_f\.py::test_after PASSED/, 'the run goes on after the timeout');
  assert.equal((h.out.match(/Timeout \(0:00:04\)!/g) || []).length, 5, 'the GIL hang: faulthandler in each run');
  assert.match(h.out, /in test_native/, 'the stack dump shows the native hang');
  assert.equal((h.dumps.match(/\+\+\+ TIMEOUT \[/g) || []).length, 5, 'one dump per run in pytest-logs/pytest-timeouts.txt');
  const p = run('def test_ok():\n    pass\n');
  assert.equal(p.status, 0, p.out);
  assert.equal(p.logs, 5);
});

test('pwsh step "Tests, headless-safe suite" of gcs-build.yml, verbatim: fails on a failing test, leaves out interactive_desktop tests', t => {
  if (process.platform !== 'win32') { notHere(t, 'Windows PowerShell step: checked by the python-windows CI job'); return; }
  const py = pythonWithPytest();
  if (!py) { notHere(t, 'no Python with pytest (set VTOL_PYTHON)'); return; }
  const ps = powershell(t);
  const s = step('gcs-build.yml', 'Tests, headless-safe suite');
  assert.equal(s.shell, 'pwsh');
  const script = "$ErrorActionPreference = 'stop'\n" + s.run + "if ((Test-Path -LiteralPath variable:\\LASTEXITCODE)) { exit $LASTEXITCODE }\n";
  const run = (testPy, extraEnv = {}) => {
    const dir = tmpTree({ 'gcs/tests/test_f.py': testPy, 'protocol/README.md': 'x\n', 'ci-step.ps1': script,
      'gcs/conftest.py': readText('gcs/conftest.py'), 'gcs/pyproject.toml': readText('gcs/pyproject.toml') });
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vtol-py-'));
    try {
      fs.writeFileSync(path.join(bin, 'python.cmd'), '@"' + (path.isAbsolute(py) ? py : 'py') + '" %*\r\n');
      const env = { ...process.env, ...s.env, VTOLGCS_INTERACTIVE_TESTS: '1',     // would run here: -m must leave it out
        ...extraEnv, PATH: (path.isAbsolute(py) ? bin + path.delimiter : '') + process.env.PATH };
      const r = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'ci-step.ps1'], { cwd: dir, encoding: 'utf8', env });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), log: fs.existsSync(path.join(dir, 'pytest-logs', 'build-tests.txt')) };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); }
  };
  const desktop = '\nimport pytest\n\n@pytest.mark.interactive_desktop\ndef test_desktop():\n    assert False\n';
  const f = run('def test_bad():\n    assert 1 == 2\n' + desktop);
  assert.notEqual(f.status, 0, f.out);
  assert.ok(f.log, 'the log is kept for the upload step');
  assert.deepEqual(f.out.split(/\r?\n/).filter(l => l.startsWith('::error::')), [
    '::error::gcs/tests/test_f.py::test_bad failed',
    '::error::pytest failed (exit code 1); full log: artifact pytest-logs-build'
  ], f.out);
  const p = run('def test_ok():\n    pass\n' + desktop);
  assert.equal(p.status, 0, p.out);
  assert.match(p.out, /1 passed, 1 deselected/);
  // WP17 round 2: a native hang holding the GIL ends the run through faulthandler; the step names the test
  const n = run('import ctypes\n\ndef test_native():\n    ctypes.PyDLL("kernel32").Sleep(600000)\n', { VTOLGCS_TEST_TIMEOUT: '2',
    VTOLGCS_TEST_GRACE: '1', VTOLGCS_TEST_BACKSTOP_MARGIN: '1', VTOLGCS_LIVE_TEST_NAMES: '1' });
  assert.notEqual(n.status, 0, n.out);
  assert.deepEqual(n.out.split(/\r?\n/).filter(l => l.startsWith('::error::')), [
    '::error::gcs/tests/test_f.py::test_native hung (stack dump in the log: Timeout (0:00:04)!)',
    '::error::pytest failed (exit code 1); full log: artifact pytest-logs-build'
  ], n.out);
  const fast = { VTOLGCS_TEST_TIMEOUT: '2', VTOLGCS_TEST_GRACE: '1', VTOLGCS_TEST_BACKSTOP_MARGIN: '1',
    VTOLGCS_LIVE_TEST_NAMES: '1' };
  const annotations = out => out.split(/\r?\n/).filter(l => l.startsWith('::error::'));
  // WP17 verify F-A: a GIL hang in a fixture's teardown. After a passing test faulthandler's text follows "[100%]"
  // with no space; after a failing test the re-armed backstop prints fractional seconds ("Timeout (0:00:03.98…)!").
  const teardown = fail => 'import ctypes, pytest\n\n@pytest.fixture\ndef fx():\n    yield\n'
    + '    ctypes.PyDLL("kernel32").Sleep(600000)\n\ndef test_teardown_hangs(fx):\n    assert ' + (fail ? 'False' : 'True') + '\n';
  const tp = run(teardown(false), fast);
  assert.match(tp.out, /PASSED\s+\[100%\]Timeout \(0:00:04\)!/, 'faulthandler output glued to the result line');
  assert.deepEqual(annotations(tp.out), [
    '::error::gcs/tests/test_f.py::test_teardown_hangs hung (stack dump in the log: Timeout (0:00:04)!)',
    '::error::pytest failed (exit code 1); full log: artifact pytest-logs-build'
  ], tp.out);
  const tf = run(teardown(true), fast);
  const tfa = annotations(tf.out);
  assert.equal(tfa.length, 3, tf.out);
  assert.equal(tfa[0], '::error::gcs/tests/test_f.py::test_teardown_hangs failed');
  assert.match(tfa[1], /^::error::gcs\/tests\/test_f\.py::test_teardown_hangs hung \(stack dump in the log: Timeout \(0:00:0\d(\.\d+)?\)!\)$/);
  // WP18 R4: a failure followed by a hang that kills the session (no summary): both ids are annotated, and the
  // failure's text is in the log before the hang
  const d = run('import ctypes\n\ndef test_fails_first():\n    assert 1 == 2, "kept text"\n\n'
    + 'def test_native():\n    ctypes.PyDLL("kernel32").Sleep(600000)\n', fast);
  assert.deepEqual(annotations(d.out), [
    '::error::gcs/tests/test_f.py::test_fails_first failed',
    '::error::gcs/tests/test_f.py::test_native hung (stack dump in the log: Timeout (0:00:04)!)',
    '::error::pytest failed (exit code 1); full log: artifact pytest-logs-build'
  ], d.out);
  assert.match(d.out.split('Timeout (0:00:04)!')[0], /\+\+\+ FAILED \[[0-9:]+\] gcs\/tests\/test_f\.py::test_fails_first \(call\)[\s\S]*kept text/);
  // WP18 R4: every failed id is named: 7 annotations, then the others in one line (GitHub shows 10 per step)
  const many = Array.from({ length: 9 }, (_, i) => `def test_bad_${i}():\n    assert False\n`).join('\n');
  assert.deepEqual(annotations(run(many).out), [
    ...Array.from({ length: 7 }, (_, i) => `::error::gcs/tests/test_f.py::test_bad_${i} failed`),
    '::error::2 more failed test(s): gcs/tests/test_f.py::test_bad_7, gcs/tests/test_f.py::test_bad_8',
    '::error::pytest failed (exit code 1); full log: artifact pytest-logs-build'
  ]);
});
