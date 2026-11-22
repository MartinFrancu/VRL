// Layer 4 — the shell. Elements, gestures, and which screen is showing.
//
// Three modes and nothing else. **Idle** is pointed at the fight and waiting.
// **Recording** is filming, and the whole picture is the mark button — the
// referee is watching the fight, not the screen, so the target has to be
// something that can be hit without looking. **Review** is the marks, after.
//
// Filming and reviewing never overlap, which is the whole reason this is
// simple: there is never any need to read the recent past while still writing
// to it.
//
// Everything that is not about the screen now lives under src/, compiled to
// app/ — see docs/architecture.md. What is left here is the camera (which
// outlives any one bout), the elements, and the gestures. This file is
// deliberately still plain JavaScript: it is the layer the browser tests cover
// from the outside and the one least worth rewriting blind.

import { cutBout, exchangeHolding, newBout, withExchange, withExchangeReplaced } from './app/bout/bout.js';
import { boutFromRecord, boutRecord } from './app/bout/record.js';
import { cut, durationOf, withHit, withoutLastHit } from './app/bout/exchange.js';
import { HIT_TIMING, drawHits, pictureIn, toFrame } from './app/render/hits.js';
import { isChosen, selectionOf, showing, startingChoice, toggled } from './app/bout/selection.js';
import { Capture } from './app/capture/capture.js';
import { cameraClockUsable } from './app/capture/clock.js';
import { heldDifferently } from './app/capture/held.js';
import * as media from './app/media/media.js';
import { markersCsv, rawFilename, readRaw, recordingName } from './app/store/raw.js';
import { crcOfBlob, readZip, zipStored } from './app/store/zip.js';
import {
  clampWithin,
  draggedTo,
  progressThrough,
  readoutFor,
  shortfallLabel,
  steppedBy,
  tapStep,
} from './app/render/playhead.js';
import { canRecordReel, recordReel } from './app/render/record-reel.js';
import { Seeker } from './app/render/seeker.js';
import { endingMs, hitTally, reelFilename, reelLengthMs } from './app/render/reel.js';
import { EventLog, issueUrl, reportText } from './app/report/report.js';

const VERSION = '1.1.55';

const el = (id) => document.getElementById(id);

/**
 * What the app did lately, for a problem report to say what led up to it.
 * In memory only, the last two minutes, and only ever sent in a report the
 * referee chooses to send. See src/report/report.ts.
 */
const traced = new EventLog();
function trace(what, detail) {
  traced.add(performance.now(), what, detail === undefined ? undefined : String(detail));
}
// The errors nobody saw: they never reach the screen, and are the first thing
// worth knowing when something went wrong.
window.addEventListener('error', (event) => trace('error', event.message || String(event.error)));
window.addEventListener('unhandledrejection', (event) => trace('error', event.reason?.message ?? String(event.reason)));
const preview = el('preview');
const clip = el('clip');

/** The camera, open from the moment permission is granted until the tab dies. */
let stream = null;
let frameMs = 1000 / 30;
/** The preview's own frame clock, as last reported. Null without rVFC. */
let lastFrameMediaMs = null;

let ticker = null;
let wakeLock = null;
let recordingStartedAt = 0;
/**
 * Whether any bout has been filmed since the page loaded.
 *
 * Only used to decide whether losing the camera is worth a message. It
 * reproduces an oddity of the version this replaced — see `onCameraLost` — and
 * is kept rather than fixed because fixing it is a different kind of change.
 */
let hasFilmed = false;

/** The bout being reviewed, once there is one. */
let exchange = null;
let current = 0;
let positionMs = 0;
/** The slice of the bout the current mark is shown through. */
let span = null;

let leadMs = 1500;
let tailMs = 1000;

/**
 * Which clock places the marks: the page's, or the camera's own.
 *
 * The page's by default, because it is the one that is always there. The
 * camera's is the more accurate of the two where it runs, but it is not offered
 * for a live stream everywhere — and where it is not, it reads zero rather than
 * reading as absent, which put every mark of a bout at the same instant and
 * showed the first one under every tab. The guard lives in `clock.ts`; this is
 * just the preference, switchable from the diagnostics panel.
 */
let markSource = 'wall';

/** The media time of the frame currently on screen. */
let shownMs = null;

/** How the phone was held when filming began. */
let heldAtStart = '?';
/**
 * The same, for the last bout actually reviewed, against what shape the file
 * turned out to be. Nothing resets this.
 *
 * A recording that comes back sideways is one of two different faults wearing
 * the same description, and they want opposite fixes: either the file is in a
 * different orientation from the one it was filmed in, or it is the right way up
 * and the page around it is not. These numbers tell them apart, and cannot be
 * got at from anywhere but the phone it happened on.
 */
let lastReviewed = null;

function orientationNow() {
  return screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
}

// ---------------------------------------------------------------- the camera

async function openCamera() {
  // Whatever was open goes first. Two streams from one camera is a way to be
  // handed the wrong one.
  for (const track of stream?.getTracks() ?? []) track.stop();

  stream = await navigator.mediaDevices.getUserMedia({
    // The back camera, and as many frames a second as we can get: every extra
    // frame is another position the referee can stop on.
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    },
    audio: false,
  });
  preview.srcObject = stream;
  await preview.play().catch(() => {
    // iOS wants a gesture before it will play anything, even muted.
    el('live-note').textContent = 'Tap anywhere to turn the camera on.';
    document.body.addEventListener('click', () => preview.play().catch(() => {}), { once: true });
  });

  const track = stream.getVideoTracks()[0];
  frameMs = 1000 / (track.getSettings().frameRate || 30);
  track.addEventListener('ended', onCameraLost);
  watchPreviewFrames();
}

/**
 * Follow the preview's own frame clock.
 *
 * It ticks with the camera rather than with the page, so it survives the phone
 * being busy — where it is offered at all. On iOS a live stream's media time
 * sits at zero, which is what `cameraClockUsable` is there to notice.
 */
function watchPreviewFrames() {
  if (!preview.requestVideoFrameCallback) return;
  preview.requestVideoFrameCallback((_now, meta) => {
    lastFrameMediaMs = meta.mediaTime * 1000;
    watchPreviewFrames();
  });
}

/**
 * Follow the phone, but only while idle.
 *
 * The camera hands over a stream shaped the way the phone is being held at the
 * moment it is asked, and never changes its mind afterwards. So a bout started
 * upright and then filmed sideways is a portrait recording of a sideways world,
 * however it looked in the preview — which is what made a landscape bout come
 * back wrong after a portrait one.
 *
 * Asking again whenever the phone turns fixes that, as long as nothing is
 * relying on the stream staying as it is. Recording is: a recording cannot
 * change shape halfway through. So the camera is fixed from START until the
 * bout is let go of, and free the rest of the time.
 */
let reopening = false;
let reopenSoon = null;

async function followOrientation() {
  const screenNow = document.body.dataset['screen'];
  if (screenNow !== 'idle' || reopening) return;
  reopening = true;
  try {
    await openCamera();
  } catch {
    el('live-note').textContent = 'The camera did not come back. Reload the page.';
  } finally {
    reopening = false;
  }
}

/**
 * The huge warning while filming, whenever the phone is held the other way
 * from START — the recording stays the shape it began, so this is going into
 * it sideways. Only while filming: the rest of the time the camera follows the
 * phone round and there is nothing wrong.
 */
function showTurned() {
  const filming = document.body.dataset['screen'] === 'recording';
  el('turned').hidden = !(filming && heldDifferently(heldAtStart, orientationNow()));
}

/** Rotation fires a flurry of these, and the camera is expensive to reopen. */
function orientationChanged() {
  trace('turned', orientationNow());
  // The warning is cheap and wants to be immediate; only the camera waits.
  showTurned();
  clearTimeout(reopenSoon);
  reopenSoon = setTimeout(followOrientation, 400);
}

