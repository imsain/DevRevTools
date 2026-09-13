// Runs one exported function from a JS/TS-compiled-to-JS module against a
// fixed input, so a data-processing function can be diffed the same way a
// SQL query is: run it, swap its file to a git ref, run it again.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DataDiffError } from './project.mjs';

/** Splits "lib/transform.mjs#normalizeRows" into its file and export name. */
export function parseFunctionTarget(target) {
  const hash = target.lastIndexOf('#');
  if (hash === -1) {
    throw new DataDiffError(
      `--function needs "path/to/module.mjs#exportName", got "${target}"`
    );
  }
  return { file: target.slice(0, hash), exportName: target.slice(hash + 1) };
}

/**
 * Imports `file` fresh — a `?t=` query string busts Node's module cache — so
 * the same process can import it once now, swap it to an older git ref, and
 * import "the same path" again and actually get the old code rather than a
 * cached copy of the new one.
 */
async function importFresh(absolutePath) {
  const url = `${pathToFileURL(absolutePath).href}?t=${Date.now()}-${Math.random()}`;
  return import(url);
}

export async function runFunction(absolutePath, exportName, input) {
  if (!existsSync(absolutePath)) {
    throw new DataDiffError(`no such file: ${absolutePath}`);
  }
  const module = await importFresh(absolutePath);
  const fn = module[exportName];
  if (typeof fn !== 'function') {
    const available = Object.keys(module).filter(
      (key) => typeof module[key] === 'function'
    );
    throw new DataDiffError(
      `"${exportName}" is not an exported function of ${absolutePath}.` +
        (available.length
          ? ` Exported functions: ${available.join(', ')}`
          : '')
    );
  }
  return fn(input);
}

export function readInput(path) {
  if (!path) {
    return undefined;
  }
  if (!existsSync(path)) {
    throw new DataDiffError(`no such input file: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new DataDiffError(`${path} is not valid JSON: ${error.message}`);
  }
}
