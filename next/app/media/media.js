// Layer 0 — the codec boundary.
//
// Everything that knows a container format, a mime type or how bytes become
// pictures lives here and nowhere else. Above this file, footage is a
// `MediaHandle`: a token with no readable fields, so nothing can learn whether
// this bout is mp4 or webm, let alone depend on it.
//
// That is what makes swapping a codec a one-layer change. It is also the reason
// this layer is deliberately the thinnest thing that works: there is no case
// for a general media abstraction until something actually needs a second
// codec, and `docs/architecture.md` keeps it last in the order for that reason.
const asHandle = (footage) => footage;
const asFootage = (handle) => handle;
/**
 * The containers to try, best first.
 *
 * Safari records mp4 and will not touch webm; everything else is the other way
 * round. Asking in order and taking the first that answers avoids caring which
 * browser this is.
 */
const CONTAINERS = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
];
/**
 * The first container this device will actually record.
 *
 * An empty string means "you choose", which is always better than handing the
 * browser a mime type it has to refuse.
 *
 * `isSupported` is injected so the preference order can be tested without a
 * browser; in the app it is `MediaRecorder.isTypeSupported`.
 */
export function preferredMimeType(isSupported) {
    return CONTAINERS.find((type) => isSupported(type)) ?? '';
}
/** What the running browser will record. */
export function mimeTypeHere() {
    const supports = globalThis.MediaRecorder?.isTypeSupported;
    if (!supports)
        return '';
    return preferredMimeType((type) => supports(type));
}
/**
 * Start writing a stream to a file the browser assembles itself.
 *
 * Eight megabits. Four was half the size and visibly worse — fast motion at
 * 1080p is where a codec spends everything it is given, and a knife fight is
 * nothing but fast motion.
 *
 * A one-second timeslice, so the bytes arrive as the bout runs rather than in
 * one lump at the end; a long bout then has nothing to do when the fight stops.
 */
export function record(stream, { bitsPerSecond = 8_000_000 } = {}) {
    const mimeType = mimeTypeHere();
    const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: bitsPerSecond,
    });
    const parts = [];
    recorder.ondataavailable = (event) => {
        if (event.data.size)
            parts.push(event.data);
    };
    recorder.start(1000);
    return {
        mimeType: recorder.mimeType || mimeType,
        stop: () => new Promise((resolve) => {
            const assemble = () => {
                const blob = new Blob(parts, { type: recorder.mimeType || mimeType || 'video/mp4' });
                resolve(asHandle({ blob, url: URL.createObjectURL(blob) }));
            };
            if (recorder.state === 'inactive')
                return assemble();
            recorder.onstop = assemble;
            recorder.stop();
        }),
    };
}
/** Where a player can load this footage from. */
export function urlOf(handle) {
    return asFootage(handle).url;
}
/** How big the file turned out, for the diagnostics panel. */
export function sizeOf(handle) {
    return asFootage(handle).blob.size;
}
/** The bytes themselves — for Store, which has to put them somewhere. */
export function bytesOf(handle) {
    return asFootage(handle).blob;
}
/** Give back the memory behind a handle. Nothing may use it afterwards. */
export function release(handle) {
    URL.revokeObjectURL(asFootage(handle).url);
}
/**
 * How long a recording turned out to be.
 *
 * A file a browser is still writing carries no duration, so `duration` reads
 * Infinity until the blob has been scanned — and it is only scanned when
 * something asks to seek past the end. Waiting for a duration before seeking
 * deadlocks; asking for an impossible position resolves it in milliseconds.
 *
 * This is one of the few genuinely load-bearing device quirks in the app. It
 * moved here with its reasoning rather than being rewritten.
 */
export function measureDurationMs(video, { fallbackMs = 0, giveUpAfterMs = 4000 } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        const answer = (ms) => {
            if (settled)
                return;
            settled = true;
            listening.abort();
            resolve(ms);
        };
        const fromDuration = () => {
            if (!Number.isFinite(video.duration) || video.duration <= 0)
                return;
            answer(video.duration * 1000);
        };
        const giveUp = () => {
            // Better a length that ends where the footage does than none at all.
            const seekable = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : 0;
            answer(seekable > 0 ? seekable * 1000 : fallbackMs);
        };
        // Both come off together once the answer is in, or every bout of an
        // afternoon would leave another pair behind on the same element.
        const listening = new AbortController();
        video.addEventListener('durationchange', fromDuration, { signal: listening.signal });
        video.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(video.duration))
                return fromDuration();
            video.currentTime = 1e6;
        }, { signal: listening.signal });
        setTimeout(giveUp, giveUpAfterMs);
    });
}
//# sourceMappingURL=media.js.map