screen.orientation?.addEventListener?.('change', orientationChanged);
window.addEventListener('orientationchange', orientationChanged);
// Where there is no screen.orientation, the page's shape is all there is.
window.addEventListener('resize', showTurned);

function onCameraLost() {
  trace('camera lost');
  // Says nothing before the first bout of a session, which is the oddity noted
  // in docs/BACKLOG.md: the message is right while filming and wrong when idle
  // after a bout.
  if (!hasFilmed) return;
  el('live-note').textContent = 'The camera stopped — a call, or another app took it. Reload the page.';
  stopFilming();
  void capture.discard();
  // The exchange being filmed is gone, but the ones before it need not be:
  // the summary still has them, so they can be saved before reloading.
  if (bout && bout.exchanges.length > 0) openSummary();
  else endBout();
}

// ------------------------------------------------------------------- filming

/**
 * Filming a bout, and the clock that places its marks.
 *
 * Everything this is given is ours — the camera as a shape and a frame clock,
 * a recording, a ruler — so none of it is a stand-in for `MediaRecorder` or
 * `getUserMedia`. The seam is in front of the browser, not around it.
 */
const capture = new Capture({
  now: () => performance.now(),
  nowIso: () => new Date().toISOString(),
  newId: () => crypto.randomUUID(),
  source: 'this phone',
  camera: {
    shape: () => {
      const settings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
      return { width: settings.width ?? 0, height: settings.height ?? 0 };
    },
    frameClockMs: () => lastFrameMediaMs,
  },
  startRecording: () => media.record(stream),
  /**
   * Loading the footage is how it gets measured, so this does both.
   *
   * `clip.load()` is not optional, and is the reason the second bout of a
   * session came back sideways while the first was fine: handing a media
   * element a new source does not make it forget the old one. Everything it
   * worked out about the last clip — its shape, and which way up to draw it —
   * survives into the next unless it is told to start again.
   */
  measureDuration: async (footage) => {
    clip.src = media.urlOf(footage);
    clip.load();
    return media.measureDurationMs(clip, {
      fallbackMs: Math.max(0, performance.now() - recordingStartedAt),
    });
  },
});

/**
 * The fight under way: every exchange filmed so far, in order. Null until
 * START, and again once the bout is ended.
 *
 * A referee films until the fight is stopped, reviews, and carries on — each
 * of those is an exchange, and the bout is all of them. Every exchange's
 * footage is kept until the bout ends, because the saved video is made of the
 * whole bout.
 */
let bout = null;

function startFilming() {
  trace('START');
  leaveExchange();
  if (!bout) bout = newBout(crypto.randomUUID(), new Date().toISOString());
  shownMs = null;
  capture.start();
  recordingStartedAt = performance.now();
  heldAtStart = orientationNow();
  hasFilmed = true;

  screenIs('recording');
  showTurned();
  // A fresh exchange has nothing to review and no marks spent, whatever the
  // last one left behind.
  el('toReview').disabled = true;
  renderDots();
  renderTapHint();
  keepAwake(true);
  ticker = setInterval(tickElapsed, 250);
  tickElapsed();
}

/**
 * Note the moment and keep filming.
 *
 * Timed twice inside Capture, because the lag between asking for a recording
 * and the first frame actually being encoded is real and nothing reports it.
 */
function markAt() {
  if (!capture.recording) return;
  trace('mark', capture.markCount + 1);
  capture.mark();

  // It was marked without looking at the screen, so say so in ways that do not
  // need looking at: a flash big enough to catch in the corner of an eye, and
  // a buzz for when it does not.
  const flash = el('flash');
  flash.classList.remove('on');
  void flash.offsetWidth;
  flash.classList.add('on');
  navigator.vibrate?.(35);

  renderDots();
  renderTapHint();
  el('toReview').disabled = false;
}

/** Stop the trimmings that only run while an exchange is being filmed. */
function stopFilming() {
  clearInterval(ticker);
  keepAwake(false);
  el('turned').hidden = true;
}

/** Finish the exchange being filmed and add it to the bout. */
async function finishExchange() {
  exchange = await capture.finish(markSource);
  bout = withExchange(bout, exchange);
  return exchange;
}

// ------------------------------------------------------- moving between modes

function screenIs(name) {
  if (document.body.dataset['screen'] !== name) trace('screen', name);
  document.body.dataset['screen'] = name;
}

/** Stop filming and look at what was marked in this exchange. */
async function toReview() {
  trace('REVIEW');
  if (capture.markCount === 0) return;
  stopFilming();
  reviewingFrom = 'filming';

  await finishExchange();
  const take = exchange.takes[0];
  // Kept where nothing resets it. The question these answer is asked on the
  // idle screen, which is reached by starting another bout, which would
  // otherwise have wiped them on the way past.
  lastReviewed = {
    shape: `${take.width}×${take.height}`,
    held: heldAtStart,
    clip: `${clip.videoWidth}×${clip.videoHeight}`,
    reviewedIn: orientationNow(),
  };

  renderTabs();
  select(0);
  screenIs('review');
}

/**
 * Straight back to filming, from the review screen.
 *
 * The exchange just reviewed is kept — it is part of the bout now, and will be
 * on the summary when the bout ends. The next one starts at once, because the
 * fight is about to resume.
 */
function toRecord() {
  trace('BACK to filming');
  if (reviewingFrom === 'summary') return backToSummary();
  startFilming();
}

/**
 * Where the review screen was opened from: straight after filming, or from the
 * summary to annotate a mark. BACK and Done go back to whichever it was.
 */
let reviewingFrom = 'filming';

/**
 * The bout is over: on to the summary.
 *
 * Whatever is being filmed becomes the last exchange if anything was marked in
 * it, and is let go of if nothing was. With no exchanges at all there is
 * nothing to sum up, and it is straight back to idle.
 */
async function toSummary() {
  trace('END');
  stopFilming();
  if (capture.markCount > 0) await finishExchange();
  else await capture.discard();

  if (!bout || bout.exchanges.length === 0) return endBout();
  openSummary();
}

/** Ask before throwing a bout away — its footage cannot be got back. */
function askToEndBout() {
  trace('asked to discard');
  const exchanges = bout?.exchanges.length ?? 0;
  el('confirm-title').textContent = 'Discard this bout?';
  el('confirm-text').textContent =
    `Its ${exchanges} exchange${exchanges === 1 ? '' : 's'} will be gone without being saved, ` +
    'and cannot be got back.';
  el('confirm').hidden = false;
}

/** Let the whole bout go, and go back to idle. */
function endBout() {
  trace('bout let go of');
  el('confirm').hidden = true;
  stopFilming();
  void capture.discard();
  leaveExchange();
  emptyBehind();
  selection = null;
  for (const each of bout?.exchanges ?? []) {
    for (const take of each.takes) media.release(take.media);
  }
  bout = null;
  // A title belongs to its bout.
  el('export-title').value = '';
  el('toReview').disabled = true;
  el('elapsed').textContent = '0:00';
  el('live-note').textContent = 'Point it at the fight, then press START.';
  renderDots();
  renderTapHint();
  screenIs('idle');
}

/**
 * Stop showing the exchange on the review screen — without letting go of its
 * footage, which belongs to the bout.
 */
function leaveExchange() {
  stopPlacing();
  exchange = null;
  span = null;
  clip.removeAttribute('src');
  // Dropping the attribute does not drop the resource behind it.
  clip.load();
}

// ----------------------------------------------------------------- reviewing

/** Built once per bout. Rebuilding on every change would throw away where the
 *  strip is scrolled to, which with a dozen marks means jumping back to the
 *  first one every time you choose the twelfth. */
