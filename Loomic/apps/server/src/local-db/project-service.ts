import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import type { ProjectCreateRequest, ProjectSummary, ProjectUpdateRequest } from "@helstera/shared";
import { ProjectServiceError, type ProjectService } from "../features/projects/project-service.js";

const PROJECT_ASSETS_BUCKET = "project-assets";

export function createLocalProjectService(db: Pool, uploadRoot = "/www/helstera/uploads"): ProjectService {
  const deadlockRetries = new Map<string, number>();
  const createLocks = new Map<string, Promise<ProjectSummary>>();
  return {
    async listProjects(user) {
      const workspace = await personalWorkspace(db, user.id);
      const { rows } = await db.query(
        `select p.id, p.name, p.slug, p.description, p.created_at, p.updated_at,
                p.thumbnail_path,
                c.id as canvas_id, c.name as canvas_name, c.is_primary
         from projects p join canvases c on c.project_id = p.id and c.is_primary
         where p.workspace_id = $1 and p.archived_at is null order by p.updated_at desc`,
        [workspace.id],
      );
      return Promise.all(
        rows.map(async (row) => {
          const thumbnailPath = await findThumbnailPath(
            uploadRoot,
            workspace.id,
            row.id,
            row.thumbnail_path,
          );
          return mapSummary(row, workspace, thumbnailPath ? `/api/projects/${row.id}/thumbnail` : null);
        }),
      );
    },
    async getProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const { rows } = await db.query(
        `select id, name, slug, description, workspace_id, brand_kit_id, created_at, updated_at
         from projects where id = $1 and workspace_id = $2 and archived_at is null`,
        [projectId, workspace.id],
      );
      const project = rows[0];
      if (!project) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
      return project;
    },
    async createProject(user, input) {
      const active = createLocks.get(user.id);
      if (active) return active;
      const creation = createProjectOnce(db, uploadRoot, user, input, deadlockRetries);
      createLocks.set(user.id, creation);
      try {
        return await creation;
      } finally {
        if (createLocks.get(user.id) === creation) createLocks.delete(user.id);
      }
    },
    async updateProject(user, projectId, input: ProjectUpdateRequest) {
      const workspace = await personalWorkspace(db, user.id);
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.name !== undefined) { fields.push(`name = $${values.length + 1}`); values.push(input.name.trim()); }
      if (input.brand_kit_id !== undefined) { fields.push(`brand_kit_id = $${values.length + 1}`); values.push(input.brand_kit_id); }
      if (!fields.length) return;
      values.push(projectId, workspace.id);
      const result = await db.query(`update projects set ${fields.length ? `${fields.join(", ")}, ` : ""}updated_at = now() where id = $${values.length - 1} and workspace_id = $${values.length} and archived_at is null`, values);
      if (!result.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
    },
    async archiveProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const result = await db.query("update projects set archived_at = now(), updated_at = now() where id = $1 and workspace_id = $2 and archived_at is null", [projectId, workspace.id]);
      if (!result.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
    },
    async listArchivedProjects(user) {
      const workspace = await personalWorkspace(db, user.id);
      const { rows } = await db.query(
        `select p.id, p.name, p.slug, p.description, p.created_at, p.updated_at, p.thumbnail_path,
                c.id as canvas_id, c.name as canvas_name, c.is_primary
         from projects p join canvases c on c.project_id = p.id and c.is_primary
         where p.workspace_id = $1 and p.archived_at is not null order by p.updated_at desc`,
        [workspace.id],
      );
      return Promise.all(rows.map(async (row) => {
        const thumbnailPath = await findThumbnailPath(uploadRoot, workspace.id, row.id, row.thumbnail_path);
        return mapSummary(row, workspace, thumbnailPath ? `/api/projects/${row.id}/thumbnail` : null);
      }));
    },
    async restoreProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const result = await db.query(
        "update projects set archived_at = null, updated_at = now() where id = $1 and workspace_id = $2 and archived_at is not null",
        [projectId, workspace.id],
      );
      if (!result.rowCount) throw new ProjectServiceError("project_not_found", "Archived project not found.", 404);
    },
    async archiveEmptyProject(user, projectId) {
      const workspace = await personalWorkspace(db, user.id);
      const result = await db.query(
        `update projects p
         set archived_at = now(), updated_at = now()
         where p.id = $1
           and p.workspace_id = $2
           and p.archived_at is null
           and exists (
             select 1 from canvases c
             where c.project_id = p.id
               and c.is_primary
               and jsonb_array_length(coalesce(c.content->'elements', '[]'::jsonb)) = 0
               and coalesce(c.content->'files', '{}'::jsonb) = '{}'::jsonb
           )
           and not exists (
             select 1 from chat_sessions cs
             join chat_messages cm on cm.session_id = cs.id
             where cs.canvas_id in (select id from canvases where project_id = p.id)
           )
           and p.thumbnail_path is null
           and not exists (select 1 from asset_objects ao where ao.project_id = p.id)
           and not exists (select 1 from generated_assets ga where ga.project_id = p.id and ga.deleted_at is null)
           and not exists (select 1 from background_jobs bj where bj.project_id = p.id)
           and not exists (select 1 from project_story_assets psa where psa.project_id = p.id)
           and not exists (select 1 from project_storyboards ps where ps.project_id = p.id)`,
        [projectId, workspace.id],
      );
      return Boolean(result.rowCount);
    },
    async saveThumbnail(user, projectId, buffer, mimeType) {
      const workspace = await personalWorkspace(db, user.id);
      const check = await db.query("select id from projects where id = $1 and workspace_id = $2 and archived_at is null", [projectId, workspace.id]);
      if (!check.rowCount) throw new ProjectServiceError("project_not_found", "Project not found.", 404);
      const ext = mimeType === "image/png" ? "png" : "webp";
      const objectPath = `${workspace.id}/${projectId}/thumbnail.${ext}`;
      const dir = join(uploadRoot, PROJECT_ASSETS_BUCKET, workspace.id, projectId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `thumbnail.${ext}`), buffer);
      await db.query(
        "update projects set thumbnail_path = $1, updated_at = now() where id = $2 and workspace_id = $3",
        [objectPath, projectId, workspace.id],
      );
      return { thumbnailUrl: `/api/projects/${projectId}/thumbnail` };
    },
  };
}

