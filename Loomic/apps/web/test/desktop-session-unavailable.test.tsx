// @vitest-environment jsdom
/**
 * P0-U1 — "cannot reach the workspace" must not be rendered as "please sign in".
 *
 * The shell (layout) mounts the connectivity banner and the page decides between
 * login / error / workspace, so this case renders the real AuthProvider + the real
 * desktop shell to prove the whole chain: network failure → retry screen + banner,
 * retry → new request → workspace, 401 → login page.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFetchLocalSession, mockSignOutLocal } = vi.hoisted(() => ({
  mockFetchLocalSession: vi.fn(),
  mockSignOutLocal: vi.fn(),
}));

vi.mock("../src/lib/local-auth", () => ({
  fetchLocalSession: mockFetchLocalSession,
  signOutLocal: mockSignOutLocal,
}));

const mocks = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/desktop-app/",
}));

vi.mock("@/lib/server-api", () => ({
  createProject: vi.fn(),
  createWebsiteCapturePairing: vi.fn().mockResolvedValue({ wssUrl: "wss://x", code: "c" }),
  fetchWebsiteAssistantConnection: vi.fn().mockResolvedValue(null),
  revokeWebsiteAssistant: vi.fn().mockResolvedValue({ ok: true }),
  setWebsiteAssistantPaused: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/components/desktop-workbench", () => ({
  DesktopWorkbench: () => <div>Local development</div>,
}));

vi.mock("@/components/desktop-mcp-panel", () => ({
  DesktopMcpPanel: () => <div>MCP connections</div>,
}));

vi.mock("@/app/(workspace)/projects/page", () => ({ default: () => <div>Projects</div> }));
vi.mock("@/app/(workspace)/assets/page", () => ({ default: () => <div>Assets</div> }));

import { AuthProvider } from "../src/lib/auth-context";
import { DesktopConnectionBanner } from "../src/components/desktop-connection-banner";
import DesktopAppLayout from "../src/app/desktop-app/layout";
import { DesktopAppPage } from "../src/components/desktop-app-page";

function renderShell() {
  return render(
    <AuthProvider>
      <DesktopAppLayout>
        <DesktopAppPage mode="home" />
      </DesktopAppLayout>
    </AuthProvider>,
  );
}

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

describe("desktop shell session failure", () => {
  it("shows a retryable workspace-unreachable screen (not the login page) and the banner", async () => {
    mockFetchLocalSession.mockRejectedValue(new TypeError("Failed to fetch"));
    renderShell();

    expect(await screen.findByRole("heading", { name: "无法连接工作区" })).toBeTruthy();
    // The sign-in CTA must be absent: the user is not signed out, we just do not know.
    expect(screen.queryByRole("button", { name: /登录并进入工作台/ })).toBeNull();
    // The banner does not need a socket, so it can speak up on this screen.
    expect(screen.getByText("无法确认登录状态，正在重新连接…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeTruthy();
  });

  it("re-requests the session on retry and then renders the workspace", async () => {
    mockFetchLocalSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderShell();
    await screen.findByRole("heading", { name: "无法连接工作区" });
    expect(mockFetchLocalSession).toHaveBeenCalledTimes(1);

    mockFetchLocalSession.mockResolvedValueOnce({
      session: { access_token: "session-token", user: { id: "user_1", email: "maker@example.com" } },
    });
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));

    await waitFor(() => expect(mockFetchLocalSession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("maker@example.com")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "无法连接工作区" })).toBeNull();
  });

  it("still renders the login page for a 401 unauthenticated answer", async () => {
    mockFetchLocalSession.mockRejectedValue(
      Object.assign(new Error("无法读取登录状态"), { status: 401 }),
    );
    renderShell();

    expect(await screen.findByRole("button", { name: /登录并进入工作台/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "无法连接工作区" })).toBeNull();
  });

  it("uses english copy for the en-US locale", async () => {
    document.documentElement.lang = "en-US";
    mockFetchLocalSession.mockRejectedValue(new TypeError("Failed to fetch"));
    renderShell();

    expect(await screen.findByRole("heading", { name: "Workspace unreachable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry connection" })).toBeTruthy();
    // The shell layout mounts the banner without a locale prop (zh-CN default), so the
    // banner copy stays Chinese here — it is translated for callers that pass a locale.
    expect(screen.getByText("无法确认登录状态，正在重新连接…")).toBeTruthy();
  });

  it("has english banner copy for the same session failure", async () => {
    mockFetchLocalSession.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <AuthProvider>
        <DesktopConnectionBanner locale="en-US" />
      </AuthProvider>,
    );

    expect(await screen.findByText("Unable to confirm sign-in state — reconnecting…")).toBeTruthy();
  });
});
