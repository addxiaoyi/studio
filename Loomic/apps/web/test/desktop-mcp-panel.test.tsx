import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopMcpPanel,
  describeConnected,
  describeRecommendedInstall,
  filterTools,
  shortReason,
} from "@/components/desktop-mcp-panel";
import { DesktopToastProvider } from "@/components/desktop-toast";

type McpApi = {
  getMcpServers: () => Promise<unknown[]>;
  addMcpServer: (input: unknown) => Promise<{ id: string }>;
  connectMcpServer: (id: string) => Promise<unknown[]>;
  disconnectMcpServer: (id: string) => Promise<unknown[]>;
  removeMcpServer: (id: string) => Promise<unknown[]>;
  callMcpTool: (input: {
    id: string;
    name: string;
    arguments: string;
  }) => Promise<string>;
};

function setDesktopApi(api: McpApi | undefined) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: api,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

describe("DesktopMcpPanel", () => {
  it("keeps built-in tools collapsed while preserving the local service and install flows", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);

    render(<DesktopMcpPanel />);

    expect(await screen.findByText("内置电脑操作")).toBeTruthy();
    expect(screen.getByText("14 项")).toBeTruthy();
    const builtins = screen.getByText("内置电脑操作").closest("details");
    expect((builtins as HTMLDetailsElement).open).toBe(false);
    await user.click(screen.getByText("内置电脑操作"));
    expect((builtins as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText("screen_observe")).toBeTruthy();
    expect(screen.getByText("screen_find")).toBeTruthy();
    expect(screen.getByText("还没有添加 MCP 服务。")).toBeTruthy();
    expect(screen.getByText("Playwright MCP")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "安装" }));
    expect(api.addMcpServer).toHaveBeenCalledWith({
      name: "Playwright MCP",
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
      env: {},
    });
  });

  it("requires explicit trust confirmation before saving a server", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "server-1" }),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);
    await user.click(await screen.findByRole("button", { name: "添加服务" }));
    await user.type(screen.getByLabelText("显示名称"), "Local MCP");
    await user.type(screen.getByLabelText("可执行程序"), "node");

    expect(
      (screen.getByRole("button", { name: "保存服务" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByLabelText(/我信任此 MCP 服务/));
    await user.click(screen.getByRole("button", { name: "保存服务" }));

    expect(api.addMcpServer).toHaveBeenCalledWith({
      name: "Local MCP",
      transport: "stdio",
      command: "node",
      args: [],
      env: {},
    });
  });

  it("calls a discovered tool with JSON arguments and renders its response", async () => {
    const user = userEvent.setup();
    const server = {
      id: "server-1",
      name: "Local MCP",
      transport: "stdio" as const,
      command: "node",
      connected: true,
      tools: [{ name: "search", description: "Search a source" }],
    };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([server]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi
        .fn()
        .mockResolvedValue('{"content":[{"type":"text","text":"found"}]}'),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);
    await user.click(await screen.findByRole("button", { name: "选择" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "search 的 JSON 参数" }),
      {
        target: { value: '{"query":"MCP"}' },
      },
    );
    await user.click(screen.getByRole("button", { name: "调用工具" }));

    expect(api.callMcpTool).toHaveBeenCalledWith({
      id: "server-1",
      name: "search",
      arguments: '{"query":"MCP"}',
    });
    expect(await screen.findByText(/found/)).toBeTruthy();
  });

  it("rolls back the local entry when the recommended install cannot connect", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "mcp-half" }),
      connectMcpServer: vi.fn().mockRejectedValue(new Error("npx 启动失败")),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn().mockResolvedValue([]),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    await user.click(await screen.findByRole("button", { name: "安装" }));

    expect(api.connectMcpServer).toHaveBeenCalledWith("mcp-half");
    expect(api.removeMcpServer).toHaveBeenCalledWith("mcp-half");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "npx 启动失败",
    );
  });

  it("keeps the installed entry when the first connection succeeds", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "mcp-ok" }),
      connectMcpServer: vi.fn().mockResolvedValue([]),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn().mockResolvedValue([]),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    await user.click(await screen.findByRole("button", { name: "安装" }));

    expect(api.connectMcpServer).toHaveBeenCalledWith("mcp-ok");
    expect(api.removeMcpServer).not.toHaveBeenCalled();
  });

  it("shows 连接中 while the IPC connect is in flight and 已连接 once it resolves", async () => {
    const user = userEvent.setup();
    const pending: { resolve?: (servers: unknown[]) => void } = {};
    const idleServer = {
      id: "server-1",
      name: "Local MCP",
      transport: "stdio" as const,
      command: "node",
      connected: false,
      tools: [],
    };
    const liveServer = { ...idleServer, connected: true };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([idleServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(
        () =>
          new Promise<unknown[]>((resolve) => {
            pending.resolve = resolve;
          }),
      ),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    expect(await screen.findByText("已停用")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "连接并发现工具" }));

    expect(await screen.findByText("连接中")).toBeTruthy();
    expect(screen.queryByText("已连接")).toBeNull();

    await act(async () => {
      pending.resolve?.([liveServer]);
    });

    expect(await screen.findByText("已连接")).toBeTruthy();
    expect(screen.queryByText("连接中")).toBeNull();
  });

  it("renders 连接失败 with the real IPC reason and retries from the same button", async () => {
    const user = userEvent.setup();
    const idleServer = {
      id: "server-1",
      name: "Local MCP",
      transport: "stdio" as const,
      command: "node",
      connected: false,
      tools: [],
    };
    const liveServer = {
      ...idleServer,
      connected: true,
      tools: [{ name: "ping", description: "Ping the server" }],
    };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([idleServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi
        .fn()
        .mockRejectedValueOnce(new Error("spawn node ENOENT"))
        .mockResolvedValueOnce([liveServer]),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    await user.click(
      await screen.findByRole("button", { name: "连接并发现工具" }),
    );

    const card = (await screen.findByText("Local MCP")).closest(
      "article",
    ) as HTMLElement;
    expect(within(card).getByText("连接失败")).toBeTruthy();
    expect(within(card).getByText("spawn node ENOENT")).toBeTruthy();

    await user.click(within(card).getByRole("button", { name: "重试连接" }));

    expect(await screen.findByText("已连接")).toBeTruthy();
    expect(screen.queryByText("连接失败")).toBeNull();
    expect(api.connectMcpServer).toHaveBeenCalledTimes(2);
  });

  it("filters tools by name and description and shows an explicit empty state", async () => {
    const user = userEvent.setup();
    const server = {
      id: "server-1",
      name: "Local MCP",
      transport: "stdio" as const,
      command: "node",
      connected: true,
      tools: [
        {
          name: "search",
          description: "Search a source",
          annotations: { readOnlyHint: true },
        },
        {
          name: "write_file",
          description: "写入本地文件",
          annotations: { destructiveHint: true },
        },
        { name: "listNotes", description: "List notes" },
      ],
    };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([server]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    expect(await screen.findByText("search")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("listNotes")).toBeTruthy();

    const search = screen.getByLabelText("搜索工具");
    await user.type(search, "SEARCH");
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.queryByText("write_file")).toBeNull();
    expect(screen.queryByText("listNotes")).toBeNull();

    await user.clear(search);
    await user.type(search, "local file");
    expect(screen.queryByText("search")).toBeNull();
    expect(screen.queryByText("write_file")).toBeNull();

    await user.clear(search);
    await user.type(search, "not-exist");
    expect(screen.getByText("没有符合筛选条件的工具。")).toBeTruthy();
    expect(screen.queryByText("服务器未提供可调用工具。")).toBeNull();
  });

  it("splits tools into 只读 / 有副作用 by their annotations", async () => {
    const user = userEvent.setup();
    const server = {
      id: "server-1",
      name: "Local MCP",
      transport: "stdio" as const,
      command: "node",
      connected: true,
      tools: [
        {
          name: "search",
          description: "Search a source",
          annotations: { readOnlyHint: true },
        },
        {
          name: "write_file",
          description: "写入本地文件",
          annotations: { destructiveHint: true },
        },
        { name: "listNotes", description: "List notes" },
      ],
    };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([server]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    const filter = screen.getByLabelText("工具筛选");
    expect(await screen.findByText("search")).toBeTruthy();

    await user.selectOptions(filter, "side-effect");
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.queryByText("search")).toBeNull();
    expect(screen.queryByText("listNotes")).toBeNull();

    await user.selectOptions(filter, "readonly");
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.queryByText("write_file")).toBeNull();

    await user.selectOptions(filter, "all");
    expect(screen.getByText("search")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.getByText("listNotes")).toBeTruthy();
  });

  it("renders pre-install version, permissions and dependencies from real fields", async () => {
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    render(<DesktopMcpPanel />);

    expect(await screen.findByText("Playwright MCP")).toBeTruthy();
    expect(screen.getByText("版本")).toBeTruthy();
    expect(screen.getByText("权限")).toBeTruthy();
    expect(screen.getByText("依赖")).toBeTruthy();
    expect(screen.getByText("latest")).toBeTruthy();
    expect(screen.getByText("npx @playwright/mcp@latest")).toBeTruthy();
    // 权限位在推荐条目类型里没有对应字段，必须显式「未声明」而不是空白。
    expect(screen.getAllByText("未声明")).toHaveLength(1);
  });

  it("keeps 未声明 for every field a recommended entry does not declare", () => {
    expect(describeRecommendedInstall({ command: "node", args: [] })).toEqual({
      version: "未声明",
      permissions: "未声明",
      dependencies: "未声明",
    });
    expect(
      describeRecommendedInstall({
        command: "npx",
        args: ["@playwright/mcp@latest"],
        permissions: ["filesystem:read"],
        dependencies: ["@playwright/mcp"],
      }),
    ).toEqual({
      version: "latest",
      permissions: "filesystem:read",
      dependencies: "@playwright/mcp",
    });
    expect(
      filterTools(
        [
          { name: "Read_File", annotations: { readOnlyHint: true } },
          { name: "delete_file", annotations: { destructiveHint: true } },
        ],
        "read",
        "readonly",
      ).map((tool) => tool.name),
    ).toEqual(["Read_File"]);
    expect(shortReason("spawn node ENOENT\nat foo")).toBe("spawn node ENOENT");
  });
});

