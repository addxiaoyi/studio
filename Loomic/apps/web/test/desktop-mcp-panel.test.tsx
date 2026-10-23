import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopMcpPanel } from "@/components/desktop-mcp-panel";

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
});
