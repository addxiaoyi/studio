import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const FREE_DOWNLOAD_BYTES = 900_000_000;
const RANGE_BYTES = 32_000_000;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function saveJson(path, value) {
  const pending = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(pending, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(pending, path);
  } finally { await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function fileBytes(path) {
  try { return (await stat(path)).size; }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

async function digestFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export function reserveDownload(ledger, day, bytes, limit = FREE_DOWNLOAD_BYTES) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isSafeInteger(bytes) || bytes < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > FREE_DOWNLOAD_BYTES) {
    throw new Error('Invalid daily download reservation');
  }
  const used = ledger.days[day] ?? 0;
  if (!Number.isSafeInteger(used) || used < 0 || used + bytes > limit) {
    throw new Error('Daily free download allowance exhausted or ledger invalid');
  }
  return { ...ledger, days: { ...ledger.days, [day]: used + bytes } };
}

/** Reserve each range before requesting it; failed transfers still consume that day's budget. */
export async function downloadArchiveDay({ client, sdk, bucket, key, bytes, sha256, directory,
  dailyBytes = FREE_DOWNLOAD_BYTES, rangeBytes = RANGE_BYTES, now = () => new Date(), onProgress = () => {} }) {
  if (!bucket || !key || !Number.isSafeInteger(bytes) || bytes < 1 || !/^[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(dailyBytes) || dailyBytes < 1 || dailyBytes > FREE_DOWNLOAD_BYTES
    || !Number.isSafeInteger(rangeBytes) || rangeBytes < 1 || rangeBytes > RANGE_BYTES) {
    throw new Error('Invalid archive identity or download budget');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, sha256 + '.tar.enc');
  const pending = target + '.partial';
  const ledgerPath = join(directory, 'download-budget.json');
  const lockPath = join(directory, 'download.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }));
    const head = await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== bytes || head.Metadata?.sha256 !== sha256 || !head.VersionId) {
      throw new Error('Remote archive identity differs or version is missing');
    }
    const identity = { bucket, key, bytes, sha256, versionId: head.VersionId };
    let ledger = await readJson(ledgerPath);
    if (ledger && (ledger.schema !== 1 || JSON.stringify(ledger.archive) !== JSON.stringify(identity)
      || !ledger.days || Object.values(ledger.days).some(value => !Number.isSafeInteger(value) || value < 0))) {
      throw new Error('Download ledger does not match the pinned archive');
    }
    if (!ledger) {
      if (await fileBytes(pending)) throw new Error('Partial archive exists without its download ledger');
      ledger = { schema: 1, archive: identity, days: {} };
      await saveJson(ledgerPath, ledger);
    }
    const completeBytes = await fileBytes(target);
    if (completeBytes) {
      if (completeBytes !== bytes || await digestFile(target) !== sha256) throw new Error('Existing download checksum differs');
      return { complete: true, bytes, sha256, file: target, reused: true };
    }
    let offset = await fileBytes(pending);
    if (offset > bytes) throw new Error('Partial download exceeds archive size');
    const day = now().toISOString().slice(0, 10);
    while (offset < bytes && now().toISOString().slice(0, 10) === day) {
      // Avoid a long response crossing the UTC reset and borrowing tomorrow's allowance.
      if (now().getUTCHours() === 23) break;
      const available = dailyBytes - (ledger.days[day] ?? 0);
      if (available <= 0) break;
      const length = Math.min(rangeBytes, available, bytes - offset);
      ledger = reserveDownload(ledger, day, length, dailyBytes);
      await saveJson(ledgerPath, ledger);
      const end = offset + length - 1;
      const signal = AbortSignal.timeout(10 * 60 * 1000);
      const response = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key,
        VersionId: identity.versionId, Range: `bytes=${offset}-${end}` }), { abortSignal: signal });
      if (response.$metadata?.httpStatusCode !== 206 || response.ContentLength !== length
        || response.ContentRange !== `bytes ${offset}-${end}/${bytes}`) {
        response.Body?.destroy();
        throw new Error('Storage did not honor the bounded download range');
      }
      let received = 0;
      const boundary = new Transform({ transform(chunk, encoding, callback) {
        received += chunk.length;
        callback(received > length ? new Error('Download exceeded the reserved range') : null, chunk);
      } });
      await pipeline(response.Body, boundary, createWriteStream(pending, { flags: offset ? 'a' : 'w', mode: 0o600 }), { signal });
      if (received !== length) throw new Error('Storage returned an incomplete download range');
      offset += received;
      onProgress({ day, downloadedBytes: offset, totalBytes: bytes, reservedBytes: ledger.days[day] });
    }
    if (offset !== bytes) return { complete: false, day, downloadedBytes: offset, totalBytes: bytes,
      reservedBytes: ledger.days[day] ?? 0, remainingBytes: bytes - offset };
    if (await digestFile(pending) !== sha256) throw new Error('Downloaded archive SHA-256 mismatch');
    await link(pending, target);
    await unlink(pending);
    const receipt = { complete: true, bytes, sha256, file: target, verifiedAt: now().toISOString() };
    await saveJson(join(directory, 'download-check.json'), receipt);
    return receipt;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
