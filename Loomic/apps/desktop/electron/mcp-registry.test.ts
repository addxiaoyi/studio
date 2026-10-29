import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { McpRegistry, resolveMarketplaceMcpConfig, resolveMcpStdioLaunch, validateMcpServer } from "./mcp-registry.js";

const temporaryRoots: string[] = [];
const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`sealed:${value}`),
  decryptString: (value: Buffer) =>
    value.toString("utf8").slice("sealed:".length),
};

describe("MCP stdio command resolution", () => {
  it("runs Windows npm shims through cmd with each argument quoted", () => {
    expect(resolveMcpStdioLaunch("npx", ["--yes", "@playwright/mcp@0.0.83", "C:\\Users\\A User"], "win32", "C:\\Windows\\System32\\cmd.exe")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", '""npx.cmd" "--yes" "@playwright/mcp@0.0.83" "C:\\Users\\A User""'],
    });
  });

  it("does not invoke a shell for native executable commands", () => {
    expect(resolveMcpStdioLaunch("node", ["server.js"], "win32")).toEqual({ command: "node", args: ["server.js"] });
  });

  it("rejects command expansion in Windows package-runner arguments", () => {
    expect(() => resolveMcpStdioLaunch("npx", ["--yes", "%TEMP%\\payload"], "win32")).toThrow("unsupported command characters");
    expect(() => resolveMcpStdioLaunch("npx", ["--yes", 'folder" & whoami'], "win32")).toThrow("unsupported command characters");
  });

  it("keeps sensitive marketplace configuration out of process arguments", () => {
    const fields = [{ envName: "DATABASE_URL", label: "Database URL", kind: "secret" as const, required: true, sensitive: true }];
    expect(() => resolveMarketplaceMcpConfig(["--yes", "{{DATABASE_URL}}"], fields, { DATABASE_URL: "postgres://private" }))
      .toThrow("encrypted local environment storage");
    expect(resolveMarketplaceMcpConfig(["--yes", "@server/package"], fields, { DATABASE_URL: "postgres://private" }))
      .toEqual({ args: ["--yes", "@server/package"], env: { DATABASE_URL: "postgres://private" } });
  });
});

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("MCP registry", () => {
  it("rejects insecure remote endpoints and malformed local server settings", () => {
    expect(() =>
      validateMcpServer({
        name: "remote",
        transport: "http",
        url: "http://example.com/mcp",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      validateMcpServer({
        name: "remote",
        transport: "http",
        url: "https://user:pass@example.com/mcp",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      validateMcpServer({
        name: "local",
        transport: "stdio",
        command: "node",
        env: { "BAD=NAME": "x" },
      }),
    ).toThrow("Invalid environment");
    expect(() =>
      validateMcpServer({
        name: "loopback",
        transport: "http",
        url: "http://127.0.0.1:3000/mcp",
      }),
    ).not.toThrow();
  });

  it("stores credentials only in encrypted form and never returns them from list", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-mcp-registry-"));
    temporaryRoots.push(root);
    const configPath = join(root, "mcp-registry.json");
    const registry = new McpRegistry(configPath, storage);

    await registry.add({
      name: "remote",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      token: "private-bearer-token",
    });

    const serialized = await readFile(configPath, "utf8");
    expect(serialized).not.toContain("private-bearer-token");
    expect(JSON.stringify(await registry.list())).not.toContain(
      "private-bearer-token",
    );
    expect(await registry.list()).toMatchObject([
      { name: "remote", transport: "http", connected: false, tools: [] },
    ]);
  });

  it("encrypts sensitive launch arguments and omits them from the local registry listing", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-mcp-sensitive-args-"));
    temporaryRoots.push(root);
    const configPath = join(root, "mcp-registry.json");
    const registry = new McpRegistry(configPath, storage);
    await registry.add({
      name: "PostgreSQL MCP",
      transport: "stdio",
      command: "npx",
      args: ["--yes", "@modelcontextprotocol/server-postgres", "postgresql://secret-host/db"],
      sensitiveArgs: true,
    });
    const serialized = await readFile(configPath, "utf8");
    expect(serialized).not.toContain("secret-host");
    expect(JSON.stringify(await registry.list())).not.toContain("secret-host");
    expect(await registry.list()).toMatchObject([{ name: "PostgreSQL MCP", hasSensitiveArgs: true }]);
  });

  it("requires encryption when a server has credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "helstera-mcp-no-keyring-"));
    temporaryRoots.push(root);
    const registry = new McpRegistry(join(root, "mcp-registry.json"), {
      ...storage,
      isEncryptionAvailable: () => false,
    });

    await expect(
      registry.add({
        name: "remote",
        transport: "http",
        url: "https://mcp.example.com/mcp",
        token: "secret",
      }),
    ).rejects.toThrow("encrypted local storage");
  });
});
