"use client";

import type { ProjectSummary } from "@helstera/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { ArchivedProjectList } from "@/components/archived-project-list";
import { LoadingScreen } from "@/components/loading-screen";
import { ProjectsSkeleton } from "@/components/skeletons/projects-skeleton";
import { useAuth } from "@/lib/auth-context";
import { ApiAuthError, fetchArchivedProjects } from "@/lib/server-api";
import { useRouter } from "next/navigation";
import { loginPath } from "@/lib/navigation";

export default function ArchivedProjectsPage() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(session?.access_token);
  tokenRef.current = session?.access_token;

  const load = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchArchivedProjects(token);
      setProjects(result.projects);
    } catch (cause) {
      if (cause instanceof ApiAuthError) {
        await signOut();
        router.replace(loginPath("/projects/archived"));
        return;
      }
      setError(cause instanceof Error ? cause.message : "无法加载回收站。");
    } finally {
      setLoading(false);
    }
  }, [router, signOut]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <ProjectsSkeleton />;
  if (error) return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-8 text-sm text-destructive"><span>{error}</span><button type="button" onClick={() => void load()} className="min-h-9 rounded-md border border-destructive/30 px-3 text-xs">重新加载</button></div>;
  if (!session?.access_token) return <LoadingScreen />;

  return (
    <div className="px-4 py-6 sm:px-6 md:p-8">
      <ArchivedProjectList accessToken={session.access_token} projects={projects} onRestored={(projectId) => setProjects((current) => current.filter((project) => project.id !== projectId))} />
    </div>
  );
}
