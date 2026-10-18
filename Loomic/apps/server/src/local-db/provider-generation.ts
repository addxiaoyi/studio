import { createDecipheriv, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { imageOutcomeUnknown, imageRequestRejection } from "./image-request-error.js";
import { kuaipaoImageRequest } from "./kuaipao-image-request.js";
import type {
  GeneratedImage,
  GeneratedVideo,
  GenerationUsage,
  ImageGenerateParams,
} from "../generation/types.js";
import { aspectRatioToDimensions } from "../generation/utils.js";
import { isRemovedImageModelId, isRemovedModelId } from "../generation/removed-models.js";
import { requestProviderJson } from "./provider-http.js";
import { getModelCallProfile, validateProfileInput } from "./model-call-profiles.js";

type ProviderRow = {
  id: string;
  label?: string;
  provider_model_id?: string;
  base_url: string;
  key_ciphertext: string;
  latency_ms: number | null;
  api_format: string;
  request_template: Record<string, unknown> | null;
  response_template: Record<string, unknown> | null;
};

function fillTemplate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => fillTemplate(item, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillTemplate(item, vars)]));
  return value;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined), value);
}
type ProviderResponse = {
  id?: string;
  task_id?: string;
  status?: string;
  url?: string;
  video_url?: string;
  data?: Array<{ url?: string; b64_json?: string }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  input_tokens?: number;
  output_tokens?: number;
  choices?: Array<{ message?: { content?: string } }>;
};

const VIDEO_POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 15_000] as const;
// The poll schedule reaches 15s after the first few attempts. 80 attempts
// keeps the real upper bound close to 20 minutes instead of 2.5 hours.
const VIDEO_POLL_ATTEMPTS = 80;
const VIDEO_POLL_ERROR_LIMIT = 12;
const VIDEO_SUBMIT_TIMEOUT_MS = 30_000;
const VIDEO_POLL_REQUEST_TIMEOUT_MS = 30_000;
const TERMINAL_VIDEO_FAILURES = new Set(["failed", "error", "cancelled", "canceled"]);
const VIDEO_SAFETY_PATTERN = /content|safety|moderation|policy|sensitive|审核|拦截|命中|敏感|违规|安全|内容审查/i;

function providerPayloadText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (Array.isArray(payload)) return payload.map(providerPayloadText).join(" ");
  if (payload && typeof payload === "object") return Object.values(payload as Record<string, unknown>).map(providerPayloadText).join(" ");
  return "";
}
const MODEL_FAILURE_THRESHOLD = 3;
const MODEL_COOLDOWN_MINUTES = 5;
const IMAGE_REQUEST_TIMEOUT_MS = 180_000;

async function markModelHealthy(db: Pool, providerModelId: string) {
  await db.query(
    `update provider_models
     set health_status='healthy', failure_count=0, last_error=null,
         cooldown_until=null, last_succeeded_at=now(), updated_at=now()
     where id=$1`,
    [providerModelId],
  );
}

async function markModelFailed(db: Pool, providerModelId: string, message: string) {
  await db.query(
    `update provider_models
     set failure_count=failure_count+1,
         health_status=case when failure_count+1 >= $2 then 'unhealthy' else 'degraded' end,
         last_error=$3, last_failed_at=now(),
         cooldown_until=case when failure_count+1 >= $2 then now() + ($4 * interval '1 minute') else null end,
         updated_at=now()
     where id=$1`,
    [providerModelId, MODEL_FAILURE_THRESHOLD, message.slice(0, 240), MODEL_COOLDOWN_MINUTES],
  );
}

