import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeMcp,
  readMcpServerConfig,
  resolveMcpTarget,
  resolveSqlTool,
  rowsFromToolResult,
  runMcpQuery,
  sqlArgumentName
} from '../lib/mcp.mjs';
import { DataDiffError } from '../lib/project.mjs';

/**
 * A real HTTP server speaking enough MCP to answer one query, so the transport
 * is exercised rather than stubbed — the parts most likely to break are the
 * session header and the SSE framing, and neither shows up in a mock.
 *
 * `handlers` maps a JSON-RPC method to a result. `transport` picks how the
 * response is framed, since a server may choose either and the client has to
 * cope with both.
 */
async function withMcpServer({ handlers, transport = 'json', onRequest }, run) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const message = body ? JSON.parse(body) : {};
      seen.push({ message, headers: request.headers });
      onRequest?.(message, request, response);
      if (response.writableEnded) {
        return;
      }

      // A notification gets no response body, per JSON-RPC.
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }

      const handler = handlers[message.method];
      if (!handler) {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `no handler: ${message.method}` }
          })
        );
        return;
      }

      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: typeof handler === 'function' ? handler(message) : handler
      });

      const headers =
        message.method === 'initialize'
          ? { 'Mcp-Session-Id': 'session-abc' }
          : {};

      if (transport === 'sse') {
        response.writeHead(200, {
          ...headers,
          'Content-Type': 'text/event-stream'
        });
        // Interleaved noise a real stream carries, to prove the client picks
        // the response matching its own request id.
        response.write(': keep-alive\n\n');
        response.write(
          `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} })}\n\n`
        );
        response.end(`data: ${payload}\n\n`);
        return;
      }

      response
        .writeHead(200, { ...headers, 'Content-Type': 'application/json' })
        .end(payload);
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    return await run({ url, seen });
  } finally {
    await new Promise((done) => server.close(done));
  }
}

const INITIALIZE = {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  serverInfo: { name: 'fake-warehouse', version: '1.0.0' }
};

const SQL_TOOL = {
  name: 'run_sql',
  description: 'Run a SQL statement',
  inputSchema: {
    type: 'object',
    properties: { statement: { type: 'string' } },
    required: ['statement']
  }
};

function jsonRows(rows) {
  return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
}

test('runs a statement over MCP and returns its rows', async () => {
  const rows = await withMcpServer(
    {
      handlers: {
        initialize: INITIALIZE,
        'tools/list': { tools: [SQL_TOOL] },
        'tools/call': jsonRows([{ REGION: 'US', HEADCOUNT: 10 }])
      }
    },
    ({ url }) => runMcpQuery('/repo', { url }, 'select 1')
  );
  assert.deepEqual(rows, [{ REGION: 'US', HEADCOUNT: 10 }]);
});

test('the statement is sent as the argument the tool schema names', async () => {
  const { calls } = await withMcpServer(
    {
      handlers: {
        initialize: INITIALIZE,
        'tools/list': {
          tools: [
            {
              name: 'run_sql',
              inputSchema: {
                type: 'object',
                properties: { sql_statement: { type: 'string' } }
              }
            }
          ]
        },
        'tools/call': jsonRows([{ ok: 1 }])
      }
    },
    async ({ url, seen }) => {
      await runMcpQuery('/repo', { url }, 'select 42');
      return {
        calls: seen.filter((entry) => entry.message.method === 'tools/call')
      };
    }
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].message.params.arguments, {
    sql_statement: 'select 42'
  });
});

test('an SSE response carries the same result as a JSON one', async () => {
  const rows = await withMcpServer(
    {
      transport: 'sse',
      handlers: {
        initialize: INITIALIZE,
        'tools/list': { tools: [SQL_TOOL] },
        'tools/call': jsonRows([{ id: '1' }, { id: '2' }])
      }
    },
    ({ url }) => runMcpQuery('/repo', { url }, 'select 1')
  );
  assert.deepEqual(rows, [{ id: '1' }, { id: '2' }]);
});

test('the session id the server issues is sent back on later requests', async () => {
  const { later } = await withMcpServer(
    {
      handlers: {
        initialize: INITIALIZE,
        'tools/list': { tools: [SQL_TOOL] },
        'tools/call': jsonRows([{ ok: 1 }])
      }
    },
    async ({ url, seen }) => {
      await runMcpQuery('/repo', { url }, 'select 1');
      return {
        later: seen.filter((entry) => entry.message.method === 'tools/call')
      };
    }
  );
  assert.equal(later[0].headers['mcp-session-id'], 'session-abc');
});

