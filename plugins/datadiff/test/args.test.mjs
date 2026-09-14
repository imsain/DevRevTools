import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberFlag, paramFlags, parseArgs } from '../lib/args.mjs';
import { DataDiffError } from '../lib/project.mjs';

test('collects repeated --param flags in order', () => {
  const args = parseArgs(['compare', '--param', 'region=US', '--param', 'year=2024']);
  assert.deepEqual(paramFlags(args), { region: 'US', year: '2024' });
});

test('a --param with no = is a legible error', () => {
  const args = parseArgs(['--param', 'nope']);
  assert.throws(() => paramFlags(args), DataDiffError);
});

test('a flag followed by another flag does not swallow it', () => {
  const args = parseArgs(['compare', '--force', '--before-ref', 'HEAD']);
  assert.equal(args.flags.force, true);
  assert.equal(args.flags['before-ref'], 'HEAD');
});

test('a bare trailing flag is true, so it can stand on its own', () => {
  const args = parseArgs(['compare', '--force']);
  assert.equal(args.flags.force, true);
});

test('numberFlag falls back when the flag is absent', () => {
  assert.equal(numberFlag('limit', undefined, 500), 500);
});

test('numberFlag rejects a non-numeric value instead of silently using NaN', () => {
  assert.throws(() => numberFlag('limit', 'abc', 500), DataDiffError);
});
