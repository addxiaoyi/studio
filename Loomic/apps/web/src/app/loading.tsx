"use client";

import { Skeleton, SkeletonText } from "@/components/skeleton";

/**
 * Root route loading state — shown while Next.js streams the initial page tree.
 * Generic hero + content skeleton so any top-level page can suspend without
 * a layout flash.
 */
export default function RootLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-6 py-24">
      <div className="w-full max-w-3xl flex flex-col items-center gap-8">
        {/* Hero block */}
        <Skeleton className="h-8 w-44 rounded-full" />
        <div className="w-full max-w-2xl space-y-3 flex flex-col items-center">
          <Skeleton className="h-12 w-3/4" rounded="xl" />
          <Skeleton className="h-12 w-2/3" rounded="xl" />
        </div>
        <SkeletonText lines={2} lastLineWidth="70%" className="w-full max-w-xl" />

        {/* CTA row */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-32" rounded="full" />
          <Skeleton className="h-10 w-32" rounded="full" />
        </div>
      </div>
    </div>
  );
}
