import { spawn, type ChildProcess } from "node:child_process";

/** The Python runner owns FFmpeg descendants; stopping only Python leaks work. */
export async function stopMediaProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", reject);
    killer.once("close", code => {
      if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
      else reject(new Error(`Unable to stop media process tree (taskkill exit ${code}).`));
    });
  });
}
