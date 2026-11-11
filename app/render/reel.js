// Layer 3, the pure half of saving a bout's marked moments as one video.
//
// A reel is a Cut sent to a file instead of to the screen. Everything about
// *which* stretches and *in what order* is already answered by `cut()` in the
// Bout layer; what is left here is arithmetic and a name.
//
// The recording itself — a canvas, a stream, an encoder — is the browser's
// half and lives in `record-reel.ts`.
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
export function reelLengthMs(cut, introMs = 0) {
    if (cut.spans.length === 0)
        return 0;
    return introMs + cut.spans.reduce((total, span) => total + Math.max(0, span.toMs - span.fromMs), 0);
}
/** What a browser will call the container this device recorded. */
function extensionFor(mimeType) {
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
export function reelFilename(startedAt, moments, mimeType = 'video/mp4') {
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
 * Where the logo goes in a saved video of this size: the bottom-left corner,
 * sized by the shorter side so portrait and landscape get the same logo.
 * `aspect` is the logo's own width over its height.
 */
export function watermarkBox(width, height, aspect = 1) {
    const shorter = Math.min(width, height);
    const size = shorter * WATERMARK_SIZE;
    const margin = shorter * WATERMARK_MARGIN;
    return { left: margin, top: height - margin - size, width: size * aspect, height: size };
}
/** How long the full logo holds alone in the middle before the first moment. */
export const INTRO_HOLD_MS = 1000;
/** How long it then takes to shrink into its corner, over the first moment. */
export const INTRO_GLIDE_MS = 500;
/** How big it starts, as a share of the picture's shorter side. */
export const INTRO_SIZE = 0.6;
/**
 * Where the logo is, and how solid, this long after the saved video starts.
 *
 * Alone in the middle, large and solid, for the hold; then gliding — eased, so
 * it settles rather than stops — into the corner `watermarkBox` gives, where it
 * stays for the rest of the video at its usual see-through strength.
 */
export function logoAt(sinceStartMs, width, height, aspect = 1) {
    const corner = watermarkBox(width, height, aspect);
    const size = Math.min(width, height) * INTRO_SIZE;
    const middle = {
        left: (width - size * aspect) / 2,
        top: (height - size) / 2,
        width: size * aspect,
        height: size,
    };
    const through = Math.min(1, Math.max(0, (sinceStartMs - INTRO_HOLD_MS) / INTRO_GLIDE_MS));
    if (through === 0)
        return { ...middle, opacity: 1 };
    if (through === 1)
        return { ...corner, opacity: WATERMARK_OPACITY };
    const eased = 1 - (1 - through) ** 3;
    const between = (from, to) => from + (to - from) * eased;
    return {
        left: between(middle.left, corner.left),
        top: between(middle.top, corner.top),
        width: between(middle.width, corner.width),
        height: between(middle.height, corner.height),
        opacity: between(1, WATERMARK_OPACITY),
    };
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
export function fadeAt(positionMs, span, fadeMs = FADE_MS) {
    if (positionMs <= span.fromMs || positionMs >= span.toMs)
        return fadeMs > 0 ? 0 : 1;
    if (fadeMs <= 0)
        return 1;
    const sinceStart = positionMs - span.fromMs;
    const untilEnd = span.toMs - positionMs;
    return Math.min(1, sinceStart / fadeMs, untilEnd / fadeMs);
}
//# sourceMappingURL=reel.js.map