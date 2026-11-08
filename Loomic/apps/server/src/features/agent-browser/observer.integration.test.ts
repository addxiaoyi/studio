import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { chromium } from "playwright";
import { launchAgentBrowser } from "./engine.js";
import { observeAgentBrowser } from "./observer.js";
import type { BrowserViewStore } from "./store.js";

it("streams real browser frames, pauses before actions and keeps contexts isolated", async () => {
  const { browser, engine } = await launchAgentBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const separate = await browser.newContext();
  const directory = await mkdtemp(join(tmpdir(), "loomic-browser-frames-"));
  let frameCount = 0,
    control: "agent" | "paused" = "agent",
    actions = 0,
    finished = "";
  const positions: Array<{ x: number; y: number }> = [];
  const page = await context.newPage();
  const store = {
    create: async () => "view",
    writeFrame: async (_id: string, bytes: Buffer) => {
      frameCount++;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(directory, "latest.jpg"), bytes);
    },
    activity: async (_id: string, cursor: { x: number; y: number } | null) => {
      if (cursor) positions.push(cursor);
    },
    checkpoint: async () => control,
    finish: async (_id: string, state: string) => {
      finished = state;
    },
  } as unknown as BrowserViewStore;
  let observer: Awaited<ReturnType<typeof observeAgentBrowser>> | undefined;
  try {
    await context.addCookies([
      {
        name: "private-session",
        value: "first-only",
        url: "https://example.test",
      },
    ]);
    expect(await separate.cookies()).toHaveLength(0);
    await page.setContent(
      '<main><h1>Live Agent browser</h1><input aria-label="Search"><button id="go" onclick="document.querySelector(\'h1\').textContent=\'Clicked by Agent\'">Run</button></main>',
    );
    observer = await observeAgentBrowser({
      page,
      store,
      taskId: "task",
      workspaceId: "workspace",
      userId: "user",
      engine,
      assertActive: async () => {},
    });
    await observer.pointAt("#go", "点击运行", "click");
    await page.locator("#go").click();
    await observer.capture();
    expect(await page.locator("h1").innerText()).toBe("Clicked by Agent");
    expect(positions[0]?.x).toBeGreaterThan(0);
    expect(
      (await readFile(join(directory, "latest.jpg")))
        .subarray(0, 3)
        .toString("hex"),
    ).toBe("ffd8ff");
    control = "paused";
    const pending = observer.beforeAction("填写搜索").then(() => {
      actions++;
    });
    await delay(120);
    expect(actions).toBe(0);
    control = "agent";
    await pending;
    expect(actions).toBe(1);
    await page.getByLabel("Search").fill("Loomic");
    await observer.capture();
    expect(frameCount).toBeGreaterThan(1);
    await page.setContent('<input type="password" value="private-one" style="position:absolute;left:50px;top:50px;width:300px;height:40px">');
    await observer.capture();const hidden=await readFile(join(directory,'latest.jpg'));
    await page.locator('input').fill('private-two');await page.locator('input').blur();await observer.capture();
    expect(await readFile(join(directory,'latest.jpg'))).toEqual(hidden);
    const rgb=await page.evaluate(`(async encoded=>{const img=new Image();img.src='data:image/jpeg;base64,'+encoded;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Array.from(ctx.getImageData(100,70,1,1).data).slice(0,3);})(${JSON.stringify(hidden.toString('base64'))})`) as number[];
    expect(rgb.every((channel,index)=>Math.abs(channel-[216,222,232][index]!)<6)).toBe(true);
    await observer.close("completed", "Done");
    observer = undefined;
    expect(finished).toBe("completed");
  } finally {
    await observer?.close("failed", "test stopped");
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
