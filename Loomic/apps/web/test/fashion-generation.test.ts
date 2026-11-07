// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { clearFashionApproval,decodeFashionImage, generateFashion, normalizeFashionResult, pendingFashion, resumeFashion } from "@/lib/fashion-generation";

const api = vi.hoisted(() => ({ uploadFile: vi.fn(), fetchJob: vi.fn(), fetchGenerationApprovalStatus: vi.fn() }));
vi.mock("@/lib/server-api", () => api);
vi.mock("@/lib/env", () => ({ getServerBaseUrl: () => "" }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const png = btoa("\x89PNG\r\n\x1a\n" + "fixture");
const input = { person_image: png, garment_image: png, model: "test-model", size: "1024x1536" };
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => { vi.unstubAllGlobals(); });

it("uses the compressed image signature instead of falsely declaring WebP as PNG", () => {
  const image = decodeFashionImage(btoa("RIFF\x04\x00\x00\x00WEBP"), "garment");
  expect(image.type).toBe("image/webp");
  expect(image.name).toBe("garment.webp");
  expect(() => decodeFashionImage(btoa("not an image"), "person")).toThrow("有效的");
});

it("normalizes legacy backend results without inventing a platform asset or changing the recovered job", () => {
  const output = normalizeFashionResult({ image: png, mimeType: "image/jpeg", model: "personal" });
  expect(output).toMatchObject({ mimeType: "image/png", assetId: "", model: "personal" });
  expect(output.jobId).toMatch(/^external:[a-f0-9-]{36}$/);
  expect(normalizeFashionResult(output)).toEqual(output);
  expect(() => normalizeFashionResult({ image: "invalid" })).toThrow();
});

it("reuses uploaded assets and the request key after a lost creation response", async () => {
  api.uploadFile.mockResolvedValueOnce({ asset: { id: id(1) } }).mockResolvedValueOnce({ asset: { id: id(2) } });
  const fetch = vi.fn().mockRejectedValue(new Error("connection lost"));
  vi.stubGlobal("fetch", fetch);
  const confirm = vi.fn();
  const signal = new AbortController().signal;
  await expect(generateFashion(input, "user", "token", confirm, signal)).rejects.toThrow("connection lost");
  const saved = pendingFashion("user");
  await expect(generateFashion(input, "user", "token", confirm, signal)).rejects.toThrow("connection lost");
  expect(api.uploadFile).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]![1].headers["Idempotency-Key"]).toBe(saved?.key);
  expect(fetch.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(saved?.key);
  expect(confirm).not.toHaveBeenCalled();
});

it("recovers an already confirmed job without creating or confirming another job", async () => {
  localStorage.setItem("loomic:fashion:pending:user", JSON.stringify({ key: id(1), fingerprint: "test", assets: [id(2), id(3)], model: "test-model", approval: { approvalId: id(4), model: "test-model", estimatedCredits: 2, expiresAt: "2030-01-01" } }));
  api.fetchGenerationApprovalStatus.mockResolvedValue({ approvalStatus: "approved", jobId: id(5) });
  api.fetchJob.mockResolvedValue({ job: { status: "failed" } });
  const confirm = vi.fn();
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(resumeFashion("user", "token", confirm, new AbortController().signal)).rejects.toThrow("试穿任务未完成");
  expect(api.fetchJob).toHaveBeenCalledWith("token", id(5), expect.any(AbortSignal));
  expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(api.uploadFile).not.toHaveBeenCalled();
  expect(pendingFashion("user")).toBeNull();
});

it("keeps the original request when the server cannot confirm the job state", async () => {
  localStorage.setItem("loomic:fashion:pending:user", JSON.stringify({ key: id(1), fingerprint: "test", assets: [], model: "test-model", jobId: id(5) }));
  api.fetchJob.mockRejectedValue(new Error("offline"));
  await expect(resumeFashion("user", "token", vi.fn(), new AbortController().signal)).rejects.toThrow("offline");
  expect(pendingFashion("user")?.jobId).toBe(id(5));
});

it("does not auto-confirm rejected or expired approval", async () => {
  localStorage.setItem("loomic:fashion:pending:user", JSON.stringify({ key: id(1), fingerprint: "test", assets: [], model: "test-model", approval: { approvalId: id(4) } }));
  api.fetchGenerationApprovalStatus.mockResolvedValue({ approvalStatus: "expired" });
  const confirm = vi.fn();
  await expect(resumeFashion("user", "token", confirm, new AbortController().signal)).rejects.toThrow("取消或过期");
  expect(confirm).not.toHaveBeenCalled(); expect(api.fetchJob).not.toHaveBeenCalled();
  expect(pendingFashion("user")).toBeNull();
});
it("clears only a rejected quote and never discards a running job",()=>{
  localStorage.setItem("loomic:fashion:pending:user",JSON.stringify({key:id(1),assets:[],model:"test",approval:{approvalId:id(4)}}));
  clearFashionApproval("user",id(9));expect(pendingFashion("user")).not.toBeNull();
  clearFashionApproval("user",id(4));expect(pendingFashion("user")).toBeNull();
  localStorage.setItem("loomic:fashion:pending:user",JSON.stringify({key:id(1),assets:[],model:"test",jobId:id(5),approval:{approvalId:id(4)}}));
  clearFashionApproval("user",id(4));expect(pendingFashion("user")?.jobId).toBe(id(5));
});
it("releases a model preflight rejection so another model can be selected",async()=>{
  api.uploadFile.mockResolvedValueOnce({asset:{id:id(1)}}).mockResolvedValueOnce({asset:{id:id(2)}});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:{code:"no_image_model",message:"所选模型不可用"}},{status:503})));
  await expect(generateFashion(input,"user","token",vi.fn(),new AbortController().signal)).rejects.toThrow("不可用");
  expect(pendingFashion("user")).toBeNull();
});