function renderTabs() {
  const tabs = el('tabs');
  tabs.innerHTML = '';
  (exchange?.marks ?? []).forEach((_mark, index) => {
    const button = document.createElement('button');
    button.textContent = String(index + 1);
    button.addEventListener('click', () => select(index));
    tabs.append(button);
  });
}

/** Which one is being looked at, and keeping it where it can be seen. */
function markActiveTab() {
  const tabs = [...el('tabs').children];
  tabs.forEach((button, index) => button.classList.toggle('on', index === current));
  paintAnnotated();
  // 'nearest' on both axes: enough to bring it into the strip, not enough to
  // scroll the screen underneath it.
  tabs[current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * Show a mark. Instant, because it is one recording already loaded — switching
 * marks is a seek, not a load.
 */
function select(index) {
  trace('mark chosen', index + 1);
  const chosen = exchange?.marks[index];
  if (!chosen) return;

  current = index;
  span = cut(exchange, [chosen.id], { leadMs, tailMs }).spans[0];
  el('shortfall').textContent = shortfallLabel(span) ?? '';
  markActiveTab();
  // Hits go to whichever mark is on screen, so the bar follows the switch.
  if (placing) showPlacingCount();
  // Land on the moment that was marked, not on the start of the run-up.
  seekTo(span.atMs);
}

/**
 * The player's own position, paced: one seek at a time, the newest asked for
 * winning — so a thumb faster than the phone can seek still sees the picture
 * move. The readout and the hits follow the thumb at once regardless.
 */
let seekAskedAt = 0;
const seeker = new Seeker((ms) => {
  seekAskedAt = performance.now();
  clip.currentTime = ms / 1000;
});
clip.addEventListener('seeked', () => {
  // A seek slow enough to feel is worth a line in a report; the rest are noise.
  // Only the review screen's own: once landed, when it was asked for is
  // forgotten, so the seeks saving makes on the same player are never timed
  // from a review seek minutes before.
  const took = performance.now() - seekAskedAt;
  if (seekAskedAt && took > 150) trace('slow seek', `${Math.round(took)} ms`);
  seekAskedAt = 0;
  seeker.seeked();
});
// A new recording in the player: a seek in flight will never report back.
clip.addEventListener('emptied', () => seeker.reset());

function seekTo(ms) {
  if (!span) return;
  positionMs = clampWithin(ms, span);
  seeker.request(positionMs);
  renderPosition();
  watchShownFrame();
}

/** Everything that says where in the window the footage is. */
function renderPosition() {
  el('readout').textContent = readoutFor(positionMs, span);
  const through = progressThrough(positionMs, span);
  el('progress').firstElementChild.style.width = `${Math.round(through * 100)}%`;
  renderHits();
}

/**
 * Draw the hits over the picture, at the moment on screen.
 *
 * The same `drawHits` the recorder uses, over the part of the stage the
 * picture actually occupies — so what is seen while placing a hit is what goes
 * into the saved video.
 */
function renderHits() {
  const layer = el('hit-layer');
  const stage = el('stage');
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(stage.clientWidth * ratio);
  const height = Math.round(stage.clientHeight * ratio);
  if (layer.width !== width || layer.height !== height) {
    layer.width = width;
    layer.height = height;
  }
  const paper = layer.getContext('2d');
  paper.clearRect(0, 0, width, height);
  if (!span?.hits?.length) return;

  const picture = pictureIn(
    { left: 0, top: 0, width, height },
    { width: clip.videoWidth, height: clip.videoHeight }
  );
  if (picture) drawHits(paper, span.hits, positionMs, picture, 1, hitTiming);
}

/** Which frame actually came up, for the diagnostics panel to report. */
function watchShownFrame() {
  if (!clip.requestVideoFrameCallback) return;
  clip.requestVideoFrameCallback((_now, meta) => {
    shownMs = meta.mediaTime * 1000;
    if (!el('diag').hidden) renderDiagnostics();
  });
}

/**
 * Moving through the moment by dragging across the picture.
 *
 * The whole frame is the control — a target the size of the screen rather than
 * a slider six millimetres tall, and one that can be used without looking down
 * at your own hand. The full width spans the full window, which on a phone
 * works out finer than one frame per pixel.
 *
 * Nothing plays here. A tap does nothing at all, deliberately — the only thing
 * that moves the footage is a thumb asking it to.
 */
let draggingFromMs = 0;
let draggingFromX = 0;
/** Where the thumb went down, to tell a tap from a drag when it comes up. */
let pressedAt = null;

function onDragStart(event) {
  // A button on the picture — the Drag/Step switch, the placing bar — is a
  // button, not the start of a drag.
  if (event.target.closest?.('button, #readout')) return;
  // Or the browser claims the gesture as a drag of its own — a selection, an
  // image — and abandons ours one move in, leaving the footage barely moved.
  event.preventDefault();
  draggingFromMs = positionMs;
  draggingFromX = event.clientX;
  pressedAt = { x: event.clientX, y: event.clientY };
  el('stage').setPointerCapture?.(event.pointerId);
}

/**
 * A thumb lifted. Outside placing hits this does nothing, deliberately, as a
 * tap on the review picture always has. While placing, a tap that barely
 * moved puts a hit where it landed.
 */
function onDragEnd(event) {
  const from = pressedAt;
  pressedAt = null;
  if (!from) return;
  if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) {
    trace('dragged', `to ${Math.round(positionMs)} ms`);
    return;
  }
  // A tap: a hit while placing, a frame either way in Step mode, and in Drag
  // mode nothing at all.
  if (placing) return placeHit(event.clientX, event.clientY);
  if (scrubMode === 'step' && span) {
    const box = el('stage').getBoundingClientRect();
    seekTo(steppedBy(positionMs, tapStep((event.clientX - box.left) / (box.width || 1)), frameMs, span));
  }
}

/**
 * How taps on the review picture move through a moment: 'drag' — they do not,
 * only dragging does — or 'step', a frame back for the left half and forward
 * for the right. Kept on the phone; a phone that will not keep it starts in
 * Drag each time, which is no worse than before.
 */
/**
 * How long a hit shows before and after its moment — the same on review, on
 * the summary's background and in the saved video. Set under Settings and
 * kept on the phone, as the Drag/Step choice is.
 */
const HIT_TIMING_KEY = 'vrl.hitTiming';
let hitTiming = (() => {
  try {
    const kept = JSON.parse(localStorage.getItem(HIT_TIMING_KEY) ?? 'null');
    if (Number.isFinite(kept?.leadMs) && Number.isFinite(kept?.tailMs)) return { leadMs: kept.leadMs, tailMs: kept.tailMs };
  } catch {
    // Unreadable, or not there: the defaults.
  }
  return { ...HIT_TIMING };
})();

function renderHitTiming() {
  for (const [input, value] of [
    ['hit-lead', hitTiming.leadMs],
    ['hit-tail', hitTiming.tailMs],
  ]) {
    el(input).value = String(value);
    el(`${input}-value`).textContent = `${(value / 1000).toFixed(2)}s`;
  }
}

function setHitTiming(next) {
  hitTiming = next;
  try {
    localStorage.setItem(HIT_TIMING_KEY, JSON.stringify(hitTiming));
  } catch {
    // Not kept, then — it still applies until the page is closed.
  }
  renderHitTiming();
  renderHits();
}

const SCRUB_KEY = 'vrl.scrub';
let scrubMode = (() => {
  try {
    return localStorage.getItem(SCRUB_KEY) === 'step' ? 'step' : 'drag';
  } catch {
    return 'drag';
  }
})();

function setScrubMode(mode) {
  trace('scrub', mode);
  scrubMode = mode === 'step' ? 'step' : 'drag';
  try {
    localStorage.setItem(SCRUB_KEY, scrubMode);
  } catch {
    // Not kept, then — it still applies until the page is closed.
  }
  renderScrubMode();
}

/** The switch, the setting and the hint, all saying the same thing. */
function renderScrubMode() {
  const stepping = scrubMode === 'step';
  el('scrub-mode').textContent = stepping ? 'Step' : 'Drag';
  el('scrub-mode').classList.toggle('on', stepping);
  el('scrub-setting').value = scrubMode;
  document.querySelector('.dragHint').textContent = stepping
    ? 'tap left or right for a frame — or drag'
    : 'drag anywhere to move through it';
}

function onDragMove(event) {
  if (!event.buttons || !span) return;
  const width = el('stage').clientWidth || 1;
  seekTo(
    draggedTo({
      fromMs: draggingFromMs,
      acrossFraction: (event.clientX - draggingFromX) / width,
      span,
    })
  );
}

// ------------------------------------------------------------ annotating

/** A dot on each tab whose mark has hits, so what is annotated shows at a glance. */
function paintAnnotated() {
  const marks = exchange?.marks ?? [];
  [...el('tabs').children].forEach((button, index) => {
    button.classList.toggle('annotated', Boolean(marks[index]?.hits?.length));
  });
  el('annotate').classList.toggle('on', placing);
}

/** The pencil: open the annotating bar, or close it again. */
function toggleAnnotating() {
  if (!exchange?.marks[current]) return;
  if (placing) finishPlacing();
  else startPlacing(placingSide);
}

// --------------------------------------------------------- placing hits

/**
 * Annotating the mark on screen: placing hits on it.
 *
 * Opened by the pencil. Any number of hits, each in the colour chosen on the
 * bar, which stays on whichever was used last. Dragging still moves through
 * the moment, so the hit goes in at the frame it landed on. Undo takes back
 * the last one; Done ends it.
 */
let placing = false;
let placingSide = 'red';

function startPlacing(side) {
  placing = true;
  document.body.classList.add('placing');
  choosePlacingSide(side);
  el('placing').hidden = false;
  showPlacingCount();
  paintAnnotated();
}

function stopPlacing() {
  placing = false;
  document.body.classList.remove('placing');
  el('placing').hidden = true;
  if (exchange) paintAnnotated();
}

/** Done: the bar closes. */
function finishPlacing() {
  stopPlacing();
  // Opened from the summary just to annotate, Done means back there.
  if (reviewingFrom === 'summary') backToSummary();
}

function choosePlacingSide(side) {
  placingSide = side;
  el('hit-red').classList.toggle('on', side === 'red');
  el('hit-blue').classList.toggle('on', side === 'blue');
}

function showPlacingCount() {
  const count = exchange?.marks[current]?.hits?.length ?? 0;
  el('placing-text').textContent = count
    ? `${count} hit${count === 1 ? '' : 's'} on mark ${current + 1} — tap for another`
    : 'Tap where each hit landed';
  el('hit-undo').disabled = count === 0;
}

/** Put a hit where the picture was tapped, at the moment on screen. */
function placeHit(clientX, clientY) {
  trace('hit', placingSide);
  const mark = exchange?.marks[current];
  if (!mark) return;
  const box = el('stage').getBoundingClientRect();
  const at = toFrame(
    { x: clientX, y: clientY },
    { left: box.left, top: box.top, width: box.width, height: box.height },
    { width: clip.videoWidth, height: clip.videoHeight }
  );
  // On a bar beside the picture: not a hit.
  if (!at) return;

  exchange = withHit(exchange, mark.id, { atMs: positionMs, x: at.x, y: at.y, side: placingSide });
  afterHitsChanged();
}

function undoHit() {
  trace('hit undone');
  const mark = exchange?.marks[current];
  if (!mark) return;
  exchange = withoutLastHit(exchange, mark.id);
  afterHitsChanged();
}

/** The bout, the stretch on screen and the bar all follow a change of hits. */
function afterHitsChanged() {
  bout = withExchangeReplaced(bout, exchange);
  const mark = exchange.marks[current];
  span = cut(exchange, [mark.id], { leadMs, tailMs }).spans[0];
  renderPosition();
  showPlacingCount();
  paintAnnotated();
}

// -------------------------------------------------------------- the summary

/**
 * The end of a bout: every exchange, and the marks in each, chosen for the
 * saved video.
 *
 * Reached by END. One section per exchange, each with a checkbox per mark.
 * Behind the list, the moment last ticked or unticked loops at double speed,
 * so the referee can see what they are choosing without leaving the list.
 * BACK carries on filming the same bout; End bout throws it away, asking first.
 */
/**
 * The SBA's logo, for the corner of every saved video. Loaded up front and
 * from the offline cache, so saving never waits on it — and if it cannot be
 * had, the video is saved without it rather than not at all.
 */
let watermark = null;
{
  const logo = new Image();
  logo.src = './logo.png';
  logo
    .decode()
    .then(() => (watermark = logo))
    .catch(() => {});
}

/**
 * How long the saved video's ending adds: a card of words — the title typed,
 * or else each side's hit count when anything was annotated — then the logo,
 * when there is a logo.
 */
function endCardMs(plan) {
  const tally = hitTally(plan);
  const card = el('export-title').value.trim() !== '' || tally.red + tally.blue > 0;
  return endingMs(Boolean(watermark), card);
}

el('export-title').addEventListener('input', renderLength);
// Done on a phone's keyboard means done typing: put the keyboard away.
el('export-title').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') event.target.blur();
});

