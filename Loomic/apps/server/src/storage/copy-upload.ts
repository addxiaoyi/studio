import { constants } from "node:fs";
import { copyFile, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export async function copyUpload(root: string, bucket: string, objectPath: string, source: string): Promise<void> {
  const base = resolve(root), destination = resolve(base, bucket, objectPath);
  if (!relative(base, destination) || relative(base, destination).startsWith("..")) throw new Error("Invalid upload destination.");
  await mkdir(dirname(destination), { recursive: true });
  if (await realpath(dirname(destination)) !== dirname(destination)) throw new Error("Upload destination cannot be a link.");
  const temporary = join(dirname(destination), `.upload-${randomUUID()}`);
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    const file = await open(temporary, "r+");
    try { await file.sync(); } finally { await file.close(); }
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
