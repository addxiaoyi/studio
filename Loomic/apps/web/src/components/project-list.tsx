"use client";

import type { ProjectSource, ProjectSummary } from "@helstera/shared";
import { Plus, Search, Trash2, X } from "lucide-react";
import styles from "./collection-layout.module.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

/**
 * Human-readable label for `projects.source`.
 *
 * A payload without `source` (older server, older cached response) falls back to
 * the same meaning as the database default, so a project never renders an empty
 * or raw English enum in the card.
 */
export function projectSourceLabel(source: ProjectSource | null | undefined): string {
  switch (source) {
    case "home":
      return "首页创建";
    case "import":
      return "导入创建";
    case "manual":
      return "手动创建";
    default:
      return "手动创建";
  }
}

export function ProjectList({
  projects,
  highlightId,
  onCreateClick,
  onDeleted,
}: ProjectListProps) {
  const pathname = usePathname();
  const desktopMode = pathname.startsWith("/desktop-app/");
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
    <div className={styles.collection}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <div className={styles.heading}>
            <h1 className="text-xl font-semibold text-foreground">{copy.title}</h1>
            {desktopMode ? null : <Link href="/projects/archived" className="text-xs text-muted-foreground underline underline-offset-4">回收站</Link>}
          </div>
          <p className={styles.subtitle}>共 {projects.length} 个项目，当前显示 {filtered.length} 个</p>
        </div>
        <div className={styles.headerTools}><button type="button" onClick={onCreateClick} className={styles.create}><Plus size={16} aria-hidden="true" />{copy.create}</button><div className={styles.search}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input aria-label="搜索项目名称或描述" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称" className="h-10 w-full rounded-lg border border-border/60 bg-background pl-9 pr-10 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清除项目搜索" className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>}
        </div></div>
      </div>

      {/* Card grid */}
      <div className={styles.grid}>

        {/* Project cards */}
        {visibleProjects.map((project) => (
          <article
            key={project.id}
            className={`${styles.projectCard}${
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
              className={styles.delete}
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>

            {/* Thumbnail */}
            <Link href={`${desktopMode ? "/desktop-app/canvas" : "/canvas"}?id=${project.primaryCanvas.id}`} aria-label={`打开项目 ${project.name}`} className={styles.projectLink}>
            <ProjectThumbnail
              src={project.thumbnailUrl ?? null}
              alt={`${project.name} 预览`}
              className={styles.projectPreview}
            />

            {/* Info */}
            <div className={styles.projectInfo}>
              <p className={styles.projectName} title={project.name}>
                {project.name}
              </p>
              <div className={styles.projectMeta}>
                <span className={styles.sourceBadge}>
                  {projectSourceLabel(project.source)}
                </span>
                <span>
                  创建 {formatDate(project.createdAt)}
                </span>
              </div>
              <p className={styles.updated}>
                更新 {formatDate(project.updatedAt)}
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
