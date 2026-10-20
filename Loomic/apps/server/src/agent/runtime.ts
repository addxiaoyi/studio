// @credits-system — Agent tool runtime with credit checks before image/video generation
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { Pool } from "pg";
import { HumanMessage } from "@langchain/core/messages";
import type {
  ImageAttachment,
  ImageGenerationPreference,
  MessageMention,
  RunCancelResponse,
  RunCreateRequest,
  RunCreateResponse,
  StreamEvent,
  VideoGenerationPreference,
} from "@helstera/shared";

import type { ServerEnv } from "../config/env.js";
import { createPipelineLogger } from "../ws/logger.js";
import type { AgentRunMetadataService } from "../features/agent-runs/agent-run-service.js";
import type { JobService } from "../features/jobs/job-service.js";
import type { ViewerService } from "../features/bootstrap/ensure-user-foundation.js";
import type { AuthenticatedUser, DataClient } from "../auth/types.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
// execute 工具由 deepagents 内置提供（LocalShellBackend 作为 sandbox backend）
// 不需要自定义代码执行工具
import type { SubmitImageJobFn } from "./tools/image-generate.js";
import { singleImageSubmission } from "./image-submission.js";
import { resolveImageReferences } from "./image-references.js";
import type { SubmitVideoJobFn } from "./tools/video-generate.js";
import type { SubmitWebsiteCaptureFn } from "./tools/website-capture.js";
import type { CreditService } from "../features/credits/credit-service.js";
import { TierGuardError, type TierGuard } from "../features/credits/tier-guard.js";
import { type BillingErrorCode, type ImageQualityLevel } from "@helstera/shared";
import { createAgentBackend } from "./backends/index.js";
import {
  type HelsteraAgent,
  type HelsteraAgentFactory,
  createDefaultModelSpecifier,
  createHelsteraDeepAgent,
} from "./deep-agent.js";
import type { AgentPersistenceService } from "./persistence/index.js";
import { adaptDeepAgentStream } from "./stream-adapter.js";
import { classifyErrorForClient } from "../utils/error-sanitizer.js";
import { loadLocalWorkspaceSkills, loadWorkspaceSkills, type WorkspaceSkillEntry } from "./workspace-skills.js";
import { buildCanvasSummaryForContext } from "./tools/inspect-canvas.js";
import { insertImageElement, insertLocalImageElement, insertLocalVideoElement, insertVideoElement } from "../features/canvas/canvas-element-writer.js";
import type { StorageProvider } from "../storage/index.js";
import { resolveConfiguredModel } from "../http/model-availability.js";
import { buildMediaRoute } from "../features/media/media-routing.js";
import { isRemovedModelId } from "../generation/removed-models.js";
import { getModelCallProfile } from "../local-db/model-call-profiles.js";
import type { createGenerationApprovalService } from "../features/generation/generation-approval-service.js";

const MAX_PERSISTED_IMAGE_BYTES = 25 * 1024 * 1024;
const PERSIST_IMAGE_TIMEOUT_MS = 30_000;

