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

/** Tolerant of the formatting real results arrive in: "1,240" and "40.3%"
 * are numbers, "n/a" is not. */
export function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = String(value).trim().replace(/[,%\s]/g, '');
  if (cleaned === '') {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A percentage or rate is an average of its rows, never a sum: adding four
 * "% women" values together produces a number like 166% that means nothing. */
const RATIO_NAME = /percent|pct|ratio|rate|share|avg|average|mean|delta/i;

function isRatio(column, values) {
  return (
    RATIO_NAME.test(column) ||
    values.some((value) => typeof value === 'string' && value.trim().endsWith('%'))
  );
}

/**
 * Before vs after aggregate for every column whose values are numbers on
 * both sides — skipping ids and text columns automatically rather than
 * asking the caller to name which are numeric. Over the *entire* row set,
 * not just the changed rows, so an added or removed row's contribution
 * counts too.
 *
 * `exclude` should include the `--key` column when there is one: an id is
 * numeric-looking but aggregating it is meaningless, and would otherwise
 * show up as a "changed total" any time a row was added or removed.
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
    const present = values.filter((value) => value !== '' && value != null);
    if (present.length === 0 || present.some((value) => toNumber(value) === null)) {
      continue;
    }

    const kind = isRatio(column, values) ? 'average' : 'sum';
    const aggregate = (rows) => {
      const numbers = rows
        .map((row) => toNumber(row?.[column]))
        .filter((value) => value !== null);
      const total = numbers.reduce((sum, value) => sum + value, 0);
      if (kind === 'sum') {
        return total;
      }
      return numbers.length ? Math.round((total / numbers.length) * 100) / 100 : 0;
    };

    summary.push({ column, kind, before: aggregate(beforeRows), after: aggregate(afterRows) });
  }
  return summary.filter((entry) => entry.before !== entry.after);
}
