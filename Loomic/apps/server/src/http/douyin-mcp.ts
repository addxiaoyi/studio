import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { ServerEnv } from "../config/env.js";
import { DouyinMcpClient, DouyinMcpError } from "../features/douyin/douyin-mcp-client.js";
import { DouyinCredentialError, DouyinCredentialManager } from "../features/douyin/douyin-credentials.js";

type DouyinMcpOptions = {
  auth: RequestAuthenticator;
  db: Pool;
  env: ServerEnv;
  viewerService: ViewerService;
  credentials: DouyinCredentialManager;
};

const jumpTools = {
  live: "/api/douyin/v1/schema/get_live",
  profile: "/api/douyin/v1/schema/get_user_profile",
  item: "/api/douyin/v1/schema/get_item_info",
} as const;

type JumpKind = keyof typeof jumpTools;

export function registerDouyinMcpRoutes(app: FastifyInstance, options: DouyinMcpOptions): void {
  const requireAdmin = async (request: any, reply: any) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      await reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
      return null;
    }
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query("select system_role from app_users where id=$1", [user.id]);
    if (rows[0]?.system_role !== "admin") {
      await reply.code(403).send({ ok: false, error: { code: "forbidden", message: "System administrator role required" } });
      return null;
    }
    return { user, viewer };
  };

  app.get("/api/admin/douyin-mcp/status", async (request: any, reply) => {
    const session = await requireAdmin(request, reply);
    if (!session) return;
    return {
      ok: true,
      data: {
        configured: options.credentials.isConfigured(),
        serverUrl: options.env.douyinMcpServerUrl,
        toolGroupAid: options.env.douyinMcpToolGroupAid ?? null,
        allowedTools: options.env.douyinMcpAllowedTools,
        mode: "server_side_sse",
        credentials: options.credentials.status(),
      },
    };
  });

  app.get("/api/admin/douyin-mcp/tools", async (request: any, reply) => {
    const session = await requireAdmin(request, reply);
    if (!session) return;
    let client: DouyinMcpClient | undefined;
    try {
      client = await createClient(options);
      const result = await client.listTools();
      const tools = Array.isArray(result.tools) ? result.tools : [];
      const filtered = options.env.douyinMcpAllowedTools.length
        ? tools.filter((tool: any) => options.env.douyinMcpAllowedTools.includes(String(tool.name)))
        : tools;
      return { ok: true, data: { tools: filtered, total: filtered.length, checkedAt: new Date().toISOString() } };
    } catch (error) {
      return reply.code(502).send({ ok: false, error: { code: errorCode(error, "douyin_mcp_unavailable"), message: error instanceof Error ? error.message : "Douyin MCP unavailable", retryable: true } });
    } finally {
      client?.close();
    }
  });

  app.post("/api/admin/douyin-mcp/call", async (request: any, reply) => {
    const session = await requireAdmin(request, reply);
    if (!session) return;
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const args = request.body?.arguments;
    if (!name || !args || typeof args !== "object" || Array.isArray(args)) {
      return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "name and object arguments are required" } });
    }
    if (!options.env.douyinMcpAllowedTools.includes(name)) {
      return reply.code(403).send({ ok: false, error: { code: "tool_not_allowed", message: "The requested Douyin MCP tool is not allowlisted" } });
    }
    let client: DouyinMcpClient | undefined;
    try {
      client = await createClient(options);
      return { ok: true, data: await client.callTool(name, args) };
    } catch (error) {
      return reply.code(502).send({ ok: false, error: { code: errorCode(error, "douyin_mcp_call_failed"), message: error instanceof Error ? error.message : "Douyin MCP call failed", retryable: true } });
    } finally {
      client?.close();
    }
  });

  app.post("/api/feed/douyin/jump-link", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const kind = request.body?.kind as JumpKind;
    const value = typeof request.body?.value === "string" ? request.body.value.trim() : "";
    if (!(kind in jumpTools) || !value) return reply.code(400).send({ ok: false, error: { code: "invalid_input", message: "kind and value are required" } });
    const toolName = jumpTools[kind];
    if (!options.env.douyinMcpAllowedTools.includes(toolName)) return reply.code(403).send({ ok: false, error: { code: "tool_not_allowed", message: "This Douyin jump-link tool is not allowlisted" } });
    const args: Record<string, unknown> = { expire_at: Math.floor(Date.now() / 1000) + 10 * 60 * 60 };
    if (kind === "item") args.item_id = value;
    else if (kind === "profile") args.account = value;
    else args.account = value;
    let client: DouyinMcpClient | undefined;
    try {
      client = await createClient(options);
      const result = await client.callTool(toolName, args);
      const url = findHttpUrl(result);
      if (!url) return reply.code(502).send({ ok: false, error: { code: "douyin_link_missing", message: "Douyin did not return a jump URL", retryable: true } });
      return { ok: true, data: { kind, url, expiresAt: args.expire_at, manualOnly: true } };
    } catch (error) {
      return reply.code(502).send({ ok: false, error: { code: errorCode(error, "douyin_mcp_call_failed"), message: error instanceof Error ? error.message : "Douyin MCP call failed", retryable: true } });
    } finally {
      client?.close();
    }
  });
}

async function createClient(options: DouyinMcpOptions): Promise<DouyinMcpClient> {
  const token = await options.credentials.getClientToken();
  return new DouyinMcpClient({
    serverUrl: options.env.douyinMcpServerUrl,
    token,
    ...(options.env.douyinMcpToolGroupAid ? { toolGroupAid: options.env.douyinMcpToolGroupAid } : {}),
  });
}

function errorCode(error: unknown, fallback: string): string {
  if (error instanceof DouyinMcpError || error instanceof DouyinCredentialError) return error.code;
  return fallback;
}

function findHttpUrl(value: unknown): string | null {
  if (typeof value === "string") return value.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findHttpUrl(item);
      if (url) return url;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const url = findHttpUrl(item);
      if (url) return url;
    }
  }
  return null;
}
