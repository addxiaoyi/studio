// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentMarketplacePage } from "@/components/agent-marketplace-page";
import { DesktopToastProvider } from "@/components/desktop-toast";

const api = vi.hoisted(() => ({
  fetchAgentMarketplaceInstalls: vi.fn(),
  installMarketplaceSkill: vi.fn(),
  removeAgentMarketplaceInstall: vi.fn(),
  syncAgentMarketplaceInstall: vi.fn(),
  uninstallSkill: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: { access_token: "test-token" as string | null } }));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth }));
vi.mock("@/lib/server-api", () => api);
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "" }));

const entries = [
  { id: "skill-1", kind: "skill", name: "Frontend Design", slug: "frontend-design", description: "Design skill", source_url: "https://github.com/anthropics/skills/tree/main/skills/frontend-design", version: "main", license: "Apache-2.0", manifest: {} },
  { id: "mcp-1", kind: "mcp", name: "PostgreSQL MCP", slug: "postgres-mcp", description: "Read only database tools", source_url: "https://www.npmjs.com/package/@modelcontextprotocol/server-postgres", version: "0.6.2", license: "MIT", manifest: { transport: "stdio", command: "npx", args: ["--yes", "@modelcontextprotocol/server-postgres", "{{DATABASE_URL}}"], requiredConfig: [{ envName: "DATABASE_URL", label: "Database URL", kind: "secret", required: true, sensitive: true }] } },
  { id: "plugin-1", kind: "plugin", name: "Brand Voice", slug: "brand-voice", description: "Brand extension", source_url: "https://github.com/addxiaoyi/studio", version: "1.0.0", license: null, manifest: { agentInstructions: "Use brand voice", toolAllowlist: [] } },
];

