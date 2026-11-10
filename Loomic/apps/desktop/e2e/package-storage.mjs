import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.env.HELT_NATIVE_PACKAGE_TEST_DIR || "test-results/native-package");
mkdirSync(root, { recursive: true });
const output = realpathSync(root), release = resolve("apps/desktop/release");
let executable, mount;
try {
  if (process.platform === "darwin") {
    const dmg = readdirSync(release).find(name => name.endsWith("arm64.dmg"));
    if (!dmg) throw new Error("Built arm64 DMG is missing.");
    mount = join(output, "mounted"); mkdirSync(mount);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, join(release, dmg)], { stdio: "inherit" });
    const bundles = readdirSync(mount).filter(name => name.endsWith(".app"));
    if (bundles.length !== 1) throw new Error("Expected exactly one application in DMG.");
    const installed = join(output, bundles[0]);
    execFileSync("ditto", [join(mount, bundles[0]), installed], { stdio: "inherit" });
    executable = join(installed, "Contents", "MacOS", "Helstera");
  } else if (process.platform === "linux") {
    const name = readdirSync(release).find(name => name.endsWith(".AppImage"));
    if (!name) throw new Error("Built AppImage is missing.");
    execFileSync(join(release, name), ["--appimage-extract"], { cwd: output, stdio: "ignore" });
    const installed = join(output, "squashfs-root");
    // AppImage's entry point resolves the platform's packaged executable name.
    executable = join(installed, "AppRun");
    if (!existsSync(executable)) throw new Error("AppImage entry point is missing.");
    const sandbox = join(installed, "chrome-sandbox");
    if (!existsSync(sandbox) || realpathSync(sandbox) !== sandbox) throw new Error("Invalid packaged sandbox.");
    execFileSync("sudo", ["chown", "root:root", sandbox]); execFileSync("sudo", ["chmod", "4755", sandbox]);
  } else throw new Error("Native package storage test supports macOS and Linux.");
  const env = { ...process.env, HELT_DESKTOP_EXE: executable, HELT_STORAGE_TEST_DIR: join(output, "storage") };
  const test = spawnSync(process.execPath, ["apps/desktop/e2e/local-storage.mjs"], { env, stdio: "inherit" });
  if (test.status !== 0) throw new Error(`Native package storage test failed (${test.status}).`);
} finally { if (mount) execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" }); }
