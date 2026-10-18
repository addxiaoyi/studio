import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { Pool } from "pg";
import {
  createDefaultModelSpecifier,
  createStreamingChatModel,
} from "../../../agent/deep-agent.js";
import type { ServerEnv } from "../../../config/env.js";
import {
  feedStructurePayloadSchema,
  feedStructureSchema,
  type FeedStructure,
  type FeedStructurePayload,
  type AnyBackgroundJobType,
} from "@helstera/shared";
import { registerExecutor, type ExecutorContext } from "../job-executor.js";

type ModelFactory = (
  specifier: string,
  env: Pick<ServerEnv, "openAIApiBase" | "openAIApiKey">,
  promptCacheKey?: string,
) => BaseLanguageModel;

export type FeedStructureExecutorDeps = {
  createModel?: ModelFactory;
};

type FeedPackageRow = {
  id: string;
  workspace_id: string;
  title: string;
  topic: string | null;
  brief: string;
  goal: string | null;
  content_type: string;
  platforms: string[];
  duration_seconds: number;
  status: string;
  structure: Record<string, unknown> | null;
};

type JobRow = {
  payload: Record<string, unknown>;
};

type ModelResponse = {
  content?: unknown;
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  response_metadata?: {
    tokenUsage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
};

const FEED_STRUCTURE_JOB_TYPE: AnyBackgroundJobType = "feed_structure";

export async function executeFeedStructureJob(
  jobId: string,
  _rawPayload: Record<string, unknown>,
  ctx: ExecutorContext,
  deps: FeedStructureExecutorDeps = {},
): Promise<Record<string, unknown>> {
  const job = await loadJob(ctx, jobId);
  const parsedPayload = feedStructurePayloadSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    throw feedStructureError(
      "invalid_input",
      `结构化任务参数不合法: ${parsedPayload.error.message}`,
    );
  }

  const payload = parsedPayload.data;
  const feedPackage = await loadFeedPackage(ctx, payload);
  const existing = payload.existing_structure ?? feedPackage.structure ?? {};
  const existingValidation = feedStructureSchema.partial().safeParse(existing);
  if (!existingValidation.success) {
    throw feedStructureError(
      "feed_structure_existing_invalid",
      `内容包已有结构不合法，未执行覆盖: ${existingValidation.error.message}`,
    );
  }

  await ctx.jobService.updateProgress(jobId, 10, "读取内容包结构");

  const existingFull = feedStructureSchema.safeParse(existing);
  if (existingFull.success) {
    await saveStructure(ctx, payload, feedPackage, existing);
    await savePlatformDrafts(ctx, feedPackage, existing);
    await ctx.jobService.updateProgress(jobId, 100, "结构已完整，无需重复生成");
    return {
      feed_package_id: payload.feed_package_id,
      structure: existing,
      model_skipped: true,
      preserved_fields: Object.keys(existing),
    };
  }

  const modelSpecifier = payload.model ?? createDefaultModelSpecifier(ctx.env);
  const model = (deps.createModel ?? createStreamingChatModel)(
    modelSpecifier,
    ctx.env,
    "feed-structure-v1",
  );

  await ctx.jobService.updateProgress(jobId, 25, "生成结构化内容");
  const response = await invokeModel(model, buildStructurePrompt(payload, feedPackage, existing));
  const modelStructure = parseModelStructure(response);
  const modelValidation = feedStructureSchema.partial().safeParse(modelStructure);
  if (!modelValidation.success) {
    throw feedStructureError(
      "feed_structure_invalid_output",
      `结构化模型返回内容不符合协议: ${modelValidation.error.message}`,
    );
  }

  const merged = mergeStructure(modelStructure, existing);
  const finalValidation = feedStructureSchema.safeParse(merged);
  if (!finalValidation.success) {
    throw feedStructureError(
      "feed_structure_incomplete",
      `结构化内容缺少必填字段: ${finalValidation.error.message}`,
    );
  }

  await ctx.jobService.updateProgress(jobId, 75, "校验并保存结构");
  await saveStructure(ctx, payload, feedPackage, merged);
  await savePlatformDrafts(ctx, feedPackage, merged);
  await ctx.jobService.updateProgress(jobId, 100, "结构化内容生成完成");

  const usage = extractUsage(response);
  return {
    feed_package_id: payload.feed_package_id,
    structure: merged,
    model: modelSpecifier,
    generated_fields: Object.keys(modelStructure).filter((key) => !(key in existing)),
    preserved_fields: Object.keys(existing),
    ...(usage ? { usage } : {}),
  };
}

