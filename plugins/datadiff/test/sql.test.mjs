import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fillParams,
  parseCsv,
  resolveSqlMode,
  runCommandQuery
} from '../lib/sql.mjs';
import { DataDiffError } from '../lib/project.mjs';

test('parses a plain CSV with a header row', () => {
  const rows = parseCsv('id,amount\n1,10\n2,20\n');
  assert.deepEqual(rows, [
    { id: '1', amount: '10' },
    { id: '2', amount: '20' }
  ]);
});

test('a quoted field can contain a comma', () => {
  const rows = parseCsv('id,name\n1,"Smith, John"\n');
  assert.deepEqual(rows, [{ id: '1', name: 'Smith, John' }]);
});

test('a doubled quote inside a quoted field is a literal quote', () => {
  const rows = parseCsv('id,note\n1,"say ""hi"""\n');
  assert.deepEqual(rows, [{ id: '1', note: 'say "hi"' }]);
});

test('an empty result is an empty array, not a header-only row', () => {
  assert.deepEqual(parseCsv('id,amount\n'), []);
  assert.deepEqual(parseCsv(''), []);
});

test('fillParams substitutes every {{name}} placeholder', () => {
  const sql = fillParams('select * from t where region = {{region}}', {
    region: 'US'
  });
  assert.equal(sql, 'select * from t where region = US');
});

test('a missing param fails with the name that is missing, not a silent gap', () => {
  assert.throws(
    () => fillParams('where region = {{region}}', {}),
    (error) =>
      error instanceof DataDiffError && error.message.includes('region')
  );
});

test('the configured way of running SQL is taken as the intent', () => {
  assert.equal(
    resolveSqlMode({ sql: { mcp: { url: 'https://x/mcp' } } }),
    'mcp'
  );
  assert.equal(resolveSqlMode({ sql: { command: 'psql --csv' } }), 'command');
  assert.equal(resolveSqlMode({ sql: { connection: 'prod' } }), 'snowsql');
});

test('an explicit mode wins over what else happens to be configured', () => {
  assert.equal(
    resolveSqlMode({
      sql: { mode: 'command', command: 'psql --csv', mcp: { url: 'https://x' } }
    }),
    'command'
  );
});

test('mcp is preferred when a repo has both it and a CLI connection', () => {
  assert.equal(
    resolveSqlMode({
      sql: { mcp: { url: 'https://x/mcp' }, connection: 'prod' }
    }),
    'mcp'
  );
});

test('no SQL configuration at all names all three ways rather than assuming one', () => {
  assert.throws(
    () => resolveSqlMode({ sql: { mode: 'auto' } }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('sql.mcp') &&
      error.message.includes('sql.command') &&
      error.message.includes('sql.connection')
  );
});

test('an unknown mode is rejected with the ones that exist', () => {
  assert.throws(
    () => resolveSqlMode({ sql: { mode: 'bigquery' } }),
    (error) => error instanceof DataDiffError && error.message.includes('mcp')
  );
});

test('a command template receives the statement and the connection', () => {
  const rows = runCommandQuery(
    {
      sql: {
        command: 'node -e "console.log(process.argv[1])" {{query}}',
        connection: 'ignored'
      }
    },
    'id\n1\n'
  );
  assert.deepEqual(rows, [{ id: '1' }]);
});

test('{{queryFile}} hands the statement over as a file, outside the checkout', () => {
  const rows = runCommandQuery(
    {
      sql: {
        command:
          "node -e \"const{readFileSync}=require('fs');process.stdout.write(readFileSync(process.argv[1],'utf8'))\" {{queryFile}}"
      }
    },
    'region,total\nUS,5\n'
  );
  assert.deepEqual(rows, [{ region: 'US', total: '5' }]);
});

test('a command that prints JSON is read as JSON when asked', () => {
  const rows = runCommandQuery(
    {
      sql: {
        command: `node -e "console.log(JSON.stringify([{a:1}]))"`,
        outputFormat: 'json'
      }
    },
    'select 1'
  );
  assert.deepEqual(rows, [{ a: 1 }]);
});

test('a failing command reports its own stderr, not an empty result', () => {
  assert.throws(
    () =>
      runCommandQuery(
        {
          sql: {
            command:
              'node -e "console.error(\'connection refused\');process.exit(2)"'
          }
        },
        'select 1'
      ),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('connection refused')
  );
});

test('command mode without a command says so', () => {
  assert.throws(
    () => runCommandQuery({ sql: { mode: 'command' } }, 'select 1'),
    (error) =>
      error instanceof DataDiffError && error.message.includes('sql.command')
  );
});
