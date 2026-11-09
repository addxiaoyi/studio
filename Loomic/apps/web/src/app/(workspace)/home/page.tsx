"use client";

import type { ImageGenerationPreference, ProjectSummary, VideoGenerationPreference } from "@helstera/shared";
import type { ReadyAttachment } from "@/hooks/use-image-attachments";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Clock3, Trash2 } from "lucide-react";
import { HomeDiscoveryGallery } from "@/components/home-discovery-gallery";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { HomeExampleBrowser } from "@/components/home-example-browser";
import { HomePrompt, type HomePromptHandle } from "@/components/home-prompt";
import { HomeModelPricePreview } from "@/components/home-model-price-preview";
import { HomeWorkspacePulse } from "@/components/home-workspace-pulse";
import { HomeFirstRunGuide } from "@/components/home-first-run-guide";
import { LoadingScreen } from "@/components/loading-screen";
import { ProjectThumbnail } from "@/components/project-thumbnail";
import { HomeProjectsSkeleton } from "@/components/skeletons/home-skeleton";
import { useCreateProject } from "@/hooks/use-create-project";
import { useCredits } from "@/hooks/use-credits";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useAuth } from "@/lib/auth-context";
import { loadHomeDiscoveryCategories } from "@/lib/home-discovery-library";
import type { HomeDiscoveryCategory, HomeDiscoverySelection } from "@/lib/home-discovery-seeds";
import { loadHomeExampleCategories, localizeHomeExampleCategories } from "@/lib/home-example-library";
import type { HomeOverview, HomeOverviewRange } from "@/lib/server-api";
import {
  homeExampleSeedCategories,
  type HomeExampleSelection,
} from "@/lib/home-example-seeds";
import {
  ApiAuthError,
  fetchHomeOverview,
  fetchProjects,
} from "@/lib/server-api";
import { formatDate } from "@/lib/utils";

/** Maximum number of recent projects shown on the home page. */
const RECENT_PROJECTS_LIMIT = 4;
const HomeActivityChart = dynamic(
  () => import("@/components/home-activity-chart").then((module) => module.HomeActivityChart),
  { ssr: false },
);

