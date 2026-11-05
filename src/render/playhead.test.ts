import { describe, expect, test } from 'vitest';

import type { Span, TakeId } from '../contracts.js';
import {
  clampWithin,
  draggedTo,
  progressThrough,
  readoutFor,
  shortfallLabel,
  steppedBy,
} from './playhead.js';

const span = (over: Partial<Span> = {}): Span => ({
  fromMs: 28_500,
  toMs: 31_000,
  atMs: 30_000,
  takes: ['t1' as TakeId],
  shortLeadMs: 0,
  shortTailMs: 0,
  ...over,
});

describe('keeping the playhead inside its span', () => {
  test('leaves a position that is already inside alone', () => {
    expect(clampWithin(30_000, span())).toBe(30_000);
  });

  test('stops at each end rather than running off it', () => {
    expect(clampWithin(0, span())).toBe(28_500);
    expect(clampWithin(999_999, span())).toBe(31_000);
  });
});

/**
 * The whole picture is the control — a target the size of the screen rather
 * than a slider six millimetres tall, usable without looking down at your own
 * hand.
 *
 * Relative to where the footage already was, never absolute: touching the
 * picture must not teleport it to wherever the thumb landed, because the
 * instant it is touched is the moment somebody is trying to look at it.
 */
describe('dragging across the picture', () => {
  test('a touch that has not moved yet changes nothing', () => {
    expect(draggedTo({ fromMs: 30_000, acrossFraction: 0, span: span() })).toBe(30_000);
  });

  /** The full width is the full span, so all of it is in reach in one gesture. */
  test('half the width forward moves half the span forward', () => {
    expect(draggedTo({ fromMs: 28_500, acrossFraction: 0.5, span: span() })).toBe(29_750);
  });

  test('dragging back goes back', () => {
    expect(draggedTo({ fromMs: 31_000, acrossFraction: -0.5, span: span() })).toBe(29_750);
  });

  test('stops at the ends rather than running past them', () => {
    expect(draggedTo({ fromMs: 30_000, acrossFraction: 5, span: span() })).toBe(31_000);
    expect(draggedTo({ fromMs: 30_000, acrossFraction: -5, span: span() })).toBe(28_500);
  });
});

describe('what the readout says', () => {
  /** Zero is the marked moment, not the start of the run-up. */
  test('reads zero at the mark itself', () => {
    expect(readoutFor(30_000, span())).toBe('+0.00s');
  });

  test('counts forwards and backwards from the mark', () => {
    expect(readoutFor(30_350, span())).toBe('+0.35s');
    expect(readoutFor(29_650, span())).toBe('-0.35s');
  });
});

describe('how far through the span the playhead is', () => {
  test('is nothing at the start and all of it at the end', () => {
    expect(progressThrough(28_500, span())).toBe(0);
    expect(progressThrough(31_000, span())).toBe(1);
    expect(progressThrough(29_750, span())).toBeCloseTo(0.5, 5);
  });

  /** A span of no width would otherwise divide by zero and show NaN wide. */
  test('is nothing for a span with no width', () => {
    expect(progressThrough(500, span({ fromMs: 500, toMs: 500, atMs: 500 }))).toBe(0);
  });
});

describe('saying what a span did not get', () => {
  test('says nothing when it got everything it asked for', () => {
    expect(shortfallLabel(span())).toBeNull();
  });

  /**
   * Only ever about the tail. A mark near the start of a recording is
   * self-evidently near the start, but a fight stopped a moment after a mark
   * gives a span that ends mid-movement, and that is worth saying out loud
   * rather than leaving to look like a fault.
   */
  test('says how long after the mark the fight was stopped', () => {
    expect(shortfallLabel(span({ shortTailMs: 800 }))).toBe('stopped 0.8s after this mark');
  });

  test('says nothing about a tail that is short by a hair', () => {
    expect(shortfallLabel(span({ shortTailMs: 100 }))).toBeNull();
    expect(shortfallLabel(span({ shortTailMs: 101 }))).toBe('stopped 0.1s after this mark');
  });

  test('says nothing about a short run-up, which speaks for itself', () => {
    expect(shortfallLabel(span({ shortLeadMs: 1_100 }))).toBeNull();
  });
});

describe('stepping a frame at a time', () => {
  const frameMs = 1000 / 60;

  test('moves by whole frames, forwards and back', () => {
    expect(steppedBy(30_000, 1, frameMs, span())).toBeCloseTo(30_016.67, 1);
    expect(steppedBy(30_000, -3, frameMs, span())).toBeCloseTo(29_950, 1);
  });

  test('stops at the ends rather than stepping off them', () => {
    expect(steppedBy(30_999, 10, frameMs, span())).toBe(31_000);
    expect(steppedBy(28_501, -10, frameMs, span())).toBe(28_500);
  });
});
