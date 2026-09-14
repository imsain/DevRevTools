// The canvas writer's own logic: the workspace slug has to match Cursor's
// real `~/.cursor/projects/<slug>` naming exactly or the canvas never shows
// up, the PNG size reader has to agree with a real image, and the emitted
// source has to put the title and metadata inside `{}` — as plain JSX text
// they would render with their own quote marks baked in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCanvasCode, pngSize, workspaceSlug } from '../lib/canvas.mjs';

test('workspace slug matches Cursor\'s own ~/.cursor/projects naming', () => {
  assert.equal(workspaceSlug('/Users/dev/work/uidiff'), 'Users-dev-work-uidiff');
  // Underscores collapse to dashes the same way separators do.
  assert.equal(workspaceSlug('/Users/dev/work/acme_dashboard'), 'Users-dev-work-acme-dashboard');
});

/** A PNG with a real signature and IHDR, but no image data — enough for pngSize. */
function fakePng(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.write('\x89PNG\r\n\x1a\n', 0, 'latin1');
  buffer.writeUInt32BE(13, 8); // IHDR length
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('pngSize reads width/height from the IHDR chunk directly', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uidiff-canvas-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'sample.png');
  writeFileSync(file, fakePng(1440, 900));
  assert.deepEqual(pngSize(file), { width: 1440, height: 900 });
});

test('title and meta land inside JSX expressions, not as literal quoted text', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'uidiff-canvas-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = join(dir, 'before.png');
  const after = join(dir, 'after.png');
  writeFileSync(before, fakePng(10, 10));
  writeFileSync(after, fakePng(10, 10));

  const code = buildCanvasCode({
    target: '/dashboard',
    meta: 'demo · http://localhost:3000/dashboard',
    metric: { differing: 5, total: 100, fraction: 0.05 },
    pairs: [{ label: 'Viewport', before, after }]
  });

  assert.match(code, /\{"\/dashboard"\}/);
  assert.doesNotMatch(code, />"\/dashboard"</);
  assert.match(code, /Stat label="Pixels changed"/);
  assert.match(code, /from "cursor\/canvas"/);
});
