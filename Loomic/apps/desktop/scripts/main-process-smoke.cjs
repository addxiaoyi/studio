const { app, BrowserWindow, globalShortcut, nativeImage, shell } = require("electron");
const { isAbsolute, join } = require("node:path");

const profile = process.env.HELSTERA_UI_SMOKE_PROFILE;
if (!profile || !isAbsolute(profile)) throw new Error("An isolated absolute profile is required.");
const target = new URL(process.env.HELSTERA_DESKTOP_URL || "");
if (target.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(target.hostname)) {
  throw new Error("The smoke test requires a loopback HTTP server.");
}
if (app.isPackaged) throw new Error("This harness must use the unpackaged Electron runtime.");

app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.requestSingleInstanceLock = () => true;
app.setAsDefaultProtocolClient = () => true;
globalShortcut.register = () => false;
globalShortcut.unregister = () => {};
nativeImage.createFromPath = () => nativeImage.createEmpty();
shell.openExternal = async () => { throw new Error("External navigation is disabled in the smoke test."); };
BrowserWindow.prototype.show = () => {};
app.on("web-contents-created", (_event, contents) => { contents.openDevTools = () => {}; });

require(join(__dirname, "..", "dist-electron", "main.js"));
