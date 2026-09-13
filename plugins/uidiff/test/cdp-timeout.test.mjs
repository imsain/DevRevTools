// A CDP round-trip that never gets a reply used to hang the whole CLI
// forever — a page stuck mid-animation, a font or image load that never
// settles, a devtools target that silently dies. This pins down that `send`
// and `evaluate` fail loudly instead, on a fake socket that never answers, so
// the test finishes in milliseconds rather than needing a real hung page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage } from '../lib/cdp.mjs';

/** A CDP socket that never answers anything, until told to. */
class SilentSocket {
  constructor() {
    this.listeners = { open: [], error: [], message: [] };
    this.sent = [];
    queueMicrotask(() => this.dispatch('open'));
  }
  addEventListener(type, handler) {
    this.listeners[type].push(handler);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners[type]) {
      handler(event);
    }
  }
  send(payload) {
    this.sent.push(JSON.parse(payload));
  }
  close() {}
}

/** Points global fetch/WebSocket at a fake target for the duration of one test. */
function withFakeChrome(t, { onSocket } = {}) {
  const previousFetch = globalThis.fetch;
  const previousSocket = globalThis.WebSocket;
  let socket;

  globalThis.fetch = async () => ({
    json: async () => ({ id: 'fake-target', webSocketDebuggerUrl: 'ws://fake' })
  });
  globalThis.WebSocket = class extends SilentSocket {
    constructor(url) {
      super(url);
      socket = this;
      onSocket?.(this);
    }
  };

  t.after(() => {
    globalThis.fetch = previousFetch;
    globalThis.WebSocket = previousSocket;
  });

  return () => socket;
}

test('a CDP call that never gets a reply times out rather than hanging', async (t) => {
  withFakeChrome(t);
  const page = await openPage(9222);

  await assert.rejects(
    page.send('Page.enable', {}, { timeoutMs: 20 }),
    /Page\.enable did not respond within 20ms/
  );
});

test('evaluate times out the same way, naming Runtime.evaluate', async (t) => {
  withFakeChrome(t);
  const page = await openPage(9222);

  await assert.rejects(
    page.evaluate('1 + 1', { timeoutMs: 20 }),
    /Runtime\.evaluate did not respond within 20ms/
  );
});

test('a reply that arrives before the timeout still resolves normally', async (t) => {
  const getSocket = withFakeChrome(t, {
    onSocket: (socket) => {
      const originalSend = socket.send.bind(socket);
      socket.send = (payload) => {
        originalSend(payload);
        const { id } = JSON.parse(payload);
        queueMicrotask(() =>
          socket.dispatch('message', {
            data: JSON.stringify({ id, result: { ok: true } })
          })
        );
      };
    }
  });
  const page = await openPage(9222);

  const result = await page.send('Page.enable', {}, { timeoutMs: 5000 });
  assert.deepEqual(result, { ok: true });
  void getSocket();
});

test('a late reply after timeout is ignored rather than resolving stale state', async (t) => {
  let socket;
  withFakeChrome(t, { onSocket: (created) => (socket = created) });
  const page = await openPage(9222);

  await assert.rejects(page.send('Page.enable', {}, { timeoutMs: 10 }));

  // The reply Chrome eventually sends for the timed-out call — dispatching it
  // must not throw just because nothing is waiting for id 1 anymore.
  const [{ id }] = socket.sent;
  assert.doesNotThrow(() => {
    socket.dispatch('message', {
      data: JSON.stringify({ id, result: { ok: true } })
    });
  });
});
