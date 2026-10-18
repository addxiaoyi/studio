import type { Pool } from "pg";
import type { AuthenticatedUser } from "../auth/types.js";

export type StoryAssetKind = "character" | "scene" | "prop";

export type StoryAssetInput = {
  kind: StoryAssetKind;
  name: string;
  description?: string | undefined;
  imageUrl?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type StoryboardInput = {
  sceneNo: number;
  title: string;
  script?: string | undefined;
  shotPrompt?: string | undefined;
  status?: "draft" | "queued" | "generating" | "ready" | "failed" | undefined;
  imageAssetId?: string | null | undefined;
  videoAssetId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export function createLocalStoryboardService(db: Pool) {
  return {
    async listAssets(user: AuthenticatedUser, projectId: string) {
      await assertProjectAccess(db, user.id, projectId);
      const { rows } = await db.query(
        `select id, project_id, kind, name, description, image_url, metadata, created_at, updated_at
         from project_story_assets where project_id = $1 order by kind, updated_at desc`,
        [projectId],
      );
      return rows.map(mapAsset);
    },

    async createAsset(
      user: AuthenticatedUser,
      projectId: string,
      input: StoryAssetInput,
    ) {
      await assertProjectAccess(db, user.id, projectId);
      const { rows } = await db.query(
        `insert into project_story_assets
          (project_id, kind, name, description, image_url, metadata, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id, project_id, kind, name, description, image_url, metadata, created_at, updated_at`,
        [
          projectId,
          input.kind,
          input.name.trim(),
          input.description?.trim() ?? "",
          input.imageUrl ?? null,
          JSON.stringify(input.metadata ?? {}),
          user.id,
        ],
      );
      return mapAsset(rows[0]);
    },

    async updateAsset(
      user: AuthenticatedUser,
      projectId: string,
      assetId: string,
      input: StoryAssetInput,
    ) {
      await assertProjectAccess(db, user.id, projectId);
      const { rows } = await db.query(
        `update project_story_assets set
           kind = $3, name = $4, description = $5, image_url = $6, metadata = $7, updated_at = now()
         where id = $1 and project_id = $2
         returning id, project_id, kind, name, description, image_url, metadata, created_at, updated_at`,
        [
          assetId,
          projectId,
          input.kind,
          input.name.trim(),
          input.description?.trim() ?? "",
          input.imageUrl ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      if (!rows[0])
        throw new StoryboardServiceError(
          "story_asset_not_found",
          "创作资产不存在",
          404,
        );
      return mapAsset(rows[0]);
    },

    async deleteAsset(
      user: AuthenticatedUser,
      projectId: string,
      assetId: string,
    ) {
      await assertProjectAccess(db, user.id, projectId);
      const result = await db.query(
        "delete from project_story_assets where id = $1 and project_id = $2",
        [assetId, projectId],
      );
      if (!result.rowCount)
        throw new StoryboardServiceError(
          "story_asset_not_found",
          "创作资产不存在",
          404,
        );
    },

    async listStoryboards(user: AuthenticatedUser, projectId: string) {
      await assertProjectAccess(db, user.id, projectId);
      const { rows } = await db.query(
        `select id, project_id, scene_no, title, script, shot_prompt, image_asset_id, video_asset_id,
                status, metadata, created_at, updated_at
         from project_storyboards where project_id = $1 order by scene_no`,
        [projectId],
      );
      return rows.map(mapStoryboard);
    },

    async upsertStoryboard(
      user: AuthenticatedUser,
      projectId: string,
      input: StoryboardInput,
    ) {
      await assertProjectAccess(db, user.id, projectId);
      const { rows } = await db.query(
        `insert into project_storyboards
          (project_id, scene_no, title, script, shot_prompt, image_asset_id, video_asset_id, status, metadata, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (project_id, scene_no) do update set
           title = excluded.title, script = excluded.script, shot_prompt = excluded.shot_prompt,
           image_asset_id = coalesce(excluded.image_asset_id, project_storyboards.image_asset_id),
           video_asset_id = coalesce(excluded.video_asset_id, project_storyboards.video_asset_id),
           status = excluded.status, metadata = excluded.metadata, updated_at = now()
         returning id, project_id, scene_no, title, script, shot_prompt, image_asset_id, video_asset_id,
                   status, metadata, created_at, updated_at`,
        [
          projectId,
          input.sceneNo,
          input.title.trim(),
          input.script?.trim() ?? "",
          input.shotPrompt?.trim() ?? "",
          input.imageAssetId ?? null,
          input.videoAssetId ?? null,
          input.status ?? "draft",
          JSON.stringify(input.metadata ?? {}),
          user.id,
        ],
      );
      return mapStoryboard(rows[0]);
    },
  };
}

export class StoryboardServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

async function assertProjectAccess(
  db: Pool,
  userId: string,
  projectId: string,
) {
  const { rowCount } = await db.query(
    `select 1 from projects p join workspace_members wm on wm.workspace_id = p.workspace_id
     where p.id = $1 and wm.user_id = $2 and p.archived_at is null`,
    [projectId, userId],
  );
  if (!rowCount)
    throw new StoryboardServiceError(
      "project_not_found",
      "项目不存在或无权访问",
      404,
    );
}

function mapAsset(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapStoryboard(row: any) {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneNo: row.scene_no,
    title: row.title,
    script: row.script,
    shotPrompt: row.shot_prompt,
    imageAssetId: row.image_asset_id,
    videoAssetId: row.video_asset_id,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
