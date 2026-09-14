// Reads the bits of a repo's tsconfig.json that decide what an import
// specifier means: `baseUrl` and `paths`. Node itself ignores both, so a
// function that says `import { x } from 'lib/utils'` is unimportable without
// them — which is most real TypeScript code.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** tsconfig.json is JSON with comments and trailing commas in practice, so
 * JSON.parse alone rejects most real ones. */
export function parseTsconfigJson(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (char === '\n') {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Nearest tsconfig.json walking up from `startDir`, not escaping `root`. */
export function findTsconfig(startDir, root) {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dir === root || dirname(dir) === dir) {
      return null;
    }
    dir = dirname(dir);
  }
}

/** `extends` chains are followed so a repo that keeps paths in a base config
 * still resolves; child options win over inherited ones. */
export function readCompilerOptions(tsconfigPath, seen = new Set()) {
  if (!tsconfigPath || seen.has(tsconfigPath) || !existsSync(tsconfigPath)) {
    return { options: {}, dir: tsconfigPath ? dirname(tsconfigPath) : null };
  }
  seen.add(tsconfigPath);

  let parsed;
  try {
    parsed = parseTsconfigJson(readFileSync(tsconfigPath, 'utf8'));
  } catch {
    return { options: {}, dir: dirname(tsconfigPath) };
  }

  const dir = dirname(tsconfigPath);
  const own = parsed.compilerOptions ?? {};
  if (!parsed.extends) {
    return { options: own, dir };
  }

  const extendsList = Array.isArray(parsed.extends) ? parsed.extends : [parsed.extends];
  let inherited = {};
  let inheritedDir = dir;
  for (const entry of extendsList) {
    const base = entry.startsWith('.')
      ? resolve(dir, entry.endsWith('.json') ? entry : `${entry}.json`)
      : null;
    if (!base) {
      continue;
    }
    const parent = readCompilerOptions(base, seen);
    inherited = { ...inherited, ...parent.options };
    // baseUrl/paths inherited from a parent config are relative to that
    // parent's directory, not this one.
    if (parent.options.baseUrl || parent.options.paths) {
      inheritedDir = parent.dir;
    }
  }

  const options = { ...inherited, ...own };
  const ownSetsResolution = own.baseUrl !== undefined || own.paths !== undefined;
  return { options, dir: ownSetsResolution ? dir : inheritedDir };
}

/**
 * Flattens tsconfig into what a resolver needs: an absolute `baseUrl` and
 * `paths` patterns split around their `*` with absolute targets.
 */
export function resolutionFor(fileDir, root) {
  const tsconfigPath = findTsconfig(fileDir, root);
  if (!tsconfigPath) {
    return { baseUrl: root, paths: [] };
  }
  const { options, dir } = readCompilerOptions(tsconfigPath);
  const baseUrl = options.baseUrl
    ? isAbsolute(options.baseUrl)
      ? options.baseUrl
      : resolve(dir, options.baseUrl)
    : dir;

  const paths = Object.entries(options.paths ?? {}).map(([pattern, targets]) => {
    const star = pattern.indexOf('*');
    return {
      prefix: star === -1 ? pattern : pattern.slice(0, star),
      suffix: star === -1 ? '' : pattern.slice(star + 1),
      wildcard: star !== -1,
      targets: (targets ?? []).map((target) => ({
        prefix: target.slice(0, target.indexOf('*') === -1 ? undefined : target.indexOf('*')),
        suffix: target.indexOf('*') === -1 ? '' : target.slice(target.indexOf('*') + 1),
        base: baseUrl
      }))
    };
  });

  return { baseUrl, paths, tsconfigPath };
}
