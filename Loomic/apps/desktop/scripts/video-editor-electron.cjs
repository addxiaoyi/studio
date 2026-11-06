const { app, BrowserWindow, ipcMain } = require("electron");
const { execFile } = require("node:child_process");
const { mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { promisify } = require("node:util");

const root = process.env.HELT_ELECTRON_SMOKE_OUT;
const ffmpeg = process.env.HELT_TEST_FFMPEG;
const ffprobe = process.env.HELT_TEST_FFPROBE;
if (!root || !ffmpeg || !ffprobe) throw new Error("Isolated editor test output and encoder paths are required.");
app.setPath("userData", join(root, "user-data"));
const { createVideoExportHandler } = require(join(root, "handler.cjs"));
const { VideoExportPreviews } = require(join(root, "preview.cjs"));
const { assertVideoTools } = require(join(root, "mediaRenderer.cjs"));
const { probeVideo } = require(join(root, "probe.cjs"));
const { renderVideoCaptions } = require(join(root, "captions.cjs"));
const run = promisify(execFile);

// Test-only main process switch: the renderer has no way to approve its own export.
globalThis.loomicTestExportApproved = false;
app.whenReady().then(async () => {
  const assets = join(root, "assets");
  await mkdir(assets, { recursive: true });
  const handler = createVideoExportHandler({
    assetDirectory: async () => assets,
    checkTools: () => assertVideoTools(ffmpeg, ffprobe),
    confirm: async () => globalThis.loomicTestExportApproved === true,
    inspect: (source, format) => probeVideo(ffprobe, source, format),
    render: args => run(ffmpeg, args, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }),
    renderCaptions: renderVideoCaptions,
  });
  const previews = new VideoExportPreviews(join(root, "history"), async () => assets);
  const window = new BrowserWindow({ show: true, width: 1440, height: 1000, title: "Loomic 隔离视频验收", webPreferences: { preload: join(root, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const localSender = event => {
    const url = new URL(event.senderFrame.url);
    if (event.sender !== window.webContents || url.origin !== "http://localhost:3216") throw new Error("Untrusted editor test sender.");
  };
  ipcMain.handle("video.export", async (event, request) => {
    localSender(event);
    const output = await handler(request);
    return output ? { ...output, previewId: await previews.register(output.path) } : null;
  });
  ipcMain.handle("video.read-export-preview", (event, id) => { localSender(event); return previews.read(id); });
  ipcMain.handle("video.list-export-previews", event => { localSender(event); return previews.list(); });
  await window.loadURL("about:blank");
}).catch(error => { console.error("Editor Electron acceptance failed:", error); app.exit(1); });
