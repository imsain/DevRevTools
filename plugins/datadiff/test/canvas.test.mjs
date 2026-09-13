// The same JSX-escaping mistake bit uidiff's canvas writer first: text
// placed directly as JSX children rather than inside a `{}` expression
// renders with literal quote marks around it. These pin that down here too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasCode, workspaceSlug } from '../lib/canvas.mjs';
import { diffRows, numericColumnSummary } from '../lib/diff.mjs';

test('workspace slug matches Cursor\'s ~/.cursor/projects naming', () => {
  assert.equal(workspaceSlug('/Users/al_ex/PAM/app'), 'Users-al-ex-PAM-app');
});

test('title and meta are JSX expressions, not literal quoted text', () => {
  const diff = diffRows({
    before: [{ id: 1, amount: 10 }],
    after: [{ id: 1, amount: 15 }],
    key: 'id'
  });
  const summary = numericColumnSummary(
    [{ id: 1, amount: 10 }],
    [{ id: 1, amount: 15 }]
  );
  const code = buildCanvasCode({
    target: 'function lib/transform.mjs#scale',
    meta: 'demo · before = HEAD',
    diff,
    summary
  });

  assert.match(code, /\{"function lib\/transform\.mjs#scale"\}/);
  assert.doesNotMatch(code, />"function lib\/transform\.mjs#scale"</);
  assert.match(code, /from "cursor\/canvas"/);
  assert.match(code, /<BarChart/);
});

test('a changed cell value is also inside {}, not literal JSX text', () => {
  const diff = diffRows({
    before: [{ id: 1, amount: 10 }],
    after: [{ id: 1, amount: 30 }],
    key: 'id'
  });
  const code = buildCanvasCode({
    target: 'query x.sql',
    meta: 'demo',
    diff,
    summary: []
  });
  assert.match(code, /<Text[^>]*>\{"30"\}<\/Text>/);
  assert.doesNotMatch(code, />"30"</);
});

test('no chart is emitted when nothing numeric changed', () => {
  const diff = diffRows({
    before: [{ id: 1, name: 'a' }],
    after: [{ id: 1, name: 'b' }],
    key: 'id'
  });
  const code = buildCanvasCode({
    target: 'query x.sql',
    meta: 'demo',
    diff,
    summary: []
  });
  assert.doesNotMatch(code, /<BarChart/);
});
