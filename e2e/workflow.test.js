// What the app does, pinned from the outside.
//
// These tests were written against an app that already worked, to be the net
// under a refactor rather than the design pressure that shaped it. So they
// assert only what a referee could notice, and nothing about how any of it is
// arranged inside — see `e2e/harness.js`, which is the only file here that
// knows an element id.
//
// Every assertion about time is about a relationship. The recording is real and
// filmed live, so the millisecond a mark lands on differs every run; "the
// second mark is later than the first" is true every time, and "the second mark
// is at 2.933s" is a coin toss wearing a number.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { filmBout, launchBrowser, openApp, startServer, versionInManifest } from './harness.js';

let server;
let browser;

beforeAll(async () => {
  server = await startServer();
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
  server?.stop();
});

/** A fresh app, pointed at the camera, closed again when the test ends. */
async function freshApp(onCleanup) {
  const app = await openApp(browser, { url: server.url });
  onCleanup(() => app.close());
  return app;
}

describe('getting a bout filmed', () => {
  test('comes up idle, with the camera live and START offered', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);

    expect(await app.screen()).toBe('idle');
    expect(await app.note()).toBe('Point it at the fight, then press START.');
    expect(app.faults).toEqual([]);
  });

  test('starts filming, and the elapsed clock runs', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);

    await app.start();
    expect(await app.screen()).toBe('recording');
    expect(await app.elapsed()).toBe('0:00');

    // Not a stopwatch test — only that it is a clock rather than a label.
    await app.page.waitForFunction(() => document.getElementById('elapsed').textContent === '0:01');
  });

  test('refuses to review a bout with nothing marked in it', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);

    await app.start();
    expect(await app.reviewOffered()).toBe(false);

    await app.mark();
    expect(await app.reviewOffered()).toBe(true);
  });

  test('takes a mark from a tap on the picture, and shows how many', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);

    await app.start();
    expect(await app.markCount()).toBe(0);

    await app.mark();
    expect(await app.markCount()).toBe(1);

    await app.film(400);
    await app.mark();
    expect(await app.markCount()).toBe(2);
  });
});

/**
 * One bout, filmed once, looked at by several tests.
 *
 * They share it because none of them change anything — they are all
 * observations of the same reviewed bout, and filming a fresh one for each
 * would add half a minute to the suite to prove nothing extra.
 */
describe('reviewing a bout that was filmed with three marks', () => {
  const spacingMs = 700;
  let app;

  beforeAll(async () => {
    app = await openApp(browser, { url: server.url });
    await filmBout(app, 3, { spacingMs });
    await app.review();
  });

  afterAll(async () => {
    await app?.close();
  });

  test('shows one tab per mark, and opens on the first', async () => {
    expect(await app.tabCount()).toBe(3);
    expect(await app.activeTab()).toBe(0);
    expect(app.faults).toEqual([]);
  });

  /**
   * The test this suite was worth writing for.
   *
   * Three marks must be three different instants, in the order they were taken,
   * roughly as far apart as they were made. When the camera's frame clock read
   * zero and never moved — which is what a live stream does on iOS — every mark
   * computed to the same instant and all three tabs showed the first one. The
   * app looked like it was working. The positions are the only place it shows.
   */
  test('places the three marks in order, as far apart as they were taken', async () => {
    const positions = [];
    for (const index of [0, 1, 2]) {
      await app.selectTab(index);
      positions.push(await app.positionMs());
    }

    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);

    // Generously loose, on purpose: tapping takes time and encoding lags, so
    // the gaps run a little over the spacing. What this refuses is a gap of
    // nothing, and a gap out by an order of magnitude.
    for (const gap of [positions[1] - positions[0], positions[2] - positions[1]]) {
      expect(gap).toBeGreaterThan(spacingMs / 2);
      expect(gap).toBeLessThan(spacingMs * 3);
    }
  });

  test('lands on the marked moment itself, not on the start of the run-up', async () => {
    for (const index of [0, 1, 2]) {
      await app.selectTab(index);
      expect(await app.readout()).toBe('+0.00s');
    }
  });

  test('moves the highlight and the footage when another mark is chosen, and back again', async () => {
    await app.selectTab(0);
    const first = await app.positionMs();

    await app.selectTab(2);
    expect(await app.activeTab()).toBe(2);
    expect(await app.positionMs()).toBeGreaterThan(first);

    // Choosing is not one-way: coming back has to come all the way back.
    await app.selectTab(0);
    expect(await app.activeTab()).toBe(0);
    expect(await app.positionMs()).toBeCloseTo(first, 1);
  });

  /**
   * The picture is the scrubber. Relative, not absolute — a touch must not
   * teleport the footage to wherever the thumb happened to land, because the
   * moment it is touched is the moment somebody is trying to look at it.
   *
   * `windows.test.js` has the arithmetic. What is left to go wrong here is the
   * gesture: the drag that was abandoned one move in, because the browser
   * claimed it as a selection of its own.
   */
  test('moves the footage when dragged across the picture, forwards and back', async () => {
    await app.selectTab(1);
    const start = await app.positionMs();

    await app.dragAcross(0.2);
    const forward = await app.positionMs();
    expect(forward).toBeGreaterThan(start);

    await app.dragAcross(-0.2);
    expect(await app.positionMs()).toBeLessThan(forward);
  });

  /** Deliberate: nothing plays, and a tap is not a seek to where it landed. */
  test('does nothing at all for a tap on the picture that has not moved', async () => {
    await app.selectTab(1);
    const resting = await app.positionMs();

    await app.tapPicture();

    expect(await app.positionMs()).toBe(resting);
    expect(await app.readout()).toBe('+0.00s');
  });
});

