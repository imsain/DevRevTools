import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillParams, parseCsv } from '../lib/sql.mjs';
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
    (error) => error instanceof DataDiffError && error.message.includes('region')
  );
});
