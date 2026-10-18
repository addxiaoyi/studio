import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { createProviderAssetUrl } from "../../uploads/provider-asset-url.js";

import type { ExecutorContext } from "../job-executor.js";

export type FeedRenderArtifactType = "feed_image" | "feed_video";

export type FeedRenderJobPlan = {
  artifactType: FeedRenderArtifactType;
  jobType: "image_generation" | "video_generation";
  queueName: "image_generation_jobs" | "video_generation_jobs";
  payload: Record<string, unknown>;
};

type FeedPackageRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  status: string;
  structure: Record<string, unknown> | null;
  model_id: string | null;
  duration_seconds: number;
};

type FeedJobRow = {
  id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
};

type FeedArtifact = {
  objectPath: string;
  mimeType: string;
  mediaType: "image" | "video";
  title: string;
  prompt: string;
  metadata?: Record<string, unknown>;
};

const renderStatuses = new Set(["structured", "approved", "rendering", "failed"]);

export type FeedRenderQueueMode = "auto" | "local" | "pgmq";

let feedRenderQueueMode: FeedRenderQueueMode = "auto";

export function configureFeedRenderQueue(mode: FeedRenderQueueMode): void {
  feedRenderQueueMode = mode;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

const uploadAssetPath = /\/api\/uploads\/([0-9a-f-]{36})\/file(?:$|[?#])/i;

export function extractFeedUploadAssetId(value: string): string | null {
  return value.match(uploadAssetPath)?.[1] ?? null;
}

export function collectFeedReferenceAssetIds(input: {
  referenceAssetIds?: string[] | null;
  referenceImageUrls?: string[] | null;
}): string[] {
  const ids = [
    ...(input.referenceAssetIds ?? []),
    ...(input.referenceImageUrls ?? []).flatMap((url) => {
      const assetId = extractFeedUploadAssetId(url);
      return assetId ? [assetId] : [];
    }),
  ];
  return [...new Set(ids)];
}

export async function findMissingFeedReferenceAssets(
  db: Pool | PoolClient,
  workspaceId: string,
  assetIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(assetIds)];
  if (!uniqueIds.length) return [];
  const { rows } = await db.query<{ id: string }>(
    "select id from asset_objects where workspace_id=$1 and id=any($2::uuid[])",
    [workspaceId, uniqueIds],
  );
  const found = new Set(rows.map((row) => row.id));
  return uniqueIds.filter((assetId) => !found.has(assetId));
}

export function buildFeedRenderPlan(pkg: FeedPackageRow): FeedRenderJobPlan[] {
  const structure = pkg.structure ?? {};
  const imagePrompt = typeof structure.imagePrompt === "string" ? structure.imagePrompt.trim() : "";
  const videoPrompt = typeof structure.videoPrompt === "string" ? structure.videoPrompt.trim() : "";
  if (!imagePrompt || !videoPrompt) {
    throw new Error("内容包缺少图片或视频提示词");
  }

  const inputImages = stringList(
    structure.referenceImageUrls ?? structure.reference_image_urls ?? structure.input_images,
  );
  const inputAssetIds = stringList(structure.referenceAssetIds ?? structure.reference_asset_ids);
  const common = {
    feed_package_id: pkg.id,
    feed_workspace_id: pkg.workspace_id,
    feed_created_by: pkg.created_by,
    input_asset_ids: inputAssetIds,
    input_images: inputImages,
  };

  return [
    {
      artifactType: "feed_image",
      jobType: "image_generation",
      queueName: "image_generation_jobs",
      payload: {
        ...common,
        feed_artifact_type: "feed_image",
        prompt: imagePrompt,
        ...(pkg.model_id ? { model: pkg.model_id } : {}),
        aspect_ratio: typeof structure.imageAspectRatio === "string" ? structure.imageAspectRatio : "2:3",
        ...(inputAssetIds.length ? { input_asset_ids: inputAssetIds } : {}),
        ...(inputImages.length ? { input_images: inputImages } : {}),
      },
    },
    {
      artifactType: "feed_video",
      jobType: "video_generation",
      queueName: "video_generation_jobs",
      payload: {
        ...common,
        feed_artifact_type: "feed_video",
        prompt: videoPrompt,
        ...(pkg.model_id ? { model: pkg.model_id } : {}),
        duration: pkg.duration_seconds,
        enable_audio: false,
        aspect_ratio: typeof structure.videoAspectRatio === "string" ? structure.videoAspectRatio : "9:16",
        ...(inputAssetIds.length ? { input_asset_ids: inputAssetIds } : {}),
        ...(inputImages.length ? { input_images: inputImages } : {}),
      },
    },
  ];
}

type FeedReferenceAsset = {
  id: string;
  bucket: string;
  objectPath: string;
  mimeType: string | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadFeedReferenceAssets(
  ctx: ExecutorContext,
  workspaceId: string,
  assetIds: string[],
): Promise<Map<string, FeedReferenceAsset>> {
  const uniqueIds = [...new Set(assetIds)];
  if (!uniqueIds.length) return new Map();
  const invalidIds = uniqueIds.filter((assetId) => !uuidPattern.test(assetId));
  if (invalidIds.length) throw new Error(`参考图 assetId 格式不合法: ${invalidIds.join(", ")}`);

  let rows: FeedReferenceAsset[];
  if (ctx.localDb) {
    const result = await ctx.localDb.query<{
      id: string;
      bucket: string;
      object_path: string;
      mime_type: string | null;
    }>(
      "select id,bucket,object_path,mime_type from asset_objects where workspace_id=$1 and id=any($2::uuid[])",
      [workspaceId, uniqueIds],
    );
    rows = result.rows.map((row) => ({
      id: row.id,
      bucket: row.bucket,
      objectPath: row.object_path,
      mimeType: row.mime_type,
    }));
  } else {
    const { data, error } = await (ctx.getAdminClient() as any)
      .from("asset_objects")
      .select("id,bucket,object_path,mime_type")
      .eq("workspace_id", workspaceId)
      .in("id", uniqueIds);
    if (error) throw new Error(`参考图资产查询失败: ${error.message}`);
    rows = (data ?? []).map((row: { id: string; bucket: string; object_path: string; mime_type: string | null }) => ({
      id: row.id,
      bucket: row.bucket,
      objectPath: row.object_path,
      mimeType: row.mime_type,
    }));
  }

  const found = new Map(rows.map((asset) => [asset.id, asset]));
  const missing = uniqueIds.filter((assetId) => !found.has(assetId));
  if (missing.length) throw new Error(`参考图资产不存在或不属于当前工作区: ${missing.join(", ")}`);
  return found;
}

function localReferenceAssetUrl(ctx: ExecutorContext, asset: FeedReferenceAsset): string {
  if (asset.mimeType && !asset.mimeType.startsWith("image/")) {
    throw new Error(`参考图资产 ${asset.id} 不是图片文件`);
  }
  const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  if (!secret) throw new Error("Provider asset URL signing is not configured");
  const origin = ctx.env.webOrigin;
  if (!origin) throw new Error("Public app origin is not configured for provider reference URLs");
  return createProviderAssetUrl({ origin, assetId: asset.id, secret });
}

async function localReferenceAssetToDataUri(ctx: ExecutorContext, asset: FeedReferenceAsset): Promise<string> {
  if (asset.mimeType && !asset.mimeType.startsWith("image/")) {
    throw new Error(`Reference asset ${asset.id} is not an image`);
  }
  const downloaded = await ctx.storage.download(asset.bucket, asset.objectPath);
  if (downloaded.error || !downloaded.data) {
    throw new Error(`Unable to read reference asset ${asset.id}: ${downloaded.error?.message ?? "empty file"}`);
  }
  const normalized = await sharp(downloaded.data)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

async function signedReferenceAssetUrl(ctx: ExecutorContext, asset: FeedReferenceAsset): Promise<string> {
  const signed = await ctx.storage.getPublicUrl(asset.bucket, asset.objectPath, 3600);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`参考图资产 ${asset.id} 签名 URL 生成失败: ${signed.error?.message ?? "missing URL"}`);
  }
  return signed.data.signedUrl;
}

export async function resolveFeedInputImages(
  ctx: ExecutorContext,
  inputAssetIds: unknown,
  inputImages: unknown,
  workspaceId: string,
  options?: { localAssetFormat?: "data_uri" | "signed_url" },
): Promise<string[]> {
  const assetIds = stringList(inputAssetIds);
  const legacyImages = stringList(inputImages);
  const requiresPublicUrls = options?.localAssetFormat === "signed_url";
  const hasCanonicalAssets = assetIds.length > 0;
  const legacyAssetIds = legacyImages.flatMap((image) => {
    const assetId = extractFeedUploadAssetId(image);
    return assetId ? [assetId] : [];
  });
  const assets = await loadFeedReferenceAssets(ctx, workspaceId, [...assetIds, ...legacyAssetIds]);
  const resolved = new Map<string, string>();

  for (const [assetId, asset] of assets) {
    resolved.set(assetId, ctx.localDb
      ? options?.localAssetFormat === "signed_url"
        ? localReferenceAssetUrl(ctx, asset)
        : await localReferenceAssetToDataUri(ctx, asset)
      : await signedReferenceAssetUrl(ctx, asset));
  }

  const output: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      output.push(value);
    }
  };
  for (const assetId of assetIds) {
    const value = resolved.get(assetId);
    if (value) add(value);
  }
  for (const image of legacyImages) {
    if (/^data:/i.test(image)) {
      // Asset IDs are canonical for URL-only Providers. The browser also
      // sends the old inline copy, which must not become another reference.
      // The same rule applies to data-URI mode when asset IDs are present:
      // keep the resolved asset order and drop the legacy duplicate.
      if (!requiresPublicUrls && !hasCanonicalAssets) add(image);
      continue;
    }
    const assetId = extractFeedUploadAssetId(image);
    if (assetId) {
      const value = resolved.get(assetId);
      if (!value) throw new Error(`参考图资产 ${assetId} 不存在或不属于当前工作区`);
      add(value);
      continue;
    }
    add(image);
  }
  if (requiresPublicUrls && output.length === 0 && legacyImages.length > 0) {
    throw new Error("Reference images for this provider must be public URLs or asset IDs");
  }
  return output;
}