function renderPanel() {
  return render(
    <DesktopToastProvider>
      <DesktopMcpPanel />
    </DesktopToastProvider>,
  );
}

function toastElementFor(message: string): HTMLElement {
  const element = screen.getByText(message).closest(".desktop-toast");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

const idleServer = {
  id: "server-1",
  name: "Local MCP",
  transport: "stdio" as const,
  command: "node",
  connected: false,
  tools: [] as { name: string; description?: string }[],
};

const liveServer = {
  ...idleServer,
  connected: true,
  tools: [{ name: "ping", description: "Ping the server" }],
};

describe("DesktopMcpPanel 统一反馈层", () => {
  it("pushes a success toast with the real discovered tool count on connect", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([idleServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn().mockResolvedValue([liveServer]),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "连接并发现工具" }),
    );

    const toast = toastElementFor("Local MCP 已连接，发现 1 个工具");
    expect(toast.className).toContain("desktop-toast--success");
    // 反证：成功路径不能出 error 文案。
    expect(document.querySelector(".desktop-toast--error")).toBeNull();
  });

  it("pushes an error toast carrying the real IPC reason when connect fails", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([idleServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi
        .fn()
        .mockRejectedValue(new Error("spawn node ENOENT\n    at Object.<anonymous>")),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "连接并发现工具" }),
    );

    const toast = toastElementFor("Local MCP 连接失败：spawn node ENOENT");
    expect(toast.className).toContain("desktop-toast--error");
    // 反证：文案里必须带真实原因，不能是笼统的「操作失败」。
    expect(toast.textContent).toContain("spawn node ENOENT");
    expect(document.querySelector(".desktop-toast--success")).toBeNull();
  });

  it("pushes an info toast when a server is disconnected", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([liveServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn().mockResolvedValue([idleServer]),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    await user.click(await screen.findByRole("button", { name: "断开" }));

    const toast = toastElementFor("Local MCP 已断开连接");
    expect(toast.className).toContain("desktop-toast--info");
    expect(document.querySelector(".desktop-toast--success")).toBeNull();
  });

  it("pushes feedback for both a finished and a failed recommended install", async () => {
    const user = userEvent.setup();
    const okApi: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "mcp-ok" }),
      connectMcpServer: vi.fn().mockResolvedValue([]),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn().mockResolvedValue([]),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(okApi);
    const first = renderPanel();
    await user.click(await screen.findByRole("button", { name: "安装" }));
    expect(
      toastElementFor("Playwright MCP 安装完成并已连接").className,
    ).toContain("desktop-toast--success");
    first.unmount();

    const failApi: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "mcp-half" }),
      connectMcpServer: vi.fn().mockRejectedValue(new Error("npx 启动失败")),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn().mockResolvedValue([]),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(failApi);
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "安装" }));

    expect(
      toastElementFor("Playwright MCP 安装失败：npx 启动失败").className,
    ).toContain("desktop-toast--error");
    // 反证：安装失败必须回滚并留下错误反馈，不能报成功。
    expect(failApi.removeMcpServer).toHaveBeenCalledWith("mcp-half");
    expect(document.querySelector(".desktop-toast--success")).toBeNull();
  });

  it("pushes an info toast after a confirmed removal", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([liveServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn().mockResolvedValue([]),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    await user.click(
      await screen.findByRole("button", { name: "移除 Local MCP" }),
    );

    expect(toastElementFor("Local MCP 已移除").className).toContain(
      "desktop-toast--info",
    );
    confirm.mockRestore();
  });

  it("pushes feedback when a manually configured server is saved or rejected", async () => {
    const user = userEvent.setup();
    const okApi: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn().mockResolvedValue({ id: "manual-1" }),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(okApi);
    const first = renderPanel();
    await user.click(await screen.findByRole("button", { name: "添加服务" }));
    await user.type(screen.getByLabelText("显示名称"), "Local MCP");
    await user.type(screen.getByLabelText("可执行程序"), "node");
    await user.click(screen.getByLabelText(/我信任此 MCP 服务/));
    await user.click(screen.getByRole("button", { name: "保存服务" }));

    expect(toastElementFor("已添加 Local MCP").className).toContain(
      "desktop-toast--success",
    );
    first.unmount();

    const failApi: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi
        .fn()
        .mockRejectedValue(new Error("找不到可执行程序 python3.11")),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(failApi);
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "添加服务" }));
    await user.type(screen.getByLabelText("显示名称"), "Bad MCP");
    await user.type(screen.getByLabelText("可执行程序"), "python3.11");
    await user.click(screen.getByLabelText(/我信任此 MCP 服务/));
    await user.click(screen.getByRole("button", { name: "保存服务" }));

    expect(
      toastElementFor("添加服务失败：找不到可执行程序 python3.11").className,
    ).toContain("desktop-toast--error");
  });

  it("never states a tool count the IPC did not return", () => {
    expect(describeConnected("Local MCP", "server-1", [])).toBe(
      "Local MCP 已连接",
    );
    expect(describeConnected("Local MCP", "server-1", undefined)).toBe(
      "Local MCP 已连接",
    );
    expect(
      describeConnected("Local MCP", "server-1", [
        { id: "server-2", tools: [{ name: "other" }] },
      ]),
    ).toBe("Local MCP 已连接");
    expect(
      describeConnected("Local MCP", "server-1", [
        { id: "server-1", tools: [{ name: "a" }, { name: "b" }] },
      ]),
    ).toBe("Local MCP 已连接，发现 2 个工具");
  });
});

