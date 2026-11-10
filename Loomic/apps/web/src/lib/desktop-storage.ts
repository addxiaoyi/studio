export type DesktopSetupState = { completed: boolean; root: string | null; available: boolean; autoBackup: boolean; agentAccess: boolean; availableBytes?: number; capacityBytes?: number; diskWarning?: "normal" | "low" | "critical"; error?: string };
export type LocalProjectStorage = { id: string; name: string; snapshots: number; snapshotBytes: number; mediaBytes: number };
export type LocalCleanupPlan = { id: string; name: string; projectId: string; snapshots: number; mediaFiles: number; sharedMedia: number; canceledTasks?: number; bytes: number; files: string[] };
export type CloudCopy = { assetId: string; name: string; bytes: number; cloudState: "unknown" | "released" | "pending" };
export type CloudReleasePlan = { id: string; name: string; assetId: string; bytes: number; filename: string };
export type CloudBackupState = {
  status: "idle" | "running" | "completed" | "partial" | "canceled" | "failed";
  completed: number; skipped: number; failed: number; current: string; bytes: number; totalBytes: number | null;
  account?: string; error?: string; updatedAt?: string;
  bytesPerSecond?: number; remainingSeconds?: number | null; resumedBytes?: number;
  items: { key: string; name: string; state: "saved" | "failed"; error?: string; receipt?: { path: string; bytes: number; sha256: string; savedAt: string } }[];
};
export type LocalRestorePreview = { id: string; name: string; elements: number; sessions: number; messages: number; localMedia: number; uploadBytes: number; missingMedia: number; fileName: string; reusedMedia?: number };
export type LocalRestoreResult = { projectId: string; canvasId: string; sessionId: string | null; restored: boolean };
export type LocalSnapshot = { id: string; projectId: string; name: string; fileName: string; savedAt: string; bytes: number; elements: number; sessions: number; messages: number; thumbnail?: string };
export type SnapshotOverview = { media?: Array<{ assetId: string; name: string }>; thumbnail: string; text: string[]; messages: Array<{ role: string; content: string }>; truncated: boolean; name: string; projectId: string; baseline: { id: string; savedAt: string; fileName: string } | null; versions: Array<{ id: string; savedAt: string; fileName: string }>; difference: { elements: { added: number; removed: number; changed: number }; messages: { added: number; removed: number; changed: number }; settingsChanged: boolean; mediaChanged: boolean } | null };
export type RestoreTaskList = { tasks: Array<{ id: string; name: string; status: string; updatedAt: string; uploads: Array<{ uploadId: string }> }>; uploads: Array<{ uploadId: string; filename: string; bytes: number; offset: number; storedBytes: number; expiresAt: string; state: string }> };
export type SnapshotList = { snapshots: LocalSnapshot[]; unreadable: number; truncated: boolean };
export type RestoreProgress = { phase: "uploading" | "restoring" | "completed" | "paused" | "failed"; name: string; bytes: number; totalBytes: number; resumedBytes: number; bytesPerSecond: number; remainingSeconds: number | null };
export type DesktopStorageApi = {
  previewSnapshotMedia?: (id: string, accountId: string, assetId: string) => Promise<{ name: string; mime: string; bytes: number; url: string }>;
  getLocalProjects?: (accountId: string) => Promise<LocalProjectStorage[]>;
  previewLocalCleanup?: (accountId: string, projectId: string) => Promise<LocalCleanupPlan>;
  applyLocalCleanup?: (id: string) => Promise<{ removedFiles: number; removedBytes: number; errors: string[] }>;
  getLocalCloudCopies?: (credentials: { accountId: string; accessToken: string }) => Promise<CloudCopy[]>;
  previewCloudRelease?: (assetId: string, credentials: { accountId: string; accessToken: string }) => Promise<CloudReleasePlan>;
  applyCloudRelease?: (id: string, credentials: { accountId: string; accessToken: string }) => Promise<{ state: "released" | "pending"; bytes: number }>;
  getDesktopSetup: () => Promise<DesktopSetupState>;
  openDesktopSetup: () => Promise<void>;
  openDesktopWorkspaceFolder: () => Promise<void>;
  getCloudBackup: (accountId: string) => Promise<CloudBackupState>;
  runCloudBackup: (input: { accessToken: string; accountId: string }) => Promise<CloudBackupState>;
  saveCloudAsset: (input: { accessToken: string; accountId: string }, asset: { assetId: string; name: string; mediaType: "image" | "video" }) => Promise<CloudBackupState>;
  cancelCloudBackup: () => Promise<void>;
  onCloudBackup: (listener: (state: CloudBackupState) => void) => () => void;
  inspectLocalProject?: (credentials: { accessToken: string; accountId: string }) => Promise<LocalRestorePreview | null>;
  restoreLocalProject?: (id: string, credentials: { accessToken: string; accountId: string }) => Promise<LocalRestoreResult>;
  listLocalSnapshots?: (credentials: { accessToken: string; accountId: string }) => Promise<SnapshotList>;
  getLocalSnapshotOverview?: (id: string, accountId: string, baseline?: string) => Promise<SnapshotOverview>;
  queueLocalSnapshot?: (id: string, accountId: string) => Promise<unknown>;
  openOfflineSnapshots?: () => Promise<void>;
  getRestoreTasks?: (credentials: { accessToken: string; accountId: string }) => Promise<RestoreTaskList>;
  previewRestoreTask?: (id: string, credentials: { accessToken: string; accountId: string }) => Promise<LocalRestorePreview>;
  clearRestoreTask?: (id: string, credentials: { accessToken: string; accountId: string }) => Promise<unknown>;
  previewLocalSnapshot?: (id: string, credentials: { accessToken: string; accountId: string }) => Promise<LocalRestorePreview>;
  cancelProjectRestore?: () => Promise<void>;
  onProjectRestore?: (callback: (state: RestoreProgress) => void) => () => void;
};
export function desktopStorage(): DesktopStorageApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: Partial<DesktopStorageApi> }).electronAPI;
  return api?.getDesktopSetup && api?.runCloudBackup ? api as DesktopStorageApi : null;
}
export function desktopStorageError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "本地保存失败，请重试。";
}
