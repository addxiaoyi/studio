// @vitest-environment jsdom
/**
 * P0-U1 companion — a transient session-lookup failure must not evict a user who is
 * already signed in. `sessionError` only replaces the page when we have no user; when
 * we do, the workspace keeps working and the banner reports the uncertainty.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-1", email: "maker@example.com" } as { id: string; email: string } | null,
    session: { access_token: "token" } as { access_token: string } | null,
    loading: false,
    sessionError: new Error("Failed to fetch") as Error | null,
    retrySession: vi.fn(),
  },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/desktop-app/",
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => mocks.auth,
  useOptionalAuth: () => mocks.auth,
}));

vi.mock("@/lib/server-api", () => ({
  createProject: vi.fn(),
  createWebsiteCapturePairing: vi.fn().mockResolvedValue({ wssUrl: "wss://x", code: "c" }),
  fetchWebsiteAssistantConnection: vi.fn().mockResolvedValue(null),
  revokeWebsiteAssistant: vi.fn().mockResolvedValue({ ok: true }),
  setWebsiteAssistantPaused: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/components/desktop-workbench", () => ({ DesktopWorkbench: () => <div>Local development</div> }));
vi.mock("@/components/desktop-mcp-panel", () => ({ DesktopMcpPanel: () => <div>MCP connections</div> }));
vi.mock("@/app/(workspace)/projects/page", () => ({ default: () => <div>Projects</div> }));
vi.mock("@/app/(workspace)/assets/page", () => ({ default: () => <div>Assets</div> }));

import DesktopAppLayout from "../src/app/desktop-app/layout";
import { DesktopAppPage } from "../src/components/desktop-app-page";

beforeEach(() => {
  document.documentElement.lang = "zh-CN";
  document.documentElement.dataset.helsteraDesktop = "true";
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
      getBrowserLoginStatus: vi.fn().mockResolvedValue({ status: "idle" }),
      connectEmbeddedAssistant: vi.fn().mockResolvedValue({ ok: true }),
      openBrowserPairing: vi.fn().mockResolvedValue({ ok: true, url: "" }),
      onBrowserLoginState: vi.fn().mockReturnValue(vi.fn()),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
  delete document.documentElement.dataset.helsteraDesktop;
});

describe("desktop shell with a signed-in user and a failed refresh", () => {
  it("keeps the workspace usable and reports the uncertainty through the banner", async () => {
    render(
      <DesktopAppLayout>
        <DesktopAppPage mode="home" />
      </DesktopAppLayout>,
    );

    expect(await screen.findByText("maker@example.com")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "无法连接工作区" })).toBeNull();
    expect(screen.queryByRole("button", { name: /登录并进入工作台/ })).toBeNull();
    expect(screen.getByText("无法确认登录状态，正在重新连接…")).toBeTruthy();
  });
});
