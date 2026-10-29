"use client";

import "@excalidraw/excalidraw/index.css";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useLocale } from "../lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";

import type { WebSocketHandle } from "../hooks/use-websocket";
import { getServerBaseUrl } from "../lib/env";
import { fetchCanvas, saveCanvas, uploadThumbnail } from "../lib/server-api";
import { VideoCanvasElement } from "./canvas/video-canvas-element";
import { createExcalidrawImageElement, isVideoUrl, scaleToFit, viewportPointToScene } from "../lib/canvas-elements";
import { CanvasToolMenu } from "./canvas-tool-menu";
import { normalizeCanvasElement, normalizeCanvasElements } from "../lib/canvas-normalize";
import { ErrorBoundary } from "./error-boundary";
import { Trash2 } from "lucide-react";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false },
);

// Safari <16.4 does not support requestIdleCallback — provide a fallback
// that defers via setTimeout(cb, 1) to approximate idle scheduling.
const ric: typeof requestIdleCallback =
  typeof window !== "undefined" && window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb: IdleRequestCallback) => setTimeout(cb, 1) as unknown as number;
const cic: typeof cancelIdleCallback =
  typeof window !== "undefined" && window.cancelIdleCallback
    ? window.cancelIdleCallback.bind(window)
    : clearTimeout;

// Memoize CanvasToolMenu to prevent re-renders when parent state changes
// (e.g. selection changes in the editor don't need to re-render the toolbar)
const MemoizedCanvasToolMenu = memo(CanvasToolMenu);

export type CanvasSelectedElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  fileId?: string;
  dataUrl?: string;
  /** Supabase storage public URL -- prefer over dataUrl for message attachments */
  storageUrl?: string;
  /** Persistent upload/generated asset ID used by the video first-frame path. */
  assetId?: string;
};

type CanvasEditorProps = {
  canvasId: string;
  projectId: string;
  accessToken: string;
  initialContent: {
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  };
  onApiReady?: (api: any) => void;
  onReady?: () => void;
  ws?: WebSocketHandle;
  leftPanelOpen?: boolean;
  onSelectionChange?: (elements: CanvasSelectedElement[]) => void;
};

type CanvasSaveState = "saved" | "pending" | "saving" | "error";

export function canvasSaveStateLabel(state: CanvasSaveState): string {
  if (state === "pending") return "待保存";
  if (state === "saving") return "保存中…";
  if (state === "error") return "保存失败";
  return "已保存";
}

const SAVE_DEBOUNCE_MS = 1500;
const THUMBNAIL_DEBOUNCE_MS = 10_000;
const THUMBNAIL_INITIAL_REFRESH_DELAY_MS = 1500;
const THUMBNAIL_MAX_SIZE = 400;

export function getThumbnailElements(elements: readonly Record<string, unknown>[], appState: Record<string, unknown>) {
  const visible = elements.filter((element) => element.isDeleted !== true);
  const zoom = Number((appState.zoom as { value?: number } | undefined)?.value) || 1;
  const width = Number(appState.width) || 0;
  const height = Number(appState.height) || 0;
  if (!visible.length || width <= 0 || height <= 0) return visible;

  const viewportLeft = -(Number(appState.scrollX) || 0);
  const viewportTop = -(Number(appState.scrollY) || 0);
  const viewportRight = viewportLeft + width / zoom;
  const viewportBottom = viewportTop + height / zoom;
  const inViewport = visible.filter((element) => {
    const left = Number(element.x) || 0;
    const top = Number(element.y) || 0;
    const right = left + Math.abs(Number(element.width) || 0);
    const bottom = top + Math.abs(Number(element.height) || 0);
    return right >= viewportLeft && left <= viewportRight && bottom >= viewportTop && top <= viewportBottom;
  });

  return inViewport.length > 0 ? inViewport : visible;
}

async function buildThumbnailBlob(api: any): Promise<Blob | null> {
  const sceneElements = getThumbnailElements(api.getSceneElements(), api.getAppState());
  if (!sceneElements.length) return null;

  const { exportToBlob } = await import("@excalidraw/excalidraw");
  return exportToBlob({
    elements: sceneElements,
    appState: { exportBackground: true },
    files: api.getFiles(),
    mimeType: "image/webp",
    quality: 0.8,
    maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
  });
}

