// Temporarily puts one or more files back to an earlier revision so a
// "before" run can happen after the change was already made. Identical
// approach to uidiff's lib/gitswap.mjs, since the problem — rebuild "before"
// without losing uncommitted work — is the same regardless of what gets run
// against the swapped file.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  unlinkSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DataDiffError, readJson, stateDir, writeJson } from './project.mjs';

const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function manifestPath(root) {
  return join(stateDir(root), 'swap-manifest.json');
}

const lines = (output) => (output ? output.split('\n').filter(Boolean) : []);

/** Every file that differs from `ref`, tracked or not. */
export function changedAgainst(root, ref, paths = []) {
  const tracked = git(root, ['diff', '--name-only', ref, '--', ...paths]);
  const untracked = git(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    ...paths
  ]);
  return [...new Set([...lines(tracked), ...lines(untracked)])].sort();
}

/**
 * Swaps `files` to their contents at `ref`. Returns a restore function; also
 * leaves a manifest behind so `datadiff restore` can recover from a crash.
 */
export function swapToRef(root, ref, files) {
  if (files.length === 0) {
    throw new DataDiffError(
      `Nothing differs from ${ref} — no "before" state to build`
    );
  }
  if (readJson(manifestPath(root))?.files?.length) {
    throw new DataDiffError(
      `A previous swap was not restored. Run "datadiff restore" first.`
    );
  }

  const backupDir = join(stateDir(root), 'swap-backup');
  rmSync(backupDir, { recursive: true, force: true });

  const entries = files.map((file) => {
    const absolute = join(root, file);
    const backup = join(backupDir, file);
    const existedBefore = existsSync(absolute);
    if (existedBefore) {
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(absolute, backup);
    }
    return { file, backup, existedBefore };
  });

  const index = lines(
    git(root, ['-c', 'core.quotePath=false', 'ls-files', '-s', '--', ...files])
  );
  writeJson(manifestPath(root), { ref, files: entries, index });

  for (const { file, existedBefore } of entries) {
    const existsAtRef =
      git(root, ['ls-tree', '--name-only', ref, '--', file]).length > 0;
    if (existsAtRef) {
      git(root, ['checkout', ref, '--', file]);
    } else if (existedBefore) {
      unlinkSync(join(root, file));
    }
  }

  return () => restoreSwap(root);
}

export function restoreSwap(root) {
  const manifest = readJson(manifestPath(root));
  if (!manifest?.files?.length) {
    return 0;
  }
  for (const { file, backup, existedBefore } of manifest.files) {
    const absolute = join(root, file);
    if (existedBefore) {
      mkdirSync(dirname(absolute), { recursive: true });
      copyFileSync(backup, absolute);
    } else if (existsSync(absolute)) {
      unlinkSync(absolute);
    }
  }
  const restored = manifest.files.length;
  writeJson(manifestPath(root), {});
  rmSync(join(stateDir(root), 'swap-backup'), { recursive: true, force: true });
  restoreIndex(root, manifest);
  return restored;
}

function restoreIndex(root, manifest) {
  const entries = manifest.index ?? [];
  const staged = new Set(
    entries.map((line) => line.slice(line.indexOf('\t') + 1))
  );
  const unstage = manifest.files
    .map((entry) => entry.file)
    .filter((file) => !staged.has(file));
  try {
    if (entries.length > 0) {
      execFileSync('git', ['update-index', '--index-info'], {
        cwd: root,
        input: `${entries.join('\n')}\n`,
        encoding: 'utf8'
      });
    }
    if (unstage.length > 0) {
      git(root, ['update-index', '--force-remove', '--', ...unstage]);
    }
  } catch {
    // The working tree, which holds the actual work, is already back —
    // an odd index state after that is not worth failing the run over.
  }
}

export function hasPendingSwap(root) {
  return (readJson(manifestPath(root))?.files?.length ?? 0) > 0;
}
