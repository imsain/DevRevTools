#!/usr/bin/env node
// datadiff — before/after diffs for a SQL query or a data-processing function.
//
//   datadiff init
//   datadiff doctor
//   datadiff compare --query <file.sql> [--param k=v]... [--before-ref HEAD] [--key col]
//   datadiff compare --function <file.mjs>#<export> [--input <file.json>] [--before-ref HEAD] [--key col]
//   datadiff canvas --query <file.sql> | --function <file.mjs>#<export>
//   datadiff restore
//
// Same shape as uidiff, for the same reason: name the thing to run on the
// command line rather than in a saved preset, rebuild "before" by swapping
// the one file that changed to an older git ref, and refuse to show a diff
// that isn't real.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  DataDiffError,
  configPath,
  loadConfig,
  outDir,
  projectName,
  readJson,
  repoRoot,
  slugFor,
  writeJson
} from '../lib/project.mjs';
import { numberFlag, paramFlags, parseArgs } from '../lib/args.mjs';
import { hasPendingSwap, restoreSwap, swapToRef } from '../lib/gitswap.mjs';
import { runQuery, fillParams, resolveSqlMode } from '../lib/sql.mjs';
import { describeMcp } from '../lib/mcp.mjs';
import { parseFunctionTarget, readInput, runFunction } from '../lib/function.mjs';
import { diffRows, numericColumnSummary } from '../lib/diff.mjs';
import { buildCanvasCode, writeCanvas } from '../lib/canvas.mjs';
import { captureFrame, requireUidiff, uiSteps } from '../lib/ui.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** What to run and what file its "before" state comes from swapping. */
function targetFromArgs(root, args) {
  const queryPath = args.flags.query;
  const functionTarget = args.flags.function;
  if (queryPath && functionTarget) {
    throw new DataDiffError('pass --query or --function, not both');
  }
  if (queryPath) {
    const absolute = resolve(root, String(queryPath));
    if (!existsSync(absolute)) {
      throw new DataDiffError(`no such file: ${absolute}`);
    }
    return {
      kind: 'query',
      label: `query ${relative(root, absolute)}`,
      file: relative(root, absolute),
      absolute
    };
  }
  if (functionTarget) {
    const { file, exportName } = parseFunctionTarget(String(functionTarget));
    const absolute = resolve(root, file);
    return {
      kind: 'function',
      label: `function ${relative(root, absolute)}#${exportName}`,
      file: relative(root, absolute),
      absolute,
      exportName
    };
  }
  throw new DataDiffError(
    'name what to run: --query <file.sql> or --function <file.mjs>#<export>'
  );
}

async function runTarget(root, config, target, args) {
  if (target.kind === 'query') {
    const sql = fillParams(readFileSync(target.absolute, 'utf8'), paramFlags(args));
    return runQuery(root, config, sql);
  }
  const input = readInput(args.flags.input);
  return runFunction(target.absolute, target.exportName, input, root);
}

/** Caps an array so a huge result doesn't get embedded whole in a canvas —
 * canvases have no `fetch`, everything they show has to fit in the file. */
function limitRows(value, limit) {
  if (!Array.isArray(value) || value.length <= limit) {
    return { value, truncated: false, total: Array.isArray(value) ? value.length : 1 };
  }
  return { value: value.slice(0, limit), truncated: true, total: value.length };
}