async function savePlatformDrafts(
  ctx: ExecutorContext,
  feedPackage: FeedPackageRow,
  structure: Record<string, unknown>,
): Promise<void> {
  if (!ctx.localDb) return;
  const hook = typeof structure.hook === "string" ? structure.hook : feedPackage.title;
  const cta = typeof structure.cta === "string" ? structure.cta : "了解更多";
  const body = typeof structure.angle === "string" ? structure.angle : feedPackage.brief;
  const hashtags = Array.isArray(structure.evidence)
    ? structure.evidence.filter((item): item is string => typeof item === "string").slice(0, 5).map((item) => item.replace(/\s+/g, "").slice(0, 24))
    : [];
  for (const platform of feedPackage.platforms) {
    await ctx.localDb.query(
      `insert into content_variants(package_id,platform,title,body,hashtags,cover_text,metadata)
       values($1,$2,$3,$4,$5,$6,$7::jsonb)
       on conflict(package_id,platform,version) do update
       set title=excluded.title, body=excluded.body, hashtags=excluded.hashtags, cover_text=excluded.cover_text,
           metadata=excluded.metadata, updated_at=now()
       where content_variants.locked = false`,
      [feedPackage.id, platform, hook, `${body}\n\n${cta}`, hashtags, hook, JSON.stringify({ generatedBy: "feed-automation", generatedAt: new Date().toISOString() })],
    );
  }
}

async function loadJob(ctx: ExecutorContext, jobId: string): Promise<JobRow> {
  if (ctx.localDb) {
    const { rows } = await ctx.localDb.query<JobRow>(
      "select payload from background_jobs where id=$1",
      [jobId],
    );
    const row = rows[0];
    if (!row) throw feedStructureError("job_not_found", `结构化任务 ${jobId} 不存在`);
    return row;
  }

  const { data, error } = await (ctx.getAdminClient() as any)
    .from("background_jobs")
    .select("payload")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`读取结构化任务失败: ${error.message}`);
  if (!data) throw feedStructureError("job_not_found", `结构化任务 ${jobId} 不存在`);
  return data as JobRow;
}

async function loadFeedPackage(
  ctx: ExecutorContext,
  payload: FeedStructurePayload,
): Promise<FeedPackageRow> {
  const columns = "id,workspace_id,title,topic,brief,goal,content_type,platforms,duration_seconds,status,structure";
  if (ctx.localDb) {
    const { rows } = await ctx.localDb.query<FeedPackageRow>(
      `select ${columns} from content_packages where id=$1 and workspace_id=$2`,
      [payload.feed_package_id, payload.feed_workspace_id],
    );
    const row = rows[0];
    if (!row) throw feedStructureError("feed_package_not_found", "内容包不存在或不属于当前工作区");
    return row;
  }

  const { data, error } = await (ctx.getAdminClient() as any)
    .from("content_packages")
    .select(columns)
    .eq("id", payload.feed_package_id)
    .eq("workspace_id", payload.feed_workspace_id)
    .maybeSingle();
  if (error) throw new Error(`读取内容包失败: ${error.message}`);
  if (!data) throw feedStructureError("feed_package_not_found", "内容包不存在或不属于当前工作区");
  return data as FeedPackageRow;
}

