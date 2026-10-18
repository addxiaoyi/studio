import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  buildPrompt,
  calculateImageCost,
  defaultStyleLock,
  getSceneTemplate,
  type SceneId,
} from "@helstera/shared";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import type { CreditService } from "../features/credits/credit-service.js";
import { generateConfiguredImage } from "../local-db/provider-generation.js";
import type { RequestAuthenticator } from "../auth/types.js";
import { sanitizeErrorForClient } from "../utils/error-sanitizer.js";
import { resolveConfiguredModel } from "./model-availability.js";

const inputSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  productDescription: z.string().max(2000).optional(),
  customPrompt: z.string().trim().max(4000).optional(),
  mode: z.enum(["hero", "scene", "detail-poster", "social", "retouch"]).default("hero"),
  fidelity: z.enum(["strict", "balanced", "creative"]).default("strict"),
  sceneIds: z.array(z.string()).min(1).max(25),
  quantity: z.number().int().min(1).max(4).default(1),
  ratio: z.string().optional(),
  referenceImageUrl: z.string().max(2 * 1024 * 1024).optional(),
  referenceImageUrls: z
    .array(z.string().max(2 * 1024 * 1024))
    .max(10, "参考图最多 10 张")
    .optional(),
  model: z.string().min(1).max(160),
});

const previewSchema = inputSchema.pick({
  productName: true,
  productDescription: true,
  customPrompt: true,
  sceneIds: true,
  ratio: true,
  referenceImageUrl: true,
  referenceImageUrls: true,
  mode: true,
  fidelity: true,
});

export function normalizeReferenceImageUrls(input: {
  referenceImageUrl?: string | undefined;
  referenceImageUrls?: string[] | undefined;
}): string[] {
  const urls = input.referenceImageUrls?.length
    ? input.referenceImageUrls
    : input.referenceImageUrl
      ? [input.referenceImageUrl]
      : [];
  return [...new Set(urls)];
}

const CREDIT_SCALE = 10_000;
const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;
const LOCAL_ASSET_PATH = /^\/api\/uploads\/([0-9a-f-]{36})\/file$/i;

function roundCredits(amount: number): number {
  return Math.round((amount + Number.EPSILON) * CREDIT_SCALE) / CREDIT_SCALE;
}

export function calculateCompletedCredits(
  reservedCredits: number,
  totalImages: number,
  succeededImages: number,
): number {
  if (totalImages <= 0 || succeededImages <= 0) return 0;
  return roundCredits((reservedCredits / totalImages) * succeededImages);
}

export async function resolveEcomReferenceImage(
  db: Pool,
  workspaceId: string,
  referenceImageUrl: string | undefined,
  root = "/www/helstera/uploads",
): Promise<string | undefined> {
  if (!referenceImageUrl) return undefined;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(referenceImageUrl)) {
    return referenceImageUrl;
  }
  if (/^https?:\/\//i.test(referenceImageUrl)) return referenceImageUrl;

  const assetId = referenceImageUrl.match(LOCAL_ASSET_PATH)?.[1];
  if (!assetId) throw new Error("参考图地址无效，请重新上传");

  const { rows } = await db.query<{
    bucket: string;
    object_path: string;
    mime_type: string | null;
    byte_size: string | number | null;
  }>(
    "select bucket, object_path, mime_type, byte_size from asset_objects where id=$1 and workspace_id=$2",
    [assetId, workspaceId],
  );
  const asset = rows[0];
  if (!asset) throw new Error("参考图不存在或不属于当前工作区");
  if (!asset.mime_type?.startsWith("image/")) {
    throw new Error("参考文件不是有效图片");
  }
  if (Number(asset.byte_size ?? 0) > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("参考图不能超过 25MB");
  }

  const candidates = [
    join(root, asset.bucket, asset.object_path),
    join(root, asset.object_path),
  ];
  let filePath: string | undefined;
  for (const candidate of candidates) {
    const pathFromRoot = relative(root, candidate);
    const escapesRoot =
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot);
    if (escapesRoot) continue;
    try {
      const file = await stat(candidate);
      if (file.isFile()) {
        filePath = candidate;
        break;
      }
    } catch {
      // Uploaded assets can use either the bucket-prefixed or legacy root layout.
    }
  }
  if (!filePath) throw new Error("参考图文件不存在，请重新上传");

  const buffer = await readFile(filePath);
  if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("参考图不能超过 25MB");
  }
  return `data:${asset.mime_type};base64,${buffer.toString("base64")}`;
}

