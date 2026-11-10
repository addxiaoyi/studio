import { expect, it, vi } from "vitest";
import { checkManualUpdate } from "./manual-update.js";
import { getDesktopUpdatePolicy } from "./update-policy.js";
it("checks the macOS release channel without offering an unsigned automatic install", async () => {
  const request = vi.fn(async () => Response.json({ platform: "macos-arm64", version: "0.2.27", fileName: "Helstera-0.2.27-macOS-arm64.dmg", sha256: "a".repeat(64) }));
  expect(await checkManualUpdate("0.2.26", "arm64", request)).toMatchObject({ status: "available", reason: "manual install required", downloadUrl: "https://studio.0st.top/downloads/Helstera-0.2.27-macOS-arm64.dmg" });
  expect((await checkManualUpdate("0.2.27", "arm64", request)).status).toBe("not-available");
  expect(getDesktopUpdatePolicy({ isPackaged: true, isPortable: false, manualInstall: true })).toMatchObject({ enabled: true, canInstall: false });
  await expect(checkManualUpdate("0.2.26", "x64", request)).rejects.toThrow("更新清单无效");
});
