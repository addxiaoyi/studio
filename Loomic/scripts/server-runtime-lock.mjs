import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const yaml = require('js-yaml');
const DEPENDENCY_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function workspaceTarget(importer, reference) {
  const target = posix.normalize(posix.join(importer, reference.slice('link:'.length)));
  if (target === '.' || target.startsWith('../') || posix.isAbsolute(target) || target.includes('\\')) {
    throw new Error(`Workspace dependency points outside the runtime: ${reference}`);
  }
  return target;
}

function snapshotKey(snapshots, name, reference) {
  if (typeof reference !== 'string') throw new Error(`Invalid locked reference: ${name}`);
  for (const key of [`${name}@${reference}`, reference]) {
    if (Object.hasOwn(snapshots, key)) return key;
  }
  throw new Error(`Missing locked dependency: ${name}@${reference}`);
}

/** Keep exact resolutions, peers and optional platform binaries; never resolve newer versions. */
export function pruneRuntimeLock(lock) {
  if (lock.lockfileVersion !== '9.0') throw new Error('Unsupported pnpm lockfile version');
  const importers = record(lock.importers, 'lock importers');
  const snapshots = record(lock.snapshots ?? {}, 'lock snapshots');
  const packages = record(lock.packages ?? {}, 'lock packages');
  if (Object.keys(lock.patchedDependencies ?? {}).length) {
    throw new Error('Runtime packaging must include patch files before using patched dependencies');
  }
  const keptImporters = { '.': {} };
  const workspaceQueue = ['apps/server'];
  const packageQueue = [];
  for (let cursor = 0; cursor < workspaceQueue.length; cursor++) {
    const name = workspaceQueue[cursor];
    if (Object.hasOwn(keptImporters, name)) continue;
    const importer = importers[name];
    if (!importer) throw new Error(`Missing workspace importer: ${name}`);
    keptImporters[name] = importer;
    for (const group of DEPENDENCY_GROUPS) {
      for (const [alias, dependency] of Object.entries(importer[group] ?? {})) {
        const reference = dependency.version;
        if (typeof reference !== 'string') throw new Error(`Invalid workspace resolution: ${name}/${alias}`);
        if (reference.startsWith('link:')) workspaceQueue.push(workspaceTarget(name, reference));
        else packageQueue.push(snapshotKey(snapshots, alias, reference));
      }
    }
  }
  const keptSnapshots = {};
  const keptPackages = {};
  for (let cursor = 0; cursor < packageQueue.length; cursor++) {
    const key = packageQueue[cursor];
    if (Object.hasOwn(keptSnapshots, key)) continue;
    const snapshot = snapshots[key];
    keptSnapshots[key] = snapshot;
    const metadataKey = Object.hasOwn(packages, key) ? key : key.split('(')[0];
    if (!Object.hasOwn(packages, metadataKey)) throw new Error(`Missing package metadata: ${key}`);
    keptPackages[metadataKey] = packages[metadataKey];
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [name, reference] of Object.entries(snapshot[group] ?? {})) {
        packageQueue.push(snapshotKey(snapshots, name, reference));
      }
    }
  }
  const sorted = entries => Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, 'en')));
  return { ...lock, importers: sorted(keptImporters), packages: sorted(keptPackages), snapshots: sorted(keptSnapshots) };
}

function readSource(root, name) {
  const path = resolve(root, name);
  const inside = relative(root, path);
  if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)) throw new Error(`Input escapes checkout: ${name}`);
  let current = root;
  for (const part of inside.split(sep)) {
    current = resolve(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Symbolic link in runtime input: ${name}`);
  }
  return readFileSync(path, 'utf8');
}

function verifyManifest(manifest, importer, name) {
  for (const group of DEPENDENCY_GROUPS) {
    const declared = manifest[group] ?? {};
    const locked = importer[group] ?? {};
    if (Object.keys(declared).length !== Object.keys(locked).length ||
        Object.entries(declared).some(([alias, specifier]) => locked[alias]?.specifier !== specifier)) {
      throw new Error(`Manifest differs from frozen lockfile: ${name}/${group}`);
    }
  }
}

export function createRuntimeManifests(directory) {
  const root = realpathSync(directory);
  const lock = pruneRuntimeLock(yaml.load(readSource(root, 'pnpm-lock.yaml')));
  const workspace = record(yaml.load(readSource(root, 'pnpm-workspace.yaml')), 'workspace manifest');
  const rootManifest = record(JSON.parse(readSource(root, 'package.json')), 'root manifest');
  const selected = Object.keys(lock.importers).filter(name => name !== '.');
  const files = {};
  for (const name of selected) {
    const source = readSource(root, name + '/package.json');
    verifyManifest(JSON.parse(source), lock.importers[name], name);
    files[name + '/package.json'] = source;
  }
  // Root tooling is not part of the API process. Installation policies still apply.
  const manifest = { ...rootManifest, workspaces: selected };
  for (const key of [...DEPENDENCY_GROUPS, 'scripts']) delete manifest[key];
  files['package.json'] = JSON.stringify(manifest, null, 2) + '\n';
  files['pnpm-workspace.yaml'] = yaml.dump({ ...workspace, packages: selected }, { lineWidth: -1, noRefs: true });
  files['pnpm-lock.yaml'] = yaml.dump(lock, { lineWidth: -1, noRefs: true });
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2];
  if (!source) throw new Error('Usage: node server-runtime-lock.mjs SOURCE_ROOT');
  process.stdout.write(JSON.stringify(createRuntimeManifests(source)));
}
