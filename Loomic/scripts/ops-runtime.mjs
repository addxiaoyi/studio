import { createRequire } from 'node:module';
import { readFile, open, stat, link, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { storageSettings, pruneBackupVersions, checkStorageCapacity } from './ops-storage.mjs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const [configPath, action, ...args] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const env = parseEnv(await readFile(config.envFile, 'utf8'));
const require = createRequire(join(config.server, 'package.json'));

async function databaseSummary() {
  const { Client } = require('pg');
  const db = new Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  await db.connect();
  try {
    const jobs = await db.query(`select count(*) filter(where status='queued')::int as queued,
      coalesce(extract(epoch from now()-min(created_at) filter(where status='queued')),0)::float as "oldestQueuedSeconds",
      coalesce(extract(epoch from now()-min(started_at) filter(where status='running')),0)::float as "oldestRunningSeconds"
      from background_jobs where status in ('queued','running')`);
    const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 15000 }));
    const workers = processes.filter(p => /^helstera.*worker/.test(p.name) && p.pm2_env.status === 'online');
    return { ...jobs.rows[0], workerOnline: workers.length > 0, workers: workers.map(p => p.name) };
  } finally { await db.end(); }
}

async function storage() {
  if (config.storageCredentialsFile) Object.assign(env, parseEnv(await readFile(config.storageCredentialsFile, 'utf8')));
  const sdk = require('@aws-sdk/client-s3');
  const settings = storageSettings(config, env);
  const client = new sdk.S3Client({ endpoint: settings.endpoint,
    region: settings.region, forcePathStyle: true,
    credentials: settings.credentials,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 3 });
  return { client, sdk, Bucket: settings.bucket };
}

