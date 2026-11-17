// The raw files: a bout's whole recordings, as filmed, with what was noticed in
// them written down beside them — to cut by hand, to open again here, or to
// keep for training something later.
//
//   2026-11-17 SBA bout raw.zip
//     bout.json          the BoutRecord: everything, machine-readable
//     markers.csv        every mark and hit as a table
//     exchange-1.mp4     each exchange's recording, untouched
//     exchange-2.mp4     …
/** The zip's name: the day the bout started, as the saved video's is. */
export function rawFilename(startedAt) {
    const day = startedAt.slice(0, 10);
    return `${/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'undated'} SBA bout raw.zip`;
}
/** A recording's name in the zip: its exchange's number, in its own type. */
export function recordingName(exchangeIndex, mimeType) {
    return `exchange-${exchangeIndex + 1}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`;
}
/** A time in a file the way an editor's timeline shows it: 00:01:04.250. */
function timecode(ms) {
    const whole = Math.max(0, Math.round(ms));
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    const hours = Math.floor(whole / 3_600_000);
    const minutes = Math.floor(whole / 60_000) % 60;
    const seconds = Math.floor(whole / 1000) % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(whole % 1000, 3)}`;
}
/** The moment on the clock: the exchange's start, plus how far into it. */
function onTheClock(filmedAt, ms) {
    const start = Date.parse(filmedAt);
    return Number.isFinite(start) ? new Date(start + ms).toISOString() : '';
}
/**
 * Every mark, each followed by its hits, as CSV. Times are in the file — the
 * exchange's first recording — both as a timecode and in ms; a hit's position
 * both as the fraction of the picture stored and in that file's pixels.
 */
export function markersCsv(record) {
    const chosen = new Set(record.chosen);
    const rows = ['exchange,file,kind,mark,time,ms,clock,side,x,y,x_px,y_px,ticked'];
    record.exchanges.forEach((exchange, exchangeIndex) => {
        const take = exchange.takes[0];
        const file = take?.media[0]?.key ?? '';
        const startsAt = take?.startedAtMs ?? 0;
        exchange.marks.forEach((mark, markIndex) => {
            const ticked = chosen.has(mark.id) ? 'yes' : 'no';
            const at = (ms) => [timecode(ms - startsAt), Math.round(ms - startsAt), onTheClock(exchange.filmedAt, ms)];
            rows.push([exchangeIndex + 1, file, 'mark', markIndex + 1, ...at(mark.atMs), '', '', '', '', '', ticked].join(','));
            for (const hit of mark.hits ?? []) {
                const px = (fraction, size = 0) => Math.round(fraction * size);
                rows.push([
                    exchangeIndex + 1,
                    file,
                    'hit',
                    markIndex + 1,
                    ...at(hit.atMs),
                    hit.side,
                    hit.x,
                    hit.y,
                    px(hit.x, take?.width),
                    px(hit.y, take?.height),
                    ticked,
                ].join(','));
            }
        });
    });
    return `${rows.join('\n')}\n`;
}
//# sourceMappingURL=raw.js.map