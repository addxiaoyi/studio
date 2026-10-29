import { registerExecutor, type ExecutorContext } from "../job-executor.js";
import sharp from "sharp";
import { generateVideo } from "../../../generation/video-generation.js";
import { resolveVideoProviderName } from "../../../generation/providers/registry.js";
import { generateConfiguredVideo } from "../../../local-db/provider-generation.js";
import { recordFeedArtifact, resolveFeedInputImages } from "./feed-render.js";
import { insertLocalVideoElement, insertVideoElement } from "../../canvas/canvas-element-writer.js";
import { createProviderAssetUrl } from "../../uploads/provider-asset-url.js";
import { decodeVideoDataUri, readVideoBody, resolveVideoMimeType } from "./video-download.js";
import type { GeneratedVideo } from "../../../generation/types.js";
import { getModelCallProfile } from "../../../local-db/model-call-profiles.js";

const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
const MIN_MINIMAX_FRAME_EDGE = 300;

async function normalizeMinimaxFrame(ctx: ExecutorContext, imageUrl: string, workspaceId: string, jobId: string): Promise<string> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Unable to read first-frame image (' + response.status + ')');
  const source = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(source).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (Math.min(width, height) >= MIN_MINIMAX_FRAME_EDGE) return imageUrl;
  if (!width || !height) throw new Error('First-frame image has no readable dimensions');
  const scale = MIN_MINIMAX_FRAME_EDGE / Math.min(width, height);
  const normalized = await sharp(source).rotate().resize({ width: Math.ceil(width * scale), height: Math.ceil(height * scale) }).jpeg({ quality: 92 }).toBuffer();
  const path = workspaceId + '/video-frames/' + jobId + '-' + width + 'x' + height + '.jpg';
  const uploaded = await ctx.storage.upload('project-assets', path, normalized, { contentType: 'image/jpeg', upsert: true });
  if (uploaded.error) throw new Error('Unable to store normalized first frame: ' + uploaded.error.message);
  const assetId = ctx.localDb
    ? (await ctx.localDb.query<{ id: string }>("insert into asset_objects (workspace_id,bucket,object_path,mime_type,byte_size,created_by) values ($1,'project-assets',$2,'image/jpeg',$3,$4) returning id", [workspaceId, path, normalized.length, (await ctx.localDb.query<{ created_by: string }>("select created_by from background_jobs where id=$1", [jobId])).rows[0]?.created_by ?? null])).rows[0]?.id
    : undefined;
  if (!assetId) throw new Error('Unable to register normalized first-frame asset');
  const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  const origin = ctx.env.webOrigin;
  if (!secret || !origin) throw new Error('Provider asset signing is not configured');
  const signedUrl = createProviderAssetUrl({ origin, assetId, secret });
  const probe = await fetch(signedUrl, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
  if (!probe.ok) throw new Error('Normalized first-frame URL is not publicly readable (HTTP ' + probe.status + ')');
  console.log('[video-job:' + jobId.slice(0, 8) + '] first_frame_normalized', JSON.stringify({ width, height, outputWidth: Math.ceil(width * scale), outputHeight: Math.ceil(height * scale) }));
  return signedUrl;
}

