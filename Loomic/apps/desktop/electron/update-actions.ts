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
): { ok: boolean } {
  if (!policy.canInstall || state.status !== "downloaded") return { ok: false };
  quitAndInstall();
  return { ok: true };
}
