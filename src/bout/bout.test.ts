import { describe, expect, test } from 'vitest';

import type { BoutId, Exchange, ExchangeId, MarkId, MediaHandle, TakeId } from '../contracts.js';
import { cutBout, exchangeHolding, newBout, withExchange, withExchangeReplaced } from './bout.js';

const exchange = (n: number, marks: number[]): Exchange => ({
  id: `e${n}` as ExchangeId,
  filmedAt: '2026-11-10T09:00:00.000Z',
  clock: { kind: 'take', take: `t${n}` as TakeId },
  takes: [
    {
      id: `t${n}` as TakeId,
      source: 'the phone',
      startedAtMs: 0,
      durationMs: 60_000,
      width: 1920,
      height: 1080,
      media: {} as MediaHandle,
    },
  ],
  marks: marks.map((atMs, index) => ({ id: `e${n}m${index + 1}` as MarkId, atMs })),
});

const start = () => newBout('b1' as BoutId, '2026-11-10T09:00:00.000Z');
const ids = (...values: string[]) => values.map((value) => value as MarkId);
const spec = { leadMs: 1500, tailMs: 1000 };

describe('a bout, made of exchanges', () => {
  test('starts with none', () => {
    expect(start().exchanges).toEqual([]);
  });

  test('keeps its exchanges in the order they were filmed', () => {
    const bout = withExchange(withExchange(start(), exchange(1, [5_000])), exchange(2, [8_000]));

    expect(bout.exchanges.map((each) => each.id)).toEqual(['e1', 'e2']);
  });

  /** The same exchange twice is a bug upstream, and would save its marks twice. */
  test('refuses the same exchange twice', () => {
    const once = withExchange(start(), exchange(1, [5_000]));

    expect(() => withExchange(once, exchange(1, [5_000]))).toThrow(/e1/);
  });

  /**
   * The diagnostics panel can re-place an exchange's marks by the other clock;
   * the exchange keeps its place in the bout when that happens.
   */
  test('replaces an exchange where it stands', () => {
    const bout = withExchange(withExchange(start(), exchange(1, [5_000])), exchange(2, [8_000]));

    const replaced = withExchangeReplaced(bout, { ...exchange(1, [5_100]) });

    expect(replaced.exchanges.map((each) => each.id)).toEqual(['e1', 'e2']);
    expect(replaced.exchanges[0]?.marks[0]?.atMs).toBe(5_100);
  });

  test('knows which exchange a mark belongs to', () => {
    const bout = withExchange(withExchange(start(), exchange(1, [5_000])), exchange(2, [8_000, 20_000]));

    expect(exchangeHolding(bout, 'e2m2' as MarkId)?.id).toBe('e2');
    expect(exchangeHolding(bout, 'nope' as MarkId)).toBeNull();
  });
});

/**
 * The saved video is the whole bout's story: every chosen moment, exchange by
 * exchange, in the order they happened. Each stretch names the recording it
 * comes from, which is all the recorder needs to switch between them.
 */
describe('cutting a whole bout down to its moments', () => {
  const bout = withExchange(
    withExchange(withExchange(start(), exchange(1, [5_000, 30_000])), exchange(2, [])),
    exchange(3, [10_000])
  );

  test('runs exchange by exchange, then mark by mark', () => {
    const { spans } = cutBout(bout, ids('e3m1', 'e1m2', 'e1m1'), spec);

    expect(spans.map((span) => [span.takes[0], span.atMs])).toEqual([
      ['t1', 5_000],
      ['t1', 30_000],
      ['t3', 10_000],
    ]);
  });

  test('takes nothing from an exchange with nothing chosen in it', () => {
    const { spans } = cutBout(bout, ids('e3m1'), spec);

    expect(spans.map((span) => span.takes[0])).toEqual(['t3']);
  });

  test('is empty when nothing is chosen', () => {
    expect(cutBout(bout, [], spec).spans).toEqual([]);
  });

  test('refuses a mark the bout does not have', () => {
    expect(() => cutBout(bout, ids('nope'), spec)).toThrow(/nope/);
  });
});
