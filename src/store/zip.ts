// A zip of files that are already in memory, without copying them.
//
// Written by hand rather than taken from a library, for one reason: memory.
// A zip library reads every file through and writes it out again, so for the
// length of the save a bout's footage is held twice — and on a phone, a few
// hundred megabytes held twice is the tab killed. Here the zip is a `Blob`
// made of small headers and the recordings' own `Blob`s, which the browser
// stitches together by reference.
//
// Only what the raw files need: files stored as they are (a video does not
// shrink), names in UTF-8, no ZIP64 — so nothing over 4 GB. The format is
// checked against a standard library in the tests, not just against itself.

/** The table CRC-32 is computed with, made once. */
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * The CRC-32 of some bytes — or of more bytes, carrying on from `previous`,
 * so a file can be checksummed a piece at a time.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let at = 0; at < bytes.length; at++) {
    crc = (TABLE[(crc ^ (bytes[at] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The CRC-32 of a blob, read a piece at a time so it is never all in memory. */
export async function crcOfBlob(blob: Blob): Promise<number> {
  let crc = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32(value, crc);
  }
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Blob;
  /** Its CRC-32, from `crcOfBlob`. */
  readonly crc: number;
}

const LIMIT = 0xffffffff;

/** A date and time the way zip writes them: to two seconds, local time. */
function dosTime(when: Date): { time: number; date: number } {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/**
 * One zip holding every entry, stored as it is, in the order given.
 *
 * Throws for what a plain zip cannot hold — a file of 4 GB or more, or a zip
 * that would grow past it — rather than writing one nothing can open.
 */
export function zipStored(entries: readonly ZipEntry[], modified: Date): Blob {
  const { time, date } = dosTime(modified);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const size = entry.data.size;
    if (size >= LIMIT) throw new Error(`${entry.name} is too big for a zip`);
    const name = encoder.encode(entry.name);

    const local = new Uint8Array(30 + name.length);
    const at = new DataView(local.buffer);
    at.setUint32(0, 0x04034b50, true); // local file header
    at.setUint16(4, 20, true); // version needed
    at.setUint16(6, 0x0800, true); // names in UTF-8
    at.setUint16(8, 0, true); // stored
    at.setUint16(10, time, true);
    at.setUint16(12, date, true);
    at.setUint32(14, entry.crc, true);
    at.setUint32(18, size, true);
    at.setUint32(22, size, true);
    at.setUint16(26, name.length, true);
    at.setUint16(28, 0, true);
    local.set(name, 30);

    const record = new Uint8Array(46 + name.length);
    const on = new DataView(record.buffer);
    on.setUint32(0, 0x02014b50, true); // central directory header
    on.setUint16(4, 20, true); // version made by
    on.setUint16(6, 20, true); // version needed
    on.setUint16(8, 0x0800, true);
    on.setUint16(10, 0, true);
    on.setUint16(12, time, true);
    on.setUint16(14, date, true);
    on.setUint32(16, entry.crc, true);
    on.setUint32(20, size, true);
    on.setUint32(24, size, true);
    on.setUint16(28, name.length, true);
    on.setUint32(42, offset, true); // where its local header is
    record.set(name, 46);

    parts.push(local, entry.data);
    central.push(record);
    offset += local.length + size;
    if (offset >= LIMIT) throw new Error('these files are too big for a zip');
  }

  const centralSize = central.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const tail = new DataView(end.buffer);
  tail.setUint32(0, 0x06054b50, true); // end of central directory
  tail.setUint16(8, entries.length, true);
  tail.setUint16(10, entries.length, true);
  tail.setUint32(12, centralSize, true);
  tail.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
