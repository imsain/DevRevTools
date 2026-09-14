# DevRevTools

Developer-productivity plugins for Cursor and Claude Code, distributed from one
repository. Each plugin is independent — install just the one you want — but
they share this repo's issue tracker, CI, and contribution process.

## Plugins

- **[uidiff](plugins/uidiff/)** — before/after UI screenshots and pixel-accurate
  diffs for a local dev server.
- **[datadiff](plugins/datadiff/)** — before/after row-level diffs for a SQL
  query or a data-processing function, shown as a table and chart.

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

## Updating an installed plugin

**Installs do not follow this repository.** Adding a marketplace pins it to
the commit that was current at the time, and Cursor caches the plugin at
`~/.cursor/plugins/cache/<marketplace>/<plugin>/<sha>/`. New commits here —
including ones you can see on GitHub — never reach a machine that installed
earlier. Nothing notifies anyone, and the plugin keeps working, which is what
makes this easy to miss.

The obvious command does not currently help. `cursor-agent plugin marketplace
update devrevtools` re-indexes from Cursor's side rather than from your
checkout, and for a marketplace added by git URL it reports success with
`0 plugins indexed` while the cache stays where it was. That is a known Cursor
bug, not a misuse.

Removing and re-adding is what actually works:

```bash
cursor-agent plugin marketplace remove devrevtools
cursor-agent plugin marketplace add https://github.com/imsain/DevRevTools
```

Re-adding brings back the marketplace, not your plugins, so install the ones
you want again afterwards. Then run **Developer: Reload Window**, since
skills are read at startup.

Two things worth checking while you are in there. `cursor-agent plugin
marketplace list` should show this repo exactly once; adding it under two
names lists every plugin twice. And an uninstalled marketplace can leave an
orphaned directory behind in the cache, which is harmless but confusing when
you are working out which copy is in play.

If you are changing a plugin rather than using one, skip all of this and
symlink your checkout into `~/.cursor/plugins/local/` instead — see the
plugin's `CONTRIBUTING.md`.

## Adding a plugin to this repo

1. Create `plugins/<name>/` with its own `.cursor-plugin/plugin.json` (and
   `.claude-plugin/plugin.json` if it should also work in Claude Code).
2. Add an entry to `.cursor-plugin/marketplace.json` and
   `.claude-plugin/marketplace.json` at the repo root, with
   `"source": "./plugins/<name>"`.
3. Give it its own `README.md`, `CONTRIBUTING.md`, and test suite — plugins in
   this repo are otherwise independent of each other.
4. Run `npm run sync` to give it a copy of `shared/`.

## Shared code

Both plugins need the same git swap, the same project and config resolution,
the same argument parsing, and the same canvas slider. None of it can be
imported across plugins at runtime: a plugin is installed as a directory on
its own — the cache holds `<marketplace>/<plugin>/<sha>/` with no siblings —
and there is no `node_modules` there to resolve a package from.

So `shared/` is the only editable copy, and `npm run sync` vendors it into
each plugin as `lib/shared/` and `test/shared/`, alongside a copy of
`LICENSE`. Those copies are generated; edit `shared/` and re-run the sync. CI
runs `npm run sync:check`, which fails if a copy was edited in place.

What stays per-plugin is the part that genuinely differs: each binds the
shared code to its own error type, cache directory and config defaults in its
`lib/project.mjs`.

## License

Apache-2.0. See `LICENSE`. Each plugin may add its own `NOTICE`.
