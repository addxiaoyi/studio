import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpRegistry } from "./mcp-registry.js";
import { abortMcpServer } from "./extension-sync.js";

it("does not register a server that closes while its tools are loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-mcp-close-"));
  const registry = new McpRegistry(join(root, "servers.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  });
  const listTools = vi.spyOn(Client.prototype, "listTools").mockImplementation(async function (this: Client) {
    await this.close();
    return { tools: [] };
  });
  try {
    const { id } = await registry.add({
      name: "closing", transport: "stdio", command: process.execPath,
      args: [fileURLToPath(new URL("./test-fixtures/mcp-server.mjs", import.meta.url))],
    });
    await expect(registry.connect(id)).rejects.toThrow("closed during initialization");
    expect((await registry.list())[0]?.connected).toBe(false);
  } finally {
    listTools.mockRestore();
    await registry.closeAll();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

it("deduplicates connections and cancels a connection revoked during initialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-mcp-pending-"));
  const marker = join(root, "initializing");
  const registry = new McpRegistry(join(root, "servers.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  });
  try {
    const { id } = await registry.add({
      name: "pending", transport: "stdio", command: process.execPath,
      args: [fileURLToPath(new URL("./test-fixtures/mcp-server.mjs", import.meta.url))],
      env: { HELSTERA_MCP_TEST_MARKER: marker, HELSTERA_MCP_TEST_STDERR: "1" },
    });
    const first = registry.connect(id);
    const second = registry.connect(id);
    await Promise.all([first, second]);
    const audit = await readFile(join(root, "servers.json.audit.jsonl"), "utf8");
    expect(audit.trim().split("\n")).toHaveLength(1);
    await registry.disconnect(id);

    await rm(marker);
    const connecting = registry.connect(id);
    const outcome = connecting.then(() => "connected", () => "canceled");
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(marker); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    await access(marker);
    await registry.disconnect(id);
    expect(await outcome).toBe("canceled");
    expect((await registry.list())[0]?.connected).toBe(false);
    await registry.connect(id);
    expect(await registry.call(id, "probe", "{}")).toContain("ok");
  } finally {
    await registry.closeAll();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

it.skipIf(process.env.HELSTERA_TEST_PLAYWRIGHT_MCP !== "1").each([
  ["legacy latest", ["@playwright/mcp@latest"]],
  ["marketplace 0.0.83", ["--yes", "@playwright/mcp@0.0.83"]],
])("connects to the real Playwright MCP package: %s", async (_name, args) => {
  const root = await mkdtemp(join(tmpdir(), "helstera-playwright-mcp-"));
  const registry = new McpRegistry(join(root, "servers.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  });
  try {
    const { id } = await registry.add({
      name: "Playwright MCP", transport: "stdio", command: "npx",
      args,
      ...(process.env.HELSTERA_TEST_PLAYWRIGHT_FRESH === "1"
        ? { env: { npm_config_cache: join(root, "npm-cache") } }
        : {}),
    });
    await registry.connect(id);
    const [server] = await registry.list();
    expect(server.connected).toBe(true);
    expect(server.tools.some((tool) => tool.name === "browser_navigate")).toBe(true);
    if (process.env.HELSTERA_TEST_PLAYWRIGHT_FRESH === "1") {
      await access(join(root, "npm-cache", "_npx"));
    }
  } finally {
    await registry.closeAll();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

it("connects a real local MCP process, aborts an in-flight call, disconnects and reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-mcp-process-"));
  const onUnexpectedClose = vi.fn();
  const registry = new McpRegistry(join(root, "servers.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }, onUnexpectedClose);
  const { id } = await registry.add({
    name: "local-test", transport: "stdio", command: process.execPath,
    args: [fileURLToPath(new URL("./test-fixtures/mcp-server.mjs", import.meta.url))],
  });
  try {
    await registry.connect(id);
    expect((await registry.list())[0]).toMatchObject({ connected: true, tools: [{ name: "probe" }] });
    expect(await registry.call(id, "probe", "{}")).toContain("ok");
    const controller = new AbortController();
    const marker = join(root, "started");
    const pending = registry.call(id, "probe", JSON.stringify({ marker }), controller.signal);
    const outcome = pending.then(() => "resolved", () => "rejected");
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(marker); started = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    expect(started).toBe(true);
    abortMcpServer(new Map([["request", controller]]), new Map([["request", id]]), id);
    expect(await outcome).toBe("rejected");
    await registry.disconnect(id);
    expect(onUnexpectedClose).not.toHaveBeenCalled();
    await expect(registry.call(id, "probe", "{}")).rejects.toThrow("Connect this MCP server");
    await registry.connect(id);
    expect(await registry.call(id, "probe", "{}")).toContain("ok");
    await expect(registry.call(id, "probe", JSON.stringify({ exit: true }))).rejects.toThrow();
    expect((await registry.list())[0]?.connected).toBe(false);
    expect(onUnexpectedClose).toHaveBeenCalledExactlyOnceWith(id);
    await registry.connect(id);
    expect(await registry.call(id, "probe", "{}")).toContain("ok");
  } finally {
    await registry.disconnect(id);
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
