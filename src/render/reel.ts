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

/** How long the logo card holds at the very end. */
export const END_HOLD_MS = 700;
/**
 * How long the card of words shows before the logo: the title typed on the
 * Save screen, or else each side's hit count.
 */
export const CARD_MS = 800;
/**
 * How long the way back to the start takes, at the very end: the first
 * picture comes up as the logo shrinks into its corner, so the last frame is
 * the first and a Short or a Reel loops without a cut.
 */
export const LOOP_MS = 400;
/** How quickly the words give way to the logo. */
export const CROSS_MS = 150;
/** How big the logo is on its card, as a share of the picture's shorter side. */
export const END_SIZE = 0.6;
/**
 * The ground both end cards stand on: charcoal, lit softly in the middle — a
 * neutral grey that neither flashes in a dark-mode feed nor sinks in a light
 * one, and that lifts the logo's black disc without a ring around it.
 */
export const SPOTLIGHT = { centre: '#4a5057', edge: '#1c1f22' } as const;

/**
 * How long the ending adds, after the last moment: the words card, then the
 * logo card and the way back to the start — which is the logo's to make.
 */
export function endingMs(hasLogo: boolean, hasCard: boolean): number {
  return (hasCard ? CARD_MS : 0) + (hasLogo ? END_HOLD_MS + LOOP_MS : 0);
}

/**
 * How far along the ending is this long after the last moment has gone: the
 * words first, if there are any, then a quick cross to the logo, then — after
 * the logo's time — the way `back` to the start, from 0 to 1.
 */
export function endCardAt(
  sinceFootageMs: number,
  hasCard: boolean
): { card: number; logo: number; back: number } {
  const logoFrom = hasCard ? CARD_MS : 0;
  const back = Math.min(1, Math.max(0, (sinceFootageMs - logoFrom - END_HOLD_MS) / LOOP_MS));
  if (!hasCard) return { card: 0, logo: 1, back };
  const crossed = Math.min(1, Math.max(0, (sinceFootageMs - CARD_MS) / CROSS_MS));
  return { card: 1 - crossed, logo: crossed, back };
}

/** Where the logo goes on its card: large, in the middle. */
export function endLogoBox(
  width: number,
  height: number,
  aspect = 1
): { left: number; top: number; width: number; height: number } {
  const size = Math.min(width, height) * END_SIZE;
  return { left: (width - size * aspect) / 2, top: (height - size) / 2, width: size * aspect, height: size };
}


/** Where the title goes on the end card: big, in the middle. */
export function endTitleLayout(
  width: number,
  height: number
): { x: number; y: number; fontPx: number; maxWidth: number } {
  const shorter = Math.min(width, height);
  return { x: width / 2, y: height / 2, fontPx: shorter * 0.12, maxWidth: width * 0.9 };
}

/**
 * The title as one line, or two when one would be too wide — split between
 * words where the longer of the two comes out shortest. A title that is still
 * too wide is the drawing's to shrink; a single word is never broken.
 */
export function titleLines(words: string, measure: (text: string) => number, maxWidth: number): string[] {
  const text = words.trim().replace(/\s+/g, ' ');
  if (measure(text) <= maxWidth) return [text];
  const parts = text.split(' ');
  if (parts.length < 2) return [text];
  let best: string[] = [text];
  let bestWidest = Infinity;
  for (let at = 1; at < parts.length; at++) {
    const lines = [parts.slice(0, at).join(' '), parts.slice(at).join(' ')];
    const widest = Math.max(...lines.map(measure));
    if (widest < bestWidest) {
      best = lines;
      bestWidest = widest;
    }
  }
  return best;
}

/**
 * How many hits each side landed in this saved video, for its end card.
 *
 * A hit inside two overlapping moments is in both of their stretches, and is
 * still one hit: told apart by its recording, moment and spot.
 */
export function hitTally(cut: Cut): { red: number; blue: number } {
  const seen = new Set<string>();
  const tally = { red: 0, blue: 0 };
  for (const span of cut.spans) {
    for (const hit of span.hits ?? []) {
      const key = `${span.takes[0] ?? ''}|${hit.atMs}|${hit.x}|${hit.y}|${hit.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tally[hit.side] += 1;
    }
  }
  return tally;
}

/**
 * Where the logo is, and how solid, on the way back: from large in the middle
 * (0) to its corner at its usual strength (1), eased so it settles there.
 */
export function loopLogoAt(
  back: number,
  width: number,
  height: number,
  aspect = 1
): { left: number; top: number; width: number; height: number; opacity: number } {
  const from = endLogoBox(width, height, aspect);
  const to = watermarkBox(width, height, aspect);
  const through = Math.min(1, Math.max(0, back));
  if (through === 0) return { ...from, opacity: 1 };
  if (through === 1) return { ...to, opacity: WATERMARK_OPACITY };
  const eased = 1 - (1 - through) ** 3;
  const between = (a: number, b: number) => a + (b - a) * eased;
  return {
    left: between(from.left, to.left),
    top: between(from.top, to.top),
    width: between(from.width, to.width),
    height: between(from.height, to.height),
    opacity: between(1, WATERMARK_OPACITY),
  };
}

/** Where the hit count goes on its card: big, in the middle. */
export function numbersLayout(width: number, height: number): { x: number; y: number; fontPx: number } {
  return { x: width / 2, y: height / 2, fontPx: Math.min(width, height) * 0.22 };
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
