import { describe, expect, test } from 'vitest';

import type { Cut, Hit, Span, TakeId } from '../contracts.js';
import {
  END_GLIDE_MS,
  LABEL_MS,
  TITLE_MS,
  endGlideAt,
  fadeAt,
  hitTally,
  labelLayout,
  labelStrengthAt,
  logoAt,
  reelFilename,
  reelLengthMs,
  tallyLayout,
  titleLayout,
  titleStrengthAt,
  watermarkBox,
} from './reel.js';

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

  /** The end card holds alone after the last moment, and adds to it. */
  test('adds the end card, when there is one', () => {
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
  /**
   * Top-left: the bottom of a Short or a Reel is covered by its caption, the
   * account name and the buttons, and the top-right by the camera and search.
   */
  test('is in the top-left corner, clear of both edges', () => {
    const box = watermarkBox(1280, 720);

    expect(box.left).toBeGreaterThan(0);
    expect(box.left).toBeLessThan(1280 * 0.1);
    expect(box.top).toBeGreaterThan(0);
    expect(box.top).toBeLessThan(720 * 0.1);
  });

  test('is 12% of the shorter side, landscape or portrait', () => {
    expect(watermarkBox(1280, 720).height).toBeCloseTo(720 * 0.12, 5);
    expect(watermarkBox(720, 1280).height).toBeCloseTo(720 * 0.12, 5);
  });

  test('keeps the same margin from the left as from the top', () => {
    const box = watermarkBox(720, 1280);

    expect(box.left).toBeCloseTo(box.top, 5);
  });

  test("keeps the logo's own shape", () => {
    expect(watermarkBox(1280, 720).width).toBeCloseTo(watermarkBox(1280, 720).height, 5);
    const wide = watermarkBox(1280, 720, 2);

    expect(wide.width).toBeCloseTo(wide.height * 2, 5);
  });
});

/**
 * The saved video ends on the full logo in the middle, alone on black: during
 * the last half-second of the last moment the corner logo grows into the
 * middle, then holds there. Ending on black, it loops cleanly into a start
 * that fades up from black.
 */
describe('where the logo is as the saved video ends', () => {
  const centre = (box: { left: number; top: number; width: number; height: number }) => ({
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  });

  test('sits in its corner, see-through, until the end comes', () => {
    expect(logoAt(0, 1920, 1080)).toEqual({ ...watermarkBox(1920, 1080), opacity: 0.85 });
  });

  test('ends large, in the middle, and solid', () => {
    const logo = logoAt(1, 1920, 1080);

    expect(centre(logo)).toEqual({ x: 960, y: 540 });
    expect(logo.height).toBeCloseTo(1080 * 0.6, 5);
    expect(logo.opacity).toBe(1);
  });

  /** Partway there it is between the two, in place and in size. */
  test('is on its way partway through', () => {
    const corner = logoAt(0, 1920, 1080);
    const middle = logoAt(1, 1920, 1080);
    const half = logoAt(0.5, 1920, 1080);

    expect(half.height).toBeGreaterThan(corner.height);
    expect(half.height).toBeLessThan(middle.height);
    expect(half.left).toBeGreaterThan(corner.left);
    expect(half.left).toBeLessThan(middle.left);
  });

  test("keeps the logo's own shape throughout", () => {
    for (const towards of [0, 0.3, 1]) {
      const logo = logoAt(towards, 1280, 720, 2);
      expect(logo.width).toBeCloseTo(logo.height * 2, 5);
    }
  });

  describe('how far it has gone, during the last moment', () => {
    const last = span(10_000, 12_000);

    test('not at all, until the last half-second', () => {
      expect(endGlideAt(10_000, last)).toBe(0);
      expect(endGlideAt(12_000 - END_GLIDE_MS, last)).toBe(0);
    });

    test('evenly over the last half-second', () => {
      expect(endGlideAt(12_000 - END_GLIDE_MS / 2, last)).toBeCloseTo(0.5, 5);
    });

    test('all the way, at the end and beyond', () => {
      expect(endGlideAt(12_000, last)).toBe(1);
      expect(endGlideAt(13_000, last)).toBe(1);
    });
  });
});

/**
 * The title typed on the Save screen, big over the first two seconds of the
 * footage: the hook a short video needs, without holding the action back.
 */
