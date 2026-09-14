// The git swap, bound to uidiff's own error type and state directory. The
// mechanism itself lives in lib/shared/gitswap.mjs.

import { UiDiffError, readJson, stateDir, writeJson } from './project.mjs';
import { createGitSwap } from './shared/gitswap.mjs';

export { changedAgainst } from './shared/gitswap.mjs';

export const { hasPendingSwap, restoreSwap, swapToRef } = createGitSwap({
  tool: 'uidiff',
  Err: UiDiffError,
  readJson,
  stateDir,
  writeJson
});
