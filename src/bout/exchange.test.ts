import { describe, expect, test } from 'vitest';

import type { ExchangeId, MarkId, MediaHandle, Take, TakeId } from '../contracts.js';
import { cut, durationOf, exchangeOf, withHit, withoutLastHit, withPoint } from './exchange.js';

const footage = {} as MediaHandle;

const take = (id: string, startedAtMs: number, durationMs: number): Take => ({
  id: id as TakeId,
  source: 'the phone',
  startedAtMs,
  durationMs,
  width: 1920,
  height: 1080,
  media: footage,
});

const mark = (id: string, atMs: number) => ({ id: id as MarkId, atMs });

const exchange = (marks: { id: MarkId; atMs: number }[], takes: Take[] = [take('t1', 0, 60_000)]) =>
  exchangeOf({
    id: 'b1' as ExchangeId,
    filmedAt: '2026-11-04T09:00:00.000Z',
    clock: { kind: 'take', take: 't1' as TakeId },
    takes,
    marks,
  });

describe('a bout and what was noticed in it', () => {
  test('keeps a mark at the instant it was taken', () => {
    expect(exchange([mark('m1', 30_000)]).marks).toEqual([{ id: 'm1', atMs: 30_000 }]);
  });

  /**
   * They are offsets into a recording, and a recording runs one way. Whatever
   * order they arrived in — and Capture may resolve them out of order when it
   * works out which clock to believe — what comes back is the order they
   * happened in, because everything downstream numbers them for the referee.
   */
  test('gives the marks back in the order they happened, however they went in', () => {
    const ordered = exchange([mark('c', 9_000), mark('a', 1_000), mark('b', 5_000)]);

    expect(ordered.marks.map((each) => each.id)).toEqual(['a', 'b', 'c']);
  });

  /** A referee who taps twice for one exchange meant both. Nothing is merged. */
  test('keeps two marks taken at the same instant', () => {
    expect(exchange([mark('m1', 4_000), mark('m2', 4_000)]).marks).toHaveLength(2);
  });

  /**
   * An id is how everything else refers to a mark — which tab is lit, which
   * span a cut is for. Two marks claiming one id is not an awkward bout, it is
   * a bug upstream, and carrying on would show the wrong footage under the
   * right number.
   */
  test('refuses two marks that claim the same id', () => {
    expect(() => exchange([mark('m1', 1_000), mark('m1', 7_000)])).toThrow(/m1/);
  });
});

describe('how far a bout reaches', () => {
  test('is as far as its footage goes', () => {
    expect(durationOf(exchange([], [take('t1', 0, 60_000)]))).toBe(60_000);
  });

  /**
   * With several angles the bout lasts as long as the longest-lasting one, not
   * as long as the first to stop. A phone whose battery died early must not
   * shorten a bout the others are still filming.
   */
  test('is as far as the furthest angle reaches, with several', () => {
    const angles = [take('t1', 0, 60_000), take('t2', 2_000, 61_000), take('t3', 500, 1_000)];

    expect(durationOf(exchange([], angles))).toBe(63_000);
  });

  /** Nothing filmed yet is a length of nothing, not a crash. */
  test('reaches nowhere when nothing was filmed', () => {
    expect(durationOf(exchange([], []))).toBe(0);
  });
});

/**
 * A cut is what to show and in what order. One span is instant replay — the
 * window around the mark being looked at. Several in a row is the highlight
 * video. They are the same thing, which is the whole reason the second use case
 * is not a second mechanism.
 */
