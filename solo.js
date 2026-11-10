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
import { cut, durationOf, withHit, withoutLastHit, withPoint } from './app/bout/exchange.js';
import { drawHits, pictureIn, toFrame } from './app/render/hits.js';
import { isChosen, pointsOnly, showing, toggled } from './app/bout/selection.js';
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
import { canRecordReel, recordReel } from './app/render/record-reel.js';
import { reelFilename, reelLengthMs } from './app/render/reel.js';

const VERSION = '1.1.18';

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
  leaveExchange();
  if (!bout) bout = newBout(crypto.randomUUID(), new Date().toISOString());
  shownMs = null;
  capture.start();
  recordingStartedAt = performance.now();
  heldAtStart = orientationNow();
  hasFilmed = true;

  screenIs('recording');
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
}

/** Finish the exchange being filmed and add it to the bout. */
async function finishExchange() {
  exchange = await capture.finish(markSource);
  bout = withExchange(bout, exchange);
  return exchange;
}

// ------------------------------------------------------- moving between modes

function screenIs(name) {
  document.body.dataset['screen'] = name;
}

/** Stop filming and look at what was marked in this exchange. */
async function toReview() {
  if (capture.markCount === 0) return;
  stopFilming();

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
  startFilming();
}

/**
 * The bout is over: on to the summary.
 *
 * Whatever is being filmed becomes the last exchange if anything was marked in
 * it, and is let go of if nothing was. With no exchanges at all there is
 * nothing to sum up, and it is straight back to idle.
 */
async function toSummary() {
  stopFilming();
  if (capture.markCount > 0) await finishExchange();
  else await capture.discard();

  if (!bout || bout.exchanges.length === 0) return endBout();
  openSummary();
}

/** Ask before throwing a bout away — its footage cannot be got back. */
function askToEndBout() {
  const exchanges = bout?.exchanges.length ?? 0;
  el('confirm-title').textContent = 'End this bout?';
  el('confirm-text').textContent =
    `Its ${exchanges} exchange${exchanges === 1 ? '' : 's'} will be gone. ` +
    'Save the video first if you want one — this cannot be undone.';
  el('confirm').hidden = false;
}

/** Let the whole bout go, and go back to idle. */
function endBout() {
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
  paintPoints();
  // 'nearest' on both axes: enough to bring it into the strip, not enough to
  // scroll the screen underneath it.
  tabs[current]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * Show a mark. Instant, because it is one recording already loaded — switching
 * marks is a seek, not a load.
 */
function select(index) {
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
  if (picture) drawHits(paper, span.hits, positionMs, picture);
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
  if (!placing || !from) return;
  if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 8) return;
  placeHit(event.clientX, event.clientY);
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

// --------------------------------------------------------- giving points

/**
 * Each mark's point shown where it was given: the tab filled with the
 * fighter's colour, and the POINT button saying who has the mark on screen.
 */
function paintPoints() {
  const marks = exchange?.marks ?? [];
  [...el('tabs').children].forEach((button, index) => {
    const point = marks[index]?.point;
    button.classList.toggle('red', point === 'red');
    button.classList.toggle('blue', point === 'blue');
  });
  const point = marks[current]?.point ?? null;
  el('point').textContent = point ? point.toUpperCase() : 'POINT';
  el('point').classList.toggle('red', point === 'red');
  el('point').classList.toggle('blue', point === 'blue');
}

function askForPoint() {
  if (!exchange?.marks[current]) return;
  el('pick-title').textContent = `Point for mark ${current + 1}`;
  el('pick-point').hidden = false;
}

/**
 * Give the mark on screen to red or blue, or take its point away.
 *
 * The exchange on screen and the bout holding it are both updated: the
 * summary reads the bout, and that is where the points have to have landed.
 */
function givePoint(side) {
  const mark = exchange?.marks[current];
  el('pick-point').hidden = true;
  if (!mark) return;
  exchange = withPoint(exchange, mark.id, side);
  bout = withExchangeReplaced(bout, exchange);
  paintPoints();
  startPlacing(side ?? 'red');
}

// --------------------------------------------------------- placing hits

/**
 * Placing hits on the mark on screen, after its point is given.
 *
 * Any number, each in the colour chosen on the bar — a double where both
 * fighters land is two hits, whoever got the point. Dragging still moves
 * through the moment, so the hit goes in at the frame it landed on. Undo takes
 * back the last one; Done ends it.
 */
let placing = false;
let placingSide = 'red';

function startPlacing(side) {
  placing = true;
  document.body.classList.add('placing');
  choosePlacingSide(side);
  el('placing').hidden = false;
  showPlacingCount();
}

function stopPlacing() {
  placing = false;
  document.body.classList.remove('placing');
  el('placing').hidden = true;
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
const behind = el('behind');
let selection = null;
/** The stretch the background is looping, or null when it is not. */
let behindSpan = null;
/** Which recording the background holds, so it is not reloaded needlessly. */
let behindTake = null;
/** Exchanges whose sections the referee has folded away. */
const folded = new Set();

function openSummary() {
  // The marks given a point are what the bout turned on, so they start ticked.
  selection = pointsOnly(bout);
  folded.clear();
  renderPicks();
  screenIs('export');
  playBehind();
}

/** BACK from the summary: the bout is not over after all. */
function carryOn() {
  stopBehind();
  startFilming();
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
      if (mark.point) {
        const side = document.createElement('span');
        side.className = `side ${mark.point}`;
        side.textContent = mark.point === 'red' ? 'Red' : 'Blue';
        label.append(side);
      }
      label.append(at);
      row.append(label);
      marks.append(row);
    });

    section.append(heading, marks);
    item.append(section);
    picks.append(item);
  });

  const chosen = selection.chosen.length;
  const total = bout.exchanges.reduce((sum, each) => sum + each.marks.length, 0);
  const plan = cutBout(bout, selection.chosen, { leadMs, tailMs });
  el('export-length').textContent =
    (chosen
      ? `${chosen} of ${total} mark${total === 1 ? '' : 's'} · ${(reelLengthMs(plan) / 1000).toFixed(1)}s`
      : 'Nothing chosen') + ` · ${(boutBytes() / 1e6).toFixed(0)} MB held`;
  el('export-save').disabled = chosen === 0 || !canRecordReel();
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
    if (behind.requestVideoFrameCallback) behind.requestVideoFrameCallback(check);
    else requestAnimationFrame(check);
  };
  check();
}

