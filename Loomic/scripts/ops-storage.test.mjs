import assert from 'node:assert/strict';
import test from 'node:test';
import { storageSettings, expiredBackupVersions, pruneBackupVersions, checkStorageCapacity } from './ops-storage.mjs';

test('uses explicit S3 backup credentials without falling back to the public-media account', () => {
  const settings = storageSettings({ storageEndpoint: 'https://s3.us-east-005.backblazeb2.com', storageRegion: 'us-east-005', storageBucket: 'private-backups' }, {
    BACKUP_S3_ACCESS_KEY_ID: 'backup-key-id', BACKUP_S3_SECRET_ACCESS_KEY: 'backup-secret',
    QINIU_ACCESS_KEY: 'public-key', QINIU_SECRET_KEY: 'public-secret', QINIU_PUBLIC_BUCKET: 'public-media',
  });
  assert.equal(settings.bucket, 'private-backups');
  assert.equal(settings.credentials.accessKeyId, 'backup-key-id');
  assert.throws(() => storageSettings({ storageEndpoint: 'https://s3.us-east-005.backblazeb2.com', storageRegion: 'us-east-005', storageBucket: 'private-backups' }, { QINIU_ACCESS_KEY: 'public-key', QINIU_SECRET_KEY: 'public-secret' }), /credentials/i);
});

test('rejects credentialed URLs, insecure endpoints and missing bucket configuration', () => {
  const env = { BACKUP_S3_ACCESS_KEY_ID: 'key', BACKUP_S3_SECRET_ACCESS_KEY: 'secret' };
  for (const endpoint of ['http://s3.example.com', 'https://user:password@s3.example.com', 'https://s3.example.com/path']) {
    assert.throws(() => storageSettings({ storageEndpoint: endpoint, storageRegion: 'test', storageBucket: 'private-backups' }, env));
  }
});

test('retains the newest backup names and removes complete old versions, without touching other files', () => {
  const prefix = 'helstera-backups/v1/';
  const versions = [
    { Key: prefix + '20261123T030000Z.tar.enc', VersionId: 'new' },
    { Key: prefix + '20261122T030000Z.tar.enc', VersionId: 'retained' },
    { Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-version' },
    { Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-duplicate' },
    { Key: 'other/20261120T030000Z.tar.enc', VersionId: 'unrelated' },
    { Key: prefix + 'notes.txt', VersionId: 'notes' },
  ];
  const markers = [{ Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-marker' }];
  assert.deepEqual(expiredBackupVersions(versions, markers, prefix, 2), [
    { Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-version' },
    { Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-duplicate' },
    { Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old-marker' },
  ]);
  assert.throws(() => expiredBackupVersions(versions, markers, '', 2));
  assert.throws(() => expiredBackupVersions(versions, markers, prefix, 0));
});

test('walks version pages before deleting any expired backup versions', async () => {
  class ListObjectVersionsCommand { constructor(input) { this.input = input; } }
  class DeleteObjectCommand { constructor(input) { this.input = input; } }
  const prefix = 'helstera-backups/v1/';
  const calls = [];
  const client = { async send(command) {
    calls.push(command);
    if (command instanceof DeleteObjectCommand) return {};
    if (!command.input.KeyMarker) return { Versions: [{ Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old' }], IsTruncated: true, NextKeyMarker: 'next', NextVersionIdMarker: 'cursor' };
    return { Versions: [{ Key: prefix + '20261123T030000Z.tar.enc', VersionId: 'new' }] };
  } };
  assert.deepEqual(await pruneBackupVersions(client, { ListObjectVersionsCommand, DeleteObjectCommand }, 'backups', prefix, 1), { removedVersions: 1, retainedNames: 1 });
  assert.equal(calls[1].input.KeyMarker, 'next');
  assert.deepEqual(calls[2].input, { Bucket: 'backups', Key: prefix + '20261121T030000Z.tar.enc', VersionId: 'old' });
});

test('blocks uploads above the free allowance including noncurrent versions', async () => {
  class ListObjectVersionsCommand { constructor(input) { this.input = input; } }
  const client = { async send() { return { Versions: [{ Size: 4_000_000_000 }, { Size: 4_000_000_000, IsLatest: false }] }; } };
  await assert.rejects(checkStorageCapacity(client, { ListObjectVersionsCommand }, 'backups', 2_300_000_000, 10_000_000_000), /free-storage limit/);
  assert.equal((await checkStorageCapacity(client, { ListObjectVersionsCommand }, 'backups', 1_000_000_000, 10_000_000_000)).usedBytes, 8_000_000_000);
});

test('includes unfinished multipart bytes in the free-storage limit', async () => {
  class ListObjectVersionsCommand { constructor(input) { this.input = input; } }
  class ListMultipartUploadsCommand { constructor(input) { this.input = input; } }
  class ListPartsCommand { constructor(input) { this.input = input; } }
  const sdk = { ListObjectVersionsCommand, ListMultipartUploadsCommand, ListPartsCommand };
  const client = { async send(command) {
    if (command instanceof ListObjectVersionsCommand) return { Versions: [{ Size: 7_000_000_000 }] };
    if (command instanceof ListMultipartUploadsCommand) return { Uploads: [{ Key: 'unfinished.enc', UploadId: 'upload' }] };
    return { Parts: [{ Size: 1_000_000_000 }] };
  } };
  await assert.rejects(checkStorageCapacity(client, sdk, 'backups', 2_300_000_000, 10_000_000_000), /free-storage limit/);
});
