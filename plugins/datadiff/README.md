# datadiff — before/after diffs for a query or a function

Runs a SQL query or a data-processing function against the working tree,
then again against an older git ref, and shows the row-level difference: rows
added, rows removed, rows changed and which columns, plus a chart of any
numeric column whose total moved. `SKILL.md` next to this file is the
agent-facing version; this one is for setting it up on your machine.

## What you need

- **git.** The "before" state is rebuilt by swapping the query or function
  file to a ref, same trick `uidiff` uses for screenshots.
- **Node 21+.**
- **`snowsql`**, only if you diff a `--query` target. A `--function` target
  needs nothing beyond Node — it imports the module and calls the named
  export directly.
- **`typescript` in the target repo**, only if you diff a `--function` target
  written in TypeScript that uses enums, decorators, or parameter properties.
  Plain type annotations need nothing extra on Node 23.6+, which strips types
  on its own; on anything older, every TypeScript target needs that
  `typescript` install.

## Installing it

Same paths as every plugin in this repository — see the top-level
[README](../../README.md) for the marketplace URL. Once installed,
`datadiff` and its `SKILL.md` resolve out of the plugin directory the same
way `uidiff`'s do.

## Setting it up for a repo

```bash
cd <repo>
datadiff init      # writes .datadiff.json
```

Fill in `sql.connection` with a `-c` connection name from
`~/.snowsql/config` if you'll diff SQL queries. Skip this entirely if you'll
only diff `--function` targets — they need no config.

```bash
datadiff doctor
```

Confirms `snowsql` is on `PATH`, the connection name is set, and there's no
leftover git swap from an interrupted run.

## Diffing a query

```bash
datadiff compare --query reports/daily_active_users.sql --key user_id
datadiff canvas --query reports/daily_active_users.sql
```

`--key` matches rows between the two runs by that column; without it, rows
are matched by position, which shows every row as changed if the query's own
ordering changed. `--param name=value` (repeatable) fills `{{name}}`
placeholders in the SQL file.

## Diffing a function

```bash
datadiff compare --function lib/transform.mjs#normalizeRows --input fixtures/sample.json --key id
datadiff canvas --function lib/transform.mjs#normalizeRows
```

`--input` is a JSON file passed as the function's single argument — the same
fixture both the "before" and "after" run see, so the diff is purely the
code's own change. Each run happens in its own process, so import-time caches
and module-level state can't carry "before" into "after".

TypeScript targets work directly, including the resolution rules a real app
relies on — `tsconfig.json` `baseUrl` and `paths` aliases (following
`extends`), extension-less and `index.ts` imports, and enums or decorators
that Node's own type-stripping rejects:

```bash
datadiff compare --function apps/fpm/src/utils.ts#calHeadcountByPath --input fixtures/rows.json
```

Enums and decorators need the repo's own `typescript` installed; without it,
plain type annotations still run on Node's built-in stripping. Nothing is
type-*checked* either way.

## Showing the page too

A data change usually exists because something renders it. `--ui` captures
that page before and after the same swap the row diff used, through the
`uidiff` CLI, and puts the drag-slider in the same canvas as the table:

```bash
datadiff compare --function apps/fpm/src/utils.ts#calHeadcountByPath \
  --input fixtures/rows.json \
  --ui /fpm/dashboard \
  --ui-root ../pam-core_frontend \
  --ui-reload-wait 40000
```

- `--ui-root <dir>` — the repo whose `.uidiff.json` names the dev server, for
  when the code and the page it feeds live in separate repos. The swap still
  happens in the repo you ran `datadiff` from.
- `--ui-reload-wait <ms>` — how long that dev server needs to pick up the
  swapped file. Server-side code means a recompile; if both frames look the
  same, raise this first.
- `--ui-click`, `--ui-hover`, `--ui-wait`, `--ui-wait-for`, `--ui-settle`,
  `--ui-full-page` — the same page-state flags `uidiff` takes, in order.

The dev server has to be serving the changed code for this to mean anything,
which for a backend target means running it in watch mode.

Needs the `uidiff` plugin installed beside this one, or `uidiff` on your PATH,
or `UIDIFF_BIN` pointing at it.

## Scope

Narrow on purpose, same spirit as `uidiff`:

- Tabular output only really diffs meaningfully — a query or function that
  returns an array of objects. A scalar or a single nested object still
  works, but is shown as one row rather than a real table.
- SQL support is `snowsql` only for now. Adding another warehouse means
  another thin `lib/sql.mjs`-style wrapper around its own CLI, not a driver
  dependency.
- A canvas embeds every row inline, so a huge result is capped at
  `rowLimit` (default 500, set in `.datadiff.json`) before it's shown —
  the console output from `compare` itself is always exact and uncapped.

## Testing it as a plugin

Symlink your checkout into Cursor's local plugin directory and reload the
window:

```bash
ln -s "$PWD" ~/.cursor/plugins/local/datadiff
```

## Before opening a PR

- `node --test test/*.test.mjs` passes.
- If you changed behaviour a human would notice, update `README.md` and/or
  `SKILL.md` in the same PR.

## Licensing

Apache-2.0, same as the rest of this repository.
