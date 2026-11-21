import { describe, expect, test } from 'vitest';

import type { Hit } from '../contracts.js';
import { HIT_LEAD_MS, HIT_TAIL_MS, fromFrame, hitEffectAt, toFrame } from './hits.js';

/**
 * A tap lands on the screen, but a hit belongs to the picture. The video sits
 * inside black bars wherever its shape differs from the box it is shown in,
 * and the saved video is a different size again, so a hit is kept as a
 * fraction of the video frame — and a tap on a bar is not a hit at all.
 */
describe('where on the picture a tap landed', () => {
  // A landscape video in a tall box, as on a phone held upright: bars above
  // and below. The picture is 400 wide and 225 high, starting 287.5 down.
  const box = { left: 0, top: 0, width: 400, height: 800 };
  const landscape = { width: 1920, height: 1080 };

  test('maps the middle of the picture to the middle of the frame', () => {
    expect(toFrame({ x: 200, y: 400 }, box, landscape)).toEqual({ x: 0.5, y: 0.5 });
  });

  test('maps the corners of the picture to the corners of the frame', () => {
    expect(toFrame({ x: 0, y: 287.5 }, box, landscape)).toEqual({ x: 0, y: 0 });
    expect(toFrame({ x: 400, y: 512.5 }, box, landscape)).toEqual({ x: 1, y: 1 });
  });

  test('is no hit at all on the bars above and below a landscape picture', () => {
    expect(toFrame({ x: 200, y: 100 }, box, landscape)).toBeNull();
    expect(toFrame({ x: 200, y: 700 }, box, landscape)).toBeNull();
  });

  /** A portrait video in a wide box: bars to the left and right instead. */
  test('is no hit on the bars beside a portrait picture', () => {
    const wide = { left: 0, top: 0, width: 800, height: 400 };
    const portrait = { width: 1080, height: 1920 };

    expect(toFrame({ x: 50, y: 200 }, wide, portrait)).toBeNull();
    expect(toFrame({ x: 400, y: 200 }, wide, portrait)).toEqual({ x: 0.5, y: 0.5 });
  });

  /** The box is wherever the page put it, not at the corner of the screen. */
  test('measures from where the box is, not from the corner of the screen', () => {
    const moved = { ...box, left: 30, top: 60 };

    expect(toFrame({ x: 230, y: 460 }, moved, landscape)).toEqual({ x: 0.5, y: 0.5 });
  });

  test('puts a frame position back where it was tapped', () => {
    const at = toFrame({ x: 123, y: 345 }, box, landscape);

    expect(at).not.toBeNull();
    const back = fromFrame(at!, box, landscape);
    expect(back.x).toBeCloseTo(123, 6);
    expect(back.y).toBeCloseTo(345, 6);
  });

  /** A video that has not reported its size yet has no picture to tap. */
  test('is no hit while the video has no size', () => {
    expect(toFrame({ x: 200, y: 400 }, box, { width: 0, height: 0 })).toBeNull();
  });
});

/**
 * The effect: it starts to show just before the moment of the hit — two or
 * three frames — is at its strongest on it, and fades as it grows over the
 * half-second after. Lopsided on purpose: before the hit, a ring is a spoiler.
 */
describe('how a hit shows over time', () => {
  const hit: Hit = { atMs: 10_000, x: 0.5, y: 0.5, side: 'red' };

  test('shows nothing well before or well after', () => {
    expect(hitEffectAt(10_000 - HIT_LEAD_MS - 1, hit)).toBeNull();
    expect(hitEffectAt(10_000 + HIT_TAIL_MS + 1, hit)).toBeNull();
  });

  test('comes up only just before the moment of the hit', () => {
    expect(HIT_LEAD_MS).toBe(80);
  });

  test('comes up evenly over that time', () => {
    expect(hitEffectAt(10_000 - HIT_LEAD_MS / 2, hit)?.alpha).toBeCloseTo(0.5, 5);
  });

  test('is at its strongest on the moment itself', () => {
    expect(hitEffectAt(10_000, hit)?.alpha).toBe(1);
  });

  test('fades out over the half-second after', () => {
    expect(HIT_TAIL_MS).toBe(500);
    expect(hitEffectAt(10_000 + 250, hit)?.alpha).toBeCloseTo(0.5, 5);
  });

  test('keeps growing from first sight to last', () => {
    const sizes = [-HIT_LEAD_MS, -40, 0, 100, 250, 400, HIT_TAIL_MS].map(
      (offset) => hitEffectAt(10_000 + offset, hit)!.grow
    );

    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]!);
    expect(sizes[0]).toBe(0);
    expect(sizes.at(-1)).toBe(1);
  });

  /** Both ends are settings, and a timing given is the one used. */
  test('keeps to the timing it is given', () => {
    const longer = { leadMs: 300, tailMs: 1000 };

    expect(hitEffectAt(10_000 - 250, hit, longer)).not.toBeNull();
    expect(hitEffectAt(10_000 - 250, hit)).toBeNull();
    expect(hitEffectAt(10_000 + 800, hit, longer)?.alpha).toBeCloseTo(0.2, 5);
    expect(hitEffectAt(10_000 + 1_001, hit, longer)).toBeNull();
  });

  /** Nothing before at all is a timing too: it appears on the moment. */
  test('appears on the moment itself when nothing before is wanted', () => {
    const none = { leadMs: 0, tailMs: 500 };

    expect(hitEffectAt(9_999, hit, none)).toBeNull();
    expect(hitEffectAt(10_000, hit, none)?.alpha).toBe(1);
  });
});
