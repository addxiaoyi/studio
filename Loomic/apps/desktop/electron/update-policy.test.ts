import { describe, expect, it } from "vitest";
import { getDesktopUpdatePolicy } from "./update-policy.js";

describe("getDesktopUpdatePolicy", () => {
  it("disables updates for an unpackaged development build", () => {
    expect(getDesktopUpdatePolicy({ isPackaged: false, isPortable: false })).toEqual({
      enabled: false,
      canInstall: false,
      reason: "development build",
    });
  });

  it("disables in-place updates for portable builds", () => {
    expect(getDesktopUpdatePolicy({ isPackaged: true, isPortable: true })).toEqual({
      enabled: false,
      canInstall: false,
      reason: "portable build requires manual update",
    });
  });

  it("does not treat a non-Windows process with the portable marker as portable", () => {
    expect(getDesktopUpdatePolicy({ isPackaged: true, isPortable: true, platform: "darwin" })).toEqual({
      enabled: true,
      canInstall: true,
    });
  });

  it("enables updates for packaged installer builds", () => {
    expect(getDesktopUpdatePolicy({ isPackaged: true, isPortable: false })).toEqual({
      enabled: true,
      canInstall: true,
    });
  });
});
