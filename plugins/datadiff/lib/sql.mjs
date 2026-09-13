// Runs a .sql file through snowsql and parses its CSV output into rows.
//
// No driver dependency, on the same principle as uidiff shelling out to git
// and Chrome's own DevTools Protocol instead of adding npm packages: whoever
// runs this already has snowsql configured (a `-c <connection>` entry in
// ~/.snowsql/config) to reach the warehouse in the first place, and a second,
// bundled way to open the same connection would just be one more thing that
// can be configured wrong.
//
// CSV rather than snowsql's JSON output because the JSON formatter's
// behaviour has changed across snowsql versions and CSV with a header row has
// not; parsing it ourselves also means never mis-reading `NULL` the text as
// null the value in someone else's format string.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DataDiffError } from './project.mjs';

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
 * A single line of RFC-4180-ish CSV, which is all snowsql emits: fields are
 * comma-separated, a field containing a comma or quote is wrapped in `"..."`,
 * and `""` inside a quoted field is a literal quote.
 */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      header.map((name, index) => [name, values[index] ?? ''])
    );
  });
}

/** Runs `sql` (already parameter-filled) against `config.sql.connection` and
 * returns its rows. Fails loudly with snowsql's own stderr rather than
 * guessing at what an empty result means. */
export function runQuery(config, sql) {
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

export function runQueryFile(config, path, params) {
  const sql = fillParams(readFileSync(path, 'utf8'), params);
  return runQuery(config, sql);
}
