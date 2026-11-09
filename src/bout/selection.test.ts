import { describe, expect, test } from 'vitest';

import type { Bout, BoutId, MarkId, TakeId } from '../contracts.js';
import { everyMark, isChosen, showing, toggled } from './selection.js';

const id = (value: string) => value as MarkId;

const bout: Bout = {
  id: 'b1' as BoutId,
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
    expect(everyMark(bout).chosen).toEqual(['a', 'b', 'c']);
  });

  test('leaves a mark out when it is unticked', () => {
    const without = toggled(everyMark(bout), bout, id('b'));

    expect(without.chosen).toEqual(['a', 'c']);
    expect(isChosen(without, id('b'))).toBe(false);
  });

  /**
   * Ticked back in, a mark goes back where it happened rather than to the end.
   * The saved video runs in the order of the bout, not the order of the
   * taps on a checklist.
   */
  test('puts a mark back in the order it happened when it is ticked again', () => {
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
 * Behind the checklist, one mark's moment plays on a loop so the referee can
 * see what they are choosing. Which one is whichever they last touched —
 * ticked or unticked, since unticking is also a decision made by looking.
 */
describe('which moment plays behind the list', () => {
  test('is the first mark before anything has been touched', () => {
    expect(showing(everyMark(bout), bout)).toBe('a');
  });

  test('is the mark last ticked', () => {
    let choice = toggled(everyMark(bout), bout, id('c'));
    choice = toggled(choice, bout, id('c'));

    expect(showing(choice, bout)).toBe('c');
  });

  test('is the mark last unticked, too', () => {
    expect(showing(toggled(everyMark(bout), bout, id('b')), bout)).toBe('b');
  });

  test('is nothing for a bout with no marks', () => {
    expect(showing(everyMark({ ...bout, marks: [] }), { ...bout, marks: [] })).toBeNull();
  });
});
