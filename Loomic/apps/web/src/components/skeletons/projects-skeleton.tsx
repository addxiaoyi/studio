import { Skeleton } from "@/components/skeleton";

/** Skeleton placeholder matching the ProjectList card grid layout. */
export function ProjectsSkeleton() {
  return (
    <div className="px-6 py-8 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <Skeleton className="h-7 w-24" />
      </div>

      {/* Card grid -- matches responsive breakpoints of ProjectList */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {/* "+ 新建项目" placeholder */}
        <div className="aspect-[286/208] rounded-2xl border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2">
          <span className="text-2xl text-foreground/20">+</span>
          <Skeleton className="h-4 w-14" />
        </div>

        {/* Project card skeletons */}
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl glass-soft p-3">
            <Skeleton className="aspect-[395/227] w-full" rounded="xl" />
            <div className="mt-3 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
