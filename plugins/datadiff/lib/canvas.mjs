// Writes a Cursor Canvas showing a row-level before/after diff as a table,
// plus a bar chart of any numeric column whose before/after total moved —
// the "chart of a change" a table alone doesn't make legible at a glance.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Same convention uidiff's canvas writer uses: Cursor's own
 * `~/.cursor/projects/<slug>` naming for the current workspace. */
export function workspaceSlug(root) {
  return root.replace(/^\/+/, '').replace(/[/_]+/g, '-');
}

export function canvasDir(root) {
  return join(homedir(), '.cursor', 'projects', workspaceSlug(root), 'canvases');
}

const js = (value) => JSON.stringify(value);

function cellText(row, column) {
  const value = row[column];
  return value === undefined || value === '' ? '—' : String(value);
}

function cellContent(column, row, changedColumns) {
  if (!changedColumns?.includes(column)) {
    return js(cellText(row, column));
  }
  return `<Text style={{ background: theme.diff.stripAdded, padding: '1px 4px', borderRadius: 3 }}>{${js(cellText(row, column))}}</Text>`;
}

function tableRows(diff) {
  const rows = [];
  for (const { row } of diff.removed) {
    rows.push({
      tone: 'danger',
      cells: diff.columns.map(
        (column) =>
          `<Text style={{ background: theme.diff.stripRemoved, textDecoration: 'line-through' }}>{${js(
            cellText(row, column)
          )}}</Text>`
      )
    });
  }
  for (const { row } of diff.added) {
    rows.push({
      tone: 'success',
      cells: diff.columns.map(
        (column) =>
          `<Text style={{ background: theme.diff.stripAdded }}>{${js(cellText(row, column))}}</Text>`
      )
    });
  }
  for (const { after, changedColumns } of diff.changed) {
    rows.push({
      tone: 'warning',
      cells: diff.columns.map((column) => cellContent(column, after, changedColumns))
    });
  }
  return rows;
}

/**
 * `diff` is the object `diffRows` in lib/diff.mjs returns. `summary` is
 * `numericColumnSummary`'s output — pass `[]` when there's nothing worth
 * charting.
 */
export function buildCanvasCode({ target, meta, diff, summary }) {
  const rows = tableRows(diff);
  const rowsCode = rows
    .map((row) => `    [${row.cells.join(', ')}]`)
    .join(',\n');
  const rowToneCode = rows.map((row) => js(row.tone)).join(', ');
  const headersCode = diff.columns.map((column) => js(column)).join(', ');

  const chart =
    summary.length > 0
      ? `
      <Stack gap={8}>
        <Text weight="medium">Changed totals by column</Text>
        <BarChart
          categories={[${summary.map((entry) => js(entry.column)).join(', ')}]}
          series={[
            { name: 'Before', data: [${summary.map((entry) => entry.beforeSum).join(', ')}] },
            { name: 'After', data: [${summary.map((entry) => entry.afterSum).join(', ')}] }
          ]}
        />
      </Stack>`
      : '';

  return `import { BarChart, DiffStats, Stack, Stat, Table, Text, useHostTheme } from "cursor/canvas";

export default function DataDiffCanvas() {
  const theme = useHostTheme();
  const headers = [${headersCode}];
  const rows = [
${rowsCode}
  ];
  const rowTone = [${rowToneCode}];

  return (
    <Stack gap={20} style={{ padding: 24 }}>
      <Stack gap={4}>
        <Text weight="medium" style={{ fontSize: 18 }}>{${js(target)}}</Text>
        <Text tone="secondary" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{${js(meta)}}</Text>
      </Stack>
      <Stack gap={4}>
        <DiffStats additions={${diff.added.length}} deletions={${diff.removed.length}} />
        <Stat label="Rows changed" value={${js(`${diff.changed.length} of ${diff.changed.length + diff.unchanged.length + diff.removed.length} matched rows`)}} />
      </Stack>
      <Table
        headers={headers}
        rows={rows}
        rowTone={rowTone}
        striped
        stickyHeader
        emptyMessage={${js('No added, removed, or changed rows.')}}
      />${chart}
    </Stack>
  );
}
`;
}

export function writeCanvas(root, name, code) {
  const dir = canvasDir(root);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const file = join(dir, `${name}.canvas.tsx`);
  writeFileSync(file, code);
  return file;
}
