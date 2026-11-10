import { getServerBaseUrl } from "./env";

export type PrivateMedia = { path: string; mimeType: string; byteSize: number; expiresAt: string | null; grantSeconds: number };
export async function preparePrivateMedia(assetId: string, token: string, signal?: AbortSignal): Promise<PrivateMedia> {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(assetId)) throw new Error("录屏素材标识无效。");
  const response = await fetch(`${getServerBaseUrl()}/api/uploads/${assetId}/playback`, {
    method: "POST", credentials: "include", redirect: "error", cache: "no-store", signal: signal ?? null,
    headers: token === "local-cookie" ? {} : { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(response.status === 401 ? "登录已过期，请重新登录后重试。" : response.status === 404 ? "素材已到期、已删除或无权访问，本机副本不受影响。" : `暂时无法读取素材（HTTP ${response.status}），请重试。`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("素材服务返回了无效响应，请重试。");
  const body = await response.json();
  const media = body.data as PrivateMedia;
  if (!body.ok || media?.path !== `/api/uploads/${assetId}/file` || typeof media.mimeType !== "string" || !Number.isFinite(media.byteSize) || media.byteSize <= 0) throw new Error("素材文件无效。");
  return { ...media, path: getServerBaseUrl() + media.path };
}
