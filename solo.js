// One referee, one phone, no setup.
//
// Three modes and nothing else. **Idle** is pointed at the fight and waiting.
// **Recording** is filming, and the whole picture is the mark button — the
// referee is watching the fight, not the screen, so the target has to be
// something that can be hit without looking. **Review** is the marks, after.
//
// Filming and reviewing never overlap, which is the whole reason this is
// simple: there is never any need to read the recent past while still writing
// to it. One recorder runs for the bout, stopping it hands back a complete file
// the browser wrote itself, and a mark is a millisecond offset into that file.

import { clampWithin, draggedTo, frameClockUsable, shortfallLabel, windowFor } from './windows.js';

const VERSION = '0.6.0';
const MAX_MARKS = 5;

const el = (id) => document.getElementById(id);
const preview = el('preview');
const clip = el('clip');

/** The camera, open from the moment permission is granted until the tab dies. */
let stream = null;
let frameMs = 1000 / 30;

let recorder = null;
/** What to do once the recorder has actually stopped: 'review' or 'discard'. */
let onStopped = 'discard';
let chunks = [];
let startedAtWallMs = 0;
/** The preview's own frame clock when recording began; null without rVFC. */
let startedAtFrameMs = null;
let lastFrameMediaMs = null;
let ticker = null;
let wakeLock = null;

/** Each mark, timed two ways — see `markAt` for why both. */
let marks = [];

let blobUrl = null;
let blobBytes = 0;
let durationMs = Number.POSITIVE_INFINITY;
let current = 0;
let positionMs = 0;
let window_ = { startMs: 0, endMs: 0, atMs: 0, shortLeadMs: 0, shortTailMs: 0 };

let leadMs = 1500;
let tailMs = 1000;

/**
 * Which of the two timings to trust for where a mark falls.
 *
 * The page's clock by default, because it is the one that is always there.
 * The camera's clock is the more accurate of the two where it runs, but it is
 * not offered for a live stream everywhere — and where it is not, it reads zero
 * rather than reading as absent, which put every mark of a bout at the same
 * instant and showed the first one under every tab. `frameClockUsable` is the
 * guard; this is the preference, switchable from the diagnostics panel.
 */
let markSource = 'wall';

/** The media time of the frame currently on screen. */
let shownMs = null;

/**
 * How the phone was held, and what shape the camera was giving, when the
 * recording began — against what shape the file turned out to be.
 *
 * A recording that comes back sideways is one of two different faults wearing
 * the same description, and they want opposite fixes: either the file is in a
 * different orientation from the one it was filmed in, or it is the right way
 * up and the page around it is not. These three numbers tell them apart, and
 * cannot be got at from anywhere but the phone it happened on.
 */
let filmed = { shape: '?', held: '?', clip: '?' };

function orientationNow() {
  return screen.orientation?.type ?? (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
}

// ---------------------------------------------------------------- the camera

async function openCamera() {
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
 * sits at zero, which is what `frameClockUsable` is there to notice.
 */
function watchPreviewFrames() {
  if (!preview.requestVideoFrameCallback) return;
  preview.requestVideoFrameCallback((_now, meta) => {
    lastFrameMediaMs = meta.mediaTime * 1000;
    watchPreviewFrames();
  });
}

function onCameraLost() {
  if (!recorder) return;
  el('live-note').textContent = 'The camera stopped — a call, or another app took it. Reload the page.';
  stopRecorder('discard');
  screenIs('idle');
}

// ------------------------------------------------------------------- filming

/**
 * The first container this device will actually record.
 *
 * Safari records MP4 and will not touch WebM; everything else is the other way
 * round. Asking in order and taking the first that answers avoids caring which
 * one we are on — and an empty string means "you choose", which is always
 * better than a mime type the browser has to refuse.
 */
function pickMimeType() {
  const wanted = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of wanted) {
    if (window.MediaRecorder?.isTypeSupported?.(type)) return type;
  }
  return '';
}

function startRecording() {
  chunks = [];
  marks = [];
  shownMs = null;

  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    // Four megabits rather than eight. At the size a phone screen shows this
    // the difference is invisible, and it halves what a long bout costs — a
    // minute of filming is about thirty megabytes rather than sixty.
    videoBitsPerSecond: 4_000_000,
  });
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = () => {
    if (onStopped === 'review') void finish();
  };

  // A timeslice, so the bytes arrive as the bout runs rather than in one lump
  // at the end — a long bout then has nothing to do when the fight stops.
  recorder.start(1000);
  startedAtWallMs = performance.now();
  startedAtFrameMs = lastFrameMediaMs;

  const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
  filmed = {
    shape: `${settings.width ?? '?'}×${settings.height ?? '?'}`,
    held: orientationNow(),
    clip: 'not stopped yet',
  };

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
 * The honest problem: there is a lag between asking for a recording and the
 * first frame actually being encoded, and nothing tells us how long it is. So
 * take both readings — the page's own clock and the camera's frame clock — and
 * let the review screen use whichever can be believed.
 */
