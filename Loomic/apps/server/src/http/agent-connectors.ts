import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";

import type { AgentConnector } from "@helstera/shared";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

type ConnectorRouteOptions = {
  db: Pool;
  auth: RequestAuthenticator;
  viewerService: ViewerService;
  assistantHub?: { isDesktopReady(userId: string, workspaceId: string): boolean };
};

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Authentication required." } });
}

const builtInConnectors: AgentConnector[] = [
  { id: "canvas", name: "Canvas", description: "Read and update the active canvas.", kind: "canvas", capabilities: ["canvas.read", "canvas.write"], permissions: ["canvas.current"], status: "available", supportsBackground: true, supportsDesktop: true, requiresApproval: false, enabled: true },
  { id: "local-files", name: "Local files", description: "Save and inspect files in the user-selected local folder.", kind: "local_files", capabilities: ["files.read", "files.write"], permissions: ["folder.selected"], status: "needs_permission", supportsBackground: false, supportsDesktop: true, requiresApproval: true, enabled: false },
  { id: "isolated-browser", name: "Isolated browser", description: "Browse public websites in a server-side isolated session.", kind: "browser", capabilities: ["browser.read", "browser.navigate", "browser.capture"], permissions: [], status: "available", supportsBackground: true, supportsDesktop: false, requiresApproval: false, enabled: true },
  { id: "desktop-agent", name: "Desktop Agent", description: "Operate authorized desktop windows and browser tabs.", kind: "desktop", capabilities: ["screen.read", "window.focus"], permissions: ["desktop.connected"], status: "disconnected", supportsBackground: false, supportsDesktop: true, requiresApproval: true, enabled: false },
  { id: "media-generation", name: "Media generation", description: "Create image and video drafts with visible cost and approval.", kind: "media", capabilities: ["image.generate", "video.generate"], permissions: ["generation.approval"], status: "available", supportsBackground: true, supportsDesktop: false, requiresApproval: true, enabled: true },
];

const builtInConnectorIds = new Set(builtInConnectors.map((connector) => connector.id));

export function registerAgentConnectorRoutes(app: FastifyInstance, options: ConnectorRouteOptions) {
  app.get("/api/agent/connectors", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    const permissions = await options.db.query<{ connector_id: string; enabled: boolean; permissions: string[] }>(
      "select connector_id,enabled,permissions from agent_connector_permissions where workspace_id=$1 and user_id=$2",
      [viewer.workspace.id, user.id],
    );
    const permissionMap = new Map(permissions.rows.map((row) => [row.connector_id, row]));
    const connectors: AgentConnector[] = builtInConnectors.map((connector) => {
      const permission = permissionMap.get(connector.id);
      // A stored preference is not proof that the device or local folder is ready.
      const configured = permission ? { ...connector, enabled: permission.enabled, permissions: permission.permissions } : connector;
      return configured.id === "desktop-agent" && configured.enabled && options.assistantHub?.isDesktopReady(user.id, viewer.workspace.id)
        ? { ...configured, status: "connected" }
        : configured;
    });

    const installed = await options.db.query<{ id: string; name: string; description: string; kind: "mcp" | "skill" | "plugin"; metadata: Record<string, unknown> | null }>(
      `select i.id,i.name,i.description,i.kind,a.metadata
         from agent_marketplace_installs a
         join agent_marketplace_items i on i.id=a.item_id and i.status='published'
        where a.workspace_id=$1 and a.user_id=$2 and a.status='installed' and a.target in ('workspace','desktop')
        order by i.name`,
      [viewer.workspace.id, user.id],
    );
    for (const item of installed.rows) {
      const id = `marketplace:${item.id}`;
      const enabled = item.metadata?.enabled !== false;
      connectors.push({
        id,
        name: item.name,
        description: item.description,
        kind: item.kind,
        capabilities: item.kind === "mcp" ? ["mcp.tools"] : [item.kind === "skill" ? "agent.guidance" : "agent.guidance"],
        permissions: item.kind === "mcp" ? ["mcp.approved"] : [],
        status: enabled ? "available" : "disconnected",
        supportsBackground: item.kind !== "mcp",
        supportsDesktop: item.kind === "mcp",
        requiresApproval: item.kind === "mcp",
        enabled,
      });
    }
    return { ok: true, data: connectors };
  });

  app.patch<{ Params: { connectorId: string } }>("/api/agent/connectors/:connectorId", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return unauthorized(reply);
    const viewer = await options.viewerService.ensureViewer(user);
    if (!builtInConnectorIds.has(request.params.connectorId)) {
      return reply.code(404).send({ ok: false, error: { code: "connector_not_found", message: "Connector not found." } });
    }
    const body = request.body as { enabled?: unknown; permissions?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean") return reply.code(400).send({ ok: false, error: { code: "connector_update_invalid", message: "enabled must be a boolean." } });
    const connector = builtInConnectors.find((entry) => entry.id === request.params.connectorId)!;
    const permissions: unknown = body.permissions ?? [];
    if (!Array.isArray(permissions) || permissions.length > 32 || permissions.some((value) => typeof value !== "string" || !connector.permissions.includes(value))) {
      return reply.code(400).send({ ok: false, error: { code: "connector_permissions_invalid", message: "Only the connector's declared permissions can be requested." } });
    }
    const { rows } = await options.db.query(
      `insert into agent_connector_permissions(id,workspace_id,user_id,connector_id,enabled,permissions)
       values($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (workspace_id,user_id,connector_id)
       do update set enabled=excluded.enabled,permissions=excluded.permissions,updated_at=now()
       returning connector_id,enabled,permissions`,
      [randomUUID(), viewer.workspace.id, user.id, request.params.connectorId, body.enabled, JSON.stringify(permissions)],
    );
    return { ok: true, data: rows[0] };
  });
}
