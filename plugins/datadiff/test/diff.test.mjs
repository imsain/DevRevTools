import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffRows, normalizeRows, numericColumnSummary } from '../lib/diff.mjs';

test('identical arrays produce an identical diff', () => {
  const rows = [{ id: 1, total: 10 }, { id: 2, total: 20 }];
  const diff = diffRows({ before: rows, after: rows, key: 'id' });
  assert.equal(diff.identical, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
  assert.equal(diff.unchanged.length, 2);
});

test('a changed value on a keyed row is reported with its column', () => {
  const before = [{ id: 1, total: 10 }, { id: 2, total: 20 }];
  const after = [{ id: 1, total: 15 }, { id: 2, total: 20 }];
  const diff = diffRows({ before, after, key: 'id' });
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0].changedColumns, ['total']);
  assert.equal(diff.unchanged.length, 1);
});

test('added and removed rows are told apart by key, not position', () => {
  const before = [{ id: 1 }, { id: 2 }];
  const after = [{ id: 2 }, { id: 3 }];
  const diff = diffRows({ before, after, key: 'id' });
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].key, '1');
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].key, '3');
  assert.equal(diff.unchanged.length, 1);
});

test('without a key, rows are matched by position', () => {
  const before = [{ v: 1 }, { v: 2 }];
  const after = [{ v: 2 }, { v: 1 }];
  const diff = diffRows({ before, after });
  // Same values, but reordering shows up as every row changed — the
  // documented tradeoff of positional matching.
  assert.equal(diff.changed.length, 2);
  assert.equal(diff.keyed, false);
});

test('numbers as strings ("5") and numbers (5) are not a false change', () => {
  const before = [{ id: 1, amount: '5' }];
  const after = [{ id: 1, amount: 5 }];
  const diff = diffRows({ before, after, key: 'id' });
  assert.equal(diff.changed.length, 0);
});

test('a scalar output is treated as a single row', () => {
  const norm = normalizeRows(42);
  assert.deepEqual(norm.rows, [42]);
});

test('an array of objects stays tabular', () => {
  const norm = normalizeRows([{ a: 1 }, { a: 2 }]);
  assert.equal(norm.tabular, true);
  assert.equal(norm.rows.length, 2);
});

test('numeric column summary sums a changed column across the whole set', () => {
  const before = [{ id: 1, amount: 10 }, { id: 2, amount: 20 }];
  const after = [{ id: 1, amount: 15 }, { id: 2, amount: 20 }];
  const summary = numericColumnSummary(before, after);
  assert.deepEqual(summary, [{ column: 'amount', beforeSum: 30, afterSum: 35 }]);
});

test('numeric column summary skips columns that did not move', () => {
  const before = [{ id: 1, amount: 10 }];
  const after = [{ id: 1, amount: 10 }];
  assert.deepEqual(numericColumnSummary(before, after), []);
});

test('numeric column summary skips a column that is not numeric', () => {
  const before = [{ id: 1, name: 'alice' }];
  const after = [{ id: 1, name: 'bob' }];
  const summary = numericColumnSummary(before, after);
  assert.equal(summary.some((entry) => entry.column === 'name'), false);
});

test('an added or removed row still counts toward the column total', () => {
  const before = [{ id: 1, amount: 10 }];
  const after = [{ id: 1, amount: 10 }, { id: 2, amount: 5 }];
  const summary = numericColumnSummary(before, after, ['id']);
  assert.deepEqual(summary, [{ column: 'amount', beforeSum: 10, afterSum: 15 }]);
});

test('the excluded key column is never summed, even though it looks numeric', () => {
  const before = [{ id: 1, amount: 10 }];
  const after = [{ id: 1, amount: 10 }, { id: 2, amount: 5 }];
  const summary = numericColumnSummary(before, after, ['id']);
  assert.equal(summary.some((entry) => entry.column === 'id'), false);
});