describe('moving between the modes', () => {
  test('goes back to filming from review', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.review();

    await app.back();

    expect(await app.screen()).toBe('recording');
    // Deliberately silent about what happens to the marks. Today BACK throws
    // the bout away without asking; whether that is wanted is an open question
    // in docs/BACKLOG.md, and a test here would turn it into a commitment.
  });

  /**
   * Marks that have not been looked at are the only thing in this app that
   * cannot be got back, and END sits next to REVIEW where a thumb could find
   * the wrong one.
   */
  test('asks before ending a bout that has marks in it, and goes on filming if told to', async ({
    onTestFinished,
  }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);

    await app.end();

    expect(await app.confirmShowing()).toBe(true);
    expect(await app.confirmTitle()).toBe('Discard 2 marks?');
    // Still filming while the question is on screen — it is a question, not a
    // stop.
    expect(await app.screen()).toBe('recording');

    await app.keepFilming();

    expect(await app.confirmShowing()).toBe(false);
    expect(await app.screen()).toBe('recording');
    expect(await app.markCount()).toBe(2);
    expect(await app.reviewOffered()).toBe(true);
  });

  test('ends the bout when the asking is answered, leaving nothing behind', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);

    await app.end();
    await app.discard();

    expect(await app.screen()).toBe('idle');
    expect(await app.markCount()).toBe(0);
    expect(await app.elapsed()).toBe('0:00');
    expect(await app.reviewOffered()).toBe(false);
    expect(await app.note()).toBe('Point it at the fight, then press START.');

    // And the next bout starts clean rather than inheriting anything.
    await app.start();
    expect(await app.markCount()).toBe(0);
    expect(await app.reviewOffered()).toBe(false);
  });

  test('ends a bout with nothing marked without asking', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await app.start();

    await app.end();
    await app.waitForIdle();

    expect(await app.confirmShowing()).toBe(false);
    expect(await app.screen()).toBe('idle');
  });

  /**
   * There are no buttons on the picture while filming — the `?` is hidden and
   * the three controls sit below it — so today nothing can be pressed there by
   * accident. This pins that: a control is a control, and pressing one must
   * never also mark. It is the refactor that moves a button onto the stage,
   * where it looks like it belongs, that this is waiting for.
   */
  test('does not take a mark when a control is pressed while filming', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 1);

    await app.end();
    expect(await app.markCount()).toBe(1);

    await app.keepFilming();
    expect(await app.markCount()).toBe(1);
  });
});