function setDesktopApi(value: unknown) {
  Object.defineProperty(window, "electronAPI", { configurable: true, value });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.session = { access_token: "test-token" };
  api.fetchAgentMarketplaceInstalls.mockResolvedValue([]);
  api.installMarketplaceSkill.mockResolvedValue({ skill: { id: "installed-skill-id" } });
  api.removeAgentMarketplaceInstall.mockResolvedValue(undefined);
  api.syncAgentMarketplaceInstall.mockResolvedValue(undefined);
  api.uninstallSkill.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: entries }) }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("Agent marketplace installs", () => {
  it("shows an inline error instead of crashing when the market response data is malformed", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { items: entries } }),
    } as Response);
    render(<AgentMarketplacePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("市场数据格式异常");
    expect(screen.queryByRole("heading", { name: "PostgreSQL MCP" })).not.toBeInTheDocument();
  });

  it("shows an inline error when the installed-items API returns a malformed list", async () => {
    api.fetchAgentMarketplaceInstalls.mockResolvedValue({ data: [] } as never);
    render(<AgentMarketplacePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("已安装列表格式异常");
    expect(screen.getByRole("heading", { name: "PostgreSQL MCP" })).toBeInTheDocument();
  });

  it("treats malformed manifest values as empty configuration", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ ...entries[1]!, manifest: null }] }),
    } as Response);
    const user = userEvent.setup();
    render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "PostgreSQL MCP" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /介绍/ }));

    expect(within(row!).getByText("配置项：无需额外配置。", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a semantic icon and expandable introduction for each listing", async () => {
    const user = userEvent.setup();
    const { container } = render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "Brand Voice" })).closest("article");
    expect(row?.querySelector(".agent-marketplace__icon svg")).not.toBeNull();
    expect(within(row!).getByText("Agent 插件")).toBeInTheDocument();
    expect(within(row!).getByText("作为工作区能力安装")).toBeInTheDocument();
    expect(within(row!).getByText("参照工作区品牌语气润色文案，同时保留事实和产品术语。")).toBeInTheDocument();
    await user.click(within(row!).getByRole("button", { name: /介绍/ }));
    expect(within(row!).getByText("Agent 使用指引")).toBeInTheDocument();
    expect(within(row!).getByText("先读取品牌套件，再修改文案并简述变化；保留事实、法律文本和产品术语。")).toBeInTheDocument();
    expect(container.querySelectorAll(".agent-marketplace__card")).toHaveLength(entries.length);
  });

  it("filters listings by their Chinese introduction text", async () => {
    render(<AgentMarketplacePage />);
    await screen.findByRole("heading", { name: "Frontend Design" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索市场" }), { target: { value: "响应式的产品界面" } });
    expect(await screen.findByRole("heading", { name: "Frontend Design" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "PostgreSQL MCP" })).not.toBeInTheDocument();
  });

  it("installs skills to the workspace and syncs their install record", async () => {
    const user = userEvent.setup();
    render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "Frontend Design" })).closest("article");
    expect(row).not.toBeNull();
    await user.click(within(row!).getByRole("button", { name: /安装/ }));
    await screen.findByRole("status");
    expect(api.installMarketplaceSkill).toHaveBeenCalledWith("test-token", entries[0]!.source_url);
    expect(api.syncAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "skill-1", { target: "workspace", skillId: "installed-skill-id" });
  });

  it("installs and connects a configured MCP locally before cloud-syncing metadata", async () => {
    const user = userEvent.setup();
    const desktopApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      getPendingMarketplaceInstall: vi.fn().mockResolvedValue(null),
      acknowledgeMarketplaceInstall: vi.fn().mockResolvedValue({ ok: true }),
      onMarketplaceInstallRequested: vi.fn().mockReturnValue(vi.fn()),
      installMarketplaceMcp: vi.fn().mockResolvedValue({ id: "local-mcp-1", servers: [] }),
      removeMcpServer: vi.fn().mockResolvedValue([]),
    };
    setDesktopApi(desktopApi);
    render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "PostgreSQL MCP" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /安装/ }));
    await user.type(await screen.findByLabelText("数据库连接地址 *"), "postgresql://localhost/test");
    await user.click(screen.getByRole("button", { name: /安装并连接/ }));
    expect(desktopApi.installMarketplaceMcp).toHaveBeenCalledWith(expect.objectContaining({
      name: "PostgreSQL MCP",
      config: { DATABASE_URL: "postgresql://localhost/test" },
    }));
    expect(api.syncAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "mcp-1", { target: "desktop", localInstalled: true, localServerName: "PostgreSQL MCP" });
  });

  it("opens the selected MCP setup when the desktop receives a website install request", async () => {
    let receiveRequest: ((slug: string) => void) | undefined;
    const desktopApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      getPendingMarketplaceInstall: vi.fn().mockResolvedValue(null),
      acknowledgeMarketplaceInstall: vi.fn().mockResolvedValue({ ok: true }),
      onMarketplaceInstallRequested: vi.fn((callback: (slug: string) => void) => {
        receiveRequest = callback;
        return vi.fn();
      }),
      installMarketplaceMcp: vi.fn(),
      removeMcpServer: vi.fn(),
    };
    setDesktopApi(desktopApi);
    render(<AgentMarketplacePage />);
    await screen.findByRole("heading", { name: "PostgreSQL MCP" });

    receiveRequest?.("postgres-mcp");

    expect(await screen.findByRole("heading", { name: "安装 PostgreSQL MCP" })).toBeInTheDocument();
    expect(desktopApi.getMcpServers).toHaveBeenCalled();
    expect(desktopApi.acknowledgeMarketplaceInstall).toHaveBeenCalledWith("postgres-mcp");
  });

  it("keeps a cold-start install request until the desktop login restores the session", async () => {
    auth.session = { access_token: null };
    const desktopApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      getPendingMarketplaceInstall: vi.fn().mockResolvedValue("postgres-mcp"),
      acknowledgeMarketplaceInstall: vi.fn().mockResolvedValue({ ok: true }),
      onMarketplaceInstallRequested: vi.fn().mockReturnValue(vi.fn()),
      installMarketplaceMcp: vi.fn(),
      removeMcpServer: vi.fn(),
    };
    setDesktopApi(desktopApi);
    const view = render(<AgentMarketplacePage />);
    await waitFor(() => expect(desktopApi.getPendingMarketplaceInstall).toHaveBeenCalled());
    expect(desktopApi.acknowledgeMarketplaceInstall).not.toHaveBeenCalled();
    expect(screen.queryByText("未找到该 MCP，市场内容可能已更新。请在桌面市场中重新选择。")).not.toBeInTheDocument();

    auth.session = { access_token: "test-token" };
    view.rerender(<AgentMarketplacePage />);

    expect(await screen.findByRole("heading", { name: "安装 PostgreSQL MCP" })).toBeInTheDocument();
    expect(desktopApi.acknowledgeMarketplaceInstall).toHaveBeenCalledWith("postgres-mcp");
  });

  it("keeps an installed MCP request pending while logged out, then syncs it after login", async () => {
    auth.session = { access_token: null };
    const desktopApi = {
      getMcpServers: vi.fn().mockResolvedValue([{ id: "local-mcp-1", name: "PostgreSQL MCP" }]),
      getPendingMarketplaceInstall: vi.fn().mockResolvedValue("postgres-mcp"),
      acknowledgeMarketplaceInstall: vi.fn().mockResolvedValue({ ok: true }),
      onMarketplaceInstallRequested: vi.fn().mockReturnValue(vi.fn()),
      installMarketplaceMcp: vi.fn(),
      removeMcpServer: vi.fn(),
    };
    setDesktopApi(desktopApi);
    const view = render(<AgentMarketplacePage />);
    await waitFor(() => expect(desktopApi.getPendingMarketplaceInstall).toHaveBeenCalled());
    expect(desktopApi.acknowledgeMarketplaceInstall).not.toHaveBeenCalled();
    expect(api.syncAgentMarketplaceInstall).not.toHaveBeenCalled();

    auth.session = { access_token: "test-token" };
    view.rerender(<AgentMarketplacePage />);

    expect(await screen.findByText("PostgreSQL MCP已安装在本机，安装状态已同步。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "安装 PostgreSQL MCP" })).not.toBeInTheDocument();
    expect(api.syncAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "mcp-1", {
      target: "desktop",
      localInstalled: true,
      localServerName: "PostgreSQL MCP",
    });
    expect(desktopApi.acknowledgeMarketplaceInstall).toHaveBeenCalledWith("postgres-mcp");
  });

  it("syncs an already-installed MCP without opening a second setup dialog", async () => {
    const desktopApi = {
      getMcpServers: vi.fn().mockResolvedValue([{ id: "local-mcp-1", name: "PostgreSQL MCP" }]),
      getPendingMarketplaceInstall: vi.fn().mockResolvedValue("postgres-mcp"),
      acknowledgeMarketplaceInstall: vi.fn().mockResolvedValue({ ok: true }),
      onMarketplaceInstallRequested: vi.fn().mockReturnValue(vi.fn()),
      installMarketplaceMcp: vi.fn(),
      removeMcpServer: vi.fn(),
    };
    setDesktopApi(desktopApi);
    render(<AgentMarketplacePage />);

    expect(await screen.findByText("PostgreSQL MCP已安装在本机，安装状态已同步。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "安装 PostgreSQL MCP" })).not.toBeInTheDocument();
    expect(desktopApi.installMarketplaceMcp).not.toHaveBeenCalled();
    expect(api.syncAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "mcp-1", {
      target: "desktop",
      localInstalled: true,
      localServerName: "PostgreSQL MCP",
    });
    expect(desktopApi.acknowledgeMarketplaceInstall).toHaveBeenCalledWith("postgres-mcp");
  });

  it("installs a declarative plugin as a workspace module without downloading executable code", async () => {
    const user = userEvent.setup();
    render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "Brand Voice" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /安装/ }));
    expect(api.syncAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "plugin-1", { target: "workspace" });
    expect(api.installMarketplaceSkill).not.toHaveBeenCalled();
  });

  it("shows the short checksum and copies the full hash of a published plugin", async () => {
    const digest = "8f43d2c1e9ab0123456789abcdef0123456789abcdef0123456789abcdef012345";
    const plugin = entries[2]!;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ ...plugin, manifest: { ...plugin.manifest, sha256: digest } }] }),
    } as Response);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<AgentMarketplacePage />);

    const row = (await screen.findByRole("heading", { name: "Brand Voice" })).closest("article");
    expect(within(row!).getByText("SHA-256 " + digest.slice(0, 12))).toBeInTheDocument();
    expect(within(row!).getByTitle(digest)).toBeInTheDocument();
    expect(within(row!).queryByText(digest)).not.toBeInTheDocument();

    fireEvent.click(within(row!).getByRole("button", { name: "复制 Brand Voice 的完整校验哈希" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(digest));
    expect(await screen.findByText("Brand Voice 的完整校验哈希已复制。")).toBeInTheDocument();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("states that no checksum is published when a listing omits it", async () => {
    render(<AgentMarketplacePage />);
    const row = (await screen.findByRole("heading", { name: "PostgreSQL MCP" })).closest("article");
    expect(within(row!).getByText("SHA-256 未提供")).toBeInTheDocument();
    expect(within(row!).queryByRole("button", { name: /完整校验哈希/ })).not.toBeInTheDocument();
  });

  it("warns about an installed plugin whose catalog listing was taken down and removes it on demand", async () => {
    const user = userEvent.setup();
    api.fetchAgentMarketplaceInstalls.mockResolvedValue([
      { item_id: "plugin-removed", target: "workspace", installed_version: "1.4.0", status: "installed", metadata: {}, kind: "plugin", name: "Old Brand Pack", slug: "old-brand-pack", available: false },
    ]);
    render(<AgentMarketplacePage />);
    await user.click(await screen.findByRole("tab", { name: /已安装/ }));

    const card = (await screen.findByText("该插件已下架，请更新或移除。")).closest("article");
    expect(within(card!).getByRole("heading", { name: "Old Brand Pack" })).toBeInTheDocument();
    expect(within(card!).getByText("v1.4.0")).toBeInTheDocument();
    expect(screen.queryByText("当前没有已安装条目。")).not.toBeInTheDocument();

    await user.click(within(card!).getByRole("button", { name: /移除/ }));
    await waitFor(() => expect(api.removeAgentMarketplaceInstall).toHaveBeenCalledWith("test-token", "plugin-removed"));
  });

  it("keeps install lists from older servers usable when the availability marker is absent", async () => {
    const user = userEvent.setup();
    api.fetchAgentMarketplaceInstalls.mockResolvedValue([
      { item_id: "plugin-1", target: "workspace", installed_version: "1.0.0", status: "installed", metadata: {}, kind: "plugin", name: "Brand Voice", slug: "brand-voice" },
    ]);
    render(<AgentMarketplacePage />);
    await user.click(await screen.findByRole("tab", { name: /已安装/ }));
    expect(await screen.findByRole("heading", { name: "Brand Voice" })).toBeInTheDocument();
    expect(screen.queryByText("该插件已下架，请更新或移除。")).not.toBeInTheDocument();
  });
});

