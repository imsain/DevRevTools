---
name: datadiff
description: >-
  Show a before/after row-level diff of a SQL query or a data-processing
  function as a table and chart, using the `datadiff` CLI. Rebuilds the
  "before" state by swapping the query or function file to an earlier git
  ref, runs both, and diffs the rows. Use proactively whenever an edit could
  change what a SQL query or a data-transform function returns — a changed
  WHERE clause, a changed join, a changed calculation, a changed filter —
  and there is a git repo to rebuild "before" from. Refuses up front when
  before and after are identical, so it never shows a diff that isn't real.
---

# datadiff

Runs a SQL query or a JS data-processing function twice — once against the
working tree, once against an older git ref — and shows what changed between
the two results: which rows were added, removed, or changed, and by how much
any numeric column's total moved.

## Finding the CLI

Resolve `datadiff` in this order, same as `uidiff`:

1. `$DATADIFF_BIN`, if set — an explicit override.
2. `command -v datadiff` — on `PATH` already.
3. `bin/datadiff.mjs` relative to this `SKILL.md` file — the installed
   plugin's own copy, found without knowing where Cursor put it.

```bash
datadiff() {
  if [ -n "$DATADIFF_BIN" ]; then node "$DATADIFF_BIN" "$@";
  elif command -v datadiff >/dev/null 2>&1; then command datadiff "$@";
  else node "$(dirname "$0")/bin/datadiff.mjs" "$@"; fi
}
```

## First run in a repo

```bash
datadiff init      # writes .datadiff.json — fill in sql.connection if using SQL
datadiff doctor     # checks snowsql, config, and any pending swap
```

`init` is only needed for the SQL path — a `--function` target needs no
config at all, since there is nothing to connect to.

## Diffing a SQL query

```bash
cd <repo>
datadiff compare --query path/to/query.sql --key id
```

- `--key <column>` matches rows between before/after by that column. Without
  it, rows are matched by position — a change that only reorders rows will
  then show every row as "changed". Prefer a key whenever the query result
  has one.
- `--param name=value` (repeatable) fills `{{name}}` placeholders in the SQL
  file before it runs — for a query that takes a date range or a region, say.
- `--before-ref <ref>` picks what "before" means (default `HEAD`, i.e. the
  working tree vs. the last commit — the change in progress).

The SQL itself runs via `snowsql -c <connection>`, the connection named in
`.datadiff.json`'s `sql.connection` — configure that once per repo the same
way `uidiff` records a dev-server port.

## Diffing a data-processing function

```bash
datadiff compare --function lib/transform.mjs#normalizeRows --input fixtures/sample.json --key id
```

`lib/transform.mjs#normalizeRows` names the file and the export to call.
`--input` is a JSON file passed as the function's one argument — the same
fixture both runs are called with, so the diff is purely the effect of the
code change. The function's own module is swapped to `--before-ref` the same
way the SQL file is; if the behaviour change actually lives in a helper it
imports rather than the named file itself, swap that helper too by pointing
`--before-ref` and the target at whichever file actually changed.

The function's result has to survive `JSON.stringify`, and each run happens
in a fresh process, so a module that counts calls or caches at import time
reports the same thing both times rather than leaking "before" into "after".

### TypeScript targets

`--function` takes a `.ts` file directly:

```bash
datadiff compare --function apps/fpm/src/utils.ts#calHeadcountByPath --input fixtures/rows.json
```

The repo's own resolution rules are honoured, which is what makes real
application code reachable rather than only standalone scripts:

- `tsconfig.json` `baseUrl` and `paths` aliases, including through `extends`,
  so `import { x } from 'lib/utils'` resolves the way the compiler resolves it
- extension-less and directory (`index.ts`) imports
- syntax Node cannot strip by itself — enums, decorators, parameter
  properties — by transpiling through the repo's installed `typescript`

If a repo has no `typescript` installed, plain type annotations still work via
Node's own stripping, but an `enum` or a decorator anywhere in the import graph
fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Installing `typescript` in that
repo is the fix.

Type *checking* never happens — only stripping and transpilation. A target
that does not compile cleanly still runs, exactly as it would under `tsx`.

## Showing the result

```bash
datadiff canvas --query path/to/query.sql
# or the matching --function target
```

Reads the run `compare` just saved and writes a Cursor Canvas with the diff
as a table (each changed cell showing `old → new`, added/removed rows marked)
plus a bar chart of any numeric column whose before/after total moved — the
part a table alone doesn't make legible when a lot of rows changed by a
little. Percentage and rate columns are averaged and listed separately
instead of charted, since summing them produces a meaningless number and
plotting one next to a headcount hides it against the axis.
Link the printed path so the user can open it, e.g.
`[Diff](/absolute/path/to/datadiff-....canvas.tsx)`.

`canvas` reads what `compare` already ran and saved — it does not re-run the
query or function, so call `compare` first with the same `--query`/
`--function` target.

## What it refuses to do

Same principle as `uidiff` refusing to screenshot an invisible change:
`compare` says `identical: nothing differs...` and stops, rather than saving
or showing a diff, when before and after produce exactly the same rows.
Report that to the user instead of treating it as a result.

A large result is capped (`rowLimit` in `.datadiff.json`, default 500) before
it is saved for `canvas` — a canvas embeds its data inline with no `fetch`,
so an unbounded result would make the file itself the problem. The counts
`compare` prints to the console are always exact and uncapped; only what
`canvas` can show is limited.
