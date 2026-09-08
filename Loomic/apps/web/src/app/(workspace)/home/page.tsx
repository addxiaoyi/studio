"use client";

import type { ImageGenerationPreference, ProjectSummary, VideoGenerationPreference } from "@helstera/shared";
import type { ReadyAttachment } from "@/hooks/use-image-attachments";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Trash2 } from "lucide-react";
import { HomeDiscoveryGallery } from "@/components/home-discovery-gallery";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { HomeExampleBrowser } from "@/components/home-example-browser";
import { HomePrompt, type HomePromptHandle } from "@/components/home-prompt";
import { LoadingScreen } from "@/components/loading-screen";
import { HelsteraLogo } from "@/components/icons/helstera-logo";
import { HomeProjectsSkeleton } from "@/components/skeletons/home-skeleton";
import { useCreateProject } from "@/hooks/use-create-project";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { useImageAttachments } from "@/hooks/use-image-attachments";
import { useAuth } from "@/lib/auth-context";
import { loadHomeDiscoveryCategories } from "@/lib/home-discovery-library";
import {
  homeDiscoverySeedCategories,
  type HomeDiscoverySelection,
} from "@/lib/home-discovery-seeds";
import { loadHomeExampleCategories } from "@/lib/home-example-library";
import {
  homeExampleSeedCategories,
  type HomeExampleSelection,
} from "@/lib/home-example-seeds";
import { ApiAuthError, fetchProjects } from "@/lib/server-api";
import { formatDate } from "@/lib/utils";

/** Maximum number of recent projects shown on the home page. */
const RECENT_PROJECTS_LIMIT = 4;

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
  const router = useRouter();

  const { create: createNewProject, creating } = useCreateProject();
  const handleDeleted = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject({ onDeleted: handleDeleted });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [homeDiscoveryCategories, setHomeDiscoveryCategories] = useState(
    homeDiscoverySeedCategories,
  );
  const [homeExampleCategories, setHomeExampleCategories] = useState(
    homeExampleSeedCategories,
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
    <div className="flex h-full flex-col items-center overflow-auto px-6 py-12 sm:py-16">
      {/* Workspace stats strip — glass cards */}
      <motion.div
        initial="hidden"
        animate="visible"
        variants={cardStagger}
        className="mb-16 w-full max-w-6xl grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        {[
          { label: "积分余额", value: "1,250" },
          { label: "活跃项目", value: `${projects.length}` },
          { label: "本月生成", value: "47" },
          { label: "团队成员", value: "8" },
        ].map((stat) => (
          <motion.div
            key={stat.label}
            variants={cardItem}
            className="glass-soft rounded-2xl p-5"
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
          <HelsteraLogo className="size-7 text-foreground" />
          <span className="text-base font-medium text-foreground tracking-tight">
            Helstera
          </span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          custom={1}
          className="display-md text-foreground"
        >
          开始今天的 AI 创作
        </motion.h1>
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

        <motion.div variants={fadeUp} custom={4} className="w-full">
          <HomeExampleBrowser
            categories={homeExampleCategories}
            selectedExample={selectedExample}
            onExampleSelect={handleExampleSelect}
          />
        </motion.div>
      </motion.div>

      {/* Recent projects */}
      <div className="mt-20 w-full">
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

        {projectsLoading ? (
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
              className="aspect-[286/208] cursor-pointer rounded-2xl border border-dashed border-border/60 p-3 transition-all duration-300 hover:border-border hover:glass-soft sm:p-3"
            >
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl sm:gap-3">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 14 14"
                  className="h-5 w-5 text-foreground sm:h-6 sm:w-6"
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
              <motion.div
                key={project.id}
                variants={cardItem}
                whileHover={{ y: -4 }}
                className="group relative aspect-[286/208] cursor-pointer rounded-2xl glass-soft p-3 transition-all duration-300 hover:glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() =>
                  router.push(`/canvas?id=${project.primaryCanvas.id}`)
                }
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
                {/* Thumbnail */}
                <div className="aspect-[395/227] w-full overflow-hidden rounded-xl">
                  {project.thumbnailUrl && (
                    <img
                      src={project.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover transition-all duration-300 duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display =
                          "none";
                      }}
                    />
                  )}
                </div>
                {/* Info */}
                <div className="mt-2.5 flex items-center justify-between sm:mt-3">
                  <div className="truncate text-xs text-foreground sm:text-sm font-medium">
                    {project.name}
                  </div>
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
                  {formatDate(project.updatedAt)}
                </div>
              </motion.div>
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
