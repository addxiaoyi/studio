const { app } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const output = process.env.HELT_ELECTRON_SMOKE_OUTPUT;
const userData = process.env.HELT_ELECTRON_SMOKE_USER_DATA;
if (!output || !userData || !path.isAbsolute(output) || !path.isAbsolute(userData)) {
  throw new Error("Set absolute smoke output and isolated user-data paths.");
}

app.setPath("userData", userData);
app.whenReady().then(() => {
  writeFileSync(output, JSON.stringify({ electron: process.versions.electron, userData: app.getPath("userData") }));
  app.quit();
}).catch((error) => {
  console.error("Electron runtime smoke failed:", error);
  app.exit(1);
});
