import { boundedResponseBlob } from "./bounded-response-blob";
import { getServerBaseUrl } from "./env";
import {
  cancelJob,
  fetchGenerationApprovalStatus,
  fetchJob,
  uploadFile,
} from "./server-api";

export type FashionInput = {
  person_image: string;
  garment_image: string;
  model: string;
  size: string;
  client_config?: unknown;
};
export type FashionApproval = {
  approvalId: string;
  model: string;
  estimatedCredits: number;
  expiresAt: string;
};
export type FashionResult = {
  image: string;
  mimeType: string;
  model: string;
  assetId: string;
  jobId: string;
};
type FashionRequest = {
  key: string;
  fingerprint: string;
  model: string;
  assets: string[];
  approval?: FashionApproval;
  jobId?: string;
};
type Confirm = (approval: FashionApproval) => Promise<string>;
export type FashionProgress = {
  stage:
    | "uploading"
    | "quoting"
    | "approval"
    | "queued"
    | "running"
    | "downloading"
    | "completed"
    | "failed"
    | "canceled";
  message: string;
  jobId?: string;
  model?: string;
  credits?: number;
};
type Progress = (progress: FashionProgress) => void;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const requestKey = (userId: string) => "loomic:fashion:pending:" + userId;

export function pendingFashion(userId: string): FashionRequest | null {
  const raw = localStorage.getItem(requestKey(userId));
  if (!raw) return null;
  const saved = JSON.parse(raw) as FashionRequest;
  if (
    !UUID.test(saved.key) ||
    !Array.isArray(saved.assets) ||
    !saved.assets.every((id) => UUID.test(id))
  )
    throw new Error("试穿恢复记录无效，请在活动中核实原任务。");
  return saved;
}

function saveRequest(userId: string, request: FashionRequest) {
  localStorage.setItem(requestKey(userId), JSON.stringify(request));
}

export function finishFashion(userId: string, jobId: string) {
  if (pendingFashion(userId)?.jobId === jobId)
    localStorage.removeItem(requestKey(userId));
}
export function clearFashionApproval(userId: string, approvalId: string) {
  const request = pendingFashion(userId);
  if (request?.approval?.approvalId === approvalId && !request.jobId)
    localStorage.removeItem(requestKey(userId));
}
export async function cancelFashion(userId: string, token: string) {
  const request = pendingFashion(userId);
  if (!request?.jobId)
    throw new Error("请先恢复原请求，确认任务状态后再取消。");
  await cancelJob(token, request.jobId);
  const { job } = await fetchJob(token, request.jobId);
  if (job.status === "succeeded")
    throw new Error("任务已完成，请恢复并取回结果。");
  if (["failed", "dead_letter", "canceled"].includes(job.status)) {
    finishFashion(userId, request.jobId);
    return;
  }
  throw new Error("取消请求已提交，请稍后恢复任务核对最终状态。");
}

// The upstream compressor strips the data URI prefix, so detect the actual bytes.
export function decodeFashionImage(source: string, name: string): File {
  const encoded = source.startsWith("data:")
    ? source.slice(source.indexOf(",") + 1)
    : source;
  if (
    !encoded ||
    encoded.length > MAX_IMAGE_BYTES * 1.4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw new Error("试穿图片格式或大小无效。");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    throw new Error("无法读取试穿图片，请重新选择。");
  }
  const signature = String.fromCharCode(...bytes.slice(0, 12));
  const format: [string, string] | null = signature.startsWith(
    "\x89PNG\r\n\x1a\n",
  )
    ? ["image/png", "png"]
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? ["image/jpeg", "jpg"]
      : signature.startsWith("RIFF") && signature.slice(8) === "WEBP"
        ? ["image/webp", "webp"]
        : null;
  if (!format || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("请选择有效的 PNG、JPEG 或 WebP 图片。");
  return new File([bytes], name + "." + format[1], { type: format[0] });
}

export function normalizeFashionResult(payload: unknown): FashionResult {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("image" in payload) ||
    typeof payload.image !== "string"
  ) {
    throw new Error("试穿服务没有返回有效图片。");
  }
  const image = decodeFashionImage(payload.image, "try-on");
  const jobId =
    "jobId" in payload && typeof payload.jobId === "string"
      ? payload.jobId
      : "";
  const assetId =
    "assetId" in payload && typeof payload.assetId === "string"
      ? payload.assetId
      : "";
  return {
    image: payload.image.startsWith("data:")
      ? payload.image.slice(payload.image.indexOf(",") + 1)
      : payload.image,
    mimeType: image.type,
    model:
      "model" in payload && typeof payload.model === "string"
        ? payload.model
        : "个人模型",
    jobId: UUID.test(jobId.replace(/^(native|external):/, ""))
      ? jobId
      : "external:" + crypto.randomUUID(),
    assetId: UUID.test(assetId) ? assetId : "",
  };
}

