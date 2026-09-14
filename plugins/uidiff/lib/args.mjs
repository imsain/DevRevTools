// Command-line parsing, bound to uidiff's error type. The parsing itself
// lives in lib/shared/args.mjs.

import { UiDiffError } from './project.mjs';
import { createNumberFlag } from './shared/args.mjs';

export { parseArgs } from './shared/args.mjs';

export const numberFlag = createNumberFlag(UiDiffError);
