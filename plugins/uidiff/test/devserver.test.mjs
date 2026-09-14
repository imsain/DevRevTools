// The dev-server module, which is the one part of this tool that starts and
// kills processes. The risk is not a bad screenshot, it is a server left
// running on a port or — worse — one stopped that the run did not start, so
// ownership and teardown get the coverage here.
//
// Everything below talks to a real HTTP server on a real loopback port. None
// of it reaches the network, Chrome, or a framework.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectDevCommand,
  probe,
  startDevServer,
  waitUntilUp
} from '../lib/devserver.mjs';

/** A server on an OS-assigned port, torn down when the test ends. */
async function serveOnce(t, status = 200) {
  const server = createServer((_request, response) => {
    response.writeHead(status);
    response.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

/** A port nothing is listening on: opened, its number taken, then closed. */
async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function repo(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'uidiff-devserver-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents);
  }
  return dir;
}

const pkg = (scripts) => JSON.stringify({ scripts });

test('a listening server is up', async (t) => {
  const url = await serveOnce(t);
  assert.deepEqual(await probe(url), { up: true, status: 200 });
});

// A 500 is a server with a broken page, which the capture itself reports. Only
// "nothing is listening" is this module's business.
test('a server returning 500 still counts as up', async (t) => {
  const url = await serveOnce(t, 500);
  const result = await probe(url);
  assert.equal(result.up, true);
  assert.equal(result.status, 500);
});

test('a closed port is down, with a reason', async () => {
  const result = await probe(`http://127.0.0.1:${await closedPort()}`, {
    timeoutMs: 1000
  });
  assert.equal(result.up, false);
  assert.ok(result.error);
});

test('waiting gives up rather than hanging when nothing arrives', async () => {
  const started = Date.now();
  const ready = await waitUntilUp(`http://127.0.0.1:${await closedPort()}`, {
    timeoutMs: 600,
    intervalMs: 100
  });
  assert.equal(ready, false);
  assert.ok(Date.now() - started >= 600, 'returned before its own deadline');
});

test('waiting succeeds for a server that arrives late', async (t) => {
  const port = await closedPort();
  const server = createServer((_request, response) => response.end('ok'));
  t.after(() => server.close());
  setTimeout(() => server.listen(port, '127.0.0.1'), 250);

  const ready = await waitUntilUp(`http://127.0.0.1:${port}`, {
    timeoutMs: 5000,
    intervalMs: 100
  });
  assert.equal(ready, true);
});

test('the dev command comes from the lockfile the repo commits to', (t) => {
  const yarn = repo(t, {
    'package.json': pkg({ dev: 'next dev' }),
    'yarn.lock': ''
  });
  assert.equal(detectDevCommand(yarn).command, 'yarn dev');

  const pnpm = repo(t, {
    'package.json': pkg({ dev: 'vite' }),
    'pnpm-lock.yaml': ''
  });
  assert.equal(detectDevCommand(pnpm).command, 'pnpm dev');

  const bun = repo(t, {
    'package.json': pkg({ dev: 'vite' }),
    'bun.lockb': ''
  });
  assert.equal(detectDevCommand(bun).command, 'bun run dev');
});

test('npm is the assumption when no lockfile says otherwise', (t) => {
  const dir = repo(t, { 'package.json': pkg({ dev: 'next dev' }) });
  assert.equal(detectDevCommand(dir).command, 'npm run dev');
});

test('a start script is used when there is no dev script', (t) => {
  const dir = repo(t, { 'package.json': pkg({ start: 'serve' }) });
  const detected = detectDevCommand(dir);
  assert.equal(detected.script, 'start');
  assert.equal(detected.command, 'npm run start');
});

// Guessing here would spawn something unrelated, so nothing is better.
test('no dev script means no command, rather than a guess', (t) => {
  assert.equal(
    detectDevCommand(repo(t, { 'package.json': pkg({ test: 'x' }) })),
    null
  );
  assert.equal(detectDevCommand(repo(t, {})), null);
});

test('a monorepo app uses its own scripts and the root lockfile', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'uidiff-devserver-mono-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'yarn.lock'), '');
  const app = join(root, 'web');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), pkg({ dev: 'next dev' }));

  const detected = detectDevCommand(root, 'web');
  assert.equal(detected.command, 'yarn dev');
  assert.equal(detected.cwd, app);
});

test('a started server is reachable, and stop() takes it down', async (t) => {
  const port = await closedPort();
  const dir = repo(t, {
    'server.mjs': `import { createServer } from 'node:http';
createServer((_q, s) => s.end('ok')).listen(${port}, '127.0.0.1');`
  });
  const url = `http://127.0.0.1:${port}`;

  const server = startDevServer({
    command: `${process.execPath} server.mjs`,
    cwd: dir
  });
  t.after(() => server.stop());

  assert.equal(
    await waitUntilUp(url, { timeoutMs: 10000, intervalMs: 100 }),
    true,
    'the started server never answered'
  );

  server.stop();
  // SIGTERM is not instant; the port is free once the process has gone.
  const deadline = Date.now() + 5000;
  let stillUp = true;
  while (Date.now() < deadline && stillUp) {
    stillUp = (await probe(url, { timeoutMs: 500 })).up;
  }
  assert.equal(stillUp, false, 'the server outlived stop()');
});

// Stopping twice happens on the normal path: the run stops the server, then
// the exit handler fires. The second call must not throw or signal a stranger.
test('stopping an already-stopped server is harmless', async (t) => {
  const dir = repo(t, { 'server.mjs': 'setTimeout(() => {}, 50);' });
  const server = startDevServer({
    command: `${process.execPath} server.mjs`,
    cwd: dir
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  server.stop();
  assert.doesNotThrow(() => server.stop());
});
