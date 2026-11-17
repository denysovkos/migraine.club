import type { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { createZip } from './zip';

/** Reads entries back via the central directory, as a real unzip tool does. */
function readZip(buf: Buffer): Record<string, string> {
  const eocd = buf.length - 22;

  expect(buf.readUInt32LE(eocd)).toBe(0x06054B50);

  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};

  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(cursor)).toBe(0x02014B50);

    const crc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const dataStart = localOffset + 30 + localNameLength;
    const data = inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize));

    expect(crc32(data)).toBe(crc);

    out[name] = data.toString('utf8');
    cursor += 46 + nameLength;
  }
  return out;
}

describe('createZip', () => {
  it('round-trips entries including non-ASCII content', () => {
    const zip = createZip([
      { name: 'a.csv', data: 'id,notes\r\n1,головний біль\r\n' },
      { name: 'b.json', data: '{"ok":true}' },
    ], new Date('2026-11-17T09:00:00Z'));

    expect(readZip(zip)).toEqual({
      'a.csv': 'id,notes\r\n1,головний біль\r\n',
      'b.json': '{"ok":true}',
    });
  });

  it('produces a valid empty archive', () => {
    const zip = createZip([]);

    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual({});
  });
});
