import { mkdtemp, mkdir, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { capturePresentationScene } from "./presentation-snapshot.js";
import {
  preparePresentationPage,
  recordWebsitePresentation,
} from "./presentation.js";

it("reveals lazy sections before selecting the presentation layers",async()=>{
  const {browser}=await launchAgentBrowser();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    await page.route("https://presentation.example/",route=>route.fulfill({contentType:"text/html",body:'<body><h1>Visible heading</h1><div style="height:800px"></div><section style="height:300px;opacity:0"><h2>Lazy feature section</h2></section><script>new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting)entry.target.style.opacity="1"})).observe(document.querySelector("section"))</script></body>'}));
    await page.goto("https://presentation.example/");
    const scene=await capturePresentationScene(page);
    expect(scene.layers.some(layer=>layer.text==="Lazy feature section")).toBe(true);
  }finally{await browser.close();}
},15000);

const html = `<!doctype html><html><head><title>Website introduction</title><style>body{margin:0;background:#f4f5f9;font:20px system-ui;color:#19233c}header{padding:24px 50px;background:white}main{padding:40px 60px}h1{font-size:54px;max-width:650px}article{padding:24px;background:white;border:1px solid #ddd;border-radius:14px;width:320px;display:inline-block;margin:20px}input{padding:14px;border:1px solid #bbb}</style></head><body><header>Loomic · Explore · Create</header><main><h1>From a website to a visual story</h1><p>Multiple cursors build layouts, type words and reveal images.</p><article><h2>Collect ideas</h2><p>Choose a source page</p></article><article><h2>Make it move</h2><p>Record a clear introduction</p></article><input aria-label="Private" value="secret-a"><input type="password" value="password-a"></main></body></html>`;

it("rebuilds the real page with multiple cursors and records a playable WebM", async () => {
  const { browser } = await launchAgentBrowser();
  const directory = await mkdtemp(join(tmpdir(), "loomic-presentation-"));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const evidence = resolve("../../.creative-test-results/presentation");
  await mkdir(evidence, { recursive: true });
  try {
    const source = await context.newPage();
    await source.route("https://presentation.example/", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await source.goto("https://presentation.example/");
    await source.locator("h1").click();
    const scene = await capturePresentationScene(source);
    expect(
      scene.layers.some(
        (layer) => layer.kind === "text" && layer.text.includes("visual story"),
      ),
    ).toBe(true);
    expect(JSON.stringify(scene.layers)).not.toContain("secret-a");
    expect(JSON.stringify(scene.layers)).not.toContain("password-a");
    await source.getByLabel("Private").fill("secret-b");
    await source.locator("h1").click();
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    expect(hash((await capturePresentationScene(source)).image)).toBe(
      hash(scene.image),
    );
    const preview = await context.newPage();
    const config = {
      style: "cursor-rebuild" as const,
      durationSeconds: 12,
      cursorCount: 4,
    };
    preview.on("pageerror", (error) =>
      console.error("presentation page error", error.message),
    );
    await preparePresentationPage(preview, [scene], config);
    await preview.evaluate("window.__loomicPresentation.seek(4)");
    await preview.screenshot({
      path: join(evidence, "rebuild-in-progress.png"),
    });
    expect(await preview.locator("svg").count()).toBe(4);
    expect(await preview.locator("body").innerText()).toContain("多光标重建");
    const early = await preview.screenshot();
    await preview.evaluate("window.__loomicPresentation.seek(11)");
    expect(await preview.screenshot()).not.toEqual(early);
    await preview.screenshot({ path: join(evidence, "rebuild-finished.png") });
    let checks = 0;
    const progress: number[] = [];
    const file = await recordWebsitePresentation({
      browser,
      directory,
      scenes: [scene],
      config,
      onPage: async () => {},
      checkpoint: async () => {
        checks++;
      },
      onProgress: async (value) => {
        progress.push(value);
      },
    });
    expect(checks).toBeGreaterThan(4);
    expect(progress.at(-1)).toBe(100);
    const bytes = await readFile(file);
    expect(bytes.length).toBeGreaterThan(10_000);
    expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");
    const ffmpeg =
      process.platform === "win32"
        ? resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe")
        : "ffmpeg";
    execFileSync(
      ffmpeg,
      ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
      { timeout: 30000, windowsHide: true },
    );
    await copyFile(file, join(evidence, "website-introduction.webm"));
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
