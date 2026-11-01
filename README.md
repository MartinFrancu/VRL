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
npm test          # the window arithmetic, which is the only logic worth testing
npm run serve     # https://localhost:4443/VRL/
```

`npm run serve` uses the same `/VRL/` sub-path as GitHub Pages on purpose: a
manifest or a service worker whose scope assumes the root fails in ways that
only appear on a phone. It wants `certs/key.pem` and `certs/cert.pem` — the
camera will not start without https — or point `VRL_CERTS` at a pair you have.

| File | |
|---|---|
| `index.html` | every screen, and all the styling |
| `solo.js` | the camera, the marks, the three screens |
| `windows.js` | which slice of the recording a mark shows. Pure, and tested |
| `sw.js` | the offline cache |
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
