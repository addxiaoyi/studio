import { describe, expect, it, vi } from "vitest";
import { checkDesktopUpdate, installDesktopUpdate } from "./update-actions.js";
import type { DesktopUpdatePolicy } from "./update-policy.js";

const portable: DesktopUpdatePolicy = {
  enabled: false,
  canInstall: false,
  reason: "portable build requires manual update",
};
const installer: DesktopUpdatePolicy = { enabled: true, canInstall: true };

describe("desktop update actions", () => {
  it("does not check for updates in portable builds", async () => {
    const check = vi.fn(async () => undefined);
    const state = { status: "not-available" };
    await checkDesktopUpdate(portable, state, check, false);
    expect(check).not.toHaveBeenCalled();
  });

  it("does not install a portable update even when state is downloaded", () => {
    const quitAndInstall = vi.fn();
    expect(installDesktopUpdate(portable, { status: "downloaded" }, quitAndInstall)).toEqual({ ok: false });
    expect(quitAndInstall).not.toHaveBeenCalled();
  });

  it("installs a downloaded installer update", () => {
    const quitAndInstall = vi.fn();
    expect(installDesktopUpdate(installer, { status: "downloaded" }, quitAndInstall)).toEqual({ ok: true });
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });
});
