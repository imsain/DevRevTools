// Command-line parsing, bound to datadiff's error type, plus the one flag
// shape only this plugin has. The parsing itself lives in lib/shared/args.mjs.

import { DataDiffError } from './project.mjs';
import { createNumberFlag } from './shared/args.mjs';

export { parseArgs } from './shared/args.mjs';

export const numberFlag = createNumberFlag(DataDiffError);

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