// ---------------------------------------------------------------------------
// Home Page
// ---------------------------------------------------------------------------
export default function HomePage() {
  const { session, signOut } = useAuth();
  const { balance: creditBalance, loading: creditsLoading } = useCredits();
  const router = useRouter();

  const { create: createNewProject, creating } = useCreateProject();
  const handleDeleted = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject({ onDeleted: handleDeleted });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [homeOverview, setHomeOverview] = useState<HomeOverview | null>(null);
  const [overviewRange, setOverviewRange] = useState<HomeOverviewRange>(14);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewRetry, setOverviewRetry] = useState(0);
  const [homeDiscoveryCategories, setHomeDiscoveryCategories] = useState<HomeDiscoveryCategory[]>([]);
  const [homeExampleCategories, setHomeExampleCategories] = useState(
    localizeHomeExampleCategories(homeExampleSeedCategories),
  );
  const [selectedExample, setSelectedExample] =
    useState<HomeExampleSelection | null>(null);

  const promptRef = useRef<HomePromptHandle>(null);
  const [createError, setCreateError] = useState(false);
  const lastPromptSubmitRef = useRef<{
    prompt: string;
    attachments?: ReadyAttachment[];
    imageGenerationPreference?: ImageGenerationPreference;
    videoGenerationPreference?: VideoGenerationPreference;
    model?: string;
  } | null>(null);

  // Ref pattern: avoid token changes cascading through dep arrays
  const accessTokenRef = useRef(session?.access_token);
  accessTokenRef.current = session?.access_token;

  // Image attachments for the home prompt.
  // No projectId yet — uploads go to the general bucket; the project is created on submit.
  const {
    attachments: imageAttachments,
    addFiles,
    removeAttachment,
    clearAll: clearAttachments,
    isUploading,
    readyAttachments,
  } = useImageAttachments(session?.access_token ?? "");
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const routerRef = useRef(router);
  routerRef.current = router;

  const getToken = useCallback(() => accessTokenRef.current, []);

  // -----------------------------------------------------------------------
  // Load recent projects
  // -----------------------------------------------------------------------
  const loadProjects = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const data = await fetchProjects(token);
      setProjects(data.projects.slice(0, RECENT_PROJECTS_LIMIT));
    } catch (err) {
      if (err instanceof ApiAuthError) {
        await signOutRef.current();
        routerRef.current.replace("/login");
        return;
      }
      setProjectsError(err instanceof Error ? err.message : "最近项目读取失败，请重试。");
      console.warn("[home] failed to load recent projects", err);
    } finally {
      setProjectsLoading(false);
    }
  }, [getToken]);

  useEffect(() => { if(session?.access_token) void loadProjects(); }, [loadProjects,session?.access_token]);

  useEffect(() => {
    const selectedPrompt = window.sessionStorage.getItem("helstera_selected_prompt");
    if (!selectedPrompt) return;
    window.sessionStorage.removeItem("helstera_selected_prompt");
    promptRef.current?.fill(selectedPrompt);
  }, []);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setHomeOverview(null);
      setOverviewLoading(false);
      return;
    }

    let cancelled = false;
    setOverviewLoading(true);
    setOverviewError(null);
    void fetchHomeOverview(token, overviewRange)
      .then((overview) => {
        if (!cancelled) setHomeOverview(overview);
      })
      .catch(async (error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiAuthError) {
          await signOutRef.current();
          routerRef.current.replace("/login");
          return;
        }
        setOverviewError(error instanceof Error ? error.message : "趋势数据加载失败");
        console.error("[home] failed to load workspace overview", error);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token, overviewRange, overviewRetry]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;

    void Promise.all([
      loadHomeExampleCategories(),
      loadHomeDiscoveryCategories(),
    ])
      .then(([exampleCategories, discoveryCategories]) => {
        if (cancelled) {
          return;
        }

        setHomeExampleCategories(exampleCategories);
        setHomeDiscoveryCategories(discoveryCategories);
      })
      .catch((error) => {
        console.warn("[home] failed to load home page seed content", error);
      });

    return () => {
      cancelled = true;
    };
  }, [session]);

  // -----------------------------------------------------------------------
  // Prompt submit → create project → navigate to canvas
  // -----------------------------------------------------------------------
  const handlePromptSubmit = useCallback(
    (
      prompt: string,
      attachments?: ReadyAttachment[],
      imageGenerationPreference?: ImageGenerationPreference,
      videoGenerationPreference?: VideoGenerationPreference,
      model?: string,
    ) => {
      setSelectedExample(null);
      setCreateError(false);
      const submitArgs = {
        prompt,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(imageGenerationPreference
          ? { imageGenerationPreference }
          : {}),
        ...(videoGenerationPreference
          ? { videoGenerationPreference }
          : {}),
        ...(model ? { model } : {}),
      };
      lastPromptSubmitRef.current = submitArgs;
      void (async () => {
        const created = await createNewProject(submitArgs);
        if (created) {
          // The project exists now — clear the home-side attachment tray.
          clearAttachments();
          lastPromptSubmitRef.current = null;
          return;
        }
        // Creation failed (network/API/auth): put the prompt back so the
        // user never has to retype what they already wrote.
        setCreateError(true);
        if (prompt) promptRef.current?.fill(prompt);
      })();
    },
    [createNewProject, clearAttachments],
  );

  const retryCreateProject = useCallback(() => {
    const args = lastPromptSubmitRef.current;
    if (!args) return;
    handlePromptSubmit(
      args.prompt,
      args.attachments,
      args.imageGenerationPreference,
      args.videoGenerationPreference,
      args.model,
    );
  }, [handlePromptSubmit]);

  const handleExampleSelect = useCallback((selection: HomeExampleSelection) => {
    setSelectedExample(selection);
    promptRef.current?.fill(selection.prompt);
  }, []);

  const handleExampleClear = useCallback(() => {
    setSelectedExample(null);
  }, []);

  const handleDiscoverySelect = useCallback(
    (selection: HomeDiscoverySelection) => {
      createNewProject({ prompt: selection.prompt });
    },
    [createNewProject],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (creating) {
    return <LoadingScreen />;
  }

  return (
    <div data-home-scroll className="home-workspace flex min-h-full flex-col items-center px-4 py-12 sm:px-6 sm:py-14">
      {/* Hero */}
      <div
        className="flex w-full max-w-3xl flex-col items-center text-center"
      >
        <h1
          className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >开始今天的 AI 创作</h1>
        <p
          className="mt-3 mb-5 max-w-xl text-sm leading-6 text-muted-foreground"
        >
          描述目标，让 AI 在画布中帮你整理资料、生成内容和搭建流程。
        </p>

        {/* Prompt input */}
        <div className="w-full">
          <HomePrompt
            ref={promptRef}
            onSubmit={handlePromptSubmit}
            disabled={creating}
            submitting={creating}
            attachments={imageAttachments}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
            isUploading={isUploading}
            readyAttachments={readyAttachments}
            selectedSeed={selectedExample}
            onClearSelectedSeed={handleExampleClear}
          />
          {createError && (
            <div
              role="alert"
              className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
            >
              <span>项目创建失败，提示词已保留。请重试。</span>
              <button
                type="button"
                onClick={retryCreateProject}
                disabled={creating}
                className="min-h-8 rounded-md border border-destructive/30 px-2.5 py-1 font-medium hover:bg-destructive/10 disabled:opacity-60"
              >
                重试
              </button>
            </div>
          )}
        </div>

        <div
          className="mt-4 flex w-full items-start gap-2 border-y border-border/60 py-3 text-left text-xs text-muted-foreground"
        >
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            云端图片与视频保留 3 天。建议在素材库选择本地文件夹保存，副本只写入你的电脑。
            <Link href="/assets" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
              查看我的资产
            </Link>
          </p>
        </div>

        <div className="w-full">
          <HomeExampleBrowser
            categories={homeExampleCategories}
            selectedExample={selectedExample}
            onExampleSelect={handleExampleSelect}
          />
        </div>
      </div>

      <nav className="home-shortcuts" aria-label="创作快捷入口">
        <button type="button" onClick={()=>void createNewProject()} disabled={creating}><strong>新建画布</strong><span>自由创作与可视化工作流</span></button>
        <a href="/video/"><strong>视频创作</strong><span>对话剪辑、字幕与导出</span></a>
        <Link href="/fashion-gallery/"><strong>女装试穿</strong><span>参考图、人物照片与生成</span></Link>
        <Link href="/assets/"><strong>我的资产</strong><span>继续编辑或保存到本机</span></Link>
      </nav>
      {/* Recent projects */}
      <div className="mt-4 w-full">
        <div
          className="mb-6 flex items-center justify-between"
        >
          <h2 className="text-sm font-medium text-foreground tracking-tight">
            最近项目
          </h2>
          <Link
            href="/projects"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-all duration-300 hover:text-foreground"
          >
            查看全部
            <span className="flex h-6 w-6 -rotate-90 items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 13 8"
                className="h-[6px] w-[10px]"
              >
                <path
                  stroke="currentColor"
                  d="m1 .657 5.657 5.657L12.314.657"
                />
              </svg>
            </span>
          </Link>
        </div>

        {projectsError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>{projectsError}</span>
            <button type="button" onClick={() => void loadProjects()} className="min-h-9 rounded-md border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/5">重新加载</button>
          </div>
        ) : projectsLoading ? (
          <HomeProjectsSkeleton />
        ) : (
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            {/* New project card */}
            <button
              type="button"
              disabled={creating}
              onClick={() => createNewProject()}
              className="min-h-[180px] cursor-pointer rounded-2xl border border-foreground/10 bg-foreground p-3 text-background shadow-sm hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[208px] sm:p-3"
            >
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl sm:gap-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 14 14"
                  className="h-5 w-5 text-background sm:h-6 sm:w-6"
                >
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-xs font-medium text-background sm:text-sm">
                  新建项目
                </span>
              </div>
            </button>

            {/* Project cards */}
            {projects.map((project) => (
              <article
                key={project.id}
                className="group relative min-h-[180px] rounded-2xl glass-soft p-3 transition-all duration-300 hover:glass sm:min-h-[208px]"
              >
                {/* Trash icon -- hover reveal */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDelete(project.id);
                  }}
                  aria-label={`移到回收站 ${project.name}`}
                  className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-[4px] bg-foreground/70 text-background opacity-0 transition-all duration-300 hover:bg-foreground/80 group-hover:opacity-100 focus-visible:opacity-100 sm:right-5 sm:top-5"
                >
                  <Trash2 size={14} />
                </button>
                <Link
                  href={`/canvas?id=${project.primaryCanvas.id}`}
                  aria-label={`打开项目 ${project.name}`}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ProjectThumbnail
                    src={project.thumbnailUrl ?? null}
                    alt={`${project.name} 预览`}
                    className="aspect-[395/227] w-full rounded-xl"
                  />
                  <div className="mt-2.5 flex items-center justify-between gap-3 sm:mt-3">
                    <p className="min-w-0 truncate text-xs font-medium text-foreground sm:text-sm">
                      {project.name}
                    </p>
                    <span className="shrink-0 text-[10px] text-muted-foreground sm:text-[11px]">
                      {formatDate(project.updatedAt)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground sm:text-[11px]">
                    {project.primaryCanvas.name}
                  </p>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Workspace stats strip — glass cards */}
      <div
        className="home-stats"
      >
        {[
          {
            label: "积分余额",
            value: creditsLoading ? "—" : creditBalance.toLocaleString("zh-CN"),
          },
          { label: "活跃项目", value: overviewLoading && !homeOverview ? "--" : `${homeOverview?.activeProjects ?? 0}` },
          {
            label: "本月生成",
            value: overviewLoading && !homeOverview ? "--" : `${homeOverview?.monthlyGenerations ?? 0}`,
          },
          { label: "团队成员", value: overviewLoading && !homeOverview ? "--" : `${homeOverview?.teamMembers ?? 0}` },
        ].map((stat) => (
          <div
            key={stat.label}
            className="home-stat"
          >
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <div className="text-lg font-semibold text-foreground tabular-nums">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <details className="home-secondary"><summary>模型价格与费用说明</summary><HomeModelPricePreview /></details>

      <HomeFirstRunGuide />

      <HomeWorkspacePulse
        accessToken={session?.access_token}
        projects={projects}
        projectsLoading={projectsLoading}
        showProjects={false}
      />

      <details className="home-secondary"><summary>工作区使用趋势</summary><HomeActivityChart
        data={homeOverview}
        rangeDays={overviewRange}
        loading={overviewLoading}
        error={overviewError}
        onRangeChange={setOverviewRange}
        onRetry={() => setOverviewRetry((attempt) => attempt + 1)}
      /></details>

      <HomeDiscoveryGallery
        categories={homeDiscoveryCategories}
        onCaseSelect={handleDiscoverySelect}
      />

      {/* Delete confirmation dialog */}
      <DeleteProjectDialog
        open={pendingId !== null}
        deleting={deleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
