import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export function createProcessReceipt(role: "server" | "worker", path = process.env.HELSTERA_PROCESS_RECEIPT) {
  if (path && !isAbsolute(path)) throw new Error("Process receipt destination must be absolute");
  const instanceId = randomUUID();
  const write = async (state: "ready" | "drained") => {
    if (!path) return;
    const directory = dirname(path);
    const temporary = join(directory, `.receipt-${instanceId}-${state}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify({ role, pid: process.pid, instanceId, state, updatedAt: new Date().toISOString() }));
        await file.sync();
      } finally { await file.close(); }
      await rename(temporary, path);
      if (process.platform !== "win32") {
        const parent = await open(directory, "r");
        try { await parent.sync(); }
        finally { await parent.close(); }
      }
    } finally {
      await unlink(temporary).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  };
  return { ready: () => write("ready"), drained: () => write("drained") };
}
