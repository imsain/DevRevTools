#!/usr/bin/env node
// Copies shared/ into every plugin.
//
// Cursor installs a plugin directory on its own — the cache holds
// `<plugin>/<sha>/` with no siblings — so nothing can be imported across
// plugins at runtime and there is no node_modules to resolve a package from.
// A shared module therefore has to physically exist inside each plugin. This
// makes those copies generated rather than hand-maintained, so the only
// editable version is the one under shared/.
//
//   node scripts/sync-shared.mjs           write the copies
//   node scripts/sync-shared.mjs --check   fail if any copy is out of date

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHARED = join(ROOT, 'shared');
const PLUGINS = join(ROOT, 'plugins');

// shared/<from> lands at plugins/<plugin>/<to>.
const TREES = [
  { from: 'lib', to: join('lib', 'shared') },
  { from: 'test', to: join('test', 'shared') }
];

// Repo-root files every plugin needs a verbatim copy of, because a plugin is
// installed as a directory on its own and Apache-2.0 asks for the licence to
// travel with what it covers.
const VERBATIM = ['LICENSE'];

function header(source) {
  return [
    `// Generated from ${source} — do not edit this copy.`,
    '// Change the shared file, then run: node scripts/sync-shared.mjs',
    '',
    ''
  ].join('\n');
}

function plugins() {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function copies() {
  const out = [];
  for (const tree of TREES) {
    const sourceDir = join(SHARED, tree.from);
    for (const file of readdirSync(sourceDir).filter((name) =>
      name.endsWith('.mjs')
    )) {
      const source = join(sourceDir, file);
      const relativeSource = relative(ROOT, source);
      const body = `${header(relativeSource)}${readFileSync(source, 'utf8')}`;
      for (const plugin of plugins()) {
        out.push({
          source: relativeSource,
          target: join(PLUGINS, plugin, tree.to, file),
          body
        });
      }
    }
  }
  for (const file of VERBATIM) {
    const body = readFileSync(join(ROOT, file), 'utf8');
    for (const plugin of plugins()) {
      out.push({ source: file, target: join(PLUGINS, plugin, file), body });
    }
  }
  return out;
}

const check = process.argv.includes('--check');
const stale = [];

for (const copy of copies()) {
  let current = null;
  try {
    current = readFileSync(copy.target, 'utf8');
  } catch {
    // Missing counts as stale, and as something to write.
  }
  if (current === copy.body) {
    continue;
  }
  stale.push(relative(ROOT, copy.target));
  if (!check) {
    mkdirSync(dirname(copy.target), { recursive: true });
    writeFileSync(copy.target, copy.body);
  }
}

if (check && stale.length > 0) {
  console.error(
    [
      'These vendored copies are out of date:',
      ...stale.map((file) => `  ${file}`),
      '',
      'Run: node scripts/sync-shared.mjs'
    ].join('\n')
  );
  process.exit(1);
}

console.log(
  check
    ? 'shared/ is in sync with every plugin'
    : stale.length === 0
      ? 'shared/ was already in sync'
      : `updated ${stale.length} file${stale.length === 1 ? '' : 's'}`
);
