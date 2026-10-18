// @credits-system — Image generation executor: applies watermark (only on insufficient credits)
import { registerExecutor, type ExecutorContext } from "../job-executor.js";
import { generateImage } from "../../../generation/image-generation.js";
import { resolveImageProviderName } from "../../../generation/providers/registry.js";
import { applyWatermark } from "../../credits/watermark.js";
import { generateConfiguredImage } from "../../../local-db/provider-generation.js";
import { resolveConfiguredModel } from "../../../http/model-availability.js";
import { recordFeedArtifact, resolveFeedInputImages } from "./feed-render.js";
import { insertImageElement, insertLocalImageElement } from "../../canvas/canvas-element-writer.js";
import { getModelCallProfile } from "../../../local-db/model-call-profiles.js";
import { createProviderAssetUrl } from "../../uploads/provider-asset-url.js";
import { isRemovedImageModelId } from "../../../generation/removed-models.js";
import type { GeneratedImage } from "../../../generation/types.js";

registerExecutor("image_generation", async (jobId, _rawPayload, ctx: ExecutorContext) => {
  const t0 = Date.now();

  // Read the full job row including payload from the database.
  // The PGMQ message only contains { job_id, job_type, workspace_id },
  // so we must fetch prompt/model/aspect_ratio from background_jobs.payload.
  const admin = ctx.localDb ? null : ctx.getAdminClient();
  const jobRow = ctx.localDb
    ? (await ctx.localDb.query("select created_by, workspace_id, canvas_id, session_id, status, payload, provider_result from background_jobs where id = $1", [jobId])).rows[0]
    : (await admin!.from("background_jobs").select("created_by, workspace_id, canvas_id, session_id, status, payload, provider_result").eq("id", jobId).single()).data;

  if (!jobRow) throw new Error(`Job ${jobId} not found in database`);
  if (jobRow.status === "canceled") {
    const error = new Error(`Job ${jobId} was canceled before execution`);
    (error as Error & { code?: string }).code = "job_canceled";
    throw error;
  }

  // Build log tag with traceability context: jobId + sessionId (if available)
  const sessionShort = (jobRow.session_id as string)?.slice(0, 8) ?? "no-session";
  const tag = `[image-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
  const lap = (label: string) => console.log(`${tag} ${label} +${Date.now() - t0}ms`);
  lap("db_fetch");
  await ctx.jobService.updateProgress(jobId, 10, "准备生成");

  const payload = (jobRow.payload ?? {}) as {
    prompt: string;
    model?: string;
    aspect_ratio?: string;
    title?: string;
    input_asset_ids?: string[];
    input_images?: string[];
    routing?: Record<string, unknown>;
  };

  if (!payload.prompt) throw new Error(`Job ${jobId} has no prompt in payload`);

  const providerCheckpoint = jobRow.provider_result as (GeneratedImage & { model?: string }) | null;
  const createdBy: string | null = jobRow.created_by ?? null;
  const workspaceId: string = jobRow.workspace_id ?? jobId;
  const inputImages = providerCheckpoint ? [] : await resolveFeedInputImages(ctx, payload.input_asset_ids, payload.input_images, workspaceId);

  // Resolve provider dynamically from model ID via registry
  const requestedModel = payload.model ?? "black-forest-labs/flux-kontext-pro";
  const selectedModels = payload.routing?.requestedModels;
  const isManualSelection = Array.isArray(selectedModels) && selectedModels.length > 0;
  if (!providerCheckpoint && isRemovedImageModelId(requestedModel)) {
    throw Object.assign(new Error(`Image model ${requestedModel} has been retired`), { code: "model_not_found" });
  }
  const routedModel = !providerCheckpoint && ctx.localDb
    ? await resolveConfiguredModel(ctx.localDb, "image", requestedModel, {
        requiresInputImage: Boolean(inputImages?.length),
        allowUnverified: isManualSelection,
        excludeModelIds: [
          "nano-banana-2-1k",
          "nano-banana-2-2k",
        ],
      })
    : null;
  const model = providerCheckpoint?.model ?? routedModel?.model_id ?? requestedModel;
  if (!providerCheckpoint && ctx.localDb && !routedModel) {
    throw new Error("当前没有健康且兼容的图片模型");
  }
  const providerName = ctx.localDb ? "configured" : resolveImageProviderName(model);

  // Renew VT every 60s (half of the 120s image queue VT) to prevent
  // the message from becoming visible while we are still processing.
  const IMAGE_VT_SECONDS = 120;
  const heartbeatTimer = setInterval(() => {
    ctx.renewVt(IMAGE_VT_SECONDS);
    void ctx.heartbeat(25, "图片模型处理中");
  }, 60_000);

  // Log input image format for debugging the data-URI-passthrough pipeline
  if (inputImages?.length) {
    const formats = inputImages.map((img) =>
      img.startsWith("data:") ? "data-uri" : "url",
    );
    console.log(`${tag} input_images formats: [${formats.join(", ")}] (${formats.length} total)`);
  }

  try {
    // Generate image via the registered provider
    lap(providerCheckpoint ? "resume_after_provider" : `${providerName}_call_start`);
    await ctx.jobService.updateProgress(jobId, 25, "调用图片模型");
    let generated: GeneratedImage | null = providerCheckpoint && typeof providerCheckpoint.url === "string" ? providerCheckpoint : null;
    try {
      if (generated) lap("provider_checkpoint_restored");
      else {
      generated = ctx.localDb
        ? await generateConfiguredImage(ctx.localDb, model, {
            prompt: payload.prompt,
            model,
            ...(payload.aspect_ratio !== undefined ? { aspectRatio: payload.aspect_ratio } : {}),
            ...(inputImages?.length ? { inputImages } : {}),
          }, {
            allowUnverified: isManualSelection,
            ...(inputImages.length ? {
              providerUrlForInput: async (inputUrl, index) => {
                if (/^https?:\/\//i.test(inputUrl)) return inputUrl;
                const assetId = payload.input_asset_ids?.[index];
                if (!assetId) {
                  throw Object.assign(
                    new Error("Reference image must be a public URL or a workspace asset"),
                    { code: "invalid_input" },
                  );
                }
                const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
                if (!secret) throw Object.assign(new Error("Provider asset signing is not configured"), { code: "invalid_input" });
                return createProviderAssetUrl({ origin: ctx.env.webOrigin, assetId, secret });
              },
            } : {}),
          })
        : await generateImage(providerName, {
        prompt: payload.prompt,
        model,
        ...(payload.aspect_ratio !== undefined ? { aspectRatio: payload.aspect_ratio } : {}),
        ...(inputImages?.length ? { inputImages } : {}),
        });
      if (!generated) throw new Error(`图片模型 ${model} 当前没有可调用渠道：请检查渠道启用状态、健康状态和冷却时间。这不代表参考图不兼容。`);
      await ctx.jobService.saveProviderResult(jobId, { ...generated, model });
      }
    } catch (genError) {
      const detail = genError instanceof Error ? genError.message : String(genError);
      const wrapped = new Error(`Image generation failed for model ${model}: ${detail}`);
      (wrapped as Error & { code?: string }).code =
        (genError as { code?: string })?.code ?? "executor_error";
      throw wrapped;
    }
    lap(`${providerName}_call_done`);
    await ctx.jobService.updateProgress(jobId, 70, "模型已返回，下载图片");

    // Download the generated image from the provider CDN
    let buffer: Buffer | undefined;
    const response = generated.url.startsWith("data:")
      ? null
      : await fetch(generated.url, { signal: AbortSignal.timeout(60_000) });
    if (!response) {
      const match = generated.url.match(/^data:image\/[^;]+;base64,(.+)$/i);
      const encoded = match?.[1];
      if (!encoded) throw new Error("Generated image returned an invalid data URI");
      buffer = Buffer.from(encoded, "base64");
    } else {
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > 25 * 1024 * 1024) throw new Error("Generated image exceeds the 25 MB limit");
    }
    if (response && !response.ok) {
      throw new Error(`Failed to download generated image from ${model}: ${response.status} ${response.statusText}`);
    }
    if (response) {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 25 * 1024 * 1024) throw new Error("Generated image exceeds the 25 MB limit");
      buffer = Buffer.from(arrayBuffer);
    }
    if (!buffer) throw new Error("Generated image download returned no bytes");
    lap("image_download_done");

    // In the top-up credit system, no watermarking is applied.
    // (Helstera has no plan-based tiers — every user can use any
    // model as long as they have sufficient credit balance.)

    // Upload to Storage under the project-assets bucket
    const ext = generated.mimeType === "image/webp" ? "webp" : generated.mimeType === "image/jpeg" ? "jpg" : "png";
    const objectPath = `${workspaceId}/generated/${jobId}.${ext}`;

    const { error: uploadError } = await ctx.storage.upload(
      "project-assets",
      objectPath,
      buffer,
      {
        contentType: generated.mimeType ?? "image/png",
        upsert: true,
      }
    );

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    lap("storage_upload_done");
    await ctx.jobService.updateProgress(jobId, 88, "保存生成资产");

    // Insert asset_objects record — only include created_by if we have a valid user UUID
    const assetRow = ctx.localDb
      ? (await ctx.localDb.query("insert into asset_objects (workspace_id, bucket, object_path, mime_type, byte_size, created_by) values ($1, 'project-assets', $2, $3, $4, $5) on conflict (object_path) do update set mime_type=excluded.mime_type, byte_size=excluded.byte_size returning id", [workspaceId, objectPath, generated.mimeType ?? "image/png", buffer.length, createdBy])).rows[0]
      : (await admin!.from("asset_objects").upsert({ workspace_id: workspaceId, bucket: "project-assets", object_path: objectPath, mime_type: generated.mimeType ?? "image/png", byte_size: buffer.length, ...(createdBy ? { created_by: createdBy } : {}) }, { onConflict: "object_path" }).select("id").single()).data;
    if (!assetRow) {
      throw new Error(
        "Failed to create asset record: unknown error",
      );
    }

    lap("asset_record_done");

    // Generate a public URL for the result consumer
    const assetId = (assetRow as { id: string }).id;
    const resultUrl = ctx.localDb
      ? `/api/uploads/${assetId}/file`
      : (await ctx.storage.getPublicUrl("project-assets", objectPath)).data?.signedUrl;
    if (!resultUrl) throw new Error("Storage URL creation failed: missing URL");

    let canvasElementId: string | undefined;
    let syncError: string | undefined;
    const canvasId = jobRow.canvas_id as string | null;
    if (canvasId) {
      try {
        const insertOptions = {
          canvasId,
          objectPath,
          assetId,
          width: generated.width,
          height: generated.height,
          mimeType: generated.mimeType ?? "image/png",
          title: payload.title ?? "AI生成图片",
          jobId,
        };
        if (ctx.localDb) {
          const existing = await ctx.localDb.query("select content from canvases where id=$1", [canvasId]);
          const content = existing.rows[0]?.content as { elements?: unknown } | null | undefined;
          const elements = (content?.elements ?? []) as Array<{ customData?: { jobId?: string } }>;
          const prior = elements.find((element) => element.customData?.jobId === jobId);
          canvasElementId = prior ? undefined : (await insertLocalImageElement(ctx.localDb, ctx.storage, insertOptions)).elementId;
        } else if (admin) {
          const existing = await admin.from("canvases").select("content").eq("id", canvasId).single();
          const content = existing.data?.content as { elements?: unknown } | null | undefined;
          const elements = (content?.elements ?? []) as Array<{ customData?: { jobId?: string } }>;
          const prior = elements.find((element) => element.customData?.jobId === jobId);
          canvasElementId = prior ? undefined : (await insertImageElement(admin, ctx.storage, insertOptions)).elementId;
        }
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
        console.error(`[image-job:${jobId.slice(0, 8)}] canvas sync pending:`, syncError);
      }
    }

    let feedAssetId: string | undefined;
    try {
      const recordedAssetId = await recordFeedArtifact(ctx, jobId, payload as Record<string, unknown>, {
        objectPath,
        mimeType: generated.mimeType ?? "image/png",
        mediaType: "image",
        title: payload.title ?? "Feed image",
        prompt: payload.prompt,
        metadata: { width: generated.width, height: generated.height, model },
      });
      if (recordedAssetId) feedAssetId = recordedAssetId;
    } catch (error) {
      console.error("[image-job] feed artifact write failed", error);
    }

    lap("total");
    await ctx.jobService.updateProgress(jobId, 100, "生成完成");
    return {
      asset_id: assetId,
      signed_url: resultUrl,
      object_path: objectPath,
      width: generated.width,
      height: generated.height,
      ...(generated.usage ? { usage: generated.usage } : {}),
      mime_type: generated.mimeType ?? "image/png",
      model,
      ...(feedAssetId ? { generated_asset_id: feedAssetId } : {}),
      ...(canvasElementId ? { canvas_element_id: canvasElementId } : {}),
      ...(syncError ? { sync_pending: true, sync_error_code: "canvas_sync_failed", sync_error_message: syncError } : {}),
      ...(payload.routing ? { routing: payload.routing } : {}),
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
});
