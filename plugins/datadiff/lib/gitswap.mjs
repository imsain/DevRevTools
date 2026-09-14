// The git swap, bound to datadiff's own error type and state directory. The
// mechanism itself lives in lib/shared/gitswap.mjs — rebuilding "before"
// without losing uncommitted work is the same problem whether what runs
// against the swapped file is a browser or a query.

import { DataDiffError, readJson, stateDir, writeJson } from './project.mjs';
import { createGitSwap } from './shared/gitswap.mjs';

export { changedAgainst } from './shared/gitswap.mjs';

export const { hasPendingSwap, restoreSwap, swapToRef } = createGitSwap({
  tool: 'datadiff',
  Err: DataDiffError,
  readJson,
  stateDir,
  writeJson
});
