// Reading CSV into rows.
//
// Its own module because more than one thing produces CSV now: a SQL CLI's
// stdout, and an MCP tool that answers in text. Parsing it in one place means
// a quoted field containing a comma behaves the same either way.
//
// Parsed here rather than through a library for the same reason the rest of
// this plugin shells out instead of adding dependencies — and because doing it
// by hand is what stops `NULL` the text from being read as null the value in
// somebody else's format string.

/**
 * A single line of RFC-4180-ish CSV, which is all a SQL CLI emits: fields are
 * comma-separated, a field containing a comma or quote is wrapped in `"..."`,
 * and `""` inside a quoted field is a literal quote.
 */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      header.map((name, index) => [name, values[index] ?? ''])
    );
  });
}
