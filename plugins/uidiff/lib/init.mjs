// Scaffolding one repo's config, so a product nobody has set up before is a
// command away from its first capture rather than a hand-written JSON file.
//
// Detection only writes what it can be confident about. Everything else it
// prints as a note, because a wrong value inside a file the user never opened
// is worse than a blank they were told about.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { UiDiffError, configPath, writeJson } from './project.mjs';

/**
 * Dev server ports by framework, most specific first: SvelteKit and Astro both
 * depend on vite, so a bare `vite` entry has to be matched last or it would
 * claim their ports.
 */
const FRAMEWORKS = [
  { dep: 'next', name: 'Next.js', port: 3000 },
  { dep: 'nuxt', name: 'Nuxt', port: 3000 },
  { dep: '@remix-run/dev', name: 'Remix', port: 3000 },
  { dep: 'react-scripts', name: 'Create React App', port: 3000 },
  { dep: '@sveltejs/kit', name: 'SvelteKit', port: 5173 },
  { dep: 'astro', name: 'Astro', port: 4321 },
  { dep: '@angular/cli', name: 'Angular', port: 4200 },
  { dep: '@vue/cli-service', name: 'Vue CLI', port: 8080 },
  { dep: 'vite', name: 'Vite', port: 5173 }
];

const FALLBACK_PORT = 3000;
const ENV_FILES = ['.env', '.env.local', '.env.development'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target'
]);

export function dependencies(pkg) {
  return { ...pkg?.devDependencies, ...pkg?.dependencies };
}

function frameworkOf(deps) {
  return FRAMEWORKS.find(({ dep }) => dep in deps) ?? null;
}

/**
 * The major version a dependency range asks for. `^5.0.0-beta.29`, which is
 * what `npm i next-auth@beta` records, has to read as 5.
 */
export function majorOf(range) {
  const found = String(range ?? '').match(/\d+/);
  return found ? Number(found[0]) : null;
}

/**
 * A port named explicitly in a dev script, which outranks the framework
 * default whenever a project has moved off it — much the most common reason a
 * first capture photographs nothing at all.
 */
export function portFromScript(script) {
  const patterns = [
    /--port[=\s]+"?(\d{2,5})/,
    /(?:^|\s)-p[=\s]+"?(\d{2,5})/,
    /\bPORT[=:]\s*"?(\d{2,5})/
  ];
  for (const pattern of patterns) {
    const found = String(script ?? '').match(pattern);
    if (found) {
      return Number(found[1]);
    }
  }
  return null;
}

function readPackage(dir) {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A package.json too broken to parse tells us nothing, and is not this
    // command's problem to report.
    return null;
  }
}

/**
 * Every package.json worth reading: the repo root and two levels below it, so
 * the usual monorepo shapes (`apps/web`, `packages/ui`, `application/core`)
 * are found without walking an entire checkout. Shallowest first, so a root
 * app wins over a nested one.
 */
function packagesUnder(root, depth = 2) {
  const found = [];
  const walk = (dir, left) => {
    const pkg = readPackage(dir);
    if (pkg) {
      found.push({ dir, pkg });
    }
    if (left === 0) {
      return;
    }
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !SKIP_DIRS.has(entry.name)
      ) {
        walk(join(dir, entry.name), left - 1);
      }
    }
  };
  walk(root, depth);
  return found.sort(
    (a, b) => a.dir.split(sep).length - b.dir.split(sep).length
  );
}

/** Which secret name the app's env files use. Key names only, never values. */
function secretEnvVar(dir) {
  for (const file of ENV_FILES) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      continue;
    }
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    for (const name of ['AUTH_SECRET', 'NEXTAUTH_SECRET']) {
      if (new RegExp(`^\\s*(export\\s+)?${name}\\s*=`, 'm').test(text)) {
        return { name, file };
      }
    }
  }
  return { name: 'AUTH_SECRET', file: null };
}

const COOKIE_RECIPE = [
  'For pages behind sign-in: sign in in your browser, copy the session',
  'cookie, export UIDIFF_COOKIE="name=value", and set auth to',
  '{ "mode": "env" }. That works whatever the stack.'
];

