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
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
/**
 * The CRC-32 of some bytes — or of more bytes, carrying on from `previous`,
 * so a file can be checksummed a piece at a time.
 */
export function crc32(bytes, previous = 0) {
    let crc = (previous ^ 0xffffffff) >>> 0;
    for (let at = 0; at < bytes.length; at++) {
        crc = (TABLE[(crc ^ (bytes[at] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
/** The CRC-32 of a blob, read a piece at a time so it is never all in memory. */
export async function crcOfBlob(blob) {
    let crc = 0;
    const reader = blob.stream().getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            return crc;
        crc = crc32(value, crc);
    }
}
const LIMIT = 0xffffffff;
/** A date and time the way zip writes them: to two seconds, local time. */
function dosTime(when) {
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
export function zipStored(entries, modified) {
    const { time, date } = dosTime(modified);
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
        const size = entry.data.size;
        if (size >= LIMIT)
            throw new Error(`${entry.name} is too big for a zip`);
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
        if (offset >= LIMIT)
            throw new Error('these files are too big for a zip');
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
/** The type a file's name says it is, so a player knows what to do with it. */
function typeFor(name) {
    if (name.endsWith('.mp4'))
        return 'video/mp4';
    if (name.endsWith('.webm'))
        return 'video/webm';
    if (name.endsWith('.json'))
        return 'application/json';
    if (name.endsWith('.csv'))
        return 'text/csv';
    return '';
}
const slice = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());
/**
 * Every file in a zip of stored files, by name, each a slice of the zip itself
 * — nothing read into memory beyond the zip's own index. A file the size of a
 * bout opens as quickly as an empty one.
 *
 * Refuses, saying why, a zip that has been compressed — unpacked and zipped up
 * again elsewhere, say — and anything that is not a zip at all.
 */
export async function readZip(zip) {
    // The index's end is in the last 22 bytes, or a little before them when the
    // zip has a comment; look back as far as the longest comment allowed.
    const reach = Math.min(zip.size, 22 + 0xffff);
    const tail = await slice(zip, zip.size - reach, zip.size);
    let end = -1;
    for (let at = tail.byteLength - 22; at >= 0; at--) {
        if (tail.getUint32(at, true) === 0x06054b50) {
            end = at;
            break;
        }
    }
    if (end < 0)
        throw new Error('this is not a zip');
    const count = tail.getUint16(end + 10, true);
    const indexSize = tail.getUint32(end + 12, true);
    const indexAt = tail.getUint32(end + 16, true);
    const index = await slice(zip, indexAt, indexAt + indexSize);
    const decoder = new TextDecoder();
    const files = new Map();
    let at = 0;
    for (let n = 0; n < count; n++) {
        if (index.getUint32(at, true) !== 0x02014b50)
            throw new Error('this zip is damaged');
        const method = index.getUint16(at + 10, true);
        const size = index.getUint32(at + 24, true);
        const nameLength = index.getUint16(at + 28, true);
        const extraLength = index.getUint16(at + 30, true);
        const commentLength = index.getUint16(at + 32, true);
        const localAt = index.getUint32(at + 42, true);
        const name = decoder.decode(new Uint8Array(index.buffer, index.byteOffset + at + 46, nameLength));
        at += 46 + nameLength + extraLength + commentLength;
        if (method !== 0)
            throw new Error(`${name} in this zip is compressed — open the zip the app saved, as it was`);
        const local = await slice(zip, localAt, localAt + 30);
        if (local.getUint32(0, true) !== 0x04034b50)
            throw new Error('this zip is damaged');
        const dataAt = localAt + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        files.set(name, zip.slice(dataAt, dataAt + size, typeFor(name)));
    }
    return files;
}
//# sourceMappingURL=zip.js.map