/**
 * The two things that are not about a bout at all, and would both be noticed
 * only in a sports hall on a Saturday morning.
 */
describe('getting onto a phone and staying there', () => {
  /**
   * A venue's Wi-Fi is not something to depend on, and neither is a signal in
   * a hall full of people. After the first visit there is meant to be no
   * network call at all — so cut the network and see.
   */
  test('still opens with the network cut, once it has been opened once', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await app.waitForOfflineReady();

    expect(await app.serviceWorkers()).toBe(1);

    await app.setOffline(true);
    await app.reload();

    // The version is read off `solo.js`, so its being there at all is the
    // evidence: the page, its script and its module all came from the phone.
    expect(await app.version()).toBe(versionInManifest());
    expect(await app.screen()).toBe('idle');
  });

  /**
   * The version on the idle screen is what a referee reads out when something
   * has gone wrong, so it has to be the version they are actually running.
   * It is written by hand in `solo.js` and in `package.json`, and this is what
   * stops the two drifting apart — see the backlog for single-sourcing it.
   */
  test('shows the same version it was released as', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);

    expect(await app.version()).toBe(versionInManifest());
  });
});

/**
 * Saving the marked moments as one short video — the thing the whole app is
 * for once the fight is over and somebody wants to show what happened.
 *
 * It is recorded by playing it, so these tests take as long as the footage
 * they produce. Both use short windows, which keeps them quick and also makes
 * the point: the saved file is a fraction of the bout it came from.
 */
describe('saving the marked moments', () => {
  /** A short run-up and tail, so a few seconds of bout gives a small reel. */
  const leadMs = 500;
  const tailMs = 200;

  async function filmedAndReviewed(onCleanup, marks = 3) {
    const app = await freshApp(onCleanup);
    await filmBout(app, marks, { spacingMs: 700 });
    await app.review();
    await app.setWindow('lead', leadMs);
    await app.setWindow('tail', tailMs);
    return app;
  }

  /** Off until there is a reviewed bout to save, the same as REVIEW is. */
  test('is not offered before a bout has been reviewed', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    expect(await app.saveOffered()).toBe(false);

    await app.start();
    await app.film(400);
    await app.mark();
    expect(await app.saveOffered()).toBe(false);
  });

  test('is offered once a bout has been marked and reviewed', async ({ onTestFinished }) => {
    const app = await filmedAndReviewed(onTestFinished);

    expect(await app.saveOffered()).toBe(true);
  });

  test('produces a video file named for the bout', async ({ onTestFinished }) => {
    const app = await filmedAndReviewed(onTestFinished);

    const saved = await app.save();

    expect(saved.name).toMatch(/^\d{4}-\d{2}-\d{2} SBA 3 marks\.(mp4|webm)$/);
    expect(saved.bytes).toBeGreaterThan(1000);
    expect(app.faults).toEqual([]);
  });

  /**
   * The point of the feature. Three marked moments of half a second's run-up
   * and a fifth of a second after are a couple of seconds; the bout they came
   * out of is several times that, and a real one is minutes.
   */
  test('saves only the marked moments, not the whole bout', async ({ onTestFinished }) => {
    const app = await filmedAndReviewed(onTestFinished);
    const boutMs = await app.durationMs();

    const saved = await app.save();
    const reelMs = await app.lengthOfVideo(saved.path);

    const wanted = 3 * (leadMs + tailMs);
    expect(reelMs).toBeGreaterThan(wanted * 0.5);
    expect(reelMs).toBeLessThan(wanted * 2);
    expect(reelMs).toBeLessThan(boutMs);
  });

  test('leaves the bout where it was, and the app usable', async ({ onTestFinished }) => {
    const app = await filmedAndReviewed(onTestFinished);
    await app.selectTab(1);
    const wasAt = await app.positionMs();

    await app.save();

    expect(await app.savingShowing()).toBe(false);
    expect(await app.screen()).toBe('review');
    expect(await app.positionMs()).toBeCloseTo(wasAt, 1);
    // And it can still be driven afterwards.
    await app.selectTab(2);
    expect(await app.activeTab()).toBe(2);
  });
});
