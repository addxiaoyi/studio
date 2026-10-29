import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProjectMock, toastErrorMock, routerPushMock } = vi.hoisted(() => ({
  createProjectMock: vi.fn(),
  toastErrorMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ session: { access_token: "token" }, signOut: vi.fn() }),
}));

vi.mock("@/components/toast", () => ({
  useToast: () => ({ error: toastErrorMock, success: vi.fn(), toast: vi.fn() }),
}));

vi.mock("@/lib/server-api", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/server-api")>(
      "../src/lib/server-api",
    );
  return {
    ...actual,
    createProject: (...args: unknown[]) => createProjectMock(...args),
  };
});

import { useCreateProject } from "../src/hooks/use-create-project";

describe("useCreateProject result contract", () => {
  beforeEach(() => {
    createProjectMock.mockReset();
    toastErrorMock.mockReset();
    routerPushMock.mockReset();
  });

  it("returns false when the create request fails so the caller can keep the prompt", async () => {
    createProjectMock.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useCreateProject());

    let created: boolean | undefined;
    await act(async () => {
      created = await result.current.create({ prompt: "保留这段提示词" });
    });

    expect(created).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith("项目创建失败");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("returns true and navigates to the canvas once the project exists", async () => {
    createProjectMock.mockResolvedValueOnce({
      project: { id: "project-1", primaryCanvas: { id: "canvas-1" } },
    });
    const { result } = renderHook(() => useCreateProject());

    let created: boolean | undefined;
    await act(async () => {
      created = await result.current.create({ prompt: "画一只猫" });
    });

    expect(created).toBe(true);
    // Fallback navigation path (window.open is unavailable in jsdom).
    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(String(routerPushMock.mock.calls[0]?.[0])).toContain("canvas-1");
  });

  it("shares one in-flight request across rapid double submits", async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    createProjectMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const { result } = renderHook(() => useCreateProject());

    let first: boolean | undefined;
    let second: boolean | undefined;
    await act(async () => {
      const firstPromise = result.current.create({ prompt: "一次" });
      const secondPromise = result.current.create({ prompt: "一次" });
      resolveCreate({ project: { id: "p", primaryCanvas: { id: "c" } } });
      first = await firstPromise;
      second = await secondPromise;
    });

    expect(createProjectMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(true);
    expect(second).toBe(true);
  });
});
