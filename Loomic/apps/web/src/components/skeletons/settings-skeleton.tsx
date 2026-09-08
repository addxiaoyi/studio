import { Skeleton } from "@/components/skeleton";

/** Skeleton placeholder matching the Settings page layout. */
export function SettingsSkeleton() {
  return (
    <div className="px-6 py-8 md:p-8">
      {/* Title */}
      <Skeleton className="mb-8 h-7 w-20" />

      {/* Tab bar */}
      <div className="mb-8 inline-flex gap-1 rounded-full glass-soft border border-border/40 p-1">
        <Skeleton className="h-8 w-16" rounded="full" />
        <Skeleton className="h-8 w-14" rounded="full" />
      </div>

      {/* Form fields */}
      <div className="max-w-xl space-y-6">
        {/* Field 1 */}
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" rounded="full" />
        </div>
        {/* Field 2 */}
        <div className="space-y-2.5">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full" rounded="full" />
        </div>
        {/* Save button */}
        <Skeleton className="h-9 w-20" rounded="full" />
      </div>
    </div>
  );
}
