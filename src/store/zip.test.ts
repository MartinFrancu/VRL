import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unzipSync, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { crc32, crcOfBlob, readZip, zipStored } from './zip.js';

const text = (value: string) => new TextEncoder().encode(value);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/**
 * The raw files go out as one zip, written by hand so that the recordings in it
 * are never copied — on a phone, a bout's footage held twice is the tab killed.
 * Read back here by fflate, a standard zip library, so the format is checked by
 * something that is not this code.
 */
describe('a zip of the raw files', () => {
  /** The check value every CRC-32 implementation is tested against. */
  test('checksums as CRC-32 does', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test('checksums a blob read in pieces the same as all at once', async () => {
    const big = new Uint8Array(200_000).map((_, at) => (at * 7) % 251);

    expect(await crcOfBlob(new Blob([big]))).toBe(crc32(big));
  });

  test('is read back by a standard zip library, every file and byte intact', async () => {
    const files = [
      { name: 'bout.json', data: new Blob([text('{"v":1}')]) },
      { name: 'exchange-1.mp4', data: new Blob([new Uint8Array(70_000).map((_, at) => at % 256)]) },
      { name: 'markers.csv', data: new Blob([text('exchange,file\n')]) },
    ];
    const entries = await Promise.all(files.map(async (file) => ({ ...file, crc: await crcOfBlob(file.data) })));

    const zip = zipStored(entries, new Date(2026, 10, 17, 10, 30, 42));
    const read = unzipSync(await bytesOf(zip));

    expect(Object.keys(read)).toEqual(['bout.json', 'exchange-1.mp4', 'markers.csv']);
    for (const file of files) expect(read[file.name]).toEqual(await bytesOf(file.data));
  });

  /**
   * And by Python's zipfile, which — unlike fflate — checks every file against
   * its checksum. Skipped only where there is no Python to ask.
   */
  const python = (() => {
    try {
      execFileSync('python3', ['--version']);
      return true;
    } catch {
      return false;
    }
  })();
  test.skipIf(!python)('passes Python\'s zipfile check, checksums and all', async () => {
    const data = new Blob([new Uint8Array(50_000).map((_, at) => (at * 13) % 256)]);
    const zip = zipStored([{ name: 'exchange-1.webm', data, crc: await crcOfBlob(data) }], new Date(2026, 10, 17));
    const path = join(mkdtempSync(join(tmpdir(), 'vrl-zip-')), 'raw.zip');
    writeFileSync(path, await bytesOf(zip));

    const verdict = execFileSync('python3', [
      '-c',
      'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(z.testzip(), z.namelist())',
      path,
    ]).toString();

    expect(verdict.trim()).toBe("None ['exchange-1.webm']");
  });

  /** Nothing compressed: a video does not shrink, and stored is what can be read by slicing. */
  test('stores each file as it is, one after another', async () => {
    const data = new Blob([text('hello')]);
    const zip = zipStored([{ name: 'a.txt', data, crc: await crcOfBlob(data) }], new Date(2026, 0, 1));
    const bytes = await bytesOf(zip);

    // A local header is 30 bytes, then the name, then the bytes as they were.
    expect(new TextDecoder().decode(bytes.slice(30 + 5, 30 + 5 + 5))).toBe('hello');
  });

  test('refuses what a plain zip cannot hold', () => {
    const huge = { size: 2 ** 32 } as Blob;

    expect(() => zipStored([{ name: 'huge.mp4', data: huge, crc: 0 }], new Date())).toThrow(/too big/);
  });
});

/**
 * Opening a saved bout reads the zip back — each file as a slice of the one
 * picked, so a bout's footage is not read into memory just to be opened.
 */
describe('reading a zip back', () => {
  const zipOf = async (files: Record<string, Uint8Array<ArrayBuffer>>) =>
    zipStored(
      await Promise.all(
        Object.entries(files).map(async ([name, bytes]) => ({
          name,
          data: new Blob([bytes]),
          crc: await crcOfBlob(new Blob([bytes])),
        }))
      ),
      new Date(2026, 10, 17)
    );

  test('finds every file this app wrote, byte for byte', async () => {
    const video = new Uint8Array(30_000).map((_, at) => (at * 3) % 256);
    const read = await readZip(await zipOf({ 'bout.json': text('{"v":1}'), 'exchange-1.mp4': video }));

    expect([...read.keys()]).toEqual(['bout.json', 'exchange-1.mp4']);
    expect(await bytesOf(read.get('exchange-1.mp4')!)).toEqual(video);
    expect(await read.get('bout.json')!.text()).toBe('{"v":1}');
  });

  /** A recording comes back as what it is, so a player knows what to do with it. */
  test('gives each file the type its name says', async () => {
    const read = await readZip(await zipOf({ 'exchange-1.mp4': text('x'), 'exchange-2.webm': text('y') }));

    expect(read.get('exchange-1.mp4')?.type).toBe('video/mp4');
    expect(read.get('exchange-2.webm')?.type).toBe('video/webm');
  });

  /** One made by a standard library, stored, opens just the same. */
  test('reads a stored zip that a standard library wrote', async () => {
    const zip = zipSync({ 'bout.json': text('{"v":1}') }, { level: 0 });
    const read = await readZip(new Blob([zip.slice()]));

    expect(await read.get('bout.json')!.text()).toBe('{"v":1}');
  });

  /** Unpacked and zipped up again on a computer, it is compressed — and not ours to open by slicing. */
  test('refuses a zip that has been compressed, saying so', async () => {
    const zip = zipSync({ 'bout.json': text('{"v":1, "padding": "' + 'x'.repeat(500) + '"}') }, { level: 9 });

    await expect(readZip(new Blob([zip.slice()]))).rejects.toThrow(/compressed/);
  });

  test('refuses what is not a zip at all', async () => {
    await expect(readZip(new Blob([text('just some text')]))).rejects.toThrow(/not a zip/);
  });
});
