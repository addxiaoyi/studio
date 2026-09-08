import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { ProjectCreateRequest, ProjectSummary, ProjectUpdateRequest } from "@helstera/shared";
import { ProjectServiceError, type ProjectService } from "../features/projects/project-service.js";

export function createLocalProjectService(db: Pool, uploadRoot = "/www/helstera/uploads"): ProjectService {
  return {
    async listProjects(user) {
      const workspace = await personalWorkspace(db, user.id);
      const { rows } = await db.query(
        `select p.id, p.name, p.slug, p.description, p.created_at, p.updated_at,
                c.id as canvas_id, c.name as canvas_name, c.is_primary
         from projects p join canvases c on c.project_id = p.id and c.is_primary
         where p.workspace_id = $1 and p.archived_at is null order by p.updated_at desc`,
        [workspace.id],
      );
      return rows.map((row) => mapSummary(row, workspace));
    },
    async getProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const { rows } = await db.query(
        `select id, name, slug, description, workspace_id, created_at, updated_at
         from projects where id = $1 and workspace_id = $2 and archived_at is null`,
        [projectId, workspace.id],
      );
      const project = rows[0];
      if (!project) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
      return { ...project, brand_kit_id: null };
    },
    async createProject(user, input) {
      const workspace = await personalWorkspace(db, user.id);
      const name = input.name.trim();
      const slug = slugify(name);
      const client = await db.connect();
      try {
        await client.query("begin");
        const project = await client.query(
          `insert into projects (workspace_id, created_by, name, slug, description)
           values ($1, $2, $3, $4, $5) returning id, name, slug, description, created_at, updated_at`,
          [workspace.id, user.id, name, slug, input.description?.trim() || null],
        );
        const canvas = await client.query(
          `insert into canvases (project_id, created_by, name, is_primary)
           values ($1, $2, 'Main Canvas', true) returning id, name, is_primary`,
          [project.rows[0].id, user.id],
        );
        await client.query("commit");
        return mapSummary({ ...project.rows[0], canvas_id: canvas.rows[0].id, canvas_name: canvas.rows[0].name, is_primary: true }, workspace);
      } catch (error) {
        await client.query("rollback");
        if ((error as { code?: string }).code === "23505") throw new ProjectServiceError("project_slug_taken", "Project slug is already taken in this workspace.", 409);
        throw new ProjectServiceError("project_create_failed", "Unable to create project.", 500);
      } finally { client.release(); }
    },
    async updateProject(user, projectId, input: ProjectUpdateRequest) {
      const workspace = await personalWorkspace(db, user.id);
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.name !== undefined) { fields.push(`name = $${values.length + 1}`); values.push(input.name.trim()); }
      if (!fields.length && input.brand_kit_id === undefined) return;
      values.push(projectId, workspace.id);
      const result = await db.query(`update projects set ${fields.length ? `${fields.join(", ")}, ` : ""}updated_at = now() where id = $${values.length - 1} and workspace_id = $${values.length} and archived_at is null`, values);
      if (!result.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
    },
    async archiveProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const result = await db.query("update projects set archived_at = now(), updated_at = now() where id = $1 and workspace_id = $2 and archived_at is null", [projectId, workspace.id]);
      if (!result.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
    },
    async saveThumbnail(user, projectId, buffer, mimeType) {
      const workspace = await personalWorkspace(db, user.id);
      const check = await db.query("select id from projects where id = $1 and workspace_id = $2 and archived_at is null", [projectId, workspace.id]);
      if (!check.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
      const ext = mimeType === "image/png" ? "png" : "webp";
      const dir = join(uploadRoot, workspace.id, projectId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `thumbnail.${ext}`), buffer);
      return { thumbnailUrl: `/api/projects/${projectId}/thumbnail` };
    },
  };
}

async function personalWorkspace(db: Pool, userId: string) {
  const { rows } = await db.query("select id, name from workspaces where owner_user_id = $1 order by created_at limit 1", [userId]);
  if (rows[0]) return { id: rows[0].id, name: rows[0].name, ownerUserId: userId, type: "personal" as const };
  const created = await db.query("insert into workspaces (owner_user_id, name) values ($1, $2) returning id, name", [userId, "Personal Workspace"]);
  await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [created.rows[0].id, userId]);
  return { id: created.rows[0].id, name: created.rows[0].name, ownerUserId: userId, type: "personal" as const };
}

function mapSummary(row: any, workspace: { id: string; name: string; ownerUserId: string; type: "personal" }): ProjectSummary {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), workspace, primaryCanvas: { id: row.canvas_id, name: row.canvas_name, isPrimary: row.is_primary }, thumbnailUrl: null };
}

function slugify(value: string) { return `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}-${Math.random().toString(36).slice(2, 8)}`; }
