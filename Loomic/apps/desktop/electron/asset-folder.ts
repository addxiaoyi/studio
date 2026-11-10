import { randomUUID } from "node:crypto";
import { open, readFile, statfs, unlink } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

export async function verifyAssetFolder(directory: string) {
  if (!isAbsolute(directory)) throw new Error("Choose an absolute local folder path.");
  const probe = join(directory, `.helstera-write-check-${randomUUID()}`);
  const bytes = Buffer.from(randomUUID());
  const file = await open(probe, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
    if (!(await readFile(probe)).equals(bytes)) throw new Error("Local folder write verification failed.");
    const space = await statfs(directory);
    return { kind: "native" as const, path: directory, name: basename(directory), availableBytes: space.bavail * space.bsize, capacityBytes: space.blocks * space.bsize };
  } finally {
    try { await file.close(); } finally { await unlink(probe); }
  }
}

export async function readAssetFolderStatus(settingsPath: string) {
  let settings: { directory?: unknown; lastWriteAt?: unknown };
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { name: null, path: null, permission: "unselected" as const };
    throw new Error("Local folder settings could not be read.", { cause: error });
  }
  if (typeof settings.directory !== "string" || !isAbsolute(settings.directory)) throw new Error("Local folder settings contain an invalid path.");
  try {
    return {
      ...await verifyAssetFolder(settings.directory), permission: "granted" as const,
      lastWriteAt: typeof settings.lastWriteAt === "string" ? settings.lastWriteAt : null,
    };
  } catch (error) {
    return { name: basename(settings.directory), path: settings.directory, permission: "denied" as const,
      error: "The local folder is unavailable or cannot be written. Choose it again.",
      errorCode: (error as NodeJS.ErrnoException).code ?? "WRITE_CHECK_FAILED" };
  }
}
