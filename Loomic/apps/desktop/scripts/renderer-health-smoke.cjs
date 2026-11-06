const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { writeFileSync } = require("node:fs");
const { isAbsolute, join } = require("node:path");

const folder = process.env.HELT_RENDERER_HEALTH_DIR;
if (!folder || !isAbsolute(folder)) throw new Error("An isolated absolute health-test directory is required.");
app.setPath("userData", join(folder, "profile"));
app.setPath("sessionData", join(folder, "profile"));
app.on("window-all-closed", () => {});
ipcMain.handle("app-version", () => "health-fixture");
const errors = [];
const report = { electron: process.versions.electron, sandbox: true, contextIsolation: true };
const deadline = setTimeout(() => { writeFileSync(join(folder, "health.json"), JSON.stringify({ ...report, ok: false, error: "Renderer health deadline exceeded" })); app.exit(1); }, 60_000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "renderer-health", preload: join(folder, "preload.cjs") } });
  window.webContents.on("preload-error", (_event, _path, error) => errors.push(error.message));
  window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
  async function checkBridge() {
    const state = await window.webContents.executeJavaScript(`(async()=>({marker:document.documentElement.dataset.helsteraDesktop,version:await window.electronAPI.getAppVersion(),require:typeof require,process:typeof process}))()`);
    assert.deepEqual(state, { marker: "true", version: "health-fixture", require: "undefined", process: "undefined" });
  }
  await window.loadURL("data:text/html,<html><body>Renderer health fixture</body></html>");
  await checkBridge();report.initialLoad = true;
  const reloaded = once(window.webContents, "did-finish-load");window.reload();await reloaded;
  await checkBridge();report.reload = true;
  const crashed = once(window.webContents, "render-process-gone");
  window.webContents.forcefullyCrashRenderer();
  const [, details] = await crashed;assert.ok(["crashed", "killed"].includes(details.reason));
  const recovered = once(window.webContents, "did-finish-load");window.reload();await recovered;
  await checkBridge();report.crashRecovery = true;
  assert.deepEqual(errors, []);
  window.destroy();
  writeFileSync(join(folder, "broken-preload.cjs"), "throw new Error('health-preload-fixture');");
  const broken = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "renderer-health-broken", preload: join(folder, "broken-preload.cjs") } });
  const failure = once(broken.webContents, "preload-error");
  await broken.loadURL("data:text/html,<html><body>Preload failure fixture</body></html>");
  const [, , error] = await failure;assert.match(error.message, /health-preload-fixture/);
  report.preloadFailureDetected = true;broken.destroy();
  clearTimeout(deadline);writeFileSync(join(folder, "health.json"), JSON.stringify({ ...report, ok: true, errors }, null, 2));app.exit(0);
}).catch(error => { clearTimeout(deadline);writeFileSync(join(folder, "health.json"), JSON.stringify({ ...report, ok: false, error: String(error.stack || error) }));app.exit(1); });
