// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CanvasSaveConflictNotice,
  buildCanvasSaveHeaders,
  saveCanvasWithVersion,
} from "../src/components/canvas-editor";
import {
  CanvasVersionConflictError,
  type fetchCanvas,
  formatCanvasVersionETag,
  parseCanvasVersionETag,
  type saveCanvas,
} from "../src/lib/server-api";

type FetchCanvasFn = typeof fetchCanvas;
type SaveCanvasFn = typeof saveCanvas;

const emptyContent = { elements: [], appState: {}, files: {} };

const remoteCanvas = {
  canvas: {
    id: "canvas-1",
    name: "Canvas",
    projectId: "project-1",
    content: emptyContent,
  },
  version: 5,
};

/**
 * 场景：本窗口打开画布时版本是 3，另一个标签页已经存到了 5。
 * 假服务端完全按真实语义：version 不匹配就抛 409（CanvasVersionConflictError），不写入。
 */
function buildDeps(input: { serverVersion?: number } = {}) {
  const serverVersion = input.serverVersion ?? 5;
  const fetchRemote = vi.fn(async () => ({
    canvas: remoteCanvas.canvas,
    version: serverVersion,
  })) as unknown as FetchCanvasFn & ReturnType<typeof vi.fn>;

  const saveRemote = vi.fn(
    async (
      _token: string,
      _canvasId: string,
      _content: unknown,
      options?: { baseVersion?: number | null },
    ) => {
      const baseVersion = options?.baseVersion ?? null;
      if (baseVersion !== null && baseVersion !== serverVersion) {
        throw new CanvasVersionConflictError(serverVersion);
      }
      return { version: serverVersion + 1 };
    },
  ) as unknown as SaveCanvasFn & ReturnType<typeof vi.fn>;

  return { fetchRemote, saveRemote, serverVersion };
}

afterEach(cleanup);

describe("canvas save version handling", () => {
  it("sends the version this window knows about, not the one just fetched", async () => {
    const { fetchRemote, saveRemote } = buildDeps();

    await saveCanvasWithVersion({
      accessToken: "token",
      canvasId: "canvas-1",
      content: emptyContent,
      baseVersion: 3,
      deps: { fetchCanvas: fetchRemote, saveCanvas: saveRemote },
    });

    expect(fetchRemote).toHaveBeenCalledTimes(1);
    expect(saveRemote).toHaveBeenCalledTimes(1);
    // 反证：如果实现把 GET 到的 5 当成基线，这里会是 5 —— 那正是「后写覆盖前写」。
    expect(saveRemote.mock.calls[0]?.[3]).toEqual({ baseVersion: 3 });
  });

  it("reports a conflict and never retries with the fresh version on its own", async () => {
    const { fetchRemote, saveRemote } = buildDeps();

    const outcome = await saveCanvasWithVersion({
      accessToken: "token",
      canvasId: "canvas-1",
      content: emptyContent,
      baseVersion: 3,
      deps: { fetchCanvas: fetchRemote, saveCanvas: saveRemote },
    });

    expect(outcome).toEqual({ status: "conflict", version: 5 });
    // 只发了一次保存请求：冲突之后没有「自动用新版本重发」这种静默覆盖。
    expect(saveRemote).toHaveBeenCalledTimes(1);
  });

  it("resends with the server version only after the user chooses 覆盖保存", async () => {
    const { fetchRemote, saveRemote } = buildDeps();
    const deps = { fetchCanvas: fetchRemote, saveCanvas: saveRemote };

    const first = await saveCanvasWithVersion({
      accessToken: "token",
      canvasId: "canvas-1",
      content: emptyContent,
      baseVersion: 3,
      deps,
    });
    expect(first.status).toBe("conflict");

    // 用户点「覆盖保存」：用 409 带回的版本重发。
    const second = await saveCanvasWithVersion({
      accessToken: "token",
      canvasId: "canvas-1",
      content: emptyContent,
      baseVersion: first.status === "conflict" ? first.version : null,
      deps,
    });

    expect(second).toEqual({ status: "saved", version: 6 });
    expect(saveRemote).toHaveBeenCalledTimes(2);
    expect(saveRemote.mock.calls[1]?.[3]).toEqual({ baseVersion: 5 });
  });

  it("keeps working when the server has no version information (legacy backend)", async () => {
    const fetchRemote = vi.fn(async () => ({
      canvas: remoteCanvas.canvas,
      version: null,
    })) as unknown as FetchCanvasFn & ReturnType<typeof vi.fn>;
    const saveRemote = vi.fn(async () => ({
      version: null,
    })) as unknown as SaveCanvasFn & ReturnType<typeof vi.fn>;

    const outcome = await saveCanvasWithVersion({
      accessToken: "token",
      canvasId: "canvas-1",
      content: emptyContent,
      baseVersion: null,
      deps: { fetchCanvas: fetchRemote, saveCanvas: saveRemote },
    });

    expect(outcome).toEqual({ status: "saved", version: null });
    expect(saveRemote.mock.calls[0]?.[3]).toEqual({ baseVersion: null });
  });
});

describe("canvas conflict notice", () => {
  it("states the canvas changed elsewhere and offers exactly two explicit actions", async () => {
    const onReload = vi.fn();
    const onOverwrite = vi.fn();

    render(
      <CanvasSaveConflictNotice
        onReload={onReload}
        onOverwrite={onOverwrite}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "画布已在其它窗口被修改",
    );
    expect(
      screen.getByRole("button", { name: "重新加载" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "覆盖保存" }),
    ).toBeInTheDocument();

    // 反证：提示出现本身不会触发覆盖保存，只有点按钮才会。
    expect(onOverwrite).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "覆盖保存" }));
    expect(onOverwrite).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("routes the reload action to its own handler without overwriting", async () => {
    const onReload = vi.fn();
    const onOverwrite = vi.fn();

    render(
      <CanvasSaveConflictNotice
        onReload={onReload}
        onOverwrite={onOverwrite}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
  });
});

describe("beforeunload keepalive headers", () => {
  it("carries If-Match when the version is known so the unload flush cannot blindly overwrite", () => {
    const headers = buildCanvasSaveHeaders("token-1", 4);
    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["If-Match"]).toBe(formatCanvasVersionETag(4));
    expect(headers["If-Match"]).toBe('W/"4"');
  });

  it("omits If-Match when no version is known, keeping legacy clients saveable", () => {
    expect(buildCanvasSaveHeaders("token-1", null)["If-Match"]).toBeUndefined();
    expect(
      buildCanvasSaveHeaders(undefined, null).Authorization,
    ).toBeUndefined();
  });
});

describe("canvas version header parsing", () => {
  it("reads weak and strong ETags and ignores junk", () => {
    expect(parseCanvasVersionETag('W/"7"')).toBe(7);
    expect(parseCanvasVersionETag('"7"')).toBe(7);
    expect(parseCanvasVersionETag(null)).toBeNull();
    expect(parseCanvasVersionETag('W/"abc"')).toBeNull();
  });
});
