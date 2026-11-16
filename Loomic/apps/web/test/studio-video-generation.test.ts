import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  approveStudioVideo, clearStudioVideo, createStudioVideo, inspectStudioVideo, readStudioVideo, resumeStudioVideo, submitStudioVideo,
} from "@/lib/studio-video-generation";
import { ApiApplicationError } from "@/lib/server-api";

const api = vi.hoisted(() => ({ submit: vi.fn(), status: vi.fn(), confirm: vi.fn(), job: vi.fn() }));
vi.mock("@/lib/server-api", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/server-api")>(),
  fetchGenerationApprovalStatus: api.status, confirmGenerationApproval: api.confirm, fetchJob: api.job,
}));
vi.mock("@/lib/studio-material-api",()=>({submitMaterialVideo:api.submit}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = { prompt: "镜头缓慢推进", model: "test-video", duration: 5, resolution: "720p", aspectRatio: "16:9" };
const approval = { approvalId: id(1), model: draft.model, estimatedCredits: 12, expiresAt: "2030-01-01T00:00:00Z" };
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) });
  vi.stubGlobal("crypto", webcrypto);
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("keeps server approval pending across reload without confirming or submitting twice", async () => {
  api.submit.mockRejectedValue(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  api.status.mockResolvedValue({ approvalStatus: "pending" });
  const request = await submitStudioVideo("user", "token", createStudioVideo("user", draft));
  expect(request.approval).toEqual(approval);
  expect(await inspectStudioVideo("token", readStudioVideo("user")!)).toMatchObject({ phase: "approval" });
  await submitStudioVideo("user", "token", readStudioVideo("user")!);
  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.confirm).not.toHaveBeenCalled();
});

it("reuses the same key and parameters when a submission reply is lost", async () => {
  api.submit.mockRejectedValueOnce(new Error("network lost")).mockResolvedValueOnce({ job: { id: id(2) } });
  const request = createStudioVideo("user", draft);
  await expect(submitStudioVideo("user", "token", request)).rejects.toThrow("network lost");
  await submitStudioVideo("user", "token", readStudioVideo("user")!);
  expect(api.submit.mock.calls[0]).toEqual(api.submit.mock.calls[1]);
  expect(readStudioVideo("user")?.jobId).toBe(id(2));
});

it("recovers a lost approval reply by querying the job without approving again", async () => {
  api.submit.mockRejectedValueOnce(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  const request = await submitStudioVideo("user", "token", createStudioVideo("user", draft));
  api.confirm.mockRejectedValueOnce(new Error("reply lost"));
  await expect(approveStudioVideo("user", "token", request)).rejects.toThrow("reply lost");
  api.status.mockResolvedValue({ approvalStatus: "approved", jobId: id(2) });
  api.job.mockResolvedValue({ job: { status: "succeeded", result: { asset_id: id(3), signed_url: "https://untrusted.invalid/" } } });
  expect(await inspectStudioVideo("token", readStudioVideo("user")!)).toMatchObject({ phase: "succeeded", assetId: id(3) });
  expect(api.confirm).toHaveBeenCalledTimes(1);
  expect(api.submit).toHaveBeenCalledTimes(1);
});

it("keeps an in-flight cancellation request running until the provider outcome is known", async () => {
  const request = createStudioVideo("user", draft);
  api.job.mockResolvedValue({ job: {
    status: "running",
    stage: "cancel_requested",
    cancel_requested_at: "2026-11-14T00:00:00.000Z",
  } });

  const state = await inspectStudioVideo("token", { ...request, jobId: id(8) });

  expect(state).toMatchObject({
    phase: "cancel_requested",
    message: "取消请求已提交，正在等待最终结果；积分暂不退款。",
  });
});

it("distinguishes waiting for a credit reservation from active model generation", async () => {
  api.job.mockResolvedValue({ job: { status: "queued", stage: "awaiting_credit_reservation" } });
  expect(await inspectStudioVideo("token", { ...createStudioVideo("user", draft), jobId: id(8) })).toMatchObject({
    phase: "reservation", message: "积分预扣尚未完成，模型尚未启动。可恢复原任务或取消。",
  });
});

it("offers the original failed reservation again without changing its key or submitting a second task", async () => {
  const request = { ...createStudioVideo("user", draft), approval, jobId: id(8) };
  api.job.mockResolvedValue({ job: { status: "queued", stage: "awaiting_credit_reservation", error_code: "credit_reservation_failed" } });
  const state = await inspectStudioVideo("token", request);
  expect(state).toMatchObject({ phase: "reservation", request: { key: request.key, jobId: id(8) } });
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.submit).not.toHaveBeenCalled();
});

