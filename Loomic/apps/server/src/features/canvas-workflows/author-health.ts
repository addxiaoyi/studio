import { GoogleAuth } from "google-auth-library";
import type { ServerEnv } from "../../config/env.js";
import type { SettingsService } from "../settings/settings-service.js";

type Env = Pick<ServerEnv, "openAIApiBase" | "openAIApiKey">;
type Config = Awaited<ReturnType<SettingsService["getChatModelConfig"]>>;
export type WorkflowAuthorHealth = { ready: boolean; message: string };
export type WorkflowAuthorCheck = (scope: {
  workspaceId: string;
  userId: string;
}) => Promise<WorkflowAuthorHealth>;
const CHECK_TIMEOUT_MS = 5_000;

function responseStatus(cause: unknown): number | null {
  if (!cause || typeof cause !== "object" || !("response" in cause))
    return null;
  const response = cause.response;
  return response &&
    typeof response === "object" &&
    "status" in response &&
    typeof response.status === "number"
    ? response.status
    : null;
}
function statusMessage(status: number) {
  if (status === 401 || status === 403)
    return "编剧连接认证失败，请检查 API 密钥或服务权限。";
  if (status === 429) return "编剧服务正在限流或额度不足，请稍后重试。";
  if (status === 404) return "编剧模型或服务地址不可用，请检查配置。";
  return "编剧服务暂时不可用，请稍后重试。";
}

export async function inspectConfiguredAuthor(
  env: Env,
  config: Config,
): Promise<WorkflowAuthorHealth> {
  const split = config.model.indexOf(":");
  const provider = split > 0 ? config.model.slice(0, split) : "openai";
  const name = split > 0 ? config.model.slice(split + 1) : config.model;
  const googleName = name
    .replace(/^models\//, "")
    .replace(/^publishers\/google\/models\//, "");
  if (!name.trim()) return { ready: false, message: "请配置编剧模型。" };
  try {
    if (
      provider === "google" &&
      process.env.GOOGLE_VERTEX_PROJECT &&
      process.env.GOOGLE_VERTEX_LOCATION
    ) {
      const location = process.env.GOOGLE_VERTEX_LOCATION;
      if (!/^[a-z0-9-]+$/.test(location))
        return { ready: false, message: "编剧 Vertex 区域配置无效。" };
      const auth = new GoogleAuth({
        projectId: process.env.GOOGLE_VERTEX_PROJECT,
        scopes: "https://www.googleapis.com/auth/cloud-platform",
      });
      // Publisher metadata uses a global resource name; the project belongs in quota headers.
      const host =
        location === "global"
          ? "aiplatform.googleapis.com"
          : `${location}-aiplatform.googleapis.com`;
      const url = `https://${host}/v1/publishers/google/models/${encodeURIComponent(googleName)}`;
      const response = await auth.fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        redirect: "error",
        headers: { "x-goog-user-project": process.env.GOOGLE_VERTEX_PROJECT },
      });
      return response.status === 200
        ? { ready: true, message: "编剧连接检查已通过。" }
        : { ready: false, message: statusMessage(response.status) };
    }
    let url: URL;
    let headers: Record<string, string>;
    if (provider === "google") {
      const key = process.env.GOOGLE_API_KEY;
      if (!key) return { ready: false, message: "尚未配置 Google 编剧凭据。" };
      url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(googleName)}`,
      );
      headers = { "x-goog-api-key": key };
    } else {
      const key =
        config.apiKey ?? process.env.OPENAI_API_KEY ?? env.openAIApiKey;
      if (!key?.trim())
        return { ready: false, message: "尚未配置编剧 API 密钥。" };
      const base =
        config.baseUrl ??
        env.openAIApiBase ??
        process.env.OPENAI_BASE_URL ??
        "https://api.openai.com/v1";
      url = new URL(`${base.replace(/\/$/, "")}/models`);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        return {
          ready: false,
          message: "编剧服务地址需要有效的 HTTP(S) 接口地址。",
        };
      }
      headers = { Authorization: `Bearer ${key}` };
    }
    const response = await fetch(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok
      ? { ready: true, message: "编剧连接检查已通过。" }
      : { ready: false, message: statusMessage(response.status) };
  } catch (cause) {
    const status = responseStatus(cause);
    return {
      ready: false,
      message: status
        ? statusMessage(status)
        : "编剧连接检查失败或超时，请检查连接后重试。",
    };
  }
}

export function createWorkflowAuthorCheck(
  env: Env,
  settings: SettingsService,
): WorkflowAuthorCheck {
  return async ({ workspaceId, userId }) => {
    const config = await settings.getChatModelConfig(
      { id: userId, email: "", accessToken: "", userMetadata: {} },
      workspaceId,
    );
    return inspectConfiguredAuthor(env, config);
  };
}
