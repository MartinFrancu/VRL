# Changelog

One entry per chunk, newest first, marked with the chunk's own letter:

- **R** — refactor: different structure, same behaviour
- **B** — bugfix: it now does what it was always supposed to do
- **D** — development: it does something new, or stops doing something

See `.claude/skills/chunks/SKILL.md` for the agreement these letters come from.

## 1.1.48

- **D** — A moment shows only its own mark's hits. Two marks close together
  share footage, and the hits placed on the next mark used to show while
  looking at this one — on review, behind the summary and in the saved video.
  Now each mark's hits are its own.

## 1.1.47

- **D** — A hit's ring comes up only just before its moment — 0.08s, two or
  three frames, down from 0.2s — and still fades over the half-second after:
  before the hit, a ring is a spoiler. Both times are now settings, under
  Settings & diagnostics, kept on the phone, and the same on review, on the
  summary's background and in the saved video.

## 1.1.46

- **D** — Step mode, for going through a moment frame by frame. A switch in
  the top-left corner of the review picture turns **Drag** into **Step**: a
  tap on the left half of the picture then goes back one frame, on the right
  half forward one. Dragging still works in Step mode, and while placing hits
  a tap still places a hit. The same choice is under Settings & diagnostics,
  and the phone remembers it.

## 1.1.45

- **B** — Chrome, left to itself, writes a recording with a single keyframe at
  the very start, so every seek while reviewing decoded from the start of the
  recording: slower the further into an exchange, and on a phone slow enough
  to leave the picture behind the thumb. Recordings now carry a keyframe
  every half second where the browser takes the option (Chrome does), at the
  cost of slightly larger files. The saved cut gets them too.

## 1.1.44

- **B** — Dragging through a moment could leave the picture behind the thumb,
  or frozen until it stopped, on phones that seek slowly. Every movement asked
  the player for a new position, and a player asked again before it has shown
  the last one starts over. Now there is one seek at a time, and whatever the
  thumb asks for meanwhile replaces whatever was waiting: the picture moves in
  steps on a slow phone, but it always moves, and it ends exactly where the
  thumb stopped. The readout and the hits follow the thumb at once, as before.

## 1.1.43

- **B** — Saving on Android said "Permission denied". The video was handed to
  the share sheet with its full type — "video/webm;codecs=vp9" — and Chrome on
  Android turns down a file whose type carries codec details. It is now handed
  over as plain "video/webm" or "video/mp4". And if a share sheet turns the
  video down for any other reason, the panel offers Download in place of
  Share, so a saved video is never stuck.

## 1.1.42

- **D** — The start screen: START is a big round button in the middle of the
  camera's picture, and opening a saved bout is a 📂 button beside **?** at
  the top, the same size. The row of buttons below the picture is gone until
  filming starts, which gives the picture more room. Neither button shows
  while filming.

## 1.1.41

- **D** — **Open saved bout**, on the start screen (not while filming). It
  picks a zip saved with Save raw and puts the bout back on the summary as it
  was saved — every exchange, mark and hit, the ticks, the title, the lead and
  tail — to re-cut with Save cut, annotate with ✎, save raw again, discard, or
  carry on filming into with BACK. The recordings are read as slices of the
  file picked, not into memory. A zip that is not one the app saved — or one
  unpacked and zipped up again, which compresses it — is refused, saying why,
  as is a bout saved by a newer version of the app.

## 1.1.40

- **D** — **Save raw**, beside **Save cut** (the old SAVE) and Discard on the
  summary. One zip, named for the day: every exchange's whole recording,
  untouched; `bout.json`, the bout written down in full — every mark, every
  hit with its side and its x and y, which marks were ticked, the title, the
  lead and tail, when each exchange was filmed and the shape of its picture,
  and which version of the app wrote it; and `markers.csv`, the same marks and
  hits as a table, times in each file and on the clock, positions as
  fractions and in pixels. Nothing is played through or re-encoded, so it is
  quick. The zip is written without copying the footage — a phone holding a
  bout twice is a phone closing the tab — and is checked in the tests against
  a standard zip library and Python's zipfile. It works with nothing ticked:
  the raw files are the whole bout.

## 1.1.39

- **D** — The logo at the end of the saved video holds for 0.7s instead of a
  full second.

## 1.1.38

