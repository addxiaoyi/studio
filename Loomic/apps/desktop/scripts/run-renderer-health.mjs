import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "vite";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = process.env.HELT_RENDERER_HEALTH_DIR || await mkdtemp(join(tmpdir(), "loomic-renderer-health-"));
await mkdir(folder, { recursive: true });
await build({ configFile: false, build: { outDir: folder, emptyOutDir: false,
  lib: { entry: join(desktop, "electron/preload.ts"), formats: ["cjs"], fileName: () => "preload.cjs" },
  rollupOptions: { external: ["electron"] } } });
const harness = join(folder, "renderer-health-smoke.cjs");
await copyFile(join(desktop, "scripts/renderer-health-smoke.cjs"), harness);
const executable = process.env.HELT_RENDERER_HEALTH_EXE || createRequire(import.meta.url)("electron");
const env = { ...process.env, HELT_RENDERER_HEALTH_DIR: folder };delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, process.env.HELT_RENDERER_HEALTH_PACKAGED === "1" ? [] : [harness], { env, windowsHide: true, stdio: "inherit" });
const timeout = setTimeout(() => child.kill(), 75_000);
try {
  await new Promise((resolve, reject) => { child.once("error", reject);child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Renderer health exited ${code}; report: ${folder}`))); });
  const report = JSON.parse(await readFile(join(folder, "health.json"), "utf8"));
  if (!report.ok) throw new Error(`Renderer health failed: ${folder}`);
  console.log("RENDERER_HEALTH_PASSED " + JSON.stringify(report));
} finally { clearTimeout(timeout); }