describe('the title over the start of the saved video', () => {
  test('is fully there from the very first frame', () => {
    expect(titleStrengthAt(0)).toBe(1);
    expect(titleStrengthAt(TITLE_MS / 2)).toBe(1);
  });

  test('fades out by the end of its time, and stays gone', () => {
    expect(titleStrengthAt(TITLE_MS - 150)).toBeGreaterThan(0);
    expect(titleStrengthAt(TITLE_MS - 150)).toBeLessThan(1);
    expect(titleStrengthAt(TITLE_MS)).toBe(0);
    expect(titleStrengthAt(60_000)).toBe(0);
  });

  /** In the top third, below the logo, centred, and as big on either shape. */
  test('sits centred in the top third, below the logo', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const title = titleLayout(width, height);
      const logo = watermarkBox(width, height);

      expect(title.x).toBe(width / 2);
      expect(title.y - title.fontPx / 2).toBeGreaterThan(logo.top + logo.height);
      expect(title.y + title.fontPx / 2).toBeLessThan(height / 3);
      expect(title.fontPx).toBeCloseTo(1080 * 0.08, 5);
      expect(title.maxWidth).toBeCloseTo(width * 0.9, 5);
    }
  });
});

/**
 * How many hits each side landed in the saved video, for its end card. Counted
 * from what is in the video — the moments ticked — not from the whole bout.
 */
describe('the hit count on the end card', () => {
  const hit = (atMs: number, side: Hit['side'], x = 0.5): Hit => ({ atMs, x, y: 0.5, side });
  const withHits = (from: number, to: number, hits: Hit[]): Span => ({ ...span(from, to), hits });

  test('counts each side', () => {
    const counted = hitTally(cut(withHits(0, 2_000, [hit(500, 'red'), hit(900, 'blue'), hit(1_200, 'red')])));

    expect(counted).toEqual({ red: 2, blue: 1 });
  });

  test('adds up across every moment', () => {
    const counted = hitTally(cut(withHits(0, 2_000, [hit(500, 'red')]), withHits(5_000, 7_000, [hit(6_000, 'blue')])));

    expect(counted).toEqual({ red: 1, blue: 1 });
  });

  /** Two marks close together share footage, and so share its hits. Once each. */
  test('counts a hit once, even when two moments overlap over it', () => {
    const shared = hit(1_500, 'red');
    const counted = hitTally(cut(withHits(0, 2_000, [shared]), withHits(1_000, 3_000, [shared, hit(2_500, 'blue')])));

    expect(counted).toEqual({ red: 1, blue: 1 });
  });

  test('is nothing, with nothing annotated', () => {
    expect(hitTally(cut(span(0, 2_000)))).toEqual({ red: 0, blue: 0 });
  });

  /** Below the end card's logo, inside the picture, on either shape. */
  test('sits centred below the logo of the end card', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const tally = tallyLayout(width, height);
      const logo = logoAt(1, width, height);

      expect(tally.x).toBe(width / 2);
      expect(tally.y - tally.fontPx / 2).toBeGreaterThan(logo.top + logo.height);
      expect(tally.y + tally.fontPx / 2).toBeLessThan(height);
    }
  });
});

/**
 * "Exchange 2" over the first moment of each exchange, as the video moves on
 * to it — briefly, and below where a title would be, so both can be read.
 */
describe('the exchange label over a moment', () => {
  test('is there from the start of the moment, then fades out and stays gone', () => {
    expect(labelStrengthAt(0)).toBe(1);
    expect(labelStrengthAt(LABEL_MS - 150)).toBeGreaterThan(0);
    expect(labelStrengthAt(LABEL_MS - 150)).toBeLessThan(1);
    expect(labelStrengthAt(LABEL_MS)).toBe(0);
    expect(labelStrengthAt(60_000)).toBe(0);
  });

  test('sits centred below the title, smaller, still in the top half', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const label = labelLayout(width, height);
      const title = titleLayout(width, height);

      expect(label.x).toBe(width / 2);
      expect(label.fontPx).toBeLessThan(title.fontPx);
      expect(label.y - label.fontPx / 2).toBeGreaterThan(title.y + title.fontPx / 2);
      expect(label.y + label.fontPx / 2).toBeLessThan(height / 2);
    }
  });
});
