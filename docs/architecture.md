# Architecture — the target

Not what the app is today. Today it is one 689-line file, `solo.js`, holding
twenty-seven module-level variables with the DOM as its state machine. That got
a working app into referees' hands quickly and it cannot carry what comes next.

This is the shape being moved towards, the reasoning behind it, and the order of
the moving. Nothing here is a commitment to build anything in particular; it is
a commitment about *where a thing goes* when it is built.

## What it has to carry

Two use cases, and only two.

1. **Instant replay** — film a bout, mark moments, look at each of them when the
   fight is stopped. This exists and works.
2. **A short video out of it** — the marked moments cut together into something
   worth showing. This is next.

**Awarding points is deliberately not here.** There will be many rule sets and
nobody knows yet which is worth having, so scoring is treated as a floating
variable: the architecture's job is to make it unobservable until it settles.
See "Where the undecided things live".

Two forces beyond the use cases:

- **Several phones, eventually.** Not now. But nothing may be built that would
  have to be torn up to get there.
- **One place to change how video is made.** Swapping a codec must not touch the
  UI, the look, or the swiping.

## The principle

Layers, each sharing a data structure with exactly one neighbour — so a change
to a structure can break at most one other layer.

That rule needs one refinement to be workable, and the refinement is what makes
the codec boundary hold:

- **Opaque handles** may cross every layer. You hold one, you pass it back, you
  never look inside. There is no shape to depend on, so there is nothing to
  break when the inside changes. `MediaHandle` is the only one.
- **Structured data** crosses exactly one boundary. Its fields are read, so its
  shape is a contract.

## The layers

| | Layer | Responsibility | Must not know about |
|---|---|---|---|
| 0 | **Media** | The codec boundary. Decode a frame at a position; encode frames into a file. `MediaRecorder`, mime negotiation, WebCodecs, muxing — here and nowhere else. | marks, bouts, screens |
| 1 | **Capture** | Camera and recorder lifecycle → one finished recording with a clock that can be trusted. The orientation rule, the duration measurement, the lag between pressing record and the first encoded frame. | what a mark means, storage |
| 2 | **Bout** | Several recordings on one shared clock, and the events on them. Marks are added here. **Alignment between angles lives here and only here.** Produces cuts. | pixels, codecs, the DOM |
| 3 | **Render** | Given an ordered list of spans and a sink, produce pictures. Seeking, stepping, the window around a mark. | why a span exists, storage |
| 4 | **UI** | Elements, styling, gestures. Asks for a position; displays whatever array of pictures comes back. | codecs, blobs, clocks, files |
| 5 | **Store** | Bouts surviving a reload: save, list, load, delete, and coping with a full phone. | pixels, the DOM |

Adding a mark is Bout's write side rather than a layer of its own. Holding the
marks and ordering them are the same responsibility, and splitting them would
leave the ordering invariant somewhere with nothing to enforce it against.

## The contracts

| Structure | Flows | Parties |
|---|---|---|
| `MediaHandle` | **opaque** — never inspected | everyone, by design |
| `Take` | Capture → Bout | 2 |
| `Cut` | Bout → Render | 2 |
| `Frameset` | Render → a sink (screen, or encoder) | 2 |
| `BoutRecord` | Bout → Store | 2 |
| `Mark` | — | **inside Bout only** |

`Mark` never leaving Layer 2 is the one that matters most. Render is handed
spans, not marks. So when a mark grows fields — whichever rule set eventually
wins — nothing outside Bout can break.

## The two things this makes true

**Replay and the highlight video are one operation.** Both are: take an ordered
list of spans, produce pictures. Replay sends them to a screen; the highlight
sends them to an encoder. One mechanism, two sinks.

**So is trimming for storage.** Keeping only the marked windows instead of the
whole recording is that same operation with a file as the sink. Which is why the
whole-bout-versus-snippets question can wait: it is an argument to a call, not a
shape.

## The data structures, as a first guess

Deliberately thin. Every one of these is expected to grow; the point is that
each grows in one place.

