import { describe, expect, test } from 'vitest';

import type { Cut, Span, TakeId } from '../contracts.js';
import { INTRO_GLIDE_MS, INTRO_HOLD_MS, fadeAt, logoAt, reelFilename, reelLengthMs, watermarkBox } from './reel.js';

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

  /** The opening logo holds alone before the first moment, and adds to it. */
  test('adds the opening logo, when there is one', () => {
    expect(reelLengthMs(cut(span(1_000, 3_500)), 1_000)).toBe(3_500);
    expect(reelLengthMs(cut(), 1_000)).toBe(0);
  });

  /** Overlapping stretches are not yet merged, so for now they double-count. */
  test('counts every stretch it is given, overlapping or not', () => {
    expect(reelLengthMs(cut(span(1_000, 3_500), span(2_000, 4_500)))).toBe(5_000);
  });
});

describe('what the saved video is called', () => {
  const when = '2026-11-09T14:32:05.000Z';

  /**
   * The date first, so a phone full of these sorts itself into the order the
   * bouts happened in.
   */
  test('leads with the date the bout started', () => {
    expect(reelFilename(when, 3)).toMatch(/^2026-11-09/);
  });

  /**
   * Spelled out in full rather than with `toContain`, because "1 marks"
   * contains "1 mark" and a substring check waves the wrong one through.
   */
  test('says how many moments are in it', () => {
    expect(reelFilename(when, 3)).toBe('2026-11-09 SBA 3 marks.mp4');
    expect(reelFilename(when, 1)).toBe('2026-11-09 SBA 1 mark.mp4');
  });

  test('ends in something a phone will recognise as a video', () => {
    expect(reelFilename(when, 2, 'video/mp4')).toMatch(/\.mp4$/);
    expect(reelFilename(when, 2, 'video/webm;codecs=vp9')).toMatch(/\.webm$/);
  });

  /**
   * It goes to a share sheet and from there to who knows what — a filesystem,
   * a chat app, a cloud drive. Nothing in the name should make any of them
   * flinch.
   */
  test('has nothing in it that a filesystem would object to', () => {
    expect(reelFilename(when, 2)).toMatch(/^[\w \-.]+$/);
  });

  test('copes with a bout whose date was never recorded', () => {
    expect(reelFilename('', 2)).toMatch(/^[\w \-.]+\.mp4$/);
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

/**
 * The SBA logo in the corner of every saved video. Sized by the shorter side,
 * so a portrait video and a landscape one carry the same size of logo for the
 * same size of picture, rather than one of them getting a tiny one.
 */
describe('where the logo goes in the saved video', () => {
  test('is in the bottom-left corner, clear of both edges', () => {
    const box = watermarkBox(1280, 720);

    expect(box.left).toBeGreaterThan(0);
    expect(box.left).toBeLessThan(1280 * 0.1);
    expect(box.top + box.height).toBeLessThan(720);
    expect(box.top + box.height).toBeGreaterThan(720 * 0.9);
  });

  test('is 12% of the shorter side, landscape or portrait', () => {
    expect(watermarkBox(1280, 720).height).toBeCloseTo(720 * 0.12, 5);
    expect(watermarkBox(720, 1280).height).toBeCloseTo(720 * 0.12, 5);
  });

  test('keeps the same margin from the left as from the bottom', () => {
    const box = watermarkBox(720, 1280);

    expect(box.left).toBeCloseTo(1280 - (box.top + box.height), 5);
  });

  test("keeps the logo's own shape", () => {
    expect(watermarkBox(1280, 720).width).toBeCloseTo(watermarkBox(1280, 720).height, 5);
    const wide = watermarkBox(1280, 720, 2);

    expect(wide.width).toBeCloseTo(wide.height * 2, 5);
  });
});

/**
 * The saved video opens on the full logo in the middle, alone on black, then
 * the logo shrinks into its corner while the first moment comes up beneath it.
 */
describe('where the logo is as the saved video opens', () => {
  const centre = (box: { left: number; top: number; width: number; height: number }) => ({
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  });

  test('starts large, in the middle, and solid', () => {
    const logo = logoAt(0, 1920, 1080);

    expect(centre(logo)).toEqual({ x: 960, y: 540 });
    expect(logo.height).toBeCloseTo(1080 * 0.6, 5);
    expect(logo.opacity).toBe(1);
  });

  test('holds there for the whole of the hold', () => {
    expect(logoAt(INTRO_HOLD_MS, 1920, 1080)).toEqual(logoAt(0, 1920, 1080));
  });

  test('ends in the corner, exactly where it then stays', () => {
    const corner = watermarkBox(1920, 1080);
    const settled = logoAt(INTRO_HOLD_MS + INTRO_GLIDE_MS, 1920, 1080);

    expect(settled).toEqual({ ...corner, opacity: 0.85 });
    expect(logoAt(60_000, 1920, 1080)).toEqual(settled);
  });

  /** Partway through the glide it is between the two, in place and in size. */
  test('is on its way partway through the glide', () => {
    const start = logoAt(0, 1920, 1080);
    const end = logoAt(INTRO_HOLD_MS + INTRO_GLIDE_MS, 1920, 1080);
    const half = logoAt(INTRO_HOLD_MS + INTRO_GLIDE_MS / 2, 1920, 1080);

    expect(half.height).toBeLessThan(start.height);
    expect(half.height).toBeGreaterThan(end.height);
    expect(half.left).toBeLessThan(start.left);
    expect(half.left).toBeGreaterThan(end.left);
  });

  test("keeps the logo's own shape throughout", () => {
    for (const atMs of [0, INTRO_HOLD_MS + 100, INTRO_HOLD_MS + INTRO_GLIDE_MS]) {
      const logo = logoAt(atMs, 1280, 720, 2);
      expect(logo.width).toBeCloseTo(logo.height * 2, 5);
    }
  });
});
