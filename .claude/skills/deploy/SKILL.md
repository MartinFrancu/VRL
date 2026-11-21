---
name: deploy
description: How this app reaches phones — the live app at /VRL/ from main, the test build at /VRL/next/ from the development branch, both published by the `pages` workflow. Test builds are never committed to main. Use whenever a change should be tried on a phone, when asked to deploy, release or "put it on next", when checking what version is live, and before touching main, .github/workflows/pages.yml or tools/make-preview.mjs.
---

# Two builds, one site, nothing committed for a test

GitHub Pages serves one site, `https://martinfrancu.github.io/VRL/`, built by
the **`pages`** workflow (`.github/workflows/pages.yml`) — not straight from a
branch. It holds two builds:

| Where | What | Comes from | Goes out when |
|---|---|---|---|
| `/VRL/` | **The live app** — what referees have installed | `main`, exactly as it is | `main` is pushed |
| `/VRL/next/` | **The test build** — blue kite, "SBA NEXT", its own offline cache, `TEST` beside the version | the **development branch**, put through `npm run preview` | the development branch is pushed **and its tests pass** |

## The rules

1. **Never commit a test build to `main`.** No `next/` folder, no `preview/`
   output, nothing generated. The workflow builds `/next/` itself, every time.
   (This replaced committing `preview/` into `main/next/` by hand, up to 1.1.49.)
2. **`main` changes only when the live app does,** and only with an explicit yes
   from Martin — the same as any commit outside the branch being worked on (see
   the `chunks` skill). Merging into `main` *is* releasing: it goes straight to
   every installed phone.
3. **To put a change on the test build, push the development branch.** That is
   the whole procedure. Its `tests` workflow runs; if it is green, its last job
   (`next`) asks for a `pages` run on `main` naming the branch; that run builds
   `main` at the root and the branch at `/next/` and publishes both. A red run
   publishes nothing.

## Which branch is the development branch

The repository variable **`NEXT_BRANCH`** (Settings → Secrets and variables →
Actions → Variables), or, when it is not set,
`claude/vrl-characterization-suite` — the default written in both
`.github/workflows/pages.yml` and `.github/workflows/tests.yml`. When work moves
to a new branch, set the variable; nothing needs committing anywhere. A one-off
test build from some other branch: run `pages` by hand from the Actions tab
with that branch in its `next` box.

## Checking what is out

A push is not a deploy until the `pages` run is green and the site says so:

```bash
curl -s "https://martinfrancu.github.io/VRL/solo.js?$(date +%s)" | grep -m1 "VERSION ="       # live
curl -s "https://martinfrancu.github.io/VRL/next/solo.js?$(date +%s)" | grep -m1 "VERSION =" # test build
```

The `pages` run also prints both versions in its "Put the test build at
/next/" step. Expect a few minutes after the push: the tests (about ten), then
the build (a few). Without `gh`, the run's status is at
`https://api.github.com/repos/MartinFrancu/VRL/actions/runs?branch=main&per_page=1`.

A phone picks a new version up on the **second** open after a deploy: the
service worker serves the cached one and fetches the new one behind it.

## Setup, already done once

- **Settings → Pages → Source: "GitHub Actions".** With "Deploy from a branch"
  instead, `pages` fails at its deploy step and the site stays as it was.
- `pages.yml` must exist **on `main`**: a run asked for with `--ref main` uses
  main's copy. Keep the copy on the development branch identical, so merging
  changes nothing.

## Things that bite

- **Caches are per origin, not per path.** The live app and the test build
  share one cache store on `martinfrancu.github.io`. `tools/make-preview.mjs`
  gives the test build its own cache name and narrows its cleanup to
  `vrl-next-*`, so opening it can never delete the live app's offline cache.
  Do not undo that; see `docs/BACKLOG.md` for the other direction.
- **`npm run preview` rewrites the icons** to make the blue ones and then puts
  the real ones back, not always byte for byte. If `icon-*.png` show as
  modified after running it locally, `git checkout -- icon-180.png icon-192.png
  icon-512.png`; never commit them from a preview run.
- **The test build is generated, so edit the generator, not the output.** What
  differs between `/next/` and `/` lives in `tools/make-preview.mjs` and
  nowhere else.
