import { useStudioVideoGeneration } from "@/hooks/use-studio-video-generation";
import type {
  StudioVideoRequest,
  StudioVideoState,
} from "@/lib/studio-video-generation";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  read: vi.fn(),
  create: vi.fn(),
  submit: vi.fn(),
  inspect: vi.fn(),
  resume: vi.fn(),
  approve: vi.fn(),
  clear: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/lib/studio-video-generation", () => ({
  readStudioVideo: api.read,
  createStudioVideo: api.create,
  submitStudioVideo: api.submit,
  inspectStudioVideo: api.inspect,
  resumeStudioVideo: api.resume,
  approveStudioVideo: api.approve,
  clearStudioVideo: api.clear,
}));
vi.mock("@/lib/server-api", () => ({
  cancelJob: api.cancel,
  cancelGenerationApproval: vi.fn(),
}));

const draft = {
  prompt: "A shot",
  model: "test-video",
  duration: 5,
  resolution: "720p",
  aspectRatio: "16:9",
};
const request: StudioVideoRequest = { key: "original", draft, jobId: "job-1" };
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not started");
  };
  let reject: (cause: Error) => void = () => {
    throw new Error("Promise not started");
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.read.mockReturnValue(null);
  api.create.mockReturnValue(request);
  api.inspect.mockImplementation(
    async (_token: string, saved: StudioVideoRequest) => ({
      phase: "running",
      request: saved,
    }),
  );
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(async (_name, _options, task) =>
        task({ name: "test", mode: "exclusive" }),
      ),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("drops a previous account's error and busy state even when the token is reused", async () => {
  const old = deferred<StudioVideoRequest>();
  api.submit.mockReturnValue(old.promise);
  const view = renderHook(
    ({ user }) => useStudioVideoGeneration(user, "same-token"),
    { initialProps: { user: "owner" } },
  );
  let pending: Promise<void> | undefined;
  act(() => {
    pending = view.result.current.start(draft);
  });
  expect(view.result.current.busy).toBe(true);
  view.rerender({ user: "other" });
  expect(view.result.current.busy).toBe(false);
  await act(async () => {
    old.reject(new Error("old account failure"));
    await pending;
  });
  expect(view.result.current.error).toBe("");
  expect(view.result.current.state).toBeNull();
});

it("does not cancel a job after its account changed while status was being read", async () => {
  const old = deferred<StudioVideoState>();
  const view = renderHook(
    ({ user }) => useStudioVideoGeneration(user, "same-token"),
    { initialProps: { user: "owner" } },
  );
  api.read.mockImplementation((user: string) =>
    user === "owner" ? request : null,
  );
  api.inspect.mockReturnValueOnce(old.promise);
  let pending: Promise<void> | undefined;
  act(() => {
    pending = view.result.current.cancel();
  });
  view.rerender({ user: "other" });
  await act(async () => {
    old.resolve({ phase: "running", request });
    await pending;
  });
  expect(api.cancel).not.toHaveBeenCalled();
});

it("does not submit an old request after a delayed browser lock is granted", async () => {
  let grant: () => Promise<void> = async () => {
    throw new Error("Lock not requested");
  };
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn(
        (_name, _options, task) =>
          new Promise<void>((resolve) => {
            grant = async () => {
              await task({ name: "test", mode: "exclusive" });
              resolve();
            };
          }),
      ),
    },
  });
  const view = renderHook(
    ({ user }) => useStudioVideoGeneration(user, "same-token"),
    { initialProps: { user: "owner" } },
  );
  let pending: Promise<void> | undefined;
  act(() => {
    pending = view.result.current.start(draft);
  });
  view.rerender({ user: "other" });
  await act(async () => {
    await grant();
    await pending;
  });
  expect(api.create).not.toHaveBeenCalled();
  expect(api.submit).not.toHaveBeenCalled();
});

it("lets the new account start and keeps its operation busy after the old operation finishes", async () => {
  const first = deferred<StudioVideoRequest>();
  const second = deferred<StudioVideoRequest>();
  api.submit
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const view = renderHook(
    ({ user }) => useStudioVideoGeneration(user, "same-token"),
    { initialProps: { user: "owner" } },
  );
  let oldPending: Promise<void> | undefined;
  let newPending: Promise<void> | undefined;
  act(() => {
    oldPending = view.result.current.start(draft);
  });
  view.rerender({ user: "other" });
  act(() => {
    newPending = view.result.current.start(draft);
  });
  expect(api.submit).toHaveBeenCalledTimes(2);
  await act(async () => {
    first.resolve(request);
    await oldPending;
  });
  expect(view.result.current.busy).toBe(true);
  await act(async () => {
    second.resolve(request);
    await newPending;
  });
  expect(view.result.current.busy).toBe(false);
});