export function registerLocalEcomRoutes(
  app: FastifyInstance,
  options: {
    auth: RequestAuthenticator;
    db: Pool;
    creditService: CreditService;
  },
): void {
  app.post("/api/ecom/prompts/preview", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user) {
      return reply.code(401).send({
        error: { code: "unauthorized", message: "请先登录" },
      });
    }
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "预览参数无效",
        },
      });
    }
    const scenes = parsed.data.sceneIds
      .map((id) => getSceneTemplate(id as SceneId))
      .filter((scene) => scene !== undefined);
    if (scenes.length !== parsed.data.sceneIds.length) {
      return reply.code(400).send({
        error: { code: "invalid_scene", message: "包含未知场景模板" },
      });
    }
    const hasReferenceImage = normalizeReferenceImageUrls(parsed.data).length > 0;
    const prompts = scenes.map((scene) =>
      buildPrompt({
        template: scene,
        productName: parsed.data.productName,
        productDescription: parsed.data.productDescription,
        customPrompt: parsed.data.customPrompt,
        ratio: parsed.data.ratio as never,
        styleLock: defaultStyleLock("visual", "minimal"),
        hasReferenceImage,
        mode: parsed.data.mode,
        fidelity: parsed.data.fidelity,
      }),
    );
    return reply.send({
      ok: true,
      prompts,
      plan: {
        mode: parsed.data.mode,
        fidelity: parsed.data.fidelity,
        ratio: parsed.data.ratio ?? prompts[0]?.ratio ?? "1:1",
        referenceCount: normalizeReferenceImageUrls(parsed.data).length,
      },
    });
  });

  app.post("/api/ecom/jobs", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user)
      return reply.code(401).send({
        error: {
          code: "unauthorized",
          message: "Missing or invalid session.",
        },
      });
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "请求参数无效",
        },
      });
    const workspace = await options.db.query<{ workspace_id: string }>(
      "select workspace_id from workspace_members where user_id=$1 order by created_at limit 1",
      [user.id],
    );
    const workspaceId = workspace.rows[0]?.workspace_id;
    if (!workspaceId)
      return reply
        .code(400)
        .send({ error: { code: "no_workspace", message: "工作区不存在" } });
    const scenes = parsed.data.sceneIds
      .map((id) => getSceneTemplate(id as SceneId))
      .filter((scene) => scene !== undefined);
    if (scenes.length !== parsed.data.sceneIds.length)
      return reply.code(400).send({
        error: { code: "invalid_scene", message: "包含未知场景模板" },
      });
    const totalImages = scenes.length * parsed.data.quantity;
    if (totalImages > 25) {
      return reply.code(400).send({
        error: { code: "too_many_images", message: "单次最多生成 25 张图片" },
      });
    }
    const referenceImageUrls = normalizeReferenceImageUrls(parsed.data);
    const routedModel = await resolveConfiguredModel(
      options.db,
      "image",
      parsed.data.model,
      {
        requiresInputImage: referenceImageUrls.length > 0,
        ...(referenceImageUrls.length > 0
          ? { allowedModelIds: [
              parsed.data.model,
              "gpt-image-2.5-4k",
              "gpt-image-2.5-2k",
              "gpt-image-2.5-1k",
              "gpt-image-2",
              "gpt-image-2-2k",
              "gpt-image-2-1k",
              "black-forest-labs/flux-kontext-max",
              "black-forest-labs/flux-kontext-pro",
            ] }
          : {}),
      },
    );
    if (!routedModel) {
      return reply.code(503).send({
        error: {
          code: "no_reference_image_model",
          message: referenceImageUrls.length > 0
            ? "当前没有支持参考图且健康的图片模型，请稍后重试"
            : "当前没有健康的图片模型，请稍后重试",
        },
      });
    }
    const selectedModel = routedModel.model_id;
    const prompts = scenes.flatMap((scene) =>
      Array.from({ length: parsed.data.quantity }, () =>
        buildPrompt({
          template: scene,
          productName: parsed.data.productName,
          productDescription: parsed.data.productDescription,
          customPrompt: parsed.data.customPrompt,
          ratio: parsed.data.ratio as never,
          styleLock: defaultStyleLock("visual", "minimal"),
          hasReferenceImage: referenceImageUrls.length > 0,
          mode: parsed.data.mode,
          fidelity: parsed.data.fidelity,
        }),
      ),
    );
    const reservedCredits = roundCredits(
      calculateImageCost(selectedModel, "hd") * prompts.length,
    );
    const { rows } = await options.db.query(
      "insert into ecom_jobs(workspace_id,user_id,product_name,product_description,scene_ids,ratio,status,credits_charged) values($1,$2,$3,$4,$5,$6,'pending',$7) returning *",
      [
        workspaceId,
        user.id,
        parsed.data.productName,
        parsed.data.productDescription ?? null,
        JSON.stringify(parsed.data.sceneIds),
        parsed.data.ratio ?? "1:1",
        reservedCredits,
      ],
    );
    const job = rows[0];
    try {
      const txId = await options.creditService.deductCredits(
        workspaceId,
        user.id,
        reservedCredits,
        undefined,
        `电商图批次：${selectedModel} × ${prompts.length}`,
      );
      void runJob(
        options.db,
        options.creditService,
        job.id,
        workspaceId,
        user.id,
        selectedModel,
        prompts,
        referenceImageUrls,
        reservedCredits,
        txId,
      );
    } catch (error) {
      await options.db.query("delete from ecom_jobs where id=$1", [job.id]);
      throw error;
    }
    return reply.code(202).send({
      job: mapJob(job),
      prompts,
      routing: {
        requestedModel: parsed.data.model,
        selectedModel,
        fallback: selectedModel !== parsed.data.model,
        reason:
          selectedModel !== parsed.data.model
            ? "所选模型不支持参考图或当前不可用，已切换到高还原模型"
            : null,
      },
    });
  });
  app.get("/api/ecom/jobs/:id", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user)
      return reply.code(401).send({
        error: {
          code: "unauthorized",
          message: "Missing or invalid session.",
        },
      });
    const { rows } = await options.db.query(
      "select * from ecom_jobs where id=$1 and user_id=$2",
      [(request.params as { id: string }).id, user.id],
    );
    return rows[0]
      ? reply.send({ job: mapJob(rows[0]) })
      : reply
          .code(404)
          .send({ error: { code: "not_found", message: "任务不存在" } });
  });
  app.get("/api/ecom/jobs", async (request, reply) => {
    const user = await options.auth.authenticate(request);
    if (!user)
      return reply.code(401).send({
        error: {
          code: "unauthorized",
          message: "Missing or invalid session.",
        },
      });
    const { rows } = await options.db.query(
      "select * from ecom_jobs where user_id=$1 order by created_at desc limit 20",
      [user.id],
    );
    return reply.send({ jobs: rows.map(mapJob) });
  });
}

