// A problem report: what the referee says happened, what the app knows about
// where it is running, the state of the bout, and what the app did in the
// minutes before — everything someone fixing it needs, and no footage.
//
// Kept apart from the screen so that what goes into a report, and how it is
// cut down to fit a GitHub address, is tested on its own.

/** One thing the app did, when. `atMs` on the page's own clock. */
export interface LogEntry {
  readonly atMs: number;
  readonly what: string;
  readonly detail?: string;
}

/**
 * What the app did lately. Held in memory only — never written to the phone,
 * gone when the page closes — and only ever leaves in a report the referee
 * chooses to send.
 */
export class EventLog {
  readonly #limit: number;
  readonly #keepMs: number;
  #entries: LogEntry[] = [];

  constructor({ limit = 300, keepMs = 120_000 }: { limit?: number; keepMs?: number } = {}) {
    this.#limit = limit;
    this.#keepMs = keepMs;
  }

  add(atMs: number, what: string, detail?: string): void {
    this.#entries.push(detail === undefined ? { atMs, what } : { atMs, what, detail });
    if (this.#entries.length > this.#limit) this.#entries.splice(0, this.#entries.length - this.#limit);
  }

  /** What is still worth keeping at `nowMs`, oldest first. */
  entries(nowMs: number): LogEntry[] {
    this.#entries = this.#entries.filter((entry) => nowMs - entry.atMs <= this.#keepMs);
    return [...this.#entries];
  }
}

export interface Report {
  /** What the referee typed. */
  readonly note: string;
  /** What the app knows about where it is running: label, value. */
  readonly facts: readonly (readonly [string, string])[];
  /** The bout as it stands, a line each. */
  readonly state: readonly string[];
  readonly log: readonly LogEntry[];
  /** When the report was made, on the log's clock. */
  readonly nowMs: number;
}

const HEADING = 'SBA Replay Lite — problem report';

function logLine(entry: LogEntry, nowMs: number): string {
  const ago = `-${((nowMs - entry.atMs) / 1000).toFixed(1)}s`;
  return [ago, entry.what, entry.detail].filter((part) => part !== undefined && part !== '').join('  ');
}

/** Everything but the log, which is what gets cut when space is short. */
function head(report: Report): string {
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

function compose(report: Report, lines: readonly string[], left: number): string {
  const log = lines.length ? lines : ['(nothing)'];
  const cut = left > 0 ? [`(${left} older entries left out)`] : [];
  return `${head(report)}\n${[...cut, ...log].join('\n')}\n`;
}

/** The whole report, as text to share, copy or file. */
export function reportText(report: Report): string {
  return compose(
    report,
    report.log.map((entry) => logLine(entry, report.nowMs)),
    0
  );
}

/**
 * A new GitHub issue on `repository`, filled in with the report and labelled
 * as a bug, waiting for the referee to press Submit.
 *
 * All of it travels in the address, and a browser takes only so long an
 * address — so when the report will not fit in `maxLength`, the oldest lines
 * of the log go first, and the body says how many went.
 */
export function issueUrl(repository: string, report: Report, maxLength = 7_500): string {
  const title = report.note.trim().split('\n')[0]?.slice(0, 80) || 'Problem report from the app';
  const lines = report.log.map((entry) => logLine(entry, report.nowMs));
  const build = (from: number) => {
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
