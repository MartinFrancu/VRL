import { describe, expect, test } from 'vitest';

import type { Exchange, ExchangeId, MarkId, TakeId } from '../contracts.js';
import { everyMark, isChosen, showing, toggled } from './selection.js';

const id = (value: string) => value as MarkId;

const exchange: Exchange = {
  id: 'b1' as ExchangeId,
  filmedAt: '2026-11-09T14:00:00.000Z',
  clock: { kind: 'take', take: 't1' as TakeId },
  takes: [],
  marks: [
    { id: id('a'), atMs: 1_000 },
    { id: id('b'), atMs: 5_000 },
    { id: id('c'), atMs: 9_000 },
  ],
};

describe('choosing which marks go into the saved video', () => {
  test('starts with every mark chosen', () => {
    expect(everyMark(exchange).chosen).toEqual(['a', 'b', 'c']);
  });

  test('leaves a mark out when it is unticked', () => {
    const without = toggled(everyMark(exchange), exchange, id('b'));

    expect(without.chosen).toEqual(['a', 'c']);
    expect(isChosen(without, id('b'))).toBe(false);
  });

  /**
   * Ticked back in, a mark goes back where it happened rather than to the end.
   * The saved video runs in the order of the bout, not the order of the
   * taps on a checklist.
   */
  test('puts a mark back in the order it happened when it is ticked again', () => {
    let choice = everyMark(exchange);
    choice = toggled(choice, exchange, id('a'));
    choice = toggled(choice, exchange, id('c'));
    choice = toggled(choice, exchange, id('a'));

    expect(choice.chosen).toEqual(['a', 'b']);
  });

  test('can end up with nothing chosen', () => {
    let choice = everyMark(exchange);
    for (const each of ['a', 'b', 'c']) choice = toggled(choice, exchange, id(each));

    expect(choice.chosen).toEqual([]);
  });

  /** A mark the bout does not have is a bug upstream, as everywhere else. */
  test('refuses a mark the bout does not have', () => {
    expect(() => toggled(everyMark(exchange), exchange, id('nope'))).toThrow(/nope/);
  });
});

/**
 * Behind the checklist, one mark's moment plays on a loop so the referee can
 * see what they are choosing. Which one is whichever they last touched —
 * ticked or unticked, since unticking is also a decision made by looking.
 */
describe('which moment plays behind the list', () => {
  test('is the first mark before anything has been touched', () => {
    expect(showing(everyMark(exchange), exchange)).toBe('a');
  });

  test('is the mark last ticked', () => {
    let choice = toggled(everyMark(exchange), exchange, id('c'));
    choice = toggled(choice, exchange, id('c'));

    expect(showing(choice, exchange)).toBe('c');
  });

  test('is the mark last unticked, too', () => {
    expect(showing(toggled(everyMark(exchange), exchange, id('b')), exchange)).toBe('b');
  });

  test('is nothing for a bout with no marks', () => {
    expect(showing(everyMark({ ...exchange, marks: [] }), { ...exchange, marks: [] })).toBeNull();
  });
});
