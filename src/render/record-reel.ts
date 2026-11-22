// Layer 3's file sink — the same Cut the screen gets, recorded instead.
//
// The simplest thing that can work on a phone: draw the clip into a canvas,
// take that canvas as a stream, and record the stream while playing through
// each stretch in turn. No encoder to drive, no container to mux, no
// dependency — `media.record` already takes any MediaStream, and a canvas
// gives one.
//
// What it costs is that it runs in **real time**: saving ten seconds of
// highlights takes ten seconds, because that is how long it takes to play
// them. For a handful of marks that is fine. It also re-encodes, so a little
// quality goes.
//
// The alternative is WebCodecs and an mp4 muxer — frame-exact, faster than
// real time, and by a distance the heaviest thing in the plan. Worth reaching
// for only if this disappoints.

import type { Cut, MediaHandle, Span, TakeId } from '../contracts.js';
import { measureDurationMs, record, release } from '../media/media.js';
import { HIT_TIMING, SIDE_COLOURS, drawHits, pictureIn } from './hits.js';
import type { HitTiming } from './hits.js';
import {
  FADE_MS,
  SPOTLIGHT,
  WATERMARK_OPACITY,
  endCardAt,
  endTitleLayout,
  endLogoBox,
  endingMs,
  loopLogoAt,
  fadeAt,
  hitTally,
  numbersLayout,
  reelLengthMs,
  titleLines,
  watermarkBox,
} from './reel.js';

export interface ReelSources {
  /** Plays the footage. Left paused afterwards, on what it held before. */
  readonly video: HTMLVideoElement;
  /** Where frames are drawn. Resized to the footage; nothing else uses it. */
  readonly canvas: HTMLCanvasElement;
  /**
   * Where each recording can be loaded from, by take — for a whole bout, whose
   * moments come from several exchanges. Left out, the cut is one recording
   * and the video already holds it.
   */
  readonly urlFor?: (take: TakeId) => string | null;
  /**
   * A logo for the corner of every frame, already loaded. It stays there
   * through the dips to black, then grows into the middle over the last
   * moment and holds there alone as an end card — the video opens straight on
   * the action, and ends on black so it loops cleanly. Left out, there is
   * none, and no end card either.
   */
  readonly watermark?: HTMLImageElement;
}

export interface ReelOptions {
  /** Called as it goes, so something on screen can move. */
  readonly onProgress?: (doneMs: number, totalMs: number) => void;
  /** How often the canvas is sampled. 30 is plenty for a replay. */
  readonly fps?: number;
  readonly signal?: AbortSignal;
  /**
   * Words for the end card, big on the charcoal before the logo — in place of
   * each side's hit count. Left out or blank, there is no title.
   */
  readonly title?: string;
  /** How long before and after its moment a hit shows. */
  readonly hitTiming?: HitTiming;
  /**
   * Told of each step as it goes — a moment started, a stall nudged — for a
   * problem report to say where a save got to.
   */
  readonly onNote?: (what: string, detail?: string) => void;
  /** How long the video may sit still before it is nudged to play again. */
  readonly stallMs?: number;
  /** How long it may sit still, nudged or not, before the save gives up. */
  readonly giveUpMs?: number;
  /** How long each dip to black at a join takes. Zero for hard cuts. */
  readonly fadeMs?: number;
}

/**
 * Whether this device can save a video at all.
 *
 * Worth asking before offering the button, because this is exactly the kind of
 * thing that works on a desktop and not on a phone.
 */
export function canRecordReel(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * How long the video may sit still while a moment plays before it is nudged,
 * and before the save gives up on it. A phone can stop a video playing with no
 * error and no event — an iPhone did, with the video hidden behind the saving
 * panel — and a save that only ever waited for the video to move waited for
 * ever (issue #1).
 */
const STALL_MS = 1500;
const GIVE_UP_MS = 6000;
/** How long any one step — loading, seeking, starting to play — may take. */
const STEP_MS = 8000;

/**
 * Wait for `step` — or fail after `ms`, saying what was being waited for, or
 * the moment `signal` says stop. A stopped save must not go on waiting: when
 * what it waited for finally came, it carried on, driving the same player as
 * the save started after it.
 */
function within<T>(step: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`saving stalled ${what}`)), ms);
    stop = () => reject(new Error('saving was stopped'));
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
  return Promise.race([step, late]).finally(() => {
    clearTimeout(timer);
    if (stop) signal?.removeEventListener('abort', stop);
  });
}

