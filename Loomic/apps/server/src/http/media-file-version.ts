import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const versions = new Map<string, { fingerprint: string; etag: Promise<string> }>();
const fingerprint = (info: Awaited<ReturnType<typeof stat>>) => `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

export async function mediaFileVersion(path: string): Promise<string> {
  const before = fingerprint(await stat(path));
  const cached = versions.get(path);
  if (cached?.fingerprint === before) return cached.etag;
  const etag = (async () => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (fingerprint(await stat(path)) !== before) throw new Error("Media file changed while computing its version.");
    return `"${hash.digest("hex")}"`;
  })();
  const entry = { fingerprint: before, etag };
  versions.set(path, entry);
  if (versions.size > 128) versions.delete(versions.keys().next().value!);
  try { return await etag; }
  catch (error) { if (versions.get(path) === entry) versions.delete(path); throw error; }
}
