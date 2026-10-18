import type { Pool } from "pg";
import type { WorkspaceSettings } from "@helstera/shared";
import type { AuthenticatedUser } from "../auth/types.js";
import { SettingsServiceError, type SettingsService } from "../features/settings/settings-service.js";
import { openModelSecret } from "./model-settings-crypto.js";

const DEFAULT_FALLBACK_MODEL = "auto";
const MAX_MODEL_ID_LENGTH = 200;

export function createLocalSettingsService(db: Pool): SettingsService {
  return {
    async getWorkspaceSettings(user: AuthenticatedUser, workspaceId: string) {
      const { rows } = await db.query("select default_model, chat_model, auto_approve_paid_generation, auto_delete_empty_canvas from workspace_settings where workspace_id = $1", [workspaceId]);
      const configuredModel = rows[0]?.default_model?.trim();
      const fallbackModel = process.env.HELSTERA_AGENT_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
      const selectedModel = configuredModel?.replace(/^openai:/, "");
      const hasValidCustomModel = Boolean(
        selectedModel &&
        selectedModel.length <= MAX_MODEL_ID_LENGTH &&
        !/[\u0000-\u001f\u007f]/.test(selectedModel),
      );
      const chatModel = normalizeModel(rows[0]?.chat_model) ?? (hasValidCustomModel ? selectedModel : fallbackModel);
      return { defaultModel: hasValidCustomModel ? selectedModel : fallbackModel, chatModel, autoApprovePaidGeneration: Boolean(rows[0]?.auto_approve_paid_generation), autoDeleteEmptyCanvas: Boolean(rows[0]?.auto_delete_empty_canvas) };
    },
    async getChatModelConfig(user: AuthenticatedUser, workspaceId: string) {
      const settings = await db.query("select chat_model, default_model, chat_model_url, chat_model_key_ciphertext, default_model_url, default_model_key_ciphertext from workspace_settings where workspace_id = $1", [workspaceId]);
      const row = settings.rows[0];
      const model = normalizeModel(row?.chat_model) ?? normalizeModel(row?.default_model) ?? process.env.HELSTERA_AGENT_MODEL?.trim() ?? DEFAULT_FALLBACK_MODEL;
      return {
        model,
        ...(typeof (row?.chat_model_url || row?.default_model_url) === "string" && (row.chat_model_url || row.default_model_url)?.trim() ? { baseUrl: (row.chat_model_url || row.default_model_url).trim() } : {}),
        ...(typeof (row?.chat_model_key_ciphertext || row?.default_model_key_ciphertext) === "string" && (row.chat_model_key_ciphertext || row.default_model_key_ciphertext) ? { apiKey: openModelSecret(row.chat_model_key_ciphertext || row.default_model_key_ciphertext) } : {}),
      };
    },
    async updateWorkspaceSettings(user: AuthenticatedUser, workspaceId: string, settings: WorkspaceSettings) {
      await assertOwner(db, user.id, workspaceId);
      return settings;
    },
  };
}

function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim().replace(/^openai:/, "");
  return model && model.length <= MAX_MODEL_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(model) ? model : null;
}

async function assertOwner(db: Pool, userId: string, workspaceId: string) {
  const { rowCount } = await db.query("select 1 from workspace_members where workspace_id = $1 and user_id = $2 and role in ('owner', 'admin')", [workspaceId, userId]);
  if (!rowCount) throw new SettingsServiceError("settings_not_found", "Workspace not found.", 404);
}