async function restoreRecentVideoModelHealth(db: Pool, model: string) {
  await db.query(
    `update provider_models pm set health_status='healthy', failure_count=0, last_error=null, cooldown_until=null, updated_at=now()
     where pm.model_id=$1 and pm.media_type='video' and pm.enabled=true and pm.health_status='unhealthy'
       and pm.last_succeeded_at > now() - interval '7 days'
       and coalesce(pm.last_error, '') not ilike '%insufficient%'
       and coalesce(pm.last_error, '') not ilike '%auth%'
       and coalesce(pm.last_error, '') not ilike '%401%'
       and coalesce(pm.last_error, '') not ilike '%403%'`,
    [model],
  );
}
export function readVideoUrl(payload: unknown, configuredPath?: unknown): string | undefined {
  const paths = typeof configuredPath === "string"
    ? [configuredPath]
    : [
        "video_url", "url", "result_url", "videoUrl", "result.video_url",
        "result.url", "data.video_url", "data.videoUrl", "data.url", "data.result_url",
        "data.result.video_url", "data.result.videoUrl", "data.result.url", "data.task.video_url", "data.task.videoUrl", "data.task.url", "data.output.video_url", "data.output.url",
        "data.0.url", "data.0.video_url", "data.0.result_url", "data.0",
        "output.url", "output.0.url", "output.0", "result.0.url", "result.0",
      ];

  for (const path of paths) {
    const url = readPath(payload, path);
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
  }
  return findNestedString(payload, (key, value) => /(?:video_?url|videoUrl|result_?url|url)/i.test(key) && /^https?:\/\//i.test(value));
}

export function providerResponseShape(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return { type: typeof payload };
  const record = payload as Record<string, unknown>;
  const data = record.data;
  return {
    codeType: typeof record.code,
    code: typeof record.code === "string" || typeof record.code === "number" ? record.code : undefined,
    dataType: Array.isArray(data) ? "array" : typeof data,
    dataKeys: data && typeof data === "object" ? Object.keys(data as object).slice(0, 20) : undefined,
    hasMessage: typeof record.msg === "string" && record.msg.length > 0,
    message: providerPayloadText(record.msg).slice(0, 240),
    dataPreview: providerPayloadText(data).slice(0, 240),
  };
}

export function classifyVideoProviderRejection(code: unknown, message: string): "upstream_insufficient_balance" | "provider_auth_failed" | "model_not_found" | "safety_filter" | "provider_request_failed" {
  const normalizedCode = String(code ?? "").toLowerCase();
  const normalizedMessage = message.toLowerCase();
  if (normalizedCode === "402" || /insufficient|balance|quota|credit|余额|额度|充值/.test(normalizedMessage)) return "upstream_insufficient_balance";
  if (normalizedCode === "401" || normalizedCode === "403" || /unauthorized|forbidden|invalid.?key|认证|鉴权|密钥/.test(normalizedMessage)) return "provider_auth_failed";
  if (normalizedCode === "404" || /model.?not.?found|unknown.?model|模型不存在|模型未开通/.test(normalizedMessage)) return "model_not_found";
  if (VIDEO_SAFETY_PATTERN.test(normalizedMessage)) return "safety_filter";
  return "provider_request_failed";
}

function readProviderRejectionMessage(payload: Record<string, unknown>): string {
  const parts = [providerPayloadText(payload.msg), providerPayloadText(payload.data)]
    .map((part) => part.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\r\n\t]+/g, " ").trim())
    .filter(Boolean);
  return parts.join(" — ").slice(0, 240);
}

function providerResponseSummary(payload: Record<string, unknown>): string {
  const values = [payload.msg, payload.data]
    .flatMap((value) => typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
    .map((value) => value.replace(/https?:\/\/\S+/gi, "[url]").trim())
    .filter(Boolean);
  return values.join(" — ").slice(0, 240);
}

function readUsage(body: ProviderResponse): GenerationUsage | undefined {
  const inputTokens = body.usage?.prompt_tokens ?? body.usage?.input_tokens ?? body.input_tokens;
  const outputTokens =
    body.usage?.completion_tokens ?? body.usage?.output_tokens ?? body.output_tokens;
  return Number.isFinite(inputTokens) && Number.isFinite(outputTokens)
    ? { inputTokens: Number(inputTokens), outputTokens: Number(outputTokens) }
    : undefined;
}

export function readTaskId(payload: unknown, configuredPath?: unknown): string {
  const paths = typeof configuredPath === "string"
    ? [configuredPath]
    : ["task_id", "id", "taskId", "data.task_id", "data.id", "data.taskId", "data.task.id", "data.task.task_id", "data.task.taskId", "data.result.id", "data.result.task_id", "data.0.task_id", "data.0.id", "task.id"];
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return findNestedString(payload, (key, value) => /^(?:task_?id|taskId)$/i.test(key) && value.length > 0) ?? "";
}

function findNestedString(value: unknown, match: (key: string, value: string) => boolean, depth = 0): string | undefined {
  if (depth > 8 || value == null || typeof value !== "object") return undefined;
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (typeof child === "string" && match(key, child)) return child.trim();
    const found = findNestedString(child, match, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function readStatus(payload: unknown, configuredPath?: unknown): string {
  const paths = typeof configuredPath === "string"
    ? [configuredPath]
    : ["status", "state", "task.status", "task.state", "result.status", "result.state", "data.status", "data.state", "data.0.status", "data.0.state"];
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "string") return value.toLowerCase();
  }
  return "";
}

export function readDuration(payload: unknown): number | undefined {
  for (const path of ["duration", "duration_seconds", "task.duration", "task.duration_seconds", "result.duration", "data.duration", "data.0.duration"]) {
    const value = readPath(payload, path);
    const duration = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return undefined;
}

export function videoPollDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(Math.floor(attempt), VIDEO_POLL_DELAYS_MS.length - 1));
  return VIDEO_POLL_DELAYS_MS[index]!;
}