describe("DesktopMcpPanel 共享空态", () => {
  it("renders the shared empty state, not a bare paragraph, when no server is installed", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    const title = await screen.findByText("还没有添加 MCP 服务。");
    expect(title.closest(".desktop-empty-state")).not.toBeNull();
    // 反证：旧的裸段落样式已退役，不能两套并存。
    expect(document.querySelector(".mcp-panel__empty")).toBeNull();

    // 空态里的动作必须真的能推进流程。
    expect(screen.queryByRole("button", { name: "保存服务" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "添加第一个服务" }));
    expect(
      await screen.findByRole("button", { name: "保存服务" }),
    ).toBeTruthy();
  });

  it("renders the shared empty state when a connected server exposes no tools", async () => {
    const emptyTools = { ...liveServer, tools: [] };
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([emptyTools]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    const title = await screen.findByText("服务器未提供可调用工具。");
    expect(title.closest(".desktop-empty-state")).not.toBeNull();
    expect(document.querySelector(".mcp-panel__empty")).toBeNull();
  });

  it("renders the same shared empty state for a no-match tool search and clears it from the action", async () => {
    const user = userEvent.setup();
    const api: McpApi = {
      getMcpServers: vi.fn().mockResolvedValue([liveServer]),
      addMcpServer: vi.fn(),
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      callMcpTool: vi.fn(),
    };
    setDesktopApi(api);
    renderPanel();

    expect(await screen.findByText("ping")).toBeTruthy();
    await user.type(screen.getByLabelText("搜索工具"), "no-such-tool");

    const title = screen.getByText("没有符合筛选条件的工具。");
    expect(title.closest(".desktop-empty-state")).not.toBeNull();
    expect(document.querySelector(".mcp-panel__empty")).toBeNull();

    await user.click(screen.getByRole("button", { name: "清除搜索与筛选" }));

    expect(screen.getByText("ping")).toBeTruthy();
    expect(screen.queryByText("没有符合筛选条件的工具。")).toBeNull();
    expect((screen.getByLabelText("搜索工具") as HTMLInputElement).value).toBe(
      "",
    );
  });
});
