import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  describeRendererExit,
  recordRendererExit,
} from "./renderer-startup-diagnostics.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder =
  process.env.HELT_RENDERER_HEALTH_DIR ||
  (await mkdtemp(join(tmpdir(), "loomic-renderer-health-")));
await mkdir(folder, { recursive: true });
await build({
  configFile: false,
  build: {
    outDir: folder,
    emptyOutDir: false,
    lib: {
      entry: join(desktop, "electron/preload.ts"),
      formats: ["cjs"],
      fileName: () => "preload.cjs",
    },
    rollupOptions: { external: ["electron"] },
  },
});
const harness = join(folder, "renderer-health-smoke.cjs");
await copyFile(join(desktop, "scripts/renderer-health-smoke.cjs"), harness);
const executable =
  process.env.HELT_RENDERER_HEALTH_EXE ||
  createRequire(import.meta.url)("electron");
const env = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: undefined,
  HELT_RENDERER_HEALTH_DIR: folder,
};
// A caller-supplied test directory may contain an older successful report.
await rm(join(folder, "health.json"), { force: true });
await rm(join(folder, "startup-diagnostics.json"), { force: true });
const child = spawn(
  executable,
  process.env.HELT_RENDERER_HEALTH_PACKAGED === "1" ? [] : [harness],
  { env, windowsHide: true, stdio: "inherit" },
);
const timeout = setTimeout(() => child.kill(), 75_000);
try {
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) {
    const diagnostic = await recordRendererExit(exit.code, exit.signal, folder);
    throw new Error(describeRendererExit(diagnostic, folder));
  }
  const report = JSON.parse(
    await readFile(join(folder, "health.json"), "utf8"),
  );
  if (!report.ok) throw new Error(`Renderer health failed: ${folder}`);
  console.log(`RENDERER_HEALTH_PASSED ${JSON.stringify(report)}`);
} finally {
  clearTimeout(timeout);
}
