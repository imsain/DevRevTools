// uidiff's project identity, plus auth cookie minting.
//
// Everything that is not specific to uidiff — finding the checkout, keying
// its artifacts, locating and parsing a config — comes from lib/shared,
// which is generated from shared/ at the repo root.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProject,
  projectKey,
  projectName,
  readJson,
  writeJson
} from './shared/project.mjs';

export { projectKey, projectName, readJson, writeJson };

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const COOKIE_TTL_MS = 6 * 24 * 3600 * 1000;

export class UiDiffError extends Error {}

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
  tool: 'uidiff',
  Err: UiDiffError,
  applyDefaults(config) {
    config.baseUrl ??= 'http://localhost:3000';
    config.viewport = {
      width: 1440,
      height: 900,
      scale: 2,
      ...config.viewport
    };
    config.chromePort ??= 9222;
    config.reloadWaitMs ??= 4000;
    config.settleMs ??= 12000;
  },
  initHelp: [
    'Run "uidiff init" to write one, with this project\'s dev server port',
    'and sign-in method filled in as far as they can be detected.',
    '',
    `Every key it can hold is documented in ${join(ROOT, 'config.example.json')}`
  ],
  // A route's query and hash name the same page as far as a capture goes.
  slug: { stripQuery: true, fallback: 'root' }
});

/**
 * One `auth.claims` entry as data: either the name of an environment variable
 * for the child to read, or a literal value. `env:VAR_NAME` is the config
 * convention for the former.
 */
function claimSource(value) {
  return typeof value === 'string' && value.startsWith('env:')
    ? { env: value.slice(4).trim() }
    : { value };
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;

function tokenTtl(value) {
  if (value === undefined) {
    return DEFAULT_TTL_SECONDS;
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UiDiffError(
      `auth.ttlSeconds must be a positive number of seconds, got ${JSON.stringify(value)}`
    );
  }
  return seconds;
}

/**
 * Mints the cookie in a child process, because the secret and any env-backed
 * claims only exist there — once `--env-file` has loaded the app's own `.env`.
 *
 * Fixed source, with the config arriving as JSON in UIDIFF_TOKEN_SPEC. Nothing
 * from the config is ever interpolated into this text: when it was, a claim
 * value like `env:X ?? somethingElse()` smuggled its own JavaScript into a
 * process holding the app's secrets.
 */
const MINT_SCRIPT = `
const { encode } = await import('@auth/core/jwt');
const spec = JSON.parse(process.env.UIDIFF_TOKEN_SPEC);
const now = Math.floor(Date.now() / 1000);
const claims = {};
for (const [key, claim] of Object.entries(spec.claims)) {
  claims[key] = 'env' in claim ? process.env[claim.env] : claim.value;
}
const token = await encode({
  secret: process.env[spec.secretEnvVar],
  salt: spec.cookieName,
  token: {
    name: 'uidiff',
    email: spec.email,
    sub: spec.email,
    iat: now,
    exp: now + spec.ttlSeconds,
    jti: crypto.randomUUID(),
    ...claims
  }
});
process.stdout.write(spec.cookieName + '=' + token);
`;

/** A minted cookie, reused until it nears expiry. */
function cachedCookie(root, mint) {
  const cachePath = join(stateDir(root), 'cookie.json');
  const hit = readJson(cachePath);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.cookie;
  }
  const cookie = mint();
  if (!cookie.includes('=')) {
    throw new UiDiffError(
      `Minted cookie looks malformed: ${cookie.slice(0, 40)}`
    );
  }
  writeJson(cachePath, { cookie, expiresAt: Date.now() + COOKIE_TTL_MS });
  return cookie;
}

function nextAuthCookie(root, auth) {
  const appDir = resolve(root, auth.appDir ?? '.');
  const envFile = auth.envFile ?? '.env';
  const spec = {
    cookieName: auth.cookieName ?? 'next-auth.session-token',
    secretEnvVar: auth.secretEnvVar ?? 'AUTH_SECRET',
    email: auth.email ?? 'user@example.com',
    ttlSeconds: tokenTtl(auth.ttlSeconds),
    claims: Object.fromEntries(
      Object.entries(auth.claims ?? {}).map(([key, value]) => [
        key,
        claimSource(value)
      ])
    )
  };

  let cookie;
  try {
    cookie = execFileSync(
      process.execPath,
      [`--env-file=${envFile}`, '--input-type=module'],
      {
        cwd: appDir,
        input: MINT_SCRIPT,
        encoding: 'utf8',
        env: { ...process.env, UIDIFF_TOKEN_SPEC: JSON.stringify(spec) }
      }
    ).trim();
  } catch (error) {
    throw new UiDiffError(
      `Failed to mint an auth cookie in ${appDir}: ${error.stderr || error.message}`
    );
  }
  return cookie;
}

/**
 * A `name=value` cookie string, or null when the config declares no auth.
 * Several pairs separated by `; ` are fine — apps that need a session and a
 * CSRF cookie together were previously unable to authenticate at all.
 */
export function authCookie(root, config) {
  const auth = config.auth ?? { mode: 'none' };
  switch (auth.mode) {
    case 'none':
      return null;
    case 'env': {
      const name = auth.envVar ?? 'UIDIFF_COOKIE';
      const value = process.env[name];
      if (!value) {
        throw new UiDiffError(`auth.mode is "env" but ${name} is not set`);
      }
      return value;
    }
    case 'nextauth-offline':
      return cachedCookie(root, () => nextAuthCookie(root, auth));
    default:
      throw new UiDiffError(`Unsupported auth.mode: ${auth.mode}`);
  }
}

export function targetUrl(config, path) {
  if (!path) {
    throw new UiDiffError(
      'Which page? Pass a route, e.g. "uidiff compare /dashboard"'
    );
  }
  return new URL(path, config.baseUrl).href;
}