const behind = el('behind');
let selection = null;
/** The stretch the background is looping, or null when it is not. */
let behindSpan = null;
/** Which recording the background holds, so it is not reloaded needlessly. */
let behindTake = null;
/** Exchanges whose sections the referee has folded away. */
const folded = new Set();

function openSummary() {
  trace('summary');
  // The annotated marks are the ones that matter — or all, if none was.
  selection = startingChoice(bout);
  folded.clear();
  renderPicks();
  screenIs('export');
  playBehind();
}

/**
 * A bout saved with Save raw, opened again from the start screen: rebuilt from
 * its record on the recordings in its zip — read as slices of the file picked,
 * not into memory — and put on the summary as it was saved, ticks, title and
 * window and all, ready to re-cut, annotate, save again or discard.
 */
async function openSaved(file) {
  if (!file || bout || capture.recording) return;
  const note = el('live-note');
  note.textContent = 'Opening the saved bout…';
  try {
    const opened = await readRaw(await readZip(file));
    const loaded = boutFromRecord(opened.record, (key) => media.fromBlob(opened.recordings.get(key)));
    bout = loaded.bout;
    leadMs = loaded.window.leadMs;
    tailMs = loaded.window.tailMs;
    for (const [input, value] of [
      ['lead', leadMs],
      ['tail', tailMs],
    ]) {
      el(input).value = String(value);
      el(`${input}-value`).textContent = `${(value / 1000).toFixed(1)}s`;
    }
    el('export-title').value = loaded.title;
    note.textContent = 'Point it at the fight, then press START.';
    selection = selectionOf(bout, loaded.chosen);
    trace('opened saved bout', `${bout.exchanges.length} exchanges`);
    folded.clear();
    renderPicks();
    screenIs('export');
    playBehind();
  } catch (error) {
    trace('could not open', error?.message ?? error);
    note.textContent = `Could not open it: ${error?.message ?? String(error)}`;
  }
}

/** BACK from the summary: the bout is not over after all. */
function carryOn() {
  trace('BACK from the summary');
  stopBehind();
  startFilming();
}

/**
 * Annotate one mark from the summary: its exchange on the review screen, on
 * that mark, with the bar already open.
 *
 * The exchange's own recording is put back in the player first and waited for,
 * since a recorder's file can only be sought once it has been measured.
 */
