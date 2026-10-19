"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";

import type { ImageArtifact, VideoArtifact } from "@helstera/shared";
import type { CanvasImageItem } from "../../components/canvas-image-picker";
import type { CanvasSelectedElement } from "../../components/canvas-editor";
import { LoadingScreen } from "../../components/loading-screen";
import { useAuth } from "../../lib/auth-context";
import { useWebSocket } from "../../hooks/use-websocket";
import { useJobFallbackPolling } from "../../hooks/use-job-fallback-polling";
import { CanvasEditor } from "../../components/canvas-editor";
import { ChatSidebar } from "../../components/chat-sidebar";
import { CanvasEmptyHint } from "../../components/canvas-empty-hint";
import { CanvasLogoMenu } from "../../components/canvas-logo-menu";
import { EditableProjectName } from "../../components/editable-project-name";
import { createExcalidrawImageElement, insertImageOnCanvas, insertVideoOnCanvas } from "../../lib/canvas-elements";
import { getServerBaseUrl } from "../../lib/env";
import { deleteEmptyProject, fetchCanvas, fetchProject, fetchWorkspaceSettings, ApiAuthError } from "../../lib/server-api";
import { BrandKitSelector } from "../../components/brand-kit-selector";
import { CanvasBottomBar } from "../../components/canvas-bottom-bar";
import { CanvasFilesPanel } from "../../components/canvas-files-panel";
import { CanvasLayersPanel } from "../../components/canvas-layers-panel";
import { CanvasTimelinePanel } from "../../components/canvas-timeline-panel";
import { CreditHeaderButton } from "../../components/credits/credit-header-button";

function isBlankCanvasContent(content: {
  elements: Record<string, unknown>[];
  files: Record<string, Record<string, unknown>>;
}) {
  const hasVisibleElement = content.elements.some((element) => element.isDeleted !== true);
  return !hasVisibleElement && Object.keys(content.files).length === 0;
}

