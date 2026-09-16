// Getting rows for a .sql file, through whatever this repo already uses to
// reach its warehouse.
//
// There are three ways, and the reason there is more than one is that the
// connection is not this tool's to own. A team that can already query the
// warehouse has some way of doing it — an MCP server the IDE talks to, a CLI,
// a wrapper script with the right flags baked in — and datadiff's job is to
// borrow that, not to add a second credential path that can be configured
// wrong independently of the first.
//
//   mcp      the request the IDE makes, made from here (see lib/mcp.mjs)
//   command  a command template, which is also the repo-level escape hatch:
//            snowsql, psql, bq, dbt, or a script the repo provides
//   snowsql  the original hardcoded path, kept so existing configs still work
//
// No driver dependency in any of them, on the same principle as uidiff
// shelling out to git and Chrome's own protocol rather than adding npm
// packages.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataDiffError } from './project.mjs';
import { parseCsv } from './csv.mjs';
import { runMcpQuery } from './mcp.mjs';

export { parseCsv } from './csv.mjs';

/** Substitutes `{{name}}` placeholders — nothing fancier, same reasoning as
 * uidiff naming routes on the command line rather than in a config file: a
 * query that needs a real parameterised-query library was never going to be
 * made safe by string substitution, and this tool is for read queries run by
 * the person who already has warehouse access, not for building one. */
export function fillParams(sql, params) {
  const missing = [];
  const filled = sql.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => {
    if (!(name in params)) {
      missing.push(name);
      return match;
    }
    return params[name];
  });
  if (missing.length > 0) {
    throw new DataDiffError(
      `query needs --param for: ${[...new Set(missing)].join(', ')}`
    );
  }
  return filled;
}

/**
 * Which of the three ways this config asks for.
 *
 * An explicit `sql.mode` wins, so a repo with both an MCP server and a CLI can
 * say which one it means. Otherwise the most specific configuration present is
 * taken as the intent, and a config with none of them is an error that names
 * all three rather than defaulting to a CLI the machine may not have.
 */
export function resolveSqlMode(config) {
  const sql = config.sql ?? {};
  const declared = sql.mode && sql.mode !== 'auto' ? sql.mode : null;
  if (declared) {
    if (!['mcp', 'command', 'snowsql'].includes(declared)) {
      throw new DataDiffError(
        `sql.mode is "${declared}", which is not one of: mcp, command, snowsql, auto.`
      );
    }
    return declared;
  }
  if (sql.mcp) {
    return 'mcp';
  }
  if (sql.command) {
    return 'command';
  }
  if (sql.connection) {
    return 'snowsql';
  }
  throw new DataDiffError(
    'no way to run SQL is configured in .datadiff.json. Set one of:\n' +
      '  sql.mcp      — an MCP server that runs SQL, or configPath+server to\n' +
      '                 borrow the one your IDE already uses\n' +
      '  sql.command  — a command template, e.g. "psql -d {{connection}} -f {{queryFile}} --csv"\n' +
      '  sql.connection — a -c connection name from ~/.snowsql/config\n' +
      '\n  A --function target needs none of this.'
  );
}

/** Splits a command template into a program and its arguments, respecting
 * quotes so a flag value containing a space survives. */
function tokenize(template) {
  const tokens = template.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) =>
    /^".*"$|^'.*'$/.test(token) ? token.slice(1, -1) : token
  );
}

/**
 * Runs a command template and parses what it prints.
 *
 * `{{queryFile}}` exists alongside `{{query}}` because a statement long enough
 * to matter runs into argument-length limits, and because quoting a multi-line
 * statement through a shell is a way to change it by accident. The file is
 * written to a temp directory, never into the checkout, so a stray `git add`
 * cannot reach it.
 */
export function runCommandQuery(config, sql) {
  const { command, connection, outputFormat } = config.sql ?? {};
  if (!command) {
    throw new DataDiffError(
      'sql.mode is "command" but sql.command is not set in .datadiff.json.'
    );
  }

  const needsFile = command.includes('{{queryFile}}');
  let queryFile = '';
  if (needsFile) {
    queryFile = join(mkdtempSync(join(tmpdir(), 'datadiff-')), 'query.sql');
    writeFileSync(queryFile, sql);
  }

  const substituted = tokenize(command).map((token) =>
    token
      .replace(/\{\{\s*queryFile\s*\}\}/g, queryFile)
      .replace(/\{\{\s*query\s*\}\}/g, sql)
      .replace(/\{\{\s*connection\s*\}\}/g, connection ?? '')
  );

  const [program, ...args] = substituted;
  if (!program) {
    throw new DataDiffError('sql.command is empty.');
  }

  let output;
  try {
    output = execFileSync(program, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (error) {
    throw new DataDiffError(
      `sql.command failed: ${program} exited ${error.status ?? 'abnormally'}\n` +
        `  ${String(error.stderr || error.message).trim()}`
    );
  }

  if (outputFormat === 'json') {
    try {
      const parsed = JSON.parse(output);
      if (!Array.isArray(parsed)) {
        throw new DataDiffError(
          'sql.outputFormat is "json" but the command did not print a JSON ' +
            'array of rows.'
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof DataDiffError) {
        throw error;
      }
      throw new DataDiffError(
        `sql.outputFormat is "json" but the command's output is not JSON: ${error.message}`
      );
    }
  }

  return parseCsv(output);
}

/** The original path: snowsql with the flags that make its output parseable.
 * CSV rather than its JSON output because the JSON formatter's behaviour has
 * changed across snowsql versions and CSV with a header row has not. */
export function runSnowsqlQuery(config, sql) {
  const { cli, connection } = config.sql ?? {};
  if (!connection) {
    throw new DataDiffError(
      'sql.connection is not set in .datadiff.json — name the connection ' +
        'entry from ~/.snowsql/config to use.'
    );
  }
  const result = execFileSync(
    cli ?? 'snowsql',
    [
      '-c',
      connection,
      '-q',
      sql,
      '-o',
      'output_format=csv',
      '-o',
      'header=true',
      '-o',
      'timing=false',
      '-o',
      'friendly=false',
      '-o',
      'exit_on_error=true'
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  return parseCsv(result);
}

/** Runs `sql` (already parameter-filled) whichever way this repo is set up for
 * and returns its rows. Async because one of the three ways is an HTTP round
 * trip; the other two resolve immediately. */
export async function runQuery(root, config, sql) {
  const mode = resolveSqlMode(config);
  if (mode === 'mcp') {
    return runMcpQuery(root, config.sql.mcp ?? {}, sql);
  }
  if (mode === 'command') {
    return runCommandQuery(config, sql);
  }
  return runSnowsqlQuery(config, sql);
}
