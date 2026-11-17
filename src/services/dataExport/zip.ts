import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Tiny ZIP writer (deflate, no ZIP64) built on node:zlib so the export does
 * not pull in an archive dependency. A personal export is far below the 4 GiB
 * ZIP32 limit; we fail loudly rather than write a corrupt archive if it isn't.
 */

export type ZipEntry = {
  name: string;
  data: string | Uint8Array;
};

const ZIP32_MAX = 0xFFFFFFFF;
const UTF8_FLAG = 0x0800;
const METHOD_DEFLATE = 8;
const VERSION = 20;

function toDosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(date.getUTCFullYear(), 1980);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function createZip(entries: ReadonlyArray<ZipEntry>, modifiedAt: Date = new Date()): Buffer {
  const { time, date } = toDosDateTime(modifiedAt);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw);
    const checksum = crc32(raw);

    if (raw.length > ZIP32_MAX || compressed.length > ZIP32_MAX || offset > ZIP32_MAX) {
      throw new Error('Export too large for ZIP32 archive');
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra len, comment len, disk start, internal attrs, external attrs: all 0
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, compressed);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  if (entries.length > 0xFFFF || offset > ZIP32_MAX) {
    throw new Error('Export too large for ZIP32 archive');
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