async function annotateFromSummary(exchangeIndex, markIndex) {
  trace('annotate from the summary', `exchange ${exchangeIndex + 1}, mark ${markIndex + 1}`);
  const chosen = bout?.exchanges[exchangeIndex];
  if (!chosen?.marks[markIndex]) return;
  stopBehind();

  exchange = chosen;
  const measured = media.measureDurationMs(clip, { giveUpAfterMs: 3000 });
  clip.src = media.urlOf(exchange.takes[0].media);
  clip.load();
  await measured;

  reviewingFrom = 'summary';
  renderTabs();
  select(markIndex);
  screenIs('review');
  startPlacing(placingSide);
}

/**
 * From annotating, back to the summary as it was left — the same marks ticked,
 * plus the one just annotated if it now has hits, since annotating it says it
 * matters.
 */
function backToSummary() {
  const annotated = exchange?.marks[current];
  stopPlacing();
  if (annotated?.hits?.length && !isChosen(selection, annotated.id)) {
    selection = toggled(selection, bout, annotated.id);
  }
  reviewingFrom = 'filming';
  leaveExchange();
  renderPicks();
  screenIs('export');
  playBehind();
}

/** The footage behind a take, wherever in the bout it is. */
function takeFootage(takeId) {
  for (const each of bout?.exchanges ?? []) {
    const take = each.takes.find((candidate) => candidate.id === takeId);
    if (take) return take.media;
  }
  return null;
}

/** How much the bout is holding in memory — the thing that could run out. */
function boutBytes() {
  let total = 0;
  for (const each of bout?.exchanges ?? []) {
    for (const take of each.takes) total += media.sizeOf(take.media);
  }
  return total;
}

/** One section per exchange, with a checkbox per mark, numbered as in review. */
function renderPicks() {
  const picks = el('picks');
  picks.innerHTML = '';
  const playing = showing(selection, bout);

  bout.exchanges.forEach((each, exchangeIndex) => {
    const item = document.createElement('li');
    const section = document.createElement('details');
    section.open = !folded.has(each.id);
    section.addEventListener('toggle', () => {
      if (section.open) folded.delete(each.id);
      else folded.add(each.id);
    });
    const heading = document.createElement('summary');
    const chosenHere = each.marks.filter((mark) => isChosen(selection, mark.id)).length;
    heading.textContent = `Exchange ${exchangeIndex + 1}`;
    const count = document.createElement('span');
    count.className = 'at';
    count.textContent = `${chosenHere} of ${each.marks.length}`;
    heading.append(count);
    const marks = document.createElement('ul');

    each.marks.forEach((mark, markIndex) => {
      const row = document.createElement('li');
      const label = document.createElement('label');
      label.classList.toggle('showing', mark.id === playing);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = isChosen(selection, mark.id);
      box.dataset['exchange'] = String(exchangeIndex + 1);
      box.dataset['mark'] = String(markIndex + 1);
      box.addEventListener('change', () => {
        selection = toggled(selection, bout, mark.id);
        renderPicks();
        playBehind();
      });
      const number = document.createElement('span');
      number.textContent = `Mark ${markIndex + 1}`;
      const at = document.createElement('span');
      at.className = 'at';
      at.textContent = `${(mark.atMs / 1000).toFixed(1)}s`;
      label.append(box, number);
      // One dot per hit, in its fighter's colour.
      if (mark.hits?.length) {
        const dots = document.createElement('span');
        dots.className = 'hits';
        for (const hit of mark.hits) {
          const dot = document.createElement('i');
          dot.className = hit.side;
          dots.append(dot);
        }
        label.append(dots);
      }
      label.append(at);
      // Annotate this mark: outside the label, so a tap on it does not also
      // tick or untick the box.
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = '✎';
      edit.title = 'Annotate this mark';
      edit.dataset['exchange'] = String(exchangeIndex + 1);
      edit.dataset['mark'] = String(markIndex + 1);
      edit.addEventListener('click', () => void annotateFromSummary(exchangeIndex, markIndex));
      row.append(label, edit);
      marks.append(row);
    });

    section.append(heading, marks);
    item.append(section);
    picks.append(item);
  });

  renderLength();
}

/**
 * How long the saved video will be, under the list — which a title changes
 * too, since a title gets a card of its own at the end.
 */
function renderLength() {
  if (!bout || !selection) return;
  const chosen = selection.chosen.length;
  const total = bout.exchanges.reduce((sum, each) => sum + each.marks.length, 0);
  const plan = cutBout(bout, selection.chosen, { leadMs, tailMs });
  el('export-length').textContent =
    (chosen
      ? `${chosen} of ${total} mark${total === 1 ? '' : 's'} · ${(reelLengthMs(plan, endCardMs(plan)) / 1000).toFixed(1)}s`
      : 'Nothing chosen') + ` · ${(boutBytes() / 1e6).toFixed(0)} MB held`;
  el('export-save').disabled = chosen === 0 || !canRecordReel();
  // The raw files are the whole bout, whatever is ticked.
  el('export-raw').disabled = false;
}

/**
 * Loop the moment last touched, at double speed, behind the list.
 *
 * Double speed because it is there to be recognised, not studied — a moment
 * seen whole in a second and a bit is enough to know which one it is. The
 * moment can be in any exchange, so the background switches recording when it
 * has to.
 */
function playBehind() {
  const id = showing(selection, bout);
  const holder = id ? exchangeHolding(bout, id) : null;
  if (!holder) return stopBehind();
  const take = holder.takes[0];
  if (behindTake !== take.id) {
    behind.src = media.urlOf(take.media);
    behindTake = take.id;
  }
  behindSpan = cut(holder, [id], { leadMs, tailMs }).spans[0];
  behind.muted = true;
  behind.defaultPlaybackRate = 2;
  behind.playbackRate = 2;
  behind.currentTime = behindSpan.fromMs / 1000;
  behind.play().catch(() => {});
  loopBehind();
}

/** Back to the start of the stretch whenever the end is passed. */
function loopBehind() {
  const check = () => {
    if (!behindSpan) return;
    if (behind.currentTime * 1000 >= behindSpan.toMs || behind.ended) {
      behind.currentTime = behindSpan.fromMs / 1000;
      behind.play().catch(() => {});
    }
    paintBehindHits();
    if (behind.requestVideoFrameCallback) behind.requestVideoFrameCallback(check);
    else requestAnimationFrame(check);
  };
  check();
}

/**
 * The looping moment's hits, over the background, timed by where the
 * background actually is — the same drawing review and the saved video use.
 */
function paintBehindHits() {
  const layer = el('behind-hits');
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(layer.clientWidth * ratio);
  const height = Math.round(layer.clientHeight * ratio);
  if (layer.width !== width || layer.height !== height) {
    layer.width = width;
    layer.height = height;
  }
  const paper = layer.getContext('2d');
  paper.clearRect(0, 0, width, height);
  if (!behindSpan?.hits?.length) return;

  const picture = pictureIn(
    { left: 0, top: 0, width, height },
    { width: behind.videoWidth, height: behind.videoHeight }
  );
  if (picture) drawHits(paper, behindSpan.hits, behind.currentTime * 1000, picture, 1, hitTiming);
}

function stopBehind() {
  behindSpan = null;
  behind.pause();
  paintBehindHits();
}

/** Forget the background's footage entirely, when the bout is let go of. */
function emptyBehind() {
  stopBehind();
  behindTake = null;
  behind.removeAttribute('src');
  behind.load();
}

// ------------------------------------------------- saving the marked moments

/**
 * Saving a bout's chosen moments as one short video.
 *
 * It is recorded by playing it, so it takes exactly as long as the result
 * lasts — a few seconds for a handful of marks. That is why there is a
 * progress bar and a way to stop.
 *
 * Nothing merges overlapping stretches yet, so two marks a second apart put
 * that second in the file twice.
 */
let saving = null;

