---
name: tdd
description: The TDD working agreement for this repo — red/green/refactor discipline, batch size, where the levels are, and when to stop and ask. Use whenever writing or changing code, and whenever adding or reordering tests. Follows tdd.mooc.fi.
---

# TDD in this repo

Sits inside the chunk scheme — see the `chunks` skill for which of R/B/D a piece
of work is, and what tests are expected to do in each. This file is the loop
used within one.

Based on [tdd.mooc.fi](https://tdd.mooc.fi/). The rules there are written for a
human who feels friction. An agent does not feel friction, so this file adds the
checkpoints that make the friction visible anyway.

## The three laws

1. Do not write production code unless required by a failing test.
2. Do not write more of a test than is required to fail.
3. Do not write more production code than is sufficient to pass the one failing test.

## The loop, with the checkpoints that matter

For each item on the list agreed in the chunk description:

1. **Write one test.** Name it as a sentence about behaviour, not about the
   implementation. The bar: *if all production code vanished, could someone
   rebuild it from the test names alone?*
2. **Run it and read the failure.** Predict how it will fail first, then check the
   prediction. **Paste the failure output into the conversation.** This is not
   ceremony — it is the only thing separating a real test from one that asserts
   nothing, and asserting nothing is the single most common way an agent's test
   suite goes green while the code is broken.
3. **Make it pass, minimally.** Hardcoding is allowed and often correct. Let the
   next test force the generalisation (triangulation).
4. **Refactor** while green — remove duplication, improve names. Never change
   behaviour and structure in the same step.
5. **Commit.** One test-plus-implementation per commit where practical, so the
   history reads as the sequence of decisions.

## Batch size

Work in batches of **three to five tests**, then report. Not one — that makes the
human a bottleneck on trivia. Not a whole feature — that loses the design
feedback, which is the entire point.

**Exception: the first batch against any new module is one or two tests.** The
shape of a new interface is the expensive thing to get wrong, and it is cheapest
to correct before there are five tests pinning it in place.

## Stop and ask when

- A **public interface** would change, or a new module would appear. Design
  decisions belong to the human.
- A test needs **disproportionate setup** — more than ~10 lines, or more than one
  test double. Report it as a design smell rather than absorbing it. *This
  replaces the annoyance a human would have felt.* Say what was awkward and what
  the design might want instead; do not silently write the awkward test.
- A test would be **deleted or weakened** to get to green.
- The agreed list runs dry.
- More than a few minutes of thrashing: prefer `git reset --hard` and smaller
  steps over pushing through.

## The test list

There is no test-list file here. The list is the one written out in the chunk
description and agreed before building — the `chunks` skill requires that
description anyway, so the list is already where the yes was given.

What that costs: a list only lives as long as the conversation. So anything
noticed mid-loop and not being done now goes to `docs/BACKLOG.md` in the same
commit, which is the part that does have to outlive the session.

## Characterization tests are the one exception to law 1

Law 1 says no production code without a failing test. Pinning behaviour that
already works inverts it: the code exists, and the test is written to pass
first time against it.

That makes step 2 of the loop — read the failure — impossible as written, and
it is the step that catches a test asserting nothing. So substitute for it:
**break the behaviour on purpose, watch the new test go red, then put it back.**
Paste that red into the conversation the same way. A characterization test that
was never seen to fail is decoration.

## What good tests look like here

- **Sensitive to behaviour, insensitive to structure.** A test that breaks when a
  function is renamed but not when the answer changes is a liability.
- **One thing per test. One failing test per bug.**
- **No sleeps.** Poll or await an event. A sleep is either flaky or slow, usually
  both.
- **Only fake what we own.** Do not mock `MediaRecorder`, the filesystem, or a
  socket — put our own seam in front of it and fake that.
- **Time is a parameter, never a global.** Nothing in a pure module calls
  `Date.now()` or `performance.now()`; the caller passes the instant in.
  `windows.js` is the example — it does arithmetic on milliseconds handed to it,
  which is why a sign error in it is catchable at all.
- **Assert relationships, not clock readings.** A browser test films a real
  recording, so the millisecond a mark lands on differs every run. "the second
  mark is later than the first" holds; "the second mark is at 2.933s" is a
  coin toss dressed up as an assertion.

## Levels, and where to spend effort

Two levels, and — unlike the multi-camera version — **the slow one carries the
suite**. That inversion is deliberate and worth understanding before arguing
with it.

- **Unit — the pure modules.** `windows.js` today: milliseconds in,
  milliseconds out, no DOM and no browser. Fast, deterministic, and where TDD
  proper runs. Every piece of logic that *can* live here should, because this is
  the only level where a test is cheap.
- **End-to-end — Playwright, real Chromium, fake camera.** `e2e/`. Everything
  else: the mode machine, the recorder's lifecycle, the blob plumbing, the
  seeking, the gestures. **No cap.**

The multi-camera version caps end-to-end tests at about ten, because there it
has a large pure core beneath it and the browser is only there to check the
wiring. Here there is no such core — the app is one file of DOM code — so a cap
would mean most of the behaviour going untested. Lift the cap, and accept the
cost: the browser tests take tens of seconds, so `npm run test:unit` is what you
run while working and `npm test` is what you run before releasing.

The honest way to shrink this level is to move logic *down* into pure modules
until the browser tests only have the browser left to check. That is a refactor,
and it is the direction of travel — not a reason to skip the test today.

## What the browser cannot tell us

The fake camera runs in headless Chromium on a desktop. The two worst bugs this
app has had — a live stream's `mediaTime` stuck at zero on iOS, and the camera
stream's shape being frozen at `getUserMedia` time — **would both pass this
suite green.**

So the suite is not the whole net. It covers logic and wiring. Device behaviour
is covered by a short list run by hand on a real phone before a release, and by
the quirks recorded as comments at the line each one bit. Never delete one of
those comments during a refactor without carrying it to the new line.

## The failure modes this file exists to prevent

Three things go wrong when an agent runs this loop unsupervised. If a batch feels
smooth, suspect one of these:

1. **Skipping red.** Writing test and implementation together, then running once.
   The test may assert nothing and nobody would know. Mitigated by step 2.
2. **Over-implementing.** Writing the general solution because it is obvious,
   which discards the design pressure that makes the next test easy to write.
   Mitigated by law 3 and small batches.
3. **Absorbing pain.** Cheerfully writing 40 lines of setup instead of treating
   that as the design telling us something. Mitigated by the stop-and-ask rule.