export async function enqueueFeedRenderJobs(
  db: Pool,
  packageId: string,
  workspaceId: string,
  createdBy: string,
): Promise<{ package: FeedPackageRow; jobs: FeedJobRow[] }> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<FeedPackageRow>(
      `select id,workspace_id,created_by,status,structure,model_id,duration_seconds
       from content_packages
       where id=$1 and workspace_id=$2
       for update`,
      [packageId, workspaceId],
    );
    const pkg = rows[0];
    if (!pkg) throw new Error("内容包不存在");
    if (pkg.created_by !== createdBy) throw new Error("内容包不属于当前用户");
    if (!renderStatuses.has(pkg.status)) {
      throw new Error("内容包当前状态不可生成");
    }

    const plan = buildFeedRenderPlan(pkg);
    const jobs: FeedJobRow[] = [];
    let pgmqAvailable: boolean | undefined;
    for (const step of plan) {
      const existing = await client.query<FeedJobRow>(
        `select id,job_type,status,payload
         from background_jobs
         where workspace_id=$1
           and payload->>'feed_package_id'=$2
           and payload->>'feed_artifact_type'=$3
           and job_type=$4
           and status not in ('failed','dead_letter','canceled')
         order by created_at desc
         limit 1`,
        [workspaceId, packageId, step.artifactType, step.jobType],
      );
      if (existing.rows[0]) {
        jobs.push(existing.rows[0]);
        continue;
      }

      const created = await client.query<FeedJobRow>(
        `insert into background_jobs(
           workspace_id,queue_name,job_type,status,payload,created_by,stage
         ) values($1,$2,$3,'queued',$4,$5,'等待生成')
         returning id,job_type,status,payload`,
        [workspaceId, step.queueName, step.jobType, step.payload, createdBy],
      );
      const job = created.rows[0];
      if (!job) throw new Error("后台任务创建失败");
      if (pgmqAvailable === undefined) {
        pgmqAvailable = feedRenderQueueMode === "local" ? false : await hasPgmqSend(client);
        if (feedRenderQueueMode === "pgmq" && !pgmqAvailable) {
          throw new Error("生产队列未配置 PGMQ，请先启用 pgmq.send");
        }
      }
      if (pgmqAvailable) {
        await sendFeedRenderMessage(client, step.queueName, {
          job_id: job.id,
          job_type: step.jobType,
          workspace_id: workspaceId,
          feed_package_id: packageId,
        });
      }
      jobs.push(job);
    }

    await client.query(
      `update content_packages
       set status='rendering',updated_at=now()
       where id=$1 and workspace_id=$2 and status in ('structured','approved','rendering','failed')`,
      [packageId, workspaceId],
    );
    await client.query("commit");
    return { package: { ...pkg, status: "rendering" }, jobs };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function isFeedRenderPayload(payload: Record<string, unknown>): payload is Record<string, unknown> & {
  feed_package_id: string;
  feed_workspace_id: string;
  feed_artifact_type: FeedRenderArtifactType;
} {
  return (
    typeof payload.feed_package_id === "string" &&
    typeof payload.feed_workspace_id === "string" &&
    (payload.feed_artifact_type === "feed_image" || payload.feed_artifact_type === "feed_video")
  );
}

