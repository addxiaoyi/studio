import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('missing offsite credentials do not prevent database backup operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'helstera-ops-runtime-'));
  try {
    await writeFile(join(root, 'server.env'), 'DATABASE_URL=postgresql://user@localhost/test\n');
    const config = { envFile: join(root, 'server.env'), storageCredentialsFile: join(root, 'missing-b2.env'), server: root, pgBin: root };
    await writeFile(join(root, 'config.json'), JSON.stringify(config));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./ops-runtime.mjs', import.meta.url)), join(root, 'config.json'), 'dump', join(root, 'dump')], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /"action":"dump"/);
    assert.doesNotMatch(child.stderr, /missing-b2\.env/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