- **B** — A bout filmed with the phone upright saved as a landscape video,
  squashed, whenever it had been reviewed first — the usual way to the
  summary — or annotated from the summary. The saved video took its shape
  from whatever the review screen's player held at the time, and by then it
  held nothing, so it fell back to a landscape default. It now takes the
  shape of the first moment's own recording. A moment filmed the other way up
  from the first is fitted in with bars at its sides, not squashed. The tests
  now film from an upright camera too.

## 1.1.37

- **D** — The saved video loops back to its start. It opens on its first
  picture, with no fade up from black; and after the logo's second, over a
  split second, that first picture comes back as the logo shrinks into its
  corner — so the last frame is the first, and a Short or a Reel replays
  without a cut. The video is 0.4s longer for it.

## 1.1.36

- **D** — The title moves to the end: whatever is typed in the title field goes
  on the charcoal card after the last moment, big and white, on two lines if
  one would be too wide — in place of the hit count, which shows there only
  when there is no title. Nothing is written over the start of the video any
  more; that is the action's. The length on the summary counts the title's
  card as soon as one is typed.

## 1.1.35

- **D** — A new ending for the saved video. The last moment fades out onto a
  charcoal card with a soft spotlight — a neutral grey, so it neither flashes
  in a dark-mode feed nor sinks in a light one. On it, for 0.8s, each side's
  hit count, big, red and blue — on a card of its own rather than over the
  footage; then, after a quick cross, the full logo for a second. No hits, no
  numbers card. The corner logo no longer glides into the middle: it fades
  out with the footage.

## 1.1.34

- **D** — When the saved video has moments from more than one exchange, the
  first moment of each says which it is — "Exchange 2" — for a second and a
  half, below where a title would be, dipping to black at the join with
  everything else. Numbered as on the summary. From a single exchange there
  is nothing to tell apart, and no labels.

## 1.1.33

- **D** — The end card counts the hits: under the logo, a red number and a blue
  one — each side's hits in the moments saved, in its own colour, coming up as
  the logo arrives. A hit inside two overlapping moments counts once. With
  nothing annotated there are no numbers, just the logo.

## 1.1.32

- **D** — A title field on the summary. Whatever is typed there goes over the
  first two seconds of the saved video, big and white in the top third, then
  fades out; left empty, the video has no title at all. It belongs to the
  bout, so the next bout starts with the field empty.

## 1.1.31

- **D** — The logo in the saved video moves to the top-left corner. The bottom
  of a Short or a Reel is covered by its caption, the account name and the
  buttons, which is exactly where it was.

## 1.1.30

- **D** — The full logo moves from the start of the saved video to its end. It
  opens straight on the action, with the small logo in the corner, since
  viewers of a short video decide in its first second; over the last
  half-second of the last moment the logo grows into the middle and holds
  there alone on black for a second. Ending on black, it loops cleanly into a
  start that fades up from black.

## 1.1.29

- **R** — A test pins down that the saved video has no soundtrack at all, as it
  never has: the camera is opened without the microphone. Nothing changes;
  sound, when it comes, will be a decision rather than an accident.

## 1.1.28

- **D** — The turned-phone warning is pictures only: the huge red **!** over a
  phone with turning arrows, in place of the sentence, which was one more
  thing to read mid-exchange. Screen readers still get "Turn the phone back".

## 1.1.27

- **D** — The saved video opens on the full SBA logo, large and solid in the
  middle of a black frame, for a second; it then shrinks into its corner over
  half a second while the first moment comes up beneath it, and stays there.
  The video is a second longer, and the length on the summary counts it.

## 1.1.26

- **B** — The test build stamps saved videos with the SBA's real gold logo,
  not its blue one. Blue stays on the test build's home-screen icons, which is
  what it is for; a video leaves the phone and should look like the real thing.

## 1.1.25

- **D** — While filming, turning the phone the other way from how it was held
  at START (upright to sideways, or back) puts a huge red **!** over the
  picture with "Turn the phone back — this is being filmed sideways". The
  recording keeps the shape it started in, so that is what is happening. It
  goes as soon as the phone is turned back, never shows outside filming, and
  taps still mark through it. Upside down is not counted: same shape.

## 1.1.24

- **D** — The saved video carries the SBA logo in its bottom-left corner,
  slightly see-through, from the first frame to the last — through the dips
  to black as well. It is sized by the picture's shorter side, so portrait
  and landscape videos get the same logo. The logo is now part of the offline
  cache, so this works in a hall with no signal.

