import { getServerBaseUrl } from "./env";
import { boundedResponseBlob } from "./bounded-response-blob";

const MEDIA_LIMIT = 250 * 1024 * 1024;
const METADATA_TIMEOUT = 20_000;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export type CanvasAssetFile = {
  assetId: string;
  libraryAssetId: string;
  title: string;
  file: File;
};
export type CanvasMediaInfo = {
  width: number;
  height: number;
  duration: number;
  dataUrl?: string;
};

export async function readCanvasAsset(
  token: string,
  id: string,
  signal: AbortSignal,
): Promise<CanvasAssetFile> {
  if (!UUID.test(id)) throw new Error("素材标识无效，请从素材库重新打开。");
  const headers = { Authorization: `Bearer ${token}` };
  const lookup = await fetch(
    `${getServerBaseUrl()}/api/assets/${id}/canvas-source`,
    { headers, signal, credentials: "include", redirect: "error" },
  );
  if (!lookup.ok)
    throw new Error(
      lookup.status === 401
        ? "登录已失效，请重新登录后重试导入。"
        : lookup.status === 404
          ? "素材已过期、已删除或无权访问，请到素材库核对。"
          : `读取素材信息失败（${lookup.status}），请重试。`,
    );
  const body: unknown = await lookup.json();
  const source =
    body && typeof body === "object" && "data" in body
      ? (body.data as Record<string, unknown>)
      : null;
  if (
    !source ||
    typeof source.assetId !== "string" ||
    !UUID.test(source.assetId) ||
    typeof source.libraryAssetId !== "string" ||
    !UUID.test(source.libraryAssetId)
  )
    throw new Error("素材信息不完整，请重试读取。");
  const response = await fetch(
    `${getServerBaseUrl()}/api/uploads/${source.assetId}/file`,
    { headers, signal, credentials: "include", redirect: "error" },
  );
  if (!response.ok)
    throw new Error(
      `素材文件读取失败（${response.status}）。原任务未重新生成，请重试导入。`,
    );
  const blob = await boundedResponseBlob(response, MEDIA_LIMIT);
  signal.throwIfAborted();
  if (!blob.size || !/^(image|video|audio)\//.test(blob.type))
    throw new Error("素材为空或格式不受支持。");
  const extensions: Record<string, string> = {
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/x-wav": "wav",
    "image/jpeg": "jpg",
  };
  const file = new File(
    [blob],
    `${source.assetId}.${extensions[blob.type] ?? blob.type.split("/")[1]?.split(";")[0] ?? "bin"}`,
    { type: blob.type },
  );
  return {
    assetId: source.assetId,
    libraryAssetId: source.libraryAssetId,
    title: typeof source.title === "string" ? source.title : "素材",
    file,
  };
}

export function blobDataUrl(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.readAsDataURL(blob);
  });
}

export async function inspectCanvasMedia(
  file: File,
  signal: AbortSignal,
): Promise<CanvasMediaInfo> {
  signal.throwIfAborted();
  if (file.type.startsWith("image/")) {
    const bitmap = await createImageBitmap(file);
    try {
      signal.throwIfAborted();
      return {
        width: bitmap.width,
        height: bitmap.height,
        duration: 0,
        dataUrl: await blobDataUrl(file, signal),
      };
    } finally {
      bitmap.close();
    }
  }
  return new Promise((resolve, reject) => {
    const media = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio",
    );
    const url = URL.createObjectURL(file);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      const duration = media.duration;
      const info = {
        width: media instanceof HTMLVideoElement ? media.videoWidth : 0,
        height: media instanceof HTMLVideoElement ? media.videoHeight : 0,
        duration,
      };
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        (file.type.startsWith("video/") && (!info.width || !info.height))
      )
        reject(new Error("无法确定素材的真实时长或尺寸，请转换文件后重试。"));
      else resolve(info);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(
      () => finish(new Error("解析素材超时，请重试。")),
      METADATA_TIMEOUT,
    );
    signal.addEventListener("abort", abort, { once: true });
    media.preload = "metadata";
    media.onloadedmetadata = () => finish();
    media.onerror = () => finish(new Error("素材无法解码，请检查文件格式。"));
    media.src = url;
  });
}
