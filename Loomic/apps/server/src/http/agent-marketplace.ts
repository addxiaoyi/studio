import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { RequestAuthenticator } from "../auth/types.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

type MarketplaceKind = "skill" | "mcp" | "plugin";
type MarketplaceStatus = "draft" | "published" | "hidden";
type Options = { auth: RequestAuthenticator; db: Pool; viewerService: ViewerService };
type Admin = { id: string; workspaceId: string };
type VersionInput = { version?: unknown; sourceUrl?: unknown; license?: unknown; manifest?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeSlug(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

function validSourceUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["github.com", "www.npmjs.com", "registry.npmjs.org"].includes(url.hostname);
  } catch { return false; }
}

function validManifest(value: unknown) {
  return isRecord(value) && Buffer.byteLength(JSON.stringify(value), "utf8") <= 64_000;
}

function includesCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(includesCredentialField);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    /token|secret|password|authorization|headers?|api[_-]?key|environment|^env$/i.test(key)
    || includesCredentialField(child),
  );
}

function publishedManifest(kind: MarketplaceKind, value: unknown): Record<string, unknown> | null {
  if (!validManifest(value)) return null;
  const allowed = kind === "mcp"
    ? new Set(["transport", "command", "args", "url", "catalog", "requiredConfig"])
    : kind === "plugin"
      ? new Set(["downloadUrl", "downloadName", "sha256", "platforms", "agentInstructions", "toolAllowlist"])
      : new Set(["source", "path", "readmeUrl"]);
  const source = value as Record<string, unknown>;
  const manifest = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
  if (kind === "mcp") {
    const requiredConfig = manifest.requiredConfig;
    if (requiredConfig !== undefined && (!Array.isArray(requiredConfig) || requiredConfig.length > 12 || requiredConfig.some((entry) => {
      if (!isRecord(entry)) return true;
      return typeof entry.envName !== "string" || !/^[A-Z_][A-Z0-9_]{0,79}$/.test(entry.envName)
        || typeof entry.label !== "string" || entry.label.length > 120
        || !["text", "secret", "directory"].includes(String(entry.kind))
        || typeof entry.required !== "boolean"
        || typeof entry.sensitive !== "boolean";
    }))) return null;
    if (manifest.transport === "stdio") {
      if (typeof manifest.command !== "string" || !manifest.command.trim() || manifest.command.length > 512) return null;
      if (!Array.isArray(manifest.args) || manifest.args.length > 32 || manifest.args.some((arg) => typeof arg !== "string" || arg.length > 4_096)) return null;
    } else if (manifest.transport === "http") {
      if (typeof manifest.url !== "string") return null;
      try { const url = new URL(manifest.url); if (url.protocol !== "https:" || url.username || url.password) return null; } catch { return null; }
    } else if (manifest.catalog !== true) return null;
  }
  if (kind === "plugin") {
    if (typeof manifest.agentInstructions !== "string" || !manifest.agentInstructions.trim() || manifest.agentInstructions.length > 8_000) return null;
    if (!Array.isArray(manifest.toolAllowlist) || manifest.toolAllowlist.length > 32 || manifest.toolAllowlist.some((tool) => typeof tool !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(tool))) return null;
  }
  if (kind === "plugin" && manifest.downloadUrl !== undefined) {
    if (typeof manifest.downloadUrl !== "string") return null;
    try { if (new URL(manifest.downloadUrl).protocol !== "https:") return null; } catch { return null; }
  }
  return manifest;
}

/**
 * #88: an installed record can outlive its catalog entry. Only published listings stay
 * installable, so a hidden or removed listing is reported as unavailable instead of
 * silently vanishing from the client's installed list.
 */
export function isMarketplaceItemAvailable(status: unknown): boolean {
  return status === "published";
}

