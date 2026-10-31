import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const build = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("./build-native.ps1", import.meta.url))], { stdio: "inherit", windowsHide: true });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);
} else {
  console.log("Windows UI Automation helper is built on Windows only; existing platform backend retained.");
}
