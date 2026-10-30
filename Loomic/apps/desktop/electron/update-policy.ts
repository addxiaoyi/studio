export type DesktopUpdatePolicy = {
  enabled: boolean;
  canInstall: boolean;
  reason?: string;
};

/**
 * Portable builds are single-file launch artifacts. electron-updater cannot
 * safely replace the running executable in-place, so they must use manual
 * download/update instructions rather than exposing quitAndInstall().
 */
export function getDesktopUpdatePolicy(input: {
  isPackaged: boolean;
  isPortable: boolean;
}): DesktopUpdatePolicy {
  if (!input.isPackaged) {
    return { enabled: false, canInstall: false, reason: "development build" };
  }
  if (input.isPortable) {
    return { enabled: false, canInstall: false, reason: "portable build requires manual update" };
  }
  return { enabled: true, canInstall: true };
}
