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
  needs nothing beyond Node — it dynamically imports the module and calls the
  named export directly.

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
code's own change.

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
