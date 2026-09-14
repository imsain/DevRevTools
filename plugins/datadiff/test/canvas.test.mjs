// The same JSX-escaping mistake bit uidiff's canvas writer first: text
// placed directly as JSX children rather than inside a `{}` expression
// renders with literal quote marks around it. These pin that down here too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasCode, workspaceSlug } from '../lib/canvas.mjs';
import { diffRows, numericColumnSummary } from '../lib/diff.mjs';

test('workspace slug matches Cursor\'s ~/.cursor/projects naming', () => {
  assert.equal(workspaceSlug('/Users/dev/work/acme_dashboard'), 'Users-dev-work-acme-dashboard');
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

test('a changed cell shows what the value changed from, not just to', () => {
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
  assert.match(code, /\{"10"\}/);
  assert.match(code, /\{"30"\}/);
  assert.match(code, /\u2192/);
});

test('a percentage column is kept out of the bar chart and shown as a stat', () => {
  const before = [{ id: 1, UNITS: 100, MARGIN_PERCENT: 40 }];
  const after = [{ id: 1, UNITS: 112, MARGIN_PERCENT: 35 }];
  const diff = diffRows({ before, after, key: 'id' });
  const summary = numericColumnSummary(before, after, ['id']);
  const code = buildCanvasCode({ target: 'q', meta: 'demo', diff, summary });

  const chart = code.slice(code.indexOf('<BarChart'), code.indexOf('</Stack>', code.indexOf('<BarChart')));
  assert.match(chart, /UNITS/);
  assert.doesNotMatch(chart, /MARGIN_PERCENT/);
  assert.match(code, /MARGIN_PERCENT \(average\)/);
});

test('a nested object cell shows its contents, not [object Object]', () => {
  const diff = diffRows({
    before: [{ id: 1, display: [{ colour: 'red' }] }],
    after: [{ id: 1, display: [{ colour: 'blue' }] }],
    key: 'id'
  });
  const code = buildCanvasCode({ target: 'q', meta: 'demo', diff, summary: [] });
  assert.doesNotMatch(code, /\[object Object\]/);
  assert.match(code, /colour/);
});

test('a null cell reads as an em dash rather than the word null', () => {
  const diff = diffRows({
    before: [{ id: 1, note: null, amount: 1 }],
    after: [{ id: 1, note: null, amount: 2 }],
    key: 'id'
  });
  const code = buildCanvasCode({ target: 'q', meta: 'demo', diff, summary: [] });
  assert.doesNotMatch(code, /"null"/);
  assert.match(code, /"—"/);
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
