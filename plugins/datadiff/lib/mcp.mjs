// Speaking MCP to a remote SQL tool over HTTP, without a client library.
//
// This exists because a Snowflake-managed MCP server is an HTTPS endpoint
// authenticated with a token — not a process an agent owns. That is what makes
// it reachable from a CLI at all: the request the IDE makes can be made from
// here, so datadiff can use the warehouse connection a team already set up
// rather than insisting on a second one of its own.
//
// The transport is Streamable HTTP: JSON-RPC over POST, where the server
// chooses whether to answer with a JSON body or an SSE stream carrying the
// same response. Both are handled, because that choice is not the client's.
//
// On the same principle as shelling out to git and Chrome rather than adding
// npm packages: this is a few hundred lines of fetch and JSON-RPC, against a
// spec that is stable, and it keeps the plugin dependency-free.

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DataDiffError, ROOT } from './project.mjs';
import { parseCsv } from './csv.mjs';

/** Reported to the server in the handshake. Read from the manifest rather than
 * written here, so it cannot go stale against the version actually installed. */
function clientVersion() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** The protocol version this client speaks. A server that wants a different
 * one says so in its initialize result, and that answer is what gets sent on
 * subsequent requests. */
const PROTOCOL_VERSION = '2025-06-18';

const REQUEST_TIMEOUT_MS = 120000;

/**
 * Tool names worth trying when the config does not name one. Ordered most to
 * least specific, since a server that exposes both a plain SQL runner and a
 * natural-language one should get the plain runner: datadiff already has the
 * SQL in hand and does not want it reinterpreted.
 */
const SQL_TOOL_NAMES = [
  'run_sql',
  'run_query',
  'execute_sql',
  'execute_query',
  'sql_exec',
  'query',
  'sql'
];

/** Argument names a SQL tool is likely to use for the statement itself. */
const SQL_ARGUMENT_NAMES = ['statement', 'sql', 'query', 'sql_statement', 'q'];

/** `${VAR}` and `$VAR` from the environment, the way an mcp.json expects.
 * Throws rather than sending the literal `${VAR}` as a bearer token, which
 * would fail as a confusing 401 rather than as the missing variable it is. */
function expandEnv(value, where) {
  return value.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    const found = process.env[name];
    if (found === undefined || found === '') {
      throw new DataDiffError(
        `${where} refers to $${name}, which is not set in the environment.`
      );
    }
    return found;
  });
}

/**
 * The endpoint and headers for a server, from an existing mcp.json rather than
 * from a second copy in .datadiff.json. Borrowing the IDE's own entry means the
 * URL and token live in one place, and rotating the token does not leave
 * datadiff pointing at a stale one.
 */
export function readMcpServerConfig(root, { configPath, server }) {
  const path = isAbsolute(configPath) ? configPath : resolve(root, configPath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new DataDiffError(
      `could not read the MCP config at ${path}: ${error.message}`
    );
  }
  const servers = parsed.mcpServers ?? parsed.servers ?? {};
  const entry = servers[server];
  if (!entry) {
    const names = Object.keys(servers);
    throw new DataDiffError(
      `${path} has no MCP server named "${server}".` +
        (names.length > 0
          ? ` It defines: ${names.join(', ')}.`
          : ' It defines no servers.')
    );
  }
  const url = entry.url ?? entry.httpUrl ?? entry.serverUrl;
  if (!url) {
    throw new DataDiffError(
      `the MCP server "${server}" in ${path} has no url, so it is a local ` +
        'stdio server. datadiff can only reach an HTTP one; name a remote ' +
        'server, or use sql.mcp.url directly.'
    );
  }
  const headers = {};
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    headers[name] = expandEnv(String(value), `${path} header "${name}"`);
  }
  return { url: expandEnv(String(url), `${path} url`), headers };
}

