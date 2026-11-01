// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  sync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session: { access_token: "test-token" } }) }));
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "http://localhost" }));
vi.mock("@/lib/server-api", () => ({
  fetchAgentMarketplaceInstalls: vi.fn(async () => [{
    item_id: "item-1", target: "desktop", installed_version: "1.0.0", status: "installed",
    metadata: { localServerName: "Playwright MCP", enabled: state.enabled },
  }]),
}));
vi.mock("@/components/desktop-connection-banner", () => ({ DesktopConnectionBanner: () => null }));
vi.mock("@/components/desktop-toast", () => ({ DesktopToastProvider: ({ children }: { children: React.ReactNode }) => children }));

import DesktopAppLayout from "@/app/desktop-app/layout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "electronAPI");
  state.enabled = true;
  state.sync.mockClear();
});

it("syncs MCP enablement while navigating between desktop pages", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{
      id: "item-1", kind: "mcp", name: "Playwright MCP", slug: "playwright",
      description: "Browser tools", source_url: "https://example.com", version: "1.0.0", manifest: {},
    }] }),
  }));
  Object.defineProperty(window, "electronAPI", { configurable: true, value: {
    getMcpServers: vi.fn().mockResolvedValue([{ id: "local-1", name: "Playwright MCP", connected: true }]),
    syncDesktopExtensions: state.sync,
  } });

  const view = render(<DesktopAppLayout><div>Home</div></DesktopAppLayout>);
  await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));
  expect(state.sync.mock.calls[0]?.[0]).toMatchObject([{ localServerId: "local-1", metadata: { enabled: true } }]);

  view.rerender(<DesktopAppLayout><div>MCP</div></DesktopAppLayout>);
  state.enabled = false;
  act(() => window.dispatchEvent(new Event("desktop:marketplace-install-changed")));
  await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(2));
  expect(state.sync.mock.calls[1]?.[0]).toMatchObject([{ localServerId: "local-1", metadata: { enabled: false } }]);

  view.rerender(<DesktopAppLayout><div>Marketplace</div></DesktopAppLayout>);
  state.enabled = true;
  act(() => window.dispatchEvent(new Event("desktop:marketplace-install-changed")));
  await waitFor(() => expect(state.sync).toHaveBeenCalledTimes(3));
  expect(state.sync.mock.calls[2]?.[0]).toMatchObject([{ localServerId: "local-1", metadata: { enabled: true } }]);
});
