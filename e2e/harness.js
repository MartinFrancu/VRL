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
import { readFileSync } from 'node:fs';
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
export async function openApp(browser, { url }) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['camera'],
    // A phone, roughly. The picture is the control surface, so its shape is
    // part of what is being tested.
    viewport: { width: 420, height: 860 },
  });
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