```ts
type MediaHandle = { readonly __opaque: unique symbol };

interface Take {              // one continuous recording from one source
  id: TakeId;
  source: string;             // which phone, which camera
  startedAtMs: number;        // on the bout's clock
  durationMs: number;
  media: MediaHandle;
}

interface Mark {              // one noted instant, on the bout's clock
  id: MarkId;
  atMs: number;
}

interface Bout {
  id: BoutId;
  filmedAt: string;           // ISO, for a human
  clock: Clock;               // how takes are placed against each other
  takes: Take[];
  marks: Mark[];
}

interface Span {              // a stretch worth showing, from some takes
  fromMs: number;
  toMs: number;
  takes: TakeId[];
  label?: string;
}

interface Cut { spans: Span[] }

interface Frameset {          // what one instant looks like
  atMs: number;
  pictures: Picture[];        // one per angle. Length 1 today
}
```

`Frameset.pictures` being an array when there is only ever one picture is the
single most important line here. "What does this moment look like?" answering
with a list means several phones is a different *number*, not a different
design. Everything above Layer 2 is already written for it.

`Bout.clock` is where that number becomes real: solo means "the one take's own
clock", several means "a shared epoch each take is offset against". The hard
part stays in one place.

## Where the undecided things live

| Undecided | Lives in | Costs to change later |
|---|---|---|
| Whole recordings or just the marked windows | Store, as an argument | One call site |
| Which codec, and whether WebCodecs | Layer 0 only | Layer 0 only |
| Labels burned into the file, or drawn on screen | Render's sink | One sink |
| What a mark means — fighter, hit type, whether it scored | `Mark`, inside Bout | Bout only |
| Which rule set scores a bout | Not modelled at all yet | — |

## Where today's code goes

Mostly relocation rather than rewriting. The device-coupled parts were expensive
to get right and should move with their internals and their comments intact.

| Layer | From `solo.js` / `windows.js` |
|---|---|
| 0 Media | `pickMimeType`, the `Blob` assembly in `finish`, `measureDuration`, `releaseClip`, the blob URL |
| 1 Capture | `openCamera`, `watchPreviewFrames`, `followOrientation`, `orientationChanged`, `onCameraLost`, `startRecording`, `stopRecorder`, `filmed`, `keepAwake`, and — corrected below — `markAt`'s two readings, `markMs`, `markSource`, `frameClockUsable` |
| 2 Bout | `marks`, and all of `windows.js` |
| 3 Render | `seekTo`, `select`, `renderPosition`, `watchShownFrame`, `clampWithin`, `draggedTo`, `positionMs` |
| 4 UI | every `el(...)`, `screenIs`, `renderDots`, `renderTabs`, `markActiveTab`, `tickElapsed`, the confirm dialog, help, diagnostics, the wiring block |
| 5 Store | nothing yet |

`windows.js` moving into Bout brings its 18 tests with it unchanged, which is
why Bout is a good place to start: the first layer out has a net already.

### Correction, from building Bout

This table first put `markMs`, `markSource` and `frameClockUsable` in Bout.
Writing Bout showed they belong in **Capture**, and the change is worth stating
rather than quietly making.

Those three exist to turn a device instant into an offset into a recording —
choosing between the page's clock and the camera's, and refusing a camera clock
that never ran. That is a question about a recording and the device that made
it, which is Capture's subject, and it is where every other device quirk already
lives. Bout should be handed marks already resolved onto the bout's clock.

The payoff is that `Mark` stays `{ id, atMs }`. If Bout held both readings, the
iOS quirk would be visible in the type that Store and the AI dataset are built
from, and a device's oddity would have leaked into the format. Capture resolves
it at stop, when it has all the readings and can see whether the camera's clock
ran.

## How the tests come along

Three tiers, each with a different job. **No tests are retrofitted onto
`solo.js`** — it is already covered from the outside, and testing its insides
would mean testing the thing being dismantled.

1. **The browser suite (`e2e/`, 17 tests).** Does not change during the
   refactor. That is the entire point of it: it is the evidence that behaviour
   did not move. If a rewiring chunk needs an e2e test changed, the chunk was
   not a refactor.
