import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopAppPage } from "@/components/desktop-app-page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  createProject: vi.fn(),
  createWebsiteCapturePairing: vi.fn(),
  fetchWebsiteAssistantConnection: vi.fn(),
  revokeWebsiteAssistant: vi.fn(),
  setWebsiteAssistantPaused: vi.fn(),
  openBrowserPairing: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "maker@example.com" },
    session: { access_token: "token" },
    loading: false,
  }),
}));

vi.mock("@/lib/server-api", () => ({
  createDesktopAgentTask: vi.fn(),
  createProject: mocks.createProject,
  createWebsiteCapturePairing: mocks.createWebsiteCapturePairing,
  fetchWebsiteAssistantConnection: mocks.fetchWebsiteAssistantConnection,
  revokeWebsiteAssistant: mocks.revokeWebsiteAssistant,
  setWebsiteAssistantPaused: mocks.setWebsiteAssistantPaused,
}));

vi.mock("@/components/desktop-workbench", () => ({
  DesktopWorkbench: () => <div>Local development</div>,
}));

vi.mock("@/components/desktop-mcp-panel", () => ({
  DesktopMcpPanel: () => <div>MCP connections</div>,
}));

vi.mock("@/app/(workspace)/projects/page", () => ({
  default: () => <div>Projects</div>,
}));

vi.mock("@/app/(workspace)/assets/page", () => ({
  default: () => <div>Assets</div>,
}));

function setDesktopShell(enabled: boolean) {
  if (enabled) {
    document.documentElement.dataset.helsteraDesktop = "true";
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        startBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
        cancelBrowserLogin: vi.fn().mockResolvedValue({ ok: true }),
        getBrowserLoginStatus: vi.fn().mockResolvedValue({ status: "waiting" }),
        onBrowserLoginState: () => vi.fn(),
        connectEmbeddedAssistant: vi.fn().mockResolvedValue({ ok: true }),
        openBrowserPairing: mocks.openBrowserPairing,
      },
    });
    return;
  }

  delete document.documentElement.dataset.helsteraDesktop;
  Reflect.deleteProperty(window, "electronAPI");
}

beforeEach(() => {
  setDesktopShell(true);
  document.documentElement.lang = "zh-CN";
  mocks.createProject.mockResolvedValue({
    project: { primaryCanvas: { id: "canvas-1" } },
  });
  mocks.createWebsiteCapturePairing.mockResolvedValue({
    pairingId: "pair-1",
    code: "one-time-pairing-code",
    expiresAt: "2030-01-01T00:10:00.000Z",
    wssUrl: "wss://studio.0st.top/api/website-capture/assistant/ws",
    disclosure: "Browser pairing disclosure",
  });
  mocks.fetchWebsiteAssistantConnection.mockResolvedValue(null);
  mocks.openBrowserPairing.mockResolvedValue({ ok: true, url: "https://studio.0st.top/desktop-browser-pair.html#code=one-time-code" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setDesktopShell(false);
});

describe("Desktop Agent entry", () => {
  it("starts from a plain-language goal and carries the selected browser mode into the canvas task", async () => {
    mocks.fetchWebsiteAssistantConnection.mockResolvedValue({
      id: "connection-1",
      status: "connected",
      browser: "edge",
      platform: "windows",
      clientKind: "browser-extension",
      connectedAt: "2030-01-01T00:00:00.000Z",
      lastSeenAt: "2030-01-01T00:00:00.000Z",
      paused: false,
    });
    render(<DesktopAppPage mode="home" />);

    expect(screen.getByRole("heading", { name: "你想让 Agent 帮你做什么？" })).toBeInTheDocument();
    expect(screen.queryByText("MCP connections")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "任务目标" }), {
      target: { value: "介绍 https://example.com" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "授权 Edge / Chrome 标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "开始任务" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
    const [route] = mocks.replace.mock.calls[0] as [string];
    const target = new URL(route, "https://desktop.invalid");
    expect(target.pathname).toBe("/desktop-app/canvas/");
    expect(target.searchParams.get("prompt")).toBe("介绍 https://example.com");
    expect(target.searchParams.get("browserMode")).toBe("connected_browser_tab");
    expect(mocks.fetchWebsiteAssistantConnection).toHaveBeenCalledWith("token");
    expect(mocks.createProject).toHaveBeenCalledWith(
      "token",
      { name: "介绍 https://example.com" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });

  it("creates a one-time pair and opens it in the system browser", async () => {
    render(<DesktopAppPage mode="home" />);

    fireEvent.click(screen.getByRole("radio", { name: "授权 Edge / Chrome 标签页" }));
    fireEvent.click(await screen.findByRole("button", { name: "一键连接浏览器" }));

    await waitFor(() => expect(mocks.openBrowserPairing).toHaveBeenCalledWith(
      expect.objectContaining({ pairingId: "pair-1", wssUrl: expect.stringContaining("/api/website-capture/assistant/ws") }),
    ));
    expect(mocks.createWebsiteCapturePairing).toHaveBeenCalledWith("token");
  });

  it("offers local desktop tasks and selects the native executor from the template", async () => {
    render(<DesktopAppPage mode="home" />);

    fireEvent.click(screen.getByRole("button", { name: "整理本机文件窗口" }));

    expect(screen.getByRole("radio", { name: "本机应用（控件树）" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "任务目标" })).toHaveValue("查看当前文件管理器窗口并按我的目标整理文件。先列出拟执行的移动或重命名，再等我确认；不要删除文件。");
  });

  it("does not create a browser task before the paired browser is connected", async () => {
    render(<DesktopAppPage mode="home" />);

    fireEvent.change(screen.getByRole("textbox", { name: "任务目标" }), {
      target: { value: "介绍 https://example.com" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "授权 Edge / Chrome 标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "开始任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("浏览器尚未连接");
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("blocks native desktop modes when only the browser extension is connected", async () => {
    mocks.fetchWebsiteAssistantConnection.mockResolvedValue({
      id: "connection-1", status: "connected", browser: "edge", platform: "windows",
      clientKind: "browser-extension", connectedAt: "2030-01-01T00:00:00.000Z",
      lastSeenAt: "2030-01-01T00:00:00.000Z", paused: false,
    });
    render(<DesktopAppPage mode="home" />);

    fireEvent.change(document.getElementById("desktop-agent-prompt")!, {
      target: { value: "Open Notepad" },
    });
    fireEvent.click(screen.getAllByRole("radio")[2]!);
    fireEvent.submit(screen.getByRole("region", { name: "任务目标" }).querySelector("form")!);

    expect(await screen.findByText(/本机桌面 Agent 尚未连接/)).toBeInTheDocument();
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it("keeps MCP and local development in the advanced area", () => {
    render(<DesktopAppPage mode="development" />);

    expect(screen.getByRole("heading", { name: "本地开发" })).toBeInTheDocument();
    expect(screen.getByText("Local development")).toBeInTheDocument();
  });

  it("does not render desktop content in an ordinary browser", () => {
    setDesktopShell(false);
    const { container } = render(<DesktopAppPage mode="home" />);

    expect(container.firstChild).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/home/");
  });
});