export function buildConfiguredVideoRequest(
  model: string,
  apiFormat: string,
  requestTemplate: Record<string, unknown> | null,
  params: { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[]; inputVideo?: string; enableAudio?: boolean },
) {
  const lingkeConfig = (requestTemplate ?? {}) as LingkeRequestConfig;
  const profile = getModelCallProfile(model, apiFormat);
  const { width, height } = aspectRatioToDimensions(params.aspectRatio ?? "1:1");
  const templateVars = {
    model,
    prompt: params.prompt,
    duration: params.duration == null ? "" : String(params.duration),
    resolution: profile.mapResolution(params.resolution, lingkeConfig.defaults?.resolution) ?? "",
    aspectRatio: params.aspectRatio ?? "",
    aspect_ratio: params.aspectRatio ?? "",
    inputImages: JSON.stringify(params.inputImages ?? []),
    input_images: JSON.stringify(params.inputImages ?? []),
    firstFrame: params.inputImages?.[0] ?? "",
    first_frame: params.inputImages?.[0] ?? "",
    inputVideo: params.inputVideo ?? "",
    input_video: params.inputVideo ?? "",
    referenceVideo: params.inputVideo ?? "",
    reference_video: params.inputVideo ?? "",
    enableAudio: params.enableAudio == null ? "" : String(params.enableAudio),
    enable_audio: params.enableAudio == null ? "" : String(params.enableAudio),
    size: `${width}x${height}`,
  };

  if (apiFormat === "lingke_media") {
    const mappedResolution = profile.mapResolution(params.resolution, lingkeConfig.defaults?.resolution);
    return { model, prompt: params.prompt, params: buildLingkeParams(model, lingkeConfig, { ...params, ...(mappedResolution ? { resolution: mappedResolution } : {}) }) };
  }
  if (apiFormat === "custom" && requestTemplate) return fillTemplate(requestTemplate, templateVars);
  return {
    model,
    prompt: params.prompt,
    ...(params.duration == null ? {} : { duration: params.duration }),
    ...(params.resolution == null ? {} : { resolution: params.resolution }),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
    ...(params.inputImages?.length ? { input_images: params.inputImages } : {}),
    ...(params.inputVideo ? { input_video: params.inputVideo } : {}),
    ...(params.enableAudio == null ? {} : { enable_audio: params.enableAudio }),
  };
}

function readInlineImage(content: string): GeneratedImage | undefined {
  const match = content.match(/data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/i);
  if (!match) return undefined;
  return {
    url: `data:${match[1]};base64,${match[2]}`,
    mimeType: match[1]!,
    width: 1024,
    height: 1024,
  };
}

type LingkeRequestConfig = {
  defaults?: Record<string, string | number | boolean>;
  options?: Record<string, Array<string | number | boolean>>;
  required?: string[];
};

function lingkeParam(
  config: LingkeRequestConfig,
  name: string,
  requested: string | number | boolean | undefined,
): string | number | boolean | undefined {
  const allowed = config.options?.[name];
  if (requested !== undefined && (!allowed || allowed.some((value) => String(value).toLowerCase() === String(requested).toLowerCase()))) {
    return allowed?.find((value) => String(value).toLowerCase() === String(requested).toLowerCase()) ?? requested;
  }
  return config.defaults?.[name];
}

function lingkeResolution(model: string, config: LingkeRequestConfig, requested?: string): string | undefined {
  const allowed = config.options?.resolution;
  const findAllowed = (...candidates: string[]) => allowed?.find((value) => candidates.some((candidate) => candidate.toLowerCase() === String(value).toLowerCase()));
  if (!model.toLowerCase().includes("minimax-h3")) {
    const selected = lingkeParam(config, "resolution", requested);
    return selected == null ? undefined : String(selected);
  }
  const wanted = requested?.toLowerCase();
  const candidates = wanted === "1080p" || wanted === "4k"
    ? ["2k", "1080p", "4k"]
    : wanted === "720p"
      ? ["768p", "720p"]
      : wanted
        ? [wanted]
        : [];
  const configuredDefault = config.defaults?.resolution;
  const selected = (candidates.length ? findAllowed(...candidates) : undefined)
    ?? findAllowed("768p", "2k", "1080p", "4k")
    ?? (configuredDefault != null && !/^480p?$/i.test(String(configuredDefault)) ? findAllowed(String(configuredDefault)) : undefined)
    ?? configuredDefault
    ?? allowed?.[0];
  return selected == null ? undefined : String(selected);
}

