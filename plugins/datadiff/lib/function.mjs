// Runs one exported function from a JS or TS module against a fixed input,
// so a data-processing function can be diffed the same way a SQL query is:
// run it, swap its file to a git ref, run it again.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataDiffError } from './project.mjs';
import { resolutionFor } from './tsconfig.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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
 * Runs the function in a child process with TypeScript-aware module hooks
 * registered. The result has to survive JSON, which every diffable result
 * already does.
 */
export async function runFunction(absolutePath, exportName, input, root) {
  if (!existsSync(absolutePath)) {
    throw new DataDiffError(`no such file: ${absolutePath}`);
  }

  const repoRootDir = root ?? dirname(absolutePath);
  const scratch = mkdtempSync(join(tmpdir(), 'datadiff-'));
  const payloadPath = join(scratch, 'payload.json');
  const outFile = join(scratch, 'result.json');

  writeFileSync(
    payloadPath,
    JSON.stringify({
      url: pathToFileURL(absolutePath).href,
      file: absolutePath,
      exportName,
      input: input === undefined ? null : input,
      outFile
    })
  );

  const { baseUrl, paths } = resolutionFor(dirname(absolutePath), repoRootDir);

  try {
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(join(here, 'ts-register.mjs')).href,
        join(here, 'run-function-child.mjs'),
        payloadPath
      ],
      {
        cwd: repoRootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          DATADIFF_TS_CONFIG: JSON.stringify({ root: repoRootDir, baseUrl, paths })
        }
      }
    );

    if (!existsSync(outFile)) {
      const detail = (child.stderr || child.stdout || '').trim().split('\n').slice(-4).join('\n');
      throw new DataDiffError(
        `running ${exportName} failed before it could report a result.` +
          (detail ? `\n${detail}` : '')
      );
    }

    const payload = JSON.parse(readFileSync(outFile, 'utf8'));
    if (!payload.ok) {
      throw new DataDiffError(payload.message);
    }
    return payload.result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