/** Where to send requests, and with what, from whichever way it was configured. */
export function resolveMcpTarget(root, mcp = {}) {
  const borrowed =
    mcp.configPath && mcp.server
      ? readMcpServerConfig(root, {
          configPath: mcp.configPath,
          server: mcp.server
        })
      : { url: null, headers: {} };

  const url = mcp.url ?? borrowed.url;
  if (!url) {
    throw new DataDiffError(
      'sql.mcp needs either a url, or configPath and server naming an entry ' +
        'in an existing mcp.json.'
    );
  }

  const headers = { ...borrowed.headers, ...(mcp.headers ?? {}) };
  if (mcp.tokenEnvVar) {
    const token = process.env[mcp.tokenEnvVar];
    if (!token) {
      throw new DataDiffError(
        `sql.mcp.tokenEnvVar names $${mcp.tokenEnvVar}, which is not set in ` +
          'the environment.'
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  return { url, headers, tool: mcp.tool ?? null };
}

/**
 * One JSON-RPC response, from a body that is either JSON or an SSE stream.
 *
 * An SSE answer to a single request still carries exactly one response for
 * that id, so the stream is read to its end and the matching message returned,
 * rather than pretending to be a long-lived subscription this client does not
 * need.
 */
async function readRpcBody(response, id) {
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  if (!contentType.includes('text/event-stream')) {
    if (text.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new DataDiffError(
        `the MCP server answered with ${contentType || 'no content type'} ` +
          `that is not JSON: ${preview(text)}`
      );
    }
  }

  let fallback = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') {
      continue;
    }
    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      continue;
    }
    if (message.id === id) {
      return message;
    }
    fallback ??= message;
  }
  return fallback;
}

/** Enough of a value to recognise, without pasting a whole result set into an
 * error message. */
function preview(value, limit = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) {
    return String(value);
  }
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

/**
 * A single MCP conversation: initialize, then whatever calls are wanted, over
 * one session. Sessions matter because a server that issues an Mcp-Session-Id
 * rejects later requests that do not carry it.
 */
class McpSession {
  constructor({ url, headers, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.url = url;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.sessionId = null;
    this.protocolVersion = PROTOCOL_VERSION;
    this.nextId = 1;
  }

  async send(method, params, { notification = false } = {}) {
    const id = notification ? undefined : this.nextId++;
    const body = notification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id, method, params };

    let response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': this.protocolVersion,
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
          ...this.headers
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new DataDiffError(
        `could not reach the MCP server at ${this.url}: ${error.message}`
      );
    }

    if (!response.ok) {
      const detail = preview(await response.text().catch(() => ''));
      throw new DataDiffError(
        `the MCP server answered ${response.status} to ${method}` +
          (detail ? `: ${detail}` : '') +
          (response.status === 401 || response.status === 403
            ? '\n  That is an auth failure, so check the token rather than the query.'
            : '')
      );
    }

    const issued = response.headers.get('mcp-session-id');
    if (issued) {
      this.sessionId = issued;
    }

    if (notification) {
      return null;
    }

    const message = await readRpcBody(response, id);
    if (!message) {
      throw new DataDiffError(
        `the MCP server gave no JSON-RPC response to ${method}.`
      );
    }
    if (message.error) {
      throw new DataDiffError(
        `the MCP server refused ${method}: ${message.error.message ?? preview(message.error)}`
      );
    }
    return message.result;
  }

  async open() {
    const result = await this.send('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'datadiff', version: clientVersion() }
    });
    if (result?.protocolVersion) {
      this.protocolVersion = result.protocolVersion;
    }
    // A server is entitled to ignore calls made before this, and some do.
    await this.send('notifications/initialized', {}, { notification: true });
    return result;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const result = await this.send('tools/list', cursor ? { cursor } : {});
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name, args) {
    return this.send('tools/call', { name, arguments: args });
  }
}

/**
 * Which of the server's tools runs a SQL statement.
 *
 * Guessing is confined to well-known names: a wrong guess here would send a
 * query to something that is not a query runner, so anything unrecognised is
 * reported with the list of what the server actually offers, for the reader to
 * pin down with sql.mcp.tool.
 */
export function resolveSqlTool(tools, preferred) {
  const names = tools.map((tool) => tool.name);
  if (preferred) {
    const found = tools.find((tool) => tool.name === preferred);
    if (!found) {
      throw new DataDiffError(
        `the MCP server has no tool named "${preferred}". It offers: ` +
          `${names.join(', ') || 'nothing'}.`
      );
    }
    return found;
  }
  for (const candidate of SQL_TOOL_NAMES) {
    const found = tools.find((tool) => tool.name.toLowerCase() === candidate);
    if (found) {
      return found;
    }
  }
  const loose = tools.filter((tool) => /sql|query/i.test(tool.name));
  if (loose.length === 1) {
    return loose[0];
  }
  throw new DataDiffError(
    'could not tell which MCP tool runs SQL, so nothing was run.\n' +
      `  The server offers: ${names.join(', ') || 'nothing'}.\n` +
      '  Name the right one as sql.mcp.tool in .datadiff.json.'
  );
}

