import { createExcalidrawImageElement, isVideoUrl } from "./canvas-elements";
import { getServerBaseUrl } from "./env";

type CanvasElement = Record<string, unknown>;
type ThumbnailApi = {
  getSceneElements(): readonly CanvasElement[];
  getAppState(): Record<string, unknown>;
  getFiles(): Record<string, Record<string, unknown>>;
};

export function getThumbnailElements(elements: readonly CanvasElement[], appState: Record<string, unknown>) {
  const visible = elements.filter(element => element.isDeleted !== true);
  const zoom = Number((appState.zoom as { value?: number } | undefined)?.value) || 1;
  const width = Number(appState.width) || 0;
  const height = Number(appState.height) || 0;
  if (!visible.length || width <= 0 || height <= 0) return visible;
  const left = -(Number(appState.scrollX) || 0);
  const top = -(Number(appState.scrollY) || 0);
  const right = left + width / zoom;
  const bottom = top + height / zoom;
  const inViewport = visible.filter(element => {
    const x = Number(element.x) || 0;
    const y = Number(element.y) || 0;
    return x + Math.abs(Number(element.width) || 0) >= left && x <= right
      && y + Math.abs(Number(element.height) || 0) >= top && y <= bottom;
  });
  return inViewport.length ? inViewport : visible;
}

type Poster = { dataURL: string; mimeType: string };
const POSTER_TIMEOUT_MS = 5000;
const POSTER_MAX_BYTES = 8 * 1024 * 1024;

function videoAssetId(link: string): string | null {
  const origin = new URL(getServerBaseUrl() || window.location.origin).origin;
  const url = new URL(link, origin);
  if (url.origin !== origin) return null;
  return url.pathname.match(/^\/api\/uploads\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})\/file$/i)?.[1] ?? null;
}

function unavailableVideo(): Poster {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
    + '<rect width="640" height="360" rx="16" fill="#eef2f6"/>'
    + '<rect x="284" y="110" width="72" height="48" rx="8" fill="none" stroke="#64748b" stroke-width="4"/>'
    + '<path d="M356 122l22-10v44l-22-10M313 121l18 13-18 13z" fill="#64748b"/>'
    + '<text x="320" y="211" text-anchor="middle" font-family="system-ui,sans-serif" font-size="24" fill="#334155">视频预览暂不可用</text>'
    + '<text x="320" y="247" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" fill="#64748b">打开项目查看素材</text></svg>';
  return { dataURL: `data:image/svg+xml,${encodeURIComponent(svg)}`, mimeType: "image/svg+xml" };
}

async function readVideoPoster(assetId: string, accessToken: string): Promise<Poster> {
  try {
    const response = await fetch(`${getServerBaseUrl()}/api/uploads/${assetId}/file?preview=1`, {
      credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(POSTER_TIMEOUT_MS),
      headers: accessToken === "local-cookie" ? {} : { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Video poster unavailable (HTTP ${response.status})`);
    const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("Video poster is not an image");
    const blob = await response.blob();
    if (!blob.size || blob.size > POSTER_MAX_BYTES) throw new Error("Video poster size is invalid");
    const dataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Video poster could not be read"));
      reader.readAsDataURL(blob);
    });
    return { dataURL, mimeType };
  } catch (error) {
    console.warn("[canvas-thumbnail] video poster unavailable", error instanceof Error ? error.message : "Unknown error");
    return unavailableVideo();
  }
}

export async function buildProjectThumbnail(api: ThumbnailApi, accessToken: string): Promise<Blob | null> {
  const elements = getThumbnailElements(api.getSceneElements(), api.getAppState());
  if (!elements.length) return null;
  const files = { ...api.getFiles() };
  // A loading image must not replace a previously valid project preview.
  if (elements.some(element => element.type === "image" && !files[String(element.fileId)]?.dataURL)) return null;
  const posters = new Map<string, Promise<Poster>>();
  const previewElements: CanvasElement[] = [];
  for (const element of elements) {
    const custom = element.customData as { isVideo?: boolean } | undefined;
    const link = typeof element.link === "string" ? element.link : "";
    const isVideo = element.type === "embeddable" && (custom?.isVideo === true || isVideoUrl(link) || link.includes("/api/uploads/"));
    if (!isVideo) { previewElements.push(element); continue; }
    let assetId: string | null = null;
    try { assetId = videoAssetId(link); } catch { /* Invalid media links use the same explicit preview fallback. */ }
    if (assetId && !posters.has(assetId)) posters.set(assetId, readVideoPoster(assetId, accessToken));
    const poster = assetId ? await posters.get(assetId)! : unavailableVideo();
    const fileId = `thumbnail-video-${element.id}`;
    files[fileId] = { id: fileId, ...poster, created: Date.now() };
    // Replace only the export copy. Excalidraw otherwise prints the embed URL onto the bitmap.
    previewElements.push({
      ...createExcalidrawImageElement({ fileId, x: Number(element.x) || 0, y: Number(element.y) || 0,
        width: Number(element.width) || 640, height: Number(element.height) || 360 }),
      id: element.id, angle: element.angle ?? 0, opacity: element.opacity ?? 100,
      groupIds: element.groupIds ?? [], frameId: element.frameId ?? null,
    });
  }
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  return exportToBlob({
    elements: previewElements as Parameters<typeof exportToBlob>[0]["elements"],
    appState: { exportBackground: true, viewBackgroundColor: String(api.getAppState().viewBackgroundColor ?? "#ffffff") },
    files: files as Parameters<typeof exportToBlob>[0]["files"],
    mimeType: "image/webp", quality: 0.8, maxWidthOrHeight: 400,
  });
}
