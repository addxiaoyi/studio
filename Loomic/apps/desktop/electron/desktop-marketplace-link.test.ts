import { describe, expect, it } from "vitest";
import { parseMarketplaceInstallSlug } from "./desktop-marketplace-link.js";

describe("desktop marketplace install links", () => {
  it("accepts a single safe MCP slug", () => {
    expect(parseMarketplaceInstallSlug("helstera://marketplace/install?slug=postgres-mcp")).toBe("postgres-mcp");
  });
  it.each([
    "https://example.test/marketplace/install?slug=postgres-mcp",
    "helstera://auth/callback?slug=postgres-mcp",
    "helstera://marketplace/install?slug=postgres-mcp&next=https://example.test",
    "helstera://marketplace/install?slug=../settings",
    "helstera://marketplace/install?slug=postgres-mcp#external",
  ])("rejects an invalid install link: %s", (url) => expect(parseMarketplaceInstallSlug(url)).toBeNull());
});
