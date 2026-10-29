"use client";

import {
  Boxes,
  Cable,
  Check,
  ChevronDown,
  CircleAlert,
  Plug,
  Plus,
  SearchX,
  ShieldCheck,
  Trash2,
  Unplug,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { DesktopEmptyState } from "@/components/desktop-empty-state";
import { useDesktopToast } from "@/components/desktop-toast";
import {
  formatDesktopCopy,
  getDesktopCopy,
  useDesktopCopy,
  type DesktopCopy,
  type DesktopLocale,
} from "@/lib/desktop-copy";

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

/** 工具筛选维度：依据 MCP 工具 annotations 里真实存在的提示位判定。 */
export type ToolFilter = "all" | "readonly" | "side-effect";

export type ConnectionState = "connecting" | "connected" | "failed" | "idle";

const FAILURE_REASON_LIMIT = 60;

export function connectionStateOf(
  server: Pick<McpServer, "id" | "connected">,
  connectingId: string | null,
  failures: Record<string, string>,
): ConnectionState {
  if (connectingId === server.id) return "connecting";
  if (failures[server.id]) return "failed";
  return server.connected ? "connected" : "idle";
}

/** 失败原因压成一行短文案，避免 IPC 抛出的长堆栈撑爆卡片。 */
export function shortReason(
  message: string,
  copy: DesktopCopy["mcp"] = getDesktopCopy("zh-CN").mcp,
): string {
  const line = message
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) return copy.failureFallback;
  return line.length > FAILURE_REASON_LIMIT
    ? `${line.slice(0, FAILURE_REASON_LIMIT)}…`
    : line;
}

/**
 * 连接成功的文案：IPC 真的返回了该服务器就带上真实工具数；
 * 返回里取不到条目时只说「已连接」，不报一个编出来的数字。
 */
export function describeConnected(
  name: string,
  id: string,
  servers: unknown,
  copy: DesktopCopy["mcp"] = getDesktopCopy("zh-CN").mcp,
): string {
  const list = Array.isArray(servers) ? (servers as McpServer[]) : [];
  const target = list.find((item) => item.id === id);
  if (!target || !Array.isArray(target.tools))
    return formatDesktopCopy(copy.connected, { name });
  return formatDesktopCopy(copy.connectedWithCount, {
    name,
    count: target.tools.length,
  });
}

export function matchesToolFilter(tool: McpTool, filter: ToolFilter): boolean {
  if (filter === "all") return true;
  if (filter === "readonly") return tool.annotations?.readOnlyHint === true;
  return (
    tool.annotations?.destructiveHint === true ||
    tool.annotations?.readOnlyHint === false
  );
}

/** 搜索按名称/描述、大小写不敏感过滤；筛选先于搜索生效。 */
export function filterTools(
  tools: McpTool[],
  query: string,
  filter: ToolFilter,
): McpTool[] {
  const needle = query.trim().toLowerCase();
  return tools.filter((tool) => {
    if (!matchesToolFilter(tool, filter)) return false;
    if (!needle) return true;
    const name = tool.name.toLowerCase();
    const description = (tool.description ?? "").toLowerCase();
    return name.includes(needle) || description.includes(needle);
  });
}

export type RecommendedInstallEntry = {
  command: string;
  args: readonly string[];
  /** 以下字段在当前推荐条目类型里不存在，留作可选：未声明即渲染「未声明」。 */
  version?: string;
  permissions?: readonly string[];
  dependencies?: readonly string[];
};

/** 从 `@scope/pkg@version` 形态的启动参数里取版本说明符，取不到即视为未声明。 */
function versionFromArgs(args: readonly string[]): string | undefined {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    const at = arg.lastIndexOf("@");
    if (at > 0 && at < arg.length - 1) return arg.slice(at + 1);
  }
  return undefined;
}

