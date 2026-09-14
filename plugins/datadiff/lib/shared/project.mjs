// Generated from shared/lib/project.mjs — do not edit this copy.
// Change the shared file, then run: node scripts/sync-shared.mjs

// Project resolution and config loading, shared by every plugin here.
//
// The parts that differ between tools are the name in a path, the name in an
// error message, and which defaults a config gets — so they arrive as
// parameters rather than being copied into a near-identical second file. What
// is left is genuinely identical: how a checkout is identified, where its
// artifacts live, and how a config is found and parsed.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export function projectName(root) {
  return basename(root);
}

/**
 * Where one checkout's artifacts go, which cannot be the directory name
 * alone: two products both cloned as `web` or `frontend` would share an
 * output directory and overwrite each other's before/after pair. The path is
 * folded in so the name stays readable and the key stays unique.
 *
 * Swap state deliberately still keys on the name alone — see stateDir.
 */
export function projectKey(root) {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 8);
  return `${projectName(root)}-${digest}`;
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

/**
 * The identity-bound half: everything whose behaviour is the same but whose
 * paths and messages say `uidiff` in one plugin and `datadiff` in the next.
 *
 * `tool` drives all three naming conventions at once — `~/.cache/<tool>`,
 * `<TOOL>_CACHE` / `<TOOL>_CONFIG`, and `.<tool>.json` — so a new plugin
 * cannot accidentally invent a fourth.
 */
export function createProject({
  tool,
  Err,
  applyDefaults = () => {},
  initHelp = [],
  slug: { stripQuery = false, fallback: emptySlug = 'root' } = {}
}) {
  const ENV = tool.toUpperCase();

  /**
   * Artifacts stay outside any checkout: they hold real page data and, for
   * uidiff, a valid session token, and nothing gitignored-by-luck should be
   * the only thing keeping them out of a commit.
   *
   * Read per call rather than frozen at import so tests can point it
   * somewhere disposable without depending on module load order.
   */
  function artifactsDir() {
    return process.env[`${ENV}_CACHE`] || join(homedir(), '.cache', tool);
  }

  function repoRoot(cwd = process.cwd()) {
    try {
      return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8'
      }).trim();
    } catch {
      throw new Err(`Not inside a git repository: ${cwd}`);
    }
  }

  /**
   * Where a project's config may live: one committed file at the root of the
   * repo being worked on, and an environment variable to point somewhere
   * else.
   *
   * One name rather than several. Keying config off the checkout's directory
   * name — the obvious alternative when the tool is vendored — breaks the
   * moment somebody clones into a differently-named folder, and settings that
   * belong to a repository should travel with it.
   */
  function configCandidates(root) {
    const override = process.env[`${ENV}_CONFIG`];
    return [
      ...(override ? [resolve(override)] : []),
      join(root, `.${tool}.json`)
    ];
  }

  function configPath(root) {
    const paths = configCandidates(root);
    return paths.find(existsSync) ?? paths[0];
  }

  function loadConfig(root) {
    const path = configPath(root);
    if (!existsSync(path)) {
      throw new Err(
        [
          'No config for this repo. Looked for:',
          ...configCandidates(root).map((candidate) => `  ${candidate}`),
          '',
          ...initHelp
        ].join('\n')
      );
    }
    let config;
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Err(`${path} is not valid JSON: ${error.message}`);
    }
    applyDefaults(config);
    return config;
  }

  function outDir(root, slug) {
    const dir = join(artifactsDir(), 'out', projectKey(root), slug);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Keyed on the checkout's name only, unlike outDir, because a swap manifest
   * records absolute backup paths and this directory is how `<tool> restore`
   * finds work that a crash left swapped out. Changing the key would hide an
   * older manifest from the one command whose job is to recover it.
   *
   * Two same-named checkouts sharing this is safe rather than destructive:
   * swapToRef refuses outright when it finds a manifest it did not write.
   */
  function stateDir(root) {
    const dir = join(artifactsDir(), 'state', projectName(root));
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * A filesystem-safe name for this run's output directory.
   *
   * Routes drop their query and hash, because `/x?page=2` and `/x` are the
   * same page as far as a capture is concerned. Target labels must not: a
   * function target is `file.ts#exportName`, and truncating there would point
   * two different exports at one directory.
   */
  function slugFor(name) {
    const base = stripQuery ? name.split(/[?#]/)[0] : name;
    const trimmed = base.replace(/^\/+|\/+$/g, '');
    return trimmed ? trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-') : emptySlug;
  }

  return {
    artifactsDir,
    configCandidates,
    configPath,
    loadConfig,
    outDir,
    repoRoot,
    slugFor,
    stateDir
  };
}
