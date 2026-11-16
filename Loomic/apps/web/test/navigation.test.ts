import { describe, expect, it } from "vitest";

import { getSafeRedirect, loginPath } from "../src/lib/navigation";

describe("auth navigation", () => {
  it.each([
    "/\\outside.invalid/",
    "/\n/outside.invalid/",
    "/\t/outside.invalid/",
    "/\r/outside.invalid/",
    "/\\user:pass@outside.invalid/",
  ])("rejects browser-normalized external redirect %j", (destination) => {
    const checked = getSafeRedirect(destination);
    expect(new URL(checked, "https://studio.example").origin).toBe(
      "https://studio.example",
    );
    expect(checked).toBe("/home");
  });

  it("keeps the canvas id, session and fragment after normalizing internal paths", () => {
    expect(
      getSafeRedirect("/projects/../canvas/?id=one&session=two#input"),
    ).toBe("/canvas/?id=one&session=two#input");
    expect(getSafeRedirect("/home?help=https%3A%2F%2Foutside.invalid")).toBe(
      "/home?help=https%3A%2F%2Foutside.invalid",
    );
  });
  it("keeps internal redirects and rejects external destinations", () => {
    expect(getSafeRedirect("/feed?step=2")).toBe("/feed?step=2");
    expect(getSafeRedirect("https://example.com")).toBe("/home");
    expect(getSafeRedirect("//example.com")).toBe("/home");
    expect(loginPath("/projects")).toBe("/login?redirect=%2Fprojects");
  });
});
