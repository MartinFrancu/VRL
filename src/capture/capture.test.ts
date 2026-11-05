import { describe, expect, test } from 'vitest';

import type { MediaHandle } from '../contracts.js';
import { Capture } from './capture.js';

const footage = {} as MediaHandle;

/**
 * Every dependency here is one of ours — a camera view, a recording, a ruler.
 * None of them is a stand-in for `MediaRecorder` or `getUserMedia`, which the
 * working agreement forbids faking: the seam goes in front of the browser, and
 * this is the seam.
 */
function harness(
  { frameClock = [100, 1200, 4300] as (number | null)[], shape = { width: 1920, height: 1080 } } = {}
) {
  let wall = 0;
  let nextId = 0;
  let frameAt = 0;
  const stopped: string[] = [];
  let live = { ...shape };

  const capture = new Capture({
    now: () => wall,
    nowIso: () => '2026-11-05T09:00:00.000Z',
    newId: () => `id${++nextId}`,
    source: 'the phone',
    camera: {
      shape: () => live,
      frameClockMs: () => frameClock[frameAt++] ?? null,
    },
    startRecording: () => ({
      mimeType: 'video/mp4',
      stop: async () => {
        stopped.push('yes');
        return footage;
      },
    }),
    measureDuration: async () => 61_000,
  });

  return {
    capture,
    stopped,
    /** Move the page's clock on, as time passing during a bout. */
    tick: (ms: number) => (wall += ms),
    /** Turn the phone mid-bout, which must not change the recording's shape. */
    turnPhone: (next: { width: number; height: number }) => (live = next),
  };
}

describe('capturing a bout', () => {
  test('starts out not recording, with nothing marked', () => {
    const { capture } = harness();

    expect(capture.recording).toBe(false);
    expect(capture.markCount).toBe(0);
  });

  /** The picture is only the mark button while there is a bout to mark. */
  test('refuses a mark when nothing is being filmed', () => {
    const { capture } = harness();

    expect(() => capture.mark()).toThrow(/not recording/i);
  });

  test('counts the marks taken', () => {
    const { capture, tick } = harness();
    capture.start();

    capture.mark();
    tick(1000);
    capture.mark();

    expect(capture.markCount).toBe(2);
  });

  test('refuses to finish a bout that was never started', async () => {
    const { capture } = harness();

    await expect(capture.finish('wall')).rejects.toThrow(/not recording/i);
  });
});

describe('the bout that comes out', () => {
  test('carries the marks, in order, placed by the page clock', async () => {
    const { capture, tick } = harness();
    capture.start();
    tick(1000);
    capture.mark();
    tick(3000);
    capture.mark();

    const bout = await capture.finish('wall');

    expect(bout.marks.map((mark) => mark.atMs)).toEqual([1000, 4000]);
  });

  test('places the marks by the camera clock when it ran', async () => {
    const { capture, tick } = harness({ frameClock: [100, 1200, 4300] });
    capture.start();
    tick(1000);
    capture.mark();
    tick(3000);
    capture.mark();

    const bout = await capture.finish('camera');

    // Offsets from the frame clock's reading at the moment filming began.
    expect(bout.marks.map((mark) => mark.atMs)).toEqual([1100, 4200]);
  });

  /**
   * The bug that shipped. On iOS a live stream's frame clock sits at zero and
   * never moves, so asking for it would put every mark of the bout at the same
   * instant — three tabs all showing the first mark, on an app that looked
   * like it was working.
   */
  test('falls back to the page clock when the camera clock never ran', async () => {
    const { capture, tick } = harness({ frameClock: [0, 0, 0] });
    capture.start();
    tick(1000);
    capture.mark();
    tick(3000);
    capture.mark();

    const bout = await capture.finish('camera');

    expect(bout.marks.map((mark) => mark.atMs)).toEqual([1000, 4000]);
  });

  test('has one take, and a clock that names it', async () => {
    const { capture } = harness();
    capture.start();
    capture.mark();

    const bout = await capture.finish('wall');

    expect(bout.takes).toHaveLength(1);
    expect(bout.clock).toEqual({ kind: 'take', take: bout.takes[0]?.id });
  });

  test('carries the length the file turned out to be', async () => {
    const { capture } = harness();
    capture.start();
    capture.mark();

    const bout = await capture.finish('wall');

    expect(bout.takes[0]?.durationMs).toBe(61_000);
  });

  /**
   * The orientation lesson, as a test. A recording keeps the shape the camera
   * gave when it was asked, and turning the phone afterwards does not change
   * it — so the shape recorded against the take must be the one from when
   * filming began, not the one the camera would report now.
   */
  test('carries the shape the camera gave when filming began, not the shape now', async () => {
    const { capture, turnPhone } = harness({ shape: { width: 1920, height: 1080 } });
    capture.start();
    capture.mark();
    turnPhone({ width: 1080, height: 1920 });

    const bout = await capture.finish('wall');

    expect(bout.takes[0]).toMatchObject({ width: 1920, height: 1080 });
  });
});

/**
 * The diagnostics panel can flip which clock places the marks, and it must
 * take effect on the bout already on screen rather than only the next one. So
 * the readings outlive the bout they became.
 */
describe('placing a finished bout by the other clock', () => {
  test('re-places the marks of the bout just finished', async () => {
    const { capture, tick } = harness({ frameClock: [100, 1200, 4300] });
    capture.start();
    tick(1000);
    capture.mark();
    tick(3000);
    capture.mark();
    const byPage = await capture.finish('wall');

    const byCamera = capture.usingClock('camera');

    expect(byPage.marks.map((mark) => mark.atMs)).toEqual([1000, 4000]);
    expect(byCamera?.marks.map((mark) => mark.atMs)).toEqual([1100, 4200]);
    expect(byCamera?.id).toBe(byPage.id);
  });

  test('has nothing to re-place before any bout has finished', () => {
    expect(harness().capture.usingClock('camera')).toBeNull();
  });

  /** For the panel's own table of page clock against camera clock. */
  test('keeps the readings of the bout just finished, timed both ways', async () => {
    const { capture, tick } = harness({ frameClock: [100, 1200] });
    capture.start();
    tick(1000);
    capture.mark();
    await capture.finish('wall');

    expect(capture.lastReadings).toEqual([{ id: 'id2', wallMs: 1000, frameMs: 1100 }]);
  });
});

describe('letting a bout go', () => {
  test('stops the recording and leaves nothing marked', async () => {
    const { capture, stopped } = harness();
    capture.start();
    capture.mark();

    await capture.discard();

    expect(stopped).toEqual(['yes']);
    expect(capture.recording).toBe(false);
    expect(capture.markCount).toBe(0);
  });

  /** A fresh bout inherits nothing, whatever the last one left behind. */
  test('starts the next bout clean', async () => {
    const { capture } = harness();
    capture.start();
    capture.mark();
    await capture.discard();

    capture.start();

    expect(capture.markCount).toBe(0);
    expect(capture.recording).toBe(true);
  });
});
