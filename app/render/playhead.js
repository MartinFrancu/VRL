// Layer 3, the pure half — where the playhead is within a span, and what moves
// it there.
//
// Kept apart from the video element for the same reason as the clock: it is
// arithmetic, and a sign error in it is invisible on a screen. The footage
// would look perfectly real, just of the wrong moment.
//
// Nothing here plays anything, seeks anything or knows what a frame looks like.
// It answers "given a span and a gesture, which millisecond?" and the sink does
// the rest.
/** Keep a position inside its span. */
export function clampWithin(positionMs, span) {
    return Math.max(span.fromMs, Math.min(positionMs, span.toMs));
}
/**
 * Where a drag across the picture lands.
 *
 * Relative to where the footage already was, not to where the thumb went down:
 * an absolute mapping would teleport the picture the instant it was touched,
 * which is exactly the moment the referee is trying to look at something.
 *
 * The full width of the picture spans the whole window, so everything is in
 * reach in one gesture — on a phone that works out finer than a frame per
 * pixel, which is as much precision as there is to have.
 */
export function draggedTo({ fromMs, acrossFraction, span, }) {
    return clampWithin(fromMs + acrossFraction * (span.toMs - span.fromMs), span);
}
/**
 * One frame at a time.
 *
 * `frames` may be negative. The step is whatever the camera's frame rate makes
 * it, because a position between two frames shows the earlier one and stepping
 * by less than a frame would look like nothing happening.
 */
export function steppedBy(positionMs, frames, frameMs, span) {
    return clampWithin(positionMs + frames * frameMs, span);
}
/**
 * What the readout says, counted from the marked moment.
 *
 * Zero is the mark, not the start of the run-up — the referee wants to know how
 * long after the thing they marked they are looking, and before it is negative.
 */
export function readoutFor(positionMs, span) {
    const relative = (positionMs - span.atMs) / 1000;
    return `${relative >= 0 ? '+' : ''}${relative.toFixed(2)}s`;
}
/** How far through the span the playhead is, from 0 to 1, for a progress bar. */
export function progressThrough(positionMs, span) {
    const width = span.toMs - span.fromMs;
    if (width <= 0)
        return 0;
    return (positionMs - span.fromMs) / width;
}
/**
 * What to say about a span that did not get everything it asked for.
 *
 * Only ever about the tail. A mark near the start of a recording is
 * self-evidently near the start, but a fight stopped a moment after a mark
 * gives a span that ends mid-movement, and that is worth saying out loud rather
 * than leaving to look like a fault.
 */
export function shortfallLabel(span, { noticeAboveMs = 100 } = {}) {
    if (span.shortTailMs <= noticeAboveMs)
        return null;
    return `stopped ${(span.shortTailMs / 1000).toFixed(1)}s after this mark`;
}
//# sourceMappingURL=playhead.js.map