/** The argument to pass the statement as, read off the tool's own schema so a
 * server that calls it `statement` and one that calls it `sql` both work. */
export function sqlArgumentName(tool) {
  const properties = tool.inputSchema?.properties ?? {};
  const available = Object.keys(properties);
  for (const candidate of SQL_ARGUMENT_NAMES) {
    const match = available.find((name) => name.toLowerCase() === candidate);
    if (match) {
      return match;
    }
  }
  const strings = available.filter(
    (name) => (properties[name]?.type ?? 'string') === 'string'
  );
  if (strings.length === 1) {
    return strings[0];
  }
  throw new DataDiffError(
    `could not tell which argument of "${tool.name}" takes the statement.\n` +
      `  It accepts: ${available.join(', ') || 'nothing'}.\n` +
      '  Set sql.mcp.argument in .datadiff.json to name it.'
  );
}

/** Anything that looks like a list of rows, out of a shape the server chose. */
function rowsFromValue(value) {
  if (Array.isArray(value)) {
    return value.every(
      (row) => row && typeof row === 'object' && !Array.isArray(row)
    )
      ? value
      : null;
  }
  if (value && typeof value === 'object') {
    for (const key of ['rows', 'data', 'records', 'resultSet', 'result']) {
      const found = rowsFromValue(value[key]);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Rows out of a tool result.
 *
 * The MCP spec says what a tool result looks like but not what a SQL tool puts
 * inside one, so JSON and CSV are both tried and an unrecognised shape is
 * reported with a sample rather than quietly becoming zero rows — a diff of
 * nothing against nothing is the one answer this tool must never give.
 */
export function rowsFromToolResult(result) {
  if (result?.isError) {
    throw new DataDiffError(
      `the MCP tool reported an error: ${preview(textOf(result))}`
    );
  }

  const structured = rowsFromValue(result?.structuredContent);
  if (structured) {
    return structured;
  }

  const text = textOf(result);
  if (text.trim() === '') {
    throw new DataDiffError(
      'the MCP tool returned an empty result, which says nothing about the ' +
        'query. Run the statement through the same server yourself to see ' +
        'what it answers.'
    );
  }

  try {
    const parsed = JSON.parse(text);
    const rows = rowsFromValue(parsed);
    if (rows) {
      return rows;
    }
  } catch {
    // Not JSON, so try the other thing a SQL tool commonly emits.
  }

  const csv = parseCsv(text);
  if (csv.length > 0) {
    return csv;
  }

  throw new DataDiffError(
    'could not read rows out of the MCP tool result. It was neither a JSON ' +
      'array of rows nor CSV with a header.\n' +
      `  It answered: ${preview(text)}`
  );
}

/** Every text block of a tool result, joined. */
function textOf(result) {
  return (result?.content ?? [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

/**
 * What `doctor` needs to say about an MCP server: where it is, that it answers,
 * and which of its tools the next query would go to.
 *
 * It really connects, because the failure this catches — a reachable server
 * with no recognisable SQL tool, or an expired token — is invisible in a config
 * file and would otherwise surface halfway through a comparison, after the
 * "after" rows had already been fetched.
 */
export async function describeMcp(root, mcp = {}) {
  const target = resolveMcpTarget(root, mcp);
  const session = new McpSession({
    url: target.url,
    headers: target.headers,
    timeoutMs: mcp.timeoutMs ?? REQUEST_TIMEOUT_MS
  });
  const server = await session.open();
  const tools = await session.listTools();
  return {
    url: target.url,
    server: server?.serverInfo?.name ?? null,
    tools: tools.map((tool) => tool.name),
    tool: resolveSqlTool(tools, target.tool).name
  };
}

/**
 * Runs one statement through a remote MCP server and returns its rows.
 *
 * A session per query, rather than one held open across the before/after pair:
 * the two halves are separated by a git swap and a recompile, and a connection
 * kept open across that is a connection that can quietly go stale.
 */
export async function runMcpQuery(root, mcp, sql) {
  const target = resolveMcpTarget(root, mcp);
  const session = new McpSession({
    url: target.url,
    headers: target.headers,
    timeoutMs: mcp.timeoutMs ?? REQUEST_TIMEOUT_MS
  });
  await session.open();
  const tool = resolveSqlTool(await session.listTools(), target.tool);
  const argument = mcp.argument ?? sqlArgumentName(tool);
  const result = await session.callTool(tool.name, {
    ...(mcp.arguments ?? {}),
    [argument]: sql
  });
  return rowsFromToolResult(result);
}
