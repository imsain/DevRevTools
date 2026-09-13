// Command-line parsing, split out so it is testable on its own. Same
// behaviour as uidiff's lib/args.mjs: repeated flags keep their order, and a
// flag with no value is `true` rather than swallowing the next token.

import { DataDiffError } from './project.mjs';

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const ordered = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const split = body.indexOf('=');
    const name = split === -1 ? body : body.slice(0, split);
    let value = split === -1 ? undefined : body.slice(split + 1);
    if (value === undefined) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }
    flags[name] = value;
    ordered.push({ name, value });
  }
  return { positional, flags, ordered };
}

/** Every `--param key=value` as a plain object, in the order given. */
export function paramFlags(args) {
  const params = {};
  for (const entry of args.ordered) {
    if (entry.name !== 'param') {
      continue;
    }
    const text = String(entry.value);
    const split = text.indexOf('=');
    if (split === -1) {
      throw new DataDiffError(`--param needs key=value, got "${text}"`);
    }
    params[text.slice(0, split)] = text.slice(split + 1);
  }
  return params;
}

export function numberFlag(name, value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const empty = typeof value === 'boolean' || String(value).trim() === '';
  const parsed = empty ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DataDiffError(
      `--${name} needs a non-negative number, got ${JSON.stringify(value)}`
    );
  }
  return parsed;
}