function buildLingkeParams(
  model: string,
  config: LingkeRequestConfig,
  params: { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[]; inputVideo?: string; enableAudio?: boolean },
) {
  const values: Record<string, string | number | boolean | string[]> = {
    prompt: params.prompt,
    duration: params.duration ?? "",
    resolution: getModelCallProfile(model, "lingke_media").mapResolution(params.resolution, config.defaults?.resolution) ?? "",
    aspect_ratio: params.aspectRatio ?? "",
    ratio: params.aspectRatio ?? "",
    images: params.inputImages ?? [],
    input_images: params.inputImages ?? [],
    first_frame: params.inputImages?.[0] ?? "",
    input_video: params.inputVideo ?? "",
    reference_video: params.inputVideo ?? "",
    enable_audio: params.enableAudio ?? false,
    audio: params.enableAudio ?? false,
  };
  const output: Record<string, string | number | boolean | string[]> = {};
  const names = new Set([
    ...Object.keys(config.options ?? {}),
    ...Object.keys(config.defaults ?? {}),
    ...(config.required ?? []),
  ]);
  for (const name of names) {
    const requested = values[name];
    const fallback = config.defaults?.[name];
    const selected = requested !== undefined && requested !== "" && !(Array.isArray(requested) && requested.length === 0)
      ? requested
      : fallback;
    if (selected !== undefined) {
      const allowed = config.options?.[name];
      output[name] = allowed?.find((value) => String(value).toLowerCase() === String(selected).toLowerCase()) ?? selected;
    }
  }
  if (params.inputImages?.length) {
    // Some Lingke templates omit image capability even though the upstream
    // model accepts I2V. Preserve the frame instead of silently rejecting it.
    output.images ??= params.inputImages;
    output.input_images ??= params.inputImages;
    output.first_frame ??= params.inputImages[0]!;
  }
  if (params.inputVideo) {
    output.input_video ??= params.inputVideo;
    output.reference_video ??= params.inputVideo;
  }
  return output;
}

