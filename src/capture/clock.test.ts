import { describe, expect, test } from 'vitest';

import type { MarkId } from '../contracts.js';
import { cameraClockUsable, resolveMarks } from './clock.js';

const reading = (id: string, wallMs: number, frameMs: number | null) => ({
  id: id as MarkId,
  wallMs,
  frameMs,
});

/**
 * Every tap is timed twice, because the lag between asking for a recording and
 * the first encoded frame is real and nothing reports it. The page's clock is
 * always there; the camera's is more accurate where it runs.
 *
 * The trap, and the bug that shipped: where the camera's clock is not offered
 * it does not read as missing. It reads as zero, over and over. Believing it
 * then puts every mark of a bout at the same instant, and all three tabs show
 * the first one — an app that looks like it is working.
 */
describe('whether the camera clock can be believed', () => {
  test('believes a clock that ran', () => {
    expect(
      cameraClockUsable([reading('a', 0, 2550), reading('b', 0, 5100), reading('c', 0, 7650)])
    ).toBe(true);
  });

  /** The iPhone case: a live stream's media time never leaves zero. */
  test('refuses a clock that never moved off zero', () => {
    expect(cameraClockUsable([reading('a', 0, 0), reading('b', 0, 0), reading('c', 0, 0)])).toBe(false);
  });

  test('refuses a clock that was not there at all', () => {
    expect(cameraClockUsable([reading('a', 0, null), reading('b', 0, null)])).toBe(false);
    expect(cameraClockUsable([reading('a', 0, 2550), reading('b', 0, null)])).toBe(false);
  });

  /** Taps happen in order, so their times must come back in order too. */
  test('refuses a clock that went backwards or stood still', () => {
    expect(cameraClockUsable([reading('a', 0, 5100), reading('b', 0, 2550)])).toBe(false);
    expect(cameraClockUsable([reading('a', 0, 2550), reading('b', 0, 2550)])).toBe(false);
  });

  test('has nothing to believe when nothing was marked', () => {
    expect(cameraClockUsable([])).toBe(false);
  });

  /** One reading cannot show a clock running, so it is not evidence either. */
  test('refuses a single reading, which proves nothing either way', () => {
    expect(cameraClockUsable([reading('a', 0, 2550)])).toBe(false);
  });
});

describe('placing the marks on the bout clock', () => {
  const ran = [reading('a', 1000, 1200), reading('b', 4000, 4300)];

  /** The one that is always there, so the one to default to. */
  test('uses the page clock unless asked otherwise', () => {
    expect(resolveMarks(ran, 'wall')).toEqual([
      { id: 'a', atMs: 1000 },
      { id: 'b', atMs: 4000 },
    ]);
  });

  test('uses the camera clock when asked and it can be believed', () => {
    expect(resolveMarks(ran, 'camera')).toEqual([
      { id: 'a', atMs: 1200 },
      { id: 'b', atMs: 4300 },
    ]);
  });

  /**
   * The bug, as a test. Asked for the camera's clock on a device that does not
   * run one, every mark would otherwise resolve to zero and the bout would have
   * three marks at the same instant.
   */
  test('falls back to the page clock when the camera clock cannot be believed', () => {
    const stuck = [reading('a', 1000, 0), reading('b', 4000, 0)];

    expect(resolveMarks(stuck, 'camera')).toEqual([
      { id: 'a', atMs: 1000 },
      { id: 'b', atMs: 4000 },
    ]);
  });

  test('has nothing to place when nothing was marked', () => {
    expect(resolveMarks([], 'camera')).toEqual([]);
  });
});
