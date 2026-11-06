import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { stopMediaProcess } from "./process-tree.js";

it("ends the owned worker and its native descendant on cancellation", async () => {
  const code = "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);";
  const worker = spawn(process.execPath, ["-e", code], { detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  try {
    const [chunk] = await once(worker.stdout, "data");
    const descendant = Number(String(chunk).trim());
    expect(descendant).toBeGreaterThan(0);
    const closed = once(worker, "close");
    await stopMediaProcess(worker);
    await closed;
    await expect.poll(() => {
      try { process.kill(descendant, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    }).toBe(false);
  } finally { await stopMediaProcess(worker); }
}, 15_000);