function decryptKey(ciphertext: string): string {
  const rawKey = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("Provider encryption key is not configured");
  const key = Buffer.from(rawKey, "base64");
  const packed = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export async function generateConfiguredImage(
  db: Pool,
  model: string,
  params: ImageGenerateParams,
  options: { providerUrlForInput?: (inputUrl: string, index: number) => Promise<string>; allowUnverified?: boolean } = {},
): Promise<GeneratedImage | null> {
  if (isRemovedImageModelId(model)) return null;
  const hasInputImages = (params.inputImages?.length ?? 0) > 0;
  const { rows } = await db.query<ProviderRow>(
    `select pc.id, pc.label, pm.id as provider_model_id, pc.base_url, pc.key_ciphertext,
            pc.latency_ms, pc.api_format, pc.request_template, pc.response_template
       from provider_configs pc
       join provider_models pm on pm.provider_id=pc.id
      where pc.enabled=true and pc.health_status='healthy'
        and pm.model_id=$1 and pm.enabled=true
        and (pm.health_status='healthy' or (pm.health_status='unknown' and $3::boolean)) and pm.failure_count < 3
        and (pm.cooldown_until is null or pm.cooldown_until <= now())
        and ($2::boolean = false or pm.supports_input_image = true)
      order by pm.failure_count, coalesce(pc.latency_ms, 2147483647), pc.failure_count`,
    [model, hasInputImages, options.allowUnverified === true],
  );
  if (rows.length === 0) return null;
  let lastError: unknown;
  for (const row of rows) {
    const started = Date.now();
    const requestId = randomUUID();
    let sentInputImageCount = params.inputImages?.length ?? 0;
    const requestedInputImageCount = params.inputImages?.length ?? 0;
    const logRequest = (event: string, details: Record<string, unknown> = {}) => {
      console.log(`[image-provider] ${event}`, JSON.stringify({
        requestId,
        model,
        providerId: row.id,
        label: row.label ?? null,
        requestedInputImageCount,
        sentInputImageCount,
        ...details,
      }));
    };
    try {
      const { width, height } = aspectRatioToDimensions(params.aspectRatio ?? "1:1");
      const profile = getModelCallProfile(model, row.api_format);
      let inputImages = params.inputImages ?? [];
      if (inputImages.length && profile.inputImageTransport !== "native" && options.providerUrlForInput) {
        inputImages = await Promise.all(inputImages.map((url, index) => options.providerUrlForInput!(url, index)));
      }
      if (inputImages.length && profile.inputImageTransport === "provider_url") {
        if (!options.providerUrlForInput) {
          throw Object.assign(
            new Error(profile.id + " requires Provider-readable reference URLs"),
            { code: "invalid_input" },
          );
        }
        await Promise.all(inputImages.map(async (url) => {
          if (!/^https?:\/\//i.test(url)) {
            throw Object.assign(new Error("Reference image URL must be a public HTTP(S) URL"), { code: "invalid_input" });
          }
          const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw Object.assign(new Error("Reference image URL is not publicly readable (HTTP " + response.status + ")"), { code: "invalid_input" });
        }));
      }
      sentInputImageCount = inputImages.length;
      logRequest("selected", { apiFormat: row.api_format, profile: profile.id });
      const isBanana = model.toLowerCase().includes("nano-banana");
      if (isBanana) {
        const content: Array<Record<string, unknown>> = [{ type: "text", text: params.prompt }];
        for (const url of inputImages) {
          content.push({ type: "image_url", image_url: { url } });
        }
        const requestBody = { model, messages: [{ role: "user", content }], stream: false };
        const upstreamUrl = `${row.base_url.replace(/\/$/, "")}/chat/completions`;
        logRequest("request_start", {
          upstreamUrl,
          requestBodyBytes: Buffer.byteLength(JSON.stringify(requestBody)),
          timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
        });
        const body = await requestProviderJson(
          upstreamUrl,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${decryptKey(row.key_ciphertext)}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(requestBody),
          },
          { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS, operation: "image", requestId },
        ) as ProviderResponse;
        const image = readInlineImage(body.choices?.[0]?.message?.content ?? "");
        if (!image) throw new Error("provider returned no inline image");
        await markModelHealthy(db, row.provider_model_id ?? row.id);
        const usage = readUsage(body);
        logRequest("request_done", { elapsedMs: Date.now() - started });
        return usage ? { ...image, usage } : image;
      }
      const kuaipao = row.api_format === "openai"
        ? kuaipaoImageRequest(row.base_url, model, { ...params, inputImages }) : null;
      if (kuaipao) sentInputImageCount = kuaipao.sentInputImageCount;
      const requestBody = kuaipao?.body ?? (row.api_format === "custom" && row.request_template
        ? fillTemplate(row.request_template, {
            model, prompt: params.prompt,
            inputImages: JSON.stringify(inputImages),
            input_images: JSON.stringify(inputImages),
            referenceImage: inputImages[0] ?? "",
            reference_image: inputImages[0] ?? "",
            aspectRatio: params.aspectRatio ?? "1:1",
            aspect_ratio: params.aspectRatio ?? "1:1",
            size: `${width}x${height}`,
          })
        : { model, prompt: params.prompt, size: `${width}x${height}`, n: 1, ...(inputImages.length ? { input_images: inputImages } : {}) });
      const upstreamUrl = kuaipao?.url ?? `${row.base_url.replace(/\/$/, "")}/images/generations`;
      logRequest("request_start", {
        upstreamUrl,
        requestBodyBytes: Buffer.byteLength(JSON.stringify(requestBody)),
        droppedInputImageCount: Math.max(0, requestedInputImageCount - sentInputImageCount),
        timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
      });
      const body = await requestProviderJson(
        upstreamUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${decryptKey(row.key_ciphertext)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
        },
        { timeoutMs: IMAGE_REQUEST_TIMEOUT_MS, operation: "image", requestId },
      ) as ProviderResponse;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw Object.assign(new Error("provider returned malformed image response"), { code: "invalid_provider_response" });
      }
      const customPath = row.api_format === "custom" && row.response_template?.imageUrlPath;
      const customUrl = typeof customPath === "string" ? readPath(body, customPath) : undefined;
      const item = body.data?.[0];
      const usage = readUsage(body);
      const metadata = usage ? { usage } : {};
      if (typeof customUrl === "string" && customUrl) {
        await markModelHealthy(db, row.provider_model_id ?? row.id);
        await db.query("update provider_configs set latency_ms=$2, last_error=null, last_probed_at=now(), updated_at=now() where id=$1", [row.id, Date.now() - started]);
        logRequest("request_done", { elapsedMs: Date.now() - started });
        return { url: customUrl, mimeType: "image/png", width, height, ...metadata };
      }
      if (item?.url) {
        await markModelHealthy(db, row.provider_model_id ?? row.id);
        await db.query("update provider_configs set latency_ms=$2, last_error=null, last_probed_at=now(), updated_at=now() where id=$1", [row.id, Date.now() - started]);
        logRequest("request_done", { elapsedMs: Date.now() - started });
        return { url: item.url, mimeType: "image/png", width, height, ...metadata };
      }
      if (item?.b64_json) {
        await markModelHealthy(db, row.provider_model_id ?? row.id);
        await db.query("update provider_configs set failure_count=0, health_status='healthy', latency_ms=$2, last_error=null, last_probed_at=now(), updated_at=now() where id=$1", [row.id, Date.now() - started]);
        logRequest("request_done", { elapsedMs: Date.now() - started });
        return { url: `data:image/png;base64,${item.b64_json}`, mimeType: "image/png", width, height, ...metadata };
      }
      throw new Error("provider returned no image");
    } catch (error) {
      const rejection = imageRequestRejection(error);
      if (rejection) throw rejection;
      const errorCode = (error as { code?: string })?.code;
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[image-provider] request failed", JSON.stringify({
        requestId,
        model,
        providerId: row.id,
        label: row.label ?? null,
        requestedInputImageCount,
        sentInputImageCount,
        status: message.match(/provider returned (\d{3})/)?.[1] ?? null,
        code: errorCode ?? null,
        elapsedMs: Date.now() - started,
        message: message.slice(0, 240),
      }));
      if (errorCode === "invalid_input" || errorCode === "invalid_provider_response" || errorCode === "safety_filter") {
        throw error;
      }
      const unknownOutcome = imageOutcomeUnknown(error);
      lastError = error;
      await markModelFailed(db, row.provider_model_id ?? row.id, message);
      // A model failure must not take every model on this provider offline.
      await db.query("update provider_configs set last_error=$2, last_probed_at=now(), updated_at=now() where id=$1", [row.id, message.slice(0, 240)]);
      if (unknownOutcome) throw unknownOutcome;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All configured provider keys failed");
}