function showSavingProgress(doneMs, totalMs) {
  const through = totalMs > 0 ? Math.min(1, doneMs / totalMs) : 0;
  el('saving-bar').firstElementChild.style.width = `${Math.round(through * 100)}%`;
  el('saving-title').textContent = `Saving ${(totalMs / 1000).toFixed(1)}s of marked moments`;
}

/**
 * The saved video, once there is one, waiting to be handed over.
 *
 * Held until the referee taps Share (or Download, or Done) because a phone
 * opens its share sheet only straight after a tap. Asking for it the moment
 * recording finished — seconds after SAVE was pressed — was asking too late:
 * the phone refused, and the fallback opened the video in place of the app,
 * which on an iPhone is a black screen with no way back.
 */
let ready = null;

/** Stop, Done or Close — whichever the panel is currently offering. */
function closeSaving() {
  saving?.abort();
  saving = null;
  if (ready) {
    ready.release();
    ready = null;
  }
  el('saving-share').hidden = true;
  el('saving-download').hidden = true;
  el('saving-download').removeAttribute('href');
  el('saving-new').hidden = true;
  el('saving').classList.remove('saved');
  el('saving').hidden = true;
  el('saving-stop').textContent = 'Stop';
  if (document.body.dataset['screen'] === 'export') playBehind();
}

/**
 * Say it worked, once it has: after the share sheet is done with the video,
 * or the download has been started.
 *
 * Offers the two things that come next. New bout lets this one go without
 * asking, since it has just been saved; Back to the bout stays on the summary,
 * to save another cut of it or carry on filming.
 */
function showSaved() {
  if (!ready) return;
  el('saving').classList.add('saved');
  el('saving-title').textContent = '✓ Saved';
  el('saving-text').textContent = `${ready.name} — start the next bout, or go back to this one.`;
  el('saving-share').hidden = true;
  el('saving-download').hidden = true;
  el('saving-new').hidden = false;
  el('saving-stop').textContent = 'Back to the bout';
}

/** New bout, from the saved panel: this one is safe, so no asking. */
function newBoutAfterSaving() {
  closeSaving();
  endBout();
}

/**
 * The recorder last started, until it has let go of the player. A save that
 * was stopped finishes at once, but its tidying up — putting the player back
 * as it was — must not overlap the next save's use of the same player.
 */
let recorderRunning = Promise.resolve();

async function saveReel() {
  if (!bout || !selection || selection.chosen.length === 0 || saving) return;
  trace('Save cut', `${selection.chosen.length} marks`);

  const chosen = selection.chosen;
  const plan = cutBout(bout, chosen, { leadMs, tailMs });
  // The background would be decoding alongside the recording for nothing.
  stopBehind();
  const totalMs = reelLengthMs(plan, endCardMs(plan));

  const mine = new AbortController();
  saving = mine;
  const stopped = mine.signal;
  el('saving-text').textContent =
    'It plays them through to record them, so it takes as long as they last.';
  el('saving-stop').textContent = 'Stop';
  el('saving').hidden = false;
  showSavingProgress(0, totalMs);

  let footage = null;
  let done = () => {};
  try {
    await recorderRunning;
    recorderRunning = new Promise((resolve) => (done = resolve));
    if (stopped.aborted) throw new Error('saving was stopped');
    footage = await recordReel(
      plan,
      {
        video: clip,
        canvas: el('reel'),
        urlFor: (takeId) => {
          const footage = takeFootage(takeId);
          return footage ? media.urlOf(footage) : null;
        },
        ...(watermark ? { watermark } : {}),
      },
      {
        onProgress: showSavingProgress,
        signal: stopped,
        hitTiming,
        // Each step of the save, for a problem report to say where it got to.
        onNote: (what, detail) => trace(`saving: ${what}`, detail),
        // Typed on the Save screen; blank means no title on the video at all.
        ...(el('export-title').value.trim() ? { title: el('export-title').value } : {}),
      }
    );
  } catch (error) {
    // Stopped: Stop has tidied up already, and the panel may by now be a
    // later save's — so nothing here touches it.
    if (stopped.aborted) return trace('cut stopped');
    if (saving === mine) saving = null;
    // Left open, with what went wrong on it. Saving is the one thing here that
    // can fail for reasons the referee cannot see.
    trace('cut failed', error?.message ?? error);
    el('saving-title').textContent = 'Could not save it';
    el('saving-text').textContent = error?.message ?? String(error);
    el('saving-stop').textContent = 'Close';
    return;
  } finally {
    done();
  }

  if (stopped.aborted) {
    media.release(footage);
    return trace('cut stopped');
  }
  if (saving === mine) saving = null;
  trace('cut saved', `${(media.sizeOf(footage) / 1e6).toFixed(1)} MB`);
  offerReel(footage, chosen);
}

/**
 * The raw files: every exchange's whole recording, untouched, with the bout
 * written down beside them — `bout.json` and `markers.csv` — in one zip.
 *
 * Nothing is played through or recorded again, so it takes moments rather than
 * as long as the footage lasts; the only reading is each recording's checksum,
 * a piece at a time. The zip is the recordings themselves with headers between
 * them, so the footage is never held twice.
 */
async function saveRaw() {
  if (!bout || !selection || saving) return;
  trace('Save raw');
  stopBehind();
  const mine = new AbortController();
  saving = mine;
  const stopped = mine.signal;
  el('saving-title').textContent = 'Packing the raw files';
  el('saving-text').textContent = 'Every exchange, whole, with its marks and hits written down beside it.';
  el('saving-stop').textContent = 'Stop';
  el('saving').hidden = false;
  el('saving-bar').firstElementChild.style.width = '0%';

  try {
    const files = new Map();
    const recordings = [];
    for (const [index, each] of bout.exchanges.entries()) {
      for (const take of each.takes) {
        const bytes = media.bytesOf(take.media);
        const key = recordingName(index, bytes.type || capture.mimeType);
        const measured = await media.shapeOf(take.media);
        const shape = measured.width > 0 ? measured : { width: take.width, height: take.height };
        files.set(take.id, { key, ...shape });
        recordings.push({ name: key, data: bytes });
      }
    }
    const record = boutRecord(bout, {
      chosen: selection.chosen,
      title: el('export-title').value,
      window: { leadMs, tailMs },
      app: VERSION,
      savedAt: new Date().toISOString(),
      files,
    });
    const written = [
      { name: 'bout.json', data: new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }) },
      { name: 'markers.csv', data: new Blob([markersCsv(record)], { type: 'text/csv' }) },
      ...recordings,
    ];
    const entries = [];
    for (const [at, entry] of written.entries()) {
      if (stopped.aborted) throw new Error('stopped');
      entries.push({ ...entry, crc: await crcOfBlob(entry.data) });
      el('saving-bar').firstElementChild.style.width = `${Math.round(((at + 1) / written.length) * 100)}%`;
    }
    const zip = zipStored(entries, new Date());
    if (stopped.aborted) return trace('raw stopped');
    if (saving === mine) saving = null;
    const url = URL.createObjectURL(zip);
    offerFile(zip, rawFilename(bout.startedAt), url, () => URL.revokeObjectURL(url));
  } catch (error) {
    // Stopped: Stop has tidied up already, and the panel may be a later save's.
    if (stopped.aborted) return trace('raw stopped');
    if (saving === mine) saving = null;
    trace('raw failed', error?.message ?? error);
    el('saving-title').textContent = 'Could not save the raw files';
    el('saving-text').textContent = error?.message ?? String(error);
    el('saving-stop').textContent = 'Close';
  }
}

/**
 * Offer the finished video, and wait for a tap to hand it over.
 *
 * Share where the phone has a share sheet that takes files — that is how a
 * video reaches a camera roll, a chat or a drive. A download link where it
 * has not, which is a laptop; it is a link the referee taps, never one the
 * page clicks for them.
 */
