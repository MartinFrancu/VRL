import { describe, expect, test } from 'vitest';

import type { BoutId, Cut, MarkId, Span, TakeId } from '../contracts.js';
import { fadeAt, reelFilename, reelLengthMs } from './reel.js';

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

/**
 * A quick dip to black at every join, so one moment does not cut hard into
 * the next. Each stretch fades in from black and out to black inside its own
 * time, which is why the fades make the video no longer.
 */
describe('fading between the moments', () => {
  const stretch = span(10_000, 12_000);

  test('is fully bright in the middle of a stretch', () => {
    expect(fadeAt(11_000, stretch, 200)).toBe(1);
  });

  test('starts and ends every stretch at black', () => {
    expect(fadeAt(10_000, stretch, 200)).toBe(0);
    expect(fadeAt(12_000, stretch, 200)).toBe(0);
  });

  test('comes up evenly over the fade', () => {
    expect(fadeAt(10_100, stretch, 200)).toBeCloseTo(0.5, 5);
    expect(fadeAt(11_900, stretch, 200)).toBeCloseTo(0.5, 5);
  });

  /**
   * A stretch shorter than two fades still fades both ways, and simply never
   * gets all the way up. The alternative — a fade cut short — would be a hard
   * cut wearing a fade's name.
   */
  test('squeezes both fades into a short stretch, never reaching full brightness', () => {
    const short = span(0, 300);
    const peak = fadeAt(150, short, 200);

    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(1);
    expect(fadeAt(0, short, 200)).toBe(0);
    expect(fadeAt(300, short, 200)).toBe(0);
  });

  /** Outside its stretch is black, not a negative or an overshoot. */
  test('is black outside the stretch', () => {
    expect(fadeAt(9_000, stretch, 200)).toBe(0);
    expect(fadeAt(13_000, stretch, 200)).toBe(0);
  });

  test('is no fade at all when the fade is set to nothing', () => {
    expect(fadeAt(10_000, stretch, 0)).toBe(1);
  });
});
