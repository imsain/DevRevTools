// Writes a Cursor Canvas showing a row-level before/after diff as a table,
// plus a bar chart of any numeric column whose before/after total moved —
// the "chart of a change" a table alone doesn't make legible at a glance.
//
// When `--ui` captured frames, the same canvas carries uidiff's slider above
// the table, so the numbers and the page showing them are read together. The
// slider, the image embedding and the file location come from lib/shared.

import { dataUri, pngSize, sliderComponent } from './shared/canvas.mjs';

export { canvasDir, workspaceSlug, writeCanvas } from './shared/canvas.mjs';

const js = (value) => JSON.stringify(value);

function cellText(row, column) {
  const value = row?.[column];
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  // Real result rows carry nested objects (display metadata, chart series).
  // `String()` turns those into "[object Object]", which tells the reader
  // nothing about whether they changed.
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 80 ? `${json.slice(0, 79)}…` : json;
  }
  return String(value);
}

/** A changed cell shows both values. What a number changed *from* is most of
 * the information in a data diff — highlighting the new value alone leaves
 * the reader to go find the old one. */
function changedCell(before, after, column) {
  return (
    `<Text><Text style={{ background: theme.diff.stripRemoved, textDecoration: 'line-through', padding: '1px 4px', borderRadius: 3 }}>{${js(
      cellText(before, column)
    )}}</Text>{' \u2192 '}<Text style={{ background: theme.diff.stripAdded, padding: '1px 4px', borderRadius: 3 }}>{${js(
      cellText(after, column)
    )}}</Text></Text>`
  );
}

function cellContent(column, before, after, changedColumns) {
  if (!changedColumns?.includes(column)) {
    return js(cellText(after, column));
  }
  return changedCell(before, after, column);
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
  for (const { before, after, changedColumns } of diff.changed) {
    rows.push({
      tone: 'warning',
      cells: diff.columns.map((column) => cellContent(column, before, after, changedColumns))
    });
  }
  return rows;
}

/**
 * `diff` is the object `diffRows` in lib/diff.mjs returns. `summary` is
 * `numericColumnSummary`'s output — pass `[]` when there's nothing worth
 * charting.
 */
export function buildCanvasCode({ target, meta, diff, summary, ui }) {
  const rows = tableRows(diff);
  const rowsCode = rows
    .map((row) => `    [${row.cells.join(', ')}]`)
    .join(',\n');
  const rowToneCode = rows.map((row) => js(row.tone)).join(', ');
  const headersCode = diff.columns.map((column) => js(column)).join(', ');

  // Percentages are kept out of the bars on purpose: charting a 40.3 next to
  // a 28,560 on one axis renders the percentage as no bar at all.
  const totals = summary.filter((entry) => entry.kind === 'sum');
  const averages = summary.filter((entry) => entry.kind !== 'sum');

  const delta = (entry) => {
    const move = Math.round((entry.after - entry.before) * 100) / 100;
    return `${move >= 0 ? '+' : ''}${move.toLocaleString()}`;
  };

  const chart =
    totals.length > 0
      ? `
      <Stack gap={8}>
        <Text weight="medium">Changed totals by column</Text>
        <BarChart
          categories={[${totals.map((entry) => js(entry.column)).join(', ')}]}
          series={[
            { name: 'Before', data: [${totals.map((entry) => entry.before).join(', ')}] },
            { name: 'After', data: [${totals.map((entry) => entry.after).join(', ')}] }
          ]}
        />
      </Stack>`
      : '';

  const averageStats =
    averages.length > 0
      ? `
      <Stack gap={8}>
        <Text weight="medium">Changed averages</Text>
${averages
  .map(
    (entry) =>
      `        <Stat label={${js(`${entry.column} (average)`)}} value={${js(
        `${entry.before} → ${entry.after}  (${delta(entry)})`
      )}} />`
  )
  .join('\n')}
      </Stack>`
      : '';

  // The page comes first when there is one: what a reviewer recognises is
  // the screen, and the table underneath explains what moved on it.
  const screenshots = ui?.before && ui?.after;
  const frame = screenshots ? pngSize(ui.after) : null;
  const uiConsts = screenshots
    ? `const uiBefore = ${js(dataUri(ui.before))};\nconst uiAfter = ${js(dataUri(ui.after))};\n${sliderComponent()}\n`
    : '';
  const uiSection = screenshots
    ? `
      <Slider label={${js(ui.route)}} before={uiBefore} after={uiAfter} width={${frame.width}} height={${frame.height}} />
      <Text tone="secondary" style={{ fontSize: 12 }}>Drag the frame, or focus it and use the arrow keys.</Text>`
    : '';

  const imports = [
    'BarChart',
    'DiffStats',
    ...(screenshots ? ['Pill'] : []),
    'Stack',
    'Stat',
    'Table',
    'Text',
    'useHostTheme',
    ...(screenshots ? ['useRef', 'useState'] : [])
  ];

  return `import { ${imports.join(', ')} } from "cursor/canvas";

${uiConsts}
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
      </Stack>${uiSection}
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
      />${chart}${averageStats}
    </Stack>
  );
}
`;
}
