import type { WorkspaceSettings } from "@helstera/shared";

import type { AuthenticatedUser, DataClient } from "../../auth/types.js";

const FALLBACK_MODEL = "gpt-5.4-mini";

export class SettingsServiceError extends Error {
  readonly statusCode: number;
  readonly code:
    | "settings_not_found"
    | "settings_read_failed"
    | "settings_update_failed";

  constructor(
    code:
      | "settings_not_found"
      | "settings_read_failed"
      | "settings_update_failed",
    message: string,
    statusCode: number,
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type SettingsService = {
  getWorkspaceSettings(
    user: AuthenticatedUser,
    workspaceId: string,
  ): Promise<WorkspaceSettings>;
  updateWorkspaceSettings(
    user: AuthenticatedUser,
    workspaceId: string,
    settings: WorkspaceSettings,
  ): Promise<WorkspaceSettings>;
  getChatModelConfig(
    user: AuthenticatedUser,
    workspaceId: string,
  ): Promise<{ model: string; baseUrl?: string; apiKey?: string }>;
};

export function createSettingsService(options: {
  createUserClient: (accessToken: string) => DataClient;
  /** Override the fallback model when no workspace setting exists. */
  defaultModel?: string;
}): SettingsService {
  const defaultModel = options.defaultModel ?? FALLBACK_MODEL;

  return {
    async getWorkspaceSettings(user, workspaceId) {
      const client = options.createUserClient(user.accessToken);
      const { data, error } = await client
        .from("workspace_settings")
        .select("default_model, chat_model, auto_approve_paid_generation, auto_delete_empty_canvas")
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (error) {
        throw new SettingsServiceError(
          "settings_read_failed",
          "Unable to load workspace settings.",
          500,
        );
      }

      return {
        defaultModel: data?.default_model ?? defaultModel,
        chatModel: data?.chat_model ?? data?.default_model ?? defaultModel,
        autoApprovePaidGeneration: Boolean(data?.auto_approve_paid_generation),
        autoDeleteEmptyCanvas: Boolean(data?.auto_delete_empty_canvas),
      };
    },

    async updateWorkspaceSettings(user, workspaceId, settings) {
      const client = options.createUserClient(user.accessToken);
      const { error } = await client
        .from("workspace_settings")
        .upsert(
          {
            workspace_id: workspaceId,
            default_model: settings.defaultModel,
            chat_model: settings.chatModel ?? settings.defaultModel,
            auto_approve_paid_generation: settings.autoApprovePaidGeneration,
            auto_delete_empty_canvas: settings.autoDeleteEmptyCanvas,
          },
          { onConflict: "workspace_id" },
        );

      if (error) {
        throw new SettingsServiceError(
          "settings_update_failed",
          "Unable to update workspace settings.",
          500,
        );
      }

      return settings;
    },
    async getChatModelConfig(user, workspaceId) {
      const settings = await this.getWorkspaceSettings(user, workspaceId);
      return { model: settings.chatModel ?? settings.defaultModel };
    },
  };
}