function CanvasPageContent() {
  const searchParams = useSearchParams();
  const canvasId = searchParams.get("id");
  const assetId = searchParams.get("assetId");
  const assetMediaType = searchParams.get("mediaType");
  const initialSessionId = searchParams.get("session") ?? undefined;
  // Capture prompt once — router.replace will strip it from URL, but the
  // value must survive for the auto-send effect in ChatSidebar.
  const [initialPrompt] = useState(() => searchParams.get("prompt") ?? undefined);
  const { user, session, loading: authLoading, signOut } = useAuth();
  const router = useRouter();

  const [canvasData, setCanvasData] = useState<{
    id: string;
    name: string;
    projectId: string;
    content: {
      elements: Record<string, unknown>[];
      appState: Record<string, unknown>;
      files: Record<string, Record<string, unknown>>;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  // Default chat open on desktop, closed on mobile/tablet to avoid blocking canvas
  const [chatOpen, setChatOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 1024;
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [autoDeleteEmptyCanvas, setAutoDeleteEmptyCanvas] = useState(false);
  const [selectedCanvasElements, setSelectedCanvasElements] = useState<CanvasSelectedElement[]>([]);
  const openedAssetRef = useRef<string | null>(null);
  const canvasContentRef = useRef(canvasData?.content);
  canvasContentRef.current = canvasData?.content;
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = canvasData?.projectId ?? null;
  const autoDeleteEmptyCanvasRef = useRef(false);
  autoDeleteEmptyCanvasRef.current = autoDeleteEmptyCanvas;
  const emptyCleanupTimerRef = useRef<number | null>(null);

  const excalidrawApiRef = useRef<any>(null);
  const [excalidrawApi, setExcalidrawApi] = useState<any>(null);

  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const routerRef = useRef(router);
  routerRef.current = router;

  // Stable callbacks for panel toggles to prevent re-renders of child components
  const handleOpenChat = useCallback(() => setChatOpen(true), []);
  const handleToggleChat = useCallback(() => setChatOpen((v) => !v), []);
  const handleToggleLayers = useCallback(() => { setLayersOpen((v) => !v); setFilesOpen(false); }, []);
  const handleToggleFiles = useCallback(() => { setFilesOpen((v) => !v); setLayersOpen(false); }, []);
  const handleCloseLayers = useCallback(() => setLayersOpen(false), []);
  const handleCloseFiles = useCallback(() => setFilesOpen(false), []);
  const handleToggleTimeline = useCallback(() => setTimelineOpen((value) => !value), []);
  const handleClearSelection = useCallback(() => {
    excalidrawApiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
  }, []);
  const handleDeleteSelection = useCallback(() => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    const selectedIds = new Set(Object.keys(api.getAppState().selectedElementIds ?? {}));
    if (selectedIds.size === 0) return;
    api.updateScene({
      elements: api.getSceneElements().map((element: any) => selectedIds.has(element.id) ? { ...element, isDeleted: true } : element),
      appState: { selectedElementIds: {} },
      captureUpdate: "IMMEDIATELY",
    });
  }, []);

  const accessToken = session?.access_token;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const getToken = useCallback(() => accessTokenRef.current ?? null, []);
  const ws = useWebSocket(getToken);

  useEffect(() => {
    if (!accessToken) return;
    void fetchWorkspaceSettings(accessToken)
      .then(({ settings }) => setAutoDeleteEmptyCanvas(settings.autoDeleteEmptyCanvas))
      .catch((cause) => console.warn("[canvas] failed to load empty-canvas setting:", cause));
  }, [accessToken]);

  useEffect(() => {
    if (emptyCleanupTimerRef.current !== null) {
      window.clearTimeout(emptyCleanupTimerRef.current);
      emptyCleanupTimerRef.current = null;
    }

    return () => {
      if (!autoDeleteEmptyCanvasRef.current || !projectIdRef.current) return;
      emptyCleanupTimerRef.current = window.setTimeout(() => {
        const content = canvasContentRef.current;
        const token = accessTokenRef.current;
        if (!token || !content || !isBlankCanvasContent(content)) return;
        void deleteEmptyProject(token, projectIdRef.current!).catch((cause) =>
          console.warn("[canvas] failed to clean up empty project:", cause),
        );
        emptyCleanupTimerRef.current = null;
      }, 2000);
    };
  }, []);

  const handleApiReady = useCallback((api: any) => {
    excalidrawApiRef.current = api;
    setExcalidrawApi(api);
  }, []);

  useEffect(() => {
    if (!assetId || !excalidrawApi || !accessToken || openedAssetRef.current === assetId) return;
    openedAssetRef.current = assetId;
    let cancelled = false;
    void fetch(`${getServerBaseUrl()}/api/uploads/${encodeURIComponent(assetId)}/file`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`资产加载失败（${response.status}）`);
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("资产读取失败"));
        reader.readAsDataURL(blob);
      });
      if (cancelled) return;
      if (assetMediaType === "video") {
        await insertVideoOnCanvas(excalidrawApi, {
          type: "video",
          url: `${getServerBaseUrl()}/api/uploads/${encodeURIComponent(assetId)}/file`,
          mimeType: blob.type || "video/mp4",
          width: 800,
          height: 450,
          durationSeconds: 0,
          title: "资产视频",
        });
        return;
      }
      const fileId = crypto.randomUUID();
      const image = await createImageBitmap(blob);
      const maxSize = 900;
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      excalidrawApi.addFiles([{ id: fileId, dataURL: dataUrl, mimeType: blob.type || "image/png", created: Date.now() }]);
      excalidrawApi.updateScene({
        elements: [...excalidrawApi.getSceneElements(), createExcalidrawImageElement({ fileId, x: 0, y: 0, width, height, title: "资产图片", source: "uploaded" })],
        captureUpdate: "IMMEDIATELY",
      });
      image.close();
    }).catch((cause) => {
      openedAssetRef.current = null;
      console.error("[canvas] failed to open asset:", cause);
    });
    return () => { cancelled = true; };
  }, [accessToken, assetId, assetMediaType, excalidrawApi]);

  const handleImageGenerated = useCallback((artifact: ImageArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    insertImageOnCanvas(api, artifact).catch((err) => {
      console.warn("Failed to insert image on canvas:", err);
    });
  }, []);

  const handleVideoGenerated = useCallback(async (artifact: VideoArtifact) => {
    const api = excalidrawApiRef.current;
    if (!api) throw new Error("画布尚未加载完成");
    await insertVideoOnCanvas(api, artifact);
  }, []);

  // Must be defined BEFORE useJobFallbackPolling which references it
  const handleCanvasSync = useCallback(async () => {
    const api = excalidrawApiRef.current;
    const token = accessTokenRef.current;
    if (!api || !token || !canvasData) return;
    try {
      const { canvas } = await fetchCanvas(token, canvasData.id);
      const elements = canvas.content.elements ?? [];
      const files = (canvas.content as Record<string, unknown>).files as
        Record<string, { id: string; dataURL: string; mimeType: string; created: number }> | undefined;

      // Sync files (base64 dataURLs from backend-inserted images) into Excalidraw
      if (files && Object.keys(files).length > 0) {
        api.addFiles(Object.values(files));
      }

      const localElements = api.getSceneElements() as Array<Record<string, unknown>>;
      const localIds = new Set(localElements.map((element) => element.id).filter((id): id is string => typeof id === "string"));
      const remoteElements = elements.filter((element) =>
        typeof element.id === "string"
          && !localIds.has(element.id)
          && element.isDeleted !== true,
      );
      if (remoteElements.length > 0) {
        api.updateScene({ elements: [...localElements, ...remoteElements], captureUpdate: "NEVER" });
      }
    } catch (err) {
      console.warn("Failed to sync canvas:", err);
    }
  }, [canvasData]);

  // Fallback polling for timed-out generation jobs.
  // When the agent's tool times out but the worker eventually succeeds,
  // the backend will have already inserted the element into the canvas.
  // This hook detects completion and triggers a canvas re-fetch.
  const { checkForTimedOutJobs } = useJobFallbackPolling({
    accessTokenRef,
    onJobSucceeded: useCallback((_jobId: string, _jobType: string) => {
      // Element was inserted by backend — just refresh the canvas
      handleCanvasSync();
    }, [handleCanvasSync]),
  });

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      if (!canvasId) return;
      // Update URL: set session param, remove prompt param to prevent re-send on refresh
      routerRef.current.replace(`/canvas?id=${canvasId}&session=${sessionId}`);
    },
    [canvasId],
  );

  const handleRequestCanvasImages = useCallback((): CanvasImageItem[] => {
    const api = excalidrawApiRef.current;
    if (!api) return [];
    const elements: any[] = api.getSceneElements() ?? [];
    const files: Record<string, any> = api.getFiles() ?? {};
    let idx = 0;
    return elements
      .filter((el: any) => el.type === "image" && !el.isDeleted && el.fileId)
      .map((el: any) => {
        idx++;
        const file = files[el.fileId];
        const dataURL = file?.dataURL ?? "";
        const title =
          el.customData?.title ||
          el.customData?.label ||
          `Image ${idx}`;
        return {
          kind: "canvas-image",
          id: el.id,
          name: title,
          thumbnailUrl: dataURL,
          assetId: el.id,
          url: dataURL,
          mimeType: file?.mimeType ?? "image/png",
        };
      });
  }, []);

  // Only re-fetch when canvasId changes or on initial auth resolution.
  // Token refreshes (e.g. tab switch back) should NOT trigger a reload —
  // we depend on user.id (stable string) instead of the user object ref.
  const userId = user?.id;

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      routerRef.current.replace("/login");
      return;
    }
    const token = accessTokenRef.current;
    if (!canvasId || !token) return;

    setPageLoading(true);
    fetchCanvas(token, canvasId)
      .then((data) => {
        const c = data.canvas;
        setCanvasData({
          id: c.id,
          name: c.name,
          projectId: c.projectId,
          content: {
            elements: c.content.elements ?? [],
            appState: c.content.appState ?? {},
            files: (c.content as any).files ?? {},
          },
        });
        setPageLoading(false);
        // Fetch project to get brand_kit_id and name
        fetchProject(token, c.projectId)
          .then((projectData) => {
            setBrandKitId(projectData.project.brand_kit_id);
            setProjectName(projectData.project.name ?? "Untitled");
          })
          .catch((err) => console.warn("Failed to fetch project for brand kit:", err));
      })
      .catch((err) => {
        if (err instanceof ApiAuthError) {
          signOutRef.current().then(() => routerRef.current.replace("/login"));
          return;
        }
        setError("Failed to load canvas.");
        setPageLoading(false);
      });
    // Intentionally omitting accessTokenRef (stable ref) and signOutRef/routerRef
    // (ref wrappers) from deps — only re-run when auth resolves, user changes, or
    // canvasId changes. Token refresh (e.g. tab switch) must NOT trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, userId, canvasId]);

  if (!canvasId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">No canvas ID specified.</p>
      </div>
    );
  }

  if (authLoading || pageLoading) {
    return <LoadingScreen />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!canvasData || !accessToken) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Top-left navigation bar */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5">
        <CanvasLogoMenu
          accessToken={accessToken}
          projectId={canvasData.projectId}
          canvasId={canvasData.id}
          excalidrawApi={excalidrawApi}
        />
        <EditableProjectName
          accessToken={accessToken}
          projectId={canvasData.projectId}
          initialName={projectName}
        />
        <BrandKitSelector
          accessToken={accessToken}
          projectId={canvasData.projectId}
          currentBrandKitId={brandKitId}
          onBrandKitChange={(kitId) => setBrandKitId(kitId)}
        />
      </div>
      {/* Canvas always takes full width; on mobile/tablet, ChatSidebar overlays instead of side-by-side */}
      <div className="flex-1 relative min-w-0 overflow-hidden">
        {/* Credits button — canvas area top-right, NOT chatbar */}
        <div className="absolute top-3 right-3 z-20">
          <CreditHeaderButton />
        </div>
        <CanvasEditor
          canvasId={canvasData.id}
          projectId={canvasData.projectId}
          accessToken={accessToken}
          initialContent={canvasData.content}
          onApiReady={handleApiReady}
          ws={ws}
          leftPanelOpen={layersOpen || filesOpen}
          onSelectionChange={setSelectedCanvasElements}
        />
        <CanvasEmptyHint
          excalidrawApi={excalidrawApi}
          onOpenChat={handleOpenChat}
        />
        <CanvasBottomBar
          excalidrawApi={excalidrawApi}
          layersOpen={layersOpen}
          onToggleLayers={handleToggleLayers}
          filesOpen={filesOpen}
          onToggleFiles={handleToggleFiles}
          timelineOpen={timelineOpen}
          onToggleTimeline={handleToggleTimeline}
          leftPanelOpen={layersOpen || filesOpen}
          selectedCount={selectedCanvasElements.length}
          onClearSelection={handleClearSelection}
          onDeleteSelection={handleDeleteSelection}
        />
        <CanvasTimelinePanel
          excalidrawApi={excalidrawApi}
          open={timelineOpen}
          onClose={() => setTimelineOpen(false)}
          accessToken={accessToken}
          projectId={canvasData.projectId}
        />
        <CanvasLayersPanel
          excalidrawApi={excalidrawApi}
          open={layersOpen}
          onClose={handleCloseLayers}
        />
        <CanvasFilesPanel
          excalidrawApi={excalidrawApi}
          open={filesOpen}
          onClose={handleCloseFiles}
        />
      </div>
      <ChatSidebar
        accessToken={accessToken}
        canvasId={canvasData.id}
        open={chatOpen}
        onToggle={handleToggleChat}
        onImageGenerated={handleImageGenerated}
        onVideoGenerated={handleVideoGenerated}
        onCanvasSync={handleCanvasSync}
        onStreamEvent={checkForTimedOutJobs}
        initialPrompt={initialPrompt}
        initialSessionId={initialSessionId}
        onSessionChange={handleSessionChange}
        onRequestCanvasImages={handleRequestCanvasImages}
        currentBrandKitId={brandKitId}
        ws={ws}
        selectedCanvasElements={selectedCanvasElements}
      />
    </div>
  );
}

export default function CanvasPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <CanvasPageContent />
    </Suspense>
  );
}
