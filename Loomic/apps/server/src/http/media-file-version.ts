import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

const versions = new Map<string, { fingerprint: string; etag: string }>();
const fingerprint = (info: Awaited<ReturnType<typeof stat>>) =>
  `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.birthtimeMs}`;

export async function mediaFileVersion(path: string): Promise<string> {
  const fileFingerprint = fingerprint(await stat(path));
  const cached = versions.get(path);
  if (cached?.fingerprint === fileFingerprint) return cached.etag;

  // Range playback must not read an entire multi-gigabyte asset to produce a validator.
  const etag = `"${createHash("sha256").update(fileFingerprint).digest("hex")}"`;
  const entry = { fingerprint: fileFingerprint, etag };
  versions.set(path, entry);
  if (versions.size > 128) versions.delete(versions.keys().next().value!);
  return etag;
}
