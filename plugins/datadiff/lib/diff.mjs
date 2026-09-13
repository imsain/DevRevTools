// Turns two arbitrary before/after values into a row-level diff: which rows
// were added, removed, or changed, and which of their columns changed.
//
// "Rows" because most things worth diffing here — a SQL result, the output
// of a transform function — are arrays of objects. Anything else (a scalar,
// a single nested object) is treated as one row so the same code path always
// applies; the caller just gets a diff with nothing to key on.

/** An array of plain objects stays as-is; anything else becomes one "row" so
 * every output shape flows through the same comparison. */
export function normalizeRows(value) {
  if (Array.isArray(value) && value.every(isPlainObject)) {
    return { tabular: true, rows: value };
  }
  if (Array.isArray(value)) {
    return { tabular: true, rows: value.map((item) => ({ value: item })) };
  }
  return { tabular: false, rows: [value ?? null] };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Values are compared as strings deliberately: a SQL CSV result and a JSON
 * function result disagree on whether 5 is a number or "5", and a diff tool
 * that reported that mismatch as a "change" on every row would be useless.
 */
function stringify(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Matches rows by `key` (a column name) when given, else by position — which
 * means a change that only reorders rows will show every row as changed.
 * That is called out by the caller rather than hidden here, since silently
 * "fixing" it by diffing unordered would just as easily hide a real change
 * that happens to look like a reorder.
 */
export function diffRows({ before, after, key }) {
  const beforeNorm = normalizeRows(before);
  const afterNorm = normalizeRows(after);
  const tabular = beforeNorm.tabular && afterNorm.tabular;

  const columns = [
    ...new Set([
      ...beforeNorm.rows.flatMap((row) => Object.keys(row ?? {})),
      ...afterNorm.rows.flatMap((row) => Object.keys(row ?? {}))
    ])
  ];

  const keyOf = (row, index) =>
    key && row && key in row ? stringify(row[key]) : String(index);

  const beforeByKey = new Map(
    beforeNorm.rows.map((row, index) => [keyOf(row, index), row])
  );
  const afterByKey = new Map(
    afterNorm.rows.map((row, index) => [keyOf(row, index), row])
  );

  const removed = [];
  const added = [];
  const changed = [];
  const unchanged = [];

  for (const [rowKey, row] of beforeByKey) {
    if (!afterByKey.has(rowKey)) {
      removed.push({ key: rowKey, row });
    }
  }
  for (const [rowKey, afterRow] of afterByKey) {
    const beforeRow = beforeByKey.get(rowKey);
    if (!beforeRow) {
      added.push({ key: rowKey, row: afterRow });
      continue;
    }
    const changedColumns = columns.filter(
      (column) => stringify(beforeRow[column]) !== stringify(afterRow[column])
    );
    if (changedColumns.length > 0) {
      changed.push({ key: rowKey, before: beforeRow, after: afterRow, changedColumns });
    } else {
      unchanged.push({ key: rowKey, row: afterRow });
    }
  }

  return {
    tabular,
    keyed: Boolean(key),
    columns,
    added,
    removed,
    changed,
    unchanged,
    identical: added.length === 0 && removed.length === 0 && changed.length === 0
  };
}

/**
 * Sum/before vs sum/after for every column where the values on both sides
 * are numbers (or blank) — skipping ids and text columns automatically
 * rather than asking the caller to name which columns are numeric. Over the
 * *entire* row set, not just the changed rows, so an added or removed row's
 * contribution to the total is part of the picture too.
 *
 * `exclude` should include the `--key` column when there is one: an id is
 * numeric-looking but summing it is meaningless, and would otherwise show up
 * as a "changed total" any time a row was added or removed.
 */
export function numericColumnSummary(before, after, exclude = []) {
  const beforeRows = normalizeRows(before).rows;
  const afterRows = normalizeRows(after).rows;
  const excluded = new Set(exclude);
  const columns = [
    ...new Set([
      ...beforeRows.flatMap((row) => Object.keys(row ?? {})),
      ...afterRows.flatMap((row) => Object.keys(row ?? {}))
    ])
  ].filter((column) => !excluded.has(column));

  const summary = [];
  for (const column of columns) {
    const values = [...beforeRows, ...afterRows].map((row) => row?.[column]);
    const numeric = values.every(
      (value) =>
        value === undefined ||
        value === null ||
        value === '' ||
        Number.isFinite(Number(value))
    );
    const anyValue = values.some((value) => value !== '' && value != null);
    if (!numeric || !anyValue) {
      continue;
    }
    const sum = (rows) =>
      rows.reduce((total, row) => {
        const value = Number(row?.[column]);
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);
    summary.push({
      column,
      beforeSum: sum(beforeRows),
      afterSum: sum(afterRows)
    });
  }
  return summary.filter((entry) => entry.beforeSum !== entry.afterSum);
}
