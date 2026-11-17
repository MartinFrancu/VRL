import { describe, expect, test } from 'vitest';

import type { Bout, BoutId, Exchange, ExchangeId, MarkId, MediaHandle, TakeId } from '../contracts.js';
import { boutRecord } from './record.js';

const exchange = (n: number, marks: Exchange['marks']): Exchange => ({
  id: `e${n}` as ExchangeId,
  filmedAt: `2026-11-17T09:0${n}:00.000Z`,
  clock: { kind: 'take', take: `t${n}` as TakeId },
  takes: [
    {
      id: `t${n}` as TakeId,
      source: 'this phone',
      startedAtMs: 0,
      durationMs: 20_000 + n,
      // The camera track's idea of its shape, which on a phone held upright
      // need not be the picture's.
      width: 1920,
      height: 1080,
      media: {} as MediaHandle,
    },
  ],
  marks,
});

const bout: Bout = {
  id: 'b1' as BoutId,
  startedAt: '2026-11-17T09:00:00.000Z',
  exchanges: [
    exchange(1, [
      { id: 'm1' as MarkId, atMs: 4_000, hits: [{ atMs: 4_100, x: 0.25, y: 0.5, side: 'red' }] },
      { id: 'm2' as MarkId, atMs: 9_000 },
    ]),
    exchange(2, [{ id: 'm3' as MarkId, atMs: 3_000 }]),
  ],
};

const files = new Map([
  ['t1' as TakeId, { key: 'exchange-1.mp4', width: 1080, height: 1920 }],
  ['t2' as TakeId, { key: 'exchange-2.mp4', width: 1080, height: 1920 }],
]);

const inputs = {
  chosen: ['m1' as MarkId, 'm3' as MarkId],
  title: 'Spring camp',
  window: { leadMs: 1500, tailMs: 1000 },
  app: '1.1.40',
  savedAt: '2026-11-17T10:00:00.000Z',
  files,
};

/**
 * A bout written down as `bout.json`: the footage it points at, what was
 * noticed in it, and the choices made about it on the Save screen.
 */
describe('a bout, written down', () => {
  test('says what it is, when, and what wrote it', () => {
    const record = boutRecord(bout, inputs);

    expect(record).toMatchObject({
      v: 1,
      id: 'b1',
      startedAt: '2026-11-17T09:00:00.000Z',
      savedAt: '2026-11-17T10:00:00.000Z',
      app: '1.1.40',
      window: { leadMs: 1500, tailMs: 1000 },
      chosen: ['m1', 'm3'],
    });
  });

  test('keeps every exchange, and every mark and hit exactly as they were', () => {
    const record = boutRecord(bout, inputs);

    expect(record.exchanges.map((each) => each.marks)).toEqual(bout.exchanges.map((each) => each.marks));
    expect(record.exchanges[0]).toMatchObject({ v: 1, id: 'e1', filmedAt: '2026-11-17T09:01:00.000Z' });
  });

  /**
   * Each recording by the file it is in, at the shape a player shows it —
   * which is what a hit's x and y are fractions of — and all of it.
   */
  test('points each take at its file, at the shape its picture is', () => {
    const record = boutRecord(bout, inputs);

    expect(record.exchanges[0]?.takes[0]).toEqual({
      id: 't1',
      source: 'this phone',
      startedAtMs: 0,
      durationMs: 20_001,
      width: 1080,
      height: 1920,
      media: [{ key: 'exchange-1.mp4', fromMs: 0, toMs: 20_001 }],
    });
  });

  test('carries the title only when one was typed', () => {
    expect(boutRecord(bout, inputs).title).toBe('Spring camp');
    expect('title' in boutRecord(bout, { ...inputs, title: '   ' })).toBe(false);
  });

  test('survives being written out as JSON and read back', () => {
    const record = boutRecord(bout, inputs);

    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  /** A take with no file would be a record pointing at nothing. */
  test('refuses a take it has no file for', () => {
    expect(() => boutRecord(bout, { ...inputs, files: new Map([...files].slice(0, 1)) })).toThrow(/t2/);
  });
});