function markAt() {
  if (!recorder || recorder.state !== 'recording' || marks.length >= MAX_MARKS) return;
  marks.push({
    wallMs: performance.now() - startedAtWallMs,
    frameMs:
      lastFrameMediaMs !== null && startedAtFrameMs !== null
        ? lastFrameMediaMs - startedAtFrameMs
        : null,
  });

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

function stopRecorder(then) {
  onStopped = then;
  clearInterval(ticker);
  keepAwake(false);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

// ------------------------------------------------------- moving between modes

function screenIs(name) {
  document.body.dataset['screen'] = name;
}

/** Stop filming and look at what was marked. */
function toReview() {
  if (marks.length === 0) return;
  stopRecorder('review');
}

/**
 * Straight back to filming, from the review screen.
 *
 * The bout being reviewed goes: it has been looked at, which is the whole
 * point of having been in here. No confirmation for that reason.
 */
function toRecord() {
  releaseClip();
  startRecording();
}

/**
 * Stop altogether.
 *
 * Asks first when there are marks, because marks that have not been reviewed
 * are the only thing in this app that cannot be got back, and END sits next to
 * REVIEW where a thumb could find the wrong one.
 */
function toIdle() {
  if (marks.length > 0) {
    const count = `${marks.length} mark${marks.length === 1 ? '' : 's'}`;
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
  stopRecorder('discard');
  releaseClip();
  marks = [];
  chunks = [];
  el('toReview').disabled = true;
  el('elapsed').textContent = '0:00';
  el('live-note').textContent = 'Point it at the fight, then press START.';
  renderDots();
  renderTapHint();
  screenIs('idle');
}

function releaseClip() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  clip.removeAttribute('src');
  durationMs = Number.POSITIVE_INFINITY;
}

async function finish() {
  const blob = new Blob(chunks, { type: recorder.mimeType || 'video/mp4' });
  blobBytes = blob.size;
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  clip.src = blobUrl;

  await measureDuration();
  filmed.clip = `${clip.videoWidth}×${clip.videoHeight}`;
  renderTabs();
  select(0);
  screenIs('review');
}

/**
 * How long the recording turned out to be.
 *
 * A file a browser is still writing carries no duration, so `duration` is
 * Infinity until the blob has been scanned — and it is only scanned when
 * something asks to seek past the end. Waiting for a duration before seeking
 * deadlocks; asking for an impossible position resolves it in milliseconds.
 */
function measureDuration() {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled || !Number.isFinite(clip.duration) || clip.duration <= 0) return;
      settled = true;
      durationMs = clip.duration * 1000;
      resolve();
    };
    const giveUp = () => {
      if (settled) return;
      settled = true;
      // Better a window that ends where the footage does than one that cannot
      // be computed at all.
      const seekable = clip.seekable.length ? clip.seekable.end(clip.seekable.length - 1) : 0;
      durationMs = seekable > 0 ? seekable * 1000 : (marks.at(-1)?.wallMs ?? 0) + tailMs;
      resolve();
    };

    clip.addEventListener('durationchange', done);
    clip.addEventListener(
      'loadedmetadata',
      () => {
        if (Number.isFinite(clip.duration)) return done();
        clip.currentTime = 1e6;
      },
      { once: true }
    );
    setTimeout(giveUp, 4000);
  });
}

// ----------------------------------------------------------------- reviewing

function markMs(mark) {
  return markSource === 'frame' && frameClockUsable(marks) ? mark.frameMs : mark.wallMs;
}

function renderTabs() {
  const tabs = el('tabs');
  tabs.innerHTML = '';
  marks.forEach((_mark, index) => {
    const button = document.createElement('button');
    button.textContent = String(index + 1);
    button.className = index === current ? 'on' : '';
    button.addEventListener('click', () => select(index));
    tabs.append(button);
  });
}

/**
 * Show a mark. Instant, because it is one recording already loaded — switching
 * marks is a seek, not a load.
 */
function select(index) {
  current = index;
  window_ = windowFor({ atMs: markMs(marks[index]), leadMs, tailMs, durationMs });
  el('shortfall').textContent = shortfallLabel(window_) ?? '';
  renderTabs();
  // Land on the moment that was marked, not on the start of the run-up.
  seekTo(window_.atMs);
}

function seekTo(ms) {
  positionMs = clampWithin(ms, window_);
  clip.currentTime = positionMs / 1000;
  renderPosition();
  watchShownFrame();
}

/** Everything that says where in the window the footage is. */
function renderPosition() {
  const relative = (positionMs - window_.atMs) / 1000;
  el('readout').textContent = `${relative >= 0 ? '+' : ''}${relative.toFixed(2)}s`;
  const span = window_.endMs - window_.startMs;
  const through = span > 0 ? (positionMs - window_.startMs) / span : 0;
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
 * Relative to where the footage already was, not to where the thumb landed: an
 * absolute mapping would jump the picture the instant it was touched, and the
 * instant it is touched is the moment somebody is trying to look at it.
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
  if (!event.buttons) return;
  const width = el('stage').clientWidth || 1;
  seekTo(
    draggedTo({
      fromMs: draggingFromMs,
      acrossFraction: (event.clientX - draggingFromX) / width,
      window: window_,
    })
  );
}

