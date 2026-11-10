import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, open, readFile, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
const require = createRequire(new URL("../../web/package.json", import.meta.url)), { _electron, expect } = require("@playwright/test");
if (process.platform !== "linux") throw new Error("Volume detach acceptance requires Linux.");
const output = resolve(process.env.HELT_DISCONNECT_TEST_DIR || "test-results/storage-disconnect"); await mkdir(output, { recursive: true });
const root = await realpath(await mkdtemp(join(output, "volume-"))), mount = join(root, "workspace"), profile = join(root, "profile"), imagePath = join(root, "test-volume.img");
await mkdir(mount); await mkdir(profile); const image = await open(imagePath, "wx"); await image.truncate(384 * 1024 ** 2); await image.close();
const loop = execFileSync("sudo", ["losetup", "--find", "--show", imagePath], { encoding: "utf8" }).trim(); assert.match(loop, /^\/dev\/loop\d+$/);
let mounted = false, app, server;
const checkedMount = () => { assert.equal(execFileSync("findmnt", ["-n", "-o", "SOURCE", "--target", mount], { encoding: "utf8" }).trim(), loop); };
try {
  assert.equal(execFileSync("sudo", ["losetup", "-n", "-O", "BACK-FILE", loop], { encoding: "utf8" }).trim(), imagePath);
  execFileSync("sudo", ["mkfs.ext4", "-q", loop]); execFileSync("sudo", ["mount", loop, mount]); mounted = true; checkedMount();
  execFileSync("sudo", ["chown", `${process.getuid()}:${process.getgid()}`, mount]);
  const account = randomUUID(), media = join(mount, "Media", account);
  for (const folder of [media, join(mount, "Projects", account), join(mount, "Exports")]) await mkdir(folder, { recursive: true });
  const content = Buffer.alloc(80 * 1024 ** 2, 6); await writeFile(join(media, "a.mp4"), content); await writeFile(join(media, "b.mp4"), content);
  await writeFile(join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: mount, autoBackup: false, agentAccess: false }));
  server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<h1>Helstera volume reconnect</h1>"); }); await new Promise(done => server.listen(0, "127.0.0.1", done));
  const env = { ...process.env, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: profile, HELSTERA_DESKTOP_LOCAL_URL: `http://127.0.0.1:${server.address().port}` }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  app = await _electron.launch({ executablePath: process.env.HELT_DESKTOP_EXE, env }); let page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera volume reconnect" })).toBeVisible();
  await page.evaluate(() => window.electronAPI.configureWorkspaceScan({ rateMiB: 8 }));
  await page.evaluate(account => { window.electronAPI.onWorkspaceScan(state => { window.scanProgress = state; }); window.scanJob = window.electronAPI.getWorkspaceUsage(account, true).then(report => ({ report }), error => ({ error: error.message })); }, account);
  await expect.poll(() => page.evaluate(() => window.scanProgress?.verifiedBytes ?? 0)).toBeGreaterThanOrEqual(4 * 1024 ** 2);
  checkedMount(); execFileSync("sudo", ["umount", "-l", mount]); mounted = false;
  const interrupted = await page.evaluate(() => window.scanJob); assert.match(interrupted.error, /磁盘/);
  const saved = await page.evaluate(account => window.electronAPI.getWorkspaceScanState(account), account); assert.equal(saved.phase, "paused"); assert.equal(saved.disconnected, true); assert.ok(saved.verifiedBytes >= 4 * 1024 ** 2);
  await app.close(); app = null;
  execFileSync("sudo", ["mount", loop, mount]); mounted = true; checkedMount();
  app = await _electron.launch({ executablePath: process.env.HELT_DESKTOP_EXE, env }); page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera volume reconnect" })).toBeVisible();
  assert.equal((await page.evaluate(() => window.electronAPI.getWorkspaceScanSettings())).rateMiB, 8); await page.evaluate(() => window.electronAPI.configureWorkspaceScan({ rateMiB: 0 }));
  const completed = await page.evaluate(account => window.electronAPI.getWorkspaceUsage(account, true), account);
  assert.equal(completed.duplicateGroups, 1); assert.equal(completed.hashedBytes, content.length * 2); assert.ok(completed.resumedBytes >= saved.verifiedBytes);
  assert.ok((await readFile(join(media, "a.mp4"))).equals(content));
  const report = { ok: true, actualFilesystemUnmount: true, virtualBlockDevice: true, physicalCableTest: false, pauseOnDisconnect: true, profileCheckpointSurvived: true, processRestart: true, resumedBytes: completed.resumedBytes, hashedBytes: completed.hashedBytes, originalPreserved: true };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); console.log("STORAGE_DISCONNECT_PASSED", JSON.stringify(report));
} finally {
  if (app) await app.close(); if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  if (mounted) { checkedMount(); execFileSync("sudo", ["umount", mount]); }
  assert.equal(execFileSync("sudo", ["losetup", "-n", "-O", "BACK-FILE", loop], { encoding: "utf8" }).trim(), imagePath);
  execFileSync("sudo", ["losetup", "--detach", loop]);
}
