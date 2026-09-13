// What `uidiff init` writes for a repo it has never seen. The detection is
// guesswork by nature, so what these pin down is that it guesses from the
// right evidence and never claims more than it found: a wrong baseUrl in a
// file nobody opened is a capture of the wrong thing, and an auth mode the
// stack cannot support fails much later, citing a package the user never
// installed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectProject,
  initConfig,
  majorOf,
  portFromScript
} from '../lib/init.mjs';
import { loadConfig } from '../lib/project.mjs';
import { makeRepo } from './helpers.mjs';

/** A package.json at `dir` relative to the repo root. */
function writePackage(root, dir, pkg) {
  const target = join(root, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), JSON.stringify(pkg));
  return target;
}

test('reads the port out of the dev script, however it is written', () => {
  assert.equal(portFromScript('next dev --port 4001'), 4001);
  assert.equal(portFromScript('next dev --port=4002'), 4002);
  assert.equal(portFromScript('next dev -p 4003'), 4003);
  assert.equal(portFromScript('PORT=4004 react-scripts start'), 4004);
  assert.equal(portFromScript('vite'), null);
  assert.equal(portFromScript(undefined), null);
});

test('does not read the "-p" inside "--port" as a different flag', () => {
  assert.equal(portFromScript('astro dev --port 4005'), 4005);
});

test('a next-auth beta range reads as version 5', () => {
  assert.equal(majorOf('^5.0.0-beta.29'), 5);
  assert.equal(majorOf('^4.24.7'), 4);
  assert.equal(majorOf('latest'), null);
  assert.equal(majorOf(undefined), null);
});

test('an explicit port beats the framework default', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    dependencies: { next: '14.2.0' },
    scripts: { dev: 'next dev -p 3100' }
  });

  const detected = detectProject(dir);
  assert.equal(detected.baseUrl, 'http://localhost:3100');
  assert.equal(detected.portSource, 'the dev script');
});

test('falls back to the framework default, and says so', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    devDependencies: { astro: '4.0.0' },
    scripts: { dev: 'astro dev' }
  });

  const detected = detectProject(dir);
  assert.equal(detected.baseUrl, 'http://localhost:4321');
  assert.match(detected.portSource, /Astro/);
});

test('a framework that only depends on vite keeps its own port', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    devDependencies: { '@sveltejs/kit': '2.0.0', vite: '5.0.0' }
  });

  assert.equal(detectProject(dir).baseUrl, 'http://localhost:5173');
  assert.equal(detectProject(dir).framework, 'SvelteKit');
});

test('finds the front end in a monorepo and records where it is', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', { name: 'monorepo', private: true });
  writePackage(dir, 'packages/utils', { name: 'utils' });
  writePackage(dir, 'apps/web', {
    dependencies: { next: '14.2.0' },
    scripts: { dev: 'next dev' }
  });

  const detected = detectProject(dir);
  assert.equal(detected.appDir, join('apps', 'web'));
  assert.equal(detected.framework, 'Next.js');
});

test('node_modules is never searched for the app', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', { name: 'plain' });
  writePackage(dir, 'node_modules/next-example', {
    dependencies: { next: '14.2.0' }
  });

  assert.equal(detectProject(dir).framework, null);
});

test('a repo with no package.json still gets a usable config', (t) => {
  const { dir } = makeRepo(t);

  const detected = detectProject(dir);
  assert.equal(detected.baseUrl, 'http://localhost:3000');
  assert.equal(detected.portSource, 'a guess');
  assert.equal(detected.auth.mode, 'none');
  assert.match(detected.notes.join(' '), /guess/);
});

test('Auth.js v5 is configured to sign its own token', (t) => {
  const { dir } = makeRepo(t);
  const app = writePackage(dir, '.', {
    dependencies: { next: '14.2.0', 'next-auth': '^5.0.0-beta.29' }
  });
  writeFileSync(join(app, '.env'), 'NEXTAUTH_SECRET=shhh\n');

  const { auth } = detectProject(dir);
  assert.equal(auth.mode, 'nextauth-offline');
  assert.equal(auth.appDir, '.');
  assert.equal(auth.envFile, '.env');
  assert.equal(
    auth.secretEnvVar,
    'NEXTAUTH_SECRET',
    'the name this app actually uses, not the newer default'
  );
});

// The cookie name is the salt the token is encrypted with, so getting it wrong
// does not fail loudly — the app refuses the cookie and the capture comes back
// as a sign-in page. next-auth v5 kept the old prefix; Auth.js on its own did
// not, and the two are easy to conflate because v5 depends on @auth/core.
test('next-auth v5 keeps the next-auth cookie prefix', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    dependencies: { next: '15.0.0', 'next-auth': '5.0.0-beta.31' }
  });

  assert.equal(detectProject(dir).auth.cookieName, 'next-auth.session-token');
});

test('Auth.js used on its own gets the authjs prefix', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    dependencies: { '@auth/core': '0.34.0', '@sveltejs/kit': '2.0.0' }
  });

  assert.equal(detectProject(dir).auth.cookieName, 'authjs.session-token');
});

test('next-auth v4 is sent to the cookie escape hatch instead', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    dependencies: { next: '13.0.0', 'next-auth': '^4.24.7' }
  });

  const detected = detectProject(dir);
  assert.equal(
    detected.auth.mode,
    'none',
    'v4 cannot be minted through @auth/core/jwt, so claiming it would fail later'
  );
  assert.match(detected.notes.join(' '), /UIDIFF_COOKIE/);
});

test('what it writes is a config the tool can then load', (t) => {
  const { dir } = makeRepo(t);
  writePackage(dir, '.', {
    dependencies: { next: '14.2.0' },
    scripts: { dev: 'next dev -p 3100' }
  });

  const { path } = initConfig(dir);
  assert.equal(path, join(dir, '.uidiff.json'));

  const config = loadConfig(dir);
  assert.equal(config.baseUrl, 'http://localhost:3100');
  // Defaults still arrive for everything init left out.
  assert.deepEqual(config.viewport, { width: 1440, height: 900, scale: 2 });
  assert.equal(config.settleMs, 12000);
});

test('refuses to overwrite a config without being told to', (t) => {
  const { dir } = makeRepo(t);
  writeFileSync(
    join(dir, '.uidiff.json'),
    JSON.stringify({ baseUrl: 'http://localhost:9999' })
  );

  assert.throws(() => initConfig(dir), /already exists/);
  assert.equal(
    loadConfig(dir).baseUrl,
    'http://localhost:9999',
    'and leaves the existing one exactly as it was'
  );

  initConfig(dir, { force: true });
  assert.equal(loadConfig(dir).baseUrl, 'http://localhost:3000');
});

test('the written file explains itself', (t) => {
  const { dir } = makeRepo(t);
  const { path } = initConfig(dir);

  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.match(written['//'], /config\.example\.json/);
});
