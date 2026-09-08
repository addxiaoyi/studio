"use client";

import type { BrandKitSummary } from "@helstera/shared";
import { Plus, Trash2 } from "lucide-react";

import { cn } from "../../lib/utils";

interface BrandKitSidebarProps {
  kits: BrandKitSummary[];
  selectedKitId: string | null;
  onSelectKit: (kitId: string) => void;
  onCreateKit: () => void;
  onDeleteKit: (kitId: string) => void;
}

export function BrandKitSidebar({
  kits,
  selectedKitId,
  onSelectKit,
  onCreateKit,
  onDeleteKit,
}: BrandKitSidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-border/30 md:w-[260px] md:border-b-0 md:border-r md:border-border/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <h1 className="text-sm font-medium text-foreground tracking-tight">Brand Kit</h1>
        <span className="ml-1 rounded-full glass-soft border border-border/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Beta
        </span>
      </div>

      {/* Create button */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onCreateKit}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-all duration-300 hover:border-foreground/30 hover:text-foreground cursor-pointer min-h-[44px] sm:min-h-0"
        >
          <Plus className="h-4 w-4" />
          New Kit
        </button>
      </div>

      {/* Kit list -- horizontal scroll on mobile, vertical on desktop */}
      <div className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:flex-1 md:overflow-y-auto md:overflow-x-hidden md:pb-4">
        {kits.map((kit) => {
          const isSelected = kit.id === selectedKitId;
          return (
            <div
              role="button"
              tabIndex={0}
              key={kit.id}
              onClick={() => onSelectKit(kit.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectKit(kit.id);
                }
              }}
              className={cn(
                "group flex min-h-[44px] w-auto shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-foreground/20 focus-visible:outline-none md:w-full md:min-h-0 md:shrink",
                isSelected ? "glass border border-border/40" : "hover:bg-foreground/[0.04]",
              )}
            >
              {/* Thumbnail placeholder */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md glass border border-border/40">
                <span className="text-xs font-medium text-muted-foreground/70">
                  {kit.name.charAt(0).toUpperCase()}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">
                    {kit.name}
                  </span>
                  {kit.is_default && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Default
                    </span>
                  )}
                </div>
              </div>

              {/* Hover delete -- hidden on mobile to save space */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteKit(kit.id);
                }}
                className="hidden shrink-0 rounded p-1 opacity-0 transition-all cursor-pointer hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 md:block"
                aria-label={`Delete ${kit.name}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
