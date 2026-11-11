import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRuntimeManifests, pruneRuntimeLock } from './server-runtime-lock.mjs';

function fixture() {
  const snapshots = {
    'engine@1.0.0(peer@2.0.0)': { dependencies: { peer: '2.0.0', alias: 'actual@3.0.0' }, optionalDependencies: { native: '1.0.0' } },
    'peer@2.0.0': {}, 'actual@3.0.0': {},
    'native@1.0.0': { optionalDependencies: { 'native-linux': '1.0.0' } },
    'native-linux@1.0.0': {}, 'shared-lib@1.0.0': {}, 'desktop-only@1.0.0': {},
  };
  return {
    lockfileVersion: '9.0', settings: { autoInstallPeers: true },
    importers: {
      '.': { devDependencies: { 'desktop-only': { specifier: '1.0.0', version: '1.0.0' } } },
      'apps/server': { dependencies: {
        engine: { specifier: '^1', version: '1.0.0(peer@2.0.0)' },
        shared: { specifier: 'workspace:*', version: 'link:../../packages/shared' },
      } },
      'packages/shared': { dependencies: { 'shared-lib': { specifier: '1.0.0', version: '1.0.0' } } },
      'apps/desktop': { dependencies: { 'desktop-only': { specifier: '1.0.0', version: '1.0.0' } } },
    },
    snapshots,
    packages: Object.fromEntries(Object.keys(snapshots).map(key => [key.split('(')[0], {
      resolution: { integrity: 'sha512-' + key }, os: key === 'native-linux@1.0.0' ? ['linux'] : undefined,
    }])),
  };
}

test('retains exact peer, alias and all-platform optional resolutions without desktop dependencies', () => {
  const lock = fixture();
  const before = structuredClone(lock);
  const pruned = pruneRuntimeLock(lock);
  assert.deepEqual(Object.keys(pruned.importers).sort(), ['.', 'apps/server', 'packages/shared']);
  assert.deepEqual(pruned.importers['.'], {});
  assert.equal(pruned.snapshots['desktop-only@1.0.0'], undefined);
  assert.equal(pruned.packages['desktop-only@1.0.0'], undefined);
  for (const key of ['engine@1.0.0(peer@2.0.0)', 'peer@2.0.0', 'actual@3.0.0', 'native@1.0.0', 'native-linux@1.0.0', 'shared-lib@1.0.0']) {
    assert.deepEqual(pruned.snapshots[key], lock.snapshots[key]);
    assert.deepEqual(pruned.packages[key.split('(')[0]], lock.packages[key.split('(')[0]]);
  }
  assert.deepEqual(lock, before);
});

test('refuses incomplete transitive resolutions instead of silently dropping packages', () => {
  const lock = fixture();
  delete lock.snapshots['native-linux@1.0.0'];
  assert.throws(() => pruneRuntimeLock(lock), /Missing locked dependency: native-linux/);
});

test('refuses missing package integrity metadata', () => {
  const lock = fixture();
  delete lock.packages['actual@3.0.0'];
  assert.throws(() => pruneRuntimeLock(lock), /Missing package metadata/);
});

test('refuses workspace paths outside the checkout and unknown lock formats', () => {
  const lock = fixture();
  lock.importers['apps/server'].dependencies.shared.version = 'link:../../../outside';
  assert.throws(() => pruneRuntimeLock(lock), /outside|Missing workspace/);
  assert.throws(() => pruneRuntimeLock({ ...fixture(), lockfileVersion: '8.0' }), /lockfile version/);
});

test('builds the actual server manifest closure and preserves installation policy', () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const files = createRuntimeManifests(root);
  const paths = Object.keys(files);
  assert(paths.includes('apps/server/package.json'));
  assert(paths.includes('packages/shared/package.json'));
  assert(paths.includes('packages/config/package.json'));
  assert(!paths.some(path => path.startsWith('apps/desktop/') || path.startsWith('apps/web/')));
  assert(!files['pnpm-lock.yaml'].includes('@nut-tree'));
  assert(files['pnpm-lock.yaml'].includes('@esbuild/linux-x64'));
  assert(files['pnpm-workspace.yaml'].includes('allowBuilds:'));
  assert(files['pnpm-workspace.yaml'].includes('overrides:'));
  assert.equal(files['apps/server/package.json'], readFileSync(resolve(root, 'apps/server/package.json'), 'utf8'));
  assert.equal(JSON.parse(files['package.json']).devDependencies, undefined);
});
