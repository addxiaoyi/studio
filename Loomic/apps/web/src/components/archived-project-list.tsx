"use client";

import type { ProjectSummary } from "@helstera/shared";
import { ArchiveRestore, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ProjectThumbnail } from "./project-thumbnail";
import { restoreProject } from "@/lib/server-api";
import { formatDate } from "@/lib/utils";

type ArchivedProjectListProps = {
  accessToken: string;
  projects: ProjectSummary[];
  onRestored: (projectId: string) => void;
};

export function ArchivedProjectList({ accessToken, projects, onRestored }: ArchivedProjectListProps) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pageSize = 24;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return projects;
    return projects.filter((project) => [project.name, project.description].filter(Boolean).some((value) => value!.toLocaleLowerCase("zh-CN").includes(needle)));
  }, [projects, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  async function handleRestore(projectId: string) {
    setBusyId(projectId);
    try {
      await restoreProject(accessToken, projectId);
      onRestored(projectId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">回收站</h1>
            <Link href="/projects" className="text-xs text-muted-foreground underline underline-offset-4">返回项目</Link>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">已归档项目可恢复，不会被物理删除。</p>
        </div>
        <label className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">搜索归档项目</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索归档项目" className="h-10 w-full rounded-xl border border-border/60 bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10" />
        </label>
      </header>

      {!visible.length ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
          <ArchiveRestore className="mx-auto size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">回收站为空</p>
          <p className="mt-1 text-xs text-muted-foreground">归档项目会显示在这里。</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((project) => (
            <article key={project.id} className="rounded-2xl border border-border/60 bg-card p-3">
              <ProjectThumbnail src={project.thumbnailUrl ?? null} alt={`${project.name} 预览`} className="aspect-[395/227] w-full rounded-xl" />
              <div className="mt-3 min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">归档于 {formatDate(project.updatedAt)}</p>
              </div>
              <button type="button" onClick={() => void handleRestore(project.id)} disabled={busyId !== null} className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-border/70 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
                <ArchiveRestore className="size-3.5" aria-hidden="true" />
                {busyId === project.id ? "恢复中…" : "恢复项目"}
              </button>
            </article>
          ))}
        </div>
      )}

      {pageCount > 1 ? <nav className="mt-6 flex items-center justify-between gap-3" aria-label="归档项目分页"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">上一页</button><span className="text-sm text-muted-foreground">第 {page} / {pageCount} 页</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">下一页</button></nav> : null}
    </section>
  );
}
