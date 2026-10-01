# The Solo spike — what it is and how to run it

Built to answer one question: **can a recording made on an iPhone be stepped one
frame at a time?** Everything else on the screen is there to make that question
askable on a real phone rather than in a lab.

It is not the finished tool. It has no icon, no offline cache, and it is served
off the laptop — all three of which the finished version drops. See
[solo-plan.md](solo-plan.md).

## Running it

Open **https://martinfrancu.github.io/VRL/** and allow the camera. That is the
whole setup — no laptop, no Wi-Fi to join, no certificate to accept.

Then **Share → Add to Home Screen**, and open it from that icon rather than from
Safari: that is where it runs full screen with no browser chrome, and where the
offline cache is live. After that first load it needs no signal at all.

To put it on somebody else's phone, the **↗** button hands over the link — on an
iPhone that means AirDrop to whoever is standing next to you. Their phone needs
a signal for that one load and never again.

### Working on it

```
npm install
npm test          # the window arithmetic
npm run serve     # serves this folder at https://localhost:4443/VRL/
```

`npm run serve` deliberately uses the same sub-path as Pages, because a manifest
or a service worker whose scope assumes the root fails in ways that only show up
on a phone. It needs `certs/key.pem` and `certs/cert.pem`, or point `VRL_CERTS`
at a pair you already have.

## The three modes

**Idle** — pointed at the fight, nothing recording. One button: **START**.

**Recording** — filming. **Tap anywhere on the picture to mark the moment.** The
whole picture is the button, because the referee is watching the fight rather
than the screen and the target has to be findable without looking; it flashes
and buzzes so you know it took, and the dots along the top count what you have.
Up to five. Two small buttons underneath:

- **REVIEW** — grey until you have marked something, so the grey also tells you
  whether you have.
- **END** — back to idle. It asks first if you have marks you have not looked
  at, because that is the only thing here that cannot be got back.

**Review** — the numbered marks along the top, the slider underneath, and
**RECORD**, which drops straight back into filming. Tap the picture to start and
stop it; the toggle decides whether letting go of the slider carries on playing.
The readout on the picture is relative to the mark itself, so `+0.00s` is the
instant you tapped, and the hairline under it is where you are in the window.

There is no way from review back to idle except through recording — press
RECORD then END, which will not nag you because a fresh bout has no marks.

## Setting the window

**before / after** live behind the ⓘ now — they are set once rather than while
looking. Find the numbers that suit and tell me what they were.

## What to look for

**Tap ⓘ.** What is worth reading there:

- *camera* — the resolution and frame rate the phone actually granted, how long
  one frame is, and what container it recorded. Safari records MP4; everything
  else records WebM.
- *marks — page clock vs camera clock* — the two timings for each mark, and a
  button to switch which one places them. If the moment you marked sits visibly
  off-centre, try the other clock and see whether it lands better. **This is the
  thing most worth reporting back.**
- *recording* — how big the bout was, which is the number to watch if a long
  afternoon ever gives trouble.

**Frame stepping is gone**, along with the measurement that used to be the first
line of this panel. The slider is now the only way through a moment, which was
the right call for a screen with fewer things on it — but it does mean the
slider has to be able to land where you want. If it turns out it cannot, two
small ±1 frame buttons beside it bring both the stepping and the measurement
back, and that is a ten-minute change.

## What it deliberately does not do

No saving, no settings screen, no audio, and nothing kept between bouts.

## Reporting back

- Can the slider land on the frame you want, or does it skid past it?
- Did the marked moment land where you expected, or early, or late?
- What did you end up setting *before* and *after* to?
- Did anything stop the camera — a notification, the screen sleeping, switching
  apps?
- How hot did the phone get, and how long did you film for?
