// Layer 1, the pure half — turning taps into instants on the bout's clock.
//
// Kept apart from the camera and the recorder because this is where the worst
// bug this app has shipped lived, and because it is arithmetic: no device, no
// DOM, so it can be tested properly.
//
// Every tap is timed twice. The lag between asking for a recording and the
// first encoded frame is real and nothing reports it, so the page's own clock
// and the camera's frame clock are both recorded and the choice is made at the
// end, when there is enough evidence to make it.

import type { Mark, MarkId } from '../contracts.js';

/** One tap, timed both ways. `frameMs` is null where the camera offers none. */
export interface Reading {
  readonly id: MarkId;
  /** Milliseconds since recording began, by the page's clock. */
  readonly wallMs: number;
  /** The same instant by the camera's own frame clock, where there is one. */
  readonly frameMs: number | null;
}

/** Which clock to prefer. The camera's is only used if it can be believed. */
export type ClockChoice = 'wall' | 'camera';

/**
 * Whether the camera's own frame clock actually ran during this recording.
 *
 * It has to be *seen* to have run, because where it is not available it does
 * not read as missing — it reads as zero, over and over. Believing it then puts
 * every mark of a bout at the same instant, which is exactly what made three
 * tabs all show the first mark on an iPhone while the app looked fine.
 *
 * Taps happen one after another, so their times must come back strictly
 * increasing and above zero. A single reading shows nothing running and is not
 * taken as evidence either way.
 */
export function cameraClockUsable(readings: readonly Reading[]): boolean {
  if (readings.length < 2) return false;

  let previous = 0;
  for (const reading of readings) {
    if (typeof reading.frameMs !== 'number' || !(reading.frameMs > previous)) return false;
    previous = reading.frameMs;
  }

  return true;
}

/**
 * The marks these taps became, on the bout's clock.
 *
 * `prefer` is a preference and not an instruction: asking for the camera's
 * clock on a device that does not run one falls back to the page's, because the
 * alternative is a bout whose every mark sits at zero.
 */
export function resolveMarks(readings: readonly Reading[], prefer: ClockChoice): Mark[] {
  const useCamera = prefer === 'camera' && cameraClockUsable(readings);

  return readings.map((reading) => ({
    id: reading.id,
    atMs: useCamera ? (reading.frameMs as number) : reading.wallMs,
  }));
}
