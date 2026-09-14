// Throwaway probe behind the numbers in ../DESIGN.md. Not the plugin, not
// tested, not maintained: it exists so the table in that document can be
// re-run against a real checkout instead of taken on faith.
//
//   node reach-probe.mjs <next-app-root> <file-suffix>...
//   node reach-probe.mjs ~/src/web-client \
//     components/Button/Button.tsx lib/api-headers.ts
//
// A real implementation would resolve aliases through tsconfig rather than
// hardcoding `@/`, and would treat barrel files as pass-through. This does
// neither, which is why it only establishes the shape of the answer.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.argv[2];
const SRC = join(ROOT, 'src');
const EXT = ['.ts', '.tsx', '.js', '.jsx'];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (EXT.some((e) => entry.name.endsWith(e))) out.push(path);
  }
  return out;
}

const files = walk(SRC);
const IMPORT = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;

function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const suffix of ['', ...EXT, ...EXT.map((e) => `/index${e}`)]) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// importers[x] = every file that imports x, i.e. the graph walked backwards
const importers = new Map();
for (const file of files) {
  for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const target = resolveSpec(match[1], file);
    if (!target) continue;
    if (!importers.has(target)) importers.set(target, new Set());
    importers.get(target).add(file);
  }
}

const isEntry = (f) => /\/(page|layout)\.(tsx|jsx)$/.test(f);

const routeOf = (f) =>
  '/' +
  relative(join(SRC, 'app'), dirname(f))
    .split('/')
    .filter((s) => s && !(s.startsWith('(') && s.endsWith(')')))
    .join('/');

function reach(seed) {
  const seen = new Set([seed]);
  const queue = [seed];
  const routes = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (isEntry(current)) routes.add(routeOf(current));
    for (const importer of importers.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return { routes, walked: seen.size };
}

const total = files.filter(isEntry).length;
console.log(`indexed ${files.length} files, ${total} page/layout files\n`);

for (const arg of process.argv.slice(3)) {
  const seed = files.find((f) => f.endsWith(arg));
  if (!seed) {
    console.log(`${arg}: not found`);
    continue;
  }
  const { routes, walked } = reach(seed);
  const sorted = [...routes].sort();
  const detail =
    routes.size <= 8
      ? sorted.map((r) => `\n    ${r}`).join('')
      : `\n    e.g. ${sorted.slice(0, 4).join(', ')} ...`;
  console.log(
    `${arg}\n  reaches ${routes.size} of ${total} routes (walked ${walked} files)${detail}`
  );
}
