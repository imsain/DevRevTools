import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A throwaway git repo plus a disposable artifacts directory, so tests never
 * touch the real `~/.cache/<tool>` or the checkout they run from.
 */
export function createMakeRepo(tool) {
  const cacheVar = `${tool.toUpperCase()}_CACHE`;

  return function makeRepo(t) {
    const dir = mkdtempSync(join(tmpdir(), `${tool}-test-`));
    const cache = mkdtempSync(join(tmpdir(), `${tool}-cache-`));
    const previousCache = process.env[cacheVar];
    process.env[cacheVar] = cache;

    const git = (...args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', `${tool} test`);
    git('config', 'commit.gpgsign', 'false');
    // A globally configured hooks path is inherited by every new repo, so a
    // developer with, say, a gitleaks pre-commit hook installed would watch
    // these tests fail on their machine and nowhere else. Pointing at a path
    // that holds no hooks opts the throwaway repo out.
    git('config', 'core.hooksPath', join(dir, '.git', 'no-hooks'));

    t.after(() => {
      if (previousCache === undefined) {
        delete process.env[cacheVar];
      } else {
        process.env[cacheVar] = previousCache;
      }
      rmSync(dir, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    });

    return { dir, git };
  };
}

/** Contents of a path as git has it staged, or null when it is not in the index. */
export function stagedContents(git, file) {
  try {
    return git('show', `:${file}`);
  } catch {
    return null;
  }
}
