import { describe, expect, it, vi } from "vitest";

import { blockIsolatedWebSocket, buildWebsiteIntroduction, isPublicAddress, validatePublicHttpUrl } from "./isolated-browser.js";

describe("isolated website capture URL policy", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.0.0.8", false],
    ["172.16.0.1", false],
    ["192.168.1.2", false],
    ["169.254.169.254", false],
    ["::1", false],
    ["fc00::1", false],
    ["2001:db8::1", false],
    ["2001::1", false],
    ["2001:20::1", false],
    ["2002:c000:0201::1", false],
    ["3fff::1", false],
    ["64:ff9b::a00:1", false],
    ["::ffff:c0a8:101", false],
    ["192.0.0.9", false],
    ["192.0.2.12", false],
    ["8.8.8.8", true],
    ["2001:4860:4860::8888", true],
  ])("classifies %s as public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it("closes every WebSocket opened by an isolated page", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await blockIsolatedWebSocket({ close } as never);
    expect(close).toHaveBeenCalledWith({ code: 1008, reason: "WebSocket access is disabled in isolated capture." });
  });

  it.each([
    ["file:///etc/passwd", "blocked_protocol"],
    ["http://127.0.0.1/", "private_address_blocked"],
    ["http://user:password@example.com/", "url_credentials_blocked"],
  ])("rejects unsafe URL %s", async (url, code) => {
    await expect(validatePublicHttpUrl(url)).rejects.toMatchObject({ code });
  });
});

describe("website capture introduction", () => {
  it("keeps page URLs as source links and labels the evidence boundary", () => {
    const introduction = buildWebsiteIntroduction("https://example.com", [{
      url: "https://example.com/about",
      title: "About",
      description: "About the company",
      headings: ["Mission"],
      navigation: ["About"],
      assetId: "00000000-0000-0000-0000-000000000001",
      screenshotUrl: "https://studio.test/api/uploads/a/file",
    }]);
    expect(introduction).toContain("https://example.com/about");
    expect(introduction).toContain("未验证页面之外的业务事实");
  });
});
