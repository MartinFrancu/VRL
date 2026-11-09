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
import { record, release } from '../media/media.js';
import { reelLengthMs } from './reel.js';
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
export async function recordReel(cut, { video, canvas }, { onProgress, fps = 30, signal } = {}) {
    if (cut.spans.length === 0)
        throw new Error('nothing was marked, so there is nothing to save');
    if (!canRecordReel())
        throw new Error('this device cannot record video from a canvas');
    const totalMs = reelLengthMs(cut);
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const paper = canvas.getContext('2d');
    if (!paper)
        throw new Error('no canvas to draw on');
    // Paint continuously for the whole export rather than per stretch, so the
    // stream never goes quiet between them — a gap would land in the file.
    let painting = true;
    const paint = () => {
        if (!painting)
            return;
        paper.drawImage(video, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(paint);
    };
    const wasMuted = video.muted;
    const wasAt = video.currentTime;
    video.muted = true;
    const stream = canvas.captureStream(fps);
    paint();
    const recording = record(stream, { bitsPerSecond: 6_000_000 });
    let handedOver = false;
    try {
        let doneMs = 0;
        for (const span of cut.spans) {
            if (signal?.aborted)
                throw new Error('saving was stopped');
            await seekTo(video, span.fromMs / 1000);
            await video.play();
            const until = span.toMs / 1000;
            while (video.currentTime < until && !video.ended) {
                if (signal?.aborted)
                    break;
                onProgress?.(doneMs + Math.max(0, video.currentTime * 1000 - span.fromMs), totalMs);
                await nextFrame();
            }
            video.pause();
            doneMs += Math.max(0, span.toMs - span.fromMs);
            onProgress?.(doneMs, totalMs);
            if (signal?.aborted)
                throw new Error('saving was stopped');
        }
        handedOver = true;
        return await recording.stop();
    }
    finally {
        // A recorder left running holds the stream and keeps filling memory with
        // footage nobody asked for, and the half-written file behind it is a blob
        // URL that would never be given back.
        if (!handedOver) {
            await recording
                .stop()
                .then(release)
                .catch(() => { });
        }
        painting = false;
        for (const track of stream.getTracks())
            track.stop();
        video.pause();
        video.muted = wasMuted;
        // Put the playhead back where the referee had it, so saving does not move
        // the picture out from under them.
        await seekTo(video, wasAt).catch(() => { });
    }
}
//# sourceMappingURL=record-reel.js.map