test('a bearer token comes from the environment, never the config file', async () => {
  process.env.DATADIFF_TEST_PAT = 'secret-token';
  try {
    const { authorized } = await withMcpServer(
      {
        handlers: {
          initialize: INITIALIZE,
          'tools/list': { tools: [SQL_TOOL] },
          'tools/call': jsonRows([{ ok: 1 }])
        }
      },
      async ({ url, seen }) => {
        await runMcpQuery(
          '/repo',
          { url, tokenEnvVar: 'DATADIFF_TEST_PAT' },
          'select 1'
        );
        return { authorized: seen[0].headers.authorization };
      }
    );
    assert.equal(authorized, 'Bearer secret-token');
  } finally {
    delete process.env.DATADIFF_TEST_PAT;
  }
});

test('a missing token is reported as the unset variable it is', () => {
  delete process.env.DATADIFF_ABSENT_PAT;
  assert.throws(
    () =>
      resolveMcpTarget('/repo', {
        url: 'https://example.invalid/mcp',
        tokenEnvVar: 'DATADIFF_ABSENT_PAT'
      }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('DATADIFF_ABSENT_PAT')
  );
});

test('an HTTP error names the status, and says when it is auth', async () => {
  await assert.rejects(
    withMcpServer(
      {
        handlers: {},
        onRequest(message, request, response) {
          response.writeHead(401).end('token expired');
        }
      },
      ({ url }) => runMcpQuery('/repo', { url }, 'select 1')
    ),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('401') &&
      error.message.includes('auth failure')
  );
});

test('a JSON-RPC error from the server is surfaced, not swallowed', async () => {
  await assert.rejects(
    withMcpServer(
      {
        handlers: {
          initialize: INITIALIZE,
          'tools/list': { tools: [SQL_TOOL] }
        },
        onRequest(message, request, response) {
          if (message.method !== 'tools/call') {
            return;
          }
          response.writeHead(200, { 'Content-Type': 'application/json' }).end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32000, message: 'syntax error at line 1' }
            })
          );
        }
      },
      ({ url }) => runMcpQuery('/repo', { url }, 'select nonsense')
    ),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('syntax error at line 1')
  );
});

test('a paginated tools/list is followed to the end', async () => {
  const rows = await withMcpServer(
    {
      handlers: {
        initialize: INITIALIZE,
        'tools/list': (message) =>
          message.params?.cursor === 'page-2'
            ? { tools: [SQL_TOOL] }
            : { tools: [{ name: 'unrelated' }], nextCursor: 'page-2' },
        'tools/call': jsonRows([{ ok: 1 }])
      }
    },
    ({ url }) => runMcpQuery('/repo', { url }, 'select 1')
  );
  assert.deepEqual(rows, [{ ok: 1 }]);
});

test('doctor reports the server, its tools, and which one queries would use', async () => {
  const found = await withMcpServer(
    {
      handlers: {
        initialize: INITIALIZE,
        'tools/list': { tools: [{ name: 'search_docs' }, SQL_TOOL] }
      }
    },
    ({ url }) => describeMcp('/repo', { url })
  );
  assert.equal(found.server, 'fake-warehouse');
  assert.deepEqual(found.tools, ['search_docs', 'run_sql']);
  assert.equal(found.tool, 'run_sql');
});

test('a plain SQL runner wins over a natural-language one', () => {
  const tool = resolveSqlTool(
    [{ name: 'cortex_analyst_query' }, { name: 'run_sql' }],
    null
  );
  assert.equal(tool.name, 'run_sql');
});

test('a single sql-ish tool is used even under an unfamiliar name', () => {
  const tool = resolveSqlTool(
    [{ name: 'search_docs' }, { name: 'warehouse_sql_passthrough' }],
    null
  );
  assert.equal(tool.name, 'warehouse_sql_passthrough');
});

test('an unrecognisable set of tools lists them instead of guessing', () => {
  assert.throws(
    () =>
      resolveSqlTool([{ name: 'search_docs' }, { name: 'summarize' }], null),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('search_docs') &&
      error.message.includes('sql.mcp.tool')
  );
});

test('a named tool that the server does not have fails with what it does have', () => {
  assert.throws(
    () => resolveSqlTool([{ name: 'run_sql' }], 'execute_everything'),
    (error) =>
      error instanceof DataDiffError && error.message.includes('run_sql')
  );
});

