import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const require = createRequire(resolve(process.env.HELT_TEST_TOOLS || "apps/web/package.json"));
const { _electron, expect } = require("@playwright/test");
if (process.platform !== "linux") throw new Error("This acceptance requires Linux.");
const root = resolve(process.env.HELT_UPGRADE_TEST_DIR || "test-results/linux-installed-upgrade");
await mkdir(root, { recursive: true });
const sha = async (path, algorithm = "sha256") => { const hash = createHash(algorithm); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest(algorithm === "sha512" ? "base64" : "hex"); };
const versions = [
  { version: "0.2.27", hash: "97c969de0ed878c6b4ca0c7a2c20f322a92b0a5aacc65489382d430402b4c801", path: join(root, "Helstera.AppImage") },
  { version: "0.2.28", hash: "38a11b6433ca9a1f3d266ad656c03907ee742dd2e5dde4e3dd0f9fd4df2be622", path: join(root, "target.AppImage") },
];
for (const artifact of versions) {
  const response = await fetch(`https://studio.0st.top/downloads/Helstera-${artifact.version}.AppImage`, { signal: AbortSignal.timeout(180000) });
  assert.equal(response.status, 200);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(artifact.path));
  assert.equal(await sha(artifact.path), artifact.hash); await chmod(artifact.path, 0o755);
}
execFileSync(versions[0].path, ["--appimage-extract"], { cwd: root, stdio: "ignore" });
const extracted = join(root, "squashfs-root"), binary = "@helsteradesktop";
assert.ok((await stat(join(extracted, binary))).isFile(), "Pinned AppImage Electron executable is missing");
const sandbox = join(extracted, "chrome-sandbox");
execFileSync("sudo", ["chown", "root:root", sandbox]); execFileSync("sudo", ["chmod", "4755", sandbox]);
const profile = join(root, "profile"), workspace = join(root, "工作区"), account = randomUUID(), asset = randomUUID(), upload = randomUUID();
for (const folder of [profile, join(workspace, "Media", account), join(workspace, "Projects", account), join(workspace, "Exports")]) await mkdir(folder, { recursive: true });
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=", "base64");
const media = join(workspace, "Media", account, "original.png"), snapshot = join(workspace, "Projects", account, "project.json");
await writeFile(media, image);
await writeFile(join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, completed: true, root: workspace, autoBackup: false, agentAccess: false }));
await writeFile(join(workspace, "Projects", account, "backup-index.json"), JSON.stringify({ account, items: [{ key: `asset:${asset}`, receipt: { path: media, relativePath: `Media/${account}/original.png`, bytes: image.length, sha256: await sha(media), savedAt: new Date().toISOString() } }] }));
await writeFile(snapshot, JSON.stringify({ format: "helstera-project-backup", formatVersion: 1, project: { id: account, name: "升级恢复验收", workspace: { ownerUserId: account } }, canvas: { id: account, content: { elements: [{ id: "photo", type: "image", link: `/api/uploads/${asset}/file` }] } }, sessions: [] }));
const beforeSnapshot = await sha(snapshot), targetSize = (await stat(versions[1].path)).size, targetSha512 = await sha(versions[1].path, "sha512");
let restored = 0, uploaded = false, received = null, requestError = null;
const body = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); };
const server = createServer((req, res) => { void (async () => {
  const path = new URL(req.url, "http://localhost").pathname;
  const json = value => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  if (path === "/channel/latest-linux.yml") { res.writeHead(200, { "content-type": "text/yaml" }); res.end(`version: 0.2.28\nfiles:\n  - url: Helstera-0.2.28.AppImage\n    sha512: ${targetSha512}\n    size: ${targetSize}\npath: Helstera-0.2.28.AppImage\nsha512: ${targetSha512}\nreleaseDate: '2026-11-10T00:00:00.000Z'\n`); return; }
  if (path === "/channel/Helstera-0.2.28.AppImage") { res.writeHead(200, { "content-type": "application/octet-stream", "content-length": targetSize }); await pipeline(createReadStream(versions[1].path), res); return; }
  if (path.startsWith("/channel/")) { res.writeHead(404); res.end(); return; }
  if (path === "/acceptance") { received = JSON.parse(await body(req)); return json({ ok: true }); }
  if (path.startsWith("/api/")) {
    assert.equal(req.headers.authorization, "Bearer upgrade-fixture");
    if (path === "/api/viewer") return json({ profile: { id: account } });
    if (path === `/api/uploads/${asset}/file` && req.method === "HEAD") { res.writeHead(404); res.end(); return; }
    if (path === "/api/assets/private-try-on") { assert.ok((await body(req)).includes(image)); uploaded = true; return json({ ok: true, assetId: upload }); }
    if (path === "/api/project-backups/restore") { const submitted = JSON.parse(await body(req)); assert.equal(submitted.replacements[asset], upload); restored++; return json({ ok: true, data: { projectId: upload, canvasId: upload, sessionId: null, restored: true } }); }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<h1>Helstera Linux 升级验收</h1><script>(async()=>{const api=window.electronAPI;try{const version=await api.getAppVersion();document.title=version;if(version!=="0.2.28")return;const credentials={accountId:${JSON.stringify(account)},accessToken:"upgrade-fixture"};const setup=await api.getDesktopSetup();const catalog=await api.listLocalSnapshots(credentials);const preview=await api.previewLocalSnapshot(catalog.snapshots[0].id,credentials);const restored=await api.restoreLocalProject(preview.id,credentials);const media=await api.previewSnapshotMedia(catalog.snapshots[0].id,credentials.accountId,${JSON.stringify(asset)});const img=new Image();img.src=media.url;await img.decode();document.body.append(img);await fetch('/acceptance',{method:'POST',body:JSON.stringify({version,setup,catalog,preview,restored,imageWidth:img.naturalWidth})});}catch(error){await fetch('/acceptance',{method:'POST',body:JSON.stringify({error:error.message})});}})()</script>`);
})().catch(error => { requestError = error; res.writeHead(500); res.end(); }); });
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const runtimeEnv = Object.fromEntries(["PATH", "HOME", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const env = { ...runtimeEnv, HELSTERA_ISOLATED_TEST: "1", HELSTERA_TEST_USER_DATA: profile, HELSTERA_DESKTOP_LOCAL_URL: origin, APPIMAGE: versions[0].path, APPIMAGE_EXTRACT_AND_RUN: "1", CHROME_DEVEL_SANDBOX: sandbox };
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
let app;
try {
  app = await _electron.launch({ executablePath: join(extracted, binary), env });
  const page = await app.firstWindow(); await expect(page.getByRole("heading", { name: "Helstera Linux 升级验收" })).toBeVisible();
  assert.equal(await page.evaluate(() => window.electronAPI.getAppVersion()), "0.2.27");
  await app.evaluate(({ session }, origin) => {
    session.fromPartition("electron-updater", { cache: false }).webRequest.onBeforeRequest({ urls: ["https://studio.0st.top/downloads/updates/*"] }, (details, callback) => callback({ redirectURL: `${origin}/channel/${new URL(details.url).pathname.split("/").pop()}` }));
  }, origin);
  await app.evaluate(({ app }, root) => {
    const child = process.mainModule.require("node:child_process"), { openSync } = process.mainModule.require("node:fs");
    const spawn = child.spawn.bind(child), descriptor = openSync(`${root}/updated-app.log`, "a");
    // Preserve the updater's command, arguments and environment; capture only child diagnostics.
    child.spawn = (command, args, options) => spawn(command, args, command === process.env.APPIMAGE ? { ...options, stdio: ["ignore", descriptor, descriptor] } : options);
  }, root);
  await page.evaluate(() => window.electronAPI.checkForUpdates());
  await expect.poll(() => page.evaluate(() => window.electronAPI.getUpdateState()).then(state => state.status), { timeout: 180000 }).toBe("downloaded");
  const downloaded = await page.evaluate(() => window.electronAPI.getUpdateState()); assert.equal(downloaded.version, "0.2.28");
  await page.screenshot({ path: join(root, "old-version-downloaded.png") });
  await page.evaluate(() => window.electronAPI.installUpdate());
  await expect.poll(() => received, { timeout: 120000 }).not.toBeNull();
  assert.equal(requestError, null); assert.equal(received.error, undefined);
  assert.equal(received.version, "0.2.28"); assert.equal(received.setup.root, workspace); assert.equal(received.setup.completed, true);
  assert.equal(received.catalog.snapshots.length, 1); assert.equal(received.preview.localMedia, 1); assert.equal(received.preview.missingMedia, 0);
  assert.equal(received.restored.canvasId, upload); assert.ok(received.imageWidth > 0); assert.equal(restored, 1); assert.equal(uploaded, true);
  assert.equal(await sha(versions[0].path), versions[1].hash); assert.ok((await readFile(media)).equals(image)); assert.equal(await sha(snapshot), beforeSnapshot);
  const report = { ok: true, from: "0.2.27", to: "0.2.28", realAppImageReplacement: true, sandboxEnabled: true, isolatedFixedUpdateFeed: true, publicPackageSha256: versions[1].hash, directoryPreserved: true, mediaBytesPreserved: true, originalSnapshotPreserved: true, restoredThroughApiFixture: true, mediaDecodedAfterUpgrade: true };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2)); console.log("LINUX_INSTALLED_UPGRADE_PASSED", JSON.stringify(report));
} catch (error) {
  console.error("UPGRADE_FAILURE", error.message);
  console.error("INSTALLED_FILE_SHA256", await sha(versions[0].path).catch(() => "missing"));
  console.error("UPDATED_APP_LOG", await readFile(join(root, "updated-app.log"), "utf8").catch(() => "not started"));
  const diagnosis = spawnSync(versions[0].path, [], { env, timeout: 15000, encoding: "utf8", maxBuffer: 256 * 1024 });
  console.error("DIRECT_LAUNCH_DIAGNOSTICS", diagnosis.status, diagnosis.error?.code, diagnosis.stderr?.slice(-5000));
  throw error;
} finally {
  // Only stop processes launched with this exact isolated test profile.
  for (const pid of (await readdir("/proc")).filter(name => /^\d+$/.test(name))) {
    try { const vars = await readFile(`/proc/${pid}/environ`, "utf8"); if (vars.split("\0").includes(`HELSTERA_TEST_USER_DATA=${profile}`)) process.kill(Number(pid), "SIGTERM"); }
    catch (error) { if (!["ENOENT", "EACCES", "ESRCH"].includes(error.code)) console.error("Test process cleanup:", error.message); }
  }
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
