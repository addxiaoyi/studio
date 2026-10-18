import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getConfiguredBilling } from "@helstera/shared";
import type { AuthenticatedUser } from "../auth/types.js";
import { isRemovedImageModelId, isRemovedModelId } from "../generation/removed-models.js";

type ConfigRow = {
  id: string;
  workspace_id: string;
  label: string;
  base_url: string;
  key_ciphertext: string;
  key_last4: string;
  enabled: boolean;
  health_status: string;
  models: unknown;
  failure_count: number;
  latency_ms: number | null;
  last_error: string | null;
  last_probed_at: string | null;
  api_format: string;
  request_template: unknown;
  response_template: unknown;
};
export type ProviderConfigInput = {
  label: string;
  baseUrl: string;
  key?: string;
  enabled?: boolean;
  apiFormat?: "openai" | "gemini" | "anthropic" | "custom";
  requestTemplate?: unknown;
  responseTemplate?: unknown;
};
export type ProviderModelInput = {
  displayName: string;
  mediaType: "image" | "video";
  enabled: boolean;
  billingUnit: "per_generation" | "per_second" | "per_million_tokens";
  priceCredits: number;
  inputTokenPriceCny?: number | null;
  outputTokenPriceCny?: number | null;
  supportsInputImage: boolean;
  supportsInputVideo: boolean;
  supportsAudio: boolean;
  maxDurationSeconds?: number | null;
  maxResolution?: string | null;
  priority: number;
};
export type ProviderConfigService = {
  list(user: AuthenticatedUser, workspaceId: string): Promise<unknown[]>;
  create(
    user: AuthenticatedUser,
    workspaceId: string,
    input: ProviderConfigInput,
  ): Promise<unknown>;
  update(
    user: AuthenticatedUser,
    workspaceId: string,
    id: string,
    input: ProviderConfigInput,
  ): Promise<unknown>;
  remove(
    user: AuthenticatedUser,
    workspaceId: string,
    id: string,
  ): Promise<void>;
  probe(
    user: AuthenticatedUser,
    workspaceId: string,
    id: string,
  ): Promise<unknown>;
  listModels(user: AuthenticatedUser, workspaceId: string, providerId: string): Promise<unknown[]>;
  updateModel(user: AuthenticatedUser, workspaceId: string, providerId: string, modelId: string, input: ProviderModelInput): Promise<unknown>;
};

export function supportsReferenceImage(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith("gpt-image-")
    || id.startsWith("nano-banana-")
    || id.includes("flux-kontext");
}

