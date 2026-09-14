# blastradius — what does this change actually reach?

**Status: design only. Nothing here is built.** This is the write-up of a
question we kept hitting while using `uidiff`, and what a plugin answering it
would look like. It is here so the next person to reach for it starts from the
measurements rather than from the idea.

The question is the one a reviewer asks first and a tool answers worst: a diff
touches eleven files, and which pages, endpoints or dashboards does that
actually change? Today the answer is a guess, and `uidiff` inherits the guess —
you type `uidiff compare /reports/overview` because you already suspected
`/reports/overview`. A change nobody suspected goes uncaptured.

## The measurement that shapes the whole design

Before designing anything, we walked the real import graph of a private
Next.js app-router codebase — roughly 1,200 source files, 113 page and layout
files — and asked how far three changed files actually reach.
`probe/reach-probe.mjs` in this folder reproduces it against any app-router
checkout:

| Changed file                           | Routes reached | Files walked |
| -------------------------------------- | -------------- | ------------ |
| a design-system `Button`                | 79 of 113      | 539          |
| a shared `lib/api-headers` module       | 4              | 64           |
| a single feature chart component        | 2              | 20           |

Read the bottom rows and the tool looks excellent: two routes out of a hundred
and thirteen is a precise answer, and it is exactly the input `uidiff` wants.
Read the first row and it is worthless — seventy-nine routes is not an answer,
it is the app.

**That asymmetry is the design, not a caveat to it.** Reach analysis is sharp
on feature code and degenerate on shared primitives, and the tool has to know
which one it is holding. `uidiff` already has the right instinct here: it
refuses to capture a change that could not look different, and a refusal is
usually correct. The same discipline applies. Past some fraction of all entry
points the honest output is "this is a shared primitive, reach cannot narrow
it — review it as one," not a list.

Getting that wrong in the other direction is the failure mode to fear. A tool
that prints seventy-nine routes trains people to skim it, and then it is
furniture.

## What it would do

One real command, with the same `--before-ref` convention as its siblings:

```bash
blastradius                      # what does the working tree reach?
blastradius --before-ref main    # ...against another ref
blastradius --format json        # machine-readable, for other tools
blastradius --capture            # screenshot every reached route via uidiff
```

Default output is prose plus a Cursor Canvas: the changed files, what they
reach, and the walk that connects them, so a reviewer can check the reasoning
instead of trusting it.

## How it would work

Start from `changedAgainst(root, ref)`, already exported from the shared
git-swap module and pure — this is static analysis, so nothing on disk is ever
swapped and none of the destructive machinery is involved. Drop files that
cannot matter using `uidiff`'s `lib/visual.mjs` classifier. Build a reverse
import graph over the repo, then walk outward from each changed file until the
walk hits something that counts as an entry point.

The whole trick is resolving an import specifier to a file.
`@/components/Button` has to become `src/components/Button/index.tsx`, which
means `baseUrl`, `paths` and `extends` chains — and `datadiff` already solved
exactly this in `lib/tsconfig.mjs` for its TypeScript loader. Two plugins
needing it is the bar this monorepo set for `shared/`, so it should move there
as part of this work.

Entry points are per-framework:

- **Next.js app router.** `app/**/page.tsx`, with route groups stripped and
  dynamic segments kept — a `(marketing)` directory must vanish from the URL
  while `[slug]` survives. Nested groups are common and compose.
- **NestJS.** `@Controller('orders')` plus the method decorators gives
  `GET /orders/:id`. Crude regex, but NestJS puts the path in the source, so
  it finds controllers without resolving the module graph.

Roughly: changed files, filtered, walked up a reverse import graph,
terminating at route and controller files. The probe does it in about three and
a half seconds across 1,200 files with no caching, so performance is not a
design constraint.

## What it reuses

Most of this plugin is assembly, which is the argument for building it here
rather than anywhere else. `shared/lib/gitswap.mjs` for the changed-file list,
`shared/lib/project.mjs` for config and artifacts, `shared/lib/canvas.mjs` for
output, `datadiff`'s `tsconfig.mjs` once promoted, and `uidiff`'s `visual.mjs`
for the first filter. New code is the graph walk and the entry-point detectors.

`--capture` is the payoff, and the seam already works: `datadiff --ui` resolves
an installed `uidiff` out of the plugin cache today, so driving one capture per
reached route is a loop around a binary we already know how to find. It should
cap the number of routes and refuse outright in the `Button` case, for the same
reason the text output does.

## Scope

The things it will not do, stated up front rather than half-supported:

- **`next/dynamic` with a computed path is invisible**, as is any import
  assembled from a string. The graph is static.
- **Barrel files inflate reach.** Everything re-exported through an `index.ts`
  looks reachable from everything that imports the barrel, and a real codebase
  has dozens of them. Treating re-export-only files as pass-through helps and
  does not fully fix it.
- **NestJS providers swapped by injection token are not traced.** The graph
  sees imports, not the container.
- **It reports reach, not risk.** "Seven routes import this transitively" is
  the claim. "This breaks seven pages" is not, and the wording of every output
  should keep that line visible.

## The part worth doing next, and why it is hard

Cross-repo. A reviewer looking at a backend change is not asking which
controller changed, they are asking which dashboard moves — and answering that
means joining `@Controller('orders')` on one side to `fetch('/orders')` on the
other, across a repo boundary the import graph does not cross. Endpoint string
matching gets some of the way, generated clients get further, and neither is a
weekend. It is deliberately out of a first version, and it is the reason the
first version might be worth building at all.

## Testing

The same shape as the other two: synthetic repos under `/tmp` built with the
shared `makeRepo` helper, no network and no real checkout. The cases that
matter are route derivation (groups stripped, dynamic segments kept), barrel
pass-through, import cycles terminating, alias resolution through an `extends`
chain, and the refusal firing at the threshold. Entry-point detection against a
real framework is the part unit tests will not honestly cover.

## Open questions

Whether it is a plugin or a flag on `uidiff` — it has no output of its own that
a reviewer wants, only an input `uidiff` is currently missing. Whether the
threshold is a fraction of entry points, an absolute count, or something that
notices a file is a design-system primitive by where it lives. And whether the
name survives: `uidiff` and `datadiff` describe what they compare, and this
compares nothing.
