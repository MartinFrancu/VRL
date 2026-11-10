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
  /**
   * BACK keeps the exchange: it is part of the bout now, and will be on the
   * summary when the bout ends. This settles the question docs/BACKLOG.md had
   * open about whether BACK should throw it away.
   */
  test('goes back to filming from review, keeping the exchange', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.review();

    await app.back();
    expect(await app.screen()).toBe('recording');
    expect(await app.markCount()).toBe(0);

    await app.openSummary();
    expect(await app.sections()).toEqual([2]);
  });

  /**
   * END is the end of the bout, not of an exchange. What is being filmed when
   * it is pressed becomes the last exchange, so nothing marked is lost and
   * nothing needs asking.
   */
  test('ends the bout on END, keeping what was being filmed as its last exchange', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);

    await app.openSummary();

    expect(await app.confirmShowing()).toBe(false);
    expect(await app.screen()).toBe('export');
    expect(await app.sections()).toEqual([2]);
  });

  test('sums up every exchange of the bout, in the order they were filmed', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.review();
    await app.back();
    await app.film(700);
    await app.mark();
    await app.film(800);

    await app.openSummary();

    expect(await app.sections()).toEqual([2, 1]);
  });

  /** The summary's BACK means the bout was not over after all. */
  test('carries on the same bout from the summary', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.openSummary();

    await app.leaveSummary();
    await app.film(700);
    await app.mark();
    await app.film(800);
    await app.openSummary();

    expect(await app.sections()).toEqual([2, 1]);
  });

  /**
   * A bout's footage is the one thing here that cannot be got back, so ending
   * it asks first — and the asking can be called off.
   */
  test('asks before ending the bout, and keeps it if told to', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.openSummary();

    await app.page.locator('#export-end').click();
    expect(await app.confirmShowing()).toBe(true);
    expect(await app.confirmTitle()).toBe('End this bout?');

    await app.keepFilming();
    expect(await app.confirmShowing()).toBe(false);
    expect(await app.screen()).toBe('export');
    expect(await app.sections()).toEqual([2]);
  });

  test('ends the bout when the asking is answered, leaving nothing behind', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 2);
    await app.openSummary();

    await app.endBout();

    expect(await app.screen()).toBe('idle');
    expect(await app.markCount()).toBe(0);
    expect(await app.elapsed()).toBe('0:00');
    expect(await app.reviewOffered()).toBe(false);
    expect(await app.note()).toBe('Point it at the fight, then press START.');

    // And the next bout starts clean rather than inheriting the last one.
    await filmBout(app, 1);
    await app.openSummary();
    expect(await app.sections()).toEqual([1]);
  });

  /** Nothing filmed and nothing marked is nothing to sum up. */
  test('goes straight back to idle when a bout ends with nothing marked in it', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await app.start();

    await app.end();
    await app.waitForIdle();

    expect(await app.confirmShowing()).toBe(false);
    expect(await app.screen()).toBe('idle');
  });

  /**
   * There are no buttons on the picture while filming — the `?` is hidden and
   * the three controls sit below it — so nothing can be pressed there by
   * accident. This pins that: a control is a control, and pressing one must
   * never also mark.
   */
  test('does not take a mark when a control is pressed while filming', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    await filmBout(app, 1);

    await app.openSummary();

    expect(await app.sections()).toEqual([1]);
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
 * Giving a mark its point, from review: red, blue, or none. The tab takes the
 * colour, and the summary starts with only the pointed marks ticked.
 */
describe('giving points', () => {
  async function reviewing(onCleanup, marks = 3) {
    const app = await freshApp(onCleanup);
    await filmBout(app, marks, { spacingMs: 700 });
    await app.review();
    return app;
  }

  test('gives the mark on screen to red, and its tab takes the colour', async ({ onTestFinished }) => {
    const app = await reviewing(onTestFinished);
    await app.selectTab(1);
    expect(await app.pointButton()).toBe('POINT');

    await app.givePoint('red');

    expect(await app.pickingPoint()).toBe(false);
    expect(await app.tabPoints()).toEqual([null, 'red', null]);
    expect(await app.pointButton()).toBe('RED');
  });

  test('changes a point, and takes it away again', async ({ onTestFinished }) => {
    const app = await reviewing(onTestFinished);

    await app.givePoint('red');
    await app.givePoint('blue');
    expect(await app.tabPoints()).toEqual(['blue', null, null]);

    await app.givePoint(null);
    expect(await app.tabPoints()).toEqual([null, null, null]);
    expect(await app.pointButton()).toBe('POINT');
  });

  test('keeps each point on its own mark when moving between them', async ({ onTestFinished }) => {
    const app = await reviewing(onTestFinished);

    await app.givePoint('red');
    await app.selectTab(2);
    expect(await app.pointButton()).toBe('POINT');
    await app.givePoint('blue');
    await app.selectTab(0);

    expect(await app.pointButton()).toBe('RED');
    expect(await app.tabPoints()).toEqual(['red', null, 'blue']);
  });

  test('can be called off, changing nothing', async ({ onTestFinished }) => {
    const app = await reviewing(onTestFinished);
    await app.givePoint('red');

    await app.page.locator('#point').click();
    expect(await app.pickingPoint()).toBe(true);
    await app.page.locator('#pick-cancel').click();

    expect(await app.pickingPoint()).toBe(false);
    expect(await app.tabPoints()).toEqual(['red', null, null]);
  });

  /**
   * Across two exchanges: the points given in each review are on the summary,
   * beside their marks, and they are what starts ticked.
   */
  test('starts the summary with only the pointed marks ticked, and says whose they are', async ({
    onTestFinished,
  }) => {
    const app = await reviewing(onTestFinished);
    await app.selectTab(1);
    await app.givePoint('red');
    await app.back();
    for (let i = 0; i < 2; i++) {
      await app.film(700);
      await app.mark();
    }
    await app.film(800);
    await app.review();
    await app.givePoint('blue');

    await app.openSummary();

    expect(await app.sections()).toEqual([3, 2]);
    expect(await app.ticked()).toEqual([false, true, false, true, false]);
    expect(await app.summaryPoints()).toEqual([null, 'Red', null, 'Blue', null]);
    expect(await app.exportSaveOffered()).toBe(true);
  });

  test('saves a video of the pointed moments alone', async ({ onTestFinished }) => {
    const app = await reviewing(onTestFinished);
    await app.setWindow('lead', 500);
    await app.setWindow('tail', 200);
    await app.selectTab(2);
    await app.givePoint('blue');

    const saved = await app.save();

    expect(saved.name).toMatch(/ SBA 1 mark\./);
  });
});

/**
 * The summary: every exchange of the bout, a checkbox per mark, and behind the
 * list the moment last touched, looping at double speed.
 */
describe('the summary', () => {
  const leadMs = 500;
  const tailMs = 200;

  /**
   * Two exchanges — three marks reviewed, then two more — with short windows.
   * No points are given, so nothing starts ticked; `tick` ticks everything.
   */
  async function summedUp(onCleanup, { tick = true } = {}) {
    const app = await freshApp(onCleanup);
    await filmBout(app, 3, { spacingMs: 700 });
    await app.review();
    await app.setWindow('lead', leadMs);
    await app.setWindow('tail', tailMs);
    await app.back();
    for (let i = 0; i < 2; i++) {
      await app.film(700);
      await app.mark();
    }
    await app.film(800);
    await app.openSummary();
    if (tick) await app.tickAll();
    return app;
  }

  /** Only marks given a point start ticked, and here none was. */
  test('opens with one section per exchange, nothing ticked when no point was given', async ({
    onTestFinished,
  }) => {
    const app = await summedUp(onTestFinished, { tick: false });

    expect(await app.sections()).toEqual([3, 2]);
    expect(await app.ticked()).toEqual([false, false, false, false, false]);
    expect(await app.exportSaveOffered()).toBe(false);
  });

  test('offers nothing to save when nothing is ticked', async ({ onTestFinished }) => {
    const app = await summedUp(onTestFinished);

    for (const n of [1, 2, 3]) await app.toggleMark(n, 1);
    for (const n of [1, 2]) await app.toggleMark(n, 2);

    expect(await app.ticked()).toEqual([false, false, false, false, false]);
    expect(await app.exportSaveOffered()).toBe(false);
  });

  /**
   * Behind the list, the moment last touched loops at double speed — from its
   * own exchange's recording, whichever that is. Sampled for longer than the
   * stretch takes to play, so a loop that ran off the end of its stretch
   * instead of going back would show up here.
   */
  test('loops the last touched moment behind the list, at double speed', async ({ onTestFinished }) => {
    const app = await summedUp(onTestFinished);

    await app.toggleMark(2, 2);
    expect(await app.showingMark()).toEqual({ exchange: 2, mark: 2 });

    const samples = [];
    for (let i = 0; i < 12; i++) {
      samples.push(await app.behind());
      await app.film(120);
    }

    expect(samples.every((sample) => sample.rate === 2)).toBe(true);
    expect(samples.some((sample) => !sample.paused)).toBe(true);
    // The second mark of the second exchange was taken about 1.4s into it.
    const spread = samples.map((sample) => sample.atMs);
    expect(Math.min(...spread)).toBeGreaterThan(1_400 - leadMs - 400);
    expect(Math.max(...spread)).toBeLessThan(1_400 + tailMs + 500);
  });
});

/**
 * Saving the bout: one short video of the chosen moments of every exchange,
 * in order, with a quick dip to black between each.
 *
 * It is recorded by playing it, so these take as long as the footage they
 * produce. Short windows keep them quick, and make the point: the saved file
 * is a fraction of what was filmed.
 */
describe('saving the bout', () => {
  const leadMs = 500;
  const tailMs = 200;

  /** One exchange of `first` marks reviewed, then one of `second` marks. */
  async function twoExchanges(onCleanup, first = 2, second = 1, { spacingMs = 700 } = {}) {
    const app = await freshApp(onCleanup);
    await filmBout(app, first, { spacingMs: 700 });
    await app.review();
    await app.setWindow('lead', leadMs);
    await app.setWindow('tail', tailMs);
    await app.back();
    for (let i = 0; i < second; i++) {
      await app.film(spacingMs);
      await app.mark();
    }
    await app.film(800);
    await app.openSummary();
    await app.tickAll();
    return app;
  }

  test('is not offered until there is a bout to sum up', async ({ onTestFinished }) => {
    const app = await freshApp(onTestFinished);
    expect(await app.screen()).toBe('idle');
    expect(await app.exportSaveOffered()).toBe(false);
  });

  test('produces a video file named for the bout and its moments', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished);

    const saved = await app.save();

    expect(saved.name).toMatch(/^\d{4}-\d{2}-\d{2} SBA 3 marks\.(mp4|webm)$/);
    expect(saved.bytes).toBeGreaterThan(1000);
    expect(app.faults).toEqual([]);
  });

  /**
   * The point of the feature: the moments of every exchange, and nothing else.
   * Three moments of 0.7s are about two seconds, against several seconds of
   * filming across the two exchanges.
   */
  test('saves the chosen moments of every exchange, not the footage', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished);

    const saved = await app.save();
    const reelMs = await app.lengthOfVideo(saved.path);

    const wanted = 3 * (leadMs + tailMs);
    expect(reelMs).toBeGreaterThan(wanted * 0.5);
    expect(reelMs).toBeLessThan(wanted * 2);
  });

  /**
   * Each moment is taken from its own exchange's recording, switching between
   * them as the video goes. One moment from each exchange; the second one's
   * mark is later than the whole first exchange is long, so played from the
   * first exchange's recording there would be nothing there to show — the
   * back half of the saved video would be missing or black.
   *
   * It has to be one from each. With a single moment the first recording
   * loaded is the right one by luck, and a recorder that never switched would
   * pass — which is how an earlier version of this test let exactly that
   * through.
   */
  test('switches to each exchange\'s own recording for its moments', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished, 2, 3, { spacingMs: 1500 });
    await app.toggleMark(2, 1);
    for (const n of [1, 2]) await app.toggleMark(n, 2);
    expect(await app.ticked()).toEqual([true, false, false, false, true]);

    const saved = await app.save();
    const { lengthMs, samples } = await app.brightnessAlong(saved.path, 40);

    const oneMoment = leadMs + tailMs;
    expect(lengthMs).toBeGreaterThan(2 * oneMoment * 0.7);
    expect(lengthMs).toBeLessThan(2 * oneMoment * 2.2);
    const backHalf = samples.filter((sample) => sample.atMs > lengthMs * 0.6 && sample.atMs < lengthMs * 0.9);
    expect(Math.max(...backHalf.map((sample) => sample.luma))).toBeGreaterThan(40);
  });

  test('leaves an unticked mark out of the saved video', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished);
    await app.toggleMark(2, 1);

    const saved = await app.save();
    const reelMs = await app.lengthOfVideo(saved.path);

    expect(saved.name).toMatch(/ SBA 2 marks\./);
    expect(reelMs).toBeGreaterThan(2 * (leadMs + tailMs) * 0.5);
    expect(reelMs).toBeLessThan(3 * (leadMs + tailMs));
  });

  /**
   * The fades, in the file. Brightness is read off the saved video itself: at
   * the joins there has to be a frame close to black, while the moments are as
   * bright as they were filmed. Without the fades nothing in the middle of the
   * file would be dark at all.
   */
  test('dips to black between the moments', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished);

    const saved = await app.save();
    const { lengthMs, samples } = await app.brightnessAlong(saved.path, 40);

    const brightest = Math.max(...samples.map((sample) => sample.luma));
    const middle = samples.filter((sample) => sample.atMs > lengthMs * 0.2 && sample.atMs < lengthMs * 0.8);
    const darkest = Math.min(...middle.map((sample) => sample.luma));

    expect(brightest).toBeGreaterThan(40);
    expect(darkest).toBeLessThan(brightest * 0.25);
  });

  test('leaves the summary as it was, and the bout still going', async ({ onTestFinished }) => {
    const app = await twoExchanges(onTestFinished);

    await app.save();
    expect(await app.savingShowing()).toBe(false);
    expect(await app.screen()).toBe('export');
    expect(await app.sections()).toEqual([2, 1]);

    await app.leaveSummary();
    expect(await app.screen()).toBe('recording');
  });
});

