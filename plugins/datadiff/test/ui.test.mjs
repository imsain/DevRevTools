// The --ui half: forwarding page-state steps to uidiff, finding its binary,
// and putting the frames in the canvas next to the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUidiff, uiSteps } from '../lib/ui.mjs';
import { buildCanvasCode } from '../lib/canvas.mjs';
import { diffRows } from '../lib/diff.mjs';
import { DataDiffError } from '../lib/project.mjs';
import { parseArgs } from '../lib/args.mjs';
import { makeRepo } from './helpers.mjs';

/** Enough of a PNG for the canvas writer: it only reads width and height out
 * of the IHDR chunk. */
function fakePng(path, width, height) {
  const buffer = Buffer.alloc(24);
  buffer.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  writeFileSync(path, buffer);
  return path;
}

test('page-state steps keep the order they were written in', () => {
  const args = parseArgs([
    'compare',
    '--ui-click',
    '#dismiss',
    '--ui-wait',
    '500',
    '--ui-wait-for',
    '.chart'
  ]);
  assert.deepEqual(uiSteps(args), [
    ['--click', '#dismiss'],
    ['--wait', '500'],
    ['--wait-for', '.chart']
  ]);
});

test('flags that are not steps are left alone', () => {
  const args = parseArgs(['compare', '--ui', '/dashboard', '--key', 'id']);
  assert.deepEqual(uiSteps(args), []);
});

test('a step flag with no value is rejected rather than sent as "true"', () => {
  const args = parseArgs(['compare', '--ui-click']);
  assert.throws(() => uiSteps(args), DataDiffError);
});

test('UIDIFF_BIN wins over everything else', (t) => {
  const previous = process.env.UIDIFF_BIN;
  process.env.UIDIFF_BIN = '/somewhere/uidiff';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.UIDIFF_BIN;
    } else {
      process.env.UIDIFF_BIN = previous;
    }
  });
  assert.deepEqual(resolveUidiff(), { command: '/somewhere/uidiff', args: [] });
});

test('the sibling uidiff plugin is found when nothing else provides one', (t) => {
  const previous = process.env.UIDIFF_BIN;
  delete process.env.UIDIFF_BIN;
  t.after(() => {
    if (previous !== undefined) {
      process.env.UIDIFF_BIN = previous;
    }
  });
  const resolved = resolveUidiff();
  assert.ok(resolved, 'expected uidiff to resolve inside this monorepo');
  assert.match(`${resolved.command} ${resolved.args.join(' ')}`, /uidiff/);
});

test('captured frames become a slider in the same canvas as the table', (t) => {
  const { dir } = makeRepo(t);
  const diff = diffRows({
    before: [{ id: 1, amount: 10 }],
    after: [{ id: 1, amount: 22 }],
    key: 'id'
  });
  const code = buildCanvasCode({
    target: 'function utils.ts#total',
    meta: 'demo',
    diff,
    summary: [],
    ui: {
      route: '/fpm/dashboard',
      before: fakePng(join(dir, 'b.png'), 2880, 1800),
      after: fakePng(join(dir, 'a.png'), 2880, 1800)
    }
  });

  assert.match(code, /<Slider label=\{"\/fpm\/dashboard"\}/);
  assert.match(code, /width=\{2880\} height=\{1800\}/);
  assert.match(code, /const uiBefore = "data:image\/png;base64,/);
  // The slider needs these, and an unused import is a canvas that won't build.
  for (const name of ['Pill', 'useRef', 'useState']) {
    assert.match(code, new RegExp(`\\b${name}\\b[^\\n]*from "cursor/canvas"`));
  }
});

test('without captures the canvas has no slider and no image imports', () => {
  const diff = diffRows({
    before: [{ id: 1, amount: 10 }],
    after: [{ id: 1, amount: 22 }],
    key: 'id'
  });
  const code = buildCanvasCode({ target: 'q', meta: 'demo', diff, summary: [] });
  assert.doesNotMatch(code, /<Slider/);
  assert.doesNotMatch(code, /useState/);
});
