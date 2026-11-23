/**
 * Compares two capture directories (tests/visual/capture.mts): status,
 * final URL, title, html lang, page errors, the normalised body HTML and
 * the screenshots pixel by pixel. Writes a diff PNG next to each mismatch
 * and exits non-zero when anything differs.
 *
 * Usage: node --import tsx tests/visual/compare.mts <expectedDir[,expectedDir...]> <actualDir> [diffDir]
 *
 * Chromium's rasteriser is not fully deterministic at a few anti-aliased
 * edges: two captures of the same server can differ by one colour step in
 * single pixels. With several expected captures a pixel passes when it
 * matches any of them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) {
    i++;
  }
  const from = Math.max(0, i - 200);
  return `at ${i}:\n      expected: ${a.slice(from, i + 300)}\n      actual:   ${b.slice(from, i + 300)}`;
}

function main() {
  const [expectedArg, actualDir, diffDir = path.join(actualDir ?? '.', 'diff')] = process.argv.slice(2);
  const [expectedDir, ...extraDirs] = (expectedArg ?? '').split(',');
  if (!expectedDir || !actualDir) {
    throw new Error('usage: compare.mts <expectedDir> <actualDir> [diffDir]');
  }
  mkdirSync(diffDir, { recursive: true });
  const expected = JSON.parse(readFileSync(path.join(expectedDir, 'index.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const actual = JSON.parse(readFileSync(path.join(actualDir, 'index.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  let failures = 0;
  for (const name of Object.keys(expected)) {
    const problems: string[] = [];
    const a = expected[name]!;
    const b = actual[name];
    if (!b) {
      problems.push('not captured');
    } else {
      for (const k of ['status', 'url', 'title', 'lang', 'errors']) {
        if (!isDeepStrictEqual(a[k], b[k])) {
          problems.push(`${k}: expected ${JSON.stringify(a[k])}, actual ${JSON.stringify(b[k])}`);
        }
      }
      const ha = readFileSync(path.join(expectedDir, `${name}.html`), 'utf8');
      const hb = readFileSync(path.join(actualDir, `${name}.html`), 'utf8');
      if (ha !== hb) {
        problems.push(`html ${firstDifference(ha, hb)}`);
      }
      const pa = PNG.sync.read(readFileSync(path.join(expectedDir, `${name}.png`)));
      const pbPath = path.join(actualDir, `${name}.png`);
      if (!existsSync(pbPath)) {
        problems.push('no screenshot');
      } else {
        const pb = PNG.sync.read(readFileSync(pbPath));
        if (pa.width !== pb.width || pa.height !== pb.height) {
          problems.push(`size ${pa.width}x${pa.height} vs ${pb.width}x${pb.height}`);
        } else {
          const diff = new PNG({ width: pa.width, height: pa.height });
          let n = pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: 0 });
          if (n > 0 && extraDirs.length) {
            const others = extraDirs.map(d => PNG.sync.read(readFileSync(path.join(d, `${name}.png`)))).filter(o => o.width === pb.width && o.height === pb.height);
            n = 0;
            for (let i = 0; i < pb.data.length; i += 4) {
              const same = (img: PNG) => img.data[i] === pb.data[i] && img.data[i + 1] === pb.data[i + 1] && img.data[i + 2] === pb.data[i + 2] && img.data[i + 3] === pb.data[i + 3];
              if (!same(pa) && !others.some(same)) {
                n++;
              }
            }
          }
          if (n > 0) {
            problems.push(`${n} pixels differ`);
            writeFileSync(path.join(diffDir, `${name}.png`), PNG.sync.write(diff));
          }
        }
      }
    }
    if (problems.length) {
      failures++;
      console.warn(`✘ ${name}\n    ${problems.join('\n    ')}`);
    }
  }
  console.warn(`${Object.keys(expected).length - failures}/${Object.keys(expected).length} identical`);
  process.exit(failures ? 1 : 0);
}

main();
