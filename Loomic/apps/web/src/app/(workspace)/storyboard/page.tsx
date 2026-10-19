"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ImageIcon,
  LoaderCircle,
  Pencil,
  Save,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { useAuth } from "@/lib/auth-context";
import {
  ApiApplicationError,
  createProject,
  createStoryAsset,
  fetchImageModels,
  fetchStoryAssets,
  fetchStoryboards,
  fetchVideoModels,
  generateImageDirect,
  generateVideoDirect,
  saveStoryboard,
  updateStoryAsset,
  uploadFile,
  type ImageModelInfo,
  type StoryAsset,
  type Storyboard,
  type VideoModelInfo,
} from "@/lib/server-api";

const ASSET_KINDS = [
  ["character", "角色"],
  ["scene", "场景"],
  ["prop", "道具"],
] as const;
const STORYBOARD_PROJECT_KEY = "helstera-storyboard-project-id";
const MAX_REFERENCE_SIZE = 25 * 1024 * 1024;
const REFERENCE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const BOARD_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "草稿", className: "bg-muted text-muted-foreground" },
  generating: {
    label: "生成中",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  ready: {
    label: "已完成",
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "生成失败",
    className: "bg-destructive/10 text-destructive",
  },
};
const DEFAULT_BOARD_STATUS = {
  label: "草稿",
  className: "bg-muted text-muted-foreground",
};
const SHOT_FIELDS = {
  shotSize: ["特写", "近景", "中景", "全景", "远景"],
  cameraAngle: ["平视", "低机位", "高机位", "俯拍", "荷兰角"],
  cameraMove: ["固定", "推镜", "拉镜", "摇镜", "跟拍", "环绕"],
  aspectRatio: ["16:9", "9:16", "1:1", "4:3"],
} as const;