test('the statement argument falls back to the only string the tool takes', () => {
  assert.equal(
    sqlArgumentName({
      name: 'odd',
      inputSchema: {
        properties: { body: { type: 'string' }, dryRun: { type: 'boolean' } }
      }
    }),
    'body'
  );
});

test('an ambiguous argument list is reported rather than guessed', () => {
  assert.throws(
    () =>
      sqlArgumentName({
        name: 'odd',
        inputSchema: {
          properties: { left: { type: 'string' }, right: { type: 'string' } }
        }
      }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('sql.mcp.argument')
  );
});

test('rows are read from structuredContent when the server provides it', () => {
  assert.deepEqual(
    rowsFromToolResult({ structuredContent: { rows: [{ a: 1 }] } }),
    [{ a: 1 }]
  );
});

test('rows are read from CSV text when the server answers that way', () => {
  assert.deepEqual(
    rowsFromToolResult({
      content: [{ type: 'text', text: 'REGION,HEADCOUNT\nUS,10\nEU,20\n' }]
    }),
    [
      { REGION: 'US', HEADCOUNT: '10' },
      { REGION: 'EU', HEADCOUNT: '20' }
    ]
  );
});

test('an empty tool result is refused rather than read as zero rows', () => {
  assert.throws(
    () => rowsFromToolResult({ content: [{ type: 'text', text: '  ' }] }),
    (error) =>
      error instanceof DataDiffError && error.message.includes('empty result')
  );
});

test('an unreadable tool result shows what came back', () => {
  assert.throws(
    () =>
      rowsFromToolResult({
        content: [{ type: 'text', text: 'Query OK, 3 rows affected' }]
      }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('Query OK, 3 rows affected')
  );
});

test('a tool that reports its own error does not become rows', () => {
  assert.throws(
    () =>
      rowsFromToolResult({
        isError: true,
        content: [{ type: 'text', text: 'permission denied on TABLE X' }]
      }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('permission denied')
  );
});

/** A workspace mcp.json, the file an IDE already keeps. */
function mcpConfigRepo(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'datadiff-mcp-'));
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify(contents));
  return dir;
}

test('an existing mcp.json entry supplies the url and headers', () => {
  process.env.DATADIFF_TEST_PAT = 'from-env';
  try {
    const root = mcpConfigRepo({
      mcpServers: {
        snowflake: {
          url: 'https://acct.example.com/api/v2/mcp-servers/main',
          headers: { Authorization: 'Bearer ${DATADIFF_TEST_PAT}' }
        }
      }
    });
    const target = resolveMcpTarget(root, {
      configPath: 'mcp.json',
      server: 'snowflake'
    });
    assert.equal(
      target.url,
      'https://acct.example.com/api/v2/mcp-servers/main'
    );
    assert.equal(target.headers.Authorization, 'Bearer from-env');
  } finally {
    delete process.env.DATADIFF_TEST_PAT;
  }
});

test('a header referring to an unset variable fails before any request', () => {
  delete process.env.DATADIFF_ABSENT_PAT;
  const root = mcpConfigRepo({
    mcpServers: {
      snowflake: {
        url: 'https://acct.example.com/mcp',
        headers: { Authorization: 'Bearer ${DATADIFF_ABSENT_PAT}' }
      }
    }
  });
  assert.throws(
    () =>
      readMcpServerConfig(root, {
        configPath: 'mcp.json',
        server: 'snowflake'
      }),
    (error) =>
      error instanceof DataDiffError &&
      error.message.includes('DATADIFF_ABSENT_PAT')
  );
});

test('naming a server the file does not define lists the ones it does', () => {
  const root = mcpConfigRepo({
    mcpServers: { snowflake: { url: 'https://acct.example.com/mcp' } }
  });
  assert.throws(
    () =>
      readMcpServerConfig(root, { configPath: 'mcp.json', server: 'postgres' }),
    (error) =>
      error instanceof DataDiffError && error.message.includes('snowflake')
  );
});

test('a stdio server is refused, because it cannot be reached over HTTP', () => {
  const root = mcpConfigRepo({
    mcpServers: { local: { command: 'npx', args: ['some-server'] } }
  });
  assert.throws(
    () =>
      readMcpServerConfig(root, { configPath: 'mcp.json', server: 'local' }),
    (error) => error instanceof DataDiffError && error.message.includes('stdio')
  );
});

test('an mcp block with neither a url nor a config to borrow is refused', () => {
  assert.throws(
    () => resolveMcpTarget('/repo', {}),
    (error) => error instanceof DataDiffError && error.message.includes('url')
  );
});
