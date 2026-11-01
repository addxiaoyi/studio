import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { McpRegistry } from "./mcp-registry.js";
import { abortMcpServer } from "./extension-sync.js";

it("connects a real local MCP process, aborts an in-flight call, disconnects and reconnects", async () => {
  const root = await mkdtemp(join(tmpdir(), "helstera-mcp-process-"));
  const registry = new McpRegistry(join(root, "servers.json"), {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  });
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
    await expect(registry.call(id, "probe", "{}")).rejects.toThrow("Connect this MCP server");
    await registry.connect(id);
    expect(await registry.call(id, "probe", "{}")).toContain("ok");
  } finally {
    await registry.disconnect(id);
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