async function uploadEncrypted(file, key) {
  if (!key.startsWith(config.storagePrefix) || !key.endsWith('.enc')) throw new Error('Invalid backup object key');
  const { client, sdk, Bucket } = await storage();
  const bytes = (await stat(file)).size;
  const sha256 = await fileHash(file);
  try {
    const existing = await client.send(new sdk.HeadObjectCommand({ Bucket, Key: key }));
    if (existing.ContentLength === bytes && existing.Metadata?.sha256 === sha256) {
      client.destroy();
      return { key, bytes, sha256, uploadedAt: existing.LastModified?.toISOString(), reused: true };
    }
    throw new Error('Backup object name already exists with different content');
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound') {
      client.destroy();
      throw error;
    }
  }
  if (config.storageMaxBytes) await checkStorageCapacity(client, sdk, Bucket, bytes, config.storageMaxBytes, config.storagePrefix);
  const { UploadId } = await client.send(new sdk.CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: 'application/octet-stream', Metadata: { sha256 } }));
  const handle = await open(file, 'r');
  const parts = [];
  try {
    const buffer = Buffer.alloc(16 * 1024 * 1024);
    let position = 0;
    for (let part = 1; ; part++) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const { ETag } = await client.send(new sdk.UploadPartCommand({ Bucket, Key: key, UploadId, PartNumber: part, Body: buffer.subarray(0, bytesRead), ContentLength: bytesRead }));
      parts.push({ ETag, PartNumber: part });
      position += bytesRead;
    }
    await client.send(new sdk.CompleteMultipartUploadCommand({ Bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
    const head = await client.send(new sdk.HeadObjectCommand({ Bucket, Key: key }));
    if (head.ContentLength !== bytes || head.Metadata?.sha256 !== sha256) throw new Error('Backup size or checksum metadata mismatch');
    return { key, bytes, sha256, uploadedAt: new Date().toISOString() };
  } catch (error) {
    try { await client.send(new sdk.AbortMultipartUploadCommand({ Bucket, Key: key, UploadId })); }
    catch { console.error(JSON.stringify({ action: 'upload-abort', error: 'cleanup_failed' })); }
    throw error;
  } finally { await handle.close(); client.destroy(); }
}

async function execute() {
  if (action === 'database') return databaseSummary();
  if (action === 'dump') {
    const url = new URL(env.DATABASE_URL);
    const pgEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
    execFileSync(join(config.pgBin, 'pg_dump'), ['--format=custom', '--compress=1', '--file=' + args[0]], { env: pgEnv, timeout: 1200000, stdio: 'pipe' });
    execFileSync(join(config.pgBin, 'pg_restore'), ['--list', args[0]], { timeout: 30000, stdio: 'pipe' });
    return { dumped: true };
  }
  if (action === 'upload') return uploadEncrypted(args[0], args[1]);
  if (action === 'download') {
    if (!args[0].startsWith(config.storagePrefix)) throw new Error('Invalid backup object key');
    const { client, sdk, Bucket } = await storage();
    const pending = args[1] + '.partial';
    let output;
    try {
      output = await open(pending, 'wx', 0o600);
      const remote = await client.send(new sdk.GetObjectCommand({ Bucket, Key: args[0] }));
      await pipeline(remote.Body, output.createWriteStream());
      const bytes = (await stat(pending)).size;
      const sha256 = await fileHash(pending);
      if (bytes !== remote.ContentLength || !remote.Metadata?.sha256 || sha256 !== remote.Metadata.sha256) throw new Error('Downloaded backup checksum differs');
      await link(pending, args[1]);
      return { downloaded: true, bytes, sha256 };
    } finally {
      if (output) {
        await output.close();
        await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      client.destroy();
    }
  }
  if (action === 'prune') {
    const { client, sdk, Bucket } = await storage();
    if (config.storageVersioned) {
      try { return await pruneBackupVersions(client, sdk, Bucket, config.storagePrefix, config.offsiteKeep || 14); }
      finally { client.destroy(); }
    }
    const found = await client.send(new sdk.ListObjectsV2Command({ Bucket, Prefix: config.storagePrefix }));
    if (found.IsTruncated) throw new Error('Backup retention requires pagination review');
    const owned = (found.Contents || []).filter(file => /^\d{8}T\d{6}Z\.tar\.enc$/.test(file.Key.slice(config.storagePrefix.length))).sort((a,b) => b.Key.localeCompare(a.Key));
    const expired = owned.slice(config.offsiteKeep || 14);
    for (const file of expired) await client.send(new sdk.DeleteObjectCommand({ Bucket, Key: file.Key }));
    client.destroy();
    return { retained: owned.length - expired.length, removed: expired.length };
  }
  if (action === 'mail-verify' || action === 'mail') {
    const nodemailer = require('nodemailer');
    const mail = nodemailer.createTransport({ host: env.MAIL_HOST, port: Number(env.MAIL_PORT || 587), secure: env.MAIL_PORT === '465', requireTLS: env.MAIL_PORT !== '465', auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD }, connectionTimeout: 15000, socketTimeout: 20000 });
    if (action === 'mail-verify') { await mail.verify(); return { smtpVerified: true }; }
    if (!config.alertsEnabled || !config.alertEmail) throw new Error('Alert delivery is not enabled');
    const notice = JSON.parse(await readFile(args[0], 'utf8'));
    const sent = await mail.sendMail({ from: env.MAIL_FROM || env.MAIL_USER, to: config.alertEmail, subject: notice.subject, text: notice.text });
    if (sent.rejected.length || !sent.accepted.length) throw new Error('Alert recipient rejected');
    return { accepted: true, messageId: sent.messageId, response: sent.response };
  }
  throw new Error('Unknown operations action');
}
try { console.log(JSON.stringify(await execute())); }
catch (error) {
  let message = String(error?.message || 'Operation failed');
  for (const [name,value] of Object.entries(env)) if (value && /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL/.test(name)) message = message.replaceAll(value, '[REDACTED]');
  console.error(JSON.stringify({ action, error: error?.name || 'Error', code: error?.code || 'operation_failed', message: message.slice(0,300) }));
  process.exitCode = 1;
}
