import type { Pool } from "pg";
import type { CanvasContent, CanvasDetail } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import { CanvasServiceError, type CanvasService } from "../features/canvas/canvas-service.js";

export function createLocalCanvasService(db: Pool): CanvasService {
  return {
    async getCanvas(user: AuthenticatedUser, canvasId: string): Promise<CanvasDetail> {
      const { rows } = await db.query(
        `select c.id, c.name, c.project_id, c.content from canvases c
         join projects p on p.id = c.project_id
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where c.id = $1 and wm.user_id = $2`,
        [canvasId, user.id],
      );
      const row = rows[0];
      if (!row) throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
      return { id: row.id, name: row.name, projectId: row.project_id, content: row.content as CanvasContent };
    },
    async saveCanvasContent(user: AuthenticatedUser, canvasId: string, content: CanvasContent) {
      const result = await db.query(
        `update canvases c set content = $1, updated_at = now()
         from projects p join workspace_members wm on wm.workspace_id = p.workspace_id
         where c.id = $2 and p.id = c.project_id and wm.user_id = $3`,
        [JSON.stringify(content), canvasId, user.id],
      );
      if (!result.rowCount) throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
    },
  };
}