async function commandCompare(root, config, args) {
  const target = targetFromArgs(root, args);
  const beforeRef = args.flags['before-ref'] ?? 'HEAD';
  const key = args.flags.key ? String(args.flags.key) : undefined;

  // One swap serves both halves. The page is captured inside the same
  // before/after window as the data, so the table and the screenshots cannot
  // drift apart, and a slow dev server only has to recompile twice.
  const ui = args.flags.ui
    ? {
        route: String(args.flags.ui),
        uiRoot: args.flags['ui-root'] ? resolve(String(args.flags['ui-root'])) : root,
        uidiff: requireUidiff(),
        steps: uiSteps(args),
        settle: numberFlag('ui-settle', args.flags['ui-settle']),
        fullPage: Boolean(args.flags['ui-full-page']),
        reloadWait: numberFlag('ui-reload-wait', args.flags['ui-reload-wait'], 0)
      }
    : null;

  const after = await runTarget(root, config, target, args);
  console.log(`ran ${target.label} against the working tree`);

  let uiAfter = null;
  if (ui) {
    console.log(`capturing ${ui.route} as it is now...`);
    uiAfter = captureFrame({ ...ui, label: 'datadiff-after' });
  }

  const restore = swapToRef(root, beforeRef, [target.file]);
  let before;
  let uiBefore = null;
  try {
    before = await runTarget(root, config, target, args);
    if (ui) {
      // The server that renders the page has to notice the swapped file
      // before the frame is worth taking, and a compile is not instant.
      if (ui.reloadWait) {
        console.log(`waiting ${ui.reloadWait}ms for the dev server to reload...`);
        await sleep(ui.reloadWait);
      }
      console.log(`capturing ${ui.route} at ${beforeRef}...`);
      uiBefore = captureFrame({ ...ui, label: 'datadiff-before' });
    }
  } finally {
    const count = restore();
    console.log(`restored ${count} file(s) to their pre-swap contents`);
    if (ui?.reloadWait) {
      await sleep(ui.reloadWait);
    }
  }
  console.log(`ran ${target.label} at ${beforeRef}`);

  const diff = diffRows({ before, after, key });
  const summary = numericColumnSummary(before, after, key ? [key] : []);

  if (diff.identical) {
    console.log(`identical: nothing differs between ${beforeRef} and the working tree.`);
    return;
  }

  console.log(
    `${diff.added.length} added, ${diff.removed.length} removed, ` +
      `${diff.changed.length} changed, ${diff.unchanged.length} unchanged`
  );
  if (!diff.keyed && diff.tabular) {
    console.log(
      '  NOTE: no --key given, rows are matched by position. A change that' +
        ' only reorders rows will show every row as changed.'
    );
  }
  for (const entry of summary) {
    const move = Math.round((entry.after - entry.before) * 100) / 100;
    console.log(
      `  ${entry.column} (${entry.kind === 'sum' ? 'total' : 'average'}): ` +
        `${entry.before} -> ${entry.after}` +
        ` (${move >= 0 ? '+' : ''}${move.toLocaleString()})`
    );
  }

  const dir = outDir(root, slugFor(target.label));
  const beforeLimit = limitRows(before, config.rowLimit);
  const afterLimit = limitRows(after, config.rowLimit);
  writeJson(join(dir, 'run.json'), {
    target: target.label,
    meta: `${projectName(root)} · before = ${beforeRef}`,
    beforeRef,
    key: key ?? null,
    before: beforeLimit.value,
    after: afterLimit.value,
    truncated: beforeLimit.truncated || afterLimit.truncated,
    total: Math.max(beforeLimit.total, afterLimit.total),
    ui: ui ? { route: ui.route, before: uiBefore, after: uiAfter } : null
  });
  console.log(`saved: ${join(dir, 'run.json')}`);
  console.log(`run "datadiff canvas ${target.kind === 'query' ? '--query ' + target.file : '--function ' + target.file + '#' + target.exportName}" to view it.`);
}

async function commandCanvas(root, config, args) {
  const target = targetFromArgs(root, args);
  const dir = outDir(root, slugFor(target.label));
  const run = readJson(join(dir, 'run.json'));
  if (!run) {
    throw new DataDiffError(
      `no saved run for ${target.label}. Run "datadiff compare" with the same target first.`
    );
  }
  const diff = diffRows({ before: run.before, after: run.after, key: run.key ?? undefined });
  const summary = numericColumnSummary(run.before, run.after, run.key ? [run.key] : []);
  const meta = run.truncated
    ? `${run.meta} · showing first ${run.before.length ?? 0} of ${run.total} rows`
    : run.meta;
  const code = buildCanvasCode({ target: run.target, meta, diff, summary, ui: run.ui });
  const file = writeCanvas(root, `datadiff-${projectName(root)}-${slugFor(target.label)}`, code);
  console.log(`canvas: ${file}`);
  console.log('Open it beside the chat to see the row-level diff and any changed totals.');
}

function commandInit(root, args) {
  const path = join(root, '.datadiff.json');
  if (existsSync(path) && !args.flags.force) {
    throw new DataDiffError(`${path} already exists. Pass --force to overwrite.`);
  }
  // Written with all three ways present and commented, rather than one filled
  // in, because which one a repo wants depends on how it already reaches its
  // warehouse — and a config that silently prefers the wrong one is harder to
  // notice than one that refuses until a choice is made.
  writeJson(path, {
    '//': 'datadiff settings for this repo. A --function target needs no sql block.',
    '//sql.mode':
      'Which way to run a --query target: mcp, command, snowsql, or auto (the default: whichever one below is configured).',
    sql: {
      mode: 'auto',

      '//mcp':
        'Preferred. Runs the query through an MCP server that exposes a SQL tool. Use configPath + server to borrow the entry your IDE already uses, so the URL and token live in one place; or set url and tokenEnvVar here directly. tool/argument are only needed when the server names them unusually.',
      '//mcp-example': {
        configPath: '.cursor/mcp.json',
        server: 'snowflake'
      },

      '//command':
        'The escape hatch, and how to use any other warehouse: a command template. {{query}} is the statement, {{queryFile}} a temp file holding it, {{connection}} the value below. Set outputFormat to "json" if it prints a JSON array instead of CSV.',
      '//command-examples': [
        'snowsql -c {{connection}} -q {{query}} -o output_format=csv -o header=true -o timing=false -o friendly=false -o exit_on_error=true',
        'psql -d {{connection}} -f {{queryFile}} --csv',
        'bq query --format=csv --use_legacy_sql=false {{query}}',
        './scripts/run-query.sh {{queryFile}}'
      ],

      '//connection':
        'A -c connection name from ~/.snowsql/config, for snowsql mode or for {{connection}} above.'
    },
    rowLimit: 500
  });
  console.log(`wrote ${path}`);
  console.log(
    'Choose how SQL runs: point sql.mcp at an MCP server, or set sql.command,'
  );
  console.log('or set sql.connection for snowsql. Then run "datadiff doctor".');
}

