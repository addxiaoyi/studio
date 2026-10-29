// @vitest-environment jsdom
/**
 * 桌面端四组件的中英文案守卫。
 *
 * 这一层要防的不是「翻译好不好」，而是三类会真的漏到界面上的事故：
 * 1. en-US 某个键空着或还是中文 —— 英文壳里蹦出中文；
 * 2. en-US 少了某个键 —— 界面显示内部键名或 undefined；
 * 3. 英文缺失时没有回退 —— 用户看到裸键。
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desktopCopyTables,
  formatDesktopCopy,
  getDesktopCopy,
  mergeDesktopCopy,
} from "@/lib/desktop-copy";

const CJK = /[\u4e00-\u9fa5]/;

/** 把文案表拍平成「点路径 -> 字符串」，键集合和取值都能逐条比对。 */
function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === "string") {
    out[prefix] = value;
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

const zhFlat = flatten(desktopCopyTables["zh-CN"]);
const enFlat = flatten(desktopCopyTables["en-US"]);

describe("desktop-copy 文案表", () => {
  it("keeps every zh-CN entry non-empty (the Chinese table is the source of truth)", () => {
    const empty = Object.entries(zhFlat).filter(([, value]) => value.trim().length === 0);
    expect(empty).toEqual([]);
    expect(Object.keys(zhFlat).length).toBeGreaterThan(150);
  });

  it("gives every en-US key a non-empty value without Chinese characters", () => {
    const offenders = Object.entries(enFlat)
      .filter(([, value]) => value.trim().length === 0 || CJK.test(value))
      .map(([key, value]) => `${key} => ${value}`);
    expect(offenders).toEqual([]);
  });

  it("keeps the zh-CN and en-US key sets exactly identical", () => {
    const zhKeys = Object.keys(zhFlat).sort();
    const enKeys = Object.keys(enFlat).sort();
    expect({ missingInEn: zhKeys.filter((key) => !(key in enFlat)) }).toEqual({ missingInEn: [] });
    expect({ extraInEn: enKeys.filter((key) => !(key in zhFlat)) }).toEqual({ extraInEn: [] });
    expect(enKeys).toEqual(zhKeys);
  });

  it("merges en-US into a complete copy tree that is never Chinese and never a bare key", () => {
    const copy = getDesktopCopy("en-US");
    const flat = flatten(copy);
    expect(Object.keys(flat).sort()).toEqual(Object.keys(zhFlat).sort());
    const broken = Object.entries(flat)
      .filter(([key, value]) => value.trim().length === 0 || CJK.test(value) || value === key)
      .map(([key, value]) => `${key} => ${value}`);
    expect(broken).toEqual([]);
  });

  it("falls back to the Chinese text and warns instead of returning a bare key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 只有一条英文，其余键模拟「英文还没补」的状态。
    const merged = mergeDesktopCopy({ mcp: { tool: { call: "Call tool" } } });

    expect(merged.mcp.tool.call).toBe("Call tool");
    expect(merged.mcp.services.title).toBe(desktopCopyTables["zh-CN"].mcp.services.title);
    expect(merged.settings.headerTitle).toBe("设置");
    expect(warn.mock.calls.map(([message]) => String(message)).join("\n")).toContain('missing "en-US" copy for "mcp.services.title"');
    // 回退值是中文原文，不是 "mcp.services.title" 这种裸键。
    expect(Object.entries(flatten(merged)).filter(([key, value]) => value === key)).toEqual([]);
    warn.mockRestore();
  });

  it("fills {placeholders} and leaves unknown tokens untouched", () => {
    expect(formatDesktopCopy("added {name}", { name: "Local MCP" })).toBe("added Local MCP");
    expect(formatDesktopCopy("{a}/{b}", { a: 1 })).toBe("1/{b}");
  });
});

type McpServerFixture = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  connected: boolean;
  tools: Array<{ name: string; description?: string }>;
};

function setMcpApi(servers: McpServerFixture[]) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      getMcpServers: vi.fn().mockResolvedValue(servers),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    },
  });
}

