import { fetchLocalSession, signOutLocal } from "@/lib/local-auth";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
it.each([401, 403, 500, 503])(
  "preserves HTTP %i so callers can distinguish session denial from service failure",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("sensitive provider detail", { status }),
        ),
    );
    await expect(fetchLocalSession()).rejects.toMatchObject({
      status,
      message: "无法读取登录状态",
    });
  },
);
it.each([
  {},
  { session: {} },
  { session: { access_token: "", user: { id: "a", email: "a@test" } } },
  { session: { access_token: "a", user: null } },
])("rejects malformed successful session payload %j", async (body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
  await expect(fetchLocalSession()).rejects.toThrow("登录状态响应格式无效");
});
it("accepts a real signed-out answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ session: null })),
  );
  await expect(fetchLocalSession()).resolves.toEqual({ session: null });
});
it("does not report successful logout on a failed HTTP response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("backend detail", { status: 503 })),
  );
  await expect(signOutLocal()).rejects.toThrow("退出登录失败");
});
