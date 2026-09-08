"use client";

import type { ProjectSummary } from "@helstera/shared";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { useDeleteProject } from "@/hooks/use-delete-project";
import { formatDate } from "@/lib/utils";

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
  const { pendingId, deleting, requestDelete, confirmDelete, cancelDelete } =
    useDeleteProject(onDeleted ? { onDeleted } : undefined);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-sm font-medium text-foreground">项目</h1>
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* "+ 新建项目" card */}
        <button
          type="button"
          onClick={onCreateClick}
          className="group aspect-[286/208] cursor-pointer rounded-2xl border border-dashed border-border/60 p-3 transition-all duration-300 hover:border-foreground/30 hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              新建项目
            </span>
          </div>
        </button>

        {/* Project cards */}
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/canvas?id=${project.primaryCanvas.id}`}
            className={`group relative block aspect-[286/208] rounded-2xl glass-soft p-3 transition-all duration-300 hover:glass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2${
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
              aria-label={`删除项目 ${project.name}`}
              className="absolute right-3 top-3 z-10 flex size-7 items-center justify-center rounded-lg glass text-muted-foreground opacity-0 transition-all duration-200 hover:text-foreground hover:glass-strong group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            >
              <Trash2 size={13} strokeWidth={1.5} />
            </button>

            {/* Thumbnail */}
            <div className="aspect-[395/227] w-full overflow-hidden rounded-xl glass-soft border border-border/40">
              {project.thumbnailUrl && (
                <img
                  src={project.thumbnailUrl}
                  alt={project.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
            </div>

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
        ))}
      </div>

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
