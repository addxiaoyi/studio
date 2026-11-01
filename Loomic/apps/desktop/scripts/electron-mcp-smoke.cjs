const { app } = require("electron");
const { access, mkdtemp, rm } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { tmpdir } = require("node:os");
const { dirname, isAbsolute, join } = require("node:path");
const ts = require("typescript");

const profile = process.env.HELSTERA_MCP_SMOKE_PROFILE;
if (!profile || !isAbsolute(profile)) throw new Error("An isolated absolute profile path is required.");
app.setPath("userData", profile);

async function smoke() {
  await app.whenReady();
  const sourcePath = join(__dirname, "..", "electron", "mcp-registry.ts");
  const code = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(dirname(sourcePath));
  loaded._compile(code, sourcePath);
  const root = await mkdtemp(join(tmpdir(), "helstera-electron-mcp-"));
  const registry = new loaded.exports.McpRegistry(join(root, "registry.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => value.toString(),
  });
  try {
    const marker = join(root, "handshake");
    const fixture = await registry.add({
      name: "MCP handshake fixture", transport: "stdio", command: process.execPath,
      args: [join(__dirname, "..", "electron", "test-fixtures", "mcp-server.mjs")],
      env: { ELECTRON_RUN_AS_NODE: "1", HELSTERA_MCP_TEST_MARKER: marker },
    });
    const connecting = registry.connect(fixture.id).then(() => "connected", () => "canceled");
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(marker); started = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    if (!started) throw new Error("The MCP fixture did not start its handshake.");
    await registry.disconnect(fixture.id);
    if (await connecting !== "canceled" || (await registry.list()).find((entry) => entry.id === fixture.id)?.connected) {
      throw new Error("A revoked MCP handshake remained connected.");
    }
    await registry.connect(fixture.id);
    if (!(await registry.call(fixture.id, "probe", "{}")).includes("ok")) {
      throw new Error("The MCP fixture could not reconnect after revocation.");
    }
    await registry.disconnect(fixture.id);
    console.log("MCP handshake revocation and reconnection passed.");
    const { id } = await registry.add({
      name: "Playwright MCP", transport: "stdio", command: "npx",
      args: ["--yes", "@playwright/mcp@latest"],
    });
    await registry.connect(id);
    const server = (await registry.list()).find((entry) => entry.id === id);
    if (!server?.tools.some((tool) => tool.name === "browser_navigate")) {
      throw new Error("Playwright MCP did not expose browser_navigate.");
    }
    console.log(`Playwright MCP connected in Electron ${process.versions.electron}; ${server.tools.length} tools available.`);
  } finally {
    await registry.closeAll();
    await rm(root, { recursive: true, force: true });
  }
}

smoke().then(() => app.quit()).catch((error) => {
  console.error("Electron MCP smoke failed:", error);
  app.exit(1);
});
