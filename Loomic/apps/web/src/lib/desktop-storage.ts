export type DesktopSetupState = { completed: boolean; root: string | null; available: boolean; autoBackup: boolean; agentAccess: boolean; error?: string };
export type CloudBackupState = {
  status: "idle" | "running" | "completed" | "partial" | "canceled" | "failed";
  completed: number; skipped: number; failed: number; current: string; bytes: number; totalBytes: number | null;
  account?: string; error?: string; updatedAt?: string;
  bytesPerSecond?: number; remainingSeconds?: number | null; resumedBytes?: number;
  items: { key: string; name: string; state: "saved" | "failed"; error?: string; receipt?: { path: string; bytes: number; sha256: string; savedAt: string } }[];
};
export type LocalRestorePreview = { id: string; name: string; elements: number; sessions: number; messages: number; localMedia: number; uploadBytes: number; missingMedia: number; fileName: string };
export type LocalRestoreResult = { projectId: string; canvasId: string; sessionId: string | null; restored: boolean };
export type DesktopStorageApi = {
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
};
export function desktopStorage(): DesktopStorageApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { electronAPI?: Partial<DesktopStorageApi> }).electronAPI;
  return api?.getDesktopSetup && api?.runCloudBackup ? api as DesktopStorageApi : null;
}
export function desktopStorageError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : "本地保存失败，请重试。";
}
