"use client";

import type { ProjectSummary } from "@helstera/shared";
import { Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectThumbnail } from "./project-thumbnail";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { formatDate } from "@/lib/utils";
import { t, useLocale } from "@/lib/i18n";

interface ProjectListProps {
  projects: ProjectSummary[];
  highlightId?: string | null;
  onCreateClick: () => void;
  onDeleted?: (projectId: string) => void;
}

export function ProjectList({
  projects,
  highlightId,
  onCreateClick,
  onDeleted,
}: ProjectListProps) {
  const copy = t(useLocale()).projects;
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject(onDeleted ? { onDeleted } : undefined);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return projects;
    return projects.filter((project) =>
      [project.name, project.description]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("zh-CN").includes(needle)),
    );
  }, [projects, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleProjects = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
            <Link href="/projects/archived" className="text-xs text-muted-foreground underline underline-offset-4">回收站</Link>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">共 {projects.length} 个项目，当前显示 {filtered.length} 个</p>
        </div>
        <div className="relative block w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="搜索项目名称或描述" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" className="h-10 w-full rounded-lg border border-border/60 bg-background pl-9 pr-10 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清除项目搜索" className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>}
        </div>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* "+ 新建项目" card */}
        <button
          type="button"
          onClick={onCreateClick}
          className="group min-h-[180px] cursor-pointer rounded-2xl border border-dashed border-border/60 p-3 transition-all duration-300 hover:border-foreground/30 hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[208px]"
        >
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 14 14"
              className="size-5 text-muted-foreground transition-all duration-300 group-hover:text-foreground"
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs text-muted-foreground transition-all duration-300 group-hover:text-foreground">
              {copy.create}
            </span>
          </div>
        </button>

        {/* Project cards */}
        {visibleProjects.map((project) => (
          <article
            key={project.id}
            className={`group relative min-h-[180px] rounded-2xl glass-soft p-3 transition-all duration-300 hover:glass sm:min-h-[208px]${
              highlightId === project.id ? " ring-2 ring-ring" : ""
            }`}
          >
            {/* Delete button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                requestDelete(project.id);
              }}
              aria-label={`${copy.delete} ${project.name}`}
              className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-lg border border-border/60 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-all duration-200 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>

            {/* Thumbnail */}
            <Link href={`/canvas?id=${project.primaryCanvas.id}`} aria-label={`打开项目 ${project.name}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ProjectThumbnail
              src={project.thumbnailUrl ?? null}
              alt={`${project.name} 预览`}
              className="aspect-[395/227] w-full rounded-xl border border-border/40"
            />

            {/* Info */}
            <div className="mt-3">
              <p className="truncate text-xs text-foreground leading-tight">
                {project.name}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatDate(project.updatedAt)}
              </p>
            </div>
            </Link>
          </article>
        ))}
      </div>

      {filtered.length === 0 ? <div className="mt-8 rounded-lg border border-dashed border-border/60 p-10 text-center"><p className="text-sm font-medium">{query ? "没有匹配的项目" : "还没有项目"}</p><p className="mt-1 text-xs text-muted-foreground">{query ? "尝试其他关键词，或清除搜索。" : "使用上方新建项目入口，开始创建画布与素材。"}</p>{query ? <button type="button" onClick={() => setQuery("")} className="mt-4 min-h-10 rounded-md border px-3 text-xs font-medium hover:bg-muted">清除搜索</button> : null}</div> : null}

      {pageCount > 1 ? <nav className="mt-6 flex items-center justify-between gap-3" aria-label="项目分页"><button type="button" aria-label="上一页项目" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="min-h-10 rounded-lg border px-3 py-2 text-sm disabled:opacity-40">上一页</button><span className="text-sm text-muted-foreground" aria-live="polite">第 {page} / {pageCount} 页</span><button type="button" aria-label="下一页项目" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-lg border px-3 py-2 text-sm disabled:opacity-40">下一页</button></nav> : null}

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
