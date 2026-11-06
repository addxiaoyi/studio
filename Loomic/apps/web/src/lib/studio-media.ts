import { boundedResponseBlob } from "./bounded-response-blob";
import { getServerBaseUrl } from "./env";

export const MAX_STUDIO_MEDIA_BYTES = 250 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4", "video/webm": "webm", "image/webp": "webp", "image/jpeg": "jpg",
  "image/png": "png", "image/gif": "gif", "audio/mpeg": "mp3", "audio/wav": "wav",
  "audio/ogg": "ogg", "audio/mp4": "m4a",
};

export function privateStudioAssetUrl(assetId: string): string {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(assetId)) throw new Error("素材标识无效，请重新加载素材库。");
  return `${getServerBaseUrl()}/api/uploads/${assetId}/file`;
}

export async function readStudioAsset(token: string, assetId: string, signal?: AbortSignal): Promise<File> {
  const response = await fetch(privateStudioAssetUrl(assetId), {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", credentials: "include", ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error("素材下载失败或已过期。请重试取回，不要重复生成。");
  const blob = await boundedResponseBlob(response, MAX_STUDIO_MEDIA_BYTES);
  const mime = (blob.type.split(";")[0] ?? "").trim();
  const ext = EXTENSIONS[mime];
  if (!ext || !blob.size) throw new Error("素材为空或格式不支持，请选择图片、视频或音频。");
  return new File([blob], `${assetId}.${ext}`, { type: mime });
}
