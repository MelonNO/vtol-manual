// Image-size budget (WP10 R1; img/README.md). Plain Node, no packages.
//   node scripts/check-images.mjs       exit 1 and list every file over its budget
//
// Budgets (KiB = 1024 bytes):
//   - raster images (.jpg .jpeg .png .webp .gif .avif), anywhere in the repository: ≤ 250 KiB each
//   - standalone SVG diagrams and drawings (.svg under img/ and icons/):            ≤ 60 KiB each
// Photos should normally stay well below this (img/README.md targets ≤ 200 KB): run scripts/optimize-images.py.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, isMain, repoFiles, report } from './check-lib.mjs';

export const RASTER_MAX = 250 * 1024;
export const SVG_MAX = 60 * 1024;
const RASTER = /\.(jpe?g|png|webp|gif|avif)$/i;
const DIAGRAM = /^(img|icons)\/.*\.svg$/i;

// [{ file, bytes, max }] for every budgeted file.
export function imageSizes(root = ROOT) {
  const out = [];
  for (const f of repoFiles(root)) {
    const max = RASTER.test(f) ? RASTER_MAX : DIAGRAM.test(f) ? SVG_MAX : null;
    if (max !== null) out.push({ file: f, bytes: statSync(join(root, f)).size, max });
  }
  return out;
}

export function checkImages(root = ROOT) {
  return imageSizes(root).filter(x => x.bytes > x.max)
    .map(x => `${x.file}: ${(x.bytes / 1024).toFixed(1)} KiB > ${x.max / 1024} KiB budget`);
}

if (isMain(import.meta.url)) {
  const all = imageSizes();
  const big = all.slice().sort((a, b) => b.bytes - a.bytes)[0];
  report('check-images', checkImages(), `${all.length} images within budget (largest ${big ? big.file + ' ' + (big.bytes / 1024).toFixed(1) + ' KiB' : 'none'})`);
}
