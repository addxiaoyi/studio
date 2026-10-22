import { afterEach, describe, expect, it, vi } from "vitest";

import { requestLocalCode } from "@/lib/local-auth";

describe("local authentication network failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a useful connection message instead of the browser fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(requestLocalCode("sample@example.invalid")).rejects.toThrow(
      "无法连接登录服务，请检查网络或代理后重试；也可以切换到密码登录。",
    );
  });
});