/**
 * 安装前信息：版本/依赖来自真实字段 command + args（启动说明符），
 * 权限位在条目类型里没有对应字段，缺什么就渲染「未声明」，不编造。
 */
export function describeRecommendedInstall(
  entry: RecommendedInstallEntry,
  copy: DesktopCopy["mcp"] = getDesktopCopy("zh-CN").mcp,
): {
  version: string;
  permissions: string;
  dependencies: string;
} {
  const installArgs = [...entry.args];
  const version = entry.version ?? versionFromArgs(installArgs);
  const permissions = entry.permissions?.length
    ? entry.permissions.join(" · ")
    : undefined;
  const dependencies = entry.dependencies?.length
    ? entry.dependencies.join(" · ")
    : installArgs.length
      ? [entry.command, ...installArgs].join(" ")
      : undefined;
  return {
    version: version ? version : copy.undeclared,
    permissions: permissions ? permissions : copy.undeclared,
    dependencies: dependencies ? dependencies : copy.undeclared,
  };
}

const builtInToolNames = [
  "screen_observe",
  "screen_click",
  "screen_type",
  "screen_key",
  "screen_scroll",
  "screen_drag",
  "screen_wait_for_text",
  "screen_list_windows",
  "screen_focus_window",
  "screen_clipboard_read",
  "screen_clipboard_write",
  "screen_launch_app",
  "screen_close_app",
  "screen_find",
] as const;

const recommendedMcpServers = [
  {
    name: "Playwright MCP",
    command: "npx",
    args: ["@playwright/mcp@latest"],
    source: "https://github.com/microsoft/playwright-mcp",
  },
] as const;

function mcpApi() {
  return (window as Window & { electronAPI?: McpApi }).electronAPI;
}