/**
 * The bug that left an iPhone on a black screen.
 *
 * A phone only lets a page open its share sheet in the moment after a tap.
 * Saving takes as long as the video lasts — seconds — so asking for the share
 * sheet when the recording finished was asking too late. It was refused, and
 * the app fell back to a download link, which on an iPhone opens the video in
 * place of the app with no way back.
 *
 * So these use a share sheet that refuses late requests the way a phone's
 * does, and the default windows, so the video takes longer to make than the
 * tap lasts.
 */
describe('handing a saved video to a phone', () => {
  async function savedOnAPhone(onCleanup) {
    const app = await openApp(browser, { url: server.url, shareSheet: true });
    onCleanup(() => app.close());
    await filmBout(app, 3, { spacingMs: 1000 });
    await app.openSummary();
    await app.tickAll();
    await app.page.locator('#export-save').click();
    // However long it takes, and then whatever the screen offers next.
    await app.page.waitForFunction(
      () => window.__shared.length > 0 || window.__downloadClicks.length > 0 || !!document.querySelector('#saving-share:not([hidden])'),
      undefined,
      { timeout: 60_000 }
    );
    return app;
  }

  test('reaches the share sheet even when the video took a while to make', async ({ onTestFinished }) => {
    const app = await savedOnAPhone(onTestFinished);

    // A tap of its own, so the share sheet is asked inside one.
    if (await app.page.locator('#saving-share').isVisible()) await app.page.locator('#saving-share').click();

    const shared = await app.page.evaluate(() => window.__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].name).toMatch(/^\d{4}-\d{2}-\d{2} SBA 3 marks\.(mp4|webm)$/);
    expect(shared[0].bytes).toBeGreaterThan(1000);
  });

  test('never opens the video in place of the app', async ({ onTestFinished }) => {
    const app = await savedOnAPhone(onTestFinished);
    if (await app.page.locator('#saving-share').isVisible()) await app.page.locator('#saving-share').click();

    expect(await app.page.evaluate(() => window.__downloadClicks)).toEqual([]);
    expect(await app.screen()).toBe('export');
  });
});
