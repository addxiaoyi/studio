import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import type { AgentBrowserCursor } from "@helstera/shared";
import type { BrowserViewStore } from "./store.js";

const FRAME_INTERVAL_MS = 750;
const MAX_PAUSE_MS = 15 * 60_000;

export async function observeAgentBrowser(options: {
  page: Page;
  store: BrowserViewStore;
  taskId: string;
  workspaceId: string;
  userId: string;
  engine: "chromix" | "chromium";
  assertActive(): Promise<void>;
  signal?: AbortSignal;
}) {
  const { page, store } = options;
  const id = await store.create({ ...options, name: "浏览 Agent" });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let capturing = Promise.resolve();
  let frameFailures = 0;
  let lastCursor: AgentBrowserCursor | null = null;

  async function frame() {
    if (stopped || page.isClosed()) return;
    try {
      const bytes = await page.screenshot({
        type: "jpeg",
        quality: 62,
        timeout: 3000,
        mask: [
          page.locator(
            'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete="cc-number"],input[autocomplete="cc-csc"]',
          ),
        ],
      });
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      await store.writeFrame(id, bytes, {
        url: page.url(),
        title: await page.title(),
        ...viewport,
      });
      frameFailures = 0;
    } catch (error) {
      if (!stopped && !page.isClosed()) {
        if (frameFailures++ === 0)
          console.error(
            "[agent-browser/observer] preview capture failed",
            error,
          );
        if (frameFailures === 3)
          await store.activity(
            id,
            null,
            "画面暂时不可用，正在重新连接浏览器预览。",
          );
      }
    }
  }
  function queueFrame() {
    // A screenshot and its atomic file publication form one operation.
    capturing = capturing.then(frame, frame);
    return capturing;
  }
  function tick() {
    const pending = queueFrame().finally(() => {
      if (!stopped) timer = setTimeout(tick, FRAME_INTERVAL_MS);
    });
    void pending.catch((error) =>
      console.error("[agent-browser/observer] preview update failed", error),
    );
  }
  tick();

  return {
    id,
    async beforeAction(detail: string, cursor?: AgentBrowserCursor | null) {
      const started = Date.now();
      while (true) {
        options.signal?.throwIfAborted();
        await options.assertActive();
        if ((await store.checkpoint(id)) === "agent") break;
        if (Date.now() - started > MAX_PAUSE_MS)
          throw new Error("浏览器暂停超过 15 分钟，请重新发起任务。");
        await delay(
          250,
          undefined,
          options.signal ? { signal: options.signal } : {},
        );
      }
      if (cursor !== undefined) lastCursor = cursor;
      await store.activity(id, lastCursor, detail);
    },
    async pointAt(
      selector: string,
      label: string,
      kind: AgentBrowserCursor["kind"] = "read",
    ) {
      const bounds = await page.locator(selector).first().boundingBox();
      if (!bounds) {
        lastCursor = null;
        await store.activity(id, null, label);
        return;
      }
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
      const x = Math.max(
        0,
        Math.min(viewport.width, bounds.x + Math.min(40, bounds.width / 2)),
      );
      const y = Math.max(
        0,
        Math.min(viewport.height, bounds.y + Math.min(20, bounds.height / 2)),
      );
      await page.mouse.move(x, y);
      lastCursor = {
        x: x / viewport.width,
        y: y / viewport.height,
        visible: true,
        kind,
        label,
      };
      await store.activity(id, lastCursor, label);
    },
    async capture() {
      await queueFrame();
    },
    async close(state: "completed" | "failed", detail: string) {
      stopped = true;
      clearTimeout(timer);
      await capturing;
      await store.finish(id, state, detail);
    },
  };
}
