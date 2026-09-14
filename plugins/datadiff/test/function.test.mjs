import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFunctionTarget, readInput, runFunction } from '../lib/function.mjs';
import { swapToRef } from '../lib/gitswap.mjs';
import { DataDiffError } from '../lib/project.mjs';
import { makeRepo } from './helpers.mjs';

test('splits "file#export" on the last #', () => {
  assert.deepEqual(parseFunctionTarget('lib/a.mjs#b'), {
    file: 'lib/a.mjs',
    exportName: 'b'
  });
});

test('rejects a target with no #export', () => {
  assert.throws(() => parseFunctionTarget('lib/a.mjs'), DataDiffError);
});

test('reads and parses a JSON input file', (t) => {
  const { dir } = makeRepo(t);
  const path = join(dir, 'input.json');
  writeFileSync(path, '[{"id":1}]');
  assert.deepEqual(readInput(path), [{ id: 1 }]);
});

test('readInput returns undefined when no path is given', () => {
  assert.equal(readInput(undefined), undefined);
});

test('runs the named export against the input', async (t) => {
  const { dir } = makeRepo(t);
  const file = join(dir, 'transform.mjs');
  writeFileSync(
    file,
    'export function double(rows) { return rows.map((r) => ({ ...r, total: r.amount * 2 })); }\n'
  );
  const output = await runFunction(file, 'double', [{ id: 1, amount: 10 }]);
  assert.deepEqual(output, [{ id: 1, amount: 10, total: 20 }]);
});

test('names an export that does not exist, and lists what does', async (t) => {
  const { dir } = makeRepo(t);
  const file = join(dir, 'transform.mjs');
  writeFileSync(file, 'export function real() { return 1; }\n');
  await assert.rejects(
    () => runFunction(file, 'missing', []),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('missing') &&
      error.message.includes('real')
  );
});

test('a swap actually changes what the same import path returns', async (t) => {
  const { dir, git } = makeRepo(t);
  const file = join(dir, 'transform.mjs');
  writeFileSync(file, 'export function scale(rows) { return rows.map((r) => r * 2); }\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'v1');

  writeFileSync(file, 'export function scale(rows) { return rows.map((r) => r * 3); }\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'v2');

  const after = await runFunction(file, 'scale', [1, 2]);
  assert.deepEqual(after, [3, 6]);

  const restore = swapToRef(dir, 'HEAD~1', ['transform.mjs']);
  try {
    const before = await runFunction(file, 'scale', [1, 2]);
    assert.deepEqual(before, [2, 4]);
  } finally {
    restore();
  }

  const restoredAgain = await runFunction(file, 'scale', [1, 2]);
  assert.deepEqual(restoredAgain, [3, 6]);
});