export function createProviderConfigService(
  db: Pool,
  encryptionKey: string,
): ProviderConfigService {
  const key = Buffer.from(encryptionKey, "base64");
  if (key.length !== 32)
    throw new Error(
      "PROVIDER_CONFIG_ENCRYPTION_KEY must be base64 encoded 32 bytes",
    );
  const seal = (value: string) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  };
  const open = (value: string) => {
    const packed = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  };
  const view = (row: ConfigRow) => ({
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    keyLast4: row.key_last4,
    enabled: row.enabled,
    healthStatus: row.health_status,
    models: row.models,
    failureCount: row.failure_count,
    latencyMs: row.latency_ms,
    lastError: row.last_error,
    lastProbedAt: row.last_probed_at,
    apiFormat: row.api_format,
    requestTemplate: row.request_template,
    responseTemplate: row.response_template,
  });
  const canManage = async (userId: string, workspaceId: string) =>
    (
      await db.query(
        "select 1 from app_users where id=$1 and system_role='admin'",
        [userId],
      )
    ).rowCount === 1;
  async function guard(user: AuthenticatedUser, workspaceId: string) {
    if (!(await canManage(user.id, workspaceId)))
      throw Object.assign(new Error("需要系统管理员权限"), { statusCode: 403 });
  }
  async function accessibleConfig(userId: string, id: string) {
    const { rows } = await db.query(
      "select pc.* from provider_configs pc join app_users au on au.id=$2 and au.system_role='admin' where pc.id=$1",
      [id, userId],
    );
    return rows[0] as ConfigRow | undefined;
  }
  return {
    async list(user, workspaceId) {
      await guard(user, workspaceId);
      const { rows } = await db.query(
        "select pc.* from provider_configs pc where pc.workspace_id=$1 order by pc.created_at",
        [workspaceId],
      );
      return rows.map(view);
    },
    async create(user, workspaceId, input) {
      await guard(user, workspaceId);
      if (!input.key?.trim())
        throw Object.assign(new Error("API Key 不能为空"), { statusCode: 400 });
      const { rows } = await db.query(
        "insert into provider_configs(workspace_id,label,base_url,key_ciphertext,key_last4,enabled,api_format,request_template,response_template) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *",
        [
          workspaceId,
          input.label.trim(),
          input.baseUrl.trim(),
          seal(input.key.trim()),
          input.key.trim().slice(-4),
          input.enabled ?? true,
          input.apiFormat ?? "openai",
          input.requestTemplate ?? null,
          input.responseTemplate ?? null,
        ],
      );
      return view(rows[0]);
    },
    async update(user, workspaceId, id, input) {
      await guard(user, workspaceId);
      const row = await accessibleConfig(user.id, id);
      if (!row || row.workspace_id !== workspaceId)
        throw Object.assign(new Error("配置不存在"), { statusCode: 404 });
      const fields = [
        input.label?.trim(),
        input.baseUrl?.trim(),
        input.enabled,
        input.apiFormat ?? "openai",
        input.requestTemplate ?? null,
        input.responseTemplate ?? null,
      ];
      const params: unknown[] = [id, ...fields];
      const set = ["label=$2", "base_url=$3", "enabled=$4", "api_format=$5", "request_template=$6", "response_template=$7"];
      if (input.key?.trim()) {
        params.push(seal(input.key.trim()), input.key.trim().slice(-4));
        set.push(
          `key_ciphertext=$${params.length - 1}`,
          `key_last4=$${params.length}`,
        );
      }
      const { rows } = await db.query(
        `update provider_configs set ${set.join(",")}, updated_at=now() where id=$1 returning *`,
        params,
      );
      return view(rows[0]);
    },
    async remove(user, workspaceId, id) {
      await guard(user, workspaceId);
      const row = await accessibleConfig(user.id, id);
      if (!row || row.workspace_id !== workspaceId)
        throw Object.assign(new Error("配置不存在"), { statusCode: 404 });
      await db.query("delete from provider_configs where id=$1", [id]);
    },
    async probe(user, workspaceId, id) {
      await guard(user, workspaceId);
      const row = await accessibleConfig(user.id, id);
      if (!row || row.workspace_id !== workspaceId)
        throw Object.assign(new Error("配置不存在"), { statusCode: 404 });
      const started = Date.now();
      try {
        const response = await fetch(
          `${row.base_url.replace(/\/$/, "")}/models`,
          { headers: { Authorization: `Bearer ${open(row.key_ciphertext)}` } },
        );
        if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
        const body = (await response.json()) as {
          data?: Array<{ id?: string }>;
        };
        const modelIds = (body.data ?? [])
          .map((item) => item.id)
          .filter((item): item is string => Boolean(item))
          .filter((modelId) => !isRemovedImageModelId(modelId) && !isRemovedModelId(modelId));
        const mediaModels: string[] = [];
        for (const modelId of modelIds) {
          const billing = getConfiguredBilling(modelId);
        const mediaType = classifyMediaModel(modelId);
        if (!mediaType) continue;
        mediaModels.push(modelId);
        const isVideo = mediaType === "video";
        // Only per-second video models are sellable; never re-import other billing units.
        if (billing?.billingUnit === "per_million_tokens") continue;
        // Video gateways commonly expose I2V under the same model listing;
        // keep uploaded first frames eligible until an admin disables it.
        const supportsInputImage = isVideo || supportsReferenceImage(modelId);
        await db.query(
          `insert into provider_models(provider_id,model_id,display_name,media_type,billing_unit,price_credits,input_token_price_cny,output_token_price_cny,supports_input_image,max_duration_seconds,max_resolution)
             values($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             on conflict(provider_id,model_id) do update set display_name=coalesce(nullif(provider_models.display_name,''),excluded.display_name),media_type=excluded.media_type,billing_unit=excluded.billing_unit,price_credits=excluded.price_credits,enabled=case when excluded.media_type='video' and excluded.billing_unit='per_second' and excluded.price_credits > 3 then false else provider_models.enabled end,input_token_price_cny=excluded.input_token_price_cny,output_token_price_cny=excluded.output_token_price_cny,supports_input_image=(provider_models.supports_input_image or excluded.supports_input_image),max_duration_seconds=excluded.max_duration_seconds,max_resolution=excluded.max_resolution,updated_at=now()`,
            [id, modelId, mediaType, billing?.billingUnit ?? (isVideo ? "per_second" : "per_generation"), billing?.creditCost ?? 0, null, null, supportsInputImage, isVideo ? 30 : null, isVideo ? "1080p" : null],
          );
        }
        // /models only proves the gateway advertises these IDs. It is not a real
        // generation check, so leave each model unverified until a real request succeeds.
        // Listing a model proves only that the gateway advertises it. Preserve
        // real generation evidence so a refresh cannot downgrade a verified
        // model back to unknown or erase a useful failure reason.
        await db.query(
          `update provider_models
           set health_status=case when last_succeeded_at is not null then 'healthy' else 'unknown' end,
               failure_count=case when last_succeeded_at is not null then 0 else failure_count end,
               cooldown_until=case when last_succeeded_at is not null then null else cooldown_until end,
               updated_at=now()
           where provider_id=$1 and model_id = any($2::text[])`,
          [id, mediaModels],
        );
        const { rows: updated } = await db.query(
          "update provider_configs set health_status='healthy', models=$2, failure_count=0, latency_ms=$3, last_error=null, last_probed_at=now(), updated_at=now() where id=$1 returning *",
          [id, JSON.stringify(modelIds), Date.now() - started],
        );
        return view(updated[0]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "探测失败";
        console.error("[provider-probe] failed", {
          providerId: id,
          reason: message.slice(0, 160),
        });
        await db.query(
          "update provider_configs set health_status='unhealthy', failure_count=failure_count+1, latency_ms=$2, last_error=$3, last_probed_at=now(), updated_at=now() where id=$1",
          [id, Date.now() - started, message.slice(0, 240)],
        );
        throw Object.assign(new Error("模型探测失败，请检查网关地址和 Key"), {
          statusCode: 502,
        });
      }
    },
    async listModels(user, workspaceId, providerId) {
      await guard(user, workspaceId);
      const provider = await accessibleConfig(user.id, providerId);
      if (!provider || provider.workspace_id !== workspaceId) throw Object.assign(new Error("配置不存在"), { statusCode: 404 });
      const { rows } = await db.query("select model_id as \"modelId\",display_name as \"displayName\",media_type as \"mediaType\",enabled,billing_unit as \"billingUnit\",price_credits::float8 as \"priceCredits\",input_token_price_cny as \"inputTokenPriceCny\",output_token_price_cny as \"outputTokenPriceCny\",supports_input_image as \"supportsInputImage\",supports_input_video as \"supportsInputVideo\",supports_audio as \"supportsAudio\",max_duration_seconds as \"maxDurationSeconds\",max_resolution as \"maxResolution\",health_status as \"healthStatus\",failure_count as \"failureCount\",last_error as \"lastError\",last_failed_at as \"lastFailedAt\",last_succeeded_at as \"lastSucceededAt\",cooldown_until as \"cooldownUntil\",priority from provider_models where provider_id=$1 order by priority,model_id", [providerId]);
      return rows.filter((row) => row.billingUnit !== "per_million_tokens" && !isRemovedImageModelId(String(row.modelId)) && !isRemovedModelId(String(row.modelId)));
    },
    async updateModel(user, workspaceId, providerId, modelId, input) {
      if (input.billingUnit === "per_million_tokens" || isRemovedImageModelId(modelId) || isRemovedModelId(modelId))
        throw Object.assign(new Error("该图片模型已全局下线，不能重新启用"), { statusCode: 400 });
      await guard(user, workspaceId);
      const provider = await accessibleConfig(user.id, providerId);
      if (!provider || provider.workspace_id !== workspaceId) throw Object.assign(new Error("配置不存在"), { statusCode: 404 });
      validateProviderModelBilling(input);
      const { rows } = await db.query(
        `insert into provider_models(provider_id,model_id,display_name,media_type,enabled,billing_unit,price_credits,input_token_price_cny,output_token_price_cny,supports_input_image,supports_input_video,supports_audio,max_duration_seconds,max_resolution,priority)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict(provider_id,model_id) do update set display_name=excluded.display_name,media_type=excluded.media_type,enabled=excluded.enabled,billing_unit=excluded.billing_unit,price_credits=excluded.price_credits,input_token_price_cny=excluded.input_token_price_cny,output_token_price_cny=excluded.output_token_price_cny,supports_input_image=excluded.supports_input_image,supports_input_video=excluded.supports_input_video,supports_audio=excluded.supports_audio,max_duration_seconds=excluded.max_duration_seconds,max_resolution=excluded.max_resolution,priority=excluded.priority,health_status=case when excluded.enabled then 'unknown' else provider_models.health_status end,failure_count=case when excluded.enabled then 0 else provider_models.failure_count end,cooldown_until=case when excluded.enabled then null else provider_models.cooldown_until end,updated_at=now() returning *`,
        [providerId, modelId, input.displayName.trim() || modelId, input.mediaType, input.enabled, input.billingUnit, input.priceCredits, input.inputTokenPriceCny ?? null, input.outputTokenPriceCny ?? null, input.supportsInputImage, input.supportsInputVideo, input.supportsAudio, input.maxDurationSeconds ?? null, input.maxResolution ?? null, input.priority],
      );
      return rows[0];
    },
  };
}

