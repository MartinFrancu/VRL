import { describe, expect, test } from 'vitest';

import { EventLog, issueUrl, reportText } from './report.js';
import type { Report } from './report.js';

/**
 * What the app did lately, kept in memory so that a problem report can say
 * what led up to it. Never written anywhere; gone when the page is closed.
 */
describe('the log of what the app did', () => {
  test('keeps what happened, in order', () => {
    const log = new EventLog();
    log.add(1_000, 'screen', 'recording');
    log.add(2_000, 'mark');

    expect(log.entries(3_000)).toEqual([
      { atMs: 1_000, what: 'screen', detail: 'recording' },
      { atMs: 2_000, what: 'mark' },
    ]);
  });

  /** The last two minutes are what a report is about; older is noise. */
  test('forgets what is older than it keeps', () => {
    const log = new EventLog({ keepMs: 120_000 });
    log.add(1_000, 'old');
    log.add(100_000, 'recent');

    expect(log.entries(122_000).map((entry) => entry.what)).toEqual(['recent']);
  });

  /** However busy the two minutes, it does not grow without end. */
  test('keeps no more than its limit, dropping the oldest', () => {
    const log = new EventLog({ limit: 3 });
    for (let at = 0; at < 5; at++) log.add(at, `event ${at}`);

    expect(log.entries(10).map((entry) => entry.what)).toEqual(['event 2', 'event 3', 'event 4']);
  });
});

const report: Report = {
  note: 'The picture froze after the second mark',
  facts: [
    ['App', '1.1.52'],
    ['Phone', 'Mozilla/5.0 (Linux; Android 14)'],
  ],
  state: ['2 exchanges', 'exchange 1: 3 marks, 1 hit'],
  log: [
    { atMs: 10_000, what: 'screen', detail: 'review' },
    { atMs: 11_500, what: 'error', detail: 'boom' },
  ],
  nowMs: 12_000,
};

/** The report itself: what the referee said, what the app knows, what it did. */
describe('a problem report', () => {
  const text = reportText(report);

  test('starts with what the referee said happened', () => {
    expect(text.split('\n')[0]).toBe('SBA Replay Lite — problem report');
    expect(text).toContain('What happened: The picture froze after the second mark');
  });

  test('says what it was running on, and the state of the bout', () => {
    expect(text).toContain('App: 1.1.52');
    expect(text).toContain('Phone: Mozilla/5.0 (Linux; Android 14)');
    expect(text).toContain('- exchange 1: 3 marks, 1 hit');
  });

  /** Times counted back from the report, as "how long before" is what matters. */
  test('lists what the app did, counted back from the report', () => {
    expect(text).toContain('-2.0s  screen  review');
    expect(text).toContain('-0.5s  error  boom');
  });

  test('says so when nothing was typed', () => {
    expect(reportText({ ...report, note: '  ' })).toContain('What happened: (not said)');
  });
});

/**
 * A report as a new GitHub issue, filled in and waiting for Submit. Carried in
 * the address, which has a length a browser will take — so a long log loses
 * its oldest lines first, and says it did.
 */
describe('a problem report as a GitHub issue', () => {
  const parse = (url: string) => new URL(url);

  test('opens a new issue on the repository, labelled as a bug', () => {
    const url = parse(issueUrl('MartinFrancu/VRL', report));

    expect(url.origin + url.pathname).toBe('https://github.com/MartinFrancu/VRL/issues/new');
    expect(url.searchParams.get('labels')).toBe('bug');
  });

  test('is titled with what happened', () => {
    expect(parse(issueUrl('MartinFrancu/VRL', report)).searchParams.get('title')).toBe(
      'The picture froze after the second mark'
    );
  });

  test('carries the whole report when it fits', () => {
    expect(parse(issueUrl('MartinFrancu/VRL', report)).searchParams.get('body')).toBe(reportText(report));
  });

  test('keeps to the length given, losing the oldest of the log first', () => {
    const busy: Report = {
      ...report,
      log: Array.from({ length: 400 }, (_, n) => ({ atMs: n * 100, what: 'seek', detail: `to ${n}` })),
      nowMs: 40_000,
    };

    const url = issueUrl('MartinFrancu/VRL', busy, 4_000);
    const body = parse(url).searchParams.get('body') ?? '';

    expect(url.length).toBeLessThanOrEqual(4_000);
    expect(body).toContain('to 399');
    expect(body).not.toContain('to 0\n');
    expect(body).toContain('older entries left out');
  });

  test('is titled plainly when nothing was typed', () => {
    expect(parse(issueUrl('MartinFrancu/VRL', { ...report, note: '' })).searchParams.get('title')).toBe(
      'Problem report from the app'
    );
  });
});