async function requireAdmin(options: Options, request: any, reply: any): Promise<Admin | null> {
  const user = await options.auth.authenticate(request);
  if (!user) { await reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } }); return null; }
  const { rows } = await options.db.query<{ system_role: string; workspace_id: string | null }>(
    "select u.system_role, (select workspace_id from workspace_members where user_id=u.id order by created_at limit 1) as workspace_id from app_users u where u.id=$1",
    [user.id],
  );
  if (rows[0]?.system_role !== "admin") { await reply.code(403).send({ ok: false, error: { code: "forbidden", message: "System administrator role required" } }); return null; }
  if (!rows[0].workspace_id) { await reply.code(409).send({ ok: false, error: { code: "admin_workspace_required", message: "The administrator must belong to a workspace for audit logging." } }); return null; }
  return { id: user.id, workspaceId: rows[0].workspace_id };
}

async function writeAudit(db: Pool | PoolClient, admin: Admin, action: string, itemId: string, state: unknown) {
  await db.query(
    "insert into admin_audit_logs(workspace_id,actor_id,action,target_type,target_id,after_state) values($1,$2,$3,'agent_marketplace_item',$4,$5)",
    [admin.workspaceId, admin.id, action, itemId, JSON.stringify(state)],
  );
}

async function insertVersion(client: PoolClient, admin: Admin, itemId: string, input: VersionInput) {
  if (typeof input.version !== "string" || !input.version.trim() || input.version.length > 80) throw new Error("Version must be 1-80 characters.");
  if (!validSourceUrl(input.sourceUrl)) throw new Error("Source URL must use HTTPS and point to GitHub or npm.");
  if (input.license !== undefined && input.license !== null && (typeof input.license !== "string" || input.license.length > 120)) throw new Error("License identifier is invalid.");
  const manifest = input.manifest === undefined ? {} : input.manifest;
  if (!validManifest(manifest)) throw new Error("Manifest must be an object smaller than 64 KB.");
  const { rows } = await client.query(
    "insert into agent_marketplace_versions(item_id,version,source_url,license,manifest,created_by) values($1,$2,$3,$4,$5,$6) returning *",
    [itemId, input.version.trim(), input.sourceUrl, input.license ?? null, JSON.stringify(manifest), admin.id],
  );
  await client.query("update agent_marketplace_items set version=$1,source_url=$2,license=$3,manifest=$4,updated_at=now() where id=$5", [input.version.trim(), input.sourceUrl, input.license ?? null, JSON.stringify(manifest), itemId]);
  return rows[0];
}

