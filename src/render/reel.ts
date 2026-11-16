// Layer 3, the pure half of saving a bout's marked moments as one video.
//
// A reel is a Cut sent to a file instead of to the screen. Everything about
// *which* stretches and *in what order* is already answered by `cut()` in the
// Bout layer; what is left here is arithmetic and a name.
//
// The recording itself — a canvas, a stream, an encoder — is the browser's
// half and lives in `record-reel.ts`.

import type { Cut, Span } from '../contracts.js';

/**
 * How long the saved video will run.
 *
 * The stretches added up, not the bout's length, and the difference is the
 * entire point: three minutes of fight becomes a few seconds worth watching.
 *
 * Also how long the saving will take, because it is recorded by playing it.
 *
 * Overlapping stretches are counted twice, because nothing merges them yet —
 * two marks a second apart really do put that second in the file twice. That
 * is the next chunk; this one is about getting a file out at all.
 */
export function reelLengthMs(cut: Cut, endMs = 0): number {
  if (cut.spans.length === 0) return 0;
  return endMs + cut.spans.reduce((total, span) => total + Math.max(0, span.toMs - span.fromMs), 0);
}

/** What a browser will call the container this device recorded. */
function extensionFor(mimeType: string): string {
  return mimeType.includes('webm') ? 'webm' : 'mp4';
}

/**
 * What the saved video is called.
 *
 * The date the bout started leads, so a phone with an afternoon of these on it
 * sorts them into the order the bouts happened in. Then how many moments are
 * in it, which is the only other thing worth knowing from a list.
 *
 * Kept to letters, digits, spaces, hyphens and dots. It goes to a share sheet
 * and from there to who knows what — a filesystem, a chat app, a cloud drive —
 * and none of them should have to flinch at it.
 */
export function reelFilename(startedAt: string, moments: number, mimeType = 'video/mp4'): string {
  const day = startedAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated';

  return `${when} SBA ${moments} mark${moments === 1 ? '' : 's'}.${extensionFor(mimeType)}`;
}

/** How big the logo in the corner is, as a share of the picture's shorter side. */
export const WATERMARK_SIZE = 0.12;
/** How far in from the corner it sits, on the same scale. */
export const WATERMARK_MARGIN = 0.03;
/** Slightly see-through, so it never hides what is behind it outright. */
export const WATERMARK_OPACITY = 0.85;

/**
 * Where the logo goes in a saved video of this size: the top-left corner, clear
 * of the caption, account name and buttons that cover the bottom of a Short
 * or a Reel (and of the camera and search icons at their top-right). Sized by
 * the shorter side so portrait and landscape get the same logo. `aspect` is
 * the logo's own width over its height.
 */
export function watermarkBox(
  width: number,
  height: number,
  aspect = 1
): { left: number; top: number; width: number; height: number } {
  const shorter = Math.min(width, height);
  const size = shorter * WATERMARK_SIZE;
  const margin = shorter * WATERMARK_MARGIN;
  return { left: margin, top: margin, width: size * aspect, height: size };
}

/** How long the full logo holds alone in the middle after the last moment. */
export const END_HOLD_MS = 1000;
/** How long it takes to grow there from its corner, over the last moment. */
export const END_GLIDE_MS = 500;
/** How big it ends, as a share of the picture's shorter side. */
export const END_SIZE = 0.6;

/**
 * Where the logo is, and how solid, this far from its corner towards the end
 * card: 0 is the corner `watermarkBox` gives, at its see-through strength; 1 is
 * the middle, large and solid. Eased, so it arrives rather than stops.
 */
export function logoAt(
  towardsEnd: number,
  width: number,
  height: number,
  aspect = 1
): { left: number; top: number; width: number; height: number; opacity: number } {
  const corner = watermarkBox(width, height, aspect);
  const through = Math.min(1, Math.max(0, towardsEnd));
  if (through === 0) return { ...corner, opacity: WATERMARK_OPACITY };

  const size = Math.min(width, height) * END_SIZE;
  const middle = {
    left: (width - size * aspect) / 2,
    top: (height - size) / 2,
    width: size * aspect,
    height: size,
  };
  if (through === 1) return { ...middle, opacity: 1 };

  const eased = 1 - (1 - through) ** 3;
  const between = (from: number, to: number) => from + (to - from) * eased;
  return {
    left: between(corner.left, middle.left),
    top: between(corner.top, middle.top),
    width: between(corner.width, middle.width),
    height: between(corner.height, middle.height),
    opacity: between(WATERMARK_OPACITY, 1),
  };
}

/**
 * How far the logo has gone towards the end card at this moment of the last
 * stretch: nothing until its final `END_GLIDE_MS`, then evenly all the way.
 */
export function endGlideAt(nowMs: number, last: Span): number {
  return Math.min(1, Math.max(0, (nowMs - (last.toMs - END_GLIDE_MS)) / END_GLIDE_MS));
}

/** How long the title stays over the start of the saved video. */
export const TITLE_MS = 2000;
/** How long it takes to fade out, at the end of that. */
export const TITLE_FADE_MS = 300;

/**
 * How solid the title is this long after the saved video starts: fully from
 * the first frame — it is the hook — then fading out over the end of its time.
 */
export function titleStrengthAt(sinceStartMs: number): number {
  if (sinceStartMs >= TITLE_MS) return 0;
  return Math.min(1, (TITLE_MS - sinceStartMs) / TITLE_FADE_MS);
}

/**
 * Where the title goes: centred, just below the logo — so in the top third on
 * either shape — at a size taken from the shorter side, as the logo's is.
 * `maxWidth` is how wide it may get before it has to be drawn smaller.
 */
export function titleLayout(
  width: number,
  height: number
): { x: number; y: number; fontPx: number; maxWidth: number } {
  const shorter = Math.min(width, height);
  return { x: width / 2, y: shorter * 0.24, fontPx: shorter * 0.08, maxWidth: width * 0.9 };
}

/** How long each fade takes. Quick: a dip, not a scene change. */
export const FADE_MS = 200;

/**
 * How bright a frame should be drawn, from 0 (black) to 1 (as filmed).
 *
 * Every stretch fades in from black and out to black inside its own time, so
 * the joins dip to black and the video gets no longer for it. A true
 * crossfade would need two moments on screen at once — two decoders, two
 * seeks in flight — which is a different order of work for a small gain.
 *
 * A stretch shorter than two fades still fades both ways and just never gets
 * all the way up. Cutting the fades short instead would leave a hard cut
 * wearing a fade's name.
 */
export function fadeAt(positionMs: number, span: Span, fadeMs = FADE_MS): number {
  if (positionMs <= span.fromMs || positionMs >= span.toMs) return fadeMs > 0 ? 0 : 1;
  if (fadeMs <= 0) return 1;

  const sinceStart = positionMs - span.fromMs;
  const untilEnd = span.toMs - positionMs;
  return Math.min(1, sinceStart / fadeMs, untilEnd / fadeMs);
}
