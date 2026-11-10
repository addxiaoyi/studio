import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, realpathSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const root = resolve(process.env.HELT_NATIVE_PACKAGE_TEST_DIR || "test-results/native-package");
mkdirSync(root, { recursive: true });
const output = realpathSync(root), release = resolve("apps/desktop/release");
let executable, mount;
try {
  if (process.platform === "darwin") {
    const dmg = readdirSync(release).find(name => name.endsWith(`${process.arch}.dmg`));
    if (!dmg) throw new Error(`Built ${process.arch} DMG is missing.`);
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
    // Playwright needs the Electron binary; AppRun is a desktop integration launcher.
    const desktopRequire = createRequire(resolve("apps/desktop/package.json"));
    const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
    const { sanitizeFileName } = builderRequire("app-builder-lib/out/util/filename.js");
    const metadata = JSON.parse(readFileSync(resolve("apps/desktop/package.json"), "utf8"));
    executable = join(installed, sanitizeFileName(metadata.name).toLowerCase());
    if (!existsSync(executable)) throw new Error(`AppImage executable is missing; files: ${readdirSync(installed).join(", ")}`);
    const sandbox = join(installed, "chrome-sandbox");
    if (!existsSync(sandbox) || realpathSync(sandbox) !== sandbox) throw new Error("Invalid packaged sandbox.");
    execFileSync("sudo", ["chown", "root:root", sandbox]); execFileSync("sudo", ["chmod", "4755", sandbox]);
  } else throw new Error("Native package storage test supports macOS and Linux.");
  const env = { ...process.env, DEBUG: "pw:browser", HELT_DESKTOP_EXE: executable, HELT_STORAGE_TEST_DIR: join(output, "storage") };
  const test = spawnSync(process.execPath, ["apps/desktop/e2e/local-storage.mjs"], { env, stdio: "inherit" });
  if (test.status !== 0) throw new Error(`Native package storage test failed (${test.status}).`);
  const offline = spawnSync(process.execPath, ["apps/desktop/e2e/offline-migration.mjs"], { env: { ...env, HELT_OFFLINE_TEST_DIR: join(output, "offline") }, stdio: "inherit" });
  if (offline.status !== 0) throw new Error(`Offline workspace migration test failed (${offline.status}).`);
  const insights = spawnSync(process.execPath, ["apps/desktop/e2e/storage-insights.mjs"], { env: { ...env, HELT_INSIGHTS_TEST_DIR: join(output, "insights") }, stdio: "inherit" });
  if (insights.status !== 0) throw new Error(`Storage insights test failed (${insights.status}).`);
  const resumed = spawnSync(process.execPath, ["apps/desktop/e2e/storage-resume.mjs"], { env: { ...env, HELT_RESUME_TEST_DIR: join(output, "resume") }, stdio: "inherit" });
  if (resumed.status !== 0) throw new Error(`Storage resume and directory relink test failed (${resumed.status}).`);
  const controls = spawnSync(process.execPath, ["apps/desktop/e2e/storage-controls.mjs"], { env: { ...env, HELT_CONTROLS_TEST_DIR: join(output, "controls") }, stdio: "inherit" });
  if (controls.status !== 0) throw new Error(`Storage controls test failed (${controls.status}).`);
  if (process.platform === "linux") {
    const disconnected = spawnSync(process.execPath, ["apps/desktop/e2e/storage-disconnect.mjs"], { env: { ...env, HELT_DISCONNECT_TEST_DIR: join(output, "disconnect") }, stdio: "inherit" });
    if (disconnected.status !== 0) throw new Error(`Workspace disconnect test failed (${disconnected.status}).`);
  }
  if (process.env.HELT_VERIFY_PUBLIC_UPDATE === "1") {
    const appImage = process.platform === "linux" ? join(release, readdirSync(release).find(name => name.endsWith(".AppImage"))) : undefined;
    const update = spawnSync(process.execPath, ["apps/desktop/e2e/update-channel.mjs"], { env: { ...env, HELT_UPDATE_TEST_DIR: join(output, "update"), ...(appImage ? { APPIMAGE: appImage } : {}) }, stdio: "inherit" });
    if (update.status !== 0) throw new Error(`Published update channel test failed (${update.status}).`);
  }
} finally { if (mount) execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" }); }