describe('cutting a bout down to what is worth watching', () => {
  const spec = { leadMs: 1500, tailMs: 1000 };

  test('runs from before a mark to after it, anchored on the mark itself', () => {
    const { spans } = cut(exchange([mark('m1', 30_000)]), ['m1' as MarkId], spec);

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      fromMs: 28_500,
      toMs: 31_000,
      atMs: 30_000,
      shortLeadMs: 0,
      shortTailMs: 0,
    });
  });

  /**
   * Every angle the bout has, so that one phone and four phones differ by a
   * length rather than by a code path.
   */
  test('says which angles to show it from', () => {
    const angles = [take('t1', 0, 60_000), take('t2', 0, 60_000)];
    const { spans } = cut(exchange([mark('m1', 30_000)], angles), ['m1' as MarkId], spec);

    expect(spans[0]?.takes).toEqual(['t1', 't2']);
  });

  /**
   * A mark in the first moments of a bout has less run-up than was asked for
   * because it does not exist, not because anything went wrong.
   */
  test('gives a mark near the beginning what run-up there is', () => {
    const { spans } = cut(exchange([mark('m1', 400)]), ['m1' as MarkId], spec);

    expect(spans[0]).toMatchObject({ fromMs: 0, toMs: 1_400, shortLeadMs: 1_100 });
  });

  /**
   * The case that actually bites: the fight is stopped immediately after a
   * mark, so the recording ends before the window does. The footage is not
   * broken — there is no more of it — and the shortfall has to be knowable,
   * because a window that silently ends early looks like a fault.
   */
  test('gives a mark near the end what tail there is, and says how much is missing', () => {
    const { spans } = cut(exchange([mark('m1', 59_800)]), ['m1' as MarkId], spec);

    expect(spans[0]).toMatchObject({ fromMs: 58_300, toMs: 60_000, shortTailMs: 800 });
  });

  test('is one span per mark, in the order they happened', () => {
    const three = exchange([mark('a', 5_000), mark('b', 20_000), mark('c', 40_000)]);

    const { spans } = cut(three, ['c' as MarkId, 'a' as MarkId, 'b' as MarkId], spec);

    expect(spans.map((span) => span.atMs)).toEqual([5_000, 20_000, 40_000]);
  });

  /** Asking for nothing is a legitimate nothing — an empty highlight. */
  test('is empty when nothing was asked for', () => {
    expect(cut(exchange([mark('m1', 5_000)]), [], spec).spans).toEqual([]);
  });

  /**
   * Same reasoning as a duplicate id. A mark the bout does not have is a bug
   * upstream, and quietly returning a shorter cut would put a blank screen
   * where footage should be with nothing to say why.
   */
  test('refuses a mark the bout does not have', () => {
    expect(() => cut(exchange([mark('m1', 5_000)]), ['nope' as MarkId], spec)).toThrow(/nope/);
  });
});

/**
 * A point is given to a mark, from review: red, blue, or none. Only the marks
 * with a point start ticked on the summary, so it is how the referee says
 * which moments the saved video is about.
 */
describe('giving a mark its point', () => {
  const three = () => exchange([mark('a', 1_000), mark('b', 5_000), mark('c', 9_000)]);

  test('starts every mark with no point', () => {
    expect(three().marks.every((each) => each.point === undefined)).toBe(true);
  });

  test('gives a mark to red, then changes it to blue', () => {
    const red = withPoint(three(), 'b' as MarkId, 'red');
    expect(red.marks[1]?.point).toBe('red');

    const blue = withPoint(red, 'b' as MarkId, 'blue');
    expect(blue.marks[1]?.point).toBe('blue');
  });

  /** No point is the absence of one, not a third side. */
  test('takes a point away again', () => {
    const given = withPoint(three(), 'b' as MarkId, 'red');

    const taken = withPoint(given, 'b' as MarkId, null);

    // Strict, because toEqual would count a point set to undefined as none.
    expect(taken.marks[1]).toStrictEqual({ id: 'b', atMs: 5_000 });
  });

  test('leaves the other marks as they were', () => {
    const given = withPoint(withPoint(three(), 'a' as MarkId, 'blue'), 'c' as MarkId, 'red');

    expect(given.marks.map((each) => each.point)).toEqual(['blue', undefined, 'red']);
  });

  test('refuses a mark the exchange does not have', () => {
    expect(() => withPoint(three(), 'nope' as MarkId, 'red')).toThrow(/nope/);
  });
});