/** Whether a program can be found, without running it — a SQL CLI invoked
 * with the wrong probe flag can open a prompt and hang. */
function onPath(program) {
  return spawnSync('which', [program], { encoding: 'utf8' }).status === 0;
}

/** Every line of a message under the heading it belongs to, since the useful
 * half of these is usually the part after the first line. */
function detail(message) {
  for (const line of String(message).split('\n')) {
    console.log(line.startsWith('  ') ? line : `  ${line}`);
  }
}

async function reportSqlSetup(root, config) {
  let mode;
  try {
    mode = resolveSqlMode(config);
  } catch (error) {
    console.log('sql: not configured — a --query target would refuse');
    detail(error.message);
    return;
  }
  console.log(
    `sql mode: ${mode}${config.sql?.mode === 'auto' ? ' (auto-detected)' : ''}`
  );

  if (mode === 'mcp') {
    try {
      const found = await describeMcp(root, config.sql.mcp ?? {});
      console.log(`  server: ${found.url}`);
      console.log(
        `  answers: yes${found.server ? ` (${found.server})` : ''}, ${found.tools.length} tool(s)`
      );
      console.log(`  queries would run through: ${found.tool}`);
    } catch (error) {
      console.log('  unreachable or unusable:');
      detail(error.message);
    }
    return;
  }

  if (mode === 'command') {
    const program = String(config.sql.command).trim().split(/\s+/)[0];
    console.log(`  command: ${config.sql.command}`);
    console.log(
      `  ${program}: ${onPath(program) ? 'on PATH' : 'not found on PATH'}`
    );
    console.log(`  output read as: ${config.sql.outputFormat ?? 'csv'}`);
    return;
  }

  const cli = config.sql?.cli ?? 'snowsql';
  console.log(`  ${cli}: ${onPath(cli) ? 'on PATH' : 'not found on PATH'}`);
  const connection = config.sql?.connection;
  console.log(
    `  sql.connection: ${connection && !String(connection).startsWith('REPLACE_ME') ? connection : 'not set — edit .datadiff.json'}`
  );
}

async function commandDoctor(root, config) {
  console.log(`repo: ${root}`);
  console.log(`config: ${configPath(root)}`);
  await reportSqlSetup(root, config);
  if (hasPendingSwap(root)) {
    console.log('WARNING: an unrestored git swap exists. Run "datadiff restore".');
  }
}

const HELP = `datadiff — before/after diffs for a SQL query or a data-processing function

  datadiff init [--force]
  datadiff doctor
  datadiff compare --query <file.sql> [--param k=v]... [--before-ref <ref>] [--key <column>]
  datadiff compare --function <file.mjs>#<export> [--input <file.json>] [--before-ref <ref>] [--key <column>]
  datadiff canvas --query <file.sql> | --function <file.mjs>#<export>
  datadiff restore                   undo an interrupted --before-ref swap

  --before-ref <ref>   the git ref to rebuild "before" from (default HEAD)
  --key <column>       match rows by this column instead of position
  --param k=v           fills {{k}} placeholders in a --query file, repeatable

  A --query target runs whichever way .datadiff.json configures: through an MCP
  server that exposes a SQL tool (including the one your IDE already uses), a
  command template for any other warehouse or a repo's own script, or snowsql.
  "datadiff doctor" says which one is in play. A --function target needs none.

  --ui <route>         also capture that route before and after, via uidiff,
                       and put the drag-slider in the same canvas as the table
  --ui-root <dir>      the repo whose .uidiff.json names the dev server, when
                       the page is served by a different repo than the code
                       being diffed (a backend change shown by a frontend)
  --ui-reload-wait <ms>  how long that dev server needs to pick up the swapped
                       file — a server-side change means a recompile
  --ui-settle <ms>     how long to wait for the page to stop fetching
  --ui-full-page       capture the whole document, not one screenful
  --ui-click <sel>     reaching the state you want, applied in the order
  --ui-hover <sel>     written and repeatable, same as uidiff's own steps
  --ui-wait <ms>
  --ui-wait-for <sel>
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];

  if (!command || command === 'help' || args.flags.help) {
    console.log(HELP);
    return;
  }

  const root = repoRoot();

  if (command === 'restore') {
    const count = restoreSwap(root);
    console.log(count ? `restored ${count} file(s)` : 'nothing to restore');
    return;
  }
  if (command === 'init') {
    commandInit(root, args);
    return;
  }

  const config = loadConfig(root);

  switch (command) {
    case 'doctor':
      await commandDoctor(root, config);
      return;
    case 'compare':
      await commandCompare(root, config, args);
      return;
    case 'canvas':
      await commandCanvas(root, config, args);
      return;
    default:
      throw new DataDiffError(`Unknown command: ${command}\n\n${HELP}`);
  }
}

main().catch((error) => {
  if (error instanceof DataDiffError) {
    console.error(`datadiff: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
