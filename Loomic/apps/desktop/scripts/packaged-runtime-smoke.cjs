const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");
const { createRequire } = require("node:module");
const { join, isAbsolute } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");

const resources = process.env.HELT_PACKAGED_RESOURCES;
const output = process.env.HELT_PACKAGE_SMOKE_DIR;
if (!resources || !output || !isAbsolute(resources) || !isAbsolute(output)) throw new Error("Absolute package resources and isolated output paths are required.");
mkdirSync(output, { recursive: true });
app.setPath("userData", join(output, "profile"));
const packaged = createRequire(join(resources, "app.asar", "package.json"));
const timeout = setTimeout(() => { console.error("Packaged runtime smoke timed out"); app.exit(1); }, 90_000);

app.whenReady().then(async () => {
  const { screen } = packaged("@nut-tree/nut-js");
  assert.ok(await screen.width() > 0);
  const { createWorker } = packaged("tesseract.js");
  const worker = await createWorker(["eng", "chi_sim"], undefined, {
    cachePath: output,
    ...(process.env.HELT_OCR_LANG_PATH ? { langPath: process.env.HELT_OCR_LANG_PATH, gzip: false } : {}),
  });
  const window = new BrowserWindow({ show: false, width: 640, height: 220, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await window.loadURL("data:text/html,<body style='background:white;color:black;font:48px Arial;padding:20px'>HELSTERA 2026</body>");
    const png = (await window.webContents.capturePage()).toPNG();
    const { data } = await worker.recognize(png);
    assert.match(data.text, /HELSTERA\s+2026/);
    const report = { ok: true, version: packaged("./package.json").version, electron: process.versions.electron, nativeModule: true, ocr: data.text.trim() };
    writeFileSync(join(output, "runtime.json"), JSON.stringify(report, null, 2));
    console.log("PACKAGED_RUNTIME_PASSED", JSON.stringify(report));
  } finally { await worker.terminate(); window.destroy(); clearTimeout(timeout); }
  app.exit(0);
}).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
