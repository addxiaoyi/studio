import { Skeleton } from "@/components/skeleton";

/** Skeleton placeholder for the recent projects section on the home page. */
export function HomeProjectsSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={className ?? "grid grid-cols-2 gap-4 lg:grid-cols-4"}>
      {/* Project card skeletons */}
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-[14px] border border-border bg-card p-2.5">
          <Skeleton className="aspect-[16/10] w-full" rounded="lg" />
          <div className="mt-3 space-y-1.5">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
