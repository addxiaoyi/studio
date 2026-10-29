import { describe, expect, it } from "vitest";
import { buildDesktopMarketplaceInstallUrl } from "@/lib/desktop-marketplace-link";

describe("desktop marketplace install links", () => {
  it("encodes the selected listing slug", () => expect(buildDesktopMarketplaceInstallUrl("postgres-mcp")).toBe("helstera://marketplace/install?slug=postgres-mcp"));
  it("rejects a route traversal slug", () => expect(() => buildDesktopMarketplaceInstallUrl("../settings")).toThrow("市场条目标识无效"));
});
