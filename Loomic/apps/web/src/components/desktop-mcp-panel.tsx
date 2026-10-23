"use client";

import {
  AlertTriangle,
  Cable,
  Check,
  CircleAlert,
  Plug,
  Plus,
  Trash2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type McpTool = {
  name: string;
  description?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
};
type McpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  url?: string;
  connected: boolean;
  tools: McpTool[];
};
type McpInput = {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  token?: string;
};
type McpApi = {
  getMcpServers: () => Promise<McpServer[]>;
  addMcpServer: (input: McpInput) => Promise<{ id: string }>;
  connectMcpServer: (id: string) => Promise<McpServer[]>;
  disconnectMcpServer: (id: string) => Promise<McpServer[]>;
  removeMcpServer: (id: string) => Promise<McpServer[]>;
  callMcpTool: (input: {
    id: string;
    name: string;
    arguments: string;
  }) => Promise<string>;
};

function mcpApi() {
  return (window as Window & { electronAPI?: McpApi }).electronAPI;
}

export function DesktopMcpPanel() {
  const api = mcpApi();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [cwd, setCwd] = useState("");
  const [env, setEnv] = useState("{}");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [selected, setSelected] = useState<{ id: string; tool: string } | null>(
    null,
  );
  const [toolArguments, setToolArguments] = useState("{}");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (api) setServers(await api.getMcpServers());
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : "无法读取 MCP 服务列表。",
      ),
    );
  }, [refresh]);

  async function addServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!acknowledged) throw new Error("请先确认该服务器的权限边界。");
      let parsedArgs: string[] = [];
      let parsedEnv: Record<string, string> = {};
      if (transport === "stdio") {
        parsedArgs = JSON.parse(args) as string[];
        parsedEnv = JSON.parse(env) as Record<string, string>;
        if (
          !Array.isArray(parsedArgs) ||
          parsedArgs.some((item) => typeof item !== "string")
        )
          throw new Error("启动参数必须是 JSON 字符串数组。");
        if (
          !parsedEnv ||
          Array.isArray(parsedEnv) ||
          typeof parsedEnv !== "object" ||
          Object.values(parsedEnv).some((value) => typeof value !== "string")
        )
          throw new Error("环境变量必须是 JSON 字符串对象。");
      }
      const input: McpInput =
        transport === "stdio"
          ? {
              name,
              transport,
              command,
              args: parsedArgs,
              ...(cwd ? { cwd } : {}),
              env: parsedEnv,
            }
          : { name, transport, url, ...(token ? { token } : {}) };
      await api.addMcpServer(input);
      setName("");
      setCommand("");
      setArgs("[]");
      setCwd("");
      setEnv("{}");
      setUrl("");
      setToken("");
      setAcknowledged(false);
      setShowForm(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加 MCP 服务。");
    } finally {
      setBusy(false);
    }
  }

  async function updateServer(
    server: McpServer,
    action: "connect" | "disconnect" | "remove",
  ) {
    if (!api || busy) return;
    if (
      action === "remove" &&
      !window.confirm(
        `移除 MCP 服务“${server.name}”？这会删除本机保存的连接配置。`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const next =
        action === "connect"
          ? await api.connectMcpServer(server.id)
          : action === "disconnect"
            ? await api.disconnectMcpServer(server.id)
            : await api.removeMcpServer(server.id);
      setServers(next);
      if (action === "remove" && selected?.id === server.id) setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MCP 操作失败。");
    } finally {
      setBusy(false);
    }
  }

  async function callTool(server: McpServer, tool: McpTool) {
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    setOutput("");
    try {
      setOutput(
        await api.callMcpTool({
          id: server.id,
          name: tool.name,
          arguments: toolArguments,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工具调用失败。");
    } finally {
      setBusy(false);
    }
  }

  if (!api)
    return (
      <p className="mcp-panel__empty">MCP 连接仅在 Helstera Desktop 中可用。</p>
    );

  return (
    <div className="mcp-panel">
      <header className="mcp-panel__heading">
        <div>
          <strong>Model Context Protocol</strong>
          <span>个人本机注册表 · stdio / Streamable HTTP</span>
        </div>
        <button type="button" onClick={() => setShowForm((open) => !open)}>
          <Plus aria-hidden="true" />
          {showForm ? "关闭表单" : "添加服务"}
        </button>
      </header>
      <div className="mcp-panel__warning">
        <AlertTriangle aria-hidden="true" />
        <span>
          Desktop chat Agents can use connected MCP tools on the next run.
          Selecting a local project also exposes scoped file, Git, and
          declared-script tools. Tool arguments and code actually read are sent
          to the active Helstera model. Connected MCP servers may cause external
          side effects; secrets stay encrypted locally and audit records omit
          arguments.
        </span>
      </div>
      {error ? (
        <p className="mcp-panel__error" role="alert">
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {showForm ? (
        <form
          className="mcp-panel__form"
          onSubmit={(event) => void addServer(event)}
        >
          <label>
            显示名称
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            连接方式
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.target.value as "stdio" | "http")
              }
            >
              <option value="stdio">本机进程 · stdio</option>
              <option value="http">远程 · Streamable HTTP</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label>
                可执行程序
                <input
                  required
                  placeholder="例如 npx 或 python"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
              <label>
                参数 JSON 数组
                <textarea
                  rows={2}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </label>
              <label>
                工作目录（可选）
                <input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
              </label>
              <label>
                环境变量 JSON 对象（凭据加密保存）
                <textarea
                  rows={3}
                  value={env}
                  onChange={(event) => setEnv(event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                HTTPS MCP 端点
                <input
                  required
                  type="url"
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label>
                Bearer Token（可选）
                <input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
            </>
          )}
          <label className="mcp-panel__consent">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              我信任此 MCP 服务。stdio 将以当前用户权限启动；连接后全部工具可被
              Agent
              调用，不会逐次确认。远程服务器可接收调用参数并产生外部副作用。
            </span>
          </label>
          <button type="submit" disabled={busy || !acknowledged}>
            <Check aria-hidden="true" />
            保存服务
          </button>
        </form>
      ) : null}
      <div className="mcp-panel__servers">
        {servers.length ? (
          servers.map((server) => (
            <article className="mcp-panel__server" key={server.id}>
              <div className="mcp-panel__server-head">
                <div>
                  <strong>{server.name}</strong>
                  <span>
                    {server.transport === "stdio" ? (
                      <>
                        <Cable aria-hidden="true" /> {server.command}
                      </>
                    ) : (
                      <>
                        <Plug aria-hidden="true" /> {server.url}
                      </>
                    )}
                  </span>
                </div>
                <span className={server.connected ? "is-connected" : ""}>
                  {server.connected ? "已连接" : "已停用"}
                </span>
              </div>
              <div className="mcp-panel__server-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void updateServer(
                      server,
                      server.connected ? "disconnect" : "connect",
                    )
                  }
                >
                  {server.connected ? (
                    <Unplug aria-hidden="true" />
                  ) : (
                    <Plug aria-hidden="true" />
                  )}
                  {server.connected ? "断开" : "连接并发现工具"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`移除 ${server.name}`}
                  onClick={() => void updateServer(server, "remove")}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
              {server.connected ? (
                <div className="mcp-panel__tools">
                  {server.tools.length ? (
                    server.tools.map((tool) => (
                      <div key={tool.name} className="mcp-panel__tool">
                        <div>
                          <strong>{tool.name}</strong>
                          <span>
                            {tool.description || "该工具未提供说明。"}
                          </span>
                          {tool.annotations?.destructiveHint ? (
                            <small>可能有破坏性</small>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected({ id: server.id, tool: tool.name });
                            setToolArguments("{}");
                            setOutput("");
                          }}
                        >
                          {selected?.id === server.id &&
                          selected.tool === tool.name
                            ? "已选中"
                            : "选择"}
                        </button>
                        {selected?.id === server.id &&
                        selected.tool === tool.name ? (
                          <div className="mcp-panel__call">
                            <textarea
                              aria-label={`${tool.name} 的 JSON 参数`}
                              value={toolArguments}
                              onChange={(event) =>
                                setToolArguments(event.target.value)
                              }
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void callTool(server, tool)}
                            >
                              {busy ? "执行中" : "调用工具"}
                            </button>
                            {output ? <pre>{output}</pre> : null}
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <p className="mcp-panel__empty">服务器未提供可调用工具。</p>
                  )}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="mcp-panel__empty">尚未添加 MCP 服务。</p>
        )}
      </div>
    </div>
  );
}
