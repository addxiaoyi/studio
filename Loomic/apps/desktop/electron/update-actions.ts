import type { DesktopUpdatePolicy } from "./update-policy.js";

export type UpdateStateLike = { status: string };

export async function checkDesktopUpdate(
  policy: DesktopUpdatePolicy,
  state: UpdateStateLike,
  checkForUpdates: () => Promise<unknown>,
  updateCheckActive: boolean,
): Promise<UpdateStateLike> {
  if (!policy.enabled || updateCheckActive) return state;
  await checkForUpdates();
  return state;
}

export function installDesktopUpdate(
  policy: DesktopUpdatePolicy,
  state: UpdateStateLike,
  quitAndInstall: () => void,
  busyReason?: string,
): { ok: boolean } {
  if (!policy.canInstall || state.status !== "downloaded") return { ok: false };
  if (busyReason) throw new Error(`${busyReason}。请完成或取消任务后再重启安装，已下载的更新会保留。`);
  quitAndInstall();
  return { ok: true };
}
