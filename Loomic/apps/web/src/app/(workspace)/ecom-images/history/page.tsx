"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { History as HistoryIcon, ArrowRight, ImageIcon, Sparkles, X, Download, RefreshCw } from "lucide-react";

// ── Types ────────────────────────────────────────────────────

interface EcomJobOutput {
  sceneId: string;
  url: string | null;
  error: string | null;
}

interface EcomJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  productName: string;
  productDescription?: string | null;
  sceneCount: number;
  outputCount: number;
  errorMessage: string | null;
  outputs?: EcomJobOutput[];
  ratio?: string | null;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_STYLES: Record<EcomJob["status"], { label: string; class: string }> = {
  pending: {
    label: "排队中",
    class: "glass-soft border border-border/30 text-muted-foreground",
  },
  running: {
    label: "生成中",
    class: "glass border border-primary/30 text-primary",
  },
  completed: {
    label: "已完成",
    class: "glass border border-accent/30 text-accent",
  },
  failed: {
    label: "失败",
    class: "glass-soft border border-destructive/40 text-destructive",
  },
};

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export default function EcomHistoryPage() {
  const { session } = useAuth();
  const [jobs, setJobs] = useState<EcomJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  useEffect(() => {
    setJobs([]);
    setLoading(false);
  }, [session?.access_token]);

  return (
    <section className="min-h-screen bg-background py-10 px-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-12 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <HistoryIcon
              className="size-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="eyebrow">历史记录</span>
          </div>
          <h1 className="display-sm text-foreground">电商图生成历史</h1>
          <p className="mt-3 text-sm text-muted-foreground font-light">
            重新查看、下载、复用过往生成的所有商品图。
          </p>
        </div>

        <Link
          href="/ecom-images"
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium",
            "bg-foreground text-background",
            "transition-all duration-300 hover:scale-[1.02] active:scale-[0.99]",
          )}
        >
          <Sparkles className="size-3.5" strokeWidth={1.5} />
          新建生成
          <ArrowRight className="size-3.5" strokeWidth={1.5} />
        </Link>
      </header>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="glass rounded-2xl p-5 space-y-3">
              <div className="aspect-[4/3] w-full rounded-xl bg-foreground/[0.04] animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-foreground/[0.04] animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-foreground/[0.04] animate-pulse" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="glass-soft border border-destructive/40 rounded-2xl p-8 text-center"
        >
          <p className="text-sm text-destructive font-light">{error}</p>
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="inline-flex rounded-2xl glass-soft border border-border/40 p-5 mb-5">
            <ImageIcon
              className="size-7 text-foreground/50"
              strokeWidth={1.25}
              aria-hidden="true"
            />
          </div>
          <h3 className="text-base font-medium text-foreground">还没有生成任务</h3>
          <p className="mt-2 text-sm text-muted-foreground font-light max-w-sm mx-auto">
            前往电商图生成页，选择场景一键生成你的第一组商品图。
          </p>
          <Link
            href="/ecom-images"
            className="mt-6 inline-flex items-center gap-2 rounded-full glass-soft border border-border/40 px-5 py-2.5 text-sm font-medium hover:glass transition-all duration-300"
          >
            立即开始
            <ArrowRight className="size-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onSelect={() => setSelectedJobId(job.id)}
              />
            ))}
          </div>

          {selectedJobId && (
            <JobDetailModal
              jobId={selectedJobId}
              onClose={() => setSelectedJobId(null)}
              onRegenerate={(job) => {
                // Persist prefilled data so the main page picks it up on mount.
                try {
                  sessionStorage.setItem(
                    "ecom-regenerate-prefill",
                    JSON.stringify({
                      productName: job.productName,
                      productDescription: job.productDescription ?? "",
                      sceneIds: job.outputs
                        ?.map((o) => o.sceneId)
                        .filter((id): id is string => Boolean(id)) ?? [],
                      ratio: job.ratio ?? "1:1",
                    }),
                  );
                } catch {
                  /* sessionStorage may be unavailable in private mode */
                }
                window.location.href = "/ecom-images";
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function JobCard({
  job,
  onSelect,
}: {
  job: EcomJob;
  onSelect: () => void;
}) {
  const status = STATUS_STYLES[job.status];
  const successCount = job.outputs?.filter((o) => o.url).length ?? 0;
  const coverUrl = job.outputs?.find((o) => o.url)?.url ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group glass rounded-2xl overflow-hidden text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
    >
      <div className="aspect-[4/3] w-full bg-foreground/[0.03] flex items-center justify-center relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={job.productName}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <ImageIcon
            className="size-8 text-muted-foreground/30"
            strokeWidth={1.25}
            aria-hidden="true"
          />
        )}
        {job.status === "running" && (
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm flex items-center justify-center">
            <div className="size-6 border-2 border-background border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-foreground truncate">
              {job.productName}
            </h3>
            <p className="text-[11px] text-muted-foreground/70 font-light mt-0.5">
              {formatRelative(job.createdAt)}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
              status.class,
            )}
          >
            {status.label}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/80 font-light">
          <span>{job.sceneCount} 场景</span>
          {successCount > 0 && <span>· 已生成 {successCount} 张</span>}
          {job.status === "failed" && job.errorMessage && (
            <span className="text-destructive truncate">{job.errorMessage}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function JobDetailModal({
  jobId,
  onClose,
  onRegenerate,
}: {
  jobId: string;
  onClose: () => void;
  onRegenerate?: (job: EcomJob) => void;
}) {
  const { session } = useAuth();
  const [job, setJob] = useState<EcomJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    const fetchJob = async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_SERVER_BASE_URL ?? "http://localhost:3001"}/api/ecom/jobs/${jobId}`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store",
          },
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(err.error?.message ?? "加载失败");
        }
        const data = (await res.json()) as { job: EcomJob };
        setJob(data.job);
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知错误");
      } finally {
        setLoading(false);
      }
    };
    void fetchJob();
  }, [jobId, session?.access_token]);

  const successOutputs = job?.outputs?.filter((o) => o.url) ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto glass-strong rounded-3xl border border-border/30 shadow-float">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-8 py-5 glass-strong border-b border-border/20">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-medium text-foreground truncate">
              {job?.productName ?? "任务详情"}
            </h2>
            {job && (
              <p className="text-xs text-muted-foreground font-light">
                {successOutputs.length} 张已生成 ·{" "}
                {STATUS_STYLES[job.status].label}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {successOutputs.length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  setDownloading(true);
                  try {
                    const { default: JSZip } = await import("jszip");
                    const zip = new JSZip();
                    const folder = zip.folder("images");
                    if (folder) {
                      const tasks = successOutputs.map(async (o) => {
                        const r = await fetch(o.url as string);
                        const blob = await r.blob();
                        folder.file(`${o.sceneId}.jpg`, blob);
                      });
                      await Promise.all(tasks);
                      const blob = await zip.generateAsync({ type: "blob" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `helstera-ecom-${Date.now()}.zip`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }
                  } finally {
                    setDownloading(false);
                  }
                }}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3.5 py-1.5 text-xs font-medium transition-all duration-300 hover:scale-[1.02] active:scale-[0.99] disabled:opacity-60"
              >
                {downloading ? (
                  <RefreshCw
                    className="size-3 animate-spin"
                    strokeWidth={1.5}
                  />
                ) : (
                  <Download className="size-3" strokeWidth={1.5} />
                )}
                下载全部
              </button>
            )}
            {job && onRegenerate && (
              <button
                type="button"
                onClick={() => onRegenerate(job)}
                className="inline-flex items-center gap-1.5 rounded-full glass-soft border border-border/40 px-3.5 py-1.5 text-xs font-medium text-foreground hover:glass transition-all duration-300"
              >
                <Sparkles className="size-3" strokeWidth={1.5} />
                再次生成
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-8 items-center justify-center rounded-full glass-soft border border-border/40 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="关闭"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-8">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  className="aspect-[4/3] rounded-2xl bg-foreground/[0.04] animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="glass-soft border border-destructive/40 rounded-2xl p-6 text-center text-sm text-destructive"
            >
              {error}
            </div>
          ) : successOutputs.length === 0 ? (
            <div className="py-16 text-center">
              <ImageIcon
                className="size-10 text-muted-foreground/30 mx-auto mb-3"
                strokeWidth={1.25}
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground font-light">
                该任务还没有生成结果
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {successOutputs.map((o) => (
                <ResultCard
                  key={o.sceneId}
                  sceneId={o.sceneId}
                  url={o.url as string}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ sceneId, url }: { sceneId: string; url: string }) {
  return (
    <div className="group glass rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover">
      <div className="relative aspect-[4/3] bg-foreground/[0.03]">
        <img
          src={url}
          alt={sceneId}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
        <a
          href={url}
          download
          className="absolute inset-0 flex items-center justify-center bg-foreground/0 hover:bg-foreground/40 transition-colors duration-200"
          aria-label={`下载 ${sceneId}`}
        >
          <Download
            className="size-5 text-background opacity-0 group-hover:opacity-100 transition-opacity"
            strokeWidth={1.5}
          />
        </a>
      </div>
      <div className="px-3 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-mono text-muted-foreground/80 truncate">
          {sceneId}
        </span>
        <a
          href={url}
          download
          className="text-[11px] text-primary hover:underline"
        >
          下载
        </a>
      </div>
    </div>
  );
}
