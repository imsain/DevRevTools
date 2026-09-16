# Contributing

See `README.md` for what the tool does; this file is the mechanics.

## Setup

No install step: the tool has zero runtime dependencies.

```bash
git clone https://github.com/imsain/DevRevTools.git
cd DevRevTools/plugins/datadiff
node --test test/*.test.mjs
```

Node 22+ and git are all the test suite needs. No warehouse is involved: the
MCP tests stand up a local HTTP server that speaks enough of the protocol to
answer a query, and the command-template tests use `node -e` as the "CLI", so
the transport, the tool discovery and the output parsing are all covered
without credentials. What the suite cannot cover is a specific vendor's server
— for anything touching `lib/mcp.mjs`, run `datadiff doctor` against a real
one, which connects and names the tool it would use.

The tests build throwaway git repos and commit to them. Those repos point
`core.hooksPath` at an empty directory, so a global hook that expects a real
project — a secret scanner, most likely — cannot fail the suite for reasons
that have nothing to do with your change.

## Shared code

`lib/shared/` and `test/shared/` are generated from `shared/` at the repo
root; see that README's "Shared code" section. Edit the originals and run
`npm run sync` from the repo root — CI fails if a vendored copy was edited in
place.

## The uidiff seam

`--ui` shells out to the `uidiff` CLI rather than importing it, because the
two plugins install separately. `lib/ui.mjs` finds it by `$UIDIFF_BIN`, then
the PATH, then an installed uidiff plugin in Cursor's or Claude's plugin
cache, then a sibling checkout. If you change how frames are captured, change
`uidiff capture` — it exists to be driven from here.

## Before opening a PR

- `node --test test/*.test.mjs` passes. CI runs this on every PR.
- If you changed behaviour a human would notice (a new flag, a changed
  default, a different canvas), update `README.md` and `SKILL.md` in the same
  PR.

## Licensing

By contributing, you agree your contribution is licensed under Apache-2.0,
the same as the rest of the project.
