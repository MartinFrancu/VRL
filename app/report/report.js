// A problem report: what the referee says happened, what the app knows about
// where it is running, the state of the bout, and what the app did in the
// minutes before — everything someone fixing it needs, and no footage.
//
// Kept apart from the screen so that what goes into a report, and how it is
// cut down to fit a GitHub address, is tested on its own.
/**
 * What the app did lately. Held in memory only — never written to the phone,
 * gone when the page closes — and only ever leaves in a report the referee
 * chooses to send.
 */
export class EventLog {
    #limit;
    #keepMs;
    #entries = [];
    constructor({ limit = 300, keepMs = 120_000 } = {}) {
        this.#limit = limit;
        this.#keepMs = keepMs;
    }
    add(atMs, what, detail) {
        this.#entries.push(detail === undefined ? { atMs, what } : { atMs, what, detail });
        if (this.#entries.length > this.#limit)
            this.#entries.splice(0, this.#entries.length - this.#limit);
    }
    /** What is still worth keeping at `nowMs`, oldest first. */
    entries(nowMs) {
        this.#entries = this.#entries.filter((entry) => nowMs - entry.atMs <= this.#keepMs);
        return [...this.#entries];
    }
}
const HEADING = 'SBA Replay Lite — problem report';
function logLine(entry, nowMs) {
    const ago = `-${((nowMs - entry.atMs) / 1000).toFixed(1)}s`;
    return [ago, entry.what, entry.detail].filter((part) => part !== undefined && part !== '').join('  ');
}
/** Everything but the log, which is what gets cut when space is short. */
function head(report) {
    const note = report.note.trim() || '(not said)';
    return [
        HEADING,
        '',
        `What happened: ${note}`,
        '',
        ...report.facts.map(([label, value]) => `${label}: ${value}`),
        '',
        'The bout:',
        ...(report.state.length ? report.state.map((line) => `- ${line}`) : ['- none']),
        '',
        'What the app did, most recent last:',
    ].join('\n');
}
function compose(report, lines, left) {
    const log = lines.length ? lines : ['(nothing)'];
    const cut = left > 0 ? [`(${left} older entries left out)`] : [];
    return `${head(report)}\n${[...cut, ...log].join('\n')}\n`;
}
/** The whole report, as text to share, copy or file. */
export function reportText(report) {
    return compose(report, report.log.map((entry) => logLine(entry, report.nowMs)), 0);
}
/**
 * A new GitHub issue on `repository`, filled in with the report and labelled
 * as a bug, waiting for the referee to press Submit.
 *
 * All of it travels in the address, and a browser takes only so long an
 * address — so when the report will not fit in `maxLength`, the oldest lines
 * of the log go first, and the body says how many went.
 */
export function issueUrl(repository, report, maxLength = 7_500) {
    const title = report.note.trim().split('\n')[0]?.slice(0, 80) || 'Problem report from the app';
    const lines = report.log.map((entry) => logLine(entry, report.nowMs));
    const build = (from) => {
        const query = new URLSearchParams({ title, labels: 'bug', body: compose(report, lines.slice(from), from) });
        return `https://github.com/${repository}/issues/new?${query.toString()}`;
    };
    let from = 0;
    let url = build(from);
    while (url.length > maxLength && from < lines.length) {
        // Drop in proportion to how far over it is, then a line at a time.
        const over = url.length - maxLength;
        from = Math.min(lines.length, from + Math.max(1, Math.floor(over / 120)));
        url = build(from);
    }
    return url;
}
//# sourceMappingURL=report.js.map