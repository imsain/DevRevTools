# DevRevTools

Developer-productivity plugins for Cursor and Claude Code, distributed from one
repository. Each plugin is independent — install just the one you want — but
they share this repo's issue tracker, CI, and contribution process.

## Plugins

- **[uidiff](plugins/uidiff/)** — before/after UI screenshots and pixel-accurate
  diffs for a local dev server.

## Installing a plugin

Paste this repository's URL into Cursor's plugin search (Customize → Plugins),
or from the CLI:

```bash
cursor-agent plugin marketplace add https://github.com/imsain/DevRevTools
```

Then `/plugin` in a `cursor-agent` session, or the IDE's plugin picker, lists
every plugin in this marketplace individually — install only the ones you
need. Claude Code works the same way:

```bash
claude plugin marketplace add imsain/DevRevTools
claude plugin install uidiff
```

See each plugin's own `README.md` for what it does and how to set it up in a
repo.

## Adding a plugin to this repo

1. Create `plugins/<name>/` with its own `.cursor-plugin/plugin.json` (and
   `.claude-plugin/plugin.json` if it should also work in Claude Code).
2. Add an entry to `.cursor-plugin/marketplace.json` and
   `.claude-plugin/marketplace.json` at the repo root, with
   `"source": "./plugins/<name>"`.
3. Give it its own `README.md`, `CONTRIBUTING.md`, and test suite — plugins in
   this repo are otherwise independent of each other.

## License

Apache-2.0. See `LICENSE`. Each plugin may add its own `NOTICE`.
