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

A **bout** is the whole fight. It is filmed in **exchanges**: film until the
fight is stopped, look at what you marked, carry on.

**Idle** — pointed at the fight, not recording. One button: **START**. Hold the
phone the way you mean to film *before* you press it.

**Filming** — **tap the picture** whenever you see something worth a second
look. The whole picture is the button, because you are watching the fight rather
than the screen. It flashes and buzzes so you know it took, and the dots along
the top count them. Mark as often as you like; it keeps filming throughout.

- **REVIEW** — when the fight is stopped. Grey until you have marked something,
  so the grey also tells you whether you have
- **END** — the bout is over: on to the summary

**Review** — the numbered marks along the top, and the picture. **Drag your
thumb across the picture** to move through the moment; the full width is the
whole window, which works out finer than one frame per pixel. Each mark shows
about a second and a half before it and a second after — adjustable under
**Settings & diagnostics**. **✎** annotates the mark on screen: **tap the
picture where each hit landed**. A bar offers Red or Blue for each hit, Undo
for the last one, and Done. Drag to find the frame first; the hit goes in at
the moment on screen, and shows over the picture as a ring in the fighter's
colour that comes up just before the moment and fades over the half-second
after. Any number of hits per mark. A dot on a mark's number means it has
hits, and the saved video shows every hit the same way, at the spot and the
moment it was placed.
**BACK** keeps this exchange and goes straight back to filming the next.

**Summary** — reached by END. Every exchange of the bout, each with its marks
and a dot for each hit on them. The annotated marks start ticked, since they
are the ones that matter — or all of them, if nothing was annotated. **✎**
beside a mark opens it on the review screen to annotate, and BACK or Done
comes back with the ticks as they were and that mark ticked; tick or untick any others; whichever mark was last
ticked or unticked loops behind the list at double speed, so you can see what
you are choosing. **SAVE** makes one short video of the whole bout — the ticked
moments, exchange by exchange, dipping briefly to black between each — and
offers it to the phone's share sheet (a download link on a laptop). It records
by playing the moments through, so it takes as long as they last. **BACK**
carries on the same bout, and **Discard** throws it away, asking first. Once a
video has been handed over, the panel says **✓ Saved** and offers **New bout**
(no asking — it has just been saved) or **Back to the bout**. The line under
the list says how much footage the bout is holding in memory, since nothing is
written to storage yet.

Marks whose windows overlap are not yet merged, so a second covered by two
marks appears twice.

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

No framework, by choice — the whole app is around 50 KB of source, and a
framework runtime would be several times the thing it was added to. The reasons
are in [docs/architecture.md](docs/architecture.md).

The core is TypeScript, compiled by `tsc` alone with no bundler. What is in the
repository is still what runs, and `git push` is still the deploy.

```
npm install
npx playwright install chromium   # once, ever — the browser the tests drive
npm run build                     # src/*.ts -> app/*.js
npm run serve                     # https://localhost:4443/VRL/
```

**There is a build step now, and its output is committed.** `src/` is
TypeScript; `app/` is what `tsc` emits and what the browser actually loads.
They are both in the repository so that `git push` is still the deploy and
GitHub Pages has nothing to compile. CI checks that `app/` matches `src/`, so
if you change a layer, run `npm run build` and commit the result — a stale
`app/` fails the build rather than shipping quietly.

`npm run serve` uses the same `/VRL/` sub-path as GitHub Pages on purpose: a
manifest or a service worker whose scope assumes the root fails in ways that
only appear on a phone. It makes its own https certificate on first run
(`tools/certs.js`), since the camera will not start without one — or point
`VRL_CERTS` at a pair you already have.

### The tests

```
npm test            # typecheck + everything. ~21s. before releasing
npm run typecheck   # the types in src/ only. ~2s
npm run build       # compile src/ to app/. ~2s
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
| `solo.js` | the shell: the camera, the elements, the gestures |
| `src/contracts.ts` | the shapes the layers agree on. Types only |
| `src/bout/` | a bout and its marks, and cutting it to what is worth watching |
| `src/capture/` | filming one bout, and which clock places its marks |
| `src/render/` | where the playhead is, and what moves it |
| `src/media/` | the codec boundary. The only file that knows mp4 from webm |
| `app/` | the above, compiled. What the browser loads. Do not edit |
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
