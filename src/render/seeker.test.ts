import { describe, expect, test } from 'vitest';

import { Seeker } from './seeker.js';

/** A player that only seeks when told, and finishes when the test says so. */
function player() {
  const asked: number[] = [];
  const seeker = new Seeker((ms) => asked.push(ms));
  return { asked, seeker };
}

/**
 * Dragging through a moment asks for a new position on every movement of the
 * thumb. A phone that seeks slowly, asked again before it has shown anything,
 * starts over every time — and shows nothing until the thumb stops. So one seek
 * at a time, and the newest position wins.
 */
describe('seeking while the thumb moves', () => {
  test('seeks straight away when the player is free', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);

    expect(asked).toEqual([1_000]);
  });

  test('asks nothing more of the player while it is still seeking', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);
    seeker.request(1_100);
    seeker.request(1_200);

    expect(asked).toEqual([1_000]);
  });

  /** Everything in between is skipped: only where the thumb is now matters. */
  test('goes straight to the newest position once the player is done', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);
    seeker.request(1_100);
    seeker.request(1_200);
    seeker.seeked();

    expect(asked).toEqual([1_000, 1_200]);
  });

  test('rests once it has reached the last position asked for', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);
    seeker.request(1_200);
    seeker.seeked();
    seeker.seeked();
    seeker.seeked();

    expect(asked).toEqual([1_000, 1_200]);
  });

  test('does not seek again to where it already is', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);
    seeker.request(1_000);
    seeker.seeked();

    expect(asked).toEqual([1_000]);
  });

  /**
   * A new recording loaded in the middle of a seek never reports that seek
   * done. Forgotten, so the next request is not left waiting for it forever.
   */
  test('starts afresh when the player is given something else to show', () => {
    const { asked, seeker } = player();

    seeker.request(1_000);
    seeker.reset();
    seeker.request(500);

    expect(asked).toEqual([1_000, 500]);
  });
});
