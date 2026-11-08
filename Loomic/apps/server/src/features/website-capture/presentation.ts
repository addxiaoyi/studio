import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import type { WebsitePresentation } from "@helstera/shared";
import type { PresentationScene } from "./presentation-snapshot.js";
import { PRESENTATION_PLAYER } from "./presentation-player.js";
import { frameEncoder,CAPTURE_FPS } from "./video-encoder.js";

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
  checkpoint(): Promise<number|void>;
  onProgress(progress: number): Promise<void>;
  onFrame?(bytes:Buffer):Promise<void>;
}): Promise<string> {
  const context = await options.browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: "block",
    acceptDownloads: false,
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const path=join(options.directory,'website-presentation.webm');
  const encoder=frameEncoder(path);
  let encoded=false;
  try {
    await preparePresentationPage(page, options.scenes, options.config);
    await options.onPage(page);
    // Render every authored frame. Server load affects render time, never the output timeline.
    const count=options.config.durationSeconds*CAPTURE_FPS,deadline=Date.now()+17*60_000;
    for(let frame=0;frame<count;frame++){
      if(Date.now()>deadline)throw new Error('网站演示渲染超时，请缩短时长重试。');
      if(frame%15===0)await options.checkpoint();
      await page.evaluate(`window.__loomicPresentation.seek(${frame/CAPTURE_FPS})`);
      const bytes=await page.screenshot({type:'jpeg',quality:85,timeout:10000});
      await encoder.frame(bytes);
      if(frame%15===0){await options.onFrame?.(bytes);await options.onProgress(Math.floor(frame/count*100));}
    }
    await encoder.close();encoded=true;await options.onProgress(100);return path;
  } finally {
    if(!encoded)await encoder.abort();
    await context.close();
  }
}