export function mergeCanvasSaveWithRemoteContent(
  local: { elements: Record<string, unknown>[]; appState: Record<string, unknown>; files: Record<string, Record<string, unknown>> },
  remote: { elements?: Record<string, unknown>[]; appState?: Record<string, unknown>; files?: Record<string, Record<string, unknown>> },
) {
  const localIds = new Set(local.elements.map((element) => element.id).filter((id): id is string => typeof id === "string"));
  const remoteOnlyElements = (remote.elements ?? []).filter((element) =>
    typeof element.id === "string"
      && !localIds.has(element.id)
      && element.isDeleted !== true,
  );
  const localFileIds = new Set(Object.keys(local.files));
  const remoteFileIds = new Set(remoteOnlyElements.map((element) => {
    const fileId = element.fileId;
    return typeof fileId === "string" ? fileId : undefined;
  }).filter((id): id is string => Boolean(id)));
  const retainedFiles = Object.fromEntries(Object.entries(remote.files ?? {}).filter(([id]) => remoteFileIds.has(id) && !localFileIds.has(id)));

  return {
    ...local,
    elements: [...local.elements, ...remoteOnlyElements],
    files: { ...local.files, ...retainedFiles },
  };
}

// ---------------------------------------------------------------------------
// Local recovery copy
//
// A failed save (network loss, auth hiccup, server 5xx, oversized keepalive
// flush on page teardown) would otherwise leave the newest edits only in
// memory. We persist the last payload locally so a refresh can still restore
// it and the user is never silently left with a stale server copy.
// ---------------------------------------------------------------------------

export const CANVAS_RECOVERY_PREFIX = "helstera:canvas-recovery:";

export type CanvasSavePayload = {
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
};

export type CanvasRecoveryCopy = {
  savedAt: number;
  content: CanvasSavePayload;
};

export function canvasRecoveryKey(canvasId: string): string {
  return `${CANVAS_RECOVERY_PREFIX}${canvasId}`;
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function writeCanvasRecoveryCopy(
  canvasId: string,
  content: CanvasSavePayload,
  storage?: Storage,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(
      canvasRecoveryKey(canvasId),
      JSON.stringify({ savedAt: Date.now(), content } satisfies CanvasRecoveryCopy),
    );
    return true;
  } catch {
    // Quota exceeded or storage disabled — the save path itself still runs.
    return false;
  }
}

