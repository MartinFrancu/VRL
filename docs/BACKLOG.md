# Backlog

Things noticed and deliberately not done. A chunk has exactly one intention
(see `.claude/skills/chunks/SKILL.md`), so anything found along the way that
belongs to a different one lands here instead of riding along.

Unordered. Nothing here is a commitment.

## Open questions — decide before building

- **Should BACK discard the bout without asking?** Today it does: leaving review
  for the recording screen throws the marks away on the reasoning that you have
  just looked at them. Deliberately left out of the characterization suite in
  1.1.3, because freezing it in a test would turn an unexamined choice into a
  commitment. Decide what it should be, then test that.

- **What does a mark mean?** Today a mark is only an instant — the millisecond
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