export async function generateConfiguredVideo(db: Pool, model: string, params: { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[]; inputVideo?: string; enableAudio?: boolean }): Promise<GeneratedVideo | null> {
  if (isRemovedModelId(model)) return null;
  const { rows: profileRows } = await db.query<{ api_format: string }>("select pc.api_format from provider_configs pc join provider_models pm on pm.provider_id=pc.id where pc.enabled=true and pm.enabled=true and pm.model_id=$1 order by pm.priority limit 1", [model]);
  if (profileRows[0]) {
    const profile = getModelCallProfile(model, profileRows[0].api_format);
    const inlineImageCount = params.inputImages?.filter((image) => /^data:/i.test(image)).length ?? 0;
    if (profile.requiresPublicImageUrl && inlineImageCount > 0) {
      throw Object.assign(
        new Error(`${profile.id} requires public HTTP(S) reference image URLs; received ${inlineImageCount} inline data URI(s)`),
        { code: "invalid_input" },
      );
    }
    const invalid = validateProfileInput(profile, {
      ...(params.duration != null ? { duration: params.duration } : {}),
      ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
      ...(params.inputImages?.length ? { inputImageCount: params.inputImages.length } : {}),
      ...(params.enableAudio != null ? { enableAudio: params.enableAudio } : {}),
    });
    if (invalid) throw Object.assign(new Error(profile.id + ": " + invalid), { code: "invalid_input" });
  }
  await restoreRecentVideoModelHealth(db, model);
  return generateConfiguredVideoWithFailover(db, model, params);
}