async function pollResult(
  userId: string,
  token: string,
  jobId: string,
  model: string,
  signal: AbortSignal,
  progress: Progress,
): Promise<FashionResult> {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const { job } = await fetchJob(token, jobId, signal);
    progress({
      stage: job.status === "queued" ? "queued" : "running",
      message:
        job.status === "queued"
          ? "任务已排队，可离开页面后恢复原任务。"
          : `正在试穿生成${typeof job.progress === "number" ? ` · ${job.progress}%` : ""}，无需再次确认或扣费。`,
      jobId,
      model,
    });
    if (["failed", "dead_letter", "canceled"].includes(job.status)) {
      // Clear only after the server confirms a terminal state, never on network failure.
      localStorage.setItem(
        "loomic:fashion:last-ended:" + userId,
        JSON.stringify({ jobId, status: job.status }),
      );
      finishFashion(userId, jobId);
      progress({
        stage: job.status === "canceled" ? "canceled" : "failed",
        message: `${job.error_message || "试穿任务已终止。"} 费用处理请在用量记录中核对。`,
        jobId,
        model,
      });
      throw new Error(
        "试穿任务未完成，服务端已确认任务终止。可重新选择照片并确认新任务费用。",
      );
    }
    if (job.status === "succeeded" && job.result) {
      progress({
        stage: "downloading",
        message: "生成完成，正在取回私有结果；下载失败可重试取回。",
        jobId,
        model,
      });
      const assetId = job.result.asset_id;
      if (typeof assetId !== "string" || !UUID.test(assetId))
        throw new Error("试穿结果缺少有效素材标识。");
      const image = await fetch(
        getServerBaseUrl() + "/api/uploads/" + assetId + "/file",
        {
          headers: { Authorization: "Bearer " + token },
          signal,
          redirect: "error",
        },
      );
      if (!image.ok)
        throw new Error("试穿已完成，但下载失败。请恢复结果，不要重复生成。");
      const blob = await boundedResponseBlob(image, MAX_IMAGE_BYTES);
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = () => reject(new Error("无法读取试穿结果。"));
        reader.readAsDataURL(blob);
      });
      const validated = decodeFashionImage(encoded, "try-on");
      progress({
        stage: "completed",
        message: "试穿完成，结果已回到本页和私有素材库。",
        jobId,
        model,
      });
      return {
        image: encoded,
        mimeType: validated.type,
        model,
        assetId,
        jobId,
      };
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2500);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error("任务仍在后台生成。恢复结果会继续查询原任务，不会再次扣费。");
}

async function continueRequest(
  userId: string,
  token: string,
  request: FashionRequest,
  confirm: Confirm,
  signal: AbortSignal,
  progress: Progress,
) {
  if (!request.jobId && request.approval) {
    const status = await fetchGenerationApprovalStatus(
      token,
      request.approval.approvalId,
    );
    signal.throwIfAborted();
    if (typeof status.jobId === "string" && UUID.test(status.jobId))
      request.jobId = status.jobId;
    else if (["rejected", "expired"].includes(String(status.approvalStatus))) {
      localStorage.removeItem(requestKey(userId));
      throw new Error("原试穿审批已取消或过期，请重新发起并确认费用。");
    } else {
      progress({
        stage: "approval",
        message: `等待确认本次 ${request.approval.estimatedCredits} 积分，尚未生成。`,
        model: request.approval.model,
        credits: request.approval.estimatedCredits,
      });
      request.jobId = await confirm(request.approval);
    }
    saveRequest(userId, request);
  }
  if (!request.jobId)
    throw new Error("上传尚未完成，请重新选择同一组照片和服装后继续。");
  return pollResult(
    userId,
    token,
    request.jobId,
    request.model,
    signal,
    progress,
  );
}

