import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, readdir, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { _electron, expect } = require("@playwright/test");
const executablePath = process.env.HELT_DESKTOP_EXE, source = process.env.HELT_TEST_VIDEO_FILE;
if (!executablePath || !source) throw new Error("Desktop executable and a real video file are required.");
const output = resolve(process.env.HELT_DOWNLOAD_RESTART_DIR || "test-results/download-restart");
await mkdir(join(output, "workspace"), { recursive: true });
const workspace = await realpath(join(output, "workspace")), profile = join(output, "profile");
await mkdir(profile, { recursive: true });
await writeFile(join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: workspace, autoBackup: false, agentAccess: false }));
const bytes = (await stat(source)).size, account = "123e4567-e89b-42d3-a456-426614174000", assetId = "123e4567-e89b-42d3-a456-426614174001";
const hashFile = async path => { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); };
const sha256 = await hashFile(source), etag = `"${sha256}"`, offsets = [];
const server = createServer(async (req, res) => {
  if (req.url === "/api/viewer") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ profile: { id: account } })); return; }
  if (req.url === `/api/uploads/${assetId}/file`) {
    if (!req.headers.cookie?.includes("helstera_session=restart")) { res.writeHead(401); res.end(); return; }
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0); offsets.push(offset);
    if (offset) assert.equal(req.headers["if-range"], etag);
    res.writeHead(offset ? 206 : 200, { "content-type": "video/mp4", "content-length": bytes - offset, etag, ...(offset ? { "content-range": `bytes ${offset}-${bytes - 1}/${bytes}` } : {}) });
    const stream = createReadStream(source, { start: offset, highWaterMark: 64 * 1024 });
    try { for await (const chunk of stream) { if (res.destroyed) break; res.write(chunk); await delay(3); } if (!res.destroyed) res.end(); }
    catch (error) { if (!res.destroyed) res.destroy(error); }
    finally { stream.destroy(); }
    return;
  }
  res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Helstera download restart</h1>");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const env = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: profile, HELSTERA_DESKTOP_LOCAL_URL: `http://127.0.0.1:${server.address().port}` };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let app;
const credentials = { accountId: account, accessToken: "local-session" }, asset = { assetId, name: "真实视频续传", mediaType: "video" };
try {
  app = await _electron.launch({ executablePath, env }); let page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Helstera download restart" })).toBeVisible();
  const version = await page.evaluate(() => window.electronAPI.getAppVersion());
  await app.context().addCookies([{ name: "helstera_session", value: "restart", domain: "127.0.0.1", path: "/", httpOnly: true }]);
  const paused = await page.evaluate(async ({ credentials, asset }) => {
    let paused = false;
    const stop = window.electronAPI.onCloudBackup(state => { if (!paused && state.bytes >= 8 * 1024 ** 2) { paused = true; void window.electronAPI.cancelCloudBackup(); } });
    try { return await window.electronAPI.saveCloudAsset(credentials, asset); } finally { stop(); }
  }, { credentials, asset });
  assert.equal(paused.status, "canceled");
  const directory = join(workspace, "Media", account, ".helstera-downloads");
  const checkpoint = JSON.parse(await readFile(join(directory, (await readdir(directory)).find(name => name.endsWith(".json"))), "utf8"));
  assert.ok(checkpoint.bytes >= 8 * 1024 ** 2 && checkpoint.bytes < bytes);
  await app.close(); app = await _electron.launch({ executablePath, env }); page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "Helstera download restart" })).toBeVisible();
  await app.context().addCookies([{ name: "helstera_session", value: "restart", domain: "127.0.0.1", path: "/", httpOnly: true }]);
  const restored = await page.evaluate(id => window.electronAPI.getCloudBackup(id), account); assert.equal(restored.status, "canceled");
  const saved = await page.evaluate(input => window.electronAPI.saveCloudAsset(input.credentials, input.asset), { credentials, asset });
  assert.equal(saved.status, "completed"); assert.equal(offsets[1], checkpoint.bytes);
  const receipt = saved.items.find(item => item.key === `asset:${assetId}`).receipt;
  assert.equal(await hashFile(receipt.path), sha256); assert.equal(receipt.bytes, bytes);
  const report = { ok: true, version, bytes, resumedBytes: checkpoint.bytes, offsets, sha256, path: receipt.path, pausedThenExited: true, restartedThenResumed: true };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log("DOWNLOAD_RESTART_PASSED", JSON.stringify(report));
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); }