function offerReel(footage, chosen) {
  const bytes = media.bytesOf(footage);
  // Named for when the bout started and how many moments made it in.
  const name = reelFilename(bout.startedAt, chosen.length, bytes.type);
  offerFile(bytes, name, media.urlOf(footage), () => media.release(footage));
}

/**
 * Offer a finished file — the cut, or the raw files — and wait for a tap to
 * hand it over. `release` gives back what it holds once the panel is closed.
 */
function offerFile(bytes, name, url, release) {
  // The plain type — "video/webm", not "video/webm;codecs=vp9". Chrome on
  // Android turns down a file whose type carries codec details, and says only
  // "Permission denied".
  const type = bytes.type.split(';')[0].trim();
  const file = new File([bytes], name, { type });
  ready = { file, name, url, release };

  const shareable = Boolean(navigator.canShare?.({ files: [file] }));
  el('saving-title').textContent = 'Saved';
  el('saving-text').textContent = shareable
    ? `${name} — tap Share to send it to your camera roll, a chat or a drive.`
    : name;
  el('saving-bar').firstElementChild.style.width = '100%';
  el('saving-share').hidden = !shareable;
  const download = el('saving-download');
  download.hidden = shareable;
  if (!shareable) {
    download.href = url;
    download.download = name;
  }
  el('saving-stop').textContent = 'Done';
}

/** Runs inside the tap on Share, which is what lets the phone open the sheet. */
async function shareReady() {
  if (!ready) return;
  try {
    await navigator.share({ files: [ready.file], title: ready.name });
    trace('shared', ready.file.type);
    showSaved();
  } catch (error) {
    // Closing the share sheet without choosing anything is not a failure, and
    // Share stays where it is for another go.
    if (error?.name === 'AbortError') return trace('share sheet closed');
    trace('share refused', `${error?.name}: ${error?.message}`);
    // Turned down for any other reason, it can still be saved: Download, in
    // place of the Share that did not work.
    el('saving-text').textContent = `The share sheet would not take it (${error?.message ?? String(error)}) — tap Download to save it instead.`;
    el('saving-share').hidden = true;
    const download = el('saving-download');
    download.href = ready.url;
    download.download = ready.name;
    download.hidden = false;
  }
}

// ------------------------------------------------------- reporting a problem

/** Where problem reports go as issues. */
const ISSUES = 'MartinFrancu/VRL';

/** Taken when the report opens, so it shows what led up to it, not the report itself. */
let reportAt = null;

/** What the app knows about where it is running, a label and a value each. */
function reportFacts() {
  const settings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
  return [
    ['App', `${VERSION}${location.pathname.includes('/next/') ? ' (test build)' : ''}`],
    ['When', new Date().toISOString()],
    ['Phone', navigator.userAgent],
    ['Screen', `${innerWidth}×${innerHeight} at ${devicePixelRatio}x, held ${orientationNow()}, on ${document.body.dataset['screen']}`],
    ['Camera', `${settings.width ?? '?'}×${settings.height ?? '?'} at ${settings.frameRate ?? '?'} fps`],
    ['Recording as', capture.mimeType || '?'],
    ['Moving by', scrubMode === 'step' ? 'Step' : 'Drag'],
    ['Window', `${leadMs} ms before, ${tailMs} ms after; hits ${hitTiming.leadMs} ms before, ${hitTiming.tailMs} ms after`],
    ['Installed', navigator.serviceWorker?.controller ? 'yes, working offline' : 'no'],
  ];
}

/** The bout as it stands — no footage, no title: counts, times and sizes. */
function reportState() {
  if (!bout) return [];
  const lines = [`${bout.exchanges.length} exchange${bout.exchanges.length === 1 ? '' : 's'}`];
  bout.exchanges.forEach((each, index) => {
    const hits = each.marks.reduce((sum, mark) => sum + (mark.hits?.length ?? 0), 0);
    const take = each.takes[0];
    const size = take ? `${(media.sizeOf(take.media) / 1e6).toFixed(1)} MB` : 'no recording';
    lines.push(
      `exchange ${index + 1}: ${each.marks.length} marks at ${each.marks.map((mark) => `${(mark.atMs / 1000).toFixed(1)}s`).join(', ') || '—'}; ` +
        `${hits} hits; ${take ? `${(take.durationMs / 1000).toFixed(1)}s, ${size}` : size}`
    );
  });
  if (selection) lines.push(`ticked for the cut: ${selection.chosen.length}`);
  return lines;
}

function currentReport() {
  return { ...reportAt, note: el('report-note').value };
}

function renderReport() {
  const report = currentReport();
  el('report-text').textContent = reportText(report);
  el('report-issue').href = issueUrl(ISSUES, report);
}

function openReport() {
  trace('report opened');
  reportAt = { facts: reportFacts(), state: reportState(), log: traced.entries(performance.now()), nowMs: performance.now() };
  el('report-status').textContent = '';
  renderReport();
  el('report').hidden = false;
}

async function shareReport() {
  const text = reportText(currentReport());
  try {
    await navigator.share({ title: 'SBA Replay Lite — problem report', text });
    el('report-status').textContent = 'Sent.';
  } catch (error) {
    if (error?.name === 'AbortError') return;
    // No share sheet, or it would not take words: copying still gets it out.
    await copyReport(`The share sheet would not take it (${error?.message ?? error}).`);
  }
}

async function copyReport(why = '') {
  const text = reportText(currentReport());
  try {
    await navigator.clipboard.writeText(text);
    el('report-status').textContent = `${why} Copied — paste it into a message or an email.`.trim();
  } catch {
    // Not allowed to copy: open the report, so it can be selected by hand.
    el('report').querySelector('details').open = true;
    el('report-status').textContent = `${why} Could not copy it — select the report below by hand.`.trim();
  }
}

/**
 * Press and hold to report, on things already on each screen — the version,
 * the time on the review picture, the summary's heading — so a report can be
 * made where the problem is, without a button in the way while filming.
 */
function holdToReport(element) {
  let timer = null;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  element.addEventListener('pointerdown', () => {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      openReport();
    }, 800);
  });
  for (const ending of ['pointerup', 'pointerleave', 'pointercancel']) element.addEventListener(ending, cancel);
  element.addEventListener('contextmenu', (event) => event.preventDefault());
}

// ---------------------------------------------------------------- the trimmings

/** One dot per mark taken, so the count is read rather than counted. */
function renderDots() {
  const dots = el('dots');
  dots.innerHTML = '';
  for (let taken = 0; taken < capture.markCount; taken++) {
    const dot = document.createElement('i');
    dot.className = 'on';
    dots.append(dot);
  }
}

function renderTapHint() {
  el('tapHint').textContent = 'tap anywhere to mark';
}

