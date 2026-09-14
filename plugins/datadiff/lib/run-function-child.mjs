// Runs one exported function and writes its result to a file as JSON.
//
// A separate process per run is what makes the git swap honest: "before" and
// "after" each get a clean module graph, so a stale import cache can't serve
// the new code when the old is what was asked for. The result goes to a file
// rather than stdout so anything the target function logs stays out of it.

import { readFileSync, writeFileSync } from 'node:fs';

const [payloadPath] = process.argv.slice(2);
const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));

const fail = (message) => {
  writeFileSync(payload.outFile, JSON.stringify({ ok: false, message }));
  process.exit(1);
};

let namespace;
try {
  namespace = await import(payload.url);
} catch (error) {
  fail(`could not import ${payload.file}: ${error.message}`);
}

const fn = namespace[payload.exportName];
if (typeof fn !== 'function') {
  const available = Object.keys(namespace).filter(
    (key) => typeof namespace[key] === 'function'
  );
  fail(
    `"${payload.exportName}" is not an exported function of ${payload.file}.` +
      (available.length ? ` Exported functions: ${available.join(', ')}` : '')
  );
}

try {
  const result = await fn(payload.input);
  writeFileSync(
    payload.outFile,
    JSON.stringify({ ok: true, result: result === undefined ? null : result })
  );
} catch (error) {
  fail(`${payload.exportName} threw: ${error.message}`);
}