2. **New layer tests.** Written TDD, test first, in TypeScript. Cheap, because
   layers 0–3 and 5 are pure or nearly so.
3. **`windows.js`'s 18 tests.** Carried into Bout as they are.

The rhythm per layer, two chunks:

- **`R:` build the layer** with its tests, not yet wired to anything. Dead code,
  so behaviour is unchanged by definition.
- **`R:` wire the app to it** and delete what it replaced. The browser suite
  staying green is the proof.

Two chunks rather than one so that "did I model it right" is separable from "did
I wire it right". Once the pattern is proven on the first layer or two, later
ones can merge them.

## The order, and where it has got to

1. ~~**Contracts**~~ — `src/contracts.ts`. Done.
2. ~~**Bout**~~ — `src/bout/`. Done.
3. ~~**Capture**~~ — `src/capture/`, split into `clock.ts` (pure, where the
   worst bug lived) and `capture.ts` (the lifecycle). Done.
4. ~~**Render**~~ — `src/render/playhead.ts`. The pure half only; the screen
   sink is still the shell seeking a `<video>` element. Done enough.
5. ~~**Media**~~ — `src/media/media.ts`, the thinnest wrapper that works. Done.
6. **Store**, then the highlight video. Not started.

Layer 4, the shell, is still `solo.js` in plain JavaScript, and that is
deliberate. It is the layer the browser tests cover from the outside, the layer
with no logic worth extracting, and the one where a blind rewrite would risk
the most for the least — the help screen, the diagnostics panel, the lead and
tail sliders, the wake lock and the orientation re-acquire are all in it and
none of them is covered by a test.

### Each layer split in two

A pattern that was not planned and turned out to matter: every device-coupled
layer divides cleanly into a part that is pure and a part that is the browser.

| Layer | Pure, unit-tested | The browser, covered end-to-end |
|---|---|---|
| Capture | `clock.ts` — which clock to believe | `capture.ts`'s recorder, and the shell's camera |
| Render | `playhead.ts` — gestures, readout, clamping | seeking a `<video>` element |
| Media | `preferredMimeType` | `MediaRecorder`, blobs, duration measurement |

The pure halves hold most of the logic and all of the arithmetic, which is
where this app's bugs have actually lived. The browser halves are thin, and
their quirks are the ones that cannot be tested on a desktop anyway.

## The build step

`src/` is TypeScript. `app/` is what `tsc` emits — plain ES modules, no bundler
— and it is committed, because Pages serves the branch as it is and `git push`
being the deploy is worth keeping. CI rebuilds and fails on any difference, so
a stale `app/` cannot ship quietly.

The alternative, having Pages deploy from a workflow that builds and refuses a
red build, is still the better end state and still not done: it would also gate
the deploy on green tests. It is a change to how the site is published, so it
wants doing deliberately rather than in passing.

## Why not Angular

The multi-camera version is an Angular app and should be — it has an operator
console, forms, routing and many cameras. This one has three screens and a drag.

What makes this app work at all is that there is nothing to install: open a URL,
add it to the home screen, and it runs with no signal. The whole app is about
50 KB of source. A framework runtime would be several times the thing it was
added to, and it would touch only Layer 4 — the layer that already works and
has no logic left in it worth managing.

There is also a specific trap worth naming. The two worst bugs in the
multi-camera version were both *a bound input not being updated synchronously
after its source signal was set* — the rename field wiping itself, and the trim
nudges moving the wrong distance. That class of bug does not exist in an app
with no framework, and adding one would import it.

**TypeScript yes, framework no.** The types caught real mistakes immediately —
see the branded ids, which make a take's id unusable where a mark's is wanted —
and cost nothing at runtime, because they are erased entirely.

## Open questions

- **Do the highlight video's labels need to be in the file, or is on screen
  enough?** Burned in means WebCodecs and a muxer, which is the heaviest single
  piece of work in this plan. To be answered by the feature description rather
  than guessed at.
- The two in [BACKLOG.md](BACKLOG.md): whether BACK should discard without
  asking, and what a mark eventually carries.
