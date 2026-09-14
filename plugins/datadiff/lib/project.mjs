// datadiff's project identity.
//
// Finding the checkout, keying its artifacts, and locating and parsing a
// config are the same job here as in the other plugins, so they come from
// lib/shared, which is generated from shared/ at the repo root.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from './shared/project.mjs';

export {
  projectKey,
  projectName,
  readJson,
  writeJson
} from './shared/project.mjs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export class DataDiffError extends Error {}

export const {
  artifactsDir,
  configCandidates,
  configPath,
  loadConfig,
  outDir,
  repoRoot,
  slugFor,
  stateDir
} = createProject({
  tool: 'datadiff',
  Err: DataDiffError,
  applyDefaults(config) {
    config.sql ??= {};
    config.sql.cli ??= 'snowsql';
    config.rowLimit ??= 500;
  },
  initHelp: ['Run "datadiff init" to write one.'],
  // Target labels keep their `#`: it separates a file from the export being
  // run, and two exports of one file must not share an output directory.
  slug: { stripQuery: false, fallback: 'target' }
});
