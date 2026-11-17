import { describe, expect, test } from 'vitest';

import type { BoutRecord, ExchangeId, MarkId, TakeId, BoutId } from '../contracts.js';
import { markersCsv, rawFilename, readRaw, recordingName } from './raw.js';

const record: BoutRecord = {
  v: 1,
  id: 'b1' as BoutId,
  startedAt: '2026-11-17T09:00:00.000Z',
  savedAt: '2026-11-17T10:00:00.000Z',
  app: '1.1.40',
  window: { leadMs: 1500, tailMs: 1000 },
  chosen: ['m1' as MarkId],
  exchanges: [
    {
      v: 1,
      id: 'e1' as ExchangeId,
      filmedAt: '2026-11-17T09:01:00.000Z',
      clock: { kind: 'take', take: 't1' as TakeId },
      takes: [
        {
          id: 't1' as TakeId,
          source: 'this phone',
          startedAtMs: 0,
          durationMs: 80_000,
          width: 1080,
          height: 1920,
          media: [{ key: 'exchange-1.mp4', fromMs: 0, toMs: 80_000 }],
        },
      ],
      marks: [
        {
          id: 'm1' as MarkId,
          atMs: 64_250,
          hits: [
            { atMs: 64_300, x: 0.25, y: 0.5, side: 'red' },
            { atMs: 64_420, x: 0.75, y: 0.1, side: 'blue' },
          ],
        },
        { id: 'm2' as MarkId, atMs: 70_005 },
      ],
    },
  ],
};

/** The raw files: a zip named for the bout, its recordings named for their exchanges. */
describe('the raw files', () => {
  test('are named for the day the bout started', () => {
    expect(rawFilename('2026-11-17T09:00:00.000Z')).toBe('2026-11-17 SBA bout raw.zip');
    expect(rawFilename('')).toBe('undated SBA bout raw.zip');
  });

  test('name each recording for its exchange, in a type a phone recognises', () => {
    expect(recordingName(0, 'video/mp4;codecs=avc1')).toBe('exchange-1.mp4');
    expect(recordingName(1, 'video/webm;codecs=vp9')).toBe('exchange-2.webm');
  });
});

/**
 * Every mark and hit as one table — for a spreadsheet, or beside an editor's
 * timeline: which file, when in it (as an editor shows time, and in ms), when
 * on the clock, and for a hit, whose and where.
 */
describe('the markers table', () => {
  const rows = markersCsv(record).trimEnd().split('\n');

  test('heads its columns', () => {
    expect(rows[0]).toBe('exchange,file,kind,mark,time,ms,clock,side,x,y,x_px,y_px,ticked');
  });

  test('has a row for every mark, and one for every hit after its mark', () => {
    expect(rows.slice(1).map((row) => row.split(',')[2])).toEqual(['mark', 'hit', 'hit', 'mark']);
  });

  test('says when a mark is, in its file and on the clock', () => {
    expect(rows[1]).toBe('1,exchange-1.mp4,mark,1,00:01:04.250,64250,2026-11-17T09:02:04.250Z,,,,,,yes');
  });

  /** Where, both as the fraction of the picture stored, and in that file's pixels. */
  test('says whose a hit was and where, in fractions and in pixels', () => {
    expect(rows[2]).toBe('1,exchange-1.mp4,hit,1,00:01:04.300,64300,2026-11-17T09:02:04.300Z,red,0.25,0.5,270,960,yes');
    expect(rows[3]).toBe('1,exchange-1.mp4,hit,1,00:01:04.420,64420,2026-11-17T09:02:04.420Z,blue,0.75,0.1,810,192,yes');
  });

  test('says which marks were left out of the cut', () => {
    expect(rows[4]?.endsWith(',no')).toBe(true);
  });
});

/** The raw files read back: the record, and the recordings it points at. */
describe('the raw files, opened again', () => {
  const files = (overrides: Record<string, Blob | undefined> = {}) => {
    const all: Record<string, Blob | undefined> = {
      'bout.json': new Blob([JSON.stringify(record)]),
      'markers.csv': new Blob(['']),
      'exchange-1.mp4': new Blob(['video'], { type: 'video/mp4' }),
      ...overrides,
    };
    return new Map(Object.entries(all).filter((entry): entry is [string, Blob] => entry[1] !== undefined));
  };

  test('gives back the record as it was written, and its recordings by name', async () => {
    const opened = await readRaw(files());

    expect(opened.record).toEqual(record);
    expect(await opened.recordings.get('exchange-1.mp4')?.text()).toBe('video');
  });

  test('refuses a zip with no bout in it', async () => {
    await expect(readRaw(files({ 'bout.json': undefined }))).rejects.toThrow(/not .*raw files/);
  });

  test('refuses a bout written in a format it does not know', async () => {
    const newer = new Blob([JSON.stringify({ ...record, v: 2 })]);

    await expect(readRaw(files({ 'bout.json': newer }))).rejects.toThrow(/newer/);
  });

  test('refuses a bout whose recording is missing, naming it', async () => {
    await expect(readRaw(files({ 'exchange-1.mp4': undefined }))).rejects.toThrow(/exchange-1\.mp4/);
  });

  test('refuses a bout.json that is not JSON', async () => {
    await expect(readRaw(files({ 'bout.json': new Blob(['{ nope']) }))).rejects.toThrow(/bout\.json/);
  });
});
