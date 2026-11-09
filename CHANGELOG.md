# Changelog

One entry per chunk, newest first, marked with the chunk's own letter:

- **R** — refactor: different structure, same behaviour
- **B** — bugfix: it now does what it was always supposed to do
- **D** — development: it does something new, or stops doing something

See `.claude/skills/chunks/SKILL.md` for the agreement these letters come from.

## 1.1.12

- **D** — A **Save** screen of its own. SAVE on review now opens it rather
  than saving straight away: one checkbox per mark, every one ticked, and
  behind the list the moment last ticked or unticked loops at double speed so
  the choice can be seen as it is made. SAVE there records only the ticked
  marks, in the order they happened whatever order they were ticked in. The
  screen is opened with a bout and the name of the screen that opened it, so
  it can be reached from elsewhere later and goes back to wherever that was.

## 1.1.11

- **D** — **SAVE**: the marked moments of a bout, saved as one short video and
  handed to the phone's share sheet. It is the same `Cut` the review screen
  gets, sent to a recorder instead of a picture — which is what made this one
  small module rather than a feature's worth of work. Recorded by drawing the
  clip into a canvas and recording that stream, so it needs no encoder, no
  muxer and no dependency; the price is that it runs in real time and
  re-encodes. Overlapping stretches are not merged yet, so a second covered by
  two marks appears twice. The diagnostics panel now says whether a device can
  do any of it.

## 1.1.10

- **B** — The test build's blue was in the wrong place. It was painted behind
  the whole icon; what was wanted was the kite *inside* the logo recoloured,
  with the hawk and the white ground left alone. `tools/recolour-logo.mjs`
  rotates the gold's hue rather than swapping one colour for another, so the
  antialiased edges of the kite come with it instead of leaving a gold fringe.
  The SBA's real logo is not touched — the recoloured copy exists only in the
  generated test build.

## 1.1.9

- **B** — The test build's service worker was deleting the real app's offline
  cache. Caches belong to an origin, not a scope, so a build served from
  `/VRL/next/` shares a store with the app at `/VRL/`, and the stock cleanup
  deletes every cache that is not its own — so merely opening the test build
  would have left a referee's installed app unable to open in a hall with no
  signal. `npm run preview` now narrows that cleanup to `vrl-next-*`.

## 1.1.8

- **D** — `npm run preview` builds a test copy of the app that cannot be
  mistaken for the real one: the SBA hawk on blue, "SBA NEXT" on the home
  screen, its own offline cache, and TEST beside the version inside the app.
  Generated rather than committed, deliberately — baking test branding into
  the sources would put a blue icon on every referee's phone the day the
  branch merged. The code is copied byte for byte; only the branding, the
  cache name and that one label differ.

## 1.1.7

- **R** — The rest of the separation, and the wiring. `src/capture/` (filming
  one bout, split into the pure clock and the lifecycle), `src/render/`
  (the playhead, gestures and readout) and `src/media/` (the codec boundary —
  the only file that knows mp4 from webm). `solo.js` is now the shell only:
  the camera, the elements, the gestures. `windows.js` is gone, its arithmetic
  living on in Bout and the playhead with equivalent tests. 58 unit tests and
  the 17 browser tests all green, the latter unchanged throughout, which is
  what says behaviour did not move. TypeScript now compiles to `app/`, which
  is committed so `git push` is still the deploy; CI rebuilds and fails on any
  drift. The service worker's shell list gained the compiled layers and its
  cache name was bumped, without which the app would work online and break in
  a sports hall.

## 1.1.6

- **R** — The Bout layer: `src/bout/bout.ts`, with 14 tests written against it
  test-first. Marks in the order they happened, a duplicate id refused, how far
  a bout reaches (the furthest angle, not the first to stop), and cutting it
  down to what is worth watching. One mark cut is instant replay; several is the
  highlight video; they are the same function. Eleven mutations, eleven kills,
  no survivors. Nothing is wired to it yet, so behaviour is unchanged. Two
  findings recorded rather than acted on: the clock-choosing code belongs in
  Capture, not here (`docs/architecture.md`), and serialising a bout kept as
  snippets does not model cleanly yet, so it waits for Store
  (`docs/BACKLOG.md`). Also fixes the `unit` test project, which only matched
  root-level `.js` and so silently ran none of the new tests.

## 1.1.5

- **R** — `src/contracts.ts`: the shapes the layers agree on, as TypeScript
  types and nothing else. No runtime, no imports, nothing wired — it exists so
  the data structures can be argued about before logic is written against them.
  TypeScript is type-checked only (`npm run typecheck`, now part of `npm test`
  and so of CI) and compiled never, because nothing in `src/` has reached the
  browser; vitest transpiles it for tests on its own. The checker was verified
  by making six mistakes on purpose — a take's id passed as a mark's, a read
  inside an opaque handle, a write to a read-only field, an unchecked array
  index, a record version of 2, an explicitly-undefined optional — and watching
  each one be refused.

## 1.1.4

- **R** — `docs/architecture.md`: the shape being moved towards, as six layers
  each sharing a data structure with one neighbour. Records the two findings the
  design turns on — that answering "what does this moment look like?" with an
  array makes several phones a different number rather than a different design,
  and that instant replay, the highlight video and trimming for storage are one
  operation with three sinks. Also where each undecided thing lives so it can
  stay undecided, where today's code goes, and why no framework. Nothing built.

## 1.1.3

- **R** — The workflow is pinned from the outside by 17 browser tests, driving
  the real app in real Chromium against a synthetic camera: filming, marking,
  reviewing, dragging, the asking before a bout is thrown away, and opening with
  the network cut. No behaviour changed. Each test was checked by breaking the
  app on purpose and watching it fail — ten mutations, ten kills, including the
  one that reproduces the bug where every mark of a bout landed on the same
  instant. They run in CI on every push, on every branch, so a change can be
  seen green before it becomes the thing referees are using. The https
  certificate they need is now generated on first use rather than assumed to
  exist, so the suite works from a clean clone.

## 1.1.2

- **D** — The working agreement now matches this repository. `CHANGELOG.md` and
  `docs/BACKLOG.md` exist, the paperwork clause names the two manifests this
  repo actually has, and the TDD file no longer describes the multi-camera
  version's `src/core/`, hub fixtures and test list. The end-to-end cap of ten
  is lifted here: in a single-file app the browser tests are the only ones that
  can see anything, so they carry the suite rather than supplementing it.

## 1.1.1 and earlier

Before this changelog existed. The two commits this repository was started with:

| Version | | |
|---|---|---|
| 1.1.1 | D | Named SBA Replay Lite, with the SBA hawk as its icon, a help screen, a QR code to pass it on, and a README that describes it |
| 1.1.0 | D | No limit on how many marks a bout can take |

Everything before that happened in `MartinFrancu/VideoReferee`, on the branch
`claude/videoreferee-solo`, which is where the solo version was prototyped
before it moved here to be hosted. That branch is frozen and its README points
back at this repository.
