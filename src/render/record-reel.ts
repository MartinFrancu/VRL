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
import { SIDE_COLOURS, drawHits } from './hits.js';
import {
  END_HOLD_MS,
  FADE_MS,
  endGlideAt,
  fadeAt,
  hitTally,
  logoAt,
  reelLengthMs,
  tallyLayout,
  titleLayout,
  titleStrengthAt,
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
   * Words over the start of the video, big, for its first two seconds. Left
   * out or blank, there is no title.
   */
  readonly title?: string;
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

/**
 * Record the stretches in `cut` as one video.
 *
 * Returns footage like any other — a `MediaHandle` — so what the caller does
 * with it is the caller's business: share it, download it, keep it.
 */
export async function recordReel(
  cut: Cut,
  { video, canvas, urlFor, watermark }: ReelSources,
  { onProgress, fps = 30, signal, fadeMs = FADE_MS, title }: ReelOptions = {}
): Promise<MediaHandle> {
  if (cut.spans.length === 0) throw new Error('nothing was marked, so there is nothing to save');
  if (!canRecordReel()) throw new Error('this device cannot record video from a canvas');

  // The end card only when there is a logo to end on: a second of plain black
  // would be a second of nothing.
  const endMs = watermark?.naturalWidth ? END_HOLD_MS : 0;
  const totalMs = reelLengthMs(cut, endMs);
  const last = cut.spans[cut.spans.length - 1];
  // Each side's hits, under the end card's logo — only with an end card, and
  // only when something was annotated.
  const tally = hitTally(cut);
  const showTally = endMs > 0 && tally.red + tally.blue > 0;

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
  /** How far the logo has gone from its corner towards the end card. */
  let towardsEnd = 0;
  /** When the recording began, which is what the title is timed by. */
  let startedAt = performance.now();
  const words = title?.trim() ?? '';
  const paint = () => {
    if (!painting) return;
    paper.globalAlpha = 1;
    paper.fillStyle = '#000';
    paper.fillRect(0, 0, canvas.width, canvas.height);
    if (playing) {
      const nowMs = video.currentTime * 1000;
      const strength = fadeAt(nowMs, playing, fadeMs);
      if (endMs && playing === last) towardsEnd = endGlideAt(nowMs, playing);
      paper.globalAlpha = strength;
      paper.drawImage(video, 0, 0, canvas.width, canvas.height);
      paper.globalAlpha = 1;
      // The hits in this stretch, by the same drawHits the review screen uses,
      // over the whole frame — and as faded as the stretch is, so a hit near a
      // join dips to black with everything else.
      if (playing.hits?.length) {
        drawHits(paper, playing.hits, nowMs, { left: 0, top: 0, width: canvas.width, height: canvas.height }, strength);
      }
    }
    if (watermark?.naturalWidth) {
      const logo = logoAt(
        towardsEnd,
        canvas.width,
        canvas.height,
        watermark.naturalWidth / watermark.naturalHeight
      );
      paper.globalAlpha = logo.opacity;
      paper.drawImage(watermark, logo.left, logo.top, logo.width, logo.height);
      paper.globalAlpha = 1;
    }
    if (words) drawTitle(paper, words, titleStrengthAt(performance.now() - startedAt));
    if (showTally && towardsEnd > 0) drawTally(paper, tally, towardsEnd);
    requestAnimationFrame(paint);
  };

  const wasMuted = video.muted;
  const wasAt = video.currentTime;
  const wasSource = video.getAttribute('src');
  video.muted = true;
  /** Which recording the player holds; unknown until the first is loaded. */
  let loaded: TakeId | null = null;

  const stream = canvas.captureStream(fps);
  paint();
  const recording = record(stream, { bitsPerSecond: 6_000_000 });
  startedAt = performance.now();
  let handedOver = false;

  try {
    let doneMs = 0;
    for (const span of cut.spans) {
      if (signal?.aborted) throw new Error('saving was stopped');

      playing = null;
      const take = span.takes[0];
      if (urlFor && take && take !== loaded) {
        // Moving to another exchange's recording. The frame stays black while
        // it loads, the same as during any seek, so the switch is just a
        // slightly longer dip.
        const url = urlFor(take);
        if (!url) throw new Error(`no footage for recording ${take}`);
        await loadInto(video, url);
        loaded = take;
      }
      await seekTo(video, span.fromMs / 1000);
      playing = span;
      await video.play();

      const until = span.toMs / 1000;
      while (video.currentTime < until && !video.ended) {
        if (signal?.aborted) break;
        onProgress?.(doneMs + Math.max(0, video.currentTime * 1000 - span.fromMs), totalMs);
        await nextFrame();
      }

      video.pause();
      playing = null;
      doneMs += Math.max(0, span.toMs - span.fromMs);
      onProgress?.(doneMs, totalMs);

      if (signal?.aborted) throw new Error('saving was stopped');
    }

    // The end card: the logo alone in the middle of a black frame.
    if (endMs) {
      towardsEnd = 1;
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
    if (!handedOver) {
      await recording
        .stop()
        .then(release)
        .catch(() => {});
    }
    painting = false;
    for (const track of stream.getTracks()) track.stop();
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
 * The title, white with a dark edge so it reads over any footage, made smaller
 * if it would not otherwise fit across the picture.
 */
function drawTitle(paper: CanvasRenderingContext2D, words: string, strength: number): void {
  if (strength <= 0) return;
  const { width, height } = paper.canvas;
  const { x, y, fontPx, maxWidth } = titleLayout(width, height);
  const font = (px: number) => `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  paper.font = font(fontPx);
  const natural = paper.measureText(words).width;
  const px = natural > maxWidth ? (fontPx * maxWidth) / natural : fontPx;
  paper.font = font(px);
  paper.textAlign = 'center';
  paper.textBaseline = 'middle';
  paper.lineJoin = 'round';
  paper.globalAlpha = strength;
  paper.lineWidth = px * 0.14;
  paper.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  paper.strokeText(words, x, y);
  paper.fillStyle = '#fff';
  paper.fillText(words, x, y);
  paper.globalAlpha = 1;
}

/**
 * Each side's hits as a number in its own colour — red, a dot, blue — centred
 * under the end card's logo, coming up as the logo arrives.
 */
function drawTally(paper: CanvasRenderingContext2D, tally: { red: number; blue: number }, strength: number): void {
  const { width, height } = paper.canvas;
  const { x, y, fontPx } = tallyLayout(width, height);
  const parts = [
    { text: String(tally.red), colour: SIDE_COLOURS.red },
    { text: '  ·  ', colour: '#fff' },
    { text: String(tally.blue), colour: SIDE_COLOURS.blue },
  ];
  paper.font = `800 ${fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
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
