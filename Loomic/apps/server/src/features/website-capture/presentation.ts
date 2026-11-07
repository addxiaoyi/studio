import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Browser, Page } from "playwright";
import type { WebsitePresentation } from "@helstera/shared";
import type { PresentationScene } from "./presentation-snapshot.js";
import { PRESENTATION_PLAYER } from "./presentation-player.js";

const require = createRequire(import.meta.url);
export async function preparePresentationPage(
  page: Page,
  scenes: PresentationScene[],
  config: WebsitePresentation,
) {
  await page.setContent(
    '<!doctype html><meta charset="utf-8"><title>网站介绍演示</title><body></body>',
  );
  await page.addScriptTag({
    content: await readFile(require.resolve("gsap/dist/gsap.min.js"), "utf8"),
  });
  await page.evaluate(
    `${PRESENTATION_PLAYER}(${JSON.stringify({ scenes, config })})`,
  );
}

export async function recordWebsitePresentation(options: {
  browser: Browser;
  directory: string;
  scenes: PresentationScene[];
  config: WebsitePresentation;
  onPage(page: Page): Promise<void>;
  checkpoint(): Promise<void>;
  onProgress(progress: number): Promise<void>;
}): Promise<string> {
  const context = await options.browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: options.directory, size: { width: 1280, height: 720 } },
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  try {
    await preparePresentationPage(page, options.scenes, options.config);
    await options.onPage(page);
    await page.evaluate("window.__loomicPresentation.play()");
    const deadline = Date.now() + 17 * 60_000;
    let lastProgress = -1;
    while (Date.now() < deadline) {
      // Pause the authored timeline while checking task/connector state; explicit user pauses are recorded as holds.
      await page.evaluate("window.__loomicPresentation.pause()");
      await options.checkpoint();
      const status = (await page.evaluate(
        "({done:window.__loomicPresentation.done,progress:window.__loomicPresentation.progress()})",
      )) as { done: boolean; progress: number };
      const progress = Math.round(status.progress * 100);
      if (progress !== lastProgress) {
        lastProgress = progress;
        await options.onProgress(progress);
      }
      if (status.done || status.progress >= 1) break;
      await page.evaluate("window.__loomicPresentation.play()");
      await delay(350);
    }
    if (lastProgress < 100) throw new Error("网站演示录制超时，请重试。");
    await delay(500);
    const video = page.video();
    if (!video) throw new Error("浏览器未创建演示录制文件。");
    await page.close();
    await context.close();
    return await video.path();
  } finally {
    await context.close();
  }
}
