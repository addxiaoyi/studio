import type { FastifyInstance } from "fastify";

import { type ModelInfo, modelListResponseSchema } from "@helstera/shared";
import type { ServerEnv } from "../config/env.js";

type OpenAIModelList = { data?: Array<{ id?: unknown }> };

const VERIFIED_AGENT_MODELS = new Set([
  "deepseek-v4-pro", "auto",
]);

function displayName(modelId: string): string {
  if (modelId === "auto") return "Auto Route";
  if (modelId.startsWith("hy")) return `Hunyuan ${modelId.toUpperCase().replaceAll("-", " ")}`;
  if (modelId.startsWith("glm-")) return modelId.toUpperCase().replaceAll("-", " ");
  if (modelId.startsWith("minimax-")) return modelId.replace("minimax-", "MiniMax ").toUpperCase();
  if (modelId.startsWith("kimi-")) return modelId.replace("kimi-", "Kimi ").toUpperCase();
  if (modelId.startsWith("deepseek-")) return modelId.replace("deepseek-", "DeepSeek ").toUpperCase();
  return modelId;
}

function providerName(modelId: string): string {
  if (modelId.startsWith("hy")) return "hunyuan";
  if (modelId.startsWith("glm-")) return "zhipu";
  if (modelId.startsWith("minimax-")) return "minimax";
  if (modelId.startsWith("kimi-")) return "moonshot";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  return "gateway";
}

async function loadOpenAIModels(env: ServerEnv): Promise<ModelInfo[]> {
  if (!env.openAIApiKey) return [];
  const baseUrl = (env.openAIApiBase ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${env.openAIApiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Agent model gateway returned ${response.status}`);
  const body = await response.json() as OpenAIModelList;
  const ids = [...new Set(
    (body.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string" && VERIFIED_AGENT_MODELS.has(id)),
  )];
  const configuredModel = env.agentModel.replace(/^openai:/, "");
  if (VERIFIED_AGENT_MODELS.has(configuredModel) && configuredModel !== "auto" && !ids.includes(configuredModel)) {
    ids.push(configuredModel);
  }
  return ids.map((id) => ({ id: `openai:${id}`, name: displayName(id), provider: providerName(id) }));
}

export async function registerModelRoutes(app: FastifyInstance, env: ServerEnv) {
  app.get("/api/models", async (request, reply) => {
    try {
      const models = await loadOpenAIModels(env);
      return reply.code(200).send(modelListResponseSchema.parse({ models }));
    } catch (error) {
      request.log.error({ reason: error instanceof Error ? error.message : String(error) }, "failed to load agent models");
      return reply.code(200).send(modelListResponseSchema.parse({ models: [] }));
    }
  });
}
