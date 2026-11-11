import { afterEach, describe, expect, it, vi } from "vitest";

import { registerLocal, requestLocalCode } from "@/lib/local-auth";

describe("local authentication network failures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a useful connection message instead of the browser fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(requestLocalCode("sample@example.invalid")).rejects.toThrow(
      "无法连接登录服务，请检查网络或代理后重试；也可以切换到密码登录。",
    );
  });

  it("includes the email verification code in the registration request", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "test", user: { id: "test-user" } })));
    vi.stubGlobal("fetch", fetch);
    await registerLocal("person@example.test", "test-password", "123456");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/local-auth/register"), expect.objectContaining({
      credentials: "include", body: JSON.stringify({ email: "person@example.test", password: "test-password", code: "123456" }),
    }));
  });
});