async function readImageResponse(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_PERSISTED_IMAGE_BYTES) {
    throw new Error("Generated image exceeds the 25MB persistence limit");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_PERSISTED_IMAGE_BYTES) {
        throw new Error("Generated image exceeds the 25MB persistence limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/**
 * Build the text portion of a user message, appending <input_images> XML
 * tags when attachments are present so the LLM can reference them by assetId.
 */
export function buildUserMessage(
  prompt: string,
  attachments: ImageAttachment[],
  imageGenerationPreference?: ImageGenerationPreference,
  mentions: MessageMention[] = [],
  videoGenerationPreference?: VideoGenerationPreference,
  canvasSummary?: string | null,
): { text: string } {
  const xmlBlocks: string[] = [];

  // Canvas state context (auto-injected, not user-provided)
  if (canvasSummary) {
    xmlBlocks.push(`<canvas_state>\n${canvasSummary}\n</canvas_state>`);
  }

  const inputImagesXml = buildInputImagesXml(attachments);
  if (inputImagesXml) xmlBlocks.push(inputImagesXml);

  const imageGenerationPreferenceXml = buildImageGenerationPreferenceXml(
    imageGenerationPreference,
  );
  if (imageGenerationPreferenceXml) xmlBlocks.push(imageGenerationPreferenceXml);

  const videoGenerationPreferenceXml = buildVideoGenerationPreferenceXml(
    videoGenerationPreference,
  );
  if (videoGenerationPreferenceXml) xmlBlocks.push(videoGenerationPreferenceXml);

  const mentionXmlBlocks = buildMentionXmlBlocks(mentions);
  xmlBlocks.push(...mentionXmlBlocks);

  if (!xmlBlocks.length) return { text: prompt };
  return { text: `${prompt}\n\n${xmlBlocks.join("\n\n")}` };
}

function buildInputImagesXml(attachments: ImageAttachment[]): string | null {
  if (attachments.length === 0) return null;

  const imageXml = attachments
    .map((attachment, i) => {
      const nameAttr = attachment.name
        ? ` name="${escapeXmlAttribute(attachment.name)}"`
        : "";
      return `<image index="${i + 1}" asset_id="${escapeXmlAttribute(attachment.assetId)}" mime_type="${escapeXmlAttribute(attachment.mimeType)}"${nameAttr} />`;
    })
    .join("\n  ");

  return `<input_images count="${attachments.length}">\n  ${imageXml}\n</input_images>`;
}

function supportsVisionInput(model: unknown): boolean {
  if (typeof model !== "string") return false;
  return false;
}

function buildImageGenerationPreferenceXml(
  imageGenerationPreference?: ImageGenerationPreference,
): string | null {
  if (
    imageGenerationPreference?.mode !== "manual" ||
    imageGenerationPreference.models.length === 0
  ) {
    return null;
  }

  const modelXml = imageGenerationPreference.models
    .map(
      (model, i) =>
        `<preferred_model index="${i + 1}" id="${escapeXmlAttribute(model)}" />`,
    )
    .join("\n  ");

  return `<human_image_generation_preference mode="manual" strict="true" count="${imageGenerationPreference.models.length}">\n  ${modelXml}\n  <instruction>优先且只能使用用户选择的模型；不可擅自切换、回退或使用选择范围之外的模型。若所选模型不可用，停止并提示用户更换模型。</instruction>\n</human_image_generation_preference>`;
}

function buildVideoGenerationPreferenceXml(
  videoGenerationPreference?: VideoGenerationPreference,
): string | null {
  if (!videoGenerationPreference) return null;

  const modelXml = videoGenerationPreference.models
    .map(
      (model, i) =>
        `<preferred_model index="${i + 1}" id="${escapeXmlAttribute(model)}" />`,
    )
    .join("\n  ");

  const durationXml = videoGenerationPreference.duration == null
    ? ""
    : ` duration="${videoGenerationPreference.duration}"`;
  const body = modelXml ? `\n  ${modelXml}\n` : "";
  const strictXml = videoGenerationPreference.mode === "manual"
    ? "\n  <instruction>优先且只能使用用户选择的视频模型；不可擅自切换、回退或使用选择范围之外的模型。若所选模型不可用，停止并提示用户更换模型。</instruction>"
    : "";
  return `<human_video_generation_preference mode="${videoGenerationPreference.mode}" count="${videoGenerationPreference.models.length}"${durationXml}>${body}${strictXml}\n</human_video_generation_preference>`;
}

function explicitVideoDuration(prompt: string): number | undefined {
  const match = prompt.match(/(?:^|\s)(\d{1,2})\s*(?:s|sec(?:onds)?|秒)(?:\s|$)/i);
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isInteger(seconds) && seconds >= 3 && seconds <= 30 ? seconds : undefined;
}

function buildMentionXmlBlocks(mentions: MessageMention[]): string[] {
  const xmlBlocks: string[] = [];

  const mentionedModels = mentions.filter(
    (mention): mention is Extract<MessageMention, { mentionType: "image-model" }> =>
      mention.mentionType === "image-model",
  );
  if (mentionedModels.length > 0) {
    const modelXml = mentionedModels
      .map(
        (mention, i) =>
          `<model index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" display_name="${escapeXmlAttribute(mention.label)}" />`,
      )
      .join("\n  ");

    xmlBlocks.push(
      `<human_image_model_mentions count="${mentionedModels.length}">\n  ${modelXml}\n</human_image_model_mentions>`,
    );
  }

  const mentionedBrandKitAssets = mentions.filter(
    (
      mention,
    ): mention is Extract<MessageMention, { mentionType: "brand-kit-asset" }> =>
      mention.mentionType === "brand-kit-asset",
  );
  if (mentionedBrandKitAssets.length > 0) {
    const assetXml = mentionedBrandKitAssets
      .map((mention, i) => {
        const textContentAttr =
          mention.textContent != null
            ? ` text_content="${escapeXmlAttribute(mention.textContent)}"`
            : "";
        const fileUrlAttr =
          mention.fileUrl != null
            ? ` file_url="${escapeXmlAttribute(mention.fileUrl)}"`
            : "";
        return `<brand_kit_asset index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" type="${escapeXmlAttribute(mention.assetType)}" display_name="${escapeXmlAttribute(mention.label)}"${textContentAttr}${fileUrlAttr} />`;
      })
      .join("\n  ");

    xmlBlocks.push(
      `<human_brand_kit_mentions count="${mentionedBrandKitAssets.length}">\n  ${assetXml}\n</human_brand_kit_mentions>`,
    );
  }

  // Skill mentions — tell the agent to read and follow the mentioned skill
  const mentionedSkills = mentions.filter(
    (
      mention,
    ): mention is Extract<MessageMention, { mentionType: "skill" }> =>
      mention.mentionType === "skill",
  );
  if (mentionedSkills.length > 0) {
    const skillXml = mentionedSkills
      .map(
        (mention, i) =>
          `<skill index="${i + 1}" id="${escapeXmlAttribute(mention.id)}" name="${escapeXmlAttribute(mention.label)}" slug="${escapeXmlAttribute(mention.slug)}">\nThe user explicitly requested this skill. Read \`/workspace-skills/${mention.slug}/SKILL.md\` for full instructions and follow them.\n</skill>`,
      )
      .join("\n  ");
    xmlBlocks.push(
      `<human_skill_mentions count="${mentionedSkills.length}">\n  ${skillXml}\n</human_skill_mentions>`,
    );
  }

  return xmlBlocks;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Build a lookup map from assetId to base64 data URI.
 * Stored in configurable so tools can resolve assetId references.
 */
export function buildAttachmentDataMap(
  downloaded: Array<{ assetId: string; mimeType: string; base64: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of downloaded) {
    map[d.assetId] = `data:${d.mimeType};base64,${d.base64}`;
  }
  return map;
}

type CanvasFile = Record<string, unknown>;
type CanvasContentWithFiles = {
  elements?: Array<Record<string, unknown>>;
  files?: Record<string, CanvasFile>;
};

const OSS_MARKER_PREFIX = "oss://";

function isVideoCanvasElement(element: Record<string, unknown>): boolean {
  const customData = element.customData;
  return (
    typeof customData === "object" &&
    customData !== null &&
    (customData as Record<string, unknown>).isVideo === true
  );
}

/**
 * Resolve the newest visible image on a canvas into a provider-ready source.
 * Canvas saves move base64 payloads to storage, so this deliberately supports
 * both the inline value used before a save and the persisted oss:// marker.
 */
export async function findCanvasReferenceImage(
  content: unknown,
  storage: StorageProvider,
): Promise<string | null> {
  if (typeof content !== "object" || content === null) return null;

  const canvas = content as CanvasContentWithFiles;
  if (!Array.isArray(canvas.elements) || !canvas.files) return null;

  const images = canvas.elements
    .filter(
      (element) =>
        !element.isDeleted &&
        element.type === "image" &&
        typeof element.fileId === "string" &&
        !isVideoCanvasElement(element),
    )
    .sort((left, right) => Number(right.updated ?? 0) - Number(left.updated ?? 0));

  for (const element of images) {
    const file = canvas.files[element.fileId as string];
    if (!file) continue;

    const inlineUrl = file.dataURL;
    if (typeof inlineUrl === "string" && inlineUrl.startsWith("data:image/")) {
      return inlineUrl;
    }

    const publicUrl = file.storageUrl;
    if (typeof publicUrl === "string" && /^https?:\/\//.test(publicUrl)) {
      return publicUrl;
    }

    if (typeof inlineUrl !== "string" || !inlineUrl.startsWith(OSS_MARKER_PREFIX)) {
      continue;
    }

    const ref = inlineUrl.slice(OSS_MARKER_PREFIX.length);
    const separator = ref.indexOf("/");
    if (separator < 1 || separator === ref.length - 1) continue;

    const bucket = ref.slice(0, separator);
    const objectPath = ref.slice(separator + 1);
    try {
      const { data: bytes, error } = await storage.download(bucket, objectPath);
      if (error || !bytes) {
        throw error ?? new Error("Canvas image storage returned no data");
      }
      const mimeType = typeof file.mimeType === "string" ? file.mimeType : "image/png";
      return `data:${mimeType};base64,${bytes.toString("base64")}`;
    } catch (error) {
      console.warn("[runtime] unable to resolve canvas image reference", {
        canvasFileId: element.fileId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

type RuntimeRunStatus =
  | "accepted"
  | "canceled"
  | "completed"
  | "failed"
  | "running";

type RuntimeRunRecord = RunCreateRequest & {
  accessToken?: string;
  consumed: boolean;
  controller: AbortController;
  modelOverride?: string;
  modelApiBase?: string;
  modelApiKey?: string;
  runId: string;
  status: RuntimeRunStatus;
  threadId?: string;
  userId?: string;
};

type CreateAgentRuntimeOptions = {
  localDb?: Pool;
  agentPersistenceService?: AgentPersistenceService;
  agentFactory?: HelsteraAgentFactory;
  agentRunMetadataService?: AgentRunMetadataService;
  connectionManager?: ConnectionManager;
  createUserClient?: (accessToken: string) => unknown;
  creditService?: CreditService;
  generationApprovalService?: ReturnType<typeof createGenerationApprovalService>;
  env: ServerEnv;
  eventDelayMs?: number;
  jobService?: JobService;
  model?: BaseLanguageModel | string;
  now?: () => string;
  runIdFactory?: () => string;
  tierGuard?: TierGuard;
  viewerService?: ViewerService;
  storage: StorageProvider;
};

export type AgentRunService = ReturnType<typeof createAgentRunService>;

export function createAgentRunService(options: CreateAgentRuntimeOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const runs = new Map<string, RuntimeRunRecord>();
  const runIdFactory =
    options.runIdFactory ??
    (() => randomUUID());

  const resolvedAgentFactory: HelsteraAgentFactory =
    options.agentFactory ??
    ((agentOptions) =>
      createHelsteraDeepAgent({
        ...agentOptions,
        ...(options.createUserClient
          ? { createUserClient: options.createUserClient }
          : {}),
      }));

  // ── Billing error helper: push WS event + abort run ──────────
  function pushBillingErrorAndAbort(
    run: { runId: string; conversationId: string; controller: AbortController },
    canvasId: string | undefined,
    opts: { connectionManager?: ConnectionManager },
    code: BillingErrorCode,
    message: string,
    extra?: {
      currentBalance?: number;
      requiredAmount?: number;
      plan?: string;
      dailyClaimed?: boolean;
    },
  ): void {
    const canvasTarget = canvasId ?? run.conversationId;
    if (!opts.connectionManager || !canvasTarget) {
      console.warn(`[billing] pushBillingErrorAndAbort: no connectionManager or canvasTarget, billing.error (${code}) not sent to client`);
    } else {
      opts.connectionManager.pushToCanvas(canvasTarget, {
        type: "billing.error",
        runId: run.runId,
        timestamp: new Date().toISOString(),
        code,
        message,
        ...extra,
      });
    }
    if (!run.controller.signal.aborted) {
      run.controller.abort();
    }
  }

  return {
    cancelRun(runId: string): RunCancelResponse | null {
      const run = runs.get(runId);
      if (!run) {
        return null;
      }

      if (!run.controller.signal.aborted) {
        run.controller.abort();
      }

      run.status = "canceled";
      return {
        runId,
        status: "canceled",
      };
    },

    createRun(
      input: RunCreateRequest,
    runOptions?: { accessToken?: string; model?: string; modelApiBase?: string; modelApiKey?: string; threadId?: string; userId?: string },
    ): RunCreateResponse {
      const runId = runIdFactory();
      const { accessToken: _ignoredAccessToken, ...runInput } = input;

      runs.set(runId, {
        ...runInput,
        ...(runOptions?.accessToken ? { accessToken: runOptions.accessToken } : {}),
        consumed: false,
        controller: new AbortController(),
        ...(runOptions?.model ? { modelOverride: runOptions.model } : {}),
        ...(runOptions?.modelApiBase ? { modelApiBase: runOptions.modelApiBase } : {}),
        ...(runOptions?.modelApiKey ? { modelApiKey: runOptions.modelApiKey } : {}),
        ...(runOptions?.threadId ? { threadId: runOptions.threadId } : {}),
        ...(runOptions?.userId ? { userId: runOptions.userId } : {}),
        runId,
        status: "accepted",
      });

      return {
        conversationId: input.conversationId,
        runId,
        sessionId: input.sessionId,
        status: "accepted",
      };
    },

    hasRun(runId: string) {
      return runs.has(runId);
    },

    async *streamRun(runId: string): AsyncGenerator<StreamEvent> {
      const run = runs.get(runId);
      if (!run) {
        throw new Error(`Run not found: ${runId}`);
      }

      if (run.consumed) {
        return;
      }

      if (run.controller.signal.aborted || run.status === "canceled") {
        run.consumed = true;
        run.status = "canceled";
        await updatePersistedRunCanceled(options.agentRunMetadataService, run, now);
        yield { runId, timestamp: now(), type: "run.canceled" };
        return;
      }

      run.consumed = true;
      run.status = "running";

      const rlog = createPipelineLogger("runtime", { runId });

      try {
        await updatePersistedRunStatus(
          options.agentRunMetadataService,
          run,
          "running",
        );
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        yield failedEvent;
        return;
      }

      let persistence: Awaited<
        ReturnType<NonNullable<AgentPersistenceService["getPersistence"]>>
      > | null = null;
      try {
        // Production backends persist /workspace and /memories through the
        // Store even for canvas-only runs. Checkpointing still requires a
        // thread id, but Store availability must not depend on one.
        persistence = options.agentPersistenceService
          ? await options.agentPersistenceService.getPersistence()
          : null;
        rlog.lap("persistence_init");
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        await updatePersistedRunFailure(
          options.agentRunMetadataService,
          run,
          now,
          error,
        );
        yield failedEvent;
        return;
      }

      if (run.threadId && !persistence) {
        const failedEvent = toFailedEvent(
          runId,
          now,
          new Error("DATABASE_URL is required for persisted agent threads."),
        );
        run.status = "failed";
        await updatePersistedRunFailure(
          options.agentRunMetadataService,
          run,
          now,
          new Error("DATABASE_URL is required for persisted agent threads."),
        );
        yield failedEvent;
        return;
      }

      // Build submitImageJob / submitVideoJob closures for async jobs via PGMQ
      let submitImageJob: SubmitImageJobFn | undefined;
      let submitVideoJob: SubmitVideoJobFn | undefined;
      let submitWebsiteCapture: SubmitWebsiteCaptureFn | undefined;
      let referenceImages: string[] = [];
      if (options.jobService && (options.localDb || options.createUserClient) && run.accessToken && run.userId) {
        const jobSvc = options.jobService;
        const createClient = options.createUserClient;
        const accessToken = run.accessToken;
        const userId = run.userId;
        const canvasId = run.canvasId;
        const sessionId = run.sessionId;
        const runId = run.runId;

        const submitImageJobOnce: SubmitImageJobFn = async (input) => {
          if (!input.inputImages?.length && run.attachments?.length && referenceImages.length) {
            input = {
              ...input,
              inputImages: [...new Set(referenceImages)],
              inputAssetIds: run.attachments.map((attachment) => attachment.assetId),
            };
          }
          const jobT0 = Date.now();
          const jobLap = (label: string, extra?: Record<string, unknown>) => {
            console.log(`[submitImageJob] ${label} +${Date.now() - jobT0}ms`, extra ? JSON.stringify(extra) : "");
          };
          const withSubmitTimeout = async <T>(label: string, operation: Promise<T>) => {
            const timeout = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`${label} timed out after 15s`)), 15_000);
            });
            return Promise.race([operation, timeout]);
          };

          jobLap("submission_started", { model: input.model });

          const isManualImageSelection = run.imageGenerationPreference?.mode === "manual";
          const selectedModels = isManualImageSelection
            ? [...(run.imageGenerationPreference?.models ?? [])]
            : [];
          const requestedModel = input.model;
          if (isManualImageSelection && selectedModels.length > 0 && !selectedModels.includes(input.model)) {
            throw new Error(`MODEL_SELECTION_REQUIRED:你已手动选择图片模型「${selectedModels.join("、")}」，本次请求指定了「${input.model}」。请切换用户选择，或将图片模型设为自动路由。`);
          }

          const legacyImageModels: Record<string, string> = {
            "google/nano-banana-2": "nano-banana-2-1k",
            "nano-banana-2": "nano-banana-2-1k",
          };
          const normalizedModel = isManualImageSelection
            ? input.model
            : input.model.toLowerCase().includes("nano-banana")
              ? "gpt-image-2"
              : legacyImageModels[input.model] ?? input.model;
          if (normalizedModel !== input.model) {
            jobLap("legacy_model_normalized", {
              requestedModel: input.model,
              selectedModel: normalizedModel,
            });
            input = { ...input, model: normalizedModel };
          }

          if (options.localDb) {
            const isManual = isManualImageSelection;
            const routed = await resolveConfiguredModel(
              options.localDb,
              "image",
              input.model,
              {
                requiresInputImage: Boolean(input.inputImages?.length),
                allowUnverified: isManual,
                strictRequested: isManualImageSelection,
                excludeModelIds: ["nano-banana-2-1k", "nano-banana-2-2k"],
                ...(selectedModels.length ? { allowedModelIds: selectedModels } : {}),
              },
            );
            if (!routed) {
              throw new Error(isManual
                ? `MODEL_SELECTION_REQUIRED:你选择的图片模型「${input.model}」当前不可用。系统不会自动切换，请在模型选择器中更换模型或改为自动路由。`
                : "当前没有可用的图片模型，请稍后重试。" );
            }
            if (routed.model_id !== input.model) {
              jobLap("model_auto_selected", {
                requestedModel: input.model,
                selectedModel: routed.model_id,
                reason: isManual && selectedModels.length
                  ? "手动候选不可用，自动回退到健康兼容模型"
                  : "自动路由",
              });
              input = { ...input, model: routed.model_id };
            }
          }

          // Look up personal workspace directly — the viewer is already
          // bootstrapped from the normal auth flow, so we skip ensureViewer
          // to avoid its strict email validation on the profile schema.
          let workspaceId: string | undefined;
          if (options.localDb) {
            jobLap("workspace_lookup_started");
            const { rows } = canvasId
              ? await withSubmitTimeout("Workspace lookup", options.localDb.query(
                  "select p.workspace_id from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id where c.id=$1 and wm.user_id=$2",
                  [canvasId, userId],
                ))
              : await withSubmitTimeout("Workspace lookup", options.localDb.query(
                  "select id as workspace_id from workspaces where owner_user_id=$1 order by created_at limit 1",
                  [userId],
                ));
            workspaceId = rows[0]?.workspace_id;
            jobLap("workspace_lookup_done", { found: Boolean(workspaceId) });
          } else if (createClient) {
            const client = createClient(accessToken) as DataClient;
            const { data: ws } = await client
              .from("workspaces")
              .select("id")
              .eq("type", "personal")
              .limit(1)
              .single();
            workspaceId = ws?.id;
          }
          if (!workspaceId) throw new Error("No workspace found");

          const user: AuthenticatedUser = {
            id: userId,
            accessToken,
            email: "",
            userMetadata: {},
          };

          // ── Cost guard + credit checks (top-up credit system) ──
          let creditsCost = 0;
          if (options.creditService && options.tierGuard) {
            const quality = (input.quality as ImageQualityLevel) ?? "hd";
            try {
              await withSubmitTimeout("Model access check", options.tierGuard.checkModelAccess(input.model));
              options.tierGuard.checkResolution(quality);
              await withSubmitTimeout("Concurrency check", options.tierGuard.checkConcurrency(workspaceId));
            } catch (err) {
              if (err instanceof TierGuardError) {
                pushBillingErrorAndAbort(run, canvasId, options, err.code, err.message);
                throw err;
              }
              throw err;
            }
            creditsCost = await withSubmitTimeout(
              "Billing lookup",
              options.tierGuard.calculateCreditCost(input.model, "image_generation", { quality }),
            );
            jobLap("billing_check_done", { creditsCost });
          }

          // ── Balance pre-check ──────────────────────────────
          if (options.creditService && creditsCost > 0) {
            const balanceInfo = await withSubmitTimeout("Balance check", options.creditService.getBalance(workspaceId));
            if (balanceInfo.balance < creditsCost) {
              pushBillingErrorAndAbort(run, canvasId, options, "insufficient_credits", "Insufficient credits", {
                currentBalance: balanceInfo.balance,
                requiredAmount: creditsCost,
              });
              throw new Error("Insufficient credits");
            }
          }

          if (options.generationApprovalService && creditsCost > 0) {
            const gate = await options.generationApprovalService.gate({
              workspaceId,
              userId,
              jobType: "image_generation",
              model: input.model,
              payload: {
                prompt: input.prompt,
                title: input.title,
                model: input.model,
                aspect_ratio: input.aspectRatio,
                quality: input.quality ?? null,
                routing: {
                  requestedModels: selectedModels,
                  preferredModel: requestedModel,
                  selectedModel: input.model,
                  fallback: Boolean(requestedModel && requestedModel !== input.model),
                  inputImage: Boolean(input.inputImages?.length),
                  aspectRatio: input.aspectRatio,
                  quality: input.quality ?? null,
                },
                ...(input.inputImages ? { input_images: input.inputImages } : {}),
              },
              estimatedCredits: creditsCost,
              context: {
                ...(canvasId ? { canvasId } : {}),
                ...(sessionId ? { sessionId } : {}),
                ...(run.threadId ? { threadId: run.threadId } : {}),
              },
            });
            if (gate.state === "confirmation_required") {
              throw new Error(`GENERATION_CONFIRMATION_REQUIRED:${JSON.stringify(gate.request)}`);
            }
          }

          jobLap("job_create_started");
          const job = await withSubmitTimeout("Job creation", jobSvc.createJob(user, {
            workspaceId,
            ...(canvasId ? { canvasId } : {}),
            ...(sessionId ? { sessionId } : {}),
            idempotencyKey: buildAgentJobIdempotencyKey(run.requestId ?? runId, "image", input),
            jobType: "image_generation",
            payload: {
              prompt: input.prompt,
              title: input.title,
              model: input.model,
              aspect_ratio: input.aspectRatio,
              routing: {
                requestedModels: selectedModels,
                preferredModel: requestedModel,
                selectedModel: input.model,
                fallback: Boolean(requestedModel && requestedModel !== input.model),
                reason: requestedModel && requestedModel !== input.model
                  ? "按当前模型偏好和可用渠道重新选模；不代表输入不兼容"
                  : null,
                inputImage: Boolean(input.inputImages?.length),
                aspectRatio: input.aspectRatio,
                quality: input.quality ?? null,
              },
              ...(input.inputImages ? { input_images: input.inputImages } : {}),
              ...(input.inputAssetIds?.length ? { input_asset_ids: input.inputAssetIds } : {}),
            },
          }));

          // Deduct credits after job creation
          if ((!job.reused || job.reactivated) && options.creditService && creditsCost > 0) {
            try {
              const txId = await options.creditService.deductCredits(
                workspaceId, userId, creditsCost, job.id,
                `Image generation: ${input.model}`,
              );
              await jobSvc.setCreditsInfo(job.id, creditsCost, txId);
            } catch (deductError) {
              await jobSvc.cancelJob(user, job.id).catch(() => {});
              throw deductError;
            }
          }
          jobLap("job_created", { jobId: job.id, creditsCost, sessionId, runId });

          // Poll until terminal state
          // Worker image VT=120s, but Replicate calls can take 100s+ plus queue delay.
          const POLL_INTERVAL = 2000;
          const MAX_WAIT = 240_000; // 4 minutes
          const start = Date.now();
          let pollCount = 0;

          while (Date.now() - start < MAX_WAIT) {
            await delay(POLL_INTERVAL);
            pollCount++;

            if (run.controller.signal.aborted) {
              await jobSvc.cancelJob(user, job.id).catch(() => {});
              throw new Error("Run was canceled");
            }

            const current = await jobSvc.getJobAdmin(job.id);

            if (current.status === "succeeded" && current.result) {
              const result = current.result as {
                signed_url?: string;
                object_path?: string;
                width?: number;
                height?: number;
                mime_type?: string;
                asset_id?: string;
              };
              jobLap("job_poll_done", { pollCount, status: "succeeded" });

              // Write element directly to canvas (backend-driven insertion)
              let elementId: string | undefined;
              if (canvasId && result.object_path) {
                try {
                  const explicitPlacement = (input as any).placementX != null && (input as any).placementY != null
                    ? {
                        x: (input as any).placementX,
                        y: (input as any).placementY,
                        width: (input as any).placementWidth ?? 512,
                        height: (input as any).placementHeight ?? 512,
                      }
                    : undefined;

                  const insertOptions = {
                      canvasId,
                      objectPath: result.object_path,
                      width: result.width ?? 1024,
                      height: result.height ?? 1024,
                      mimeType: result.mime_type ?? "image/png",
                      title: input.title,
                      ...(result.asset_id ? { assetId: result.asset_id } : {}),
                      jobId: job.id,
                    };
                  const insertResult = options.localDb
                    ? await insertLocalImageElement(
                        options.localDb,
                        options.storage,
                        insertOptions,
                        explicitPlacement,
                      )
                    : await insertImageElement(
                        createClient!(accessToken) as DataClient,
                        options.storage,
                        insertOptions,
                        explicitPlacement,
                      );
                  elementId = insertResult.elementId;

                  // Notify connected frontends to refresh canvas
                  options.connectionManager?.pushToCanvas(canvasId, {
                    type: "canvas.sync" as const,
                    runId,
                    timestamp: new Date().toISOString(),
                  });
                  jobLap("canvas_element_inserted", { elementId });
                } catch (insertErr) {
                  // Graceful degradation: log error but still return result
                  console.error("[submitImageJob] canvas insert failed:", insertErr);
                }
              }

              return {
                jobId: job.id,
                ...(elementId != null ? { elementId } : {}),
                imageUrl: result.signed_url ?? "",
                width: result.width ?? 1024,
                height: result.height ?? 1024,
                mimeType: result.mime_type ?? "image/png",
              };
            }

            if (current.status === "dead_letter" || current.status === "canceled") {
              jobLap("job_poll_done", { pollCount, status: current.status });
              return {
                jobId: job.id,
                error: current.error_message ?? `Job ${current.status}`,
              };
            }

            // "failed" with attempts exhausted
            if (
              current.status === "failed" &&
              current.attempt_count >= current.max_attempts
            ) {
              jobLap("job_poll_done", { pollCount, status: "failed_max_retries" });
              return {
                jobId: job.id,
                error: current.error_message ?? "Job failed after max retries",
              };
            }
          }

          jobLap("job_poll_done", { pollCount, status: "timeout" });
          return {
            jobId: job.id,
            pending: true,
          };
        };
        submitImageJob = singleImageSubmission(submitImageJobOnce);

        submitVideoJob = async (input) => {
          const jobT0 = Date.now();
          let videoRouting: Record<string, unknown> | undefined;
          const jobLap = (label: string, extra?: Record<string, unknown>) => {
            console.log(`[submitVideoJob] ${label} +${Date.now() - jobT0}ms`, extra ? JSON.stringify(extra) : "");
          };

          let workspaceId: string | undefined;
          if (!input.inputImages?.length && referenceImages.length > 0) {
            input = {
              ...input,
              inputImages: [referenceImages[0]!],
              ...(run.attachments?.[0]?.assetId ? { inputAssetIds: [run.attachments[0].assetId] } : {}),
            };
          }

          const isManualVideoSelection = run.videoGenerationPreference?.mode === "manual";
          const selectedModels = isManualVideoSelection
            ? [...(run.videoGenerationPreference?.models ?? [])].filter((model) => !isRemovedModelId(model))
            : [];
          let effectiveManualVideoSelection = isManualVideoSelection && selectedModels.length > 0;
          const selectedModel = input.model;
          const selectedDuration = explicitVideoDuration(run.prompt) ?? run.videoGenerationPreference?.duration;
          if (selectedDuration != null) {
            input = { ...input, duration: selectedDuration };
          }

          if (options.localDb) {
            const { rows } = canvasId
              ? await options.localDb.query(
                  "select p.workspace_id from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id where c.id=$1 and wm.user_id=$2",
                  [canvasId, userId],
                )
              : await options.localDb.query(
                  "select id as workspace_id from workspaces where owner_user_id=$1 order by created_at limit 1",
                  [userId],
                );
            workspaceId = rows[0]?.workspace_id;
          } else if (createClient) {
            const client = createClient(accessToken) as DataClient;
            const { data: ws } = await client
              .from("workspaces")
              .select("id")
              .eq("type", "personal")
              .limit(1)
              .single();
            workspaceId = ws?.id;
          }
          if (!workspaceId) throw new Error("No workspace found");
          if (options.localDb && effectiveManualVideoSelection) {
            const usable = await options.localDb.query(
              `select count(*)::int as count
               from provider_models pm
               join provider_configs pc on pc.id = pm.provider_id
               where pm.model_id = any($1::text[])
                 and pm.media_type = 'video'
                 and pm.enabled = true
                 and pm.health_status <> 'unhealthy' and pm.failure_count < 3
                 and pm.billing_unit = 'per_second'
                 and pm.price_credits > 0
                 and pc.enabled = true
                 and pc.health_status = 'healthy'
                 and (pm.cooldown_until is null or pm.cooldown_until <= now())`,
              [selectedModels],
            );
            if (Number(usable.rows[0]?.count ?? 0) === 0) {
              effectiveManualVideoSelection = false;
              jobLap("stale_video_preference_ignored", { selectedModels });
            }
          }

          if (effectiveManualVideoSelection && !selectedModels.includes(input.model)) {
            throw new Error(`MODEL_SELECTION_REQUIRED:当前手动选择的视频模型不可用：${selectedModels.join("、")}。请切换模型，或将视频模型改为自动路由。`);
          }

          if (options.localDb) {
            const hasFirstFrame = Boolean(input.inputImages?.length);
            // Only an explicit user selection may lock routing to one model.
            // In an empty manual state, ignore model names invented by the agent.
            const requestedVideoModel = selectedModel;
            const allowedVideoModels = effectiveManualVideoSelection && selectedModels.length > 0 ? selectedModels : undefined;
            const excludedModelIds = ["nano-banana-2-1k", "nano-banana-2-2k", ];
            const model = await resolveConfiguredModel(
              options.localDb,
              "video",
              requestedVideoModel,
              {
                requiresInputImage: Boolean(input.inputImages?.length),
                allowUnverified: effectiveManualVideoSelection,
                strictRequested: effectiveManualVideoSelection,
                excludeModelIds: excludedModelIds,
                ...(input.duration != null ? { requiredDuration: input.duration } : {}),
                ...(allowedVideoModels ? { allowedModelIds: allowedVideoModels } : {}),
              },
            );
            if (!model) {
              throw new Error(isManualVideoSelection
                ? `MODEL_SELECTION_REQUIRED:你选择的视频模型「${input.model}」当前不可用或不支持本次首帧/时长参数。系统不会自动切换，请在模型选择器中更换模型或改为自动路由。`
                : "当前没有兼容本次输入的可用视频模型，请重新选择模型。" );
            }
            if (input.enableAudio === true && model.supports_audio === false) {
              throw Object.assign(
                new Error("The selected video model does not support generated audio."),
                { code: "invalid_input" },
              );
            }
            const videoProfile = getModelCallProfile(model.model_id, "lingke_media");
            const maxInputImages = videoProfile.maxInputImages;
            const requestedImageCount = input.inputImages?.length ?? 0;
            const truncatedReferenceImages = maxInputImages != null && requestedImageCount > maxInputImages;
            if (truncatedReferenceImages) {
              input = {
                ...input,
                inputImages: input.inputImages!.slice(0, maxInputImages),
              };
              jobLap("reference_images_truncated", {
                requestedImageCount,
                acceptedImageCount: maxInputImages,
                model: model.model_id,
              });
            }
            const preferredModel = requestedVideoModel ?? input.model;
            videoRouting = {
              requestedModels: selectedModels,
              preferredModel,
              selectedModel: model.model_id,
              fallback: Boolean(preferredModel && preferredModel !== model.model_id),
              reason: preferredModel && preferredModel !== model.model_id
                ? hasFirstFrame
                  ? "首帧、时长或模型健康状态不兼容，已切换到可用模型"
                  : "模型健康状态或时长不兼容，已切换到可用模型"
                : truncatedReferenceImages
                  ? `reference images exceeded ${maxInputImages}; kept the first ${maxInputImages}`
                  : null,
              inputImage: hasFirstFrame,
              ...(input.duration != null ? { duration: input.duration } : {}),
              ...(input.resolution ? { resolution: input.resolution } : {}),
              ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
            };
            input = { ...input, model: model.model_id };
            const route = buildMediaRoute({
              intent: {
                mediaType: "video",
                inputImageCount: input.inputImages?.length ?? 0,
                inputVideo: Boolean(input.inputVideo),
                enableAudio: input.enableAudio === true,
                ...(input.duration != null ? { durationSeconds: input.duration } : {}),
                ...(input.resolution ? { resolution: input.resolution } : {}),
                ...(requestedVideoModel ? { requestedModel: requestedVideoModel } : {}),
                selectionMode: effectiveManualVideoSelection ? "manual" : "auto",
              },
              selected: model,
              candidates: selectedModels,
              reason: requestedVideoModel && requestedVideoModel !== model.model_id ? "requested model unavailable" : null,
            });
            videoRouting = route;
            input = { ...input, enableAudio: route.normalized.enableAudio };
          }

          jobLap("input_resolved", {
            model: input.model,
            inputImageCount: input.inputImages?.length ?? 0,
            inputImageSource: input.inputImages?.[0]?.startsWith("data:")
              ? "data_uri"
              : input.inputImages?.[0]
                ? "url"
                : "none",
          });

          const user: AuthenticatedUser = {
            id: userId,
            accessToken,
            email: "",
            userMetadata: {},
          };

          // ── Cost guard + credit checks (top-up credit system) ──
          let creditsCost = 0;
          if (options.creditService && options.tierGuard) {
            try {
              await options.tierGuard.checkModelAccess(input.model);
              if (input.resolution) {
                options.tierGuard.checkVideoResolution(input.resolution as any);
              }
              await options.tierGuard.checkConcurrency(workspaceId);
            } catch (err) {
              if (err instanceof TierGuardError) {
                pushBillingErrorAndAbort(run, canvasId, options, err.code, err.message);
                throw err;
              }
              throw err;
            }
            creditsCost = await options.tierGuard.calculateCreditCost(
              input.model, "video_generation",
              {
                ...(input.duration != null ? { duration: input.duration } : {}),
                ...(input.resolution ? { resolution: input.resolution as any } : {}),
              },
            );
          }

          // ── Balance pre-check ──────────────────────────────
          if (options.creditService && creditsCost > 0) {
            const balanceInfo = await options.creditService.getBalance(workspaceId);
            if (balanceInfo.balance < creditsCost) {
              pushBillingErrorAndAbort(run, canvasId, options, "insufficient_credits", "Insufficient credits", {
                currentBalance: balanceInfo.balance,
                requiredAmount: creditsCost,
              });
              throw new Error("Insufficient credits");
            }
          }

          if (options.generationApprovalService && creditsCost > 0) {
            const gate = await options.generationApprovalService.gate({
              workspaceId,
              userId,
              jobType: "video_generation",
              model: input.model,
              payload: {
                prompt: input.prompt,
                model: input.model,
                ...(input.duration != null ? { duration: input.duration } : {}),
                ...(input.resolution ? { resolution: input.resolution } : {}),
                ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
                ...(input.inputImages ? { input_images: input.inputImages } : {}),
                ...(input.inputAssetIds?.length ? { input_asset_ids: input.inputAssetIds } : {}),
                ...(input.inputVideo ? { input_video: input.inputVideo } : {}),
                ...(input.enableAudio != null ? { enable_audio: input.enableAudio } : {}),
              },
              estimatedCredits: creditsCost,
              context: {
                ...(canvasId ? { canvasId } : {}),
                ...(sessionId ? { sessionId } : {}),
                ...(run.threadId ? { threadId: run.threadId } : {}),
              },
            });
            if (gate.state === "confirmation_required") {
              throw new Error(`GENERATION_CONFIRMATION_REQUIRED:${JSON.stringify(gate.request)}`);
            }
          }

          const job = await jobSvc.createJob(user, {
            workspaceId,
            ...(canvasId ? { canvasId } : {}),
            ...(sessionId ? { sessionId } : {}),
            idempotencyKey: buildAgentJobIdempotencyKey(run.requestId ?? runId, "video", input),
            jobType: "video_generation",
            payload: {
              prompt: input.prompt,
              model: input.model,
              ...(videoRouting ? { routing: videoRouting } : {}),
              ...(input.duration != null ? { duration: input.duration } : {}),
              ...(input.resolution ? { resolution: input.resolution } : {}),
              ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
              ...(input.inputImages ? { input_images: input.inputImages } : {}),
              ...(input.inputAssetIds?.length ? { input_asset_ids: input.inputAssetIds } : {}),
              ...(input.inputVideo ? { input_video: input.inputVideo } : {}),
              ...(input.enableAudio != null ? { enable_audio: input.enableAudio } : {}),
            },
          });

          // Deduct credits after job creation
          if ((!job.reused || job.reactivated) && options.creditService && creditsCost > 0) {
            try {
              const txId = await options.creditService.deductCredits(
                workspaceId, userId, creditsCost, job.id,
                `Video generation: ${input.model}`,
              );
              await jobSvc.setCreditsInfo(job.id, creditsCost, txId);
            } catch (deductError) {
              await jobSvc.cancelJob(user, job.id).catch(() => {});
              throw deductError;
            }
          }
          jobLap("job_created", { jobId: job.id, creditsCost, sessionId, runId });

          // Poll until terminal state — video generation is slower.
          // Google Vertex Veo can take 300-500s; 600s gives enough headroom
          // to avoid poll timeout while worker is still processing.
          const POLL_INTERVAL = 3000;
          const MAX_WAIT = 900_000; // Some upstream video jobs take 10-12 minutes.
          const start = Date.now();
          let pollCount = 0;

          while (Date.now() - start < MAX_WAIT) {
            await delay(POLL_INTERVAL);
            pollCount++;

            if (run.controller.signal.aborted) {
              await jobSvc.cancelJob(user, job.id).catch(() => {});
              throw new Error("Run was canceled");
            }

            const current = await jobSvc.getJobAdmin(job.id);

            if (current.status === "succeeded" && current.result) {
              const result = current.result as {
                signed_url?: string;
                duration_seconds?: number;
                width?: number;
                height?: number;
                mime_type?: string;
                asset_id?: string;
              };
              jobLap("job_poll_done", { pollCount, status: "succeeded" });

              // Write element directly to canvas (backend-driven insertion)
              let elementId: string | undefined;
              if (canvasId && result.signed_url && (options.localDb || createClient)) {
                try {
                  const explicitPlacement = (input as any).placementX != null && (input as any).placementY != null
                    ? {
                        x: (input as any).placementX,
                        y: (input as any).placementY,
                        width: (input as any).placementWidth ?? 640,
                        height: (input as any).placementHeight ?? 360,
                      }
                    : undefined;

                  const insertOptions = {
                      canvasId,
                      signedUrl: result.signed_url,
                      width: result.width ?? 1280,
                      height: result.height ?? 720,
                      mimeType: result.mime_type ?? "video/mp4",
                      ...(result.duration_seconds != null ? { durationSeconds: result.duration_seconds } : {}),
                      title: (input as any).title,
                      prompt: input.prompt,
                       ...(result.asset_id ? { assetId: result.asset_id } : {}),
                       jobId: job.id,
                    };
                  const insertResult = options.localDb
                    ? await insertLocalVideoElement(
                        options.localDb,
                        insertOptions,
                        explicitPlacement,
                      )
                    : await insertVideoElement(
                        createClient!(accessToken) as DataClient,
                        insertOptions,
                        explicitPlacement,
                      );
                  elementId = insertResult.elementId;

                  // Notify connected frontends to refresh canvas
                  options.connectionManager?.pushToCanvas(canvasId, {
                    type: "canvas.sync" as const,
                    runId,
                    timestamp: new Date().toISOString(),
                  });
                  jobLap("canvas_element_inserted", { elementId });
                } catch (insertErr) {
                  // Graceful degradation: log error but still return result
                  console.error("[submitVideoJob] canvas insert failed:", insertErr);
                }
              }

              return {
                jobId: job.id,
                ...(elementId != null ? { elementId } : {}),
                videoUrl: result.signed_url ?? "",
                width: result.width ?? 1280,
                height: result.height ?? 720,
                mimeType: result.mime_type ?? "video/mp4",
                ...(result.duration_seconds != null ? { durationSeconds: result.duration_seconds } : {}),
              };
            }

            if (current.status === "dead_letter" || current.status === "canceled") {
              jobLap("job_poll_done", { pollCount, status: current.status });
              return {
                jobId: job.id,
                error: current.error_message ?? `Job ${current.status}`,
              };
            }

            if (
              current.status === "failed" &&
              current.attempt_count >= current.max_attempts
            ) {
              jobLap("job_poll_done", { pollCount, status: "failed_max_retries" });
              return {
                jobId: job.id,
                error: current.error_message ?? "Job failed after max retries",
              };
            }
          }

          jobLap("job_poll_done", { pollCount, status: "timeout" });
          return {
            jobId: job.id,
            pending: true,
          };
        };

        submitWebsiteCapture = async (input) => {
          if (!options.localDb || !options.jobService || !userId) {
            throw new Error("网站浏览后台任务当前不可用。");
          }
          if (input.mode === "local") {
            throw new Error("本地浏览器助手尚未连接；请先选择一次性隔离浏览器。");
          }
          const { validatePublicHttpUrl } = await import("../features/website-capture/isolated-browser.js");
          const startUrl = await validatePublicHttpUrl(input.url);
          const workspaceResult = canvasId
            ? await options.localDb.query(
                "select p.workspace_id from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id where c.id=$1 and wm.user_id=$2",
                [canvasId, userId],
              )
            : await options.localDb.query(
                "select id as workspace_id from workspaces where owner_user_id=$1 order by created_at limit 1",
                [userId],
              );
          const workspaceId = workspaceResult.rows[0]?.workspace_id as string | undefined;
          if (!workspaceId) throw new Error("No workspace found");
          const idempotencyKey = input.idempotencyKey ?? `agent-website-capture:${randomUUID()}`;
          const taskResult = await options.localDb.query<{ id: string; background_job_id: string | null; status: string; progress: number }>(
            `insert into website_capture_tasks
              (workspace_id, created_by, mode, start_url, page_limit, record_video, idempotency_key)
             values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (created_by, idempotency_key) do nothing
             returning id, background_job_id, status, progress`,
            [workspaceId, userId, input.mode, startUrl.toString(), input.pageLimit ?? 3, input.recordVideo ?? true, idempotencyKey],
          );
          let task = taskResult.rows[0];
          if (!task) {
            task = (await options.localDb.query<{ id: string; background_job_id: string | null; status: string; progress: number }>(
              "select id, background_job_id, status, progress from website_capture_tasks where created_by=$1 and idempotency_key=$2",
              [userId, idempotencyKey],
            )).rows[0];
          }
          if (!task) throw new Error("网站浏览任务创建失败。");
          let jobId = task.background_job_id;
          if (!jobId && task.status === "queued") {
            const job = await options.jobService.createJob({ id: userId, accessToken, email: "", userMetadata: {} }, {
              workspaceId,
              idempotencyKey: `website-capture:${idempotencyKey}`,
              jobType: "website_capture",
              payload: { task_id: task.id },
            });
            jobId = job.id;
            await options.localDb.query(
              "update website_capture_tasks set background_job_id=$2, updated_at=now() where id=$1 and background_job_id is null",
              [task.id, jobId],
            );
          }
          return { taskId: task.id, jobId, status: task.status, progress: Number(task.progress ?? 0), pending: task.status !== "succeeded" };
        };

      }

      // Load workspace skills (user-installed skills from DB).
      // Done before backend creation so we know whether to add the
      // /workspace-skills/ Store route.
      let workspaceSkills: WorkspaceSkillEntry[] = [];
      if (options.localDb && run.canvasId) {
        try {
          workspaceSkills = await loadLocalWorkspaceSkills(options.localDb, run.canvasId);
          rlog.lap("workspace_skills_loaded", { count: workspaceSkills.length });
        } catch (err) {
          console.warn("[runtime] Failed to load local workspace skills:", err);
        }
      } else if (run.canvasId && run.accessToken && options.createUserClient) {
        try {
          const wsClient = options.createUserClient(run.accessToken) as DataClient;
          workspaceSkills = await loadWorkspaceSkills(wsClient, run.canvasId);
          rlog.lap("workspace_skills_loaded", { count: workspaceSkills.length });
        } catch (err) {
          // Non-fatal: agent runs without workspace skills
          console.warn("[runtime] Failed to load workspace skills:", err);
        }
      }

      // Create backend — production uses StateBackend (no local shell).
      const backendResult = createAgentBackend(
        options.env,
        run.canvasId,
        { hasWorkspaceSkills: workspaceSkills.length > 0 },
      );

      try {
      let agent: HelsteraAgent;
      try {
        const resolvedModel = run.modelOverride
          ? (run.modelOverride.includes(":")
            ? run.modelOverride
            : createDefaultModelSpecifier({ agentModel: run.modelOverride }))
          : options.model;

        // Build persistImage closure using the user's Supabase client.
        // Client creation is deferred into the closure so it only runs
        // when an image is actually generated (avoids throwing in tests
        // that don't configure Supabase env vars).
        let persistImage: ((url: string, mime: string, prompt: string) => Promise<string>) | undefined;
        if (options.localDb || (options.createUserClient && run.accessToken)) {
          const createClient = options.createUserClient;
          const accessToken = run.accessToken;
          persistImage = async (sourceUrl, mimeType, prompt) => {
            const response = await fetch(sourceUrl, {
              signal: AbortSignal.timeout(PERSIST_IMAGE_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`Download failed: ${response.status}`);
            const buffer = await readImageResponse(response);
            const ext = mimeType === "image/webp" ? "webp" : "png";
            const slug = prompt.slice(0, 40).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
            const fileName = `gen-${slug}-${Date.now()}.${ext}`;

            if (options.localDb) {
              const workspace = run.userId
                ? (await options.localDb.query("select id from workspaces where owner_user_id = $1 order by created_at limit 1", [run.userId])).rows[0]
                : null;
              if (!workspace) throw new Error("Personal workspace not found");
              const objectPath = `${workspace.id}/generated/${fileName}`;
              const { mkdir, writeFile } = await import("node:fs/promises");
              const { join } = await import("node:path");
              await mkdir(join("/www/helstera/uploads", workspace.id, "generated"), { recursive: true });
              await writeFile(join("/www/helstera/uploads", objectPath), buffer, { flag: "wx" });
              const asset = await options.localDb.query("insert into asset_objects (workspace_id, bucket, object_path, mime_type, byte_size, created_by) values ($1, 'project-assets', $2, $3, $4, $5) returning id", [workspace.id, objectPath, mimeType, buffer.length, run.userId ?? null]);
              return `/api/uploads/${asset.rows[0].id}/file`;
            }

            if (!createClient || !accessToken) {
              throw new Error("No user storage client available");
            }
            const client = createClient(accessToken) as DataClient;

            const { data: ws } = await client
              .from("workspaces")
              .select("id")
              .eq("type", "personal")
              .limit(1)
              .single();
            const workspaceId = ws?.id ?? "default";
            const objectPath = `${workspaceId}/${Date.now()}-${fileName}`;

            const { error: uploadError } = await client.storage
              .from("project-assets")
              .upload(objectPath, buffer, { contentType: mimeType, upsert: false });
            if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

            const { data: urlData } = client.storage
              .from("project-assets")
              .getPublicUrl(objectPath);

            return urlData.publicUrl;
          };
        }

        // Resolve brand kit ID from canvas → project in a single joined query
        let brandKitId: string | null = null;
        if (run.canvasId && options.localDb) {
          const { rows } = await options.localDb.query(
            "select p.brand_kit_id from canvases c join projects p on p.id=c.project_id where c.id=$1",
            [run.canvasId],
          );
          brandKitId = rows[0]?.brand_kit_id ?? null;
        } else if (run.canvasId && run.accessToken && options.createUserClient) {
          try {
            const client = options.createUserClient(run.accessToken) as any;
            const { data: canvas } = await client
              .from("canvases")
              .select("project_id, projects!inner(brand_kit_id)")
              .eq("id", run.canvasId)
              .maybeSingle();
            brandKitId = canvas?.projects?.brand_kit_id ?? null;
          } catch (err) {
            // Fallback: joined query may fail if FK isn't exposed via PostgREST
            // In that case, try the two-step approach
            try {
              const client = options.createUserClient(run.accessToken) as any;
              const { data: c } = await client
                .from("canvases")
                .select("project_id")
                .eq("id", run.canvasId)
                .maybeSingle();
              if (c?.project_id) {
                const { data: p } = await client
                  .from("projects")
                  .select("brand_kit_id")
                  .eq("id", c.project_id)
                  .maybeSingle();
                brandKitId = p?.brand_kit_id ?? null;
              }
            } catch (err2) {
              console.warn("Failed to resolve brand kit ID:", err2);
            }
          }
        }

        rlog.lap("brand_kit_resolved");

        // Pre-write workspace skill SKILL.md files AND associated files
        // (scripts/, references/, assets/) into the Store so the agent can
        // read_file them via the /workspace-skills/ route.
        const store = persistence?.store;
        if (workspaceSkills.length > 0 && store && run.canvasId) {
          const storeNamespace = ["projects", run.canvasId, "workspace-skills"];
          const now_ = new Date().toISOString();

          const writeOps: Promise<void>[] = [];
          for (const skill of workspaceSkills) {
            // Write SKILL.md
            writeOps.push(
              store.put(storeNamespace, `/${skill.name}/SKILL.md`, {
                content: skill.content.split("\n"),
                created_at: now_,
                modified_at: now_,
              }),
            );
            // Write associated files (scripts/, references/, assets/)
            for (const file of skill.files) {
              writeOps.push(
                store.put(storeNamespace, `/${skill.name}/${file.path}`, {
                  content: file.content.split("\n"),
                  created_at: now_,
                  modified_at: now_,
                }),
              );
            }
          }

          await Promise.all(writeOps);
          const totalFiles = workspaceSkills.reduce((sum, s) => sum + s.files.length, 0);
          rlog.lap("workspace_skills_stored", { count: workspaceSkills.length, files: totalFiles });
        }

        agent = resolvedAgentFactory({
          backendResult,
          ...(brandKitId ? { brandKitId } : {}),
          ...(run.canvasId ? { canvasId: run.canvasId } : {}),
          ...(run.threadId && persistence
            ? { checkpointer: persistence.checkpointer }
            : {}),
          ...(options.connectionManager ? { connectionManager: options.connectionManager } : {}),
          env: options.env,
          ...(options.localDb ? { localDb: options.localDb } : {}),
          ...(resolvedModel ? { model: resolvedModel } : {}),
          ...(run.modelApiBase ? { modelApiBase: run.modelApiBase } : {}),
          ...(run.modelApiKey ? { modelApiKey: run.modelApiKey } : {}),
          // Stable across runs so the fixed system/tool prefix can be reused.
          promptCacheKey: "helstera-agent-v2",
          ...(persistImage ? { persistImage } : {}),
          // execute 工具由 LocalShellBackend 自动提供，无需手动传递
          ...(submitImageJob ? { submitImageJob } : {}),
          ...(submitVideoJob ? { submitVideoJob } : {}),
          ...(submitWebsiteCapture ? { submitWebsiteCapture } : {}),
          ...(persistence ? { store: persistence.store } : {}),
          ...(workspaceSkills.length > 0 ? { workspaceSkills } : {}),
        });
        rlog.lap("agent_factory_done");
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        await updatePersistedRunFailure(options.agentRunMetadataService, run, now, error);
        yield failedEvent;
        return;
      }

      let stream: AsyncIterable<unknown>;
      try {
        // Auto-inject canvas state summary so the agent has immediate awareness
        // of what's on the canvas without needing to call inspect_canvas first.
        let canvasSummary: string | null = null;
        let canvasReferenceImage: string | null = null;
        if (run.canvasId && options.localDb) {
          try {
            const { rows } = await options.localDb.query(
              "select content from canvases where id=$1",
              [run.canvasId],
            );
            const content = rows[0]?.content;
            const elements = content?.elements;
            if (Array.isArray(elements)) {
              canvasSummary = buildCanvasSummaryForContext(elements);
              canvasReferenceImage = await findCanvasReferenceImage(
                content,
                options.storage,
              );
            }
          } catch {
            // Non-critical: inspect_canvas remains available.
          }
        } else if (run.canvasId && run.accessToken && options.createUserClient) {
          try {
            const canvasClient = options.createUserClient(run.accessToken) as any;
            const { data: canvasData } = await canvasClient
              .from("canvases")
              .select("content")
              .eq("id", run.canvasId)
              .single();
            if (canvasData?.content?.elements) {
              canvasSummary = buildCanvasSummaryForContext(
                canvasData.content.elements as Array<Record<string, unknown>>,
              );
              canvasReferenceImage = await findCanvasReferenceImage(
                canvasData.content,
                options.storage,
              );
            }
          } catch {
            // Non-critical — agent can still call inspect_canvas manually
          }
        }

        const hasAttachments = run.attachments && run.attachments.length > 0;
        let userMessage: HumanMessage;
        let attachmentDataMap: Record<string, string> = {};

        if (hasAttachments) {
          // Download images and build parallel data structures:
          // 1. imageBlocks: base64 content parts for LLM vision
          // 2. downloaded: assetId → base64 mapping for tool resolution
          const downloaded: Array<{ assetId: string; mimeType: string; base64: string }> = [];
          const visionParts = await Promise.all(
            run.attachments!.map(async (a) => {
              try {
                let b64: string;
                let mime: string;

                // Handle data URIs directly (canvas-ref images) — no fetch needed
                const dataUriMatch = a.url.match(/^data:([^;]+);base64,(.+)$/);
                if (dataUriMatch) {
                  mime = dataUriMatch[1]!;
                  b64 = dataUriMatch[2]!;
                } else if (options.localDb && run.userId) {
                  const { rows } = await options.localDb.query<{
                    bucket: string;
                    object_path: string;
                    mime_type: string | null;
                  }>(
                    `select asset.bucket, asset.object_path, asset.mime_type
                     from asset_objects asset
                     join workspace_members member on member.workspace_id = asset.workspace_id
                     where asset.id = $1 and member.user_id = $2`,
                    [a.assetId, run.userId],
                  );
                  const asset = rows[0];
                  if (!asset) {
                    throw new Error("Attachment is not accessible to this user");
                  }
                  const download = await options.storage.download(
                    asset.bucket,
                    asset.object_path,
                  );
                  if (download.error || !download.data) {
                    throw download.error ?? new Error("Attachment storage returned no data");
                  }
                  mime = a.mimeType || asset.mime_type || "image/png";
                  b64 = download.data.toString("base64");
                } else {
                  const assetUrl = new URL(a.url, options.env.webOrigin).toString();
                  const res = await fetch(assetUrl, {
                    ...(run.accessToken
                      ? { headers: { Authorization: `Bearer ${run.accessToken}` } }
                      : {}),
                  });
                  if (!res.ok) {
                    throw new Error(`Attachment download failed: ${res.status}`);
                  }
                  const buf = Buffer.from(await res.arrayBuffer());
                  mime = a.mimeType || res.headers.get("content-type") || "image/png";
                  b64 = buf.toString("base64");
                }

                downloaded.push({ assetId: a.assetId, mimeType: mime, base64: b64 });
                // Standard LangChain content blocks are converted to the
                // provider's native image_url shape by ChatOpenAI.
                return {
                  type: "image" as const,
                  source_type: "base64" as const,
                  mime_type: mime,
                  data: b64,
                };
              } catch (error) {
                rlog.warn("attachment_download_failed", {
                  assetId: a.assetId,
                  error: error instanceof Error ? error.message : String(error),
                });
                return null;
              }
            }),
          );

          // Build XML text tags for LLM to reference by assetId
          const { text: enrichedPrompt } = buildUserMessage(
            run.prompt,
            run.attachments!,
            run.imageGenerationPreference,
            run.mentions,
            run.videoGenerationPreference,
            canvasSummary,
          );

          // Build assetId → data URI map for tool-level resolution
          attachmentDataMap = buildAttachmentDataMap(downloaded);
          referenceImages = resolveImageReferences(run.attachments!, attachmentDataMap);

          // Configured gateways accept the OpenAI image_url content format. Other gateways
          // retain the text-only path because their compatibility behavior is
          // inconsistent for private, uploaded assets.
          const activeModel = run.modelOverride ?? (
            typeof options.model === "string" ? options.model : undefined
          );
          userMessage = supportsVisionInput(activeModel)
            ? new HumanMessage({
                content: [
                  { type: "text", text: enrichedPrompt },
                  ...visionParts.filter(
                    (part): part is NonNullable<typeof part> => part !== null,
                  ),
                ],
              })
            : new HumanMessage(enrichedPrompt);
        } else {
          const { text: enrichedPrompt } = buildUserMessage(
            run.prompt,
            [],
            run.imageGenerationPreference,
            run.mentions,
            run.videoGenerationPreference,
            canvasSummary,
          );
          userMessage = new HumanMessage(enrichedPrompt);
        }

        if (referenceImages.length === 0 && canvasReferenceImage) {
          referenceImages = [canvasReferenceImage];
        }

        rlog.lap("stream_call_start");
        stream = agent.streamEvents(
          {
            messages: [userMessage],
          },
          {
            ...(run.threadId || run.canvasId || run.accessToken || run.userId || Object.keys(attachmentDataMap).length > 0
              ? {
                  configurable: {
                    ...(run.threadId ? { thread_id: run.threadId } : {}),
                    ...(run.canvasId ? { canvas_id: run.canvasId } : {}),
                    ...(run.accessToken ? { access_token: run.accessToken } : {}),
                    ...(run.userId ? { user_id: run.userId } : {}),
                    ...(Object.keys(attachmentDataMap).length > 0
                      ? { user_attachment_map: attachmentDataMap }
                      : {}),
                  },
                }
              : {}),
            signal: run.controller.signal,
            version: "v2",
          },
        );
        rlog.lap("stream_call_returned");
      } catch (error) {
        const failedEvent = toFailedEvent(runId, now, error);
        run.status = "failed";
        await updatePersistedRunFailure(options.agentRunMetadataService, run, now, error);
        yield failedEvent;
        return;
      }

      // Media tools can legitimately wait several minutes for an upstream
      // result while the job heartbeat is persisted separately. The old
      // 90-second global watchdog aborted those valid runs and surfaced a
      // misleading generic run_failed event.
      const INITIAL_MODEL_RESPONSE_TIMEOUT_MS = 90_000;
      const MAX_AGENT_SILENCE_MS = 20 * 60_000;
      let receivedProgress = false;
      let timedOut = false;
      let silenceTimer: ReturnType<typeof setTimeout> | undefined;
      const resetSilenceTimer = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        const timeoutMs = receivedProgress
          ? MAX_AGENT_SILENCE_MS
          : INITIAL_MODEL_RESPONSE_TIMEOUT_MS;
        silenceTimer = setTimeout(() => {
          timedOut = true;
          run.controller.abort(new Error("Agent response timed out"));
        }, timeoutMs);
      };

      resetSilenceTimer();
      try {
      for await (const event of adaptDeepAgentStream({
        conversationId: run.conversationId,
        singleImageTask: Boolean(options.jobService && (options.localDb || options.createUserClient) && run.accessToken && run.userId),
        now,
        runId,
        sessionId: run.sessionId,
        signal: run.controller.signal,
        stream,
        onModelUsage: (usage) => {
          rlog.lap("model_usage", {
            inputTokens: usage.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheHit: (usage.cacheReadTokens ?? 0) > 0,
          });
        },
      })) {
        receivedProgress = true;
        resetSilenceTimer();
        run.status = mapEventToStatus(event);
        try {
          await syncPersistedRunFromEvent(
            options.agentRunMetadataService,
            run,
            event,
            now,
          );
        } catch (error) {
          const failedEvent = toFailedEvent(runId, now, error);
          run.status = "failed";
          yield failedEvent;
          return;
        }
        yield event;

        if (!isTerminalEvent(event) && options.eventDelayMs) {
          try {
            await delay(options.eventDelayMs, undefined, {
              signal: run.controller.signal,
            });
          } catch {
            run.status = "canceled";
            yield {
              runId,
              timestamp: now(),
              type: "run.canceled",
            };
            return;
          }
        }
      }
      if (timedOut) {
const timeoutError = new Error(
          receivedProgress
            ? "Agent 任务长时间没有完成，已停止等待；可以稍后查看后台结果或点击重试。"
            : "模型在 90 秒内没有返回响应，已停止等待；请检查模型可用性后点击重试。",
        );
        run.status = "failed";
        await updatePersistedRunFailure(options.agentRunMetadataService, run, now, timeoutError).catch(
          (persistErr) => console.error("[agent-runtime] Failed to persist timed out run:", persistErr),
        );
        yield toFailedEvent(runId, now, timeoutError);
        return;
      }
      } catch (streamError) {
        // Catch DB / checkpoint errors that bubble up from the LangGraph stream
        // (e.g. Supabase circuit-breaker, connection pool exhaustion).
        // Instead of crashing the process, yield a clean failure event.
        console.error("[agent-runtime] Stream iteration failed:", streamError);
        const failedEvent = toFailedEvent(runId, now, streamError);
        run.status = "failed";
        await updatePersistedRunFailure(options.agentRunMetadataService, run, now, streamError).catch(
          (persistErr) => console.error("[agent-runtime] Failed to persist run failure:", persistErr),
        );
        yield failedEvent;
        return;
      } finally {
        if (silenceTimer) clearTimeout(silenceTimer);
      }
      } finally {
        if (backendResult.sandboxDir) {
          rm(backendResult.sandboxDir, { recursive: true, force: true }).catch(
            (err) => console.warn("[sandbox] cleanup failed:", err.message),
          );
        }
      }
    },
  };
}


function isTerminalEvent(event: StreamEvent) {
  return (
    event.type === "run.canceled" ||
    event.type === "run.completed" ||
    event.type === "run.failed"
  );
}

function buildAgentJobIdempotencyKey(
  requestIdentity: string,
  kind: "image" | "video",
  input: Record<string, unknown>,
): string {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(sortRecord(input)))
    .digest("hex");
  return `agent:${requestIdentity}:${kind}:${fingerprint}`.slice(0, 160);
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecord(entry)]),
  );
}

