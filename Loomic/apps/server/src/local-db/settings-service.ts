import type { Pool } from "pg";
import type { WorkspaceSettings } from "@helstera/shared";
import type { AuthenticatedUser } from "../supabase/user.js";
import { SettingsServiceError, type SettingsService } from "../features/settings/settings-service.js";

const FALLBACK_MODEL = "gpt-5.4-mini";

export function createLocalSettingsService(db: Pool): SettingsService {
  return {
    async getWorkspaceSettings(user: AuthenticatedUser, workspaceId: string) {
      await assertOwner(db, user.id, workspaceId);
      const { rows } = await db.query("select default_model from workspace_settings where workspace_id = $1", [workspaceId]);
      return { defaultModel: rows[0]?.default_model ?? FALLBACK_MODEL };
    },
    async updateWorkspaceSettings(user: AuthenticatedUser, workspaceId: string, settings: WorkspaceSettings) {
      await assertOwner(db, user.id, workspaceId);
      await db.query("insert into workspace_settings (workspace_id, default_model) values ($1, $2) on conflict (workspace_id) do update set default_model = excluded.default_model, updated_at = now()", [workspaceId, settings.defaultModel]);
      return settings;
    },
  };
}

async function assertOwner(db: Pool, userId: string, workspaceId: string) {
  const { rowCount } = await db.query("select 1 from workspace_members where workspace_id = $1 and user_id = $2 and role in ('owner', 'admin')", [workspaceId, userId]);
  if (!rowCount) throw new SettingsServiceError("settings_not_found", "Workspace not found.", 404);
}
