import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export function describeRendererExit(diagnostic, folder) {
  const { code, signal, healthReportExists, windows } = diagnostic;
  const exit =
    code === null
      ? `signal ${signal ?? "unknown"}`
      : `${code} (0x${(code >>> 0).toString(16).padStart(8, "0")})`;
  const stage = healthReportExists
    ? "after writing its report"
    : "before writing its report";
  const token = windows?.restrictedToken
    ? " The Windows launcher token is restricted; verify that this execution environment permits Chromium sandbox window-station creation."
    : diagnostic.windowsProbeError
      ? " Windows launcher inspection was unavailable; see startup-diagnostics.json for the probe error."
      : "";
  return `Renderer health exited ${exit} ${stage}.${token} Evidence: ${folder}`;
}

export async function recordRendererExit(code, signal, folder) {
  let healthReportExists = false;
  try {
    await access(join(folder, "health.json"));
    healthReportExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const diagnostic = {
    code,
    signal,
    healthReportExists,
    platform: process.platform,
  };
  if (process.platform === "win32") {
    try {
      const probe = fileURLToPath(
        new URL("./probe-windows-launcher.ps1", import.meta.url),
      );
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-File", probe],
        {
          windowsHide: true,
          timeout: 10_000,
          maxBuffer: 16_384,
        },
      );
      const windows = JSON.parse(stdout);
      if (
        typeof windows.restrictedToken !== "boolean" ||
        typeof windows.inJob !== "boolean"
      ) {
        throw new Error("Invalid Windows launcher probe output");
      }
      diagnostic.windows = windows;
    } catch (error) {
      diagnostic.windowsProbeError = error.message;
    }
  }
  await writeFile(
    join(folder, "startup-diagnostics.json"),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
  );
  return diagnostic;
}
