# Changelog

One entry per chunk, newest first, marked with the chunk's own letter:

- **R** — refactor: different structure, same behaviour
- **B** — bugfix: it now does what it was always supposed to do
- **D** — development: it does something new, or stops doing something

See `.claude/skills/chunks/SKILL.md` for the agreement these letters come from.

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