function classifyMediaModel(modelId: string): "image" | "video" | null {
  if (/video|sora|veo|seedance|kling|h3|hailuo|happyhorse|vidu|wan(?:2|3)|pixverse|omni|vo3/i.test(modelId)) {
    return "video";
  }
  if (/gpt-image|dall-e|imagen|nano-banana|flux|recraft|ideogram/i.test(modelId)) {
    return "image";
  }
  return null;
}

export function validateProviderModelBilling(input: ProviderModelInput) {
  if (!input.displayName.trim())
    throw Object.assign(new Error("模型名称不能为空"), { statusCode: 400 });
  if (input.billingUnit === "per_million_tokens") {
    if (input.inputTokenPriceCny == null || !Number.isFinite(Number(input.inputTokenPriceCny))
      || !(Number(input.inputTokenPriceCny) > 0) || !(Number(input.outputTokenPriceCny) > 0))
      throw Object.assign(new Error("Token 模型输入价和补全价必须大于 0"), { statusCode: 400 });
    return;
  }
  if (!(Number(input.priceCredits) > 0) || !Number.isFinite(Number(input.priceCredits)))
    throw Object.assign(new Error("按次或按秒模型必须配置大于 0 的价格"), { statusCode: 400 });
  if (input.inputTokenPriceCny != null || input.outputTokenPriceCny != null)
    throw Object.assign(new Error("按次或按秒模型不能配置 Token 价格"), { statusCode: 400 });
}
