# Contributing

See the "Contributing" section in `README.md` for what kinds of changes are
actually useful — this file is just the mechanics.

## Setup

No install step: the tool has zero runtime dependencies.

```bash
git clone https://github.com/imsain/DevRevTools.git
cd DevRevTools/plugins/uidiff
node --test test/*.test.mjs
```

Node 21+ and git are all you need for the test suite. ImageMagick is optional
for it — the image tests skip themselves when it is absent — but install it
(`brew install imagemagick`) if you're touching `lib/report.mjs` or
`lib/wipe.mjs`, and run `uidiff compare` by hand for anything touching
`lib/cdp.mjs` or the auth code in `lib/project.mjs`, since the automated tests
can't reach Chrome, auth, or a dev server.

The tests build throwaway git repos and commit to them, so a global
`core.hooksPath` hook that expects a real project — a secret scanner, most
likely — will fail them for reasons that have nothing to do with your change.
If `git commit` is what's failing, that's why; whatever variable skips your
hook will get the suite green.

## Testing it as a plugin

Symlink your checkout into Cursor's local plugin directory and reload the
window:

```bash
ln -s "$PWD" ~/.cursor/plugins/local/uidiff
```

The skill resolves the CLI from its own installed directory, so this exercises
the same path a teammate's install takes. `$UIDIFF_BIN` overrides it when you
want a specific checkout to win.

## Before opening a PR

- `node --test test/*.test.mjs` passes. CI runs this on macOS on every PR.
- `npx prettier --check .` if you touched formatting-sensitive files.
- If you changed behaviour a human would notice (a new flag, a changed
  default, a different report), update `README.md` and/or `SKILL.md` in the
  same PR. They're the only docs this project has.
- Keep the scope narrow. This is a deliberately small, macOS-only tool — see
  `README.md`'s "Scope" section before adding a new platform, framework, or
  dependency.

## Reporting a bug

Include your OS/Chrome/Node versions, the command you ran, and — if it's
about a diff being wrong or missed — the two PNGs from `~/.cache/uidiff` if
you're comfortable sharing them.

## Licensing

By contributing, you agree your contribution is licensed under Apache-2.0,
the same as the rest of the project.