export function registerAgentMarketplaceRoutes(app: FastifyInstance, options: Options) {
  app.get("/api/agent-marketplace", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const kind = typeof request.query?.kind === "string" && ["skill", "mcp", "plugin"].includes(request.query.kind) ? request.query.kind as MarketplaceKind : null;
    const search = typeof request.query?.q === "string" ? request.query.q.trim().slice(0, 100) : "";
    const values: unknown[] = [];
    const where = ["i.status='published'"];
    if (kind) { values.push(kind); where.push(`i.kind=$${values.length}`); }
    if (search) { values.push(`%${search}%`); where.push(`(i.name ilike $${values.length} or i.description ilike $${values.length})`); }
    const { rows } = await options.db.query(
      `select i.id,i.kind,i.name,i.slug,i.description,i.source_url,i.version,i.license,i.manifest,i.status,i.created_at,i.updated_at,
       coalesce((select json_agg(json_build_object('version',v.version,'sourceUrl',v.source_url,'license',v.license,'createdAt',v.created_at) order by v.created_at desc) from agent_marketplace_versions v where v.item_id=i.id),'[]'::json) as versions
       from agent_marketplace_items i where ${where.join(" and ")} order by i.updated_at desc limit 100`,
      values,
    );
    const installs = rows.length
      ? await options.db.query<{ item_id: string }>(
        "select item_id from agent_marketplace_installs where workspace_id=$1 and user_id=$2 and status='installed' and item_id=any($3::uuid[])",
        [viewer.workspace.id, user.id, rows.map((row: Record<string, unknown>) => row.id)],
      )
      : { rows: [] };
    const installedIds = new Set(installs.rows.map((row) => row.item_id));
    return { ok: true, data: rows.map((row: Record<string, unknown>) => ({ ...row, installed: installedIds.has(String(row.id)), manifest: publishedManifest(row.kind as MarketplaceKind, row.manifest) ?? {} })) };
  });

  app.get("/api/agent-marketplace/installs", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query(
      "select a.item_id,a.target,a.installed_version,a.status,a.metadata,a.installed_at,a.updated_at,i.kind,i.name,i.slug,i.status as item_status from agent_marketplace_installs a join agent_marketplace_items i on i.id=a.item_id where a.workspace_id=$1 and a.user_id=$2 and a.status='installed' order by a.updated_at desc",
      [viewer.workspace.id, user.id],
    );
    return {
      ok: true,
      data: (rows as Array<Record<string, unknown>>).map(({ item_status: itemStatus, ...install }) => ({
        ...install,
        available: isMarketplaceItemAvailable(itemStatus),
      })),
    };
  });

  app.post("/api/agent-marketplace/:id/install", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const body = isRecord(request.body) ? request.body : {};
    const { rows } = await options.db.query<{ id: string; kind: MarketplaceKind; version: string; status: string; name: string }>(
      "select id,kind,version,status,name from agent_marketplace_items where id=$1",
      [request.params.id],
    );
    const item = rows[0];
    if (!item || item.status !== "published") return reply.code(404).send({ ok: false, error: { code: "marketplace_item_not_found", message: "Published marketplace item not found." } });
    const target = item.kind === "mcp" ? "desktop" : "workspace";
    if (body.target !== target) return reply.code(400).send({ ok: false, error: { code: "marketplace_install_target_invalid", message: "This " + item.kind + " installs to " + target + "." } });
    if (item.kind === "mcp" && (body.localInstalled !== true || body.localServerName !== item.name)) {
      return reply.code(409).send({ ok: false, error: { code: "mcp_local_install_required", message: "Connect this MCP server in the desktop app before syncing its installation." } });
    }
    if (item.kind === "skill" && (typeof body.skillId !== "string" || !(await options.db.query(
      "select 1 from workspace_skills where workspace_id=$1 and skill_id=$2",
      [viewer.workspace.id, body.skillId],
    )).rowCount)) return reply.code(409).send({ ok: false, error: { code: "skill_install_required", message: "Install the skill in this workspace before syncing it." } });
    const metadata = item.kind === "skill"
      ? { skillId: body.skillId }
      : item.kind === "mcp"
        ? { localServerName: body.localServerName }
        : { module: "declarative-agent-guidance" };
    const result = await options.db.query(
      "insert into agent_marketplace_installs(workspace_id,user_id,item_id,target,installed_version,status,metadata) values($1,$2,$3,$4,$5,'installed',$6::jsonb) on conflict(workspace_id,user_id,item_id,target) do update set installed_version=excluded.installed_version,status='installed',metadata=excluded.metadata,updated_at=now() returning item_id,target,installed_version,status,metadata,installed_at,updated_at",
      [viewer.workspace.id, user.id, item.id, target, item.version, JSON.stringify(metadata)],
    );
    return { ok: true, data: result.rows[0] };
  });

  app.delete("/api/agent-marketplace/:id/install", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const { rows } = await options.db.query<{ kind: MarketplaceKind }>("select kind from agent_marketplace_items where id=$1", [request.params.id]);
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "marketplace_item_not_found", message: "Marketplace item not found." } });
    const target = rows[0].kind === "mcp" ? "desktop" : "workspace";
    const removed = await options.db.query(
      "update agent_marketplace_installs set status='removed',updated_at=now() where workspace_id=$1 and user_id=$2 and item_id=$3 and target=$4 and status='installed' returning item_id",
      [viewer.workspace.id, user.id, request.params.id, target],
    );
    return removed.rowCount
      ? reply.code(204).send()
      : reply.code(404).send({ ok: false, error: { code: "marketplace_install_not_found", message: "This item is not installed." } });
  });

  app.patch("/api/agent-marketplace/:id/install", async (request: any, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) return reply.code(401).send({ ok: false, error: { code: "unauthorized", message: "Unauthorized" } });
    const viewer = await options.viewerService.ensureViewer(user);
    const body = isRecord(request.body) ? request.body : {};
    if (typeof body.enabled !== "boolean") return reply.code(400).send({ ok: false, error: { code: "marketplace_enabled_invalid", message: "enabled must be a boolean." } });
    const { rows } = await options.db.query<{ kind: MarketplaceKind }>("select kind from agent_marketplace_items where id=$1", [request.params.id]);
    const item = rows[0];
    if (!item) return reply.code(404).send({ ok: false, error: { code: "marketplace_item_not_found", message: "Marketplace item not found." } });
    const install = await options.db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from agent_marketplace_installs where workspace_id=$1 and user_id=$2 and item_id=$3 and status='installed'",
      [viewer.workspace.id, user.id, request.params.id],
    );
    if (!install.rows[0]) return reply.code(404).send({ ok: false, error: { code: "marketplace_install_not_found", message: "This item is not installed." } });
    const metadata: Record<string, unknown> = { ...(install.rows[0].metadata ?? {}), enabled: body.enabled };
    if (item.kind === "skill") {
      const skillId = metadata.skillId;
      if (typeof skillId !== "string") return reply.code(409).send({ ok: false, error: { code: "skill_install_metadata_missing", message: "The installed Skill is missing its workspace reference." } });
      await options.db.query(
        "update workspace_skills set enabled=$1 where workspace_id=$2 and skill_id=$3",
        [body.enabled, viewer.workspace.id, skillId],
      );
    }
    const updated = await options.db.query(
      "update agent_marketplace_installs set metadata=$1::jsonb,updated_at=now() where workspace_id=$2 and user_id=$3 and item_id=$4 and status='installed' returning item_id,target,installed_version,status,metadata,installed_at,updated_at",
      [JSON.stringify(metadata), viewer.workspace.id, user.id, request.params.id],
    );
    return { ok: true, data: updated.rows[0] };
  });

  app.get("/api/admin/agent-marketplace", async (request: any, reply) => {
    if (!await requireAdmin(options, request, reply)) return;
    const { rows } = await options.db.query(
      `select i.*,coalesce((select json_agg(json_build_object('version',v.version,'sourceUrl',v.source_url,'license',v.license,'createdAt',v.created_at) order by v.created_at desc) from agent_marketplace_versions v where v.item_id=i.id),'[]'::json) as versions
       from agent_marketplace_items i order by i.updated_at desc limit 500`,
    );
    return { ok: true, data: rows };
  });

  app.post("/api/admin/agent-marketplace", async (request: any, reply) => {
    const actor = await requireAdmin(options, request, reply); if (!actor) return;
    const body = isRecord(request.body) ? request.body : {};
    if (!("skill mcp plugin".split(" ").includes(String(body.kind))) || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 || !validSourceUrl(body.sourceUrl)) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_item", message: "Valid kind, name, and HTTPS source URL are required." } });
    if (!validManifest(body.manifest ?? {}) || includesCredentialField(body.manifest ?? {})) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_manifest", message: "Manifest must be a safe object smaller than 64 KB and cannot contain credentials." } });
    const safeManifest = publishedManifest(body.kind as MarketplaceKind, body.manifest ?? {});
    if (!safeManifest) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_manifest", message: "Manifest is invalid, contains credentials, or does not match the item type." } });
    const kind = body.kind as MarketplaceKind;
    const slug = typeof body.slug === "string" ? safeSlug(body.slug) : safeSlug(body.name);
    if (!slug) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_slug", message: "Slug must contain letters or numbers." } });
    const client = await options.db.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "insert into agent_marketplace_items(kind,name,slug,description,source_url,version,license,manifest,status,created_by) values($1,$2,$3,$4,$5,'draft',$6,$7,'draft',$8) returning *",
        [kind, body.name.trim(), slug, String(body.description ?? "").slice(0, 2_000), body.sourceUrl, typeof body.license === "string" ? body.license.slice(0, 120) : null, JSON.stringify(safeManifest), actor.id],
      );
      await insertVersion(client, actor, rows[0].id, { version: body.version ?? "1.0.0", sourceUrl: body.sourceUrl, license: body.license, manifest: safeManifest });
      await writeAudit(client, actor, "agent_marketplace_created", rows[0].id, { kind, slug, status: "draft" });
      await client.query("commit");
      return reply.code(201).send({ ok: true, data: rows[0] });
    } catch (error) {
      await client.query("rollback");
      const conflict = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
      return reply.code(conflict ? 409 : 400).send({ ok: false, error: { code: conflict ? "marketplace_slug_exists" : "marketplace_create_failed", message: error instanceof Error ? error.message : "Could not create marketplace item." } });
    } finally { client.release(); }
  });

  app.post("/api/admin/agent-marketplace/:id/versions", async (request: any, reply) => {
    const actor = await requireAdmin(options, request, reply); if (!actor) return;
    const body = isRecord(request.body) ? request.body : {};
    const client = await options.db.connect();
    try {
      await client.query("begin");
      const exists = await client.query("select id from agent_marketplace_items where id=$1 for update", [request.params.id]);
      if (!exists.rows[0]) { await client.query("rollback"); return reply.code(404).send({ ok: false, error: { code: "marketplace_item_not_found", message: "Marketplace item not found." } }); }
      const item = await client.query<{ kind: MarketplaceKind }>("select kind from agent_marketplace_items where id=$1", [request.params.id]);
      const itemKind = item.rows[0]?.kind;
      if (!itemKind) throw new Error("Marketplace item not found.");
      if (!validManifest(body.manifest) || includesCredentialField(body.manifest)) throw new Error("Manifest must be a safe object and cannot contain credentials.");
      const safeManifest = publishedManifest(itemKind, body.manifest);
      if (!safeManifest) throw new Error("Manifest is invalid, contains credentials, or does not match the item type.");
      const version = await insertVersion(client, actor, request.params.id, { ...body, manifest: safeManifest });
      await writeAudit(client, actor, "agent_marketplace_version_created", request.params.id, { version: version.version });
      await client.query("commit");
      return reply.code(201).send({ ok: true, data: version });
    } catch (error) {
      await client.query("rollback");
      const conflict = typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
      return reply.code(conflict ? 409 : 400).send({ ok: false, error: { code: conflict ? "marketplace_version_exists" : "marketplace_version_failed", message: error instanceof Error ? error.message : "Could not add version." } });
    } finally { client.release(); }
  });

  app.patch("/api/admin/agent-marketplace/:id", async (request: any, reply) => {
    const actor = await requireAdmin(options, request, reply); if (!actor) return;
    const body = isRecord(request.body) ? request.body : {};
    if ("version" in body || "source_url" in body || "sourceUrl" in body || "license" in body || "manifest" in body) return reply.code(400).send({ ok: false, error: { code: "version_endpoint_required", message: "Create a version through the versions endpoint." } });
    if (body.status && !["draft", "published", "hidden"].includes(String(body.status))) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_status", message: "Status must be draft, published, or hidden." } });
    const fields: Array<[string, unknown]> = [];
    if (typeof body.name === "string" && body.name.trim() && body.name.length <= 120) fields.push(["name", body.name.trim()]);
    if (typeof body.description === "string") fields.push(["description", body.description.slice(0, 2_000)]);
    if (typeof body.status === "string") fields.push(["status", body.status as MarketplaceStatus]);
    if (!fields.length) return reply.code(400).send({ ok: false, error: { code: "invalid_marketplace_update", message: "No valid editable fields." } });
    const values = fields.map(([, value]) => value); values.push(request.params.id);
    const set = fields.map(([key], index) => `${key}=$${index + 1}`).join(", ");
    const { rows } = await options.db.query(`update agent_marketplace_items set ${set},updated_at=now() where id=$${values.length} returning *`, values);
    if (!rows[0]) return reply.code(404).send({ ok: false, error: { code: "marketplace_item_not_found", message: "Marketplace item not found." } });
    await writeAudit(options.db, actor, rows[0].status === "published" ? "agent_marketplace_published" : rows[0].status === "hidden" ? "agent_marketplace_hidden" : "agent_marketplace_updated", request.params.id, { fields: fields.map(([key]) => key), status: rows[0].status });
    return { ok: true, data: { ...rows[0], manifest: publishedManifest(rows[0].kind as MarketplaceKind, rows[0].manifest) ?? {} } };
  });
}