/**
 * Hits: any number per mark, each in the colour of whoever landed it, kept in
 * the order they were placed so the last can be undone.
 */
describe('placing hits on a mark', () => {
  const three = () => exchange([mark('a', 1_000), mark('b', 5_000), mark('c', 9_000)]);
  const hit = (atMs: number, side: 'red' | 'blue' = 'red', x = 0.3, y = 0.4) => ({ atMs, x, y, side });

  test('starts every mark with none', () => {
    expect(three().marks.every((each) => each.hits === undefined)).toBe(true);
  });

  test('keeps as many as are placed, in the order they were placed', () => {
    let placed = withHit(three(), 'b' as MarkId, hit(5_100, 'red'));
    placed = withHit(placed, 'b' as MarkId, hit(5_050, 'blue'));

    expect(placed.marks[1]?.hits).toEqual([hit(5_100, 'red'), hit(5_050, 'blue')]);
  });

  test('undoes the last one placed, and only that', () => {
    let placed = withHit(three(), 'b' as MarkId, hit(5_100, 'red'));
    placed = withHit(placed, 'b' as MarkId, hit(5_050, 'blue'));

    expect(withoutLastHit(placed, 'b' as MarkId).marks[1]?.hits).toEqual([hit(5_100, 'red')]);
  });

  /** Undone back to nothing, the mark is as it was before it had any. */
  test('leaves the mark as it was once the last is undone', () => {
    const placed = withHit(three(), 'b' as MarkId, hit(5_100));

    expect(withoutLastHit(placed, 'b' as MarkId).marks[1]).toStrictEqual({ id: 'b', atMs: 5_000 });
  });

  test('changes nothing when there is nothing to undo', () => {
    expect(withoutLastHit(three(), 'b' as MarkId)).toStrictEqual(three());
  });

  /** A double where nobody scores still has two hits to show. */
  test('keeps the hits when the point is taken away', () => {
    let placed = withPoint(three(), 'b' as MarkId, 'red');
    placed = withHit(placed, 'b' as MarkId, hit(5_100));

    expect(withPoint(placed, 'b' as MarkId, null).marks[1]?.hits).toEqual([hit(5_100)]);
  });

  test('refuses a mark the exchange does not have', () => {
    expect(() => withHit(three(), 'nope' as MarkId, hit(1_000))).toThrow(/nope/);
  });

  /** Off the picture is a bug upstream: the screen only places hits on it. */
  test('refuses a hit off the picture', () => {
    expect(() => withHit(three(), 'b' as MarkId, hit(5_000, 'red', 1.2, 0.5))).toThrow(/picture/);
    expect(() => withHit(three(), 'b' as MarkId, hit(5_000, 'red', 0.5, -0.1))).toThrow(/picture/);
  });
});

/**
 * A hit is something in the footage, so a stretch carries every hit that
 * lands inside it — the hits of its own mark, and of any other mark whose
 * hits happen to fall within it.
 */
describe('the hits a stretch carries', () => {
  const spec = { leadMs: 1500, tailMs: 1000 };

  test('carries the hits that land inside it, from any mark', () => {
    let placed = exchange([mark('a', 5_000), mark('b', 6_000), mark('c', 30_000)]);
    placed = withHit(placed, 'a' as MarkId, { atMs: 5_100, x: 0.2, y: 0.2, side: 'red' });
    placed = withHit(placed, 'b' as MarkId, { atMs: 5_900, x: 0.8, y: 0.8, side: 'blue' });
    placed = withHit(placed, 'c' as MarkId, { atMs: 30_000, x: 0.5, y: 0.5, side: 'red' });

    const { spans } = cut(placed, ['a' as MarkId], spec);

    expect(spans[0]?.hits?.map((each) => each.atMs)).toEqual([5_100, 5_900]);
  });

  test('carries none when no hit lands inside it', () => {
    expect(cut(exchange([mark('a', 5_000)]), ['a' as MarkId], spec).spans[0]?.hits).toEqual([]);
  });
});
