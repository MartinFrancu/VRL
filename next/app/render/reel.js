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
export function reelLengthMs(cut) {
    return cut.spans.reduce((total, span) => total + Math.max(0, span.toMs - span.fromMs), 0);
}
/** What a browser will call the container this device recorded. */
function extensionFor(mimeType) {
    return mimeType.includes('webm') ? 'webm' : 'mp4';
}
/**
 * What the saved video is called.
 *
 * The date leads, so a phone with an afternoon of these on it sorts them into
 * the order the bouts happened in. Then how many moments are in it, which is
 * the only other thing worth knowing from a list.
 *
 * Kept to letters, digits, spaces, hyphens and dots. It goes to a share sheet
 * and from there to who knows what — a filesystem, a chat app, a cloud drive —
 * and none of them should have to flinch at it.
 */
export function reelFilename(bout, mimeType = 'video/mp4') {
    const day = bout.filmedAt.slice(0, 10);
    const when = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated';
    const count = bout.marks.length;
    return `${when} SBA ${count} mark${count === 1 ? '' : 's'}.${extensionFor(mimeType)}`;
}
//# sourceMappingURL=reel.js.map