async function saveStructure(
  ctx: ExecutorContext,
  payload: FeedStructurePayload,
  feedPackage: FeedPackageRow,
  structure: Record<string, unknown>,
): Promise<void> {
  const nextStatus = ["draft", "structured"].includes(feedPackage.status)
    ? "structured"
    : feedPackage.status;

  if (ctx.localDb) {
    const { rowCount } = await ctx.localDb.query(
      `update content_packages
       set structure=$1, status=$2, updated_at=now()
       where id=$3 and workspace_id=$4`,
      [JSON.stringify(structure), nextStatus, payload.feed_package_id, payload.feed_workspace_id],
    );
    if (!rowCount) throw feedStructureError("feed_package_update_failed", "内容包结构保存失败");
    return;
  }

  const { error } = await (ctx.getAdminClient() as any)
    .from("content_packages")
    .update({ structure, status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", payload.feed_package_id)
    .eq("workspace_id", payload.feed_workspace_id);
  if (error) throw new Error(`保存内容包结构失败: ${error.message}`);
}

function buildStructurePrompt(
  payload: FeedStructurePayload,
  feedPackage: FeedPackageRow,
  existing: Record<string, unknown>,
): string {
  const context = {
    title: feedPackage.title || payload.title,
    topic: feedPackage.topic ?? payload.topic ?? "",
    brief: feedPackage.brief || payload.brief,
    goal: feedPackage.goal ?? payload.goal ?? "",
    contentType: feedPackage.content_type || payload.content_type || "",
    platforms: feedPackage.platforms.length ? feedPackage.platforms : payload.platforms ?? [],
    durationSeconds: feedPackage.duration_seconds || payload.duration_seconds,
    existingStructure: existing,
  };

  return [
    "你是短视频与社媒内容策划助手。请根据输入生成一个可执行的内容结构 JSON。",
    "只返回 JSON 对象，不要 Markdown、解释、代码围栏或额外文字。",
    "已有结构中的字段是用户确认过的内容：只补齐缺失字段，绝对不要改写已有字段。",
    "必须包含 title、audience、painPoint、angle、hypothesis、hook、evidence、cta、riskNotes、imagePrompt、videoPrompt、shots。",
    "shots 必须覆盖完整时长，包含 id、startSecond、endSecond、visual、voiceover、subtitle。",
    "商品参数、价格、功效和事实只能使用输入中明确提供的信息；不确定内容写入 riskNotes。",
    JSON.stringify(context),
  ].join("\n");
}

async function invokeModel(model: BaseLanguageModel, prompt: string): Promise<ModelResponse> {
  try {
    return (await model.invoke(prompt)) as ModelResponse;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped = feedStructureError("feed_structure_model_error", `结构化模型调用失败: ${detail}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

function parseModelStructure(response: ModelResponse): Record<string, unknown> {
  const text = readText(response.content).trim();
  if (!text) throw feedStructureError("feed_structure_invalid_output", "结构化模型返回为空");

  const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let candidate = normalized;
  try {
    return unwrapStructure(JSON.parse(candidate));
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw feedStructureError("feed_structure_invalid_output", "结构化模型未返回有效 JSON 对象");
    }
    candidate = normalized.slice(start, end + 1);
  }

  try {
    return unwrapStructure(JSON.parse(candidate));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw feedStructureError("feed_structure_invalid_output", `结构化模型 JSON 解析失败: ${detail}`);
  }
}

function unwrapStructure(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw feedStructureError("feed_structure_invalid_output", "结构化模型返回的 JSON 不是对象");
  }
  const nested = value.structure;
  return isRecord(nested) ? nested : value;
}

function mergeStructure(
  generated: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  return { ...generated, ...existing };
}

function readText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function extractUsage(response: ModelResponse): { inputTokens: number; outputTokens: number } | null {
  const usage = response.usage_metadata;
  if (usage?.input_tokens != null && usage.output_tokens != null) {
    return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }
  const tokenUsage = response.response_metadata?.tokenUsage;
  if (tokenUsage?.promptTokens != null && tokenUsage.completionTokens != null) {
    return { inputTokens: tokenUsage.promptTokens, outputTokens: tokenUsage.completionTokens };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function feedStructureError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

registerExecutor(
  FEED_STRUCTURE_JOB_TYPE,
  (jobId, payload, ctx) => executeFeedStructureJob(jobId, payload, ctx),
);

export async function enqueueFeedStructureJob(
  db: Pool,
  input: FeedStructurePayload & { created_by: string },
): Promise<{ id: string; queueName: string }> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string }>(
      `select id from background_jobs
       where workspace_id=$1 and job_type='feed_structure'
         and payload->>'feed_package_id'=$2
         and status not in ('failed','dead_letter','canceled')
       order by created_at desc limit 1`,
      [input.feed_workspace_id, input.feed_package_id],
    );
    if (existing.rows[0]) {
      await client.query("commit");
      return { id: existing.rows[0].id, queueName: "feed_structure_jobs" };
    }
    const created = await client.query<{ id: string }>(
      `insert into background_jobs(workspace_id,queue_name,job_type,status,payload,created_by,stage)
       values($1,'feed_structure_jobs','feed_structure','queued',$2,$3,'等待结构化模型') returning id`,
      [input.feed_workspace_id, JSON.stringify(input), input.created_by],
    );
    const id = created.rows[0]?.id;
    if (!id) throw new Error("结构化任务创建失败");
    const available = await client.query<{ available: boolean }>(
      "select to_regprocedure('pgmq.send(text,jsonb,integer)') is not null as available",
    );
    if (available.rows[0]?.available) {
      await client.query("select pgmq.send($1::text,$2::jsonb,0)", ["feed_structure_jobs", JSON.stringify({ job_id: id, job_type: "feed_structure", workspace_id: input.feed_workspace_id })]);
    }
    await client.query("commit");
    return { id, queueName: "feed_structure_jobs" };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
