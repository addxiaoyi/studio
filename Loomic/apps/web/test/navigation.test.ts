import { describe, expect, it } from "vitest";

import { getSafeRedirect, loginPath } from "../src/lib/navigation";

describe("auth navigation", () => {
  it("keeps internal redirects and rejects external destinations", () => {
    expect(getSafeRedirect("/feed?step=2")).toBe("/feed?step=2");
    expect(getSafeRedirect("https://example.com")).toBe("/home");
    expect(getSafeRedirect("//example.com")).toBe("/home");
    expect(loginPath("/projects")).toBe("/login?redirect=%2Fprojects");
  });
});
