import { describe, expect, test } from 'vitest';

import type { Bout, BoutId, Exchange, ExchangeId, MarkId, TakeId } from '../contracts.js';
import { everyMark, isChosen, pointsOnly, showing, toggled } from './selection.js';

const id = (value: string) => value as MarkId;

const exchange = (n: number, marks: [string, number][]): Exchange => ({
  id: `e${n}` as ExchangeId,
  filmedAt: '2026-11-09T14:00:00.000Z',
  clock: { kind: 'take', take: `t${n}` as TakeId },
  takes: [],
  marks: marks.map(([name, atMs]) => ({ id: id(name), atMs })),
});

/** Two exchanges: a and b in the first, c in the second. */
const bout: Bout = {
  id: 'b1' as BoutId,
  startedAt: '2026-11-09T14:00:00.000Z',
  exchanges: [
    exchange(1, [
      ['a', 1_000],
      ['b', 5_000],
    ]),
    exchange(2, [['c', 2_000]]),
  ],
};

describe('choosing which moments of a bout go into the saved video', () => {
  test('starts with every mark of every exchange chosen', () => {
    expect(everyMark(bout).chosen).toEqual(['a', 'b', 'c']);
  });

  test('leaves a mark out when it is unticked', () => {
    const without = toggled(everyMark(bout), bout, id('b'));

    expect(without.chosen).toEqual(['a', 'c']);
    expect(isChosen(without, id('b'))).toBe(false);
  });

  /**
   * Ticked back in, a mark goes back where it happened — its exchange, and its
   * place in that exchange. The video runs in the order of the bout, not in
   * the order of taps on a checklist. Note that c happened at 2s into the
   * second exchange, which is after b at 5s into the first.
   */
  test('puts a mark back in the order of the bout when it is ticked again', () => {
    let choice = everyMark(bout);
    choice = toggled(choice, bout, id('a'));
    choice = toggled(choice, bout, id('c'));
    choice = toggled(choice, bout, id('a'));

    expect(choice.chosen).toEqual(['a', 'b']);
  });

  test('can end up with nothing chosen', () => {
    let choice = everyMark(bout);
    for (const each of ['a', 'b', 'c']) choice = toggled(choice, bout, id(each));

    expect(choice.chosen).toEqual([]);
  });

  /** A mark the bout does not have is a bug upstream, as everywhere else. */
  test('refuses a mark the bout does not have', () => {
    expect(() => toggled(everyMark(bout), bout, id('nope'))).toThrow(/nope/);
  });
});

/**
 * Behind the checklist, one moment plays on a loop so the referee can see what
 * they are choosing. Which one is whichever they last touched — ticked or
 * unticked, since unticking is also a decision made by looking.
 */
describe('which moment plays behind the list', () => {
  test('is the first mark of the bout before anything has been touched', () => {
    expect(showing(everyMark(bout), bout)).toBe('a');
  });

  test('is the mark last touched, in whichever exchange it is', () => {
    let choice = toggled(everyMark(bout), bout, id('c'));
    choice = toggled(choice, bout, id('c'));

    expect(showing(choice, bout)).toBe('c');
  });

  test('is the mark last unticked, too', () => {
    expect(showing(toggled(everyMark(bout), bout, id('b')), bout)).toBe('b');
  });

  test('is nothing for a bout with no marks', () => {
    const empty = { ...bout, exchanges: [] };
    expect(showing(everyMark(empty), empty)).toBeNull();
  });
});

/**
 * The summary opens with only the marks that were given a point ticked: those
 * are the moments the bout turned on, and the saved video is their story. The
 * rest are there to tick if wanted.
 */
describe('starting the summary from the points given', () => {
  const pointed: Bout = {
    ...bout,
    exchanges: [
      exchange(1, [
        ['a', 1_000],
        ['b', 5_000],
      ]),
      exchange(2, [['c', 2_000]]),
    ].map((each, index) =>
      index === 0
        ? { ...each, marks: each.marks.map((m) => (m.id === 'b' ? { ...m, point: 'red' as const } : m)) }
        : { ...each, marks: each.marks.map((m) => ({ ...m, point: 'blue' as const })) }
    ),
  };

  test('ticks only the marks that were given a point', () => {
    expect(pointsOnly(pointed).chosen).toEqual(['b', 'c']);
  });

  test('ticks nothing when no point was given', () => {
    expect(pointsOnly(bout).chosen).toEqual([]);
  });

  /** What plays first is what is going into the video. */
  test('plays the first pointed moment behind the list before anything is touched', () => {
    expect(showing(pointsOnly(pointed), pointed)).toBe('b');
  });
});