export function DesktopMcpPanel({ locale }: { locale?: DesktopLocale | null } = {}) {
  const { copy } = useDesktopCopy(locale);
  const api = mcpApi();
  const toast = useDesktopToast();
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectFailures, setConnectFailures] = useState<
    Record<string, string>
  >({});
  const [toolQuery, setToolQuery] = useState("");
  const [toolFilter, setToolFilter] = useState<ToolFilter>("all");

  const refresh = useCallback(async () => {
    if (!api) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setServers(await api.getMcpServers());
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : copy.mcp.loadFailed,
      ),
    );
  }, [refresh]);

  async function addServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!acknowledged) throw new Error(copy.mcp.consentRequired);
      let parsedArgs: string[] = [];
      let parsedEnv: Record<string, string> = {};
      if (transport === "stdio") {
        parsedArgs = JSON.parse(args) as string[];
        parsedEnv = JSON.parse(env) as Record<string, string>;
        if (
          !Array.isArray(parsedArgs) ||
          parsedArgs.some((item) => typeof item !== "string")
        )
          throw new Error(copy.mcp.argsInvalid);
        if (
          !parsedEnv ||
          Array.isArray(parsedEnv) ||
          typeof parsedEnv !== "object" ||
          Object.values(parsedEnv).some((value) => typeof value !== "string")
        )
          throw new Error(copy.mcp.envInvalid);
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
      const created = await api.addMcpServer(input);
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
      toast.push({
        tone: "success",
        message: formatDesktopCopy(copy.mcp.addedToast, { name }),
        key: `mcp-add-ok:${created?.id ?? name}`,
      });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : copy.mcp.addFailed;
      setError(message);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.mcp.addFailToast, {
          reason: shortReason(message, copy.mcp),
        }),
        key: "mcp-add-fail",
      });
    } finally {
      setBusy(false);
    }
  }

  async function installRecommended(
    server: (typeof recommendedMcpServers)[number],
  ) {
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    let installedId: string | null = null;
    try {
      const installed = await api.addMcpServer({
        name: server.name,
        transport: "stdio",
        command: server.command,
        args: [...server.args],
        env: {},
      });
      installedId = installed.id;
      await api.connectMcpServer(installed.id);
      await refresh();
      toast.push({
        tone: "success",
        message: formatDesktopCopy(copy.mcp.installedToast, { name: server.name }),
        key: `mcp-install-ok:${installed.id}`,
      });
    } catch (cause) {
      // 首次连接失败视为安装失败：回滚已写入的本机配置，避免留下半安装条目。
      if (installedId) {
        try {
          await api.removeMcpServer(installedId);
        } catch {
          /* 回滚失败不覆盖原始安装错误 */
        }
      }
      const message =
        cause instanceof Error ? cause.message : copy.mcp.installFailed;
      setError(message);
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.mcp.installFailToast, {
          name: server.name,
          reason: shortReason(message, copy.mcp),
        }),
        key: `mcp-install-fail:${server.name}`,
      });
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
        formatDesktopCopy(copy.mcp.removeConfirm, { name: server.name }),
      )
    )
      return;
    setBusy(true);
    setError(null);
    if (action === "connect") {
      setConnectingId(server.id);
      setConnectFailures((current) => {
        if (!(server.id in current)) return current;
        const next = { ...current };
        delete next[server.id];
        return next;
      });
    }
    try {
      const next =
        action === "connect"
          ? await api.connectMcpServer(server.id)
          : action === "disconnect"
            ? await api.disconnectMcpServer(server.id)
            : await api.removeMcpServer(server.id);
      setServers(next);
      if (action === "remove" && selected?.id === server.id) setSelected(null);
      if (action === "remove") {
        setConnectFailures((current) => {
          if (!(server.id in current)) return current;
          const next = { ...current };
          delete next[server.id];
          return next;
        });
      }
      toast.push({
        tone: action === "connect" ? "success" : "info",
        message:
          action === "connect"
            ? // 工具数只在 IPC 真的返回了该服务器时才报，取不到就不报数字。
              describeConnected(server.name, server.id, next, copy.mcp)
            : action === "disconnect"
              ? formatDesktopCopy(copy.mcp.disconnectedToast, {
                  name: server.name,
                })
              : formatDesktopCopy(copy.mcp.removedToast, { name: server.name }),
        key: `mcp-${action}-ok:${server.id}`,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy.mcp.operationFailed;
      setError(message);
      // 连接失败只挂在本次服务器上，状态与重试按钮都由真实的 IPC 结果驱动。
      if (action === "connect") {
        setConnectFailures((current) => ({
          ...current,
          [server.id]: shortReason(message, copy.mcp),
        }));
      }
      toast.push({
        tone: "error",
        message: formatDesktopCopy(copy.mcp.actionFailToast, {
          name: server.name,
          action: copy.mcp.actions[action],
          reason: shortReason(message, copy.mcp),
        }),
        key: `mcp-${action}-fail:${server.id}`,
      });
    } finally {
      setBusy(false);
      if (action === "connect") setConnectingId(null);
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
      setError(cause instanceof Error ? cause.message : copy.mcp.toolCallFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!api)
    return (
      <p className="mcp-panel__empty">{copy.mcp.desktopOnly}</p>
    );

  return (
    <div className="mcp-panel">
      <header className="mcp-panel__heading">
        <div>
          <strong>{copy.mcp.heading}</strong>
          <span>{copy.mcp.headingMeta}</span>
        </div>
        <button
          type="button"
          aria-expanded={showForm}
          onClick={() => setShowForm((open) => !open)}
        >
          <Plus aria-hidden="true" />
          {showForm ? copy.mcp.close : copy.mcp.add}
        </button>
      </header>
      <details className="mcp-panel__privacy">
        <summary>
          <ShieldCheck aria-hidden="true" />
          {copy.mcp.privacyTitle}
          <ChevronDown aria-hidden="true" />
        </summary>
        <p>{copy.mcp.privacyBody}</p>
      </details>
      <section className="mcp-panel__market" aria-labelledby="mcp-market-title">
        <header>
          <div>
            <strong id="mcp-market-title">{copy.mcp.marketTitle}</strong>
            <span>{copy.mcp.marketMeta}</span>
          </div>
        </header>
        {recommendedMcpServers.map((server) => {
          const install = describeRecommendedInstall(server, copy.mcp);
          return (
            <article key={server.name}>
              <div>
                <strong>{server.name}</strong>
                <span>{copy.mcp.recommendedDescription}</span>
                <dl
                  className="mcp-panel__market-meta"
                  style={{ display: "grid", gap: 3, margin: 0 }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <dt>{copy.mcp.version}</dt>
                    <dd style={{ margin: 0 }}>{install.version}</dd>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <dt>{copy.mcp.permissions}</dt>
                    <dd style={{ margin: 0 }}>{install.permissions}</dd>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <dt>{copy.mcp.dependencies}</dt>
                    <dd style={{ margin: 0 }}>{install.dependencies}</dd>
                  </div>
                </dl>
                <a href={server.source} target="_blank" rel="noreferrer">
                  {copy.mcp.viewSource}
                </a>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void installRecommended(server)}
              >
                {copy.mcp.install}
              </button>
            </article>
          );
        })}
      </section>
      <details className="mcp-panel__builtins">
        <summary>
          <span>
            <strong>{copy.mcp.builtInsTitle}</strong>
            <small>{copy.mcp.builtInsMeta}</small>
          </span>
          <span className="mcp-panel__builtins-count">
            {formatDesktopCopy(copy.mcp.itemCount, { count: builtInToolNames.length })}
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <ul>
          {builtInToolNames.map((name) => (
            <li key={name}>
              <strong>{name}</strong>
              <span>{copy.mcp.builtInTools[name] ?? ""}</span>
            </li>
          ))}
        </ul>
        <p>{copy.mcp.builtInsHint}</p>
      </details>
      {error ? (
        <p className="mcp-panel__error" role="alert">
          <CircleAlert aria-hidden="true" />
          {error}
        </p>
      ) : null}
      {showForm ? (
        <form
          id="mcp-server-form"
          className="mcp-panel__form"
          onSubmit={(event) => void addServer(event)}
        >
          <label>
            {copy.mcp.form.name}
            <input
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            {copy.mcp.form.transport}
            <select
              value={transport}
              onChange={(event) =>
                setTransport(event.target.value as "stdio" | "http")
              }
            >
              <option value="stdio">{copy.mcp.form.transportStdio}</option>
              <option value="http">{copy.mcp.form.transportHttp}</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label>
                {copy.mcp.form.command}
                <input
                  required
                  placeholder={copy.mcp.form.commandPlaceholder}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
              <label>
                {copy.mcp.form.args}
                <textarea
                  rows={2}
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </label>
              <label>
                {copy.mcp.form.cwd}
                <input
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                />
              </label>
              <label>
                {copy.mcp.form.env}
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
                {copy.mcp.form.url}
                <input
                  required
                  type="url"
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label>
                {copy.mcp.form.token}
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
            <span>{copy.mcp.form.consent}</span>
          </label>
          <button type="submit" disabled={busy || !acknowledged}>
            <Check aria-hidden="true" />
            {copy.mcp.form.submit}
          </button>
        </form>
      ) : null}
      <section
        className="mcp-panel__local-services"
        aria-labelledby="mcp-local-services-title"
      >
        <header className="mcp-panel__section-heading">
          <div>
            <strong id="mcp-local-services-title">{copy.mcp.services.title}</strong>
            <span>{copy.mcp.services.meta}</span>
          </div>
          {!loading ? (
            <span>
              {formatDesktopCopy(copy.mcp.itemCount, { count: servers.length })}
            </span>
          ) : null}
        </header>
        <div
          className="mcp-panel__tool-filter"
          style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{copy.mcp.services.searchTools}</span>
            <input
              type="search"
              value={toolQuery}
              placeholder={copy.mcp.services.searchPlaceholder}
              onChange={(event) => setToolQuery(event.target.value)}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{copy.mcp.services.filter}</span>
            <select
              value={toolFilter}
              onChange={(event) =>
                setToolFilter(event.target.value as ToolFilter)
              }
            >
              <option value="all">{copy.mcp.services.filterAll}</option>
              <option value="readonly">{copy.mcp.services.filterReadonly}</option>
              <option value="side-effect">
                {copy.mcp.services.filterSideEffect}
              </option>
            </select>
          </label>
        </div>
        <div className="mcp-panel__servers" aria-busy={loading}>
          {loading ? (
            <p className="mcp-panel__empty" role="status">
              {copy.mcp.services.loading}
            </p>
          ) : servers.length ? (
            servers.map((server) => {
              const state = connectionStateOf(
                server,
                connectingId,
                connectFailures,
              );
              const visibleTools = filterTools(
                server.tools,
                toolQuery,
                toolFilter,
              );
              return (
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
                    <span
                      className={
                        state === "connected"
                          ? "is-connected"
                          : state === "failed"
                            ? "is-failed"
                            : ""
                      }
                    >
                      {copy.mcp.connection[state]}
                    </span>
                  </div>
                  {state === "failed" && connectFailures[server.id] ? (
                    <p className="mcp-panel__empty">
                      {connectFailures[server.id]}
                    </p>
                  ) : null}
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
                      {state === "connecting"
                        ? copy.mcp.services.connecting
                        : state === "failed"
                          ? copy.mcp.services.retryConnect
                          : server.connected
                            ? copy.mcp.services.disconnect
                            : copy.mcp.services.connect}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={formatDesktopCopy(copy.mcp.services.removeAria, {
                        name: server.name,
                      })}
                      onClick={() => void updateServer(server, "remove")}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </div>
                  {server.connected ? (
                    <div className="mcp-panel__tools">
                      {server.tools.length === 0 ? (
                        <DesktopEmptyState
                          icon={Wrench}
                          title={copy.mcp.empty.noToolsTitle}
                          description={copy.mcp.empty.noToolsBody}
                        />
                      ) : visibleTools.length === 0 ? (
                        <DesktopEmptyState
                          icon={SearchX}
                          title={copy.mcp.empty.noMatchTitle}
                          description={copy.mcp.empty.noMatchBody}
                          action={
                            <button
                              type="button"
                              onClick={() => {
                                setToolQuery("");
                                setToolFilter("all");
                              }}
                            >
                              {copy.mcp.empty.clearFilters}
                            </button>
                          }
                        />
                      ) : (
                        visibleTools.map((tool) => (
                          <div key={tool.name} className="mcp-panel__tool">
                            <div>
                              <strong>{tool.name}</strong>
                              <span>
                                {tool.description || copy.mcp.tool.noDescription}
                              </span>
                              {tool.annotations?.destructiveHint ? (
                                <small>{copy.mcp.tool.destructive}</small>
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
                                ? copy.mcp.tool.selected
                                : copy.mcp.tool.select}
                            </button>
                            {selected?.id === server.id &&
                            selected.tool === tool.name ? (
                              <div className="mcp-panel__call">
                                <textarea
                                  aria-label={formatDesktopCopy(
                                    copy.mcp.tool.argsAria,
                                    { name: tool.name },
                                  )}
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
                                  {busy ? copy.mcp.tool.running : copy.mcp.tool.call}
                                </button>
                                {output ? <pre>{output}</pre> : null}
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })
          ) : (
            <DesktopEmptyState
              icon={Boxes}
              title={copy.mcp.empty.noServersTitle}
              description={copy.mcp.empty.noServersBody}
              action={
                <button type="button" onClick={() => setShowForm(true)}>
                  {copy.mcp.empty.addFirst}
                </button>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
