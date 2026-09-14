// Most functions worth diffing are TypeScript, and in a real repo they are
// reached through tsconfig path aliases and extension-less imports that Node
// does not implement. These cover the resolution rules that makes such a
// function importable at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runFunction } from '../lib/function.mjs';
import { canStripTypes } from '../lib/ts-loader.mjs';
import { parseTsconfigJson, resolutionFor } from '../lib/tsconfig.mjs';
import { makeRepo } from './helpers.mjs';

// These fixtures are throwaway repos with no typescript of their own, so
// running them needs a Node that can strip types. The resolution tests above
// them do not, and still run everywhere the plugin claims to work.
const needsStripping = canStripTypes()
  ? false
  : `Node ${process.version} cannot strip TypeScript types`;

test('tsconfig with comments and a trailing comma still parses', () => {
  const parsed = parseTsconfigJson(`{
    // the compiler options
    "compilerOptions": {
      "baseUrl": "./", /* inline */
      "paths": { "lib/*": ["lib/*"] },
    },
  }`);
  assert.equal(parsed.compilerOptions.baseUrl, './');
  assert.deepEqual(parsed.compilerOptions.paths['lib/*'], ['lib/*']);
});

test('a "//" inside a string is not treated as a comment', () => {
  const parsed = parseTsconfigJson('{"compilerOptions":{"baseUrl":"https://x/y"}}');
  assert.equal(parsed.compilerOptions.baseUrl, 'https://x/y');
});

test('baseUrl is resolved relative to the tsconfig that declares it', (t) => {
  const { dir } = makeRepo(t);
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: './src' } })
  );
  const { baseUrl } = resolutionFor(dir, dir);
  assert.equal(baseUrl, join(dir, 'src'));
});

test('an extended tsconfig contributes its paths', (t) => {
  const { dir } = makeRepo(t);
  writeFileSync(
    join(dir, 'tsconfig.base.json'),
    JSON.stringify({ compilerOptions: { baseUrl: './', paths: { '@app/*': ['src/*'] } } })
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ extends: './tsconfig.base.json' })
  );
  const { paths } = resolutionFor(dir, dir);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].prefix, '@app/');
});

test('runs a TypeScript function with type annotations', { skip: needsStripping }, async (t) => {
  const { dir } = makeRepo(t);
  const file = join(dir, 'transform.ts');
  writeFileSync(
    file,
    `type Row = { id: number; amount: number };
export function scale(rows: Row[]): Row[] {
  return rows.map((row: Row): Row => ({ ...row, amount: row.amount * 2 }));
}
`
  );
  const output = await runFunction(file, 'scale', [{ id: 1, amount: 5 }], dir);
  assert.deepEqual(output, [{ id: 1, amount: 10 }]);
});

test('resolves a tsconfig path alias and an extension-less relative import', { skip: needsStripping }, async (t) => {
  const { dir } = makeRepo(t);
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { baseUrl: './' } })
  );

  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'constants.ts'), 'export const BONUS: number = 12;\n');
  writeFileSync(
    join(dir, 'lib', 'utils.ts'),
    `import { BONUS } from './constants';
export const bump = (value: number): number => value + BONUS;
`
  );

  mkdirSync(join(dir, 'app'), { recursive: true });
  const file = join(dir, 'app', 'transform.ts');
  writeFileSync(
    file,
    `import { bump } from 'lib/utils';
export function addBonus(rows: number[]): number[] {
  return rows.map(bump);
}
`
  );

  const output = await runFunction(file, 'addBonus', [1, 2], dir);
  assert.deepEqual(output, [13, 14]);
});

test('a function that throws reports its message, not a silent empty result', async (t) => {
  const { dir } = makeRepo(t);
  const file = join(dir, 'boom.mjs');
  writeFileSync(file, 'export function go() { throw new Error("no rows"); }\n');
  await assert.rejects(
    () => runFunction(file, 'go', [], dir),
    (error) => error.message.includes('no rows')
  );
});

test('each run gets a fresh module graph, so top-level state cannot leak', async (t) => {
  const { dir } = makeRepo(t);
  const file = join(dir, 'stateful.mjs');
  writeFileSync(
    file,
    'let calls = 0;\nexport function count() { calls += 1; return calls; }\n'
  );
  assert.equal(await runFunction(file, 'count', null, dir), 1);
  assert.equal(await runFunction(file, 'count', null, dir), 1);
});
