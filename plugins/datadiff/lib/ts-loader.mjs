// Node module hooks that make a repo's own TypeScript importable as-is:
// tsconfig `baseUrl`/`paths` aliases, extension-less imports, and TS syntax
// Node won't strip on its own (enums, decorators, parameter properties).
//
// Everything stays ESM on purpose. Routing TypeScript through a CommonJS
// transform is what makes `require(esm)` cycle errors appear in NestJS-shaped
// code, where the module graph is full of cycles that TypeScript itself
// tolerates.

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const config = JSON.parse(process.env.DATADIFF_TS_CONFIG ?? '{}');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js', '.jsx', '.json'];
const isTypeScript = (url) => /\.(ts|tsx|mts|cts)(\?|$)/.test(url);

/** The repo's own `typescript` if it has one. Strip-only mode (all Node
 * offers as of 26) rejects enums and decorators, which NestJS code is full
 * of, so the repo's compiler is the fallback that actually works. */
const typescript = (() => {
  if (!config.root) {
    return null;
  }
  try {
    return createRequire(join(config.root, 'noop.js'))('typescript');
  } catch {
    return null;
  }
})();

function fileFor(base) {
  if (existsSync(base) && statSync(base).isFile()) {
    return base;
  }
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) {
      return base + extension;
    }
  }
  // `./utils` meaning `./utils/index.ts` is normal in TypeScript and absent
  // from ESM resolution.
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const extension of EXTENSIONS) {
      const index = join(base, `index${extension}`);
      if (existsSync(index)) {
        return index;
      }
    }
  }
  return null;
}

function fromPaths(specifier) {
  for (const entry of config.paths ?? []) {
    if (!specifier.startsWith(entry.prefix) || !specifier.endsWith(entry.suffix)) {
      continue;
    }
    const middle = entry.wildcard
      ? specifier.slice(entry.prefix.length, specifier.length - entry.suffix.length)
      : '';
    for (const target of entry.targets) {
      const hit = fileFor(resolvePath(target.base, target.prefix + middle + target.suffix));
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith('node:') || specifier.startsWith('data:')) {
      throw error;
    }
    const relative = specifier.startsWith('.') || specifier.startsWith('/');
    const hit = relative
      ? fileFor(
          resolvePath(
            context.parentURL ? dirname(fileURLToPath(context.parentURL)) : config.root,
            specifier
          )
        )
      : fromPaths(specifier) ??
        (config.baseUrl ? fileFor(resolvePath(config.baseUrl, specifier)) : null);

    if (!hit) {
      throw error;
    }
    return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
}

export async function load(url, context, nextLoad) {
  if (!isTypeScript(url)) {
    return nextLoad(url, context);
  }
  if (!typescript) {
    // Node's own stripping: fine for plain annotations, throws a clear
    // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on anything more.
    return nextLoad(url, { ...context, format: 'module-typescript' });
  }
  const path = fileURLToPath(url);
  const { outputText } = typescript.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      jsx: typescript.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      verbatimModuleSyntax: false,
      isolatedModules: true
    }
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
