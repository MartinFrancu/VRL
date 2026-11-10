// Layer 3 — where a hit is on the picture, and how it shows over time.
//
// Shared by the review screen, which draws hits over the picture as they are
// placed, and by the recorder, which draws them into the saved video. Both
// call `drawHits`, so what the referee sees while placing a hit is what ends
// up in the file.
/** How long before the moment of a hit the effect starts to show. */
export const HIT_LEAD_MS = 200;
/** How long after it the effect takes to fade away. */
export const HIT_TAIL_MS = 500;
/** The fighters' colours, as the canvas needs them. */
export const SIDE_COLOURS = { red: '#e05252', blue: '#3b82f6' };
/**
 * Where the picture actually is inside its box.
 *
 * A video shown "contain" keeps its shape, so it is centred with bars on two
 * sides wherever its shape and its box differ.
 */
export function pictureIn(box, video) {
    if (!(video.width > 0 && video.height > 0 && box.width > 0 && box.height > 0))
        return null;
    const scale = Math.min(box.width / video.width, box.height / video.height);
    const width = video.width * scale;
    const height = video.height * scale;
    return {
        left: box.left + (box.width - width) / 2,
        top: box.top + (box.height - height) / 2,
        width,
        height,
    };
}
/**
 * A tap on the screen, as a position on the video frame — or null where the
 * tap was on a bar, or the video has no size yet.
 */
export function toFrame(tap, box, video) {
    const picture = pictureIn(box, video);
    if (!picture)
        return null;
    const x = (tap.x - picture.left) / picture.width;
    const y = (tap.y - picture.top) / picture.height;
    if (x < 0 || x > 1 || y < 0 || y > 1)
        return null;
    return { x, y };
}
/** A position on the video frame, back on the screen. */
export function fromFrame(at, box, video) {
    const picture = pictureIn(box, video) ?? box;
    return { x: picture.left + at.x * picture.width, y: picture.top + at.y * picture.height };
}
/**
 * How a hit shows at a moment: how strongly, and how far it has grown.
 *
 * It comes up over the fifth of a second before the hit, is at its strongest
 * on the moment, and fades out over the half-second after — growing all the
 * while, so it reads as an impact spreading out rather than a dot blinking.
 * Null outside that window.
 */
export function hitEffectAt(positionMs, hit) {
    const since = positionMs - hit.atMs;
    if (since < -HIT_LEAD_MS || since > HIT_TAIL_MS)
        return null;
    const alpha = since < 0 ? 1 + since / HIT_LEAD_MS : 1 - since / HIT_TAIL_MS;
    const grow = (since + HIT_LEAD_MS) / (HIT_LEAD_MS + HIT_TAIL_MS);
    return { alpha, grow };
}
/**
 * Draw every hit showing at this moment, over a picture occupying `picture` on
 * the canvas.
 *
 * A ring in the fighter's colour that widens as it fades, around a dot that
 * stays put. A dark shadow keeps it readable on a bright picture as well as a
 * dark one. `strength` scales it all, so a hit fades with the stretch it is in.
 */
export function drawHits(paper, hits, positionMs, picture, strength = 1) {
    const unit = Math.min(picture.width, picture.height);
    for (const hit of hits) {
        const effect = hitEffectAt(positionMs, hit);
        if (!effect || strength <= 0)
            continue;
        const x = picture.left + hit.x * picture.width;
        const y = picture.top + hit.y * picture.height;
        const colour = SIDE_COLOURS[hit.side];
        paper.save();
        paper.globalAlpha = Math.max(0, Math.min(1, effect.alpha * strength));
        paper.shadowColor = 'rgba(0, 0, 0, 0.65)';
        paper.shadowBlur = unit * 0.015;
        paper.strokeStyle = colour;
        paper.fillStyle = colour;
        paper.lineWidth = unit * 0.014;
        paper.beginPath();
        paper.arc(x, y, unit * (0.035 + 0.09 * effect.grow), 0, Math.PI * 2);
        paper.stroke();
        paper.beginPath();
        paper.arc(x, y, unit * 0.016, 0, Math.PI * 2);
        paper.fill();
        paper.restore();
    }
}
//# sourceMappingURL=hits.js.map