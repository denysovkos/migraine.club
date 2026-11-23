// Writes internal/jsx/testdata/textdecode.json: TextDecoder and
// decodeURIComponent results from V8 for jsx.UTF8Decode and
// jsx.DecodeURIComponent. Run: npx tsx scripts/text-decode-golden.mts
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const bytes = [
  [0x61, 0x62],
  [0xEF, 0xBB, 0xBF, 0x61],
  [0xC3],
  [0xC3, 0x28],
  [0xE2, 0x82],
  [0xE2, 0x82, 0x28],
  [0xE2, 0x28, 0xA1],
  [0xF0, 0x9F, 0x98],
  [0xF0, 0x9F, 0x98, 0x80],
  [0xED, 0xA0, 0x80],
  [0xF4, 0x90, 0x80, 0x80],
  [0xC0, 0xAF],
  [0xFF, 0x61],
  [0xE0, 0x80, 0x80],
  [0xF0, 0x80, 0x80, 0x80],
  [0x80, 0x80],
  [0xF8, 0x88, 0x80, 0x80, 0x80],
  [0xE1, 0x80, 0xE1, 0x80, 0x80],
];
const decoder = new TextDecoder();
const ignoreBOM = new TextDecoder('utf-8', { ignoreBOM: true });
const decode = bytes.map(b => ({ hex: Buffer.from(b).toString('hex'), strip: decoder.decode(Buffer.from(b)), keep: ignoreBOM.decode(Buffer.from(b)) }));

const uris = ['plain', 'a%20b', '%41%42', '%', '%4', '%zz', '%C3%A9', '%C3', '%C3%28', '%E2%82%AC', '%F0%9F%98%80', '%ED%A0%80', '%C0%AF', '%80', '%FF', 'caf%C3%A9.pdf', '%25', 'x%2Fy', 'ünï%20', '%E2%82%AC%', '%f0%9f%98%80'];
const uri = uris.map((s) => {
  try {
    return { in: s, out: decodeURIComponent(s), err: false };
  } catch {
    return { in: s, out: '', err: true };
  }
});
writeFileSync('internal/jsx/testdata/textdecode.json', `${JSON.stringify({ decode, uri }, null, 1)}\n`);
