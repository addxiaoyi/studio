import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeManifests } from './server-runtime-lock.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'helstera-server-rehearsal-'));
const manifests = createRuntimeManifests(source);
for (const [relative, content] of Object.entries(manifests)) {
  const destination = join(stage, relative);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

const copied = [
  'apps/server/src',
  'apps/server/tsconfig.json',
  'packages/shared/dist',
  'tsconfig.base.json',
];
for (const relative of copied) {
  const destination = join(stage, relative);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(source, relative), destination, { recursive: true, errorOnExist: true, force: false });
}

const hashes = {};
async function hashFiles(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Rehearsal inputs must not be symlinks: ${relative}`);
    if (entry.isDirectory()) await hashFiles(join(directory, entry.name), relative + '/');
    else if (entry.isFile()) {
      hashes[relative] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
    }
  }
}
await hashFiles(stage);
await writeFile(join(stage, 'REHEARSAL-INPUTS.json'), JSON.stringify({ source, files: hashes }, null, 2) + '\n');
console.log(JSON.stringify({ stage, files: Object.keys(hashes).length }));
