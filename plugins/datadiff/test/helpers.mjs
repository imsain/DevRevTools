import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway git repo plus a disposable artifacts directory, mirroring
 * uidiff's own test helper: tests never touch ~/.cache/datadiff or the
 * checkout they run from. */
export function makeRepo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'datadiff-test-'));
  const cache = mkdtempSync(join(tmpdir(), 'datadiff-cache-'));
  const previousCache = process.env.DATADIFF_CACHE;
  process.env.DATADIFF_CACHE = cache;

  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'datadiff test');
  git('config', 'commit.gpgsign', 'false');

  t.after(() => {
    if (previousCache === undefined) {
      delete process.env.DATADIFF_CACHE;
    } else {
      process.env.DATADIFF_CACHE = previousCache;
    }
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  return { dir, git };
}
