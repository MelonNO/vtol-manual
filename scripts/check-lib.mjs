// Shared helpers for the scripts/check-*.mjs CI checks (WP10 R1). Plain Node, no packages.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Never scanned: dependencies, build output, git internals.
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.pytest_cache', 'build', 'dist', '.venv', 'venv']);

// Repository files (repo-relative, forward slashes): `git ls-files` when available (only what is committed or staged),
// otherwise a directory walk (for example in a source archive without .git).
export function repoFiles(root = ROOT) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(f => f && existsSync(join(root, f))).sort();
  } catch {
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); }
        else files.push(relative(root, p).split(sep).join('/'));
      }
    })(root);
    return files.sort();
  }
}

// A repository file as LF text.
export function readText(rel, root = ROOT) {
  return readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}

// Print the problems and set the exit code (CLI helper).
export function report(name, problems, okText) {
  if (!problems.length) { console.log(name + ': ' + okText); return; }
  for (const p of problems) console.log('FAIL ' + p);
  console.log(name + ': ' + problems.length + ' problem(s)');
  process.exitCode = 1;
}

// True when this module is run directly (node scripts/check-x.mjs), not imported by a test.
// realpath: Windows short (8.3) and long names compare equal (as in scripts/gen-precache.mjs).
export function isMain(metaUrl) {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(metaUrl)).toLowerCase() === realpathSync(process.argv[1]).toLowerCase();
  } catch {
    return false;
  }
}
