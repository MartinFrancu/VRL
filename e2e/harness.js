// Driving the real app in a real browser.
//
// Everything here exists so the tests next door can be sentences about what a
// referee does — `start`, `mark`, `review` — rather than about element ids.
// That is not tidiness: the refactor these tests are being written to protect
// will move most of `solo.js` around, and a suite that knows about `#toReview`
// would have to be rewritten by the very change it is supposed to be guarding.
// This file is the one place allowed to know the ids.
//
// The browser is real Chromium with a synthetic camera, serving the app over
// https from a sub-path, because that is what GitHub Pages does and the camera
// will not start without it.
//
// What this cannot see is in `.claude/skills/tdd/SKILL.md`, and it is worth
// knowing before trusting a green run: headless Chromium on a desktop would
// have passed both of the worst bugs this app has had.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Where to find a Chromium.
 *
 * Normally Playwright's own, put there by `npx playwright install chromium`.
 * The override is for machines that already have one at a known path and
 * cannot download another — a CI image, or a container whose browser build
 * does not match the npm package.
 */
const EXECUTABLE = process.env['VRL_CHROMIUM'] || undefined;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** The app served the way Pages serves it. Returns its base URL and a stop. */
export async function startServer() {
  const port = await freePort();
  const server = spawn('node', ['tools/serve.js'], {
    cwd: ROOT,
    env: { ...process.env, VRL_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = `https://localhost:${port}/VRL/`;
  await new Promise((resolve, reject) => {
    const failed = (error) => reject(new Error(`the test server did not start: ${error}`));
    server.once('error', failed);
    server.once('exit', (code) => failed(`it exited with ${code}`));
    // Its own banner is the only honest signal that the port is bound.
    server.stdout.on('data', (data) => {
      if (String(data).includes(url)) resolve();
    });
    server.stderr.on('data', (data) => failed(String(data)));
    setTimeout(() => failed('it never said it was listening'), 10_000);
  });

  return { url, stop: () => server.kill() };
}

export function launchBrowser() {
  // `npm run test:e2e:headed` opens a window and slows the gestures down, which
  // is the quickest way to see what the suite actually does to the app.
  const watching = Boolean(process.env['VRL_HEADED']);

  return chromium.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    headless: !watching,
    ...(watching ? { slowMo: 250 } : {}),
    args: [
      // A synthetic camera, and permission granted without a prompt to click.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      // The server's certificate is self-signed. Without this the service
      // worker refuses to register, which is not the app's fault.
      '--ignore-certificate-errors',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });
}

/** What `package.json` says the version is — see `theVersionOnScreen`. */
export function versionInManifest() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

/**
 * The app, open and pointed at a camera, as a set of things a referee can do.
 *
 * Every wait in here is for an event or a state, never for a duration — except
 * `film`, where the passage of recording time is the thing being waited for
 * rather than a stand-in for synchronisation.
 */
export async function openApp(browser, { url, shareSheet = false }) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['camera'],
    // A phone, roughly. The picture is the control surface, so its shape is
    // part of what is being tested.
    viewport: { width: 420, height: 860 },
  });

  // Every download link the page clicks, so a test can say none was — on an
  // iPhone a download link to a video opens it in place of the app.
  //
  // Caught on the element's own click() as well as on the document, because
  // a link made on the fly and never added to the page is clicked without the
  // document ever hearing of it.
  await context.addInitScript(() => {
    window.__downloadClicks = [];
    const note = (link) => {
      if (link?.hasAttribute?.('download')) window.__downloadClicks.push(link.getAttribute('download'));
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.isConnected) note(this);
      return click.call(this);
    };
    document.addEventListener(
      'click',
      (event) => note(event.target instanceof Element ? event.target.closest('a[download]') : null),
      true
    );
  });

  if (shareSheet) {
    // A share sheet like a phone's: it takes files, and it refuses unless the
    // page is still inside the moment of a tap. Desktop Chromium has no share
    // sheet at all, which is how an app that shared too late passed here and
    // left an iPhone on a black screen.
    await context.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = (data) => Boolean(data?.files?.length);
      navigator.share = async (data) => {
        if (!navigator.userActivation?.isActive) {
          window.__shareRefused = (window.__shareRefused ?? 0) + 1;
          throw new DOMException('share must follow a tap', 'NotAllowedError');
        }
        const file = data.files[0];
        window.__shared.push({ name: file.name, type: file.type, bytes: file.size });
      };
    });
  }
  const page = await context.newPage();

  const faults = [];
  page.on('pageerror', (error) => faults.push(String(error.message)));

  await page.goto(url);
  // The camera coming up is what makes START pressable; until then there is no
  // app to speak of.
  await page.waitForFunction(() => {
    const preview = document.getElementById('preview');
    return preview.videoWidth > 0 && !document.getElementById('start').disabled;
  });

  const read = (fn) => page.evaluate(fn);
  const screen = () => read(() => document.body.dataset['screen']);

  const app = {
    page,
    /** Anything the page threw since it opened. Asserted empty by the tests. */
    faults,
    screen,
    version: () => read(() => document.getElementById('version').textContent),
    note: () => read(() => document.getElementById('live-note').textContent),
    elapsed: () => read(() => document.getElementById('elapsed').textContent),
    markCount: () => read(() => document.getElementById('dots').children.length),
    reviewOffered: () => read(() => !document.getElementById('toReview').disabled),

    async start() {
      await page.locator('#start').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'recording');
    },

    /** Let the bout run. The only wait here that is actually about time. */
    film: (ms) => page.waitForTimeout(ms),

    /**
     * Tap the picture, as a referee does — not a button, the picture itself.
     * Away from the corners the controls sit in.
     */
    async mark() {
      const before = await app.markCount();
      await page.locator('#camera').click({ position: { x: 150, y: 520 } });
      await page.waitForFunction((was) => document.getElementById('dots').children.length > was, before);
    },

    /** Tap one of the buttons that sits on top of the picture. */
    tapButtonOnPicture: (id) => page.locator(`#${id}`).click(),

    /**
     * Stop filming and look at the marks. Waits for the recording to have been
     * measured, since a window cannot be computed before there is a duration.
     */
    async review() {
      await page.locator('#toReview').click();
      await page.waitForFunction(
        () =>
          document.body.dataset['screen'] === 'review' &&
          document.getElementById('tabs').children.length > 0 &&
          Number.isFinite(document.getElementById('clip').duration),
        undefined,
        { timeout: 20_000 }
      );
    },

    async back() {
      await page.locator('#toRecord').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'recording');
    },

    end: () => page.locator('#end').click(),
    confirmShowing: () => read(() => !document.getElementById('confirm').hidden),
    confirmTitle: () => read(() => document.getElementById('confirm-title').textContent),
    keepFilming: () => page.locator('#confirm-cancel').click(),
    async discard() {
      // Same reasoning as selectTab: if the asking never happened, say so now
      // rather than waiting out a timeout on a dialog that is not there.
      if (!(await app.confirmShowing())) {
        throw new Error('nothing to discard — the app never asked');
      }
      await page.locator('#confirm-end').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'idle', undefined, {
        timeout: 5_000,
      });
    },
    async waitForIdle() {
      await page.waitForFunction(() => document.body.dataset['screen'] === 'idle');
    },

    tabCount: () => read(() => document.getElementById('tabs').children.length),
    activeTab: () =>
      read(() => [...document.getElementById('tabs').children].findIndex((b) => b.classList.contains('on'))),

    /**
     * Choose a mark. Waits for the highlight to move rather than for the
     * footage to arrive somewhere, so that where it arrives stays something a
     * test can assert rather than something the harness has already assumed.
     */
    async selectTab(index) {
      // Checked rather than waited for: a tab that is missing is missing, and
      // waiting thirty seconds to discover it turns one broken thing into a
      // suite that looks hung.
      const available = await app.tabCount();
      if (index >= available) {
        throw new Error(`asked for mark ${index + 1}, but there are only ${available} tabs`);
      }
      await page.locator('#tabs button').nth(index).click();
      await page.waitForFunction(
        (wanted) => document.getElementById('tabs').children[wanted]?.classList.contains('on'),
        index,
        { timeout: 5_000 }
      );
    },

    positionMs: () => read(() => document.getElementById('clip').currentTime * 1000),
    durationMs: () => read(() => document.getElementById('clip').duration * 1000),
    readout: () => read(() => document.getElementById('readout').textContent),
    shortfall: () => read(() => document.getElementById('shortfall').textContent),

    /**
     * Drag across the picture, as a fraction of its width. Positive is
     * forwards. One gesture, held down, because the bug this guards against was
     * the browser claiming the gesture and abandoning ours one move in.
     */
    async dragAcross(fraction) {
      const box = await page.locator('#stage').boundingBox();
      const y = box.y + box.height / 2;
      const from = box.x + box.width / 2;
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(from + fraction * box.width, y, { steps: 12 });
      await page.mouse.up();
    },

    /** Touch the picture without moving. Deliberately expected to do nothing. */
    async tapPicture() {
      const box = await page.locator('#stage').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
    },

    saveOffered: () => read(() => !document.getElementById('save').disabled),
    savingShowing: () => read(() => !document.getElementById('saving').hidden),
    savingTitle: () => read(() => document.getElementById('saving-title').textContent),

    /** Set the run-up or the tail, as the sliders in diagnostics do. */
    async setWindow(which, ms) {
      await page.evaluate(
        ({ which, ms }) => {
          const control = document.getElementById(which);
          control.value = String(ms);
          control.dispatchEvent(new Event('input', { bubbles: true }));
        },
        { which, ms }
      );
    },

    /**
     * End the bout and go to the summary — by END, from wherever filming is. From
     * review that means BACK first, which keeps the exchange and starts the
     * next; ending with nothing marked in that one simply lets it go.
     */
    async openSummary() {
      if ((await screen()) === 'review') await app.back();
      await page.locator('#end').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'export', undefined, {
        timeout: 20_000,
      });
    },

    /** BACK from the summary: carry on filming the same bout. */
    async leaveSummary() {
      await page.locator('#export-back').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'recording');
    },

    /** End bout on the summary, and confirm it. */
    async endBout() {
      await page.locator('#export-end').click();
      await page.locator('#confirm-end').click();
      await page.waitForFunction(() => document.body.dataset['screen'] === 'idle');
    },

    /** Give the mark on screen its point: 'red', 'blue', or null for none. */
    async givePoint(side) {
      await page.locator('#point').click();
      await page.locator(side === 'red' ? '#give-red' : side === 'blue' ? '#give-blue' : '#give-none').click();
    },

    /** Each review tab's point, in order: 'red', 'blue' or null. */
    tabPoints: () =>
      read(() =>
        [...document.getElementById('tabs').children].map((tab) =>
          tab.classList.contains('red') ? 'red' : tab.classList.contains('blue') ? 'blue' : null
        )
      ),

    pointButton: () => read(() => document.getElementById('point').textContent),
    pickingPoint: () => read(() => !document.getElementById('pick-point').hidden),

    /** On the summary, each mark's point as shown beside it, in order. */
    summaryPoints: () =>
      read(() => [...document.querySelectorAll('#picks label')].map((label) => label.querySelector('.side')?.textContent ?? null)),

    /** Tick every mark on the summary that is not already ticked. */
    async tickAll() {
      const boxes = page.locator('#picks input:not(:checked)');
      while ((await boxes.count()) > 0) await boxes.first().click();
    },

    /** Whether the bar for placing hits is showing. */
    placing: () => read(() => !document.getElementById('placing').hidden),
    placingSide: () =>
      read(() => (document.getElementById('hit-red').classList.contains('on') ? 'red' : document.getElementById('hit-blue').classList.contains('on') ? 'blue' : null)),

    /** How many hits the mark on screen has, as the bar says. */
    hitCount: () =>
      read(() => {
        const said = document.getElementById('placing-text').textContent;
        const count = /^(\d+) hits? /.exec(said);
        return count ? Number(count[1]) : 0;
      }),

    /**
     * Where on the screen a point of the picture is — `fx`, `fy` as fractions
     * of the video frame, allowing for the bars the picture sits between.
     */
    pictureSpot: (fx, fy) =>
      page.evaluate(
        ({ fx, fy }) => {
          const stage = document.getElementById('stage').getBoundingClientRect();
          const clip = document.getElementById('clip');
          const scale = Math.min(stage.width / clip.videoWidth, stage.height / clip.videoHeight);
          const width = clip.videoWidth * scale;
          const height = clip.videoHeight * scale;
          const left = stage.left + (stage.width - width) / 2;
          const top = stage.top + (stage.height - height) / 2;
          return { x: left + fx * width, y: top + fy * height, barY: top / 2 + stage.top / 2 };
        },
        { fx, fy }
      ),

    /** Tap the picture at a spot without moving — a tap, not a drag. */
    async tapPictureAt(fx, fy) {
      const at = await app.pictureSpot(fx, fy);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.up();
    },

    /** Tap the black bar above the picture. */
    async tapBar() {
      const at = await app.pictureSpot(0.5, 0.5);
      await page.mouse.move(at.x, at.barY);
      await page.mouse.down();
      await page.mouse.up();
    },

    chooseHitSide: (side) => page.locator(side === 'red' ? '#hit-red' : '#hit-blue').click(),
    undoHit: () => page.locator('#hit-undo').click(),
    doneHits: () => page.locator('#hit-done').click(),

    /** The colour drawn over the picture at a spot of it, from the hit layer. */
    hitLayerAt: (fx, fy) =>
      page.evaluate(
        ({ fx, fy }) => {
          const layer = document.getElementById('hit-layer');
          const clip = document.getElementById('clip');
          const scale = Math.min(layer.width / clip.videoWidth, layer.height / clip.videoHeight);
          const width = clip.videoWidth * scale;
          const height = clip.videoHeight * scale;
          const x = Math.round((layer.width - width) / 2 + fx * width);
          const y = Math.round((layer.height - height) / 2 + fy * height);
          const [r, g, b, a] = layer.getContext('2d').getImageData(x, y, 1, 1).data;
          return { r, g, b, a };
        },
        { fx, fy }
      ),

    /** How many marks each exchange on the summary lists, in order. */
    sections: () =>
      read(() => [...document.querySelectorAll('#picks details')].map((section) => section.querySelectorAll('input').length)),

    /** Which marks are ticked on the summary, in order, across every exchange. */
    ticked: () =>
      read(() => [...document.querySelectorAll('#picks input')].map((box) => box.checked)),

    /** Tick or untick mark `n` of exchange `exchange`, both counting from 1. */
    async toggleMark(n, exchange = 1) {
      await page.locator(`#picks input[data-exchange="${exchange}"][data-mark="${n}"]`).click();
    },

    exportSaveOffered: () => read(() => !document.getElementById('export-save').disabled),

    /** What the background video is doing. */
    behind: () =>
      read(() => {
        const video = document.getElementById('behind');
        return { rate: video.playbackRate, paused: video.paused, atMs: video.currentTime * 1000 };
      }),

    /** Which mark the list is highlighting as the one playing behind it. */
    showingMark: () =>
      read(() => {
        const box = document.querySelector('#picks label.showing input');
        return box ? { exchange: Number(box.dataset.exchange), mark: Number(box.dataset.mark) } : null;
      }),

    /**
     * Save from the summary, and catch the file that comes out.
     *
     * Ends the bout first if the summary is not already showing. On a phone the
     * file goes to the share sheet; with no share sheet there is a Download link
     * instead, which is what a desktop browser gets and what can be caught.
     */
    async save() {
      if ((await screen()) !== 'export') await app.openSummary();
      await page.locator('#export-save').click();
      await page.waitForFunction(() => !document.getElementById('saving-download').hidden, undefined, {
        timeout: 60_000,
      });
      const coming = page.waitForEvent('download', { timeout: 30_000 });
      await page.locator('#saving-download').click();
      const download = await coming;
      const path = await download.path();
      await page.locator('#saving-stop').click();
      return { name: download.suggestedFilename(), path, bytes: statSync(path).size };
    },

    /**
     * How bright a saved video is along its length — the mean brightness of a
     * frame every `stepMs`, from 0 (black) to 255. The only honest way to show
     * a fade made it into the file rather than just into the code.
     */
    async brightnessAlong(path, stepMs = 50) {
      const base64 = readFileSync(path).toString('base64');
      return page.evaluate(
        async ({ data, stepMs }) => {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes]));
          const probe = document.createElement('video');
          probe.muted = true;
          probe.preload = 'auto';
          probe.src = url;
          await new Promise((resolve) => probe.addEventListener('loadedmetadata', resolve, { once: true }));
          if (!Number.isFinite(probe.duration)) {
            // A recorder's file carries no duration until something asks to
            // seek past its end; the same trick the app itself uses.
            await new Promise((resolve) => {
              probe.addEventListener('durationchange', () => Number.isFinite(probe.duration) && resolve(), { once: false });
              probe.currentTime = 1e6;
            });
          }
          const canvas = document.createElement('canvas');
          canvas.width = 32;
          canvas.height = 18;
          const paper = canvas.getContext('2d', { willReadFrequently: true });
          const seek = (seconds) =>
            new Promise((resolve) => {
              probe.addEventListener('seeked', resolve, { once: true });
              probe.currentTime = seconds;
            });

          const samples = [];
          const lengthMs = probe.duration * 1000;
          for (let atMs = 0; atMs < lengthMs; atMs += stepMs) {
            await seek(atMs / 1000);
            paper.drawImage(probe, 0, 0, canvas.width, canvas.height);
            const pixels = paper.getImageData(0, 0, canvas.width, canvas.height).data;
            let sum = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            }
            samples.push({ atMs, luma: sum / (pixels.length / 4) });
          }
          URL.revokeObjectURL(url);
          return { lengthMs, samples };
        },
        { data: base64, stepMs }
      );
    },

    /** How long a video file on disk actually runs, in ms. */
    async lengthOfVideo(path) {
      const base64 = readFileSync(path).toString('base64');
      return page.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        const probe = document.createElement('video');
        probe.preload = 'metadata';
        probe.src = url;
        const seconds = await new Promise((resolve) => {
          const done = () => Number.isFinite(probe.duration) && probe.duration > 0 && resolve(probe.duration);
          probe.addEventListener('durationchange', done);
          probe.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(probe.duration)) return done();
            probe.currentTime = 1e6;
          });
          setTimeout(() => resolve(0), 8000);
        });
        URL.revokeObjectURL(url);
        return seconds * 1000;
      }, base64);
    },

    serviceWorkers: () => read(() => navigator.serviceWorker.getRegistrations().then((all) => all.length)),

    /** Wait until the app is being served by its own service worker. */
    async waitForOfflineReady() {
      try {
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
          timeout: 10_000,
        });
      } catch {
        const registrations = await app.serviceWorkers();
        throw new Error(
          `the app never took control of itself — ${registrations} service worker(s) registered. ` +
            'Without one it cannot open in a hall with no signal.'
        );
      }
    },

    /** Cut the network, as a sports hall does. */
    setOffline: (offline) => context.setOffline(offline),

    /** Reload and wait for the app to be up, without assuming a network. */
    async reload() {
      await page.reload();
      await page.waitForFunction(() => document.body.dataset['screen'] !== undefined);
    },

    close: () => context.close(),
  };

  return app;
}

/** Film a bout with `count` marks in it, spaced far enough apart to tell apart. */
export async function filmBout(app, count, { spacingMs = 700 } = {}) {
  await app.start();
  for (let i = 0; i < count; i++) {
    await app.film(spacingMs);
    await app.mark();
  }
  // A little tail, so the last mark is not sitting on the end of the recording.
  await app.film(1200);
}
