const { app, BrowserWindow, ipcMain } = require("electron");
const { isAbsolute, join } = require("node:path");

const profile = process.env.HELSTERA_UI_SMOKE_PROFILE;
if (!profile || !isAbsolute(profile)) throw new Error("An isolated absolute profile is required.");
app.setPath("userData", profile);
app.setPath("sessionData", profile);

const responses = {
  "desktop.browser-login-status": { status: "idle" },
  "window-state": { isMaximized: false },
  "desktop.navigation-state": { canGoBack: false, canGoForward: false },
  "desktop.fullscreen-state": { isFullScreen: false },
  "mcp.list": [],
  "desktop.extensions.sync": [],
  "desktop.marketplace-install.pending": null,
};
for (const [channel, value] of Object.entries(responses)) {
  ipcMain.handle(channel, () => value);
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 700,
    webPreferences: {
      preload: join(__dirname, "..", "dist-electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void window.loadURL("about:blank");
});
app.on("window-all-closed", () => app.quit());
