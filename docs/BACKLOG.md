# Backlog

Things noticed and deliberately not done. A chunk has exactly one intention
(see `.claude/skills/chunks/SKILL.md`), so anything found along the way that
belongs to a different one lands here instead of riding along.

Unordered. Nothing here is a commitment.

## Settled

- **Should BACK discard the bout without asking?** No. A bout is now several
  exchanges, and BACK from review keeps the exchange and goes on to film the
  next; END ends the bout and opens the summary. Decided in 1.1.16.

## Open questions — decide before building

- **How does a bout saved as snippets read back?** Serialisation was left out of
  the Bout layer on purpose, because the snippets case does not model cleanly
  yet. `StoredTake.media` is a list of pieces, but `Take.media` is one handle.
  Reading back a bout kept as marked windows therefore wants one of:
  - `Take.media` becomes a list, and a take is assembled from pieces; or
  - each snippet reads back as its own short take, positioned by `startedAtMs`
    — which is tidier, except that `clock: { kind: 'take', take: t1 }` then
    names a take that no longer exists on its own.

  Neither is obviously right, and the answer depends on the whole-versus-windows
  decision below. `toRecord` and `fromRecord` should be written with Store, once
  that is settled, rather than guessed at now. Whole-footage serialisation is
  straightforward either way.

- **What does a mark mean?** A mark is now an instant and the hits placed on it. A point per mark was added in 1.1.17 and taken out again in 1.1.20, pending a choice of rule set. The rest below is still open. Before that, a mark was only an instant — the millisecond
  the referee pressed. Saving bouts and annotating hits will both want more from
  it (which fighter, what kind of hit, valid or not), and the save format has to
  have room for that before any phone writes a file in it. This is the question
  that shapes the next feature bundle.

## Improvements

- **Carry a manual trim forward.** From the multi-camera version: an offset set
  on one bookmark becomes the default for every later bookmark nobody has
  touched yet. Belongs there rather than here, but the reasoning is the same if
  this version ever grows per-mark adjustment.

- **Single-source the version.** It is written by hand in four places:
  `package.json`, twice in `package-lock.json`, and the `VERSION` constant in
  `solo.js`. A browser test checks the last against the first, which catches
  drift but does not prevent it. A build step, or the page fetching its own
  `package.json`, would — at the cost of a build step in an app that currently
  has none, which is most of its charm.

- **Narrow the live service worker's cache cleanup to its own caches.** `sw.js`
  deletes every cache that is not its own on activate. Caches belong to an
  origin rather than a scope, so anything else of ours published under
  `martinfrancu.github.io` shares that store — the test build at `/VRL/next/`
  did, and had to be patched by `tools/make-preview.mjs` so that opening it
  would not wipe the real app's offline cache. The patch only protects one
  direction: opening the real app still clears the test build's cache, which
  is harmless but will keep being mildly confusing. Filtering on a `vrl-`
  prefix fixes it properly, and wants doing next time `sw.js` is touched —
  it is a change to production code, so not slipped in alongside something
  else.

- **Derive the service-worker cache name from the version.** `sw.js` holds
  `vrl-v2`, bumped by hand. A chunk that renames a file without bumping it
  serves half an old app on the next launch.

- **A `/next/` path on the same Pages site.** Somewhere to try a build from a
  phone that is not the URL other referees already have installed.

## Known rough edges

- **`onCameraLost` after a bout.** It returns early when there is no recorder,
  but `recorder` is never set back to `null` once a bout has been filmed. So
  losing the camera while idle, after at least one bout, shows the "reload the
  page" note and forces idle, where losing it before any bout says nothing.
  Harmless either way; the message is just wrong in one of the two cases.

- **A bout lives only in memory.** Every exchange's footage is held until the
  bout ends, at roughly a megabyte a second of filming. A long bout could be
  more than a phone will hold, and the app being closed loses all of it. The
  summary shows how much is held, so a real tournament can say whether this
  bites before Store is built.
