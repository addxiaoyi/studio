import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { chromium } from "playwright";

export function browserEngine(env = process.env) {
  const name = env.HELSTERA_BROWSER_ENGINE || "chromium";
  if (name !== "chromix" && name !== "chromium")
    throw new Error("Unsupported isolated browser engine.");
  const executablePath =
    name === "chromix"
      ? env.HELSTERA_CHROMIX_EXECUTABLE_PATH?.trim()
      : env.HELSTERA_PLAYWRIGHT_EXECUTABLE_PATH?.trim();
  if (name === "chromix" && (!executablePath || !isAbsolute(executablePath))) {
    throw new Error(
      "Chromix is not installed. Configure its verified executable before starting the task.",
    );
  }
  return { name, executablePath } as const;
}

export async function launchAgentBrowser(scratchRoot?: string) {
  const engine = browserEngine();
  if (engine.executablePath) await access(engine.executablePath);
  const browser = await chromium.launch({
    headless: true,
    ...(scratchRoot ? { artifactsDir: scratchRoot, downloadsPath: scratchRoot } : {}),
    env: { ...Object.fromEntries(
      [
        "PATH",
        "SystemRoot",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "LOCALAPPDATA",
        "APPDATA",
        "DISPLAY",
        "XDG_RUNTIME_DIR",
        "LANG",
        "LC_ALL",
        "TZ",
      ].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]!]],
      ),
    ), ...(scratchRoot ? { TMPDIR: scratchRoot, TMP: scratchRoot, TEMP: scratchRoot } : {}) },
    // Chromix uses Chromium's sandbox; deployment must run it as an unprivileged user.
    ...(engine.name === "chromix" ? { chromiumSandbox: true } : {}),
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
    ],
    executablePath: engine.executablePath ?? chromium.executablePath(),
  });
  return { browser, engine: engine.name };
}