/**
 * `nextauth-offline` mints a token through @auth/core/jwt, whose encode()
 * takes a salt — that is Auth.js v5. next-auth v4 signs via next-auth/jwt with
 * a different signature, so offering it there would fail at mint time citing a
 * package the user never installed. v4 is sent to the cookie escape hatch.
 */
function detectAuth(appPath, appDir, deps) {
  const version = majorOf(deps['next-auth']);
  // Auth.js used directly, by something that is not next-auth at all.
  const authJsCore = !('next-auth' in deps) && '@auth/core' in deps;
  if (!authJsCore && !(version >= 5)) {
    return {
      auth: { mode: 'none' },
      notes: [
        ...(version
          ? [
              `next-auth ${version} found, which cannot be signed offline —`,
              'that needs Auth.js v5.'
            ]
          : []),
        ...COOKIE_RECIPE
      ]
    };
  }

  const secret = secretEnvVar(appPath);
  const envFile =
    secret.file ??
    ENV_FILES.find((file) => existsSync(join(appPath, file))) ??
    '.env';
  // This name is also the encryption salt, so a wrong guess does not fail
  // loudly — it mints a token the app quietly refuses, and the capture comes
  // back as a sign-in page. next-auth v5 kept the `next-auth.` prefix; only
  // Auth.js used on its own moved to `authjs.`.
  const cookieName = authJsCore
    ? 'authjs.session-token'
    : 'next-auth.session-token';
  return {
    auth: {
      mode: 'nextauth-offline',
      appDir,
      envFile,
      cookieName,
      secretEnvVar: secret.name,
      email: 'uidiff@example.com'
    },
    notes: [
      `Signs its own session token with ${secret.name} from ${appDir}/${envFile},` +
        ' so no browser and no identity provider are involved.',
      'If your JWT callback requires extra claims (a tenant or user id), add',
      'them under auth.claims — "uidiff doctor" fails loudly if one is missing.'
    ]
  };
}

/**
 * Everything about this repo that can be worked out without running it. Pure
 * and filesystem-only: no dev server is contacted, so `init` stays usable
 * before anything has been started.
 */
export function detectProject(root) {
  const packages = packagesUnder(root);
  const chosen =
    packages.find(({ pkg }) => frameworkOf(dependencies(pkg))) ??
    packages[0] ??
    null;

  if (!chosen) {
    return {
      appDir: '.',
      framework: null,
      baseUrl: `http://localhost:${FALLBACK_PORT}`,
      portSource: 'a guess',
      auth: { mode: 'none' },
      notes: [
        'No package.json anywhere near the root, so nothing about the dev',
        `server could be detected and baseUrl is a plain guess at ${FALLBACK_PORT}.`,
        'Set it to whatever your dev server actually serves.',
        ...COOKIE_RECIPE
      ]
    };
  }

  const deps = dependencies(chosen.pkg);
  const framework = frameworkOf(deps);
  const appDir = relative(root, chosen.dir) || '.';
  const scripted = portFromScript(
    chosen.pkg.scripts?.dev ?? chosen.pkg.scripts?.start
  );
  const port = scripted ?? framework?.port ?? FALLBACK_PORT;
  const { auth, notes } = detectAuth(chosen.dir, appDir, deps);

  return {
    appDir,
    framework: framework?.name ?? null,
    baseUrl: `http://localhost:${port}`,
    portSource: scripted
      ? 'the dev script'
      : framework
        ? `${framework.name}'s default`
        : 'a guess',
    auth,
    notes: [
      ...(framework
        ? []
        : [
            'No dev server this tool recognises, so the port is a guess. Set',
            'baseUrl to whatever yours serves.'
          ]),
      ...notes
    ]
  };
}

const HEADER =
  'uidiff settings for this repo. These are the only keys most projects need;' +
  ' everything else has a default, and the full annotated list is in' +
  ' config.example.json where uidiff itself is installed. Nothing about a' +
  ' particular screen belongs here — routes and selectors are named per run.';

export function initConfig(root, { force = false } = {}) {
  const path = configPath(root);
  if (existsSync(path) && !force) {
    throw new UiDiffError(
      `${path} already exists. Edit it, or pass --force to start over.`
    );
  }
  const detected = detectProject(root);
  writeJson(path, {
    '//': HEADER,
    baseUrl: detected.baseUrl,
    auth: detected.auth
  });
  return { path, detected };
}
