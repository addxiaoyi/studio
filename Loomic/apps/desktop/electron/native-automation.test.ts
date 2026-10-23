import { describe, expect, it } from "vitest";
import { isSensitiveNativeTree, type NativeWindowNode } from "./native-automation.js";

describe("native UI credential filtering", () => {
  it.each(["Password", "One-time code", "OTP", "Verification code", "MFA token"])(
    "blocks screenshots if a sensitive control is present: %s",
    (title) => {
      const tree: NativeWindowNode = {
        role: "window",
        children: [{ role: "edit", title }],
      };
      expect(isSensitiveNativeTree(tree)).toBe(true);
    },
  );

  it("allows ordinary native UI trees", () => {
    expect(isSensitiveNativeTree({ role: "window", children: [{ role: "button", title: "Save" }] })).toBe(false);
  });
});