async function createProjectOnce(db: Pool, uploadRoot: string, user: any, input: ProjectCreateRequest, deadlockRetries: Map<string, number>): Promise<ProjectSummary> {
      const workspace = await personalWorkspace(db, user.id);
      const name = input.name.trim();
      const slug = slugify(name);
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [user.id]);
        const project = await client.query(
          `insert into projects (workspace_id, created_by, name, slug, description, brand_kit_id)
           values ($1, $2, $3, $4, $5, (select id from brand_kits where user_id = $2 and is_default limit 1))
           returning id, name, slug, description, brand_kit_id, created_at, updated_at`,
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
        console.error("[projects] local create failed", {
          code: (error as { code?: string }).code,
          message: error instanceof Error ? error.message : String(error),
          detail: (error as { detail?: string }).detail,
          constraint: (error as { constraint?: string }).constraint,
        });
        const retryCount = deadlockRetries.get(user.id) ?? 0;
        if ((error as { code?: string }).code === "40P01" && retryCount < 3) {
          deadlockRetries.set(user.id, retryCount + 1);
          await new Promise((resolve) => setTimeout(resolve, 80));
          try {
            return await createProjectOnce(db, uploadRoot, user, input, deadlockRetries);
          } finally {
            if (retryCount === 0) deadlockRetries.delete(user.id);
            else deadlockRetries.set(user.id, retryCount);
          }
        }
        if ((error as { code?: string }).code === "23505") throw new ProjectServiceError("project_slug_taken", "Project slug is already taken in this workspace.", 409);
        throw new ProjectServiceError("project_create_failed", "Unable to create project.", 500);
      } finally { client.release(); }
}

async function personalWorkspace(db: Pool, userId: string) {
  const existing = await db.query(
    "select id, name from workspaces where owner_user_id = $1 limit 1",
    [userId],
  );
  const rows = existing.rows.length
    ? existing.rows
    : (
        await db.query(
          "insert into workspaces (owner_user_id, name) values ($1, $2) returning id, name",
          [userId, "Personal Workspace"],
        )
      ).rows;
  await db.query(
    `insert into workspace_members (workspace_id, user_id, role)
     values ($1, $2, 'owner') on conflict do nothing`,
    [rows[0].id, userId],
  );
  return { id: rows[0].id, name: rows[0].name, ownerUserId: userId, type: "personal" as const };
}

function mapSummary(
  row: any,
  workspace: { id: string; name: string; ownerUserId: string; type: "personal" },
  thumbnailUrl: string | null = null,
): ProjectSummary {
  return { id: row.id, name: row.name, slug: row.slug, description: row.description, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), workspace, primaryCanvas: { id: row.canvas_id, name: row.canvas_name, isPrimary: row.is_primary }, thumbnailUrl };
}

async function findThumbnailPath(
  uploadRoot: string,
  workspaceId: string,
  projectId: string,
  storedPath: string | null | undefined,
) {
  const candidates = [
    ...(storedPath
      ? [
          join(uploadRoot, PROJECT_ASSETS_BUCKET, storedPath),
          join(uploadRoot, storedPath),
        ]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next compatible storage layout.
    }
  }

  return null;
}

function slugify(value: string) { return `${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}-${Math.random().toString(36).slice(2, 8)}`; }
