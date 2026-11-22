import { Skeleton } from "@/components/skeleton";
import styles from "../collection-layout.module.css";

/** Skeleton placeholder matching the ProjectList card grid layout. */
export function ProjectsSkeleton() {
  return (
    <div className={styles.page} role="status" aria-label="正在加载项目">
      {/* Header */}
      <div className={styles.header}>
        <div><Skeleton className="h-8 w-24" /><Skeleton className="mt-3 h-4 w-40" /></div>
        <div className={styles.headerTools}><Skeleton className="h-11 w-28" /><Skeleton className="h-11 w-48" /></div>
      </div>

      {/* Card grid -- matches responsive breakpoints of ProjectList */}
      <div className={styles.grid}>

        {/* Project card skeletons */}
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={styles.projectCard}>
            <Skeleton className="aspect-[16/10] w-full" rounded="xl" />
            <div className="mt-3 space-y-1.5">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