export async function generateConfiguredVideoOnce(db: Pool, model: string, params: { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[]; inputVideo?: string; enableAudio?: boolean }, providerId?: string): Promise<GeneratedVideo | null> {
  const { rows } = await db.query<ProviderRow>("select pc.id, pc.label, pm.id as provider_model_id, pc.base_url,pc.key_ciphertext,pc.latency_ms,pc.api_format,pc.request_template,pc.response_template from provider_configs pc join provider_models pm on pm.provider_id=pc.id where pc.enabled=true and pc.health_status='healthy' and pc.models @> $1::jsonb and pm.model_id=$2 and pm.enabled=true and pm.health_status <> 'unhealthy' and pm.failure_count < 3 and (pm.cooldown_until is null or pm.cooldown_until <= now()) and ($3::uuid is null or pc.id=$3) order by case when lower($2) = 'minimax-h3' and lower(coalesce(pc.label,'')) like '%minimax%' then 0 else 1 end, case when $4::boolean and coalesce(pc.request_template->'required','[]'::jsonb) ? 'images' then 0 else 1 end,pm.failure_count,coalesce(pc.latency_ms,2147483647),pc.failure_count", [JSON.stringify([model]), model, providerId ?? null, Boolean(params.inputImages?.length)]);
  const row = rows[0];
  if (!row) return null;
  const started = Date.now();
  const lingkeConfig = (row.request_template ?? {}) as LingkeRequestConfig;
  const profile = getModelCallProfile(model, row.api_format);
  if (row.api_format === "lingke_media" && lingkeConfig.required?.includes("images") && !params.inputImages?.length) {
    throw Object.assign(new Error(`${model} requires one first-frame image`), { code: "invalid_input" });
  }
  const body = buildConfiguredVideoRequest(model, row.api_format, row.request_template, params);
  const baseUrl = row.base_url.replace(/\/$/, "");
  const requestId = randomUUID();
  console.log("[video-provider] selected", JSON.stringify({ requestId, model, providerId: row.id, label: row.label ?? null, baseUrl, apiFormat: row.api_format, inputImageCount: params.inputImages?.length ?? 0, requestBodyBytes: Buffer.byteLength(JSON.stringify(body)) }));
  const apiKey = decryptKey(row.key_ciphertext);
  const submitPath = row.api_format === "lingke_media" ? "/media/generate" : "/videos";
  let payload = await requestProviderJson(
    `${baseUrl}${submitPath}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: VIDEO_SUBMIT_TIMEOUT_MS, operation: "video", requestId, phase: "submit" },
  ) as Record<string, unknown>;
  console.log("[video-provider] response", JSON.stringify({ model, providerId: row.id, label: row.label ?? null, response: providerResponseShape(payload) }));
  const template = row.response_template ?? {};
  const taskId = readTaskId(payload, template.taskIdPath);
  if (taskId && !readVideoUrl(payload, template.videoUrlPath)) {
    const customPollUrl = typeof template.pollUrlTemplate === "string"
      ? template.pollUrlTemplate.replace("{{taskId}}", encodeURIComponent(taskId))
      : null;
    const pollUrl = customPollUrl ?? (profile.pollPath
      ? profile.pollPath(baseUrl, taskId)
      : row.api_format === "lingke_media"
      ? `${baseUrl}/skills/task-status?task_id=${encodeURIComponent(taskId)}`
      : `${baseUrl}/videos/${encodeURIComponent(taskId)}`);
    let consecutivePollErrors = 0;
    for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, videoPollDelayMs(attempt)));
      let poll: Response;
      try {
        poll = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}`, "x-helstera-request-id": requestId }, signal: AbortSignal.timeout(VIDEO_POLL_REQUEST_TIMEOUT_MS) });
      } catch (error) {
        consecutivePollErrors += 1;
        console.warn("[video-provider] poll_error", JSON.stringify({ requestId, taskId, attempt, consecutivePollErrors, message: error instanceof Error ? error.message : String(error) }));
        if (consecutivePollErrors < VIDEO_POLL_ERROR_LIMIT) continue;
        throw Object.assign(
          new Error(`video polling repeatedly failed after upstream accepted task ${taskId} requestId=${requestId}: ${error instanceof Error ? error.message : String(error)}`),
          { code: /abort|timeout|timed out/i.test(error instanceof Error ? error.message : String(error)) ? "upstream_poll_timeout" : "upstream_task_accepted" },
        );
      }
      if (!poll.ok) {
        consecutivePollErrors += 1;
        if (poll.status >= 500 && consecutivePollErrors < VIDEO_POLL_ERROR_LIMIT) continue;
        throw Object.assign(
          new Error(`video polling returned ${poll.status} after upstream accepted task ${taskId}`),
          { code: "upstream_task_accepted" },
        );
      }
      consecutivePollErrors = 0;
      payload = await poll.json() as Record<string, unknown>;
      const status = readStatus(payload, template.statusPath);
      if (TERMINAL_VIDEO_FAILURES.has(status)) {
        const detail = readPath(payload, "error") ?? readPath(payload, "data.error");
        throw Object.assign(
          new Error(`video provider task ${status}${typeof detail === "string" && detail ? `: ${detail}` : ""}`),
          { code: "upstream_task_failed" },
        );
      }
      if (readVideoUrl(payload, template.videoUrlPath)) break;
    }
  }
  const url = readVideoUrl(payload, template.videoUrlPath ?? (row.api_format === "lingke_media" ? "result_url" : undefined));
  if (!url) {
    const providerRecord = payload as Record<string, unknown>;
    const providerMessage = readProviderRejectionMessage(providerRecord);
    const providerCode = (payload as Record<string, unknown>)?.code;
    const providerData = (payload as Record<string, unknown>)?.data;
    const normalizedProviderCode = String(providerCode ?? "").toLowerCase();
    const hasProviderData = Array.isArray(providerData)
      ? providerData.length > 0
      : Boolean(providerData && typeof providerData === "object" && Object.keys(providerData as object).length > 0);
    const isBusinessRejection = hasProviderData
      && normalizedProviderCode !== "0"
      && normalizedProviderCode !== "200"
      && normalizedProviderCode !== "ok"
      && normalizedProviderCode !== "success";
    if (isBusinessRejection) {
      const rejectionCode = classifyVideoProviderRejection(providerCode, providerMessage);
      throw Object.assign(
        new Error(`Video provider returned a business rejection${providerMessage ? `: ${providerMessage}` : ""}`),
        { code: rejectionCode },
      );
    }
    const hasBalanceError = providerCode === 402
      || (providerData && typeof providerData === "object" && Object.keys(providerData as object).some((key) => /余额|差额|需要金额/.test(key)));
    if (hasBalanceError) {
      throw Object.assign(
        new Error(`video provider rejected request: insufficient balance${providerMessage ? ` (${providerMessage})` : ""}`),
        { code: "upstream_insufficient_balance" },
      );
    }
    const payloadShape = payload && typeof payload === "object"
      ? Object.fromEntries(Object.entries(payload as Record<string, unknown>).map(([key, value]) => [
          key,
          value && typeof value === "object" ? Object.keys(value as object) : typeof value,
        ]))
      : typeof payload;
    throw Object.assign(
      new Error(taskId
        ? `video provider task ${taskId} did not return a video within 20 minutes`
        : `video provider returned no task ID or video URL; response: ${JSON.stringify(providerResponseShape(payload))}`),
      { code: taskId ? "upstream_poll_timeout" : "invalid_provider_response" },
    );
  }
  const usage = readUsage(payload as ProviderResponse);
  await markModelHealthy(db, row.provider_model_id!);
  await db.query("update provider_configs set latency_ms=$2, last_error=null, last_probed_at=now(), updated_at=now() where id=$1", [row.id, Date.now() - started]);
  console.log("[video-provider] request_done", JSON.stringify({ requestId, model, providerId: row.id, elapsedMs: Date.now() - started }));
  return { url, mimeType: "video/mp4", width: 1024, height: 1024, durationSeconds: readDuration(payload) ?? params.duration ?? 5, ...(usage ? { usage } : {}) };
}

