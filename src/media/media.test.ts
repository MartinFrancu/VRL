import { describe, expect, test } from 'vitest';

import { preferredMimeType } from './media.js';

/**
 * The only part of the codec boundary that can be tested without a browser,
 * and the only part worth it: which container is asked for first. Everything
 * else in this layer *is* the browser, and the end-to-end suite covers it.
 */
describe('which container to record in', () => {
  const supporting = (...types: string[]) => (type: string) => types.includes(type);

  /** Safari records mp4 and will not touch webm. */
  test('prefers mp4 where it is offered', () => {
    expect(preferredMimeType(supporting('video/mp4;codecs=avc1', 'video/mp4'))).toBe(
      'video/mp4;codecs=avc1'
    );
  });

  /** Chromium and Firefox are the other way round. */
  test('falls back to webm where mp4 is not offered', () => {
    expect(preferredMimeType(supporting('video/webm;codecs=vp9', 'video/webm'))).toBe(
      'video/webm;codecs=vp9'
    );
  });

  /**
   * An empty string means "you choose", which is always better than handing
   * the browser a mime type it has to refuse.
   */
  test('leaves the choice to the browser when it offers none of them', () => {
    expect(preferredMimeType(() => false)).toBe('');
  });
});