function mapEventToStatus(event: StreamEvent): RuntimeRunStatus {
  switch (event.type) {
    case "run.canceled":
      return "canceled";
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    default:
      return "running";
  }
}

function toFailedEvent(
  runId: string,
  now: () => string,
  error: unknown,
): StreamEvent {
  // Log full error detail server-side
  console.error(`[runtime] Agent run failed for run ${runId}:`, error);

  return {
    error: classifyErrorForClient(error),
    runId,
    timestamp: now(),
    type: "run.failed",
  };
}

async function updatePersistedRunStatus(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  status: "running" | "completed",
  options?: {
    completedAt?: string;
  },
) {
  if (!agentRunMetadataService || !run.threadId) {
    return;
  }

  await agentRunMetadataService.updateRun({
    ...(options?.completedAt ? { completedAt: options.completedAt } : {}),
    runId: run.runId,
    status,
  });
}

async function updatePersistedRunFailure(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  now: () => string,
  error: unknown,
) {
  if (!agentRunMetadataService || !run.threadId) {
    return;
  }

  await agentRunMetadataService.updateRun({
    completedAt: now(),
    errorCode: "run_failed",
    errorMessage:
      error instanceof Error ? error.message : "Deep agent runtime failed.",
    runId: run.runId,
    status: "failed",
  });
}

async function syncPersistedRunFromEvent(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  event: StreamEvent,
  now: () => string,
) {
  if (event.type === "run.completed") {
    await updatePersistedRunStatus(agentRunMetadataService, run, "completed", {
      completedAt: now(),
    });
    return;
  }

  if (event.type === "run.failed") {
    await updatePersistedRunFailure(
      agentRunMetadataService,
      run,
      now,
      new Error(event.error.message),
    );
    return;
  }

  if (event.type === "run.canceled") {
    await updatePersistedRunCanceled(agentRunMetadataService, run, now);
  }
}

async function updatePersistedRunCanceled(
  agentRunMetadataService: AgentRunMetadataService | undefined,
  run: RuntimeRunRecord,
  now: () => string,
) {
  if (!agentRunMetadataService || !run.threadId) return;

  // The persisted schema only has accepted/running/completed/failed. Keep the
  // cancellation reason explicit without inventing a second incompatible state.
  await agentRunMetadataService.updateRun({
    completedAt: now(),
    errorCode: "run_canceled",
    errorMessage: "Run canceled by the user.",
    runId: run.runId,
    status: "failed",
  });
}
