import { describe, expect, test } from 'vitest';

import { heldDifferently } from './held.js';

/**
 * Whether the phone is now held the other way from when filming started —
 * portrait one way, landscape the other. The recording carries on in the shape
 * it began, so what is being filmed now is coming out sideways.
 */
describe('whether the phone is held differently from when filming started', () => {
  test('is not, held the same way', () => {
    expect(heldDifferently('portrait-primary', 'portrait-primary')).toBe(false);
    expect(heldDifferently('landscape-primary', 'landscape-primary')).toBe(false);
  });

  test('is, turned from portrait to landscape or back', () => {
    expect(heldDifferently('portrait-primary', 'landscape-primary')).toBe(true);
    expect(heldDifferently('landscape-secondary', 'portrait-primary')).toBe(true);
  });

  /** Upside down is still the same shape of picture. Only sideways matters. */
  test('is not, merely turned upside down', () => {
    expect(heldDifferently('landscape-primary', 'landscape-secondary')).toBe(false);
    expect(heldDifferently('portrait-primary', 'portrait-secondary')).toBe(false);
  });

  /** Where the browser has no screen.orientation, the page's shape stands in. */
  test('reads the plain words a browser without screen orientation gives', () => {
    expect(heldDifferently('portrait', 'landscape')).toBe(true);
    expect(heldDifferently('landscape', 'landscape-primary')).toBe(false);
  });

  /** Before anything was filmed there is nothing to compare with. */
  test('is not, when how it was held at the start is not known', () => {
    expect(heldDifferently('?', 'landscape-primary')).toBe(false);
  });
});
