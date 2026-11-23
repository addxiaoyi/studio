/** Resolve a separate backup account whenever an explicit S3 endpoint is set. */
export function storageSettings(config, env) {
  const custom = Boolean(config.storageEndpoint);
  const region = custom ? config.storageRegion : env.QINIU_REGION || 'cn-east-1';
  const endpoint = new URL(custom ? config.storageEndpoint : `https://s3.${region}.qiniucs.com`);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
    throw new Error('Backup S3 endpoint must be an HTTPS origin without credentials');
  }
  const bucket = config.storageBucket || (custom ? undefined : env.QINIU_PUBLIC_BUCKET);
  const accessKeyId = custom ? env.BACKUP_S3_ACCESS_KEY_ID : env.QINIU_ACCESS_KEY;
  const secretAccessKey = custom ? env.BACKUP_S3_SECRET_ACCESS_KEY : env.QINIU_SECRET_KEY;
  if (!region || !bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Backup S3 bucket and region are required');
  if (!accessKeyId || !secretAccessKey) throw new Error('Backup S3 credentials are missing');
  return { endpoint: endpoint.origin, region, bucket, credentials: { accessKeyId, secretAccessKey } };
}

/** Delete complete versions of expired backups; name-only S3 deletes retain B2 bytes. */
export function expiredBackupVersions(versions, markers, prefix, keep) {
  if (!prefix || !prefix.endsWith('/') || !Number.isInteger(keep) || keep < 1) throw new Error('Backup prefix and positive retention count are required');
  const owned = entry => typeof entry.Key === 'string' && entry.Key.startsWith(prefix)
    && /^\d{8}T\d{6}Z\.tar\.enc$/.test(entry.Key.slice(prefix.length));
  const names = [...new Set(versions.filter(owned).map(entry => entry.Key))].sort().reverse();
  const retained = new Set(names.slice(0, keep));
  return [...versions, ...markers].filter(entry => owned(entry) && !retained.has(entry.Key)).map(entry => {
    if (!entry.VersionId) throw new Error('Backup object version is missing');
    return { Key: entry.Key, VersionId: entry.VersionId };
  });
}

export async function pruneBackupVersions(client, sdk, bucket, prefix, keep) {
  const versions = [], markers = [];
  let cursor;
  do {
    const page = await client.send(new sdk.ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, ...cursor }));
    versions.push(...page.Versions || []);
    markers.push(...page.DeleteMarkers || []);
    const next = page.IsTruncated ? { KeyMarker: page.NextKeyMarker, VersionIdMarker: page.NextVersionIdMarker } : undefined;
    if (next && (!next.KeyMarker || JSON.stringify(next) === JSON.stringify(cursor))) throw new Error('Backup version listing did not advance');
    cursor = next;
  } while (cursor);
  const expired = expiredBackupVersions(versions, markers, prefix, keep);
  for (const object of expired) await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, ...object }));
  const owned = versions.filter(entry => entry.Key?.startsWith(prefix)
    && /^\d{8}T\d{6}Z\.tar\.enc$/.test(entry.Key.slice(prefix.length)));
  return { removedVersions: expired.length, retainedNames: Math.min(keep, new Set(owned.map(entry => entry.Key)).size) };
}

export async function checkStorageCapacity(client, sdk, bucket, bytes, limit, prefix) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Backup storage capacity limit is invalid');
  let usedBytes = 0, cursor;
  do {
    // Count every stored version, including hidden ones that B2 still bills.
    const page = await client.send(new sdk.ListObjectVersionsCommand({ Bucket: bucket, ...(prefix ? { Prefix: prefix } : {}), ...cursor }));
    usedBytes += (page.Versions || []).reduce((sum, item) => sum + Number(item.Size || 0), 0);
    const next = page.IsTruncated ? { KeyMarker: page.NextKeyMarker, VersionIdMarker: page.NextVersionIdMarker } : undefined;
    if (next && (!next.KeyMarker || JSON.stringify(next) === JSON.stringify(cursor))) throw new Error('Backup capacity listing did not advance');
    cursor = next;
  } while (cursor);
  if (sdk.ListMultipartUploadsCommand && sdk.ListPartsCommand) {
    let uploadCursor;
    do {
      const uploads = await client.send(new sdk.ListMultipartUploadsCommand({ Bucket: bucket, ...(prefix ? { Prefix: prefix } : {}), ...uploadCursor }));
      for (const upload of uploads.Uploads || []) {
        let partMarker;
        do {
          const parts = await client.send(new sdk.ListPartsCommand({ Bucket: bucket, Key: upload.Key, UploadId: upload.UploadId, PartNumberMarker: partMarker }));
          usedBytes += (parts.Parts || []).reduce((sum, part) => sum + Number(part.Size || 0), 0);
          const nextPart = parts.IsTruncated ? parts.NextPartNumberMarker : undefined;
          if (nextPart !== undefined && (!nextPart || nextPart === partMarker)) throw new Error('Multipart listing did not advance');
          partMarker = nextPart;
        } while (partMarker !== undefined);
      }
      const next = uploads.IsTruncated ? { KeyMarker: uploads.NextKeyMarker, UploadIdMarker: uploads.NextUploadIdMarker } : undefined;
      if (next && (!next.KeyMarker || JSON.stringify(next) === JSON.stringify(uploadCursor))) throw new Error('Incomplete upload listing did not advance');
      uploadCursor = next;
    } while (uploadCursor);
  }
  if (usedBytes + bytes > limit) throw new Error('Backup upload would exceed the approved free-storage limit');
  return { usedBytes, uploadBytes: bytes, limitBytes: limit };
}