export async function resumeFashion(
  userId: string,
  token: string,
  confirm: Confirm,
  signal: AbortSignal,
  progress: Progress = () => {},
) {
  const request = pendingFashion(userId);
  if (!request) throw new Error("没有待恢复的试穿任务。");
  return continueRequest(userId, token, request, confirm, signal, progress);
}

export async function generateFashion(
  input: FashionInput,
  userId: string,
  token: string,
  confirm: Confirm,
  signal: AbortSignal,
  progress: Progress = () => {},
) {
  if (input.client_config)
    throw new Error(
      "使用个人模型时，请在设置中填写独立后端地址。平台接口不会转发个人密钥。",
    );
  if (!input.model) throw new Error("请先选择已配置的图像模型。");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        input.person_image,
        input.garment_image,
        input.model,
        input.size,
      ]),
    ),
  );
  const fingerprint = [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const prior = pendingFashion(userId);
  if (prior && prior.fingerprint !== fingerprint)
    throw new Error(
      "上一项试穿仍待确认或恢复。请先恢复原任务，或在活动中取消后再开始。",
    );
  const request: FashionRequest = prior ?? {
    key: crypto.randomUUID(),
    fingerprint,
    model: input.model,
    assets: [],
  };
  saveRequest(userId, request);
  if (request.jobId || request.approval)
    return continueRequest(userId, token, request, confirm, signal, progress);
  for (const [index, source] of [
    input.person_image,
    input.garment_image,
  ].entries()) {
    signal.throwIfAborted();
    if (request.assets[index]) continue;
    const file = decodeFashionImage(source, index === 0 ? "person" : "garment");
    progress({
      stage: "uploading",
      message: `正在安全上传${index === 0 ? "人物照片" : "服装参考"}（${index + 1}/2），尚未生成或扣费。`,
      model: input.model,
    });
    const uploaded = await uploadFile(token, file, undefined, "try-on");
    request.assets.push(uploaded.asset.id);
    saveRequest(userId, request);
  }
  signal.throwIfAborted();
  progress({
    stage: "quoting",
    message: "正在获取本次精确报价，确认前不调用生成模型。",
    model: input.model,
  });
  const response = await fetch(
    getServerBaseUrl() + "/api/jobs/image-generation",
    {
      method: "POST",
      signal,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Idempotency-Key": request.key,
      },
      body: JSON.stringify({
        purpose: "try-on",
        model: input.model,
        aspect_ratio: "2:3",
        input_asset_ids: request.assets,
        prompt:
          "虚拟试穿：第一张是人物照片，第二张是服装参考（可能包含上衣与下装）。保持第一张人物的身份、面部特征、身形和姿态，准确呈现参考服装的版型、材质、图案与颜色，生成完整的自然试穿照片。",
      }),
    },
  );
  const payload = await response.json();
  if (
    response.status === 409 &&
    payload.error?.code === "generation_confirmation_required"
  ) {
    if (
      !UUID.test(payload.data?.approvalId) ||
      !Number.isFinite(payload.data?.estimatedCredits)
    )
      throw new Error("费用确认信息无效，任务未启动。");
    request.approval = payload.data;
  } else if (response.ok && UUID.test(payload.job?.id))
    request.jobId = payload.job.id;
  else {
    if (
      [400, 422].includes(response.status) ||
      [
        "no_image_model",
        "connector_disabled",
        "generation_confirmation_unavailable",
      ].includes(payload.error?.code)
    )
      localStorage.removeItem(requestKey(userId));
    throw new Error(payload.error?.message ?? "无法创建试穿任务。");
  }
  saveRequest(userId, request);
  return continueRequest(userId, token, request, confirm, signal, progress);
}