registerExecutor("video_generation", async (jobId, _rawPayload, ctx: ExecutorContext) => {
  const t0 = Date.now();

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
  const tag = `[video-job:${jobId.slice(0, 8)} session:${sessionShort}]`;
  const lap = (label: string) => console.log(`${tag} ${label} +${Date.now() - t0}ms`);
  lap("db_fetch");
  await ctx.jobService.updateProgress(jobId, 10, "准备生成");

  const payload = (jobRow.payload ?? {}) as {
    prompt: string;
    model?: string;
    duration?: number;
    resolution?: string;
    aspect_ratio?: string;
    input_images?: string[];
    input_asset_ids?: string[];
    input_video?: string;
    enable_audio?: boolean;
    routing?: Record<string, unknown>;
  };

  if (!payload.prompt) throw new Error(`Job ${jobId} has no prompt in payload`);

  const providerCheckpoint = jobRow.provider_result as (GeneratedVideo & { model?: string }) | null;
  const createdBy: string | null = jobRow.created_by ?? null;
  const workspaceId: string = jobRow.workspace_id ?? jobId;
  const model = providerCheckpoint?.model ?? payload.model ?? "wan-video/wan-2.6";
  const configuredApiFormat = !providerCheckpoint && ctx.localDb
    ? (await ctx.localDb.query<{ api_format: string }>(
        "select pc.api_format from provider_configs pc join provider_models pm on pm.provider_id=pc.id where pc.enabled=true and pm.enabled=true and pm.model_id=$1 order by pm.priority limit 1",
        [model],
      )).rows[0]?.api_format
    : undefined;
  const videoProfile = getModelCallProfile(
    model,
    configuredApiFormat ?? (/minimax-h3/i.test(model) ? "lingke_media" : "replicate"),
  );
  const inputImageOptions = videoProfile.inputImageTransport === "provider_url"
    ? { localAssetFormat: "signed_url" as const }
    : undefined;
  let inputImages = providerCheckpoint ? [] : await resolveFeedInputImages(
    ctx,
    payload.input_asset_ids,
    payload.input_images,
    workspaceId,
    inputImageOptions,
  );
  const inlineImageCount = inputImages.filter((image) => /^data:/i.test(image)).length;
  if (!providerCheckpoint && videoProfile.requiresPublicImageUrl && inlineImageCount > 0) {
    throw Object.assign(
      new Error(`Video model ${model} requires public HTTP(S) reference image URLs; received ${inlineImageCount} inline data URI(s)`),
      { code: "invalid_input" },
    );
  }
  if (!providerCheckpoint && videoProfile.maxInputImages != null && inputImages.length > videoProfile.maxInputImages) {
    console.log(`${tag} reference_images_truncated`, JSON.stringify({
      requestedImages: inputImages.length,
      acceptedImages: videoProfile.maxInputImages,
      model,
    }));
    inputImages = inputImages.slice(0, videoProfile.maxInputImages);
  }
  const requestedAssetIds = providerCheckpoint ? [] : Array.isArray(payload.input_asset_ids)
    ? payload.input_asset_ids.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const requestedImageRefs = providerCheckpoint ? [] : Array.isArray(payload.input_images)
    ? payload.input_images.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  if ((requestedAssetIds.length > 0 || requestedImageRefs.length > 0) && inputImages.length === 0) {
    throw new Error(`Video job ${jobId} received a reference image but no usable first-frame data`);
  }
  if (inputImages.length > 0) {
    console.log(`${tag} first_frame_resolved`, JSON.stringify({
      assetId: requestedAssetIds[0] ?? null,
      requestedImages: requestedImageRefs.length,
      resolvedImages: inputImages.length,
      firstFrame: true,
    }));
  }

  const normalizedImages = !providerCheckpoint && /minimax-h3/i.test(model) && inputImages.length > 0
    ? [await normalizeMinimaxFrame(ctx, inputImages[0]!, workspaceId, jobId), ...inputImages.slice(1)]
    : inputImages;
  const generationParams = {
    prompt: payload.prompt,
    model,
    ...(payload.duration != null ? { duration: payload.duration } : {}),
    ...(payload.resolution ? { resolution: payload.resolution as "480p" | "720p" | "768p" | "1080p" | "1088p" | "1440p" | "2160p" | "4k" } : {}),
    ...(payload.aspect_ratio ? { aspectRatio: payload.aspect_ratio } : {}),
    ...(normalizedImages.length ? { inputImages: normalizedImages } : {}),
    ...(payload.input_video ? { inputVideo: payload.input_video } : {}),
    ...(payload.enable_audio != null ? { enableAudio: payload.enable_audio } : {}),
  };

  // Renew VT every 120s (roughly half of the 300s video queue VT) to prevent
  // the message from becoming visible during long video generation.
  const VIDEO_VT_SECONDS = 300;
  const heartbeatTimer = setInterval(() => {
    ctx.renewVt(VIDEO_VT_SECONDS);
    void ctx.heartbeat(25, "视频模型处理中");
  }, 120_000);

  try {
    lap(providerCheckpoint ? "resume_after_provider" : "provider_call_start");
    await ctx.jobService.updateProgress(jobId, 25, "调用视频模型");
    let generated: GeneratedVideo | null = providerCheckpoint && typeof providerCheckpoint.url === "string"
      ? providerCheckpoint
      : null;
    if (!generated) {
    const configuredVideo = ctx.localDb
      ? await generateConfiguredVideo(ctx.localDb, model, {
          prompt: payload.prompt,
          ...(payload.duration != null ? { duration: payload.duration } : {}),
          ...(payload.resolution ? { resolution: payload.resolution } : {}),
          ...(payload.aspect_ratio ? { aspectRatio: payload.aspect_ratio } : {}),
          ...(normalizedImages.length ? { inputImages: normalizedImages } : {}),
          ...(payload.input_video ? { inputVideo: payload.input_video } : {}),
          ...(payload.enable_audio != null ? { enableAudio: payload.enable_audio } : {}),
        })
      : null;
    if (ctx.localDb && !configuredVideo) {
      throw new Error(`Selected video model ${model} has no available configured provider`);
    }
    generated = configuredVideo ?? await generateVideo(resolveVideoProviderName(model), generationParams);
    if (!generated) throw new Error(`Video provider ${model} returned no result`);
    await ctx.jobService.saveProviderResult(jobId, { ...generated, model });
    } else {
      lap("provider_checkpoint_restored");
    }
    let mimeType = resolveVideoMimeType(generated.mimeType, null);
    lap("replicate_call_done");
    await ctx.jobService.updateProgress(jobId, 72, "模型已返回，下载视频");

    // Vertex AI returns inline base64 data URIs; Developer API returns HTTP URLs.
    let buffer: Buffer;
    if (generated.url.startsWith("data:")) {
      buffer = decodeVideoDataUri(generated.url, generated.mimeType);
    } else {
      const response = await fetch(generated.url, { signal: AbortSignal.timeout(VIDEO_DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
      }
      mimeType = resolveVideoMimeType(generated.mimeType, response.headers.get("content-type"));
      buffer = await readVideoBody(response);

    }
    lap("video_download_done");
    await ctx.jobService.updateProgress(jobId, 88, "保存生成资产");

    const ext = mimeType === "video/webm" ? "webm" : "mp4";
    const objectPath = `${workspaceId}/generated/${jobId}.${ext}`;

    const { error: uploadError } = await ctx.storage.upload(
      "project-assets",
      objectPath,
      buffer,
      {
        contentType: mimeType,
        upsert: true,
      }
    );

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    lap("storage_upload_done");

    const assetRow = ctx.localDb
      ? (await ctx.localDb.query("insert into asset_objects (workspace_id, bucket, object_path, mime_type, byte_size, created_by) values ($1, 'project-assets', $2, $3, $4, $5) on conflict (object_path) do update set mime_type=excluded.mime_type, byte_size=excluded.byte_size returning id", [workspaceId, objectPath, mimeType, buffer.length, createdBy])).rows[0]
      : (await admin!.from("asset_objects").upsert({ workspace_id: workspaceId, bucket: "project-assets", object_path: objectPath, mime_type: mimeType, byte_size: buffer.length, ...(createdBy ? { created_by: createdBy } : {}) }, { onConflict: "object_path" }).select("id").single()).data;

    if (!assetRow) {
      throw new Error("Failed to create asset record: unknown error");
    }
    lap("asset_record_done");
    await ctx.jobService.updateProgress(jobId, 100, "生成完成");

    const assetId = (assetRow as { id: string }).id;
    const resultUrl = ctx.localDb
      ? `/api/uploads/${assetId}/file`
      : (await ctx.storage.getPublicUrl("project-assets", objectPath)).data?.signedUrl;
    if (!resultUrl) throw new Error("Storage URL creation failed: missing URL");

    let canvasElementId: string | undefined;
    let syncError: string | undefined;
    const canvasId = jobRow.canvas_id as string | null;
    if (canvasId) {
      const insertOptions = {
        canvasId,
        signedUrl: resultUrl,
        assetId,
        width: generated.width,
        height: generated.height,
        mimeType,
        ...(generated.durationSeconds !== undefined ? { durationSeconds: generated.durationSeconds } : {}),
        title: "AI生成视频",
        prompt: payload.prompt,
        jobId,
      };
      try {
        if (ctx.localDb) {
          canvasElementId = (await insertLocalVideoElement(ctx.localDb, insertOptions)).elementId;
        } else if (admin) {
          canvasElementId = (await insertVideoElement(admin, insertOptions)).elementId;
        }
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
        console.error(`${tag} canvas sync pending:`, syncError);
      }
    }

    let feedAssetId: string | undefined;
    try {
      const recordedAssetId = await recordFeedArtifact(ctx, jobId, payload as Record<string, unknown>, {
        objectPath,
        mimeType,
        mediaType: "video",
        title: "Feed video",
        prompt: payload.prompt,
        metadata: {
          width: generated.width,
          height: generated.height,
          durationSeconds: generated.durationSeconds,
          model,
        },
      });
      if (recordedAssetId) feedAssetId = recordedAssetId;
    } catch (error) {
      console.error("[video-job] feed artifact write failed", error);
    }

    lap("total");
    return {
      asset_id: assetId,
      signed_url: resultUrl,
      object_path: objectPath,
      width: generated.width,
      height: generated.height,
      duration_seconds: generated.durationSeconds,
      mime_type: mimeType,
      model,
      ...(feedAssetId ? { generated_asset_id: feedAssetId } : {}),
      ...(canvasElementId ? { canvas_element_id: canvasElementId } : {}),
      ...(syncError ? { sync_pending: true, sync_error_code: "canvas_sync_failed", sync_error_message: syncError } : {}),
      ...(payload.routing ? { routing: payload.routing } : {}),
      ...(generated.usage ? { usage: generated.usage } : {}),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Video generation failed for model ${model}: ${detail}`);
    // Preserve the original error code so the worker can distinguish
    // non-retryable errors (e.g. invalid_input) from transient failures.
    (wrapped as Error & { code?: string }).code =
      (err as { code?: string })?.code ?? "executor_error";
    throw wrapped;
  } finally {
    clearInterval(heartbeatTimer);
  }
});
