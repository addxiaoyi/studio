import type { Page } from "playwright";

export async function openFrameCapture(page: Page) {
  const session = await page.context().newCDPSession(page);
  return {
    async frame() {
      // Playwright's interactive screenshot path waits for fonts and animation stability
      // on every call. The recording timeline already controls its exact frame position.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const screenshot = await Promise.race([
          session.send("Page.captureScreenshot", { format: "jpeg", quality: 85, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("录制画面采集超时，请稍后重试。")), 10_000); }),
        ]);
        if (!screenshot.data) throw new Error("录制画面为空，已停止生成。");
        return Buffer.from(screenshot.data, "base64");
      } finally { clearTimeout(timer); }
    },
    async close() { if (!page.isClosed()) await session.detach(); },
  };
}