const mcpServers: McpServerFixture[] = [
  {
    id: "server-1",
    name: "Local MCP",
    transport: "stdio",
    command: "node",
    connected: true,
    tools: [{ name: "read_file", description: "Read a local file" }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.lang = "";
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
  Reflect.deleteProperty(window, "electronAPI");
});

describe("桌面面板 locale 渲染", () => {
  async function renderPanel(locale?: "zh-CN" | "en-US") {
    const { DesktopMcpPanel } = await import("@/components/desktop-mcp-panel");
    const { DesktopToastProvider } = await import("@/components/desktop-toast");
    return render(
      <DesktopToastProvider>
        <DesktopMcpPanel locale={locale ?? null} />
      </DesktopToastProvider>,
    );
  }

  it("renders no Chinese text for locale=\"en-US\"", async () => {
    setMcpApi(mcpServers);
    const { container } = await renderPanel("en-US");

    await waitFor(() => expect(screen.getByText("Server connections")).toBeInTheDocument());
    expect(screen.getByText("Read a local file")).toBeInTheDocument();
    // 折叠在 <details> 里的内置工具说明同样在 DOM 里，必须一起是英文。
    expect(screen.getByText(/Reads the active window/)).toBeInTheDocument();
    expect((container.textContent ?? "").match(CJK)).toBeNull();
  });

  it("follows the document locale for locale-less call sites", async () => {
    setMcpApi(mcpServers);
    document.documentElement.lang = "en-US";
    const { container } = await renderPanel();

    await waitFor(() => expect(screen.getByText("Server connections")).toBeInTheDocument());
    expect(container.textContent ?? "").not.toMatch(CJK);
  });

  it("keeps Chinese as the default when the host declares no locale", async () => {
    setMcpApi(mcpServers);
    const { container } = await renderPanel();

    await waitFor(() => expect(screen.getByText("服务连接")).toBeInTheDocument());
    expect(container.textContent ?? "").toMatch(CJK);
  });
});

const marketplaceApi = vi.hoisted(() => ({
  fetchAgentMarketplaceInstalls: vi.fn(),
  installMarketplaceSkill: vi.fn(),
  removeAgentMarketplaceInstall: vi.fn(),
  syncAgentMarketplaceInstall: vi.fn(),
  uninstallSkill: vi.fn(),
}));
const marketplaceAuth = vi.hoisted(() => ({ session: { access_token: "test-token" as string | null } }));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => marketplaceAuth }));
vi.mock("@/lib/server-api", () => marketplaceApi);
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "" }));

const marketplaceEntries = [
  {
    id: "skill-1",
    kind: "skill",
    name: "Frontend Design",
    slug: "frontend-design",
    description: "Design skill",
    source_url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    version: "main",
    license: "Apache-2.0",
    manifest: {},
  },
];

describe("扩展市场 en-US 渲染", () => {
  it("renders the marketplace cards without Chinese text", async () => {
    marketplaceAuth.session = { access_token: "test-token" };
    marketplaceApi.fetchAgentMarketplaceInstalls.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: marketplaceEntries }) }));

    const { AgentMarketplacePage } = await import("@/components/agent-marketplace-page");
    const { DesktopToastProvider } = await import("@/components/desktop-toast");
    const { container } = render(
      <DesktopToastProvider>
        <AgentMarketplacePage locale="en-US" />
      </DesktopToastProvider>,
    );

    await waitFor(() => expect(screen.getByRole("heading", { name: "Frontend Design" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Agent marketplace" })).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(CJK);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// 桌面壳层（侧栏 / 标题栏 / toast 视口）
//
// 壳层在任何桌面页面都存在，所以这里守三条：
// 1. chrome 分组的 zh-CN / en-US 键集合完全一致 —— 删掉任意一条英文键立刻红；
// 2. zh-CN 渲染结果与接入文案体系之前逐字相同 —— 默认语言行为不能被这次改造改掉；
// 3. 宿主声明 en-US 时壳层真的跟着变 —— 证明取的是 desktop-copy 而不是硬编码。
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  usePathname: () => "/desktop-app",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mockShellReplace, replace: mockShellReplace }),
}));

const { mockShellReplace } = vi.hoisted(() => ({ mockShellReplace: vi.fn() }));

function setShellApi() {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      onNavigate: vi.fn().mockReturnValue(vi.fn()),
      getWindowState: vi.fn().mockResolvedValue({ isMaximized: false }),
      getNavigationState: vi.fn().mockResolvedValue({ canGoBack: true, canGoForward: false }),
      navigateHistory: vi.fn().mockResolvedValue({ canGoBack: false, canGoForward: true }),
      minimizeWindow: vi.fn().mockResolvedValue(undefined),
      maximizeWindow: vi.fn().mockResolvedValue({ isMaximized: true }),
      closeWindow: vi.fn().mockResolvedValue(undefined),
      windowFullscreen: vi.fn().mockResolvedValue({ isFullScreen: false }),
      getFullscreenState: vi.fn().mockResolvedValue({ isFullScreen: false }),
      onWindowState: vi.fn().mockReturnValue(vi.fn()),
      onNavigationState: vi.fn().mockReturnValue(vi.fn()),
      onFullscreenState: vi.fn().mockReturnValue(vi.fn()),
    },
  });
}