function stopBehind() {
  behindSpan = null;
  behind.pause();
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
    media.release(ready.footage);
    ready = null;
  }
  el('saving-share').hidden = true;
  el('saving-download').hidden = true;
  el('saving-download').removeAttribute('href');
  el('saving').hidden = true;
  el('saving-stop').textContent = 'Stop';
  if (document.body.dataset['screen'] === 'export') playBehind();
}

async function saveReel() {
  if (!bout || !selection || selection.chosen.length === 0 || saving) return;

  const chosen = selection.chosen;
  const plan = cutBout(bout, chosen, { leadMs, tailMs });
  // The background would be decoding alongside the recording for nothing.
  stopBehind();
  const totalMs = reelLengthMs(plan);

  saving = new AbortController();
  const stopped = saving.signal;
  el('saving-text').textContent =
    'It plays them through to record them, so it takes as long as they last.';
  el('saving-stop').textContent = 'Stop';
  el('saving').hidden = false;
  showSavingProgress(0, totalMs);

  let footage = null;
  try {
    footage = await recordReel(
      plan,
      {
        video: clip,
        canvas: el('reel'),
        urlFor: (takeId) => {
          const footage = takeFootage(takeId);
          return footage ? media.urlOf(footage) : null;
        },
      },
      { onProgress: showSavingProgress, signal: stopped }
    );
  } catch (error) {
    saving = null;
    if (stopped.aborted) return closeSaving();
    // Left open, with what went wrong on it. Saving is the one thing here that
    // can fail for reasons the referee cannot see.
    el('saving-title').textContent = 'Could not save it';
    el('saving-text').textContent = error?.message ?? String(error);
    el('saving-stop').textContent = 'Close';
    return;
  }

  saving = null;
  offerReel(footage, chosen);
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
  const file = new File([bytes], name, { type: bytes.type });
  ready = { footage, file, name };

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
    download.href = media.urlOf(footage);
    download.download = name;
  }
  el('saving-stop').textContent = 'Done';
}

/** Runs inside the tap on Share, which is what lets the phone open the sheet. */
async function shareReady() {
  if (!ready) return;
  try {
    await navigator.share({ files: [ready.file], title: ready.name });
    closeSaving();
  } catch (error) {
    // Closing the share sheet without choosing anything is not a failure, and
    // Share stays where it is for another go.
    if (error?.name === 'AbortError') return;
    el('saving-text').textContent = `Could not share it: ${error?.message ?? String(error)}`;
  }
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
    // nothing of points. That is safe only because this panel is reached from
    // idle, between bouts; were it ever reachable mid-bout, points would need
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
el('hit-done').addEventListener('click', stopPlacing);
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
el('point').addEventListener('click', askForPoint);
el('give-red').addEventListener('click', () => givePoint('red'));
el('give-blue').addEventListener('click', () => givePoint('blue'));
el('give-none').addEventListener('click', () => givePoint(null));
el('pick-cancel').addEventListener('click', () => {
  el('pick-point').hidden = true;
});
el('export-end').addEventListener('click', askToEndBout);
el('export-save').addEventListener('click', () => void saveReel());
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