## 1.1.23

- **D** — The moment looping behind the summary shows its hits, as review and
  the saved video do, so what is being ticked is seen with its annotations.

## 1.1.22

- **D** — Discard sits beside SAVE on the summary, in place of End bout in the
  corner, and asks once. After a successful save the panel says **✓ Saved**
  and offers New bout, which needs no asking since the bout has just been
  saved, or Back to the bout. It says so only once the share sheet is done
  with the video, or the download has started — closing the sheet without
  choosing anything saves nothing and says nothing.

## 1.1.21

- **D** — Annotating from the summary. ✎ beside a mark opens it on the review
  screen, in its own exchange's footage, with the annotating bar open. BACK or
  Done comes back to the summary with the ticks as they were — and the mark
  just annotated ticked, since annotating it says it matters.

## 1.1.20

- **D** — Points are gone. On review a pencil (✎) takes POINT's place and
  opens the annotating bar straight away, on whichever colour was used last.
  A mark with hits shows a dot on its tab, and on the summary its hits as dots
  in their colours. The summary now opens with the annotated marks ticked, or
  every mark when nothing was annotated.

## 1.1.19

- **D** — Hits are in the saved video: a ring in the fighter's colour at the
  spot each was tapped, coming up just before its moment and fading over the
  half-second after, exactly as on the review screen — the same drawHits()
  draws both. A hit near a join dips to black with the rest of the frame.

## 1.1.18

- **D** — Hits. After a point is given on review, tapping the picture places
  a hit where it landed, at the moment on screen: any number per mark, each in
  the colour chosen on a bar that also has Undo and Done. Dragging still moves
  through the moment, so a hit goes in at the frame it landed on. Each shows
  over the picture as a ring in the fighter's colour, coming up 0.2 s before
  its moment and widening as it fades over the 0.5 s after. A tap on the black
  bars beside the picture is not a hit, and outside placing a tap on the
  picture still does nothing. Hits are separate from the point, so a double
  where nobody scores still has two to show. Not yet in the saved video.

## 1.1.17

- **D** — Points. On review, **POINT** gives the mark on screen to red or
  blue, or takes its point away; its tab fills with the fighter's colour. The
  summary shows whose each point is, and opens with only the pointed marks
  ticked — the moments the bout turned on — so saving straight away makes the
  video of those. A mark's point is the first of scoring in the data, and the
  least of it: which fighter, not what was hit or under which rules.

## 1.1.16

- **D** — A bout is now the whole fight, filmed in exchanges. BACK from review
  keeps the exchange and goes straight on to film the next one, instead of
  throwing it away. END ends the bout and opens the **summary**: one section
  per exchange, a checkbox per mark, the last one touched looping behind the
  list. SAVE there makes one video of the whole bout, exchange by exchange,
  switching between recordings as it goes. BACK on the summary carries on the
  bout; End bout throws it away, asking first. SAVE is gone from review — a
  point button takes its place next. The summary shows how much footage the
  bout is holding in memory.

## 1.1.15

- **R** — What the code called a bout — one recording and its marks — is now
  an **exchange**, the word the screen will use for it. A bout is about to mean
  the whole fight, made of several exchanges, and one word for two things would
  have been a standing source of confusion. Names and their comments only; the
  browser tests did not change and all pass.

## 1.1.14

- **B** — Saving a video left an iPhone on a black screen. A phone opens its
  share sheet only straight after a tap, and the app asked for it when the
  recording finished — seconds after SAVE was pressed. The phone refused, and
  the app fell back to a download link, which on an iPhone opens the video in
  place of the app with no way back. Now the finished video waits behind a
  **Share** button, so the share sheet is asked inside a tap of its own, and
  the page never clicks a download link for the referee. The panel it sits in
  also gets the same box as the discard question, which it had been missing.

## 1.1.13

- **D** — The saved video dips briefly to black at every join instead of
  cutting hard from one moment to the next. Each moment fades in and out over
  200 ms inside its own time, so the video is no longer for it; while the next
  moment is being found the frame is plain black rather than a flash of
  wherever the clip landed. Checked in the saved file itself, by reading the
  brightness of its frames: a recorder with the fades removed fails that test.

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