describe("Agent marketplace feedback layer", () => {
  function renderWithToasts() {
    return render(
      <DesktopToastProvider>
        <AgentMarketplacePage />
      </DesktopToastProvider>,
    );
  }

  it("pushes a success toast naming the extension after a workspace install", async () => {
    const user = userEvent.setup();
    renderWithToasts();
    const row = (await screen.findByRole("heading", { name: "Frontend Design" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /安装/ }));

    const message = await screen.findByText("已安装 Frontend Design");
    expect(message.closest(".desktop-toast")).toHaveClass("desktop-toast--success");
  });

  it("pushes an error toast carrying the real install failure reason", async () => {
    const user = userEvent.setup();
    api.installMarketplaceSkill.mockRejectedValueOnce(new Error("技能源返回 404，未找到 SKILL.md"));
    renderWithToasts();
    const row = (await screen.findByRole("heading", { name: "Frontend Design" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /安装/ }));

    const message = await screen.findByText("安装 Frontend Design 失败：技能源返回 404，未找到 SKILL.md");
    expect(message.closest(".desktop-toast")).toHaveClass("desktop-toast--error");
    expect(message).not.toHaveTextContent("操作失败");
  });

  it("pushes a success toast after uninstalling an extension", async () => {
    const user = userEvent.setup();
    api.fetchAgentMarketplaceInstalls.mockResolvedValue([
      { item_id: "plugin-1", target: "workspace", installed_version: "1.0.0", status: "installed", metadata: {}, kind: "plugin", name: "Brand Voice", slug: "brand-voice" },
    ]);
    renderWithToasts();
    const row = (await screen.findByRole("heading", { name: "Brand Voice" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /卸载/ }));

    const message = await screen.findByText("已卸载 Brand Voice");
    expect(message.closest(".desktop-toast")).toHaveClass("desktop-toast--success");
  });

  it("pushes an error toast carrying the real uninstall failure reason", async () => {
    const user = userEvent.setup();
    api.fetchAgentMarketplaceInstalls.mockResolvedValue([
      { item_id: "plugin-1", target: "workspace", installed_version: "1.0.0", status: "installed", metadata: {}, kind: "plugin", name: "Brand Voice", slug: "brand-voice" },
    ]);
    api.removeAgentMarketplaceInstall.mockRejectedValueOnce(new Error("云端安装记录删除失败：504"));
    renderWithToasts();
    const row = (await screen.findByRole("heading", { name: "Brand Voice" })).closest("article");
    await user.click(within(row!).getByRole("button", { name: /卸载/ }));

    const message = await screen.findByText("卸载 Brand Voice 失败：云端安装记录删除失败：504");
    expect(message.closest(".desktop-toast")).toHaveClass("desktop-toast--error");
  });

  it("renders an empty-catalog state when the market returns no extensions", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);
    const { container } = renderWithToasts();

    expect(await screen.findByText("市场暂时没有可用扩展")).toBeInTheDocument();
    expect(container.querySelectorAll(".agent-marketplace__card")).toHaveLength(0);
  });

  it("renders a filtered-out state with a clear-filters action that restores the catalog", async () => {
    const user = userEvent.setup();
    renderWithToasts();
    await screen.findByRole("heading", { name: "Frontend Design" });
    fireEvent.change(screen.getByRole("textbox", { name: "搜索市场" }), { target: { value: "zzz-no-such-extension" } });

    expect(await screen.findByText("没有找到匹配的扩展")).toBeInTheDocument();
    expect(screen.queryByText("市场暂时没有可用扩展")).not.toBeInTheDocument();
    expect(screen.queryByText("还没有安装任何扩展")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空筛选" }));
    expect(await screen.findByRole("heading", { name: "Frontend Design" })).toBeInTheDocument();
    expect(screen.queryByText("没有找到匹配的扩展")).not.toBeInTheDocument();
  });

  it("renders a nothing-installed state whose action returns to discovery", async () => {
    const user = userEvent.setup();
    renderWithToasts();
    await user.click(await screen.findByRole("tab", { name: /已安装/ }));

    expect(await screen.findByText("还没有安装任何扩展")).toBeInTheDocument();
    expect(screen.queryByText("没有找到匹配的扩展")).not.toBeInTheDocument();
    expect(screen.queryByText("市场暂时没有可用扩展")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "去浏览市场" }));
    expect(await screen.findByRole("heading", { name: "Frontend Design" })).toBeInTheDocument();
    expect(screen.queryByText("还没有安装任何扩展")).not.toBeInTheDocument();
  });
});