const chromeZhKeys = Object.keys(zhFlat).filter((key) => key.startsWith("chrome.")).sort();
const chromeEnKeys = Object.keys(enFlat).filter((key) => key.startsWith("chrome.")).sort();

describe("桌面壳层文案 chrome 分组", () => {
  it("zh-CN 与 en-US 键集合一致，英文值非空且不含中文", () => {
    // 键数先钉死：新增壳层文案必须显式更新这条断言，删键则直接红。
    expect(chromeZhKeys).toHaveLength(44);
    expect(chromeEnKeys).toEqual(chromeZhKeys);

    const offenders = chromeZhKeys
      .filter((key) => {
        const value = enFlat[key] ?? "";
        return value.trim().length === 0 || CJK.test(value);
      })
      .map((key) => `${key} => ${enFlat[key] ?? "<missing>"}`);
    expect(offenders).toEqual([]);
  });

  it("zh-CN 下侧栏标签与接入前逐字一致", async () => {
    const { DesktopWorkspaceSidebar } = await import("@/components/desktop-workspace-sidebar");
    render(<DesktopWorkspaceSidebar />);

    expect(screen.getByRole("navigation", { name: "桌面模块" })).toBeInTheDocument();
    expect(screen.getByText("WORKSPACE")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "画布" })).toHaveAttribute("title", "画布");
    const advancedToggle = screen.getByRole("button", { name: "高级能力" });
    expect(advancedToggle).toHaveAttribute("title", "高级能力");
    expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "设置" })).toHaveAttribute("title", "设置");

    fireEvent.click(advancedToggle);
    for (const label of ["项目", "素材", "MCP 工具", "本地开发"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("title", label);
    }
  });

  it("zh-CN 下标题栏 aria-label / title / 路由标签与接入前逐字一致", async () => {
    setShellApi();
    const { DesktopTitlebar } = await import("@/components/desktop-titlebar");
    render(<DesktopTitlebar />);

    await waitFor(() =>
      expect(screen.getByRole("banner", { name: "Helstera 桌面导航" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Helstera Desktop Agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开侧栏" })).toHaveAttribute("title", "展开侧栏");
    // 折叠/展开是一对文案：切换后 aria-label、title、aria-expanded 必须同步换边。
    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    const collapseButton = screen.getByRole("button", { name: "折叠侧栏" });
    expect(collapseButton).toHaveAttribute("title", "折叠侧栏");
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapseButton);
    expect(screen.getByLabelText("页面历史")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后退" })).toHaveAttribute("title", "后退");
    expect(screen.getByRole("button", { name: "前进" })).toHaveAttribute("title", "前进");
    expect(screen.getByRole("navigation", { name: "常用工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /跳转到工作区或功能/ })).toBeInTheDocument();
    expect(screen.getByLabelText("窗口控制")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最小化" })).toHaveAttribute("title", "最小化");
    expect(screen.getByRole("button", { name: "最大化" })).toHaveAttribute("title", "最大化");
    expect(screen.getByRole("button", { name: "进入全屏" })).toHaveAttribute("title", "进入全屏");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveAttribute("title", "关闭");

    for (const label of ["Agent", "画布", "项目", "素材库", "扩展市场", "设置", "高级能力"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: /跳转到工作区或功能/ }));
    expect(await screen.findByRole("dialog", { name: "快速跳转" })).toBeInTheDocument();
    const search = screen.getByRole("textbox", { name: "搜索页面和工作区" });
    expect(search).toHaveAttribute("placeholder", "搜索页面和工作区");
    expect(screen.getByRole("list", { name: "匹配的工作区" })).toBeInTheDocument();
    // 路由标签与分组名一起出现在快速跳转里，两条都要是原文。
    expect(screen.getByRole("button", { name: /画布\s*任务/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /本地开发\s*高级能力/ })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("没有匹配的功能")).toBeInTheDocument();
  });

  it("宿主声明 en-US 时壳层跟着切英文", async () => {
    document.documentElement.lang = "en-US";
    setShellApi();
    const { DesktopTitlebar } = await import("@/components/desktop-titlebar");
    const { DesktopWorkspaceSidebar } = await import("@/components/desktop-workspace-sidebar");
    const { container } = render(
      <>
        <DesktopWorkspaceSidebar />
        <DesktopTitlebar />
      </>,
    );

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Desktop modules" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("banner", { name: "Helstera desktop navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Marketplace" })).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(CJK);
  });
});
