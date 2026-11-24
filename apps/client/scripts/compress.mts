/**
 * Writes a Brotli copy (name.br) of every compressible build file, at the
 * highest quality: the Go server sends it to browsers that accept br,
 * 15-20% smaller than the gzip it would send otherwise. Done here, once,
 * because quality 11 is too slow to run at startup or per request.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
// What the server's compression middleware compresses (httpx.CompressibleTypes).
const compressible = /\.(?:js|mjs|css|json|webmanifest|svg|ico|xml|txt|html)$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      yield* files(full);
    } else if (compressible.test(name)) {
      yield full;
    }
  }
}

let before = 0;
let after = 0;
for (const file of files(dist)) {
  const body = readFileSync(file);
  const br = brotliCompressSync(body, { params: {
    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
    [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
  } });
  writeFileSync(`${file}.br`, br);
  before += body.length;
  after += br.length;
}
console.log(`brotli: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
