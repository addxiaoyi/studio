import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopExtensionRegistry } from "./desktop-extension-registry.js";

const roots: string[] = [];

async function makeRegistry() {
  const root = await mkdtemp(join(tmpdir(), "helstera-desktop-extensions-"));
  roots.push(root);
  return new DesktopExtensionRegistry(join(root, "desktop-extensions.json"));
}

const base = {
  itemId: "mcp-1",
  slug: "playwright-mcp",
  name: "Playwright MCP",
  kind: "mcp" as const,
  target: "desktop" as const,
  version: "1.0.0",
  description: "Browser tools",
  sourceUrl: "https://www.npmjs.com/package/@playwright/mcp",
  manifest: { transport: "stdio", command: "npx", args: ["--yes", "@playwright/mcp@1.0.0"], requiredConfig: [] },
  metadata: { localServerName: "Playwright MCP" },
  localServerId: "server-1",
  localConnected: true,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop extension registry", () => {
  it("persists an installed MCP and restores its enabled state", async () => {
    const registry = await makeRegistry();
    const first = await registry.reconcile([base]);
    expect(first).toEqual([expect.objectContaining({ itemId: "mcp-1", status: "enabled", enabled: true, localServerId: "server-1" })]);
    await registry.setEnabled("mcp-1", false);
    expect(await registry.list()).toEqual([expect.objectContaining({ itemId: "mcp-1", status: "disabled", enabled: false })]);
    expect(JSON.parse(await readFile(join(roots[0], "desktop-extensions.json"), "utf8"))).toHaveLength(1);
  });

  it("blocks executable plugin manifests instead of running arbitrary code", async () => {
    const registry = await makeRegistry();
    const [extension] = await registry.reconcile([{
      ...base,
      itemId: "plugin-1",
      slug: "unsafe-plugin",
      name: "Unsafe plugin",
      kind: "plugin",
      target: "workspace",
      manifest: {
        module: "arbitrary-javascript",
        agentInstructions: "run it",
        toolAllowlist: [],
      },
    }]);
    expect(extension).toMatchObject({ status: "blocked", enabled: false });
    await expect(registry.setEnabled("plugin-1", true)).rejects.toThrow("blocked");
  });

  it("marks an installed MCP as missing until the local server is present", async () => {
    const registry = await makeRegistry();
    const [extension] = await registry.reconcile([{ ...base, localServerId: undefined, localConnected: undefined }]);
    expect(extension.status).toBe("missing");
  });

  it("tracks MCP replacement, disconnect, and removal in the desktop registry", async () => {
    const registry = await makeRegistry();
    await registry.reconcile([base]);

    await registry.setLocalServerState("mcp-1", { exists: true, serverId: "server-2", connected: false });
    expect(await registry.list()).toEqual([
      expect.objectContaining({ localServerId: "server-2", localConnected: false, status: "disconnected" }),
    ]);

    await registry.setLocalServerState("mcp-1", { exists: false, connected: false });
    const missing = await registry.list();
    expect(missing).toEqual([expect.objectContaining({ localConnected: false, status: "missing" })]);
    expect(missing[0]).not.toHaveProperty("localServerId");
  });
});
