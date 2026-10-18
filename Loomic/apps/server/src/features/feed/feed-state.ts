export const feedPackageStatuses = [
  "draft", "structured", "approved", "rendering", "failed", "ready",
  "scheduled", "exported", "published", "measured", "analyzed",
] as const;

export type FeedPackageStatus = (typeof feedPackageStatuses)[number];
export type FeedPackageAction = "structure_approved" | "render_started" | "render_ready" | "exported" | "scheduled" | "published" | "measured" | "analyzed" | "failed";

const transitions: Record<FeedPackageAction, ReadonlySet<FeedPackageStatus>> = {
  structure_approved: new Set(["draft", "structured", "failed"]),
  render_started: new Set(["structured", "approved", "failed"]),
  render_ready: new Set(["rendering"]),
  exported: new Set(["ready", "exported"]),
  scheduled: new Set(["ready", "exported", "scheduled"]),
  published: new Set(["scheduled", "exported", "published"]),
  measured: new Set(["published", "measured"]),
  analyzed: new Set(["measured", "analyzed"]),
  failed: new Set(["rendering", "structured", "approved", "failed"]),
};

export function canTransitionFeedPackage(status: string, action: FeedPackageAction): status is FeedPackageStatus {
  return transitions[action].has(status as FeedPackageStatus);
}

export function nextFeedPackageStatus(action: FeedPackageAction): FeedPackageStatus {
  const next: Record<FeedPackageAction, FeedPackageStatus> = {
    structure_approved: "approved",
    render_started: "rendering",
    render_ready: "ready",
    exported: "exported",
    scheduled: "scheduled",
    published: "published",
    measured: "measured",
    analyzed: "analyzed",
    failed: "failed",
  };
  return next[action];
}