# SBA Replay Lite

One referee, one phone, no setup. Film a bout, mark the moments worth a second
look, and look at them again when the fight is stopped.

**[martinfrancu.github.io/VRL](https://martinfrancu.github.io/VRL/)**

---

## Getting it onto a phone

Open the address above and allow the camera. That is the whole setup — no
laptop, no Wi-Fi to join, no certificate to accept, nothing to install.

Then **Share → Add to Home Screen**, and open it from that icon rather than from
the browser: that is where it runs full screen, and where it works **with no
signal at all**. A sports hall's internet is not something to depend on.

To put it on somebody else's phone, open the **?** on the first screen — there
is a QR at the bottom. They point their camera at it. Their phone needs a signal
for that one load and never again.

## Using it

It has three screens and nothing else.

**Idle** — pointed at the fight, not recording. One button: **START**. Hold the
phone the way you mean to film *before* you press it.

**Filming** — **tap the picture** whenever you see something worth a second
look. The whole picture is the button, because you are watching the fight rather
than the screen. It flashes and buzzes so you know it took, and the dots along
the top count them. Mark as often as you like; it keeps filming throughout.

- **REVIEW** — grey until you have marked something, so the grey also tells you
  whether you have
- **END** — back to idle, asking first if there are marks you have not seen

**Review** — the numbered marks along the top, and the picture. **Drag your
thumb across the picture** to move through the moment; the full width is the
whole window, which works out finer than one frame per pixel. Each mark shows
about a second and a half before it and a second after — adjustable under
**Settings & diagnostics**. **BACK** returns to filming.

## Things worth knowing before an event

**Turn the phone before you start.** The recording keeps the shape it had the
moment you pressed START. Turning the phone while filming will not change it —
the footage just comes back the wrong way round.

**Leaving a bout loses it.** BACK from review starts a new bout immediately, and
the marks you were looking at are gone with no warning. END discards too, but
asks first when there are marks you have not seen.

**Nothing is saved and nothing is uploaded.** The footage never leaves the
phone: no account, no server, no network call once the page has loaded. This
films people, often children, at a public event, and a tool that provably keeps
nothing is one nobody has to have a conversation about. It also means there is
nothing to recover — a bout exists until you leave it, and then it does not.

**It will not stop the screen rotating.** A web app on iOS cannot lock
orientation. The camera is fixed once a bout starts; the layout still turns.

## Where this came from

Built for the SBA. There is a larger sibling that does the same job with several
phones and a laptop, worth its setup when more than one angle matters. This one
is for when setting four phones up was never going to happen.

Still a prototype, and still being shaped by use.

## Working on it

Plain HTML, CSS and JavaScript. No framework and no build step — what is in the
repository is what runs, and `git push` is the deploy.

```
npm install
npx playwright install chromium   # once, ever — the browser the tests drive
npm run serve                     # https://localhost:4443/VRL/
```

`npm run serve` uses the same `/VRL/` sub-path as GitHub Pages on purpose: a
manifest or a service worker whose scope assumes the root fails in ways that
only appear on a phone. It makes its own https certificate on first run
(`tools/certs.js`), since the camera will not start without one — or point
`VRL_CERTS` at a pair you already have.

### The tests

```
npm test            # everything. ~21s. what to run before releasing
npm run test:unit   # the window arithmetic. ~1s. what to run while working
npm run test:e2e    # a real browser filming real bouts. ~20s
npm run test:watch  # the fast ones, re-running as you type

npm run test:e2e:headed    # the same, but watch it happen in a window
```

Green reads `Tests  35 passed (35)`. A failure names itself as a sentence —
`× places the three marks in order, as far apart as they were taken` — so a red
run says what broke without anyone reading the code.

`test:e2e:headed` is the one worth running once out of curiosity: a browser
window opens and you watch a bout being filmed, tapped three times, reviewed,
dragged and ended. It is also the fastest way to see *where* a failure happens.

**What the tests cannot see.** They run in headless Chromium on a desktop with
a synthetic camera. Both of the worst bugs this app has had — a live stream's
frame clock reading zero on iOS, and the camera keeping the shape it had when it
was first asked — would pass this suite green. So a release still wants a few
minutes on a real phone. The device-specific traps are written down as comments
at the line each one bit; a refactor must carry those comments along with the
code they explain.

| File | |
|---|---|
| `index.html` | every screen, and all the styling |
| `solo.js` | the camera, the marks, the three screens |
| `windows.js` | which slice of the recording a mark shows. Pure, and tested |
| `sw.js` | the offline cache |
| `e2e/harness.js` | drives the real app in a real browser. The only file that knows an element id |
| `e2e/workflow.test.js` | what the app does, pinned from the outside |
| `tools/certs.js` | the https certificate for localhost, made on demand |
| `tools/make-icons.mjs` | the icons, from `logo.png` |
| `tools/make-qr.mjs` | the QR, if the address ever changes |

The version shows on the idle screen, so "am I running the one you just fixed?"
is answerable without asking. It updates itself one launch behind: the service
worker serves what it has and fetches the new version in the background, so a
change appears the *second* time the app is opened. That is deliberate — the
alternative is an app that hangs on a dead venue Wi-Fi.

More in [docs/solo-plan.md](docs/solo-plan.md), including what is still unproven.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
