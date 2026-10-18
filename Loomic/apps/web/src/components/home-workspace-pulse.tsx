"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { BackgroundJob } from "@helstera/shared";
import type { ProjectSummary } from "@helstera/shared";
import type { FeedPackageRecord } from "@/lib/server-api";
import { fetchFeedPackages, fetchJobs } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type Props = {
  accessToken: string | undefined;
  projects: ProjectSummary[];
  projectsLoading: boolean;
};

type PulseState = {
  packages: FeedPackageRecord[];
  jobs: BackgroundJob[];
};

const activeJobStatuses = new Set(["queued", "running", "sync_pending", "sync_failed"]);
const attentionJobStatuses = new Set(["failed", "dead_letter", "sync_failed"]);

export function HomeWorkspacePulse({ accessToken, projects, projectsLoading }: Props) {
  const [state, setState] = useState<PulseState>({ packages: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [packages, jobResponse] = await Promise.all([
        fetchFeedPackages(accessToken),
        fetchJobs(accessToken),
      ]);
      setState({ packages: packages.slice(0, 4), jobs: jobResponse.jobs.slice(0, 6) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工作状态暂时无法加载");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeJobs = state.jobs.filter((job) => activeJobStatuses.has(job.status));
  const attentionJobs = state.jobs.filter((job) => attentionJobStatuses.has(job.status));
  const hasContent = projects.length > 0 || state.packages.length > 0 || state.jobs.length > 0;

  return (
    <section aria-labelledby="home-workspace-pulse-title" className="my-10 w-full rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">WORKSPACE PULSE</p>
          <h2 id="home-workspace-pulse-title" className="mt-2 text-xl font-medium tracking-tight">继续你的工作</h2>
          <p className="mt-1 text-sm text-muted-foreground">从最近项目、内容包或后台任务继续，不需要重新寻找上下文。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />刷新状态
        </button>
      </header>

      {error && (
        <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="font-medium underline underline-offset-2">重试</button>
        </div>
      )}

      {loading && !hasContent ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3" aria-busy="true">
          {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted/60" />)}
        </div>
      ) : !hasContent ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">还没有可继续的工作</p>
          <p className="mt-1 text-xs text-muted-foreground">从上方输入创意，或先建立一个品牌规范。</p>
          <Link href="/brand-kit" className="mt-4 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">配置品牌资产 <ArrowRight className="size-3.5" /></Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <PulseColumn title="最近项目" href="/projects">
            {projectsLoading ? <LoadingRow /> : projects.slice(0, 3).map((project) => (
              <Link key={project.id} href={`/canvas?id=${project.primaryCanvas.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-xs hover:bg-muted/40">
                <span className="min-w-0 truncate font-medium">{project.name}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              </Link>
            ))}
            {!projectsLoading && projects.length === 0 && <EmptyRow text="暂无项目" />}
          </PulseColumn>

          <PulseColumn title="内容包" href="/feed">
            {state.packages.length ? state.packages.slice(0, 3).map((item) => (
              <Link key={item.id} href={`/feed?packageId=${encodeURIComponent(item.id)}&step=${item.status === "rendering" ? 3 : 2}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-xs hover:bg-muted/40">
                <span className="min-w-0 truncate font-medium">{item.title}</span>
                <StatusBadge status={item.status} />
              </Link>
            )) : <EmptyRow text="暂无内容包" />}
          </PulseColumn>

          <PulseColumn title="后台任务" href="/admin/jobs">
            {activeJobs.length || attentionJobs.length ? [...attentionJobs, ...activeJobs].slice(0, 3).map((job) => (
              <Link key={job.id} href="/assets" className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2.5 text-xs hover:bg-muted/40">
                {attentionJobStatuses.has(job.status) ? <AlertTriangle className="size-3.5 shrink-0 text-amber-600" /> : activeJobStatuses.has(job.status) ? <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-600" /> : <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />}
                <span className="min-w-0 truncate font-medium">{job.stage ?? job.job_type}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{job.progress}%</span>
              </Link>
            )) : <EmptyRow text="暂无待处理任务" />}
          </PulseColumn>
        </div>
      )}
    </section>
  );
}

function PulseColumn({ title, href, children }: { title: string; href: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-border/60 bg-background/50 p-3"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">{title}</h3><Link href={href} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">查看全部</Link></div><div className="space-y-2">{children}</div></div>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { draft: "草稿", structured: "待审", approved: "已批", rendering: "生成中", failed: "失败", ready: "待发布", published: "已发布", analyzed: "已复盘" };
  return <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">{labels[status] ?? status}</span>;
}

function LoadingRow() { return <div className="h-9 animate-pulse rounded-lg bg-muted/60" />; }
function EmptyRow({ text }: { text: string }) { return <p className="px-1 py-3 text-xs text-muted-foreground">{text}</p>; }