async function generateConfiguredVideoWithFailover(db: Pool, model: string, params: { prompt: string; duration?: number; resolution?: string; aspectRatio?: string; inputImages?: string[]; inputVideo?: string; enableAudio?: boolean }): Promise<GeneratedVideo | null> {
  const { rows } = await db.query<{ id: string; provider_model_id: string }>("select pc.id, pm.id as provider_model_id from provider_configs pc join provider_models pm on pm.provider_id=pc.id where pc.enabled=true and pc.health_status='healthy' and pc.models @> $1::jsonb and pm.model_id=$2 and pm.enabled=true and pm.health_status <> 'unhealthy' and pm.failure_count < 3 and (pm.cooldown_until is null or pm.cooldown_until <= now()) order by case when lower($2) = 'minimax-h3' and lower(coalesce(pc.label,'')) like '%minimax%' then 0 else 1 end, case when $3::boolean and coalesce(pc.request_template->'required','[]'::jsonb) ? 'images' then 0 else 1 end,pm.failure_count,coalesce(pc.latency_ms,2147483647),pc.failure_count", [JSON.stringify([model]), model, Boolean(params.inputImages?.length)]);
  if (rows.length === 0) return null;
  let lastError: Error | null = null;
  for (const candidate of rows) {
    try {
      return await generateConfiguredVideoOnce(db, model, params, candidate.id);
    } catch (error) {
      const errorCode = (error as { code?: string })?.code ?? "";
      if (["invalid_input", "invalid_provider_response", "safety_filter", "upstream_task_accepted", "upstream_outcome_unknown", "upstream_task_failed", "upstream_insufficient_balance"].includes(errorCode)) {
        // Provider schema mismatches and business rejections are request failures, not model outages.
        if (errorCode === "upstream_insufficient_balance") {
          await db.query(
            "update provider_models set health_status='unhealthy', last_error=$2, last_failed_at=now(), cooldown_until=null, updated_at=now() where id=$1",
            [candidate.provider_model_id, error instanceof Error ? error.message.slice(0, 240) : "Provider balance is insufficient"],
          );
        }
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      await markModelFailed(db, candidate.provider_model_id, lastError.message);
      await db.query("update provider_configs set failure_count=failure_count+1, last_error=$2, last_probed_at=now(), updated_at=now() where id=$1", [candidate.id, lastError.message.slice(0, 240)]);
    }
  }
  throw lastError ?? new Error(`All configured providers failed for video model ${model}`);
}