export function readCanvasRecoveryCopy(
  canvasId: string,
  storage?: Storage,
): CanvasRecoveryCopy | null {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(canvasRecoveryKey(canvasId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasRecoveryCopy> | null;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.content ||
      !Array.isArray(parsed.content.elements)
    ) {
      return null;
    }
    return {
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

export function clearCanvasRecoveryCopy(canvasId: string, storage?: Storage): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.removeItem(canvasRecoveryKey(canvasId));
  } catch {
    // Nothing to do — a stale copy is harmless, the next save clears it.
  }
}

export function CanvasEditor({
  canvasId,
  projectId,
  accessToken,
  initialContent,
  onApiReady,
  onReady,
  ws,
  leftPanelOpen,
  onSelectionChange,
}: CanvasEditorProps) {
  const initialElements = initialContent.elements.map((element) =>
    normalizeCanvasElement(element),
  );
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const canvasIdRef = useRef(canvasId);
  canvasIdRef.current = canvasId;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);
  const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
  const [recoveryCopy, setRecoveryCopy] = useState<CanvasRecoveryCopy | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState(false);
  const [resolvedFilesVersion, setResolvedFilesVersion] = useState(0);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [deleteGesture, setDeleteGesture] = useState<{ active: boolean; overTrash: boolean }>({ active: false, overTrash: false });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletePointerRef = useRef({ x: 0, y: 0 });
  const dragDepthRef = useRef(0);
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const prevSelectedIdsRef = useRef<string>("");
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Tracks whether the one-time normalization pass has already run
  const normalizedRef = useRef(false);
  const thumbnailRefreshCanvasRef = useRef<string | null>(null);

  const cancelDeleteGesture = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    setDeleteGesture({ active: false, overTrash: false });
  }, []);

  const deleteSelectedElements = useCallback(() => {
    if (!excalidrawApi) return;
    const selected = Object.keys(excalidrawApi.getAppState().selectedElementIds ?? {});
    if (!selected.length) return;
    const selectedSet = new Set(selected);
    excalidrawApi.updateScene({
      elements: excalidrawApi.getSceneElements().map((element: any) => selectedSet.has(element.id) ? { ...element, isDeleted: true } : element),
      appState: { selectedElementIds: {} },
      captureUpdate: "IMMEDIATELY",
    });
  }, [excalidrawApi]);

  const handleCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !excalidrawApi) return;
    const selected = Object.keys(excalidrawApi.getAppState().selectedElementIds ?? {});
    if (!selected.length) return;
    deletePointerRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = setTimeout(() => setDeleteGesture({ active: true, overTrash: false }), 550);
  }, [excalidrawApi]);

  const handleCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!longPressTimerRef.current && !deleteGesture.active) return;
    const moved = Math.hypot(event.clientX - deletePointerRef.current.x, event.clientY - deletePointerRef.current.y);
    if (!deleteGesture.active && moved > 10) { cancelDeleteGesture(); return; }
    if (deleteGesture.active) setDeleteGesture((current) => ({ ...current, overTrash: event.clientY > window.innerHeight - 150 }));
  }, [cancelDeleteGesture, deleteGesture.active]);

  const handleCanvasPointerUp = useCallback(() => {
    if (deleteGesture.active && deleteGesture.overTrash) deleteSelectedElements();
    cancelDeleteGesture();
  }, [cancelDeleteGesture, deleteGesture.active, deleteGesture.overTrash, deleteSelectedElements]);

  // Guard: prevent auto-save until Excalidraw has fully hydrated with initial data.
  // Without this, a page reload can fire onChange with empty elements before
  // initialData is applied, causing a FULL REPLACE that wipes existing content.
  const hydratedRef = useRef(false);
  const initialElementCountRef = useRef(
    initialContent.elements.filter((e) => !e.isDeleted).length,
  );

  // Track pending save payload so we can flush on tab close / unmount
  const pendingSaveRef = useRef<{
    elements: Record<string, unknown>[];
    appState: Record<string, unknown>;
    files: Record<string, Record<string, unknown>>;
  } | null>(null);

  // Ref to hold initialContent.files for storageUrl lookup in handleChange
  // without adding the full initialContent to the dependency array.
  const initialFilesRef = useRef(initialContent.files);
  initialFilesRef.current = initialContent.files;

  // Separate inline files (ready) from storage URLs (need async fetch)
  const { inlineFiles, pendingUrls } = useMemo(() => {
    const inline: Record<string, Record<string, unknown>> = {};
    const pending: Array<{
      fileId: string;
      url: string;
      meta: Record<string, unknown>;
    }> = [];
    for (const [fileId, fileData] of Object.entries(initialContent.files)) {
      if (typeof fileData.storageUrl === "string" && fileData.storageUrl) {
        pending.push({ fileId, url: fileData.storageUrl, meta: fileData });
      } else {
        inline[fileId] = fileData;
      }
    }
    return { inlineFiles: inline, pendingUrls: pending };
  }, [initialContent.files]);

  // Lazily resolve storage URLs and inject into Excalidraw
  useEffect(() => {
    if (!excalidrawApi || pendingUrls.length === 0) return;
    let cancelled = false;

    async function resolveFiles() {
      const resolved: Record<string, any> = {};
      await Promise.all(
        pendingUrls.map(async ({ fileId, url, meta }) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) {
              console.warn(
                `[canvas-editor] Failed to fetch file ${fileId}: ${resp.status}`,
              );
              return;
            }
            const blob = await resp.blob();
            const reader = new FileReader();
            const dataURL = await new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            resolved[fileId] = {
              id: meta.id ?? fileId,
              mimeType: meta.mimeType ?? blob.type,
              created: meta.created ?? Date.now(),
              dataURL,
            };
          } catch (err) {
            console.warn(
              `[canvas-editor] Failed to resolve file ${fileId}:`,
              err,
            );
          }
        }),
      );
      if (!cancelled && Object.keys(resolved).length > 0) {
        excalidrawApi.addFiles(Object.values(resolved));
        setResolvedFilesVersion((version) => version + 1);
        console.log(
          `[canvas-editor] Resolved ${Object.keys(resolved).length} storage files`,
        );
      }
    }

    resolveFiles();
    return () => {
      cancelled = true;
    };
  }, [excalidrawApi, pendingUrls]);

  const uploadCurrentThumbnail = useCallback(async (api: any) => {
    if (!api || !hydratedRef.current || thumbnailRefreshCanvasRef.current === canvasId) return;

    const blob = await buildThumbnailBlob(api);
    if (!blob) return;

    thumbnailRefreshCanvasRef.current = canvasId;
    try {
      await uploadThumbnail(accessTokenRef.current, projectId, blob);
    } catch (error) {
      thumbnailRefreshCanvasRef.current = null;
      throw error;
    }
  }, [canvasId, projectId]);

  // Rebuild stale previews after stored canvas files have been resolved.
  useEffect(() => {
    if (!excalidrawApi) return;
    const timer = setTimeout(() => {
      uploadCurrentThumbnail(excalidrawApi).catch((error) =>
        console.warn("[canvas-editor] initial thumbnail refresh failed:", error),
      );
    }, THUMBNAIL_INITIAL_REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [excalidrawApi, resolvedFilesVersion, uploadCurrentThumbnail]);

  const handleExcalidrawApi = useCallback(
    (api: any) => {
      setExcalidrawApi(api);
      onApiReady?.(api);
    },
    [onApiReady],
  );

  // Normalize agent-created elements on initial load.
  // Uses DOM text measurement to fix server-side approximation errors.
  useEffect(() => {
    if (!excalidrawApi || normalizedRef.current) return;
    normalizedRef.current = true;

    // Run normalization after Excalidraw has loaded fonts.
    // Store the handle so we can cancel on unmount to prevent memory leaks.
    const idleHandle = ric(() => {
      try {
        const sceneElements = excalidrawApi.getSceneElements();
        // Create mutable copies for normalization
        const mutableElements = sceneElements.map((el: any) => ({ ...el }));
        const { changed } = normalizeCanvasElements(mutableElements);

        if (changed) {
          console.log("[canvas-editor] normalized agent-created elements");
          excalidrawApi.updateScene({
            elements: mutableElements,
            captureUpdate: "NONE",
          });
          // Persist normalized elements to DB
          const files: Record<string, Record<string, unknown>> = {};
          const rawFiles = excalidrawApi.getFiles() as Record<string, any>;
          for (const [id, file] of Object.entries(rawFiles)) {
            files[id] = {
              id: file.id,
              dataURL: file.dataURL,
              mimeType: file.mimeType,
              created: file.created,
            };
          }
          const appState = excalidrawApi.getAppState();
          saveCanvas(accessTokenRef.current, canvasIdRef.current, {
            elements: mutableElements.filter((el: any) => !el.isDeleted),
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor,
              gridModeEnabled: appState.gridModeEnabled,
            },
            files,
          }).catch((err: Error) =>
            console.warn("[canvas-editor] normalization save failed:", err),
          );
        }
      } catch (err) {
        console.warn("[canvas-editor] normalization failed:", err);
      }

      // Mark hydrated after normalization — auto-save is now safe.
      // Before this point, onChange may fire with incomplete element lists
      // during Excalidraw's internal initialization, which would cause a
      // FULL REPLACE with empty content and silently wipe existing data.
      hydratedRef.current = true;
      onReadyRef.current?.();
    });
    return () => cic(idleHandle);
  }, [excalidrawApi]);

  const handleChange = useCallback(
    (elements: readonly any[], appState: any) => {
      // Skip auto-save until Excalidraw has fully hydrated with initial data.
      // During initialization, onChange may fire with empty/partial elements
      // which would wipe the persisted canvas via FULL REPLACE.
      if (!hydratedRef.current) return;

      // --- 1. Debounced save ---
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      // Surface the unsaved debounce window immediately instead of implying
      // that the latest canvas change is already persisted.
      setSaveState("pending");

      // Mark that a save is pending. The full payload is built lazily inside
      // the timeout to avoid constructing the files map on every drag frame.
      pendingSaveRef.current = { elements: [] as any, appState: {}, files: {} };

      saveTimerRef.current = setTimeout(() => {
        // Build the full payload only when the debounce fires
        const files: Record<string, Record<string, unknown>> = {};
        if (excalidrawApi) {
          const rawFiles = excalidrawApi.getFiles() as Record<string, any>;
          for (const [id, file] of Object.entries(rawFiles)) {
            files[id] = {
              id: file.id,
              dataURL: file.dataURL,
              mimeType: file.mimeType,
              created: file.created,
            };
          }
        }
        const content = {
          elements: elements.filter((el: any) => !el.isDeleted) as Record<
            string,
            unknown
          >[],
          appState: {
            viewBackgroundColor: appState.viewBackgroundColor,
            gridModeEnabled: appState.gridModeEnabled,
          },
          files,
        };
        pendingSaveRef.current = content;
        setSaveState("saving");

        const save = async () => {
          const { canvas } = await fetchCanvas(accessTokenRef.current, canvasIdRef.current);
          const merged = mergeCanvasSaveWithRemoteContent(content, canvas.content);
          await saveCanvas(accessTokenRef.current, canvasIdRef.current, merged);
        };
        saveQueueRef.current = saveQueueRef.current
          .catch((error) => console.warn("[canvas-editor] previous save failed:", error))
          .then(save);
        saveQueueRef.current
          .then(() => {
            if (pendingSaveRef.current === content) {
              pendingSaveRef.current = null;
              setSaveState("saved");
            }
            clearCanvasRecoveryCopy(canvasIdRef.current);
            setRecoveryCopy(null);
            setRecoveryError(false);
          })
          .catch((err) => {
            if (pendingSaveRef.current === content) setSaveState("error");
            console.error("[canvas-editor] save failed:", err);
            // Keep the newest edits on this device so a refresh cannot lose them.
            if (writeCanvasRecoveryCopy(canvasIdRef.current, content)) {
              setRecoveryCopy(readCanvasRecoveryCopy(canvasIdRef.current));
            }
          });
      }, SAVE_DEBOUNCE_MS);

      // --- 2. Debounced thumbnail (runs much less frequently than save) ---
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = setTimeout(async () => {
        if (!excalidrawApi) return;
        try {
          const blob = await buildThumbnailBlob(excalidrawApi);
          if (!blob) return;

          console.log(
            "[canvas-editor] uploading thumbnail, blob size:",
            blob.size,
          );
          await uploadThumbnail(accessTokenRef.current, projectId, blob);
          console.log("[canvas-editor] thumbnail uploaded OK");
        } catch (err) {
          console.warn(
            "[canvas-editor] thumbnail generation/upload failed:",
            err,
          );
        }
      }, THUMBNAIL_DEBOUNCE_MS);

      // --- 3. Selection change detection ---
      // Cheap string comparison avoids unnecessary downstream re-renders.
      const selectedIds = appState.selectedElementIds
        ? Object.keys(appState.selectedElementIds as Record<string, boolean>)
            .filter(
              (id) =>
                (appState.selectedElementIds as Record<string, boolean>)[id],
            )
            .sort()
            .join(",")
        : "";

      if (selectedIds !== prevSelectedIdsRef.current) {
        prevSelectedIdsRef.current = selectedIds;
        if (onSelectionChangeRef.current) {
          if (!selectedIds) {
            onSelectionChangeRef.current([]);
          } else {
            const idSet = new Set(selectedIds.split(","));
            const selFiles: Record<string, any> =
              excalidrawApi?.getFiles() ?? {};
            const selected: CanvasSelectedElement[] = elements
              .filter((el: any) => idSet.has(el.id) && !el.isDeleted)
              .map((el: any) => {
                const base: CanvasSelectedElement = {
                  id: el.id,
                  type: el.type,
                  x: el.x ?? 0,
                  y: el.y ?? 0,
                  width: el.width ?? 0,
                  height: el.height ?? 0,
                };
                if (el.type === "text" && el.text) {
                  base.text = el.text;
                }
                if (el.type === "image" && el.fileId) {
                  base.fileId = el.fileId;
                  const assetId =
                    typeof el.customData?.assetId === "string"
                      ? el.customData.assetId
                      : typeof initialFilesRef.current[el.fileId]?.assetId === "string"
                        ? String(initialFilesRef.current[el.fileId]?.assetId)
                        : undefined;
                  if (assetId) base.assetId = assetId;
                  const file = selFiles[el.fileId];
                  if (file?.dataURL) {
                    base.dataUrl = file.dataURL;
                  }
                  // Prefer storage URL over base64 dataUrl for message attachments.
                  // Sources: 1) element customData (model-generated images)
                  //          2) initial canvas content files (server-resolved URLs)
                  const sUrl =
                    el.customData?.storageUrl ??
                    initialFilesRef.current[el.fileId]?.storageUrl;
                  if (typeof sUrl === "string" && sUrl) {
                    base.storageUrl = sUrl;
                  }
                }
                return base;
              });
            onSelectionChangeRef.current(selected);
          }
        }
      }
    },
    [canvasId, projectId, excalidrawApi],
  );

  // Register screenshot RPC handler so the server can request canvas captures
  useEffect(() => {
    if (!ws || !excalidrawApi) return;

    const cleanup = ws.registerRPC("canvas.screenshot", async (params) => {
      const {
        mode,
        region,
        max_dimension = 1024,
      } = params as {
        mode: string;
        region?: { x: number; y: number; width: number; height: number };
        max_dimension?: number;
      };

      const allElements = excalidrawApi
        .getSceneElements()
        .filter((e: any) => !e.isDeleted);
      const appState = excalidrawApi.getAppState();
      const files = excalidrawApi.getFiles();

      let elements = allElements;

      if (mode === "region" && region) {
        elements = allElements.filter((el: any) => {
          const ex = (el.x as number) ?? 0;
          const ey = (el.y as number) ?? 0;
          const ew = (el.width as number) ?? 0;
          const eh = (el.height as number) ?? 0;
          return !(
            ex + ew < region.x ||
            ex > region.x + region.width ||
            ey + eh < region.y ||
            ey > region.y + region.height
          );
        });
      } else if (mode === "viewport") {
        const zoom = (appState.zoom?.value as number) ?? 1;
        const sx = -((appState.scrollX as number) ?? 0);
        const sy = -((appState.scrollY as number) ?? 0);
        const vw = ((appState.width as number) ?? 1920) / zoom;
        const vh = ((appState.height as number) ?? 1080) / zoom;
        elements = allElements.filter((el: any) => {
          const ex = (el.x as number) ?? 0;
          const ey = (el.y as number) ?? 0;
          const ew = (el.width as number) ?? 0;
          const eh = (el.height as number) ?? 0;
          return !(
            ex + ew < sx ||
            ex > sx + vw ||
            ey + eh < sy ||
            ey > sy + vh
          );
        });
      }

      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportBackground: true },
        files,
        maxWidthOrHeight: max_dimension,
        mimeType: "image/png",
      });

      // Convert blob to base64 data URL directly (no upload needed --
      // the image is passed inline to the model for visual understanding)
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () =>
          reject(new Error("Failed to convert screenshot to data URL"));
        reader.readAsDataURL(blob);
      });

      const bmp = await createImageBitmap(blob);
      const width = bmp.width;
      const height = bmp.height;
      bmp.close();

      return { url: dataUrl, width, height };
    });

    return cleanup;
  }, [ws, excalidrawApi, canvasId]);

  // Build a full save payload from current Excalidraw state.
  // Used by both beforeunload and unmount to flush pending changes.
  const buildSavePayload = useCallback(() => {
    if (!excalidrawApi) return null;
    // Never flush before hydration — Excalidraw may not have loaded elements yet
    if (!hydratedRef.current) return null;
    try {
      const sceneElements = excalidrawApi.getSceneElements();
      const rawFiles = excalidrawApi.getFiles() as Record<string, any>;
      const appState = excalidrawApi.getAppState();

      // Safety: refuse to save empty when we loaded with elements — prevents
      // race conditions from wiping canvas content during page teardown.
      const liveCount = sceneElements.filter((el: any) => !el.isDeleted).length;
      if (liveCount === 0 && initialElementCountRef.current > 0) {
        console.warn(
          "[canvas-editor] skipping save: 0 elements but loaded with",
          initialElementCountRef.current,
        );
        return null;
      }
      const files: Record<string, Record<string, unknown>> = {};
      for (const [id, file] of Object.entries(rawFiles)) {
        files[id] = {
          id: file.id,
          dataURL: file.dataURL,
          mimeType: file.mimeType,
          created: file.created,
        };
      }
      return {
        elements: sceneElements.filter((el: any) => !el.isDeleted),
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridModeEnabled: appState.gridModeEnabled,
        },
        files,
      };
    } catch (err) {
      console.warn(
        "[canvas-editor] failed to build save payload on flush:",
        err,
      );
      return null;
    }
  }, [excalidrawApi]);

  // Keep buildSavePayload accessible without stale closures
  const buildSavePayloadRef = useRef(buildSavePayload);
  buildSavePayloadRef.current = buildSavePayload;

  const retrySave = useCallback(() => {
    const payload = buildSavePayloadRef.current();
    if (!payload) return;
    pendingSaveRef.current = payload;
    setSaveState("saving");
    const save = async () => {
      const { canvas } = await fetchCanvas(accessTokenRef.current, canvasIdRef.current);
      await saveCanvas(
        accessTokenRef.current,
        canvasIdRef.current,
        mergeCanvasSaveWithRemoteContent(payload, canvas.content),
      );
    };
    saveQueueRef.current = saveQueueRef.current
      .catch((error) => console.warn("[canvas-editor] previous save failed:", error))
      .then(save);
    saveQueueRef.current
      .then(() => {
        if (pendingSaveRef.current === payload) {
          pendingSaveRef.current = null;
          setSaveState("saved");
        }
        clearCanvasRecoveryCopy(canvasIdRef.current);
        setRecoveryCopy(null);
        setRecoveryError(false);
      })
      .catch((error) => {
        if (pendingSaveRef.current === payload) setSaveState("error");
        console.error("[canvas-editor] retry save failed:", error);
        if (writeCanvasRecoveryCopy(canvasIdRef.current, payload)) {
          setRecoveryCopy(readCanvasRecoveryCopy(canvasIdRef.current));
        }
      });
  }, []);

  // Offer the locally persisted copy after a failed save or an interrupted
  // debounce window that could not be flushed before the page closed.
  useEffect(() => {
    const copy = readCanvasRecoveryCopy(canvasId);
    if (copy) {
      setRecoveryCopy(copy);
      setRecoveryError(false);
    }
  }, [canvasId]);

  const restoreRecoveryCopy = useCallback(async () => {
    const copy = readCanvasRecoveryCopy(canvasIdRef.current);
    if (!copy) {
      setRecoveryCopy(null);
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError(false);
    try {
      const { canvas } = await fetchCanvas(accessTokenRef.current, canvasIdRef.current);
      await saveCanvas(
        accessTokenRef.current,
        canvasIdRef.current,
        mergeCanvasSaveWithRemoteContent(copy.content, canvas.content),
      );
      clearCanvasRecoveryCopy(canvasIdRef.current);
      setRecoveryCopy(null);
      // Reload so the editor hydrates from the restored server content.
      window.location.reload();
    } catch (error) {
      console.error("[canvas-editor] restore recovery copy failed:", error);
      setRecoveryError(true);
    } finally {
      setRecoveryBusy(false);
    }
  }, []);

  const discardRecoveryCopy = useCallback(() => {
    clearCanvasRecoveryCopy(canvasIdRef.current);
    setRecoveryCopy(null);
    setRecoveryError(false);
  }, []);

  // Flush pending save on page close (beforeunload) and component unmount
  useEffect(() => {
    const flushBeforeUnload = () => {
      if (!pendingSaveRef.current) return;

      // Build the real payload since pendingSaveRef may hold a placeholder
      const payload = buildSavePayloadRef.current();
      if (!payload) return;

      // Persist locally first: keepalive bodies over 64 KiB are rejected by
      // the browser, and a rejected flush must not silently drop the edits.
      writeCanvasRecoveryCopy(canvasIdRef.current, payload);

      // Use fetch with keepalive to ensure the request survives page teardown.
      // keepalive requests are limited to 64 KiB total in-flight per page; for
      // canvases with very large embedded files this may exceed the limit, but
      // it's the best-effort approach -- sendBeacon has the same constraint.
      const url = `${getServerBaseUrl()}/api/canvases/${canvasIdRef.current}`;
      try {
        fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${accessTokenRef.current}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: payload }),
          keepalive: true,
        });
      } catch {
        // Best-effort -- nothing we can do if it fails during page teardown
      }
      pendingSaveRef.current = null;
    };

    window.addEventListener("beforeunload", flushBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);

      // Cancel pending debounce timers
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (thumbnailTimerRef.current) clearTimeout(thumbnailTimerRef.current);

      // Flush pending save on component unmount (e.g. SPA navigation)
      if (pendingSaveRef.current) {
        const payload = buildSavePayloadRef.current();
        if (payload) {
          saveQueueRef.current = saveQueueRef.current
            .catch((error) => console.warn("[canvas-editor] previous save failed:", error))
            .then(async () => {
              const { canvas } = await fetchCanvas(accessTokenRef.current, canvasIdRef.current);
              await saveCanvas(accessTokenRef.current, canvasIdRef.current, mergeCanvasSaveWithRemoteContent(payload, canvas.content));
            });
          saveQueueRef.current.catch(console.error);
        }
        pendingSaveRef.current = null;
      }
    };
  }, []);

  // Render custom embeddable content for video elements on canvas.
  // Excalidraw calls this for every embeddable element; we intercept video URLs
  // and render an inline player, falling back to default for everything else.
  const renderEmbeddable = useCallback((element: any, _appState: any) => {
    const link = element?.link;
    const isCanvasVideo =
      element?.customData?.isVideo === true ||
      (typeof link === "string" &&
        (isVideoUrl(link) || link.includes("/api/uploads/")));
    if (typeof link === "string" && isCanvasVideo) {
      return (
        <VideoCanvasElement
          src={link}
          width={element.width ?? 640}
          height={element.height ?? 360}
          accessToken={accessTokenRef.current}
          trimStart={Number(element.customData?.trimStart) || 0}
          trimEnd={Number(element.customData?.trimEnd) || undefined}
        />
      );
    }
    // Return null to let Excalidraw handle non-video embeddables with default behavior
    return null;
  }, []);

  // Allow any URL as a valid embeddable so our video links are accepted
  const validateEmbeddable = useCallback(() => true, []);

  const addDroppedImages = useCallback(async (files: File[], clientX: number, clientY: number) => {
    const api = excalidrawApi;
    const root = canvasRootRef.current;
    if (!api || !root) return;
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const origin = viewportPointToScene(
      { clientX, clientY },
      root.getBoundingClientRect(),
      api.getAppState(),
    );
    const additions: Record<string, unknown>[] = [];
    const binaryFiles: Array<{ id: string; dataURL: string; mimeType: string; created: number }> = [];

    for (const [index, file] of imageFiles.slice(0, 12).entries()) {
      const dataURL = await fileToDataUrl(file);
      const dimensions = await readImageDimensions(file);
      const size = scaleToFit(dimensions.width, dimensions.height, 720);
      const fileId = crypto.randomUUID();
      binaryFiles.push({ id: fileId, dataURL, mimeType: file.type || "image/png", created: Date.now() });
      additions.push(createExcalidrawImageElement({
        fileId,
        x: origin.x + index * 28 - size.width / 2,
        y: origin.y + index * 28 - size.height / 2,
        width: size.width,
        height: size.height,
        title: file.name || "拖入图片",
        source: "uploaded",
      }));
    }

    api.addFiles(binaryFiles);
    api.updateScene({
      elements: [...api.getSceneElements(), ...additions],
      captureUpdate: "IMMEDIATELY",
    });
  }, [excalidrawApi]);

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsImageDragActive(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasImageFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsImageDragActive(false);
  }, []);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (!files.some((file) => file.type.startsWith("image/"))) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsImageDragActive(false);
    void addDroppedImages(files, event.clientX, event.clientY).catch((error) => {
      console.error("[canvas] failed to add dropped images:", error);
    });
  }, [addDroppedImages]);

  return (
    <ErrorBoundary
      onError={(err) => console.error("[canvas-editor] render crashed:", err)}
    >
      <div
        ref={canvasRootRef}
        className="h-full w-full relative"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={cancelDeleteGesture}
      >
        <Excalidraw
          langCode={locale}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          initialData={{
            elements: initialElements as any,
            appState: initialContent.appState as any,
            files: inlineFiles as any,
          }}
          onChange={handleChange}
          excalidrawAPI={handleExcalidrawApi}
          renderEmbeddable={renderEmbeddable}
          validateEmbeddable={validateEmbeddable}
        />
        <div className="pointer-events-auto absolute left-1/2 top-3 z-[125] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur" role="status" aria-live="polite">
          <span className={saveState === "error" ? "text-destructive" : saveState === "pending" || saveState === "saving" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
            {canvasSaveStateLabel(saveState)}
          </span>
          {saveState === "error" && <button type="button" onClick={retrySave} className="rounded-full px-2 py-0.5 font-medium text-foreground underline decoration-dotted underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">重试保存</button>}
          {recoveryCopy && (
            <span className="flex items-center gap-2 border-l border-border/60 pl-2">
              <span className="text-amber-700 dark:text-amber-300">
                本地未保存副本{recoveryCopy.savedAt > 0 ? `（${new Date(recoveryCopy.savedAt).toLocaleTimeString()}）` : ""}
              </span>
              <button type="button" onClick={() => void restoreRecoveryCopy()} disabled={recoveryBusy} className="rounded-full px-2 py-0.5 font-medium text-foreground underline decoration-dotted underline-offset-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                {recoveryBusy ? "恢复中…" : "恢复"}
              </button>
              <button type="button" onClick={discardRecoveryCopy} disabled={recoveryBusy} className="rounded-full px-2 py-0.5 text-muted-foreground underline decoration-dotted underline-offset-2 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
                丢弃
              </button>
            </span>
          )}
          {recoveryError && <span className="text-destructive">恢复失败，请重试</span>}
        </div>
        {excalidrawApi && (
          <MemoizedCanvasToolMenu
            accessToken={accessToken}
            excalidrawApi={excalidrawApi}
            leftPanelOpen={leftPanelOpen ?? false}
          />
        )}
        {isImageDragActive && (
          <div className="pointer-events-none absolute inset-4 z-[120] grid place-items-center rounded-[28px] border-2 border-dashed border-primary/60 bg-background/75 backdrop-blur-sm">
            <div className="rounded-2xl border border-border/60 bg-background/95 px-5 py-3 text-center shadow-xl">
              <div className="text-sm font-semibold text-foreground">松开即可添加到画布</div>
              <div className="mt-1 text-xs text-muted-foreground">支持同时拖入最多 12 张图片</div>
            </div>
          </div>
        )}
        {deleteGesture.active && <div className={`pointer-events-none fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded-2xl border px-6 py-4 shadow-2xl transition-colors ${deleteGesture.overTrash ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-background/95 text-foreground"}`}><Trash2 className="mx-auto size-7" /><p className="mt-1 text-xs font-medium">{deleteGesture.overTrash ? "松手删除元素" : "拖到这里删除"}</p></div>}
      </div>
    </ErrorBoundary>
  );
}

function hasImageFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`无法读取图片 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function readImageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}