// ---------------------------------------------------------------- the trimmings

function renderDots() {
  const dots = el('dots');
  dots.innerHTML = '';
  for (let index = 0; index < MAX_MARKS; index += 1) {
    const dot = document.createElement('i');
    if (index < marks.length) dot.className = 'on';
    dots.append(dot);
  }
}

function renderTapHint() {
  el('tapHint').textContent =
    marks.length >= MAX_MARKS ? `all ${MAX_MARKS} marks used` : 'tap anywhere to mark';
}

function tickElapsed() {
  const seconds = Math.floor((performance.now() - startedAtWallMs) / 1000);
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
  if (document.visibilityState === 'visible' && recorder?.state === 'recording') keepAwake(true);
});

// --------------------------------------------------------------- diagnostics

function renderDiagnostics() {
  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  const usingCameraClock = markSource === 'frame' && frameClockUsable(marks);

  el('diag-body').innerHTML =
    `<h2>device</h2>` +
    `Solo ${VERSION}\n${navigator.userAgent}\n` +
    `<h2>camera</h2>` +
    `${settings.width ?? '?'}×${settings.height ?? '?'} at ${settings.frameRate ?? '?'} fps\n` +
    `one frame is ${Math.round(frameMs)} ms\n` +
    `recorded as ${recorder?.mimeType || pickMimeType() || '(browser default)'}\n` +
    `<h2>recording</h2>` +
    `${(blobBytes / 1e6).toFixed(1)} MB, ${Number.isFinite(durationMs) ? (durationMs / 1000).toFixed(2) + ' s' : 'duration unknown'}\n` +
    `<h2>which way up</h2>` +
    `camera gave   ${filmed.shape}\n` +
    `phone held    ${filmed.held}\n` +
    `file came out ${filmed.clip}\n` +
    `phone now     ${orientationNow()}\n` +
    `showing ${shownMs === null ? '—' : (shownMs / 1000).toFixed(3) + ' s'}\n` +
    `<h2>marks — page clock vs camera clock</h2>` +
    (marks.length
      ? marks
          .map(
            (mark, index) =>
              `${index + 1}: wall ${(mark.wallMs / 1000).toFixed(3)}s   ` +
              `frame ${mark.frameMs === null ? '—' : (mark.frameMs / 1000).toFixed(3) + 's'}`
          )
          .join('\n')
      : 'none yet') +
    `\nplacing the marks by the <b>${usingCameraClock ? 'camera' : 'page'}</b> clock\n` +
    (frameClockUsable(marks)
      ? `<button id="diag-flip">use the ${markSource === 'frame' ? 'page' : 'camera'} clock instead</button>\n`
      : 'the camera clock never ran on this device, so it is ignored\n') +
    `<h2>what this device has</h2>` +
    `MediaRecorder        ${!!window.MediaRecorder}\n` +
    `frame callbacks      ${!!preview.requestVideoFrameCallback}\n` +
    `wake lock            ${!!navigator.wakeLock}\n` +
    `WebCodecs encoder    ${!!window.VideoEncoder}\n` +
    `ManagedMediaSource   ${!!window.ManagedMediaSource}\n`;

  el('diag-flip')?.addEventListener('click', () => {
    markSource = markSource === 'frame' ? 'wall' : 'frame';
    if (document.body.dataset['screen'] === 'review') select(current);
    renderDiagnostics();
  });
}

function showDiagnostics() {
  renderDiagnostics();
  el('diag').hidden = false;
}

// ------------------------------------------------- getting it onto a phone

/**
 * Hand this app to somebody else's phone.
 *
 * The native share sheet rather than anything of our own: on an iPhone that
 * means AirDrop to the referee standing next to you, and on anything else it
 * means whatever they already message each other with. Nothing to install, and
 * the app is a link — so "I'll send it to you" is literally true.
 */
async function shareApp() {
  const url = location.href.split(/[?#]/)[0];
  try {
    if (navigator.share) {
      await navigator.share({ title: 'VideoReferee Solo', text: 'Film a bout, mark the moments, look at them again.', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    el('live-note').textContent = 'Link copied — paste it to whoever needs it.';
  } catch {
    // Sharing refused or cancelled. Showing the address is still an answer.
    el('live-note').textContent = url;
  }
}

/** Keep working when the signal does not. See sw.js. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------------------------------------------------------------------- wiring

el('start').addEventListener('click', startRecording);
el('toReview').addEventListener('click', toReview);
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

el('info').addEventListener('click', showDiagnostics);
el('share').addEventListener('click', shareApp);
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
    if (marks.length && document.body.dataset['screen'] === 'review') select(current);
  });
}

el('version').textContent = VERSION;
renderDots();
renderTapHint();
openCamera().catch((error) => {
  el('live-note').textContent = `No camera: ${error.name}. It needs https and permission.`;
  el('start').disabled = true;
});