export default function StoryboardPage() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get("projectId") ?? "";
  const { session } = useAuth();
  const [assets, setAssets] = useState<StoryAsset[]>([]);
  const [boards, setBoards] = useState<Storyboard[]>([]);
  const [kind, setKind] = useState<StoryAsset["kind"]>("character");
  const [assetName, setAssetName] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetDraft, setAssetDraft] = useState({ name: "", description: "" });
  const [savingAsset, setSavingAsset] = useState(false);
  const [uploadingReference, setUploadingReference] = useState<string | null>(
    null,
  );
  const [referenceError, setReferenceError] = useState("");
  const [selectedBoard, setSelectedBoard] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [imageModels, setImageModels] = useState<ImageModelInfo[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModelInfo[]>([]);
  const [imageModel, setImageModel] = useState("");
  const [videoModel, setVideoModel] = useState("");
  const [generating, setGenerating] = useState<"image" | "video" | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [generationErrorMode, setGenerationErrorMode] = useState<"image" | "video" | null>(null);
  const [projectError, setProjectError] = useState("");
  const [loadError, setLoadError] = useState("");
  const creatingProjectRef = useRef(false);

  useEffect(() => {
    if (projectId || typeof window === "undefined") return;
    const saved = window.sessionStorage.getItem(STORYBOARD_PROJECT_KEY);
    if (saved)
      router.replace(`/storyboard?projectId=${encodeURIComponent(saved)}`);
  }, [projectId, router]);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setLoading(false);
      return;
    }
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoadError("");
    let active = true;
    void Promise.all([
      fetchStoryAssets(token, projectId),
      fetchStoryboards(token, projectId),
    ])
      .then(([assetData, boardData]) => {
        if (!active) return;
        setAssets(assetData.assets);
        setBoards(boardData.storyboards);
      })
      .catch((error) => {
        if (!active) return;
        if (
          error instanceof ApiApplicationError &&
          error.code === "project_not_found"
        ) {
          window.sessionStorage.removeItem(STORYBOARD_PROJECT_KEY);
          router.replace("/storyboard");
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "分镜数据加载失败，请重试。",
        );
      })
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, router, session?.access_token]);

  const startProject = async () => {
    const token = session?.access_token;
    if (!token || creatingProjectRef.current) return;
    creatingProjectRef.current = true;
    setLoading(true);
    setProjectError("");
    try {
      const requestKey = crypto.randomUUID();
      const { project } = await createProject(
        token,
        { name: "分镜工作台" },
        { idempotencyKey: requestKey },
      );
      window.sessionStorage.setItem(STORYBOARD_PROJECT_KEY, project.id);
      router.replace(`/storyboard?projectId=${encodeURIComponent(project.id)}`);
    } catch (error) {
      creatingProjectRef.current = false;
      setProjectError(
        error instanceof Error ? error.message : "项目创建失败，请重试。",
      );
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    void Promise.all([fetchImageModels(), fetchVideoModels()])
      .then(([images, videos]) => {
        const availableImages = images.models.filter(
          (model) => model.accessible !== false,
        );
        const availableVideos = videos.models.filter(
          (model) => model.accessible !== false,
        );
        setImageModels(availableImages);
        setVideoModels(availableVideos);
        setImageModel(
          availableImages[0]?.id ??
            images.defaultModel ??
            "black-forest-labs/flux-kontext-pro",
        );
        setVideoModel(availableVideos[0]?.id ?? "");
      })
      .catch((error) =>
        console.error("[storyboard] model loading failed", error),
      );
  }, [projectId]);

  const currentBoard = boards[selectedBoard];
  const selectedImage = imageModels.find((model) => model.id === imageModel);
  const selectedVideo = videoModels.find((model) => model.id === videoModel);
  const referenceCount =
    assets.filter((asset) => asset.imageUrl).length +
    (typeof currentBoard?.metadata.referenceImageUrl === "string" ? 1 : 0);
  const imageUnitPrice =
    selectedImage?.providerPriceCny ?? selectedImage?.creditCost;
  const videoSecondPrice =
    selectedVideo?.providerPriceCny ?? selectedVideo?.creditCost;
  const imageEstimate =
    typeof imageUnitPrice === "number" ? imageUnitPrice : null;
  const videoEstimate =
    typeof videoSecondPrice === "number" && currentBoard
      ? videoSecondPrice *
        (typeof currentBoard.metadata.duration === "number"
          ? currentBoard.metadata.duration
          : 5)
      : null;
  const assetCounts = useMemo(
    () =>
      new Map(
        ASSET_KINDS.map(([id]) => [
          id,
          assets.filter((asset) => asset.kind === id).length,
        ]),
      ),
    [assets],
  );

  const addAsset = async () => {
    const token = session?.access_token;
    const name = assetName.trim();
    if (!token || !projectId || !name) return;
    const { asset } = await createStoryAsset(token, projectId, {
      kind,
      name,
      description: assetDescription.trim(),
      imageUrl: null,
    });
    setAssets((current) => [asset, ...current]);
    setAssetName("");
    setAssetDescription("");
  };

  const editAsset = (asset: StoryAsset) => {
    setEditingAssetId(asset.id);
    setAssetDraft({ name: asset.name, description: asset.description });
  };

  const saveAsset = async (asset: StoryAsset) => {
    const token = session?.access_token;
    const name = assetDraft.name.trim();
    if (!token || !projectId || !name || savingAsset) return;
    setSavingAsset(true);
    try {
      const { asset: updated } = await updateStoryAsset(
        token,
        projectId,
        asset.id,
        {
          kind: asset.kind,
          name,
          description: assetDraft.description.trim(),
          imageUrl: asset.imageUrl,
          metadata: asset.metadata,
        },
      );
      setAssets((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingAssetId(null);
    } finally {
      setSavingAsset(false);
    }
  };

  const validateReference = (file: File) => {
    if (!REFERENCE_TYPES.has(file.type))
      return "仅支持 PNG、JPEG、WebP 或 GIF 图片。";
    if (file.size > MAX_REFERENCE_SIZE) return "参考图不能超过 25MB。";
    return "";
  };

  const uploadAssetReference = async (asset: StoryAsset, file: File) => {
    const token = session?.access_token;
    const error = validateReference(file);
    if (!token || !projectId || error) {
      setReferenceError(error);
      return;
    }
    setUploadingReference(asset.id);
    setReferenceError("");
    try {
      const uploaded = await uploadFile(token, file, projectId);
      const { asset: updated } = await updateStoryAsset(
        token,
        projectId,
        asset.id,
        {
          kind: asset.kind,
          name: asset.name,
          description: asset.description,
          imageUrl: uploaded.url,
          metadata: { ...asset.metadata, uploadAssetId: uploaded.asset.id },
        },
      );
      setAssets((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (error) {
      setReferenceError(
        error instanceof Error ? error.message : "参考图上传失败，请重试。",
      );
    } finally {
      setUploadingReference(null);
    }
  };

  const uploadBoardReference = async (file: File) => {
    const token = session?.access_token;
    const error = validateReference(file);
    if (!token || !projectId || !currentBoard || error) {
      setReferenceError(error);
      return;
    }
    setUploadingReference(currentBoard.id);
    setReferenceError("");
    try {
      const uploaded = await uploadFile(token, file, projectId);
      setBoards((current) =>
        current.map((board, index) =>
          index === selectedBoard
            ? {
                ...board,
                metadata: {
                  ...board.metadata,
                  referenceImageUrl: uploaded.url,
                  referenceAssetId: uploaded.asset.id,
                },
              }
            : board,
        ),
      );
    } catch (error) {
      setReferenceError(
        error instanceof Error ? error.message : "分镜参考图上传失败，请重试。",
      );
    } finally {
      setUploadingReference(null);
    }
  };

  const addBoard = () => {
    setBoards((current) => [
      ...current,
      {
        id: `draft-${Date.now()}`,
        projectId,
        sceneNo: current.length + 1,
        title: `分镜 ${current.length + 1}`,
        script: "",
        shotPrompt: "",
        imageAssetId: null,
        videoAssetId: null,
        status: "draft",
        metadata: {},
        createdAt: "",
        updatedAt: "",
      },
    ]);
    setSelectedBoard(boards.length);
  };

  const updateBoard = (
    field: "title" | "script" | "shotPrompt",
    value: string,
  ) =>
    setBoards((current) =>
      current.map((board, index) =>
        index === selectedBoard ? { ...board, [field]: value } : board,
      ),
    );

  const updateBoardMeta = (field: string, value: string | number) =>
    setBoards((current) =>
      current.map((board, index) =>
        index === selectedBoard
          ? { ...board, metadata: { ...board.metadata, [field]: value } }
          : board,
      ),
    );

  const saveCurrentBoard = async () => {
    const token = session?.access_token;
    if (!token || !projectId || !currentBoard) return;
    setSaving(true);
    setSaveError("");
    try {
      const { storyboard } = await saveStoryboard(
        token,
        projectId,
        currentBoard,
      );
      setBoards((current) =>
        current.map((board, index) =>
          index === selectedBoard ? storyboard : board,
        ),
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "分镜保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  const generateBoard = async (mode: "image" | "video") => {
    const token = session?.access_token;
    if (!token || !projectId || !currentBoard || generating) return;
    const basePrompt =
      currentBoard.shotPrompt.trim() ||
      currentBoard.script.trim() ||
      currentBoard.title;
    const shotDetails = [
      currentBoard.metadata.shotSize,
      currentBoard.metadata.cameraAngle,
      currentBoard.metadata.cameraMove,
    ]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
      .join("，");
    const assetContext = assets
      .filter((asset) => asset.description.trim())
      .map((asset) => `${asset.name}：${asset.description}`)
      .join("；");
    const prompt = [
      basePrompt,
      shotDetails && `镜头参数：${shotDetails}`,
      assetContext && `必须保持项目资产一致：${assetContext}`,
    ]
      .filter(Boolean)
      .join("。 ");
    const referenceImages = [
      typeof currentBoard.metadata.referenceImageUrl === "string"
        ? currentBoard.metadata.referenceImageUrl
        : "",
      ...assets.map((asset) => asset.imageUrl ?? ""),
    ]
      .filter(Boolean)
      .slice(0, 3);
    const model = mode === "image" ? imageModel : videoModel;
    if (!model) {
      setGenerationError("没有可用模型，请先在管理中心启用模型。");
      return;
    }
    setGenerating(mode);
    setGenerationError("");
    setGenerationErrorMode(null);
    try {
      if (mode === "image") {
        const image = await generateImageDirect(token, prompt, {
          model,
          aspectRatio:
            typeof currentBoard.metadata.aspectRatio === "string"
              ? currentBoard.metadata.aspectRatio
              : "16:9",
          quality: "hd",
          ...(referenceImages.length ? { inputImages: referenceImages } : {}),
        });
        const { storyboard } = await saveStoryboard(token, projectId, {
          ...currentBoard,
          imageAssetId: image.assetId,
          status: "ready",
        });
        setBoards((current) =>
          current.map((board, index) =>
            index === selectedBoard ? storyboard : board,
          ),
        );
      } else {
        const { storyboard: queued } = await saveStoryboard(token, projectId, {
          ...currentBoard,
          status: "generating",
        });
        setBoards((current) =>
          current.map((board, index) =>
            index === selectedBoard ? queued : board,
          ),
        );
        const video = await generateVideoDirect(token, prompt, {
          model,
          duration:
            typeof currentBoard.metadata.duration === "number"
              ? currentBoard.metadata.duration
              : 5,
          resolution: "720p",
          aspectRatio:
            typeof currentBoard.metadata.aspectRatio === "string"
              ? currentBoard.metadata.aspectRatio
              : "16:9",
          ...(referenceImages.length ? { inputImages: referenceImages } : {}),
        });
        const { storyboard } = await saveStoryboard(token, projectId, {
          ...queued,
          videoAssetId: video.assetId,
          status: "ready",
        });
        setBoards((current) =>
          current.map((board, index) =>
            index === selectedBoard ? storyboard : board,
          ),
        );
      }
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : "生成失败，请稍后重试。",
      );
      setGenerationErrorMode(mode);
      if (mode === "video") {
        void saveStoryboard(token, projectId, {
          ...currentBoard,
          status: "failed",
        })
          .then(({ storyboard }) =>
            setBoards((current) =>
              current.map((board, index) =>
                index === selectedBoard ? storyboard : board,
              ),
            ),
          )
          .catch(() => undefined);
      }
    } finally {
      setGenerating(null);
    }
  };

  if (!projectId) {
    return (
      <main className="flex min-h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">创建分镜项目</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            创建后可管理角色、场景、道具和分镜。仅在你确认后创建，不会因刷新重复生成项目。
          </p>
          {projectError ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {projectError}
            </p>
          ) : null}
          <Button
            type="button"
            className="mt-5 w-full"
            disabled={loading}
            onClick={() => void startProject()}
          >
            {loading ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                创建中…
              </>
            ) : (
              "创建并进入分镜工作台"
            )}
          </Button>
        </div>
      </main>
    );
  }
  if (loading)
    return (
      <div className="p-8 text-sm text-muted-foreground">正在加载创作资产…</div>
    );
  if (loadError)
    return (
      <main className="flex min-h-full items-center justify-center p-8">
        <div className="max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-sm">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            className="mt-4"
            onClick={() => {
              setLoadError("");
              setLoading(true);
              router.refresh();
            }}
          >
            重试
          </Button>
        </div>
      </main>
    );

  return (
    <main className="flex min-h-full flex-col gap-6 p-5 sm:p-8">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Storyboard Studio
        </p>
        <h1 className="mt-2 text-2xl font-semibold">角色、场景与分镜</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          先建立可复用资产，再把每个镜头交给图片和视频生成器。
        </p>
      </header>
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="space-y-5 rounded-2xl border border-border/60 p-4">
          <div>
            <h2 className="text-sm font-medium">项目资产</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {ASSET_KINDS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setKind(id)}
                  aria-pressed={kind === id}
                  className={`rounded-lg border px-3 py-2 text-xs ${kind === id ? "border-foreground/50 bg-foreground/[0.06]" : "border-border/60"}`}
                >
                  {label} {assetCounts.get(id)}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2">
              <label htmlFor="story-asset-name" className="text-xs font-medium text-muted-foreground">资产名称</label>
              <div className="flex gap-2">
              <input
                id="story-asset-name"
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addAsset();
                }}
                placeholder="资产名称"
                className="min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-2.5 text-xs"
              />
              <Button type="button" size="sm" onClick={() => void addAsset()}>
                添加
              </Button>
              </div>
            </div>
            <label htmlFor="story-asset-description" className="mt-2 grid gap-1.5 text-xs font-medium text-muted-foreground">资产描述
            <textarea
              id="story-asset-description"
              value={assetDescription}
              onChange={(event) => setAssetDescription(event.target.value)}
              placeholder={
                kind === "character"
                  ? "外貌、服装、性格与一致性要求"
                  : kind === "scene"
                    ? "地点、时间、光线与氛围"
                    : "材质、颜色、尺寸与关键特征"
              }
              className="mt-2 min-h-20 w-full rounded-lg border border-border/60 bg-background px-2.5 py-2 text-base leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-xs"
            />
            </label>
          </div>
          <div className="space-y-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="rounded-lg border border-transparent bg-foreground/[0.04] px-3 py-2.5 focus-within:border-border"
              >
                {editingAssetId === asset.id ? (
                  <div className="grid gap-2">
                    <input
                      value={assetDraft.name}
                      onChange={(event) =>
                        setAssetDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      aria-label="资产名称"
                      className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <textarea
                      value={assetDraft.description}
                      onChange={(event) =>
                        setAssetDraft((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      aria-label="资产详细描述"
                      placeholder="补充外观、风格和一致性要求"
                      className="min-h-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingAssetId(null)}
                      >
                        <X className="size-3.5" />
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!assetDraft.name.trim() || savingAsset}
                        onClick={() => void saveAsset(asset)}
                      >
                        {savingAsset ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        保存
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {asset.imageUrl ? (
                      <img
                        src={asset.imageUrl}
                        alt={`${asset.name}参考图`}
                        className="aspect-video w-full rounded-md border border-border/60 object-cover"
                      />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">
                          {asset.name}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {ASSET_KINDS.find(([id]) => id === asset.kind)?.[1]}
                        </p>
                        {asset.description ? (
                          <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {asset.description}
                          </p>
                        ) : (
                          <p className="mt-1.5 text-xs text-muted-foreground/70">
                            未填写详细描述
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => editAsset(asset)}
                        aria-label={`编辑${asset.name}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </div>
                    <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background text-xs font-medium hover:bg-muted">
                      {uploadingReference === asset.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Upload className="size-3.5" />
                      )}
                      {asset.imageUrl ? "替换参考图" : "上传参考图"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        disabled={uploadingReference !== null}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadAssetReference(asset, file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
            {!assets.length && (
              <p className="text-xs text-muted-foreground">还没有项目资产。</p>
            )}
            {referenceError ? (
              <p role="alert" className="text-xs leading-5 text-destructive">
                {referenceError}
              </p>
            ) : null}
          </div>
        </aside>
        <section className="rounded-2xl border border-border/60 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">分镜脚本</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                每个分镜可以继续连接图片和视频生成。
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={addBoard}>
                新增分镜
              </Button>
              <Button
                type="button"
                onClick={() => void saveCurrentBoard()}
                disabled={!currentBoard || saving}
              >
                {saving ? "保存中…" : "保存分镜"}
              </Button>
            </div>
          </div>
          {saveError ? (
            <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{saveError}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void saveCurrentBoard()} disabled={saving}>
                重试保存
              </Button>
            </div>
          ) : null}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {boards.map((board, index) => (
              <button
                key={board.id}
                type="button"
                onClick={() => setSelectedBoard(index)}
                aria-current={index === selectedBoard ? "step" : undefined}
                aria-pressed={index === selectedBoard}
                aria-label={`第 ${board.sceneNo} 个分镜：${board.title}${index === selectedBoard ? "，当前" : ""}`}
                className={`shrink-0 rounded-lg border px-3 py-2 text-xs ${index === selectedBoard ? "border-foreground/50 bg-foreground/[0.06]" : "border-border/60"}`}
              >
                #{board.sceneNo} {board.title}
              </button>
            ))}
          </div>
          {currentBoard ? (
            <div className="mt-5 grid gap-4">
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                <span>分镜标题</span>
                <input
                  value={currentBoard.title}
                  onChange={(event) => updateBoard("title", event.target.value)}
                  className="h-10 rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="例如：主角进入雨夜街道"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                <span>镜头脚本</span>
                <textarea
                  value={currentBoard.script}
                  onChange={(event) =>
                    updateBoard("script", event.target.value)
                  }
                  className="min-h-32 rounded-lg border border-border/60 bg-background px-3 py-2 text-base leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                  placeholder="描述人物动作、对白和情节推进…"
                />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                <span>画面与运镜</span>
                <textarea
                  value={currentBoard.shotPrompt}
                  onChange={(event) =>
                    updateBoard("shotPrompt", event.target.value)
                  }
                  className="min-h-28 rounded-lg border border-border/60 bg-background px-3 py-2 text-base leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                  placeholder="描述构图、景别、光线和镜头运动…"
                />
              </label>
              <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                  景别
                  <StyledSelect
                    value={
                      typeof currentBoard.metadata.shotSize === "string"
                        ? currentBoard.metadata.shotSize
                        : ""
                    }
                    onChange={(value) => updateBoardMeta("shotSize", value)}
                    aria-label="景别"
                    options={SHOT_FIELDS.shotSize.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                  机位
                  <StyledSelect
                    value={
                      typeof currentBoard.metadata.cameraAngle === "string"
                        ? currentBoard.metadata.cameraAngle
                        : ""
                    }
                    onChange={(value) => updateBoardMeta("cameraAngle", value)}
                    aria-label="机位"
                    options={SHOT_FIELDS.cameraAngle.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                  镜头运动
                  <StyledSelect
                    value={
                      typeof currentBoard.metadata.cameraMove === "string"
                        ? currentBoard.metadata.cameraMove
                        : ""
                    }
                    onChange={(value) => updateBoardMeta("cameraMove", value)}
                    aria-label="镜头运动"
                    options={SHOT_FIELDS.cameraMove.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                  画幅
                  <StyledSelect
                    value={
                      typeof currentBoard.metadata.aspectRatio === "string"
                        ? currentBoard.metadata.aspectRatio
                        : "16:9"
                    }
                    onChange={(value) => updateBoardMeta("aspectRatio", value)}
                    aria-label="画幅"
                    options={SHOT_FIELDS.aspectRatio.map((value) => ({
                      value,
                      label: value,
                    }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-1">
                  时长（秒）
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={
                      typeof currentBoard.metadata.duration === "number"
                        ? currentBoard.metadata.duration
                        : 5
                    }
                    onChange={(event) =>
                      updateBoardMeta(
                        "duration",
                        Math.min(
                          15,
                          Math.max(1, Number(event.target.value) || 5),
                        ),
                      )
                    }
                    className="h-11 rounded-xl border border-input-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
                  />
                </label>
              </div>
              <div className="rounded-xl border border-dashed border-border/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-medium">当前分镜参考图</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      优先作为首帧与构图参考；最多连同项目资产使用 3 张。
                    </p>
                  </div>
                  <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 text-xs font-medium hover:bg-muted">
                    {uploadingReference === currentBoard.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Upload className="size-3.5" />
                    )}
                    {typeof currentBoard.metadata.referenceImageUrl === "string"
                      ? "替换图片"
                      : "上传图片"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      disabled={uploadingReference !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadBoardReference(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {typeof currentBoard.metadata.referenceImageUrl === "string" ? (
                  <img
                    src={currentBoard.metadata.referenceImageUrl}
                    alt="当前分镜参考图"
                    className="mt-3 max-h-56 w-full rounded-lg border border-border/60 object-contain"
                  />
                ) : null}
              </div>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="border-b border-border/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">生成设置</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        选择模型后生成当前分镜，提示词优先使用“画面与运镜”。
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${BOARD_STATUS[currentBoard.status]?.className ?? DEFAULT_BOARD_STATUS.className}`}
                    >
                      {BOARD_STATUS[currentBoard.status]?.label ??
                        currentBoard.status}
                    </span>
                  </div>
                </div>
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <label className="grid min-w-0 gap-2 text-xs font-medium">
                    <span className="flex items-center gap-2">
                      <ImageIcon className="size-4 text-muted-foreground" />
                      图片模型
                    </span>
                    <StyledSelect
                      value={imageModel}
                      onChange={setImageModel}
                      aria-label="图片模型"
                      options={imageModels.map((model) => ({
                        value: model.id,
                        label: model.displayName,
                        note: `${model.id} · ${model.limits?.maxResolution ?? "标准分辨率"}${model.capabilities?.imageToImage ? " · 支持参考图" : ""}`,
                        badge:
                          model.billingUnit === "per_generation"
                            ? "按次"
                            : undefined,
                      }))}
                    />
                  </label>
                  <label className="grid min-w-0 gap-2 text-xs font-medium">
                    <span className="flex items-center gap-2">
                      <Video className="size-4 text-muted-foreground" />
                      视频模型
                    </span>
                    <StyledSelect
                      value={videoModel}
                      onChange={setVideoModel}
                      aria-label="视频模型"
                      options={videoModels.map((model) => ({
                        value: model.id,
                        label: model.displayName,
                        note: `${model.id} · 最高${model.limits?.maxResolution ?? "标准分辨率"} · 最长${model.limits?.maxDuration ?? "?"}秒${model.capabilities?.imageToVideo ? " · 支持首帧/参考图" : ""}`,
                        badge:
                          model.pricing?.billingUnit === "generated_second"
                            ? "按秒"
                            : undefined,
                      }))}
                    />
                  </label>
                </div>
                <div className="border-t border-border/60 px-4 py-3 text-xs">
                  <p className="font-medium">本次预计费用</p>
                  <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
                    <span>
                      图片：
                      {imageEstimate !== null
                        ? `¥${imageEstimate.toFixed(2)} / 张`
                        : "价格待配置"}
                    </span>
                    <span>
                      视频：
                      {videoEstimate !== null
                        ? `¥${videoSecondPrice!.toFixed(2)} / 秒 × ${typeof currentBoard.metadata.duration === "number" ? currentBoard.metadata.duration : 5} 秒 = ¥${videoEstimate.toFixed(2)}`
                        : "价格待配置"}
                    </span>
                  </div>
                  <p className="mt-2 font-medium text-foreground">
                    预计总计：
                    {imageEstimate !== null && videoEstimate !== null
                      ? `¥${(imageEstimate + videoEstimate).toFixed(2)}`
                      : "提交前将校验最终价格"}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    参考图数量：{referenceCount}{" "}
                    张。若上游按输入图另计，最终扣费以服务端返回为准。
                  </p>
                </div>
                <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                  >
                    {generating === "image"
                      ? "正在生成分镜图，请勿重复提交…"
                      : generating === "video"
                        ? "正在生成视频，完成后会关联到当前分镜…"
                        : "每次只生成当前选中的一个分镜。"}
                  </p>
                  <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-10"
                      onClick={() => void generateBoard("image")}
                      disabled={!imageModel || generating !== null}
                    >
                      {generating === "image" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {generating === "image" ? "生成中…" : "生成分镜图"}
                    </Button>
                    <Button
                      type="button"
                      className="min-h-10"
                      onClick={() => void generateBoard("video")}
                      disabled={!videoModel || generating !== null}
                    >
                      {generating === "video" ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Video className="size-4" />
                      )}
                      {generating === "video" ? "生成中…" : "生成视频"}
                    </Button>
                  </div>
                </div>
              </div>
              {generationError && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  <span>{generationError}</span>
                  {generationErrorMode ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void generateBoard(generationErrorMode)} disabled={generating !== null}>
                      重试生成
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
              新增一个分镜开始。
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
