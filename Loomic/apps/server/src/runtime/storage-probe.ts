import { randomUUID } from "node:crypto";
import { open, realpath, statfs, unlink } from "node:fs/promises";
import { join } from "node:path";

export async function probeWritableStorage(root: string) {
  const directory = await realpath(root), space = await statfs(directory, { bigint: true });
  if (space.bavail * space.bsize < 64n * 1024n ** 2n) throw new Error("Storage reserve is below 64 MiB");
  const path = join(directory, `.helstera-ready-${randomUUID()}`), file = await open(path, "wx", 0o600);
  try { await file.writeFile("ready"); await file.sync(); }
  finally { try { await file.close(); } finally { await unlink(path); } }
}
