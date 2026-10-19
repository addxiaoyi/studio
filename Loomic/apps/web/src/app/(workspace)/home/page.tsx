"use client";

import type { ImageGenerationPreference, ProjectSummary, VideoGenerationPreference } from "@helstera/shared";
import type { ReadyAttachment } from "@/hooks/use-image-attachments";
import { motion } from "framer-motion";
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
import { TechText } from "@/components/tech-text";
import { HomeWorkspacePulse } from "@/components/home-workspace-pulse";
import { HomeFirstRunGuide } from "@/components/home-first-run-guide";
import { LoadingScreen } from "@/components/loading-screen";
import { HelsteraBrandMark } from "@/components/helstera-brand-mark";
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
// Animation variants
// ---------------------------------------------------------------------------
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const },
  }),
};

const cardStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

const cardItem = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
};

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
  const hasInitialized = useRef(false);

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
      // Silently fail — the section just stays empty.
      setProjectsError(err instanceof Error ? err.message : "Recent projects could not be loaded.");
      console.warn("[home] failed to load recent projects", err);
    } finally {
      setProjectsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    loadProjects();
  }, [loadProjects]);

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
      clearAttachments();
      createNewProject({
        prompt,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(imageGenerationPreference
          ? { imageGenerationPreference }
          : {}),
        ...(videoGenerationPreference
          ? { videoGenerationPreference }
          : {}),
        ...(model ? { model } : {}),
      });
    },
    [createNewProject, clearAttachments],
  );

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
    <div data-home-scroll className="flex h-full flex-col items-center overflow-auto px-4 py-8 sm:px-6 sm:py-10">
      {/* Workspace stats strip — glass cards */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={cardStagger}
        className="mb-12 w-full max-w-6xl grid grid-cols-2 gap-3 sm:mb-14 sm:grid-cols-4 sm:gap-4"
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
          <motion.div
            key={stat.label}
            variants={cardItem}
            className="glass-soft rounded-xl border border-border/40 p-4 sm:p-5"
          >
            <p className="eyebrow">{stat.label}</p>
            <div className="mt-3 text-3xl font-light text-foreground tabular-nums tracking-tight">
              {stat.value}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Hero */}
      <motion.div
        initial="hidden"
        animate="visible"
        className="flex w-full max-w-3xl flex-col items-center text-center"
      >
        {/* Logo + brand name */}
        <motion.div
          variants={fadeUp}
          custom={0}
          className="mb-5 flex items-center gap-2"
        >
          <HelsteraBrandMark size="md" showIcon className="text-foreground" />
        </motion.div>

        <motion.h1
          variants={fadeUp}
          custom={1}
          className="display-md text-foreground"
        ><TechText text="开始今天的 AI 创作" /></motion.h1>
        <motion.p
          variants={fadeUp}
          custom={2}
          className="mt-5 body-relaxed max-w-md"
        >
          描述你的创意，AI 自动遵循团队品牌规范，秒级生成专业设计
        </motion.p>

        {/* Prompt input */}
        <motion.div variants={fadeUp} custom={3} className="w-full">
          <HomePrompt
            ref={promptRef}
            onSubmit={handlePromptSubmit}
            disabled={creating}
            attachments={imageAttachments}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
            isUploading={isUploading}
            readyAttachments={readyAttachments}
            selectedSeed={selectedExample}
            onClearSelectedSeed={handleExampleClear}
          />
        </motion.div>

        <motion.div
          variants={fadeUp}
          custom={4}
          className="mt-4 flex w-full items-start gap-2 border-y border-border/60 py-3 text-left text-xs text-muted-foreground"
        >
          <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            生成的图片与视频将在 30 天后自动清理，请及时下载或在画布中继续编辑。
            <Link href="/assets" className="ml-1 font-medium text-foreground underline-offset-4 hover:underline">
              查看我的资产
            </Link>
          </p>
        </motion.div>

        <motion.div variants={fadeUp} custom={5} className="w-full">
          <HomeExampleBrowser
            categories={homeExampleCategories}
            selectedExample={selectedExample}
            onExampleSelect={handleExampleSelect}
          />
        </motion.div>
      </motion.div>

      <HomeModelPricePreview />

      <HomeFirstRunGuide />

      <HomeWorkspacePulse
        accessToken={session?.access_token}
        projects={projects}
        projectsLoading={projectsLoading}
      />

      <HomeActivityChart
        data={homeOverview}
        rangeDays={overviewRange}
        loading={overviewLoading}
        error={overviewError}
        onRangeChange={setOverviewRange}
        onRetry={() => setOverviewRetry((attempt) => attempt + 1)}
      />

      {/* Recent projects */}
      <div className="mt-4 w-full">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
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
        </motion.div>

        {projectsError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <span>{projectsError}</span>
            <button type="button" onClick={() => void loadProjects()} className="min-h-9 rounded-md border border-destructive/30 px-3 text-xs font-medium hover:bg-destructive/5">Retry</button>
          </div>
        ) : projectsLoading ? (
          <HomeProjectsSkeleton />
        ) : (
          <motion.div
            variants={cardStagger}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          >
            {/* New project card */}
            <motion.button
              variants={cardItem}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.98 }}
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
                <span className="text-xs font-medium text-foreground sm:text-sm">
                  新建项目
                </span>
              </div>
            </motion.button>

            {/* Project cards */}
            {projects.map((project) => (
              <motion.article
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -4 }}
                className="group relative min-h-[180px] rounded-2xl glass-soft p-3 transition-all duration-300 hover:glass sm:min-h-[208px]"
              >
                {/* Trash icon -- hover reveal */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDelete(project.id);
                  }}
                  aria-label={`Delete ${project.name}`}
                  className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-[4px] bg-foreground/70 text-background opacity-0 transition-all duration-300 hover:bg-foreground/80 group-hover:opacity-100 sm:right-5 sm:top-5"
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
              </motion.article>
            ))}
          </motion.div>
        )}
      </div>

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
