import { describe, expect, test } from 'vitest';

import type { BoutId, Cut, MarkId, Span, TakeId } from '../contracts.js';
import { reelFilename, reelLengthMs } from './reel.js';

const span = (fromMs: number, toMs: number): Span => ({
  fromMs,
  toMs,
  atMs: (fromMs + toMs) / 2,
  takes: ['t1' as TakeId],
  shortLeadMs: 0,
  shortTailMs: 0,
});

const cut = (...spans: Span[]): Cut => ({ spans });

describe('how long the saved video will be', () => {
  /**
   * The stretches added up, not the bout's length. That difference is the
   * whole point of saving one: a three-minute bout becomes a few seconds.
   */
  test('is its stretches added up', () => {
    expect(reelLengthMs(cut(span(1_000, 3_500), span(20_000, 22_500)))).toBe(5_000);
  });

  test('is nothing when there is nothing to save', () => {
    expect(reelLengthMs(cut())).toBe(0);
  });

  /** Overlapping stretches are not yet merged, so for now they double-count. */
  test('counts every stretch it is given, overlapping or not', () => {
    expect(reelLengthMs(cut(span(1_000, 3_500), span(2_000, 4_500)))).toBe(5_000);
  });
});

describe('what the saved video is called', () => {
  const bout = (filmedAt: string, marks: number) => ({
    id: 'b1' as BoutId,
    filmedAt,
    clock: { kind: 'take', take: 't1' as TakeId } as const,
    takes: [],
    marks: Array.from({ length: marks }, (_unused, index) => ({
      id: `m${index}` as MarkId,
      atMs: index * 1000,
    })),
  });

  /**
   * The date first, so a phone full of these sorts itself into the order the
   * bouts happened in.
   */
  test('leads with the date it was filmed', () => {
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 3))).toMatch(/^2026-11-09/);
  });

  /**
   * Spelled out in full rather than with `toContain`, because "1 marks"
   * contains "1 mark" and a substring check waves the wrong one through.
   */
  test('says how many moments are in it', () => {
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 3))).toBe('2026-11-09 SBA 3 marks.mp4');
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 1))).toBe('2026-11-09 SBA 1 mark.mp4');
  });

  test('ends in something a phone will recognise as a video', () => {
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 2), 'video/mp4')).toMatch(/\.mp4$/);
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 2), 'video/webm;codecs=vp9')).toMatch(/\.webm$/);
  });

  /**
   * It goes to a share sheet and from there to who knows what — a filesystem,
   * a chat app, a cloud drive. Nothing in the name should make any of them
   * flinch.
   */
  test('has nothing in it that a filesystem would object to', () => {
    expect(reelFilename(bout('2026-11-09T14:32:05.000Z', 2))).toMatch(/^[\w \-.]+$/);
  });

  test('copes with a bout whose date was never recorded', () => {
    expect(reelFilename(bout('', 2))).toMatch(/^[\w \-.]+\.mp4$/);
  });
});