/**
 * Put another recording into the player, and wait until it can be sought.
 *
 * A recorder's file says nothing of its own length until something asks to
 * seek past the end, so it is measured on the way in — the same trick the
 * review screen relies on. The measuring has to be listening before the new
 * source is set, or the moment it is waiting for has already gone by.
 */
async function loadInto(video: HTMLVideoElement, url: string): Promise<void> {
  const measured = measureDurationMs(video, { giveUpAfterMs: 3000 });
  video.src = url;
  video.load();
  await measured;
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - seconds) < 0.001) return resolve();
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = seconds;
  });
}

/** Resolves when the player has put a picture on screen, or never. */
function shownFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve());
    else video.addEventListener('timeupdate', () => resolve(), { once: true });
  });
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Make sure the player has a picture at the start before recording begins —
 * or the saved video opens on black until playback gets going. Found by
 * seeking, a picture is usually there already. An iPhone may not prepare one
 * for a video that has not played, so failing that, it is played for a moment
 * and taken back to the start. Says which, for a problem report.
 */
async function firstPictureOf(
  video: HTMLVideoElement,
  startSeconds: number,
  signal: AbortSignal | undefined,
  onNote: ((what: string, detail?: string) => void) | undefined
): Promise<void> {
  const began = performance.now();
  const took = () => `${Math.round(performance.now() - began)} ms`;
  if (video.readyState >= 2) {
    const shown = await Promise.race([shownFrame(video).then(() => true), pause(400).then(() => false)]);
    if (shown || !video.requestVideoFrameCallback) {
      onNote?.('first picture', `ready in ${took()}`);
      return;
    }
  }
  try {
    const shown = shownFrame(video).then(() => true);
    await within(video.play(), STEP_MS, 'starting the first moment', signal);
    const primed = await Promise.race([shown, pause(1500).then(() => false)]);
    video.pause();
    await within(seekTo(video, startSeconds), STEP_MS, 'finding the first moment', signal);
    onNote?.('first picture', primed ? `ready after playing, in ${took()}` : `not ready after ${took()}`);
  } catch (error) {
    if (signal?.aborted) throw error;
    onNote?.('first picture', `not ready: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Record the stretches in `cut` as one video.
 *
 * Returns footage like any other — a `MediaHandle` — so what the caller does
 * with it is the caller's business: share it, download it, keep it.
 */
export async function recordReel(
  cut: Cut,
  { video, canvas, urlFor, watermark }: ReelSources,
  {
    onProgress,
    fps = 30,
    signal,
    fadeMs = FADE_MS,
    title,
    hitTiming = HIT_TIMING,
    onNote,
    stallMs = STALL_MS,
    giveUpMs = GIVE_UP_MS,
  }: ReelOptions = {}
): Promise<MediaHandle> {
  if (cut.spans.length === 0) throw new Error('nothing was marked, so there is nothing to save');
  if (!canRecordReel()) throw new Error('this device cannot record video from a canvas');

  // The ending: each side's hit count on a card of its own, when anything was
  // annotated, then the logo on the same ground, when there is a logo.
  const hasLogo = Boolean(watermark?.naturalWidth);
  const tally = hitTally(cut);
  const hasNumbers = tally.red + tally.blue > 0;
  const words = title?.trim() ?? '';
  // The words card: the title if one was typed, or else the hit count.
  const hasCard = words !== '' || hasNumbers;
  const endMs = endingMs(hasLogo, hasCard);
  const totalMs = reelLengthMs(cut, endMs);
  const first = cut.spans[0];
  const last = cut.spans[cut.spans.length - 1];

  // Sized for now from whatever the player holds; sized again, properly, from
  // the first moment's own recording once that is loaded — see below.
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const paper = canvas.getContext('2d');
  if (!paper) throw new Error('no canvas to draw on');

  // Paint continuously for the whole export rather than per stretch, so the
  // stream never goes quiet between them — a gap would land in the file.
  //
  // Each frame goes down over black at the brightness `fadeAt` says, which is
  // what makes the dip at every join. Between stretches, while the next one is
  // being sought, there is no stretch at all and the frame is plain black —
  // otherwise the seek would show up as a flash of wherever the clip landed.
  let painting = true;
  let playing: Span | null = null;
  /** When the ending began, once the last moment has played; null before. */
  let endingSince: number | null = null;
  // The video's first picture, kept without the corner logo: the way back at
  // the very end comes up on it, so the last frame is the first.
  const firstFrame = document.createElement('canvas');
  firstFrame.width = canvas.width;
  firstFrame.height = canvas.height;
  let keptFirst: (() => void) | null = null;
  const firstKept = new Promise<void>((resolve) => (keptFirst = resolve));
  const paint = () => {
    if (!painting) return;
    paper.globalAlpha = 1;
    const nowMs = video.currentTime * 1000;
    // The last moment fades out into the ending's ground rather than black,
    // so footage gives way to the cards without a dip in between.
    const leaving =
      endMs > 0 && playing !== null && playing === last && nowMs >= (playing.fromMs + playing.toMs) / 2;
    if (endingSince !== null || leaving) drawSpotlight(paper);
    else {
      paper.fillStyle = '#000';
      paper.fillRect(0, 0, canvas.width, canvas.height);
    }
    let strength = 1;
    if (playing) {
      // The very first moment does not fade up: the video opens on its first
      // picture, which is also where it ends.
      const opening = playing === first && nowMs < (playing.fromMs + playing.toMs) / 2;
      strength = opening ? 1 : fadeAt(nowMs, playing, fadeMs);
      // Fitted, not stretched: a moment filmed the other way up from the
      // first gets bars at its sides rather than being squashed into shape.
      const frame = { left: 0, top: 0, width: canvas.width, height: canvas.height };
      const picture = pictureIn(frame, { width: video.videoWidth, height: video.videoHeight }) ?? frame;
      paper.globalAlpha = strength;
      paper.drawImage(video, picture.left, picture.top, picture.width, picture.height);
      paper.globalAlpha = 1;
      // The hits in this stretch, by the same drawHits the review screen uses,
      // over the picture — and as faded as the stretch is, so a hit near a
      // join dips to black with everything else.
      if (playing.hits?.length) {
        drawHits(paper, playing.hits, nowMs, picture, strength, hitTiming);
      }
    }
    if (keptFirst && playing === first && video.readyState >= 2) {
      firstFrame.getContext('2d')?.drawImage(canvas, 0, 0);
      keptFirst();
      keptFirst = null;
    }
    if (watermark?.naturalWidth) {
      const aspect = watermark.naturalWidth / watermark.naturalHeight;
      if (endingSince === null) {
        // In its corner through the whole of the footage, through the dips at
        // the joins too — and out with the footage at the very end.
        const corner = watermarkBox(canvas.width, canvas.height, aspect);
        paper.globalAlpha = WATERMARK_OPACITY * (leaving ? strength : 1);
        paper.drawImage(watermark, corner.left, corner.top, corner.width, corner.height);
        paper.globalAlpha = 1;
      }
    }
    if (endingSince !== null) {
      const cards = endCardAt(performance.now() - endingSince, hasCard);
      if (cards.card > 0) {
        if (words) drawEndTitle(paper, words, cards.card);
        else if (hasNumbers) drawNumbers(paper, tally, cards.card);
      }
      if (watermark && hasLogo && cards.logo > 0) {
        const aspect = watermark.naturalWidth / watermark.naturalHeight;
        if (cards.back > 0) {
          // The way back: the first picture comes up as the logo shrinks into
          // its corner, arriving exactly as the first frame has it.
          paper.globalAlpha = cards.back;
          paper.drawImage(firstFrame, 0, 0);
          const logo = loopLogoAt(cards.back, canvas.width, canvas.height, aspect);
          paper.globalAlpha = logo.opacity;
          paper.drawImage(watermark, logo.left, logo.top, logo.width, logo.height);
        } else {
          const box = endLogoBox(canvas.width, canvas.height, aspect);
          paper.globalAlpha = cards.logo;
          paper.drawImage(watermark, box.left, box.top, box.width, box.height);
        }
        paper.globalAlpha = 1;
      }
    }
    requestAnimationFrame(paint);
  };

  const wasMuted = video.muted;
  const wasAt = video.currentTime;
  const wasSource = video.getAttribute('src');
  video.muted = true;
  /** Which recording the player holds; unknown until the first is loaded. */
  let loaded: TakeId | null = null;

  paint();
  /** Taken from the canvas only once the first picture is on it — see below. */
  let stream: MediaStream | null = null;
  let recording: ReturnType<typeof record> | null = null;
  let handedOver = false;

  /** Load the recording a stretch is from, if it is not loaded, and find its start. */
  const findStart = async (span: Span) => {
    const take = span.takes[0];
    if (urlFor && take && take !== loaded) {
      // Moving to another exchange's recording. The frame stays black while
      // it loads, the same as during any seek, so the switch is just a
      // slightly longer dip.
      const url = urlFor(take);
      if (!url) throw new Error(`no footage for recording ${take}`);
      await within(loadInto(video, url), STEP_MS, 'loading a recording', signal);
      loaded = take;
    }
    await within(seekTo(video, span.fromMs / 1000), STEP_MS, 'finding a moment', signal);
  };

  try {
    // Stand on the first picture before recording starts, so the video opens
    // on it rather than on black, and keep a copy of it for the end.
    if (first) {
      await findStart(first);
      // The video takes the first moment's shape — upright if it was filmed
      // upright. Not the shape of whatever the player held before saving,
      // which after reviewing is nothing at all, and a landscape default.
      canvas.width = video.videoWidth || canvas.width;
      canvas.height = video.videoHeight || canvas.height;
      firstFrame.width = canvas.width;
      firstFrame.height = canvas.height;
      await firstPictureOf(video, first.fromMs / 1000, signal, onNote);
      playing = first;
      await Promise.race([firstKept, new Promise((resolve) => setTimeout(resolve, 2_000))]);
    }
    // The stream only now: one taken earlier holds the canvas as it was when
    // taken — empty — and that would be the file's first frame.
    stream = canvas.captureStream(fps);
    recording = record(stream, { bitsPerSecond: 6_000_000 });

    let doneMs = 0;
    for (const span of cut.spans) {
      if (signal?.aborted) throw new Error('saving was stopped');

      if (span !== first) {
        playing = null;
        await findStart(span);
      }
      playing = span;
      onNote?.('moment', `${cut.spans.indexOf(span) + 1} of ${cut.spans.length}`);
      await within(video.play(), STEP_MS, 'starting a moment', signal);

      // Played through to its end — watching that it keeps moving. Still for
      // `stallMs`, it is nudged to play again, and again; still for
      // `giveUpMs`, the save stops and says so, rather than wait for ever.
      const until = span.toMs / 1000;
      let lastAt = video.currentTime;
      let movedAt = performance.now();
      let nudgedAt = movedAt;
      while (video.currentTime < until && !video.ended) {
        if (signal?.aborted) break;
        const now = performance.now();
        if (video.currentTime !== lastAt) {
          lastAt = video.currentTime;
          movedAt = now;
          nudgedAt = now;
        } else if (now - movedAt > giveUpMs) {
          onNote?.('gave up', `stuck at ${lastAt.toFixed(2)}s`);
          throw new Error(
            `saving stalled: the video stopped playing at ${lastAt.toFixed(1)}s and would not start again`
          );
        } else if (now - nudgedAt > stallMs) {
          nudgedAt = now;
          onNote?.('stalled, nudged', `at ${lastAt.toFixed(2)}s, ${video.paused ? 'paused' : 'playing'}`);
          video.play().catch(() => {});
        }
        onProgress?.(doneMs + Math.max(0, video.currentTime * 1000 - span.fromMs), totalMs);
        await nextFrame();
      }

      video.pause();
      playing = null;
      doneMs += Math.max(0, span.toMs - span.fromMs);
      onProgress?.(doneMs, totalMs);

      if (signal?.aborted) throw new Error('saving was stopped');
    }

    // The ending: the words card, then the logo card and the way back.
    if (endMs) {
      endingSince = performance.now();
      await new Promise((resolve) => setTimeout(resolve, endMs));
      doneMs += endMs;
      onProgress?.(doneMs, totalMs);
    }

    handedOver = true;
    return await recording.stop();
  } finally {
    // A recorder left running holds the stream and keeps filling memory with
    // footage nobody asked for, and the half-written file behind it is a blob
    // URL that would never be given back.
    if (!handedOver && recording) {
      await recording
        .stop()
        .then(release)
        .catch(() => {});
    }
    painting = false;
    for (const track of stream?.getTracks() ?? []) track.stop();
    video.pause();
    video.muted = wasMuted;
    // Put the player back as it was — the recording it held, and where its
    // playhead was — so saving does not move the picture out from under anyone.
    if (urlFor && video.getAttribute('src') !== wasSource) {
      if (wasSource) await loadInto(video, wasSource).catch(() => {});
      else {
        video.removeAttribute('src');
        video.load();
      }
    }
    if (wasSource) await seekTo(video, wasAt).catch(() => {});
  }
}

/**
 * The ending's ground: charcoal, lit softly in the middle. Neutral, so it
 * neither flashes in a dark-mode feed nor sinks in a light one.
 */
function drawSpotlight(paper: CanvasRenderingContext2D): void {
  const { width, height } = paper.canvas;
  const light = paper.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.02,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.6
  );
  light.addColorStop(0, SPOTLIGHT.centre);
  light.addColorStop(1, SPOTLIGHT.edge);
  paper.fillStyle = light;
  paper.fillRect(0, 0, width, height);
}

/**
 * The title on the end card, white, on one line or two, made smaller only if
 * even two lines would not fit across the picture.
 */
function drawEndTitle(paper: CanvasRenderingContext2D, words: string, strength: number): void {
  const { width, height } = paper.canvas;
  const { x, y, fontPx, maxWidth } = endTitleLayout(width, height);
  const font = (px: number) => `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  paper.font = font(fontPx);
  const lines = titleLines(words, (text) => paper.measureText(text).width, maxWidth);
  const widest = Math.max(...lines.map((line) => paper.measureText(line).width));
  const px = widest > maxWidth ? (fontPx * maxWidth) / widest : fontPx;
  paper.font = font(px);
  paper.textAlign = 'center';
  paper.textBaseline = 'middle';
  paper.fillStyle = '#fff';
  paper.globalAlpha = Math.min(1, Math.max(0, strength));
  const lineHeight = px * 1.15;
  lines.forEach((line, at) => paper.fillText(line, x, y + (at - (lines.length - 1) / 2) * lineHeight));
  paper.globalAlpha = 1;
}

/** Each side's hits as a big number in its own colour — red, a dot, blue. */
function drawNumbers(paper: CanvasRenderingContext2D, tally: { red: number; blue: number }, strength: number): void {
  const { width, height } = paper.canvas;
  const { x, y, fontPx } = numbersLayout(width, height);
  const parts = [
    { text: String(tally.red), colour: SIDE_COLOURS.red },
    { text: '  ·  ', colour: '#8a9298' },
    { text: String(tally.blue), colour: SIDE_COLOURS.blue },
  ];
  paper.font = `900 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  paper.textAlign = 'left';
  paper.textBaseline = 'middle';
  const total = parts.reduce((sum, part) => sum + paper.measureText(part.text).width, 0);
  let at = x - total / 2;
  paper.globalAlpha = Math.min(1, Math.max(0, strength));
  for (const part of parts) {
    paper.fillStyle = part.colour;
    paper.fillText(part.text, at, y);
    at += paper.measureText(part.text).width;
  }
  paper.globalAlpha = 1;
}