function tickElapsed() {
  const seconds = Math.floor((performance.now() - recordingStartedAt) / 1000);
  el('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The screen must not sleep while a bout is being filmed. */
async function keepAwake(on) {
  try {
    if (on) wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    else {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch {
    // Not supported, or refused. The bout still gets filmed.
  }
}

document.addEventListener('visibilitychange', () => {
  // A wake lock is dropped whenever the page is hidden, and is not given back.
  if (document.visibilityState === 'visible' && capture.recording) keepAwake(true);
});

// --------------------------------------------------------------- diagnostics

function renderDiagnostics() {
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  const readings = capture.lastReadings;
  const cameraClockRan = cameraClockUsable(readings);
  const usingCameraClock = markSource === 'camera' && cameraClockRan;
  const footage = exchange?.takes[0]?.media ?? null;
  const reaches = exchange ? durationOf(exchange) : null;

  el('diag-body').innerHTML =
    `<h2>device</h2>` +
    `Solo ${VERSION}\n${navigator.userAgent}\n` +
    `<h2>camera</h2>` +
    `${settings.width ?? '?'}×${settings.height ?? '?'} at ${settings.frameRate ?? '?'} fps\n` +
    `one frame is ${Math.round(frameMs)} ms\n` +
    `recorded as ${capture.mimeType || media.mimeTypeHere() || '(browser default)'}\n` +
    `<h2>recording</h2>` +
    `${footage ? (media.sizeOf(footage) / 1e6).toFixed(1) : '0.0'} MB, ` +
    `${reaches === null ? 'duration unknown' : (reaches / 1000).toFixed(2) + ' s'}\n` +
    `<h2>which way up — the last bout you reviewed</h2>` +
    (lastReviewed
      ? `camera gave   ${lastReviewed.shape}\n` +
        `phone held    ${lastReviewed.held}\n` +
        `file came out ${lastReviewed.clip}\n` +
        `reviewed in   ${lastReviewed.reviewedIn}\n`
      : 'nothing reviewed yet this session\n') +
    `showing ${shownMs === null ? '—' : (shownMs / 1000).toFixed(3) + ' s'}\n` +
    `<h2>marks — page clock vs camera clock</h2>` +
    (readings.length
      ? readings
          .map(
            (reading, index) =>
              `${index + 1}: wall ${(reading.wallMs / 1000).toFixed(3)}s   ` +
              `frame ${reading.frameMs === null ? '—' : (reading.frameMs / 1000).toFixed(3) + 's'}`
          )
          .join('\n')
      : 'none yet') +
    `\nplacing the marks by the <b>${usingCameraClock ? 'camera' : 'page'}</b> clock\n` +
    (cameraClockRan
      ? `<button id="diag-flip">use the ${markSource === 'camera' ? 'page' : 'camera'} clock instead</button>\n`
      : 'the camera clock never ran on this device, so it is ignored\n') +
    `<h2>what this device has</h2>` +
    `MediaRecorder        ${!!window.MediaRecorder}\n` +
    `frame callbacks      ${!!preview.requestVideoFrameCallback}\n` +
    `wake lock            ${!!navigator.wakeLock}\n` +
    `WebCodecs encoder    ${!!window.VideoEncoder}\n` +
    `canvas capture       ${typeof HTMLCanvasElement.prototype.captureStream === 'function'}\n` +
    `can save a video     ${canRecordReel()}\n` +
    `can share a file     ${!!navigator.canShare}\n` +
    `ManagedMediaSource   ${!!window.ManagedMediaSource}\n`;

  el('diag-flip')?.addEventListener('click', () => {
    markSource = markSource === 'camera' ? 'wall' : 'camera';
    // The bout on screen is re-placed, not just the next one. Resolving is
    // cheap; re-filming is not.
    // Re-placing builds the exchange afresh from Capture's readings, which know
    // nothing of hits. That is safe only because this panel is reached from
    // idle, between bouts; were it ever reachable mid-bout, hits would need
    // carrying across here.
    const replaced = capture.usingClock(markSource);
    if (replaced && bout) bout = withExchangeReplaced(bout, replaced);
    if (replaced && exchange?.id === replaced.id) exchange = replaced;
    if (document.body.dataset['screen'] === 'review') select(current);
    renderDiagnostics();
  });
}

function showDiagnostics() {
  renderDiagnostics();
  el('diag').hidden = false;
}

// ------------------------------------------------- getting it onto a phone

/** Keep working when the signal does not. See sw.js. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------------------------------------------------------------------- wiring

el('start').addEventListener('click', startFilming);
el('toReview').addEventListener('click', () => void toReview());
el('end').addEventListener('click', () => void toSummary());
el('toRecord').addEventListener('click', toRecord);
el('confirm-cancel').addEventListener('click', () => {
  el('confirm').hidden = true;
});
el('confirm-end').addEventListener('click', endBout);

// The whole picture is the mark button, but only while filming — and the
// buttons sitting on top of it are their own.
el('camera').addEventListener('pointerdown', (event) => {
  if (document.body.dataset['screen'] !== 'recording') return;
  if (event.target.closest('button')) return;
  markAt();
});

// On the review screen the picture is the scrubber instead.
el('stage').addEventListener('pointerdown', onDragStart);
el('stage').addEventListener('pointermove', onDragMove);
el('stage').addEventListener('pointerup', onDragEnd);
el('hit-red').addEventListener('click', () => choosePlacingSide('red'));
el('hit-blue').addEventListener('click', () => choosePlacingSide('blue'));
el('hit-undo').addEventListener('click', undoHit);
el('hit-done').addEventListener('click', finishPlacing);
// The bar's own buttons sit on the picture; a press on them is not a drag.
for (const id of ['hit-red', 'hit-blue', 'hit-undo', 'hit-done']) {
  el(id).addEventListener('pointerdown', (event) => event.stopPropagation());
}

el('help-open').addEventListener('click', () => {
  el('help').hidden = false;
  el('help').scrollTop = 0;
});
el('help-close').addEventListener('click', () => {
  el('help').hidden = true;
});

el('export-back').addEventListener('click', carryOn);
el('annotate').addEventListener('click', toggleAnnotating);
el('export-discard').addEventListener('click', askToEndBout);
el('saving-new').addEventListener('click', newBoutAfterSaving);
// The download is the browser's to do once the link is followed; the panel
// changes a moment later, so as not to stand in the way of it.
el('saving-download').addEventListener('click', () => {
  trace('downloaded', ready?.name);
  setTimeout(showSaved, 0);
});
el('export-save').addEventListener('click', () => void saveReel());
el('export-raw').addEventListener('click', () => void saveRaw());
renderScrubMode();
renderHitTiming();
el('hit-lead').addEventListener('input', (event) => setHitTiming({ ...hitTiming, leadMs: Number(event.target.value) }));
el('hit-tail').addEventListener('input', (event) => setHitTiming({ ...hitTiming, tailMs: Number(event.target.value) }));
el('scrub-mode').addEventListener('click', () => setScrubMode(scrubMode === 'step' ? 'drag' : 'step'));
el('scrub-setting').addEventListener('change', (event) => setScrubMode(event.target.value));
el('open-saved').addEventListener('click', () => el('open-file').click());
el('report-open').addEventListener('click', openReport);
el('report-close').addEventListener('click', () => {
  el('report').hidden = true;
});
el('report-note').addEventListener('input', renderReport);
el('report-share').addEventListener('click', () => void shareReport());
el('report-copy').addEventListener('click', () => void copyReport());
el('report-issue').addEventListener('click', () => trace('report sent as an issue'));
for (const id of ['version', 'readout', 'export-heading']) holdToReport(el(id));
el('open-file').addEventListener('change', (event) => {
  const [file] = event.target.files ?? [];
  // Cleared, so picking the same zip again still counts as a change.
  event.target.value = '';
  void openSaved(file);
});
el('saving-stop').addEventListener('click', closeSaving);
el('saving-share').addEventListener('click', () => void shareReady());

el('info').addEventListener('click', showDiagnostics);
el('diag-close').addEventListener('click', () => {
  el('diag').hidden = true;
});

for (const [input, get, set] of [
  ['lead', () => leadMs, (value) => (leadMs = value)],
  ['tail', () => tailMs, (value) => (tailMs = value)],
]) {
  const control = el(input);
  control.value = String(get());
  el(`${input}-value`).textContent = `${(get() / 1000).toFixed(1)}s`;
  control.addEventListener('input', (event) => {
    set(Number(event.target.value));
    el(`${input}-value`).textContent = `${(get() / 1000).toFixed(1)}s`;
    if (exchange && document.body.dataset['screen'] === 'review') select(current);
    if (bout && selection && document.body.dataset['screen'] === 'export') {
      renderPicks();
      playBehind();
    }
  });
}

el('version').textContent = VERSION;
renderDots();
renderTapHint();
openCamera().catch((error) => {
  el('live-note').textContent = `No camera: ${error.name}. It needs https and permission.`;
  el('start').disabled = true;
});
