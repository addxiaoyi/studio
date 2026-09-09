import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { skillCreateRequestSchema, skillUpdateRequestSchema, workspaceSkillToggleRequestSchema } from "@helstera/shared";
import type { RequestAuthenticator } from "../supabase/user.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";

export function registerLocalSkillRoutes(app: FastifyInstance, options: { db: Pool; auth: RequestAuthenticator; viewerService: ViewerService }) {
  app.get("/api/skills", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    const { rows } = await options.db.query("select * from skills where source in ('system','community') or created_by = $1 order by is_featured desc, name", [user.id]);
    return reply.send({ skills: rows.map(mapSkill) });
  });
  app.get<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    const skill = await findSkill(options.db, request.params.id, user.id); if (!skill) return reply.code(404).send({ error: { code: "skill_not_found", message: "Skill not found." } });
    const { rows: files } = await options.db.query("select * from skill_files where skill_id = $1 order by file_path", [skill.id]);
    return reply.send({ skill: { ...mapSkill(skill), license: skill.license, skillContent: skill.skill_content, createdBy: skill.created_by, sourceUrl: null, packageName: null, files: files.map(mapFile) } });
  });
  app.get<{ Params: { id: string } }>("/api/skills/:id/files", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    const skill = await findSkill(options.db, request.params.id, user.id); if (!skill) return reply.code(404).send({ error: { code: "skill_not_found", message: "Skill not found." } });
    const { rows } = await options.db.query("select * from skill_files where skill_id = $1 order by file_path", [skill.id]); return reply.send({ files: rows.map(mapFile) });
  });
  app.post("/api/skills", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply);
    const input = skillCreateRequestSchema.parse(request.body); const client = await options.db.connect();
    try { await client.query("begin"); const { rows } = await client.query("insert into skills (name, slug, description, category, skill_content, icon_name, source, created_by) values ($1,$2,$3,$4,$5,$6,'user',$7) returning *", [input.name, slugify(input.name), input.description, input.category, input.skillContent, input.iconName ?? null, user.id]); for (const file of input.files ?? []) await client.query("insert into skill_files (skill_id, file_path, content, mime_type) values ($1,$2,$3,$4)", [rows[0].id, file.filePath, file.content, file.mimeType ?? "text/plain"]); await client.query("commit"); return reply.code(201).send({ skill: { ...mapSkill(rows[0]), license: null, skillContent: rows[0].skill_content, createdBy: user.id, files: [] } }); } catch (error) { await client.query("rollback"); return reply.code(409).send({ error: { code: "skill_create_failed", message: "A skill with this name already exists." } }); } finally { client.release(); }
  });
  app.put<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => {
    const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const input = skillUpdateRequestSchema.parse(request.body); const fields: string[] = []; const values: unknown[] = [];
    for (const [key, value] of Object.entries(input)) { const column = key === "skillContent" ? "skill_content" : key === "iconName" ? "icon_name" : key; fields.push(`${column} = $${values.length + 1}`); values.push(value); }
    values.push(request.params.id, user.id); const result = await options.db.query(`update skills set ${fields.join(", ")}, updated_at = now() where id = $${values.length - 1} and created_by = $${values.length}`, values); if (!result.rowCount) return reply.code(404).send({ error: { code: "skill_not_found", message: "Skill not found." } }); const skill = await findSkill(options.db, request.params.id, user.id); return reply.send({ skill: { ...mapSkill(skill), license: skill.license, skillContent: skill.skill_content, createdBy: skill.created_by } });
  });
  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (request, reply) => { const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const result = await options.db.query("delete from skills where id = $1 and created_by = $2", [request.params.id, user.id]); return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: { code: "skill_not_found", message: "Skill not found." } }); });
  app.get("/api/workspaces/skills", async (request, reply) => { const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const viewer = await options.viewerService.ensureViewer(user); const { rows } = await options.db.query("select s.*, ws.enabled, ws.installed_at from workspace_skills ws join skills s on s.id = ws.skill_id where ws.workspace_id = $1 order by ws.installed_at desc", [viewer.workspace.id]); return reply.send({ skills: rows.map((row) => ({ ...mapSkill(row), installed: true, enabled: row.enabled, installedAt: row.installed_at.toISOString() })) }); });
  app.post<{ Body: { skillId?: string } }>("/api/workspaces/skills", async (request, reply) => { const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const viewer = await options.viewerService.ensureViewer(user); if (!request.body?.skillId) return reply.code(400).send({ error: { code: "skill_install_failed", message: "skillId is required." } }); await options.db.query("insert into workspace_skills (workspace_id, skill_id, installed_by) values ($1,$2,$3) on conflict (workspace_id, skill_id) do update set enabled = true", [viewer.workspace.id, request.body.skillId, user.id]); return reply.code(204).send(); });
  app.delete<{ Params: { skillId: string } }>("/api/workspaces/skills/:skillId", async (request, reply) => { const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const viewer = await options.viewerService.ensureViewer(user); const result = await options.db.query("delete from workspace_skills where workspace_id = $1 and skill_id = $2", [viewer.workspace.id, request.params.skillId]); return result.rowCount ? reply.code(204).send() : reply.code(404).send({ error: { code: "skill_not_found", message: "Skill is not installed." } }); });
  app.patch<{ Params: { skillId: string } }>("/api/workspaces/skills/:skillId", async (request, reply) => { const user = await options.auth.authenticate(request); if (!user) return unauthorized(reply); const input = workspaceSkillToggleRequestSchema.parse(request.body); const viewer = await options.viewerService.ensureViewer(user); await options.db.query("insert into workspace_skills (workspace_id, skill_id, enabled, installed_by) values ($1,$2,$3,$4) on conflict (workspace_id, skill_id) do update set enabled = excluded.enabled", [viewer.workspace.id, request.params.skillId, input.enabled, user.id]); return reply.code(204).send(); });
}

async function findSkill(db: Pool, id: string, userId: string) { const { rows } = await db.query("select * from skills where id = $1 and (source in ('system','community') or created_by = $2)", [id, userId]); return rows[0]; }
function mapSkill(row: any) { return { id: row.id, name: row.name, slug: row.slug, description: row.description, author: row.author, version: row.version, category: row.category, iconName: row.icon_name, source: row.source, isFeatured: row.is_featured, metadata: row.metadata ?? {}, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
function mapFile(row: any) { return { id: row.id, filePath: row.file_path, content: row.content, mimeType: row.mime_type, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }; }
function slugify(value: string) { return `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill"}-${Math.random().toString(36).slice(2, 8)}`; }
function unauthorized(reply: any) { return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } }); }
