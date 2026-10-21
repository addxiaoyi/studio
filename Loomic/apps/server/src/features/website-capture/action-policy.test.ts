import { describe, expect, it } from "vitest";

import { classifyWebsiteAction } from "./action-policy.js";

describe("website action policy", () => {
  it("allows navigation and scrolling", () => {
    expect(classifyWebsiteAction({ kind: "navigate", targetUrl: "https://example.com" }).state).toBe("allow");
    expect(classifyWebsiteAction({ kind: "scroll" }).state).toBe("allow");
  });

  it("requires confirmation for side effects and denies credentials", () => {
    expect(classifyWebsiteAction({ kind: "submit", target: "checkout" }).state).toBe("confirm");
    expect(classifyWebsiteAction({ kind: "fill", fieldType: "password" }).state).toBe("deny");
    expect(classifyWebsiteAction({ kind: "click", targetRole: "submit button" }).state).toBe("confirm");
  });
});
