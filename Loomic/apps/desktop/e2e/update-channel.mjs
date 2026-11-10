import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { _electron, expect } = require("@playwright/test");
const output = resolve(process.env.HELT_UPDATE_TEST_DIR || "test-results/native-update");
await mkdir(output, { recursive: true });
const workspace = await realpath(output), profile = join(workspace, "profile");
await mkdir(profile, { recursive: true });
for (const folder of ["Media", "Projects", "Exports"]) await mkdir(join(workspace, folder), { recursive: true });
await writeFile(join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: workspace, autoBackup: false, agentAccess: false }));
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version;
const platform = process.platform === "darwin" ? `macos-${process.arch}` : "linux-x64";
const response = await fetch(`https://studio.0st.top/downloads/desktop-release-${platform}.json`, { signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200); const published = await response.json(); assert.equal(published.version, version);
const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Helstera update channel verification</h1>"); });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const env = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: profile, HELSTERA_DESKTOP_LOCAL_URL: `http://127.0.0.1:${server.address().port}` };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const app = await _electron.launch({ executablePath: process.env.HELT_DESKTOP_EXE, env });
try {
  const page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera update channel verification" })).toBeVisible();
  await page.evaluate(() => window.electronAPI.checkForUpdates());
  await expect.poll(() => page.evaluate(() => window.electronAPI.getUpdateState()).then(state => state.status), { timeout: 60000 }).toBe("not-available");
  const state = await page.evaluate(() => window.electronAPI.getUpdateState());
  assert.equal(state.currentVersion, version);
  if (process.platform === "darwin") { assert.equal(state.reason, "manual install required"); assert.equal(state.version, version); assert.ok(state.downloadUrl.endsWith(published.fileName)); }
  else assert.equal(state.reason, undefined);
  const report = { ok: true, platform, version, realPackagedUpdateCheck: true, state, installationMode: process.platform === "darwin" ? "manual-dmg" : "appimage" };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log("NATIVE_UPDATE_CHANNEL_PASSED", JSON.stringify(report));
} finally { await app.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
