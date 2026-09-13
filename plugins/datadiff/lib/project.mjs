// Project resolution and config loading. Deliberately the same shape as
// uidiff's own lib/project.mjs — same reasoning applies, none of the code is
// shared, because these two plugins are meant to stay independently
// installable.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export class DataDiffError extends Error {}

/** Run state — swap backups, cached query output — kept outside any checkout. */
export function artifactsDir() {
  return process.env.DATADIFF_CACHE || join(homedir(), '.cache', 'datadiff');
}

export function repoRoot(cwd = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8'
    }).trim();
  } catch {
    throw new DataDiffError(`Not inside a git repository: ${cwd}`);
  }
}

export function projectName(root) {
  return basename(root);
}

/** Same collision-avoidance as uidiff's projectKey: hash the full path in. */
export function projectKey(root) {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return `${projectName(root)}-${digest}`;
}

export function configCandidates(root) {
  return [
    ...(process.env.DATADIFF_CONFIG
      ? [resolve(process.env.DATADIFF_CONFIG)]
      : []),
    join(root, '.datadiff.json')
  ];
}

export function configPath(root) {
  const paths = configCandidates(root);
  return paths.find(existsSync) ?? paths[0];
}

export function loadConfig(root) {
  const path = configPath(root);
  if (!existsSync(path)) {
    throw new DataDiffError(
      [
        'No config for this repo. Looked for:',
        ...configCandidates(root).map((candidate) => `  ${candidate}`),
        '',
        'Run "datadiff init" to write one.'
      ].join('\n')
    );
  }
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new DataDiffError(`${path} is not valid JSON: ${error.message}`);
  }
  config.sql ??= {};
  config.sql.cli ??= 'snowsql';
  config.rowLimit ??= 500;
  return config;
}

export function outDir(root, slug) {
  const dir = join(artifactsDir(), 'out', projectKey(root), slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Keyed on name alone, same rationale as uidiff's stateDir: this is how a
 * crashed run's pending swap gets found again, independent of the exact
 * checkout path. */
export function stateDir(root) {
  const dir = join(artifactsDir(), 'state', projectName(root));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

/** A filesystem-safe name for a target, used as this run's output directory. */
export function slugFor(name) {
  const trimmed = name.replace(/^\/+|\/+$/g, '');
  return trimmed
    ? trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-')
    : 'target';
}