async function runJob(
  db: Pool,
  credits: CreditService,
  jobId: string,
  workspaceId: string,
  userId: string,
  model: string,
  prompts: ReturnType<typeof buildPrompt>[],
  referenceImageUrls: string[],
  reservedCredits: number,
  txId: string,
) {
  const outputs: Array<{
    sceneId: string;
    url: string | null;
    error: string | null;
  }> = [];
  await db.query("update ecom_jobs set status='running' where id=$1", [jobId]);
  let resolvedReferenceImages: string[] = [];
  try {
    resolvedReferenceImages = (
      await Promise.all(
        referenceImageUrls.map((url) =>
          resolveEcomReferenceImage(db, workspaceId, url),
        ),
      )
    ).filter((url): url is string => Boolean(url));
  } catch (error) {
    const message = sanitizeErrorForClient(error);
    for (const prompt of prompts) {
      outputs.push({ sceneId: prompt.sceneId, url: null, error: message });
    }
    await db.query("update ecom_jobs set outputs=$2 where id=$1", [
      jobId,
      JSON.stringify(outputs),
    ]);
  }
  for (const [index, prompt] of prompts.entries()) {
    if (outputs.length > 0) break;
    try {
      const image = await generateConfiguredImage(db, model, {
        prompt: prompt.text,
        model,
        aspectRatio: prompt.ratio,
        quality: "hd",
        ...(resolvedReferenceImages.length > 0
          ? { inputImages: resolvedReferenceImages }
          : {}),
      });
      if (!image) throw new Error("所选模型没有可用供应商");
      const response = image.url.startsWith("data:")
        ? null
        : await fetch(image.url);
      if (response && !response.ok)
        throw new Error(`图片下载失败：HTTP ${response.status}`);
      const buffer = response
        ? Buffer.from(await response.arrayBuffer())
        : Buffer.from(image.url.slice(image.url.indexOf(",") + 1), "base64");
      const objectPath = `${workspaceId}/generated/ecom-${jobId}-${index + 1}-${prompt.sceneId}.png`;
      await mkdir(join("/www/helstera/uploads", workspaceId, "generated"), {
        recursive: true,
      });
      await writeFile(join("/www/helstera/uploads", objectPath), buffer);
      const asset = await db.query<{ id: string }>(
        "insert into asset_objects(workspace_id,bucket,object_path,mime_type,byte_size,created_by) values($1,'project-assets',$2,$3,$4,$5) returning id",
        [workspaceId, objectPath, image.mimeType, buffer.length, userId],
      );
      outputs.push({
        sceneId: prompt.sceneId,
        url: `/api/uploads/${asset.rows[0]?.id}/file`,
        error: null,
      });
    } catch (error) {
      outputs.push({
        sceneId: prompt.sceneId,
        url: null,
        error: sanitizeErrorForClient(error),
      });
    }
    await db.query("update ecom_jobs set outputs=$2 where id=$1", [
      jobId,
      JSON.stringify(outputs),
    ]);
  }
  const succeeded = outputs.filter((output) => output.url).length;
  const actualCredits = calculateCompletedCredits(
    reservedCredits,
    prompts.length,
    succeeded,
  );
  if (actualCredits < reservedCredits)
    await credits.refundCredits(
      workspaceId,
      userId,
      reservedCredits - actualCredits,
      jobId,
      `电商图失败退款，原交易 ${txId}`,
    );
  await db.query(
    "update ecom_jobs set status=$2,credits_charged=$3,completed_at=now() where id=$1",
    [jobId, succeeded > 0 ? "succeeded" : "failed", actualCredits],
  );
}

function mapJob(row: Record<string, unknown>) {
  const sceneIds = Array.isArray(row.scene_ids) ? row.scene_ids : [];
  const outputs = Array.isArray(row.outputs) ? row.outputs : [];
  const firstError = outputs.find(
    (output): output is { error: string } =>
      typeof output === "object" &&
      output !== null &&
      typeof (output as { error?: unknown }).error === "string",
  )?.error;
  return {
    id: String(row.id),
    status:
      row.status === "succeeded"
        ? "completed"
        : String(row.status ?? "pending"),
    productName: String(row.product_name ?? ""),
    productDescription: row.product_description as string | null,
    sceneCount: sceneIds.length,
    outputCount: outputs.length,
    errorMessage: firstError ?? null,
    outputs,
    ratio: row.ratio as string | null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    completedAt: row.completed_at
      ? new Date(String(row.completed_at)).toISOString()
      : null,
  };
}
