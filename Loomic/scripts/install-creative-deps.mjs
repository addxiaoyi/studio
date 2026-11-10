import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INSTALL_TIMEOUT = 5 * 60_000;
const INSTALL_ATTEMPTS = 2;

export function installCreativeDeps(directory, run = execFileSync) {
  const path = join(directory, "bun.lock");
  const original = readFileSync(path);
  // Tarball hashes stay pinned; the regional mirror must not stall hosted CI.
  const portable = original.toString("utf8").replaceAll("https://registry.npmmirror.com/", "https://registry.npmjs.org/");
  try {
    writeFileSync(path, portable);
    for (let attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt++) {
      console.log(`[creative-source] Installing pinned packages (${attempt}/${INSTALL_ATTEMPTS}, timeout 300s)`);
      try {
        run("bun", ["install", "--frozen-lockfile", "--ignore-scripts", "--registry=https://registry.npmjs.org", "--network-concurrency=16"], {
          cwd: directory, stdio: "inherit", timeout: INSTALL_TIMEOUT, killSignal: "SIGKILL",
        });
        return;
      } catch (cause) {
        if (cause.code === "ENOENT" || cause.code === "EACCES") throw new Error("Bun is unavailable; install it and add its executable directory to PATH.", { cause });
        if (attempt === INSTALL_ATTEMPTS) throw new Error(`Pinned editor dependencies failed after ${attempt} attempts: ${directory}`, { cause });
        console.warn(`[creative-source] Install failed (${cause.code ?? cause.status ?? "unknown"}); retrying once.`);
      }
    }
  } finally {
    // Preserve the exact upstream checkout for subsequent pin/dirty checks.
    writeFileSync(path, original);
  }
}