export async function recordFeedArtifact(
  ctx: ExecutorContext,
  jobId: string,
  payload: Record<string, unknown>,
  artifact: FeedArtifact,
): Promise<string | null> {
  if (!isFeedRenderPayload(payload)) return null;

  const { feed_package_id: packageId, feed_workspace_id: workspaceId, feed_artifact_type: artifactType } = payload;
  const metadata = { ...(artifact.metadata ?? {}), sourceJobId: jobId, objectPath: artifact.objectPath };

  if (ctx.localDb) {
    const { rows } = await ctx.localDb.query<{ id: string }>(
      `insert into generated_assets(
         workspace_id,created_by,source_job_id,media_type,object_path,mime_type,title,prompt,metadata
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict(workspace_id,object_path) do update set
         source_job_id=excluded.source_job_id,mime_type=excluded.mime_type,metadata=excluded.metadata,deleted_at=null
       returning id`,
      [workspaceId, payload.feed_created_by ?? null, jobId, artifact.mediaType, artifact.objectPath, artifact.mimeType, artifact.title, artifact.prompt, metadata],
    );
    const assetId = rows[0]?.id;
    if (!assetId) throw new Error("生成资产登记失败");
    await ctx.localDb.query(
      `insert into content_artifacts(package_id,asset_id,artifact_type,metadata)
       select $1,$2,$3,$4
       where exists(select 1 from content_packages where id=$1 and workspace_id=$5)
         and not exists(select 1 from content_artifacts where package_id=$1 and artifact_type=$3)`,
      [packageId, assetId, artifactType, metadata, workspaceId],
    );
    await markFeedPackageReady(ctx.localDb, packageId, workspaceId);
    return assetId;
  }

  const admin = ctx.getAdminClient() as any;
  const existing = await admin
    .from("generated_assets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("object_path", artifact.objectPath)
    .maybeSingle();
  if (existing.error) throw new Error(`生成资产查询失败: ${existing.error.message}`);
  let assetId = existing.data?.id as string | undefined;
  if (!assetId) {
    const inserted = await admin.from("generated_assets").insert({
      workspace_id: workspaceId,
      created_by: payload.feed_created_by ?? null,
      source_job_id: jobId,
      media_type: artifact.mediaType,
      object_path: artifact.objectPath,
      mime_type: artifact.mimeType,
      title: artifact.title,
      prompt: artifact.prompt,
      metadata,
    }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(`生成资产登记失败: ${inserted.error?.message ?? "empty result"}`);
    assetId = inserted.data.id as string;
  }
  const existingArtifact = await admin
    .from("content_artifacts")
    .select("id")
    .eq("package_id", packageId)
    .eq("artifact_type", artifactType)
    .maybeSingle();
  if (existingArtifact.error) throw new Error(`内容资产查询失败: ${existingArtifact.error.message}`);
  if (!existingArtifact.data) {
    const insertedArtifact = await admin.from("content_artifacts").insert({
      package_id: packageId,
      asset_id: assetId,
      artifact_type: artifactType,
      metadata,
    });
    if (insertedArtifact.error) throw new Error(`内容资产关联失败: ${insertedArtifact.error.message}`);
  }
  await markFeedPackageReady(null, packageId, workspaceId, admin);
  return assetId;
}

export async function markFeedPackageFailed(
  ctx: ExecutorContext,
  payload: Record<string, unknown>,
  message: string,
): Promise<void> {
  if (!isFeedRenderPayload(payload)) return;
  if (ctx.localDb) {
    await ctx.localDb.query(
      `update content_packages set status='failed',updated_at=now()
       where id=$1 and workspace_id=$2 and status in ('rendering','structured','approved','failed')`,
      [payload.feed_package_id, payload.feed_workspace_id],
    );
    return;
  }
  const { error } = await (ctx.getAdminClient() as any)
    .from("content_packages")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", payload.feed_package_id)
    .eq("workspace_id", payload.feed_workspace_id)
    .in("status", ["rendering", "structured", "approved", "failed"]);
  if (error) throw new Error(`内容包失败状态写入失败: ${message}: ${error.message}`);
}

async function hasPgmqSend(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ available: boolean }>(
    "select to_regprocedure('pgmq.send(text,jsonb,integer)') is not null as available",
  );
  return rows[0]?.available === true;
}

async function sendFeedRenderMessage(
  client: PoolClient,
  queueName: string,
  message: Record<string, unknown>,
): Promise<void> {
  const { rows } = await client.query<{ msg_id: string | number }>(
    "select pgmq.send($1::text, $2::jsonb, 0) as msg_id",
    [queueName, JSON.stringify(message)],
  );
  if (rows[0]?.msg_id === undefined || rows[0]?.msg_id === null) {
    throw new Error(`PGMQ 入队失败: ${queueName}`);
  }
}

async function markFeedPackageReady(
  db: Pool | null,
  packageId: string,
  workspaceId: string,
  admin?: any,
): Promise<void> {
  if (db) {
    await db.query(
      `update content_packages cp
       set status='ready',updated_at=now()
       where cp.id=$1 and cp.workspace_id=$2 and cp.status='rendering'
         and exists(select 1 from content_artifacts ca where ca.package_id=cp.id and ca.artifact_type='feed_image')
         and exists(select 1 from content_artifacts ca where ca.package_id=cp.id and ca.artifact_type='feed_video')`,
      [packageId, workspaceId],
    );
    return;
  }
  const artifacts = await admin.from("content_artifacts").select("artifact_type").eq("package_id", packageId);
  if (artifacts.error) throw new Error(`内容资产查询失败: ${artifacts.error.message}`);
  const types = new Set((artifacts.data ?? []).map((row: { artifact_type: string }) => row.artifact_type));
  if (!types.has("feed_image") || !types.has("feed_video")) return;
  const { error } = await admin.from("content_packages").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", packageId).eq("workspace_id", workspaceId).eq("status", "rendering");
  if (error) throw new Error(`内容包完成状态写入失败: ${error.message}`);
}
