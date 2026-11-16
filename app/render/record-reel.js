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
import { measureDurationMs, record, release } from '../media/media.js';
import { SIDE_COLOURS, drawHits } from './hits.js';
import { FADE_MS, SPOTLIGHT, WATERMARK_OPACITY, endCardAt, endTitleLayout, endLogoBox, endingMs, loopLogoAt, fadeAt, hitTally, labelLayout, labelStrengthAt, numbersLayout, reelLengthMs, titleLines, watermarkBox, } from './reel.js';
/**
 * Whether this device can save a video at all.
 *
 * Worth asking before offering the button, because this is exactly the kind of
 * thing that works on a desktop and not on a phone.
 */
export function canRecordReel() {
    return (typeof MediaRecorder !== 'undefined' &&
        typeof HTMLCanvasElement !== 'undefined' &&
        typeof HTMLCanvasElement.prototype.captureStream === 'function');
}
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
/**
 * Put another recording into the player, and wait until it can be sought.
 *
 * A recorder's file says nothing of its own length until something asks to
 * seek past the end, so it is measured on the way in — the same trick the
 * review screen relies on. The measuring has to be listening before the new
 * source is set, or the moment it is waiting for has already gone by.
 */
async function loadInto(video, url) {
    const measured = measureDurationMs(video, { giveUpAfterMs: 3000 });
    video.src = url;
    video.load();
    await measured;
}
function seekTo(video, seconds) {
    return new Promise((resolve) => {
        if (Math.abs(video.currentTime - seconds) < 0.001)
            return resolve();
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
export async function recordReel(cut, { video, canvas, urlFor, watermark }, { onProgress, fps = 30, signal, fadeMs = FADE_MS, title } = {}) {
    if (cut.spans.length === 0)
        throw new Error('nothing was marked, so there is nothing to save');
    if (!canRecordReel())
        throw new Error('this device cannot record video from a canvas');
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
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const paper = canvas.getContext('2d');
    if (!paper)
        throw new Error('no canvas to draw on');
    // Paint continuously for the whole export rather than per stretch, so the
    // stream never goes quiet between them — a gap would land in the file.
    //
    // Each frame goes down over black at the brightness `fadeAt` says, which is
    // what makes the dip at every join. Between stretches, while the next one is
    // being sought, there is no stretch at all and the frame is plain black —
    // otherwise the seek would show up as a flash of wherever the clip landed.
    let painting = true;
    let playing = null;
    /** When the ending began, once the last moment has played; null before. */
    let endingSince = null;
    // The video's first picture, kept without the corner logo: the way back at
    // the very end comes up on it, so the last frame is the first.
    const firstFrame = document.createElement('canvas');
    firstFrame.width = canvas.width;
    firstFrame.height = canvas.height;
    let keptFirst = null;
    const firstKept = new Promise((resolve) => (keptFirst = resolve));
    const paint = () => {
        if (!painting)
            return;
        paper.globalAlpha = 1;
        const nowMs = video.currentTime * 1000;
        // The last moment fades out into the ending's ground rather than black,
        // so footage gives way to the cards without a dip in between.
        const leaving = endMs > 0 && playing !== null && playing === last && nowMs >= (playing.fromMs + playing.toMs) / 2;
        if (endingSince !== null || leaving)
            drawSpotlight(paper);
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
            paper.globalAlpha = strength;
            paper.drawImage(video, 0, 0, canvas.width, canvas.height);
            paper.globalAlpha = 1;
            // The hits in this stretch, by the same drawHits the review screen uses,
            // over the whole frame — and as faded as the stretch is, so a hit near a
            // join dips to black with everything else.
            if (playing.hits?.length) {
                drawHits(paper, playing.hits, nowMs, { left: 0, top: 0, width: canvas.width, height: canvas.height }, strength);
            }
            // Which exchange this is, over the first moment of each — as faded as
            // the moment, so it dips at the join with everything else.
            if (playing.label) {
                const { x, y, fontPx } = labelLayout(canvas.width, canvas.height);
                drawCaption(paper, playing.label, { x, y, fontPx, maxWidth: canvas.width * 0.9 }, strength * labelStrengthAt(nowMs - playing.fromMs));
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
                if (words)
                    drawEndTitle(paper, words, cards.card);
                else if (hasNumbers)
                    drawNumbers(paper, tally, cards.card);
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
                }
                else {
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
    let loaded = null;
    paint();
    /** Taken from the canvas only once the first picture is on it — see below. */
    let stream = null;
    let recording = null;
    let handedOver = false;
    /** Load the recording a stretch is from, if it is not loaded, and find its start. */
    const findStart = async (span) => {
        const take = span.takes[0];
        if (urlFor && take && take !== loaded) {
            // Moving to another exchange's recording. The frame stays black while
            // it loads, the same as during any seek, so the switch is just a
            // slightly longer dip.
            const url = urlFor(take);
            if (!url)
                throw new Error(`no footage for recording ${take}`);
            await loadInto(video, url);
            loaded = take;
        }
        await seekTo(video, span.fromMs / 1000);
    };
    try {
        // Stand on the first picture before recording starts, so the video opens
        // on it rather than on black, and keep a copy of it for the end.
        if (first) {
            await findStart(first);
            playing = first;
            await Promise.race([firstKept, new Promise((resolve) => setTimeout(resolve, 2_000))]);
        }
        // The stream only now: one taken earlier holds the canvas as it was when
        // taken — empty — and that would be the file's first frame.
        stream = canvas.captureStream(fps);
        recording = record(stream, { bitsPerSecond: 6_000_000 });
        let doneMs = 0;
        for (const span of cut.spans) {
            if (signal?.aborted)
                throw new Error('saving was stopped');
            if (span !== first) {
                playing = null;
                await findStart(span);
            }
            playing = span;
            await video.play();
            const until = span.toMs / 1000;
            while (video.currentTime < until && !video.ended) {
                if (signal?.aborted)
                    break;
                onProgress?.(doneMs + Math.max(0, video.currentTime * 1000 - span.fromMs), totalMs);
                await nextFrame();
            }
            video.pause();
            playing = null;
            doneMs += Math.max(0, span.toMs - span.fromMs);
            onProgress?.(doneMs, totalMs);
            if (signal?.aborted)
                throw new Error('saving was stopped');
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
    }
    finally {
        // A recorder left running holds the stream and keeps filling memory with
        // footage nobody asked for, and the half-written file behind it is a blob
        // URL that would never be given back.
        if (!handedOver && recording) {
            await recording
                .stop()
                .then(release)
                .catch(() => { });
        }
        painting = false;
        for (const track of stream?.getTracks() ?? [])
            track.stop();
        video.pause();
        video.muted = wasMuted;
        // Put the player back as it was — the recording it held, and where its
        // playhead was — so saving does not move the picture out from under anyone.
        if (urlFor && video.getAttribute('src') !== wasSource) {
            if (wasSource)
                await loadInto(video, wasSource).catch(() => { });
            else {
                video.removeAttribute('src');
                video.load();
            }
        }
        if (wasSource)
            await seekTo(video, wasAt).catch(() => { });
    }
}
/**
 * Words over the footage — the title, an exchange's label — white with a dark
 * edge so they read over anything, made smaller if they would not otherwise
 * fit across the picture.
 */
function drawCaption(paper, words, { x, y, fontPx, maxWidth }, strength) {
    if (strength <= 0)
        return;
    const font = (px) => `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
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
 * The ending's ground: charcoal, lit softly in the middle. Neutral, so it
 * neither flashes in a dark-mode feed nor sinks in a light one.
 */
function drawSpotlight(paper) {
    const { width, height } = paper.canvas;
    const light = paper.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.02, width / 2, height / 2, Math.max(width, height) * 0.6);
    light.addColorStop(0, SPOTLIGHT.centre);
    light.addColorStop(1, SPOTLIGHT.edge);
    paper.fillStyle = light;
    paper.fillRect(0, 0, width, height);
}
/**
 * The title on the end card, white, on one line or two, made smaller only if
 * even two lines would not fit across the picture.
 */
function drawEndTitle(paper, words, strength) {
    const { width, height } = paper.canvas;
    const { x, y, fontPx, maxWidth } = endTitleLayout(width, height);
    const font = (px) => `800 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
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
function drawNumbers(paper, tally, strength) {
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
//# sourceMappingURL=record-reel.js.map