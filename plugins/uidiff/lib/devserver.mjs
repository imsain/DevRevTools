// Is anything serving the app, and — only when asked — starting one.
//
// The rule this module exists to enforce: a run uses a server it found, and
// owns a server it started. It never stops one it did not start, because from
// the outside a dev server you launched and one it launched are the same
// process listening on the same port.
//
// That is also why a started server is not detached. Leaving one behind means
// the next run finds a server nobody remembers starting, holding the port and
// serving whatever the working tree looked like at the time.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long to wait for a single reachability check before calling it down. */
const PROBE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 500;

/**
 * Whether anything answers at `baseUrl`. Any HTTP response counts, including a
 * 500: that is a server with a broken page, which is a different problem from
 * no server at all, and one the capture itself reports.
 */
export async function probe(baseUrl, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  try {
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual'
    });
    return { up: true, status: response.status };
  } catch (error) {
    return { up: false, error: error.message };
  }
}

/**
 * Polls until something answers at `baseUrl`, or the budget runs out. This is
 * a startup wait only — once a server is up it answers immediately, so it
 * cannot tell you a file swap has been picked up. That is what reloadWaitMs is
 * for.
 */
export async function waitUntilUp(
  baseUrl,
  { timeoutMs, intervalMs = POLL_INTERVAL_MS, onWait } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let waited = false;
  while (Date.now() < deadline) {
    const { up } = await probe(baseUrl, {
      timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(500, timeoutMs))
    });
    if (up) {
      return true;
    }
    if (!waited) {
      waited = true;
      onWait?.();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** The package manager a checkout is committed to, by the lockfile it keeps. */
const LOCKFILES = [
  { file: 'yarn.lock', run: (script) => `yarn ${script}` },
  { file: 'pnpm-lock.yaml', run: (script) => `pnpm ${script}` },
  { file: 'bun.lockb', run: (script) => `bun run ${script}` },
  { file: 'package-lock.json', run: (script) => `npm run ${script}` }
];

function readScripts(dir) {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')).scripts ?? {};
  } catch {
    return null;
  }
}

/**
 * The command that would start this repo's dev server, worked out the same way
 * a person would: the script named `dev` (or `start`), run through whichever
 * package manager the lockfile commits to. Looks for the lockfile beside the
 * app and then at the repo root, since a monorepo keeps one at the top.
 *
 * Returns null rather than guessing when there is no dev script to run — a
 * wrong command here would spawn something unrelated.
 */
export function detectDevCommand(root, appDir = '.') {
  const cwd = join(root, appDir);
  const scripts = readScripts(cwd);
  if (!scripts) {
    return null;
  }
  const script = ['dev', 'start'].find((name) => scripts[name]);
  if (!script) {
    return null;
  }
  const lock = LOCKFILES.find(
    ({ file }) => existsSync(join(cwd, file)) || existsSync(join(root, file))
  );
  return {
    command: (lock ?? LOCKFILES[3]).run(script),
    cwd,
    script
  };
}

/**
 * Starts `command` in `cwd` and hands back something that can stop it.
 *
 * The child gets its own process group (`detached`) so that stopping it takes
 * the whole tree down — a `yarn dev` is a shell that spawns the real server,
 * and signalling only the shell leaves the server holding the port. It is
 * still killed on the way out; detached here buys reliable teardown, not
 * survival.
 */
export function startDevServer({ command, cwd, onExit }) {
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: 'ignore'
  });

  // Without this the child's handle keeps the parent's event loop alive and
  // the run never exits after its last capture. Teardown is explicit instead.
  child.unref();

  let stopped = false;
  const stop = () => {
    if (stopped || child.exitCode !== null || child.signalCode !== null) {
      stopped = true;
      return;
    }
    stopped = true;
    try {
      // Negative pid signals the group, which is the point of `detached`.
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone, or never got far enough to have a group.
    }
  };

  child.on('exit', (code, signal) => {
    if (!stopped) {
      onExit?.(code, signal);
    }
  });

  // A run that is interrupted must not leave the server behind. These are
  // removed when the run stops the server itself.
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', stop);

  return {
    pid: child.pid,
    stop: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.off('exit', stop);
      stop();
    }
  };
}
