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

import { cut, durationOf } from './app/bout/bout.js';
import { Capture } from './app/capture/capture.js';
import { cameraClockUsable } from './app/capture/clock.js';
import * as media from './app/media/media.js';
import {
  clampWithin,
  draggedTo,
  progressThrough,
  readoutFor,
  shortfallLabel,
} from './app/render/playhead.js';

const VERSION = '1.1.10';

const el = (id) => document.getElementById(id);
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
let bout = null;
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

/** Rotation fires a flurry of these, and the camera is expensive to reopen. */
function orientationChanged() {
  clearTimeout(reopenSoon);
  reopenSoon = setTimeout(followOrientation, 400);
}

screen.orientation?.addEventListener?.('change', orientationChanged);
window.addEventListener('orientationchange', orientationChanged);

function onCameraLost() {
  // Says nothing before the first bout of a session, which is the oddity noted
  // in docs/BACKLOG.md: the message is right while filming and wrong when idle
  // after a bout. Carried over unchanged rather than mixed into a refactor.
  if (!hasFilmed) return;
  el('live-note').textContent = 'The camera stopped — a call, or another app took it. Reload the page.';
  stopFilming();
  void capture.discard();
  screenIs('idle');
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

function startFilming() {
  releaseBout();
  shownMs = null;
  capture.start();
  recordingStartedAt = performance.now();
  heldAtStart = orientationNow();
  hasFilmed = true;

  screenIs('recording');
  // A fresh bout has nothing to review and no marks spent, whatever the last
  // one left behind.
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

/** Stop the trimmings that only run while a bout does. */
function stopFilming() {
  clearInterval(ticker);
  keepAwake(false);
}

// ------------------------------------------------------- moving between modes

function screenIs(name) {
  document.body.dataset['screen'] = name;
}

/** Stop filming and look at what was marked. */
async function toReview() {
  if (capture.markCount === 0) return;
  stopFilming();

  bout = await capture.finish(markSource);
  const take = bout.takes[0];
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
 * The bout being reviewed goes: it has been looked at, which is the whole
 * point of having been in here. No confirmation for that reason.
 */
function toRecord() {
  startFilming();
}

/**
 * Stop altogether.
 *
 * Asks first when there are marks, because marks that have not been reviewed
 * are the only thing in this app that cannot be got back, and END sits next to
 * REVIEW where a thumb could find the wrong one.
 */
function toIdle() {
  const spent = capture.markCount;
  if (spent > 0) {
    const count = `${spent} mark${spent === 1 ? '' : 's'}`;
    el('confirm-title').textContent = `Discard ${count}?`;
    el('confirm-text').textContent =
      'You have not looked at them yet. Ending now throws this bout away, and it cannot be got back.';
    el('confirm').hidden = false;
    return;
  }
  endNow();
}

function endNow() {
  el('confirm').hidden = true;
  stopFilming();
  void capture.discard();
  releaseBout();
  el('toReview').disabled = true;
  el('elapsed').textContent = '0:00';
  el('live-note').textContent = 'Point it at the fight, then press START.';
  renderDots();
  renderTapHint();
  screenIs('idle');
}

/** Let go of the footage, and of the element holding onto it. */
function releaseBout() {
  for (const take of bout?.takes ?? []) media.release(take.media);
  bout = null;
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
  (bout?.marks ?? []).forEach((_mark, index) => {
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
  // 'nearest' on both axes: enough to bring it into the strip, not enough to
  // scroll the screen underneath it.
  tabs[current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * Show a mark. Instant, because it is one recording already loaded — switching
 * marks is a seek, not a load.
 */
function select(index) {
  const chosen = bout?.marks[index];
  if (!chosen) return;

  current = index;
  span = cut(bout, [chosen.id], { leadMs, tailMs }).spans[0];
  el('shortfall').textContent = shortfallLabel(span) ?? '';
  markActiveTab();
  // Land on the moment that was marked, not on the start of the run-up.
  seekTo(span.atMs);
}

function seekTo(ms) {
  if (!span) return;
  positionMs = clampWithin(ms, span);
  clip.currentTime = positionMs / 1000;
  renderPosition();
  watchShownFrame();
}

/** Everything that says where in the window the footage is. */
function renderPosition() {
  el('readout').textContent = readoutFor(positionMs, span);
  const through = progressThrough(positionMs, span);
  el('progress').firstElementChild.style.width = `${Math.round(through * 100)}%`;
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

function onDragStart(event) {
  // Or the browser claims the gesture as a drag of its own — a selection, an
  // image — and abandons ours one move in, leaving the footage barely moved.
  event.preventDefault();
  draggingFromMs = positionMs;
  draggingFromX = event.clientX;
  el('stage').setPointerCapture?.(event.pointerId);
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
  const footage = bout?.takes[0]?.media ?? null;
  const reaches = bout ? durationOf(bout) : null;

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
    `ManagedMediaSource   ${!!window.ManagedMediaSource}\n`;

  el('diag-flip')?.addEventListener('click', () => {
    markSource = markSource === 'camera' ? 'wall' : 'camera';
    // The bout on screen is re-placed, not just the next one. Resolving is
    // cheap; re-filming is not.
    const replaced = capture.usingClock(markSource);
    if (replaced) bout = replaced;
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
el('end').addEventListener('click', toIdle);
el('toRecord').addEventListener('click', toRecord);
el('confirm-cancel').addEventListener('click', () => {
  el('confirm').hidden = true;
});
el('confirm-end').addEventListener('click', endNow);

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

el('help-open').addEventListener('click', () => {
  el('help').hidden = false;
  el('help').scrollTop = 0;
});
el('help-close').addEventListener('click', () => {
  el('help').hidden = true;
});

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
    if (bout && document.body.dataset['screen'] === 'review') select(current);
  });
}

el('version').textContent = VERSION;
renderDots();
renderTapHint();
openCamera().catch((error) => {
  el('live-note').textContent = `No camera: ${error.name}. It needs https and permission.`;
  el('start').disabled = true;
});