it("resumes an approved reservation with the same approval and job", async () => {
  const request = { ...createStudioVideo("user", draft), approval, jobId: id(8) };
  api.job.mockResolvedValue({ job: { status: "queued", stage: "awaiting_credit_reservation" } });
  api.confirm.mockResolvedValue({ data: { jobId: id(8) } });
  expect(await resumeStudioVideo("user", "token", request)).toMatchObject({ key: request.key, jobId: id(8) });
  expect(api.confirm).toHaveBeenCalledWith("token", approval.approvalId);
  expect(api.submit).not.toHaveBeenCalled();
});

it("queries a new price for an automatic reservation with its original request key", async () => {
  const request = { ...createStudioVideo("user", draft), jobId: id(8) };
  api.job.mockResolvedValue({ job: { status: "queued", stage: "awaiting_credit_reservation" } });
  api.submit.mockRejectedValue(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  expect(await resumeStudioVideo("user", "token", request)).toMatchObject({ key: request.key, approval });
  expect(api.submit.mock.calls[0]?.[1]).toMatchObject({ key: request.key, draft });
  expect(api.confirm).not.toHaveBeenCalled();
});

it("rejects a confirmation that returns a different job instead of replacing the original", async () => {
  const request = { ...createStudioVideo("user", draft), approval, jobId: id(8) };
  localStorage.setItem("loomic:studio-video:user", JSON.stringify(request));
  api.confirm.mockResolvedValue({ data: { jobId: id(9) } });
  await expect(approveStudioVideo("user", "token", request)).rejects.toThrow("原任务不一致");
  expect(readStudioVideo("user")?.jobId).toBe(id(8));
});

it("preserves the completed result and reports a cancellation request that arrived too late", async () => {
  api.job.mockResolvedValue({ job: {
    status: "succeeded",
    stage: "completed_after_cancel_request",
    result: { asset_id: id(3) },
  } });

  expect(await inspectStudioVideo("token", { ...createStudioVideo("user", draft), jobId: id(8) })).toMatchObject({
    phase: "succeeded",
    assetId: id(3),
    message: "取消请求到达时任务已完成，结果和费用已保留。",
  });
});

it("keeps billing review visible when a task fails after cancellation was requested", async () => {
  api.job.mockResolvedValue({ job: {
    status: "failed",
    error_message: "Provider task failed",
    cancel_requested_at: "2026-11-14T00:00:00.000Z",
  } });

  expect(await inspectStudioVideo("token", { ...createStudioVideo("user", draft), jobId: id(8) })).toMatchObject({
    phase: "failed",
    message: expect.stringContaining("费用仍需按任务回执核验"),
  });
});

it.each(["rejected", "expired"])("does not generate after approval is %s", async approvalStatus => {
  api.submit.mockRejectedValueOnce(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  const request = await submitStudioVideo("user", "token", createStudioVideo("user", draft));
  api.status.mockResolvedValue({ approvalStatus });
  expect(await inspectStudioVideo("token", request)).toMatchObject({ phase: "canceled" });
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.job).not.toHaveBeenCalled();
});

it("refuses a second request while the original one is unresolved", () => {
  createStudioVideo("user", draft);
  expect(() => createStudioVideo("user", { ...draft, prompt: "另一个镜头" })).toThrow("当前视频任务");
  expect(api.submit).not.toHaveBeenCalled();
});

it("fails before submission when persistence is unavailable", () => {
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  try { expect(() => createStudioVideo("user", draft)).toThrow("quota"); expect(api.submit).not.toHaveBeenCalled(); }
  finally { write.mockRestore(); }
});

it("releases a request explicitly rejected for an unavailable model", async () => {
  api.submit.mockRejectedValue(new ApiApplicationError("video_model_unavailable", "模型不可用", undefined, { statusCode: 422 }));
  await expect(submitStudioVideo("user", "token", createStudioVideo("user", draft))).rejects.toThrow("模型不可用");
  expect(readStudioVideo("user")).toBeNull();
  expect(createStudioVideo("user", { ...draft, model: "another-model" }).draft.model).toBe("another-model");
});

it("retains a request after a late billing error because a job may already exist", async () => {
  api.submit.mockRejectedValue(new ApiApplicationError("insufficient_credits", "余额不足", undefined, { statusCode: 402 }));
  const request = createStudioVideo("user", draft);
  await expect(submitStudioVideo("user", "token", request)).rejects.toThrow("余额不足");
  expect(readStudioVideo("user")?.key).toBe(request.key);
});

it("never replaces a newer request when an old approval query arrives late", async () => {
  api.submit.mockRejectedValueOnce(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  const oldRequest = await submitStudioVideo("user", "token", createStudioVideo("user", draft));
  let finishQuery: (value: unknown) => void = () => { throw new Error("Query not started"); };
  api.status.mockImplementation(() => new Promise(resolve => { finishQuery = resolve; }));
  api.job.mockResolvedValue({ job: { status: "running" } });
  const query = inspectStudioVideo("token", oldRequest);
  clearStudioVideo("user", oldRequest.key);
  const nextRequest = createStudioVideo("user", { ...draft, prompt: "A different task" });
  finishQuery({ approvalStatus: "approved", jobId: id(2) });
  await query;
  expect(readStudioVideo("user")?.key).toBe(nextRequest.key);
  expect(readStudioVideo("user")?.draft.prompt).toBe("A different task");
});

it.each(["job", "approval"])("does not replace a newer request with a late %s submission response", async (reply) => {
  let finish: (value: { job: { id: string } }) => void = () => { throw new Error("Submission not started"); };
  let reject: (cause: Error) => void = () => { throw new Error("Submission not started"); };
  api.submit.mockReturnValue(new Promise((yes, no) => { finish = yes; reject = no; }));
  const original = createStudioVideo("user", draft);
  const submitted = submitStudioVideo("user", "token", original);
  clearStudioVideo("user", original.key);
  const current = createStudioVideo("user", { ...draft, prompt: "Current task" });
  if (reply === "job") finish({ job: { id: id(8) } });
  else reject(new ApiApplicationError("generation_confirmation_required", "confirm", approval));
  await submitted;
  expect(readStudioVideo("user")).toEqual(current);
});

it("does not replace a newer request when an old confirmation arrives late", async () => {
  let finish: (value: { data: { jobId: string } }) => void = () => { throw new Error("Confirmation not started"); };
  api.confirm.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const original = { ...createStudioVideo("user", draft), approval };
  const confirmed = approveStudioVideo("user", "token", original);
  clearStudioVideo("user", original.key);
  const current = createStudioVideo("user", { ...draft, prompt: "Current task" });
  finish({ data: { jobId: id(8) } });
  await confirmed;
  expect(readStudioVideo("user")).toEqual(current);
});

it("does not confirm a reservation after its recovery query was canceled", async () => {
  let finish: (value: { job: { status: string; stage: string } }) => void = () => { throw new Error("Query not started"); };
  api.job.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const original = { ...createStudioVideo("user", draft), approval, jobId: id(8) };
  const recovered = resumeStudioVideo("user", "token", original, controller.signal);
  controller.abort();
  finish({ job: { status: "queued", stage: "awaiting_credit_reservation" } });
  await expect(recovered).rejects.toMatchObject({ name: "AbortError" });
  expect(api.confirm).not.toHaveBeenCalled();
  expect(api.submit).not.toHaveBeenCalled();
});
