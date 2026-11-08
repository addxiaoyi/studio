import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { launchAgentBrowser } from "../agent-browser/engine.js";
import { recordPageSegment, waitForRecordingPage } from "./page-recording.js";
import { ffmpegBinary, joinCaptureSegments } from "./video-encoder.js";

it("keeps actual decoded scrolling frames continuous under a slow observer", async () => {
  const { browser } = await launchAgentBrowser();
  const directory = await mkdtemp(join(tmpdir(), "scroll-continuity-"));
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent('<!doctype html><body style="margin:0"><main style="height:720px;overflow:auto">' + Array.from({ length: 150 }, (_, index) => `<div style="height:24px;background:hsl(${index * 29} 80% 45%);font:18px sans-serif">Row ${index}</div>`).join("") + "</main></body>");
    const source = join(directory, "source.webm");
    await recordPageSegment(page, source, 3, true, async () => {
      await new Promise(resolve => setTimeout(resolve, 120));
    });
    const file = await joinCaptureSegments([source], [3], directory);
    const decoded = spawnSync(ffmpegBinary(), ["-v", "error", "-i", file, "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    expect(decoded.status, decoded.stderr.toString()).toBe(0);
    const size = 160 * 90, frames = decoded.stdout.length / size;
    const movingStart = Math.round(frames * .12), movingEnd = Math.round(frames * .68);
    let changed = 0, repeatRun = 0, longestRepeat = 0;
    for (let frame = movingStart; frame < movingEnd; frame++) {
      let difference = 0;
      for (let pixel = 0; pixel < size; pixel++) difference += Math.abs(decoded.stdout[frame * size + pixel]! - decoded.stdout[(frame - 1) * size + pixel]!);
      if (difference / size > .15) { changed++; repeatRun = 0; }
      else { repeatRun++; longestRepeat = Math.max(longestRepeat, repeatRun); }
    }
    const measured = { file, frames, movingFrames: movingEnd - movingStart, changed, ratio: changed / (movingEnd - movingStart), longestRepeat };
    const evidence = process.env.HELT_CAPTURE_TEST_OUTPUT ?? directory;
    await mkdir(evidence, { recursive: true });
    await writeFile(join(evidence, "frame-continuity.json"), JSON.stringify(measured, null, 2));
    expect(measured.ratio).toBeGreaterThan(.95);
    expect(longestRepeat).toBeLessThanOrEqual(1);
  } finally { await browser.close(); }
}, 120_000);

it("waits for the application loading screen to disappear before recording", async () => {
  const { browser } = await launchAgentBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="status" aria-label="正在加载" style="position:fixed;inset:0">HELSTERA STUDIO</div><script>setTimeout(()=>document.body.innerHTML="<h1>Ready workspace</h1>",4000)</script>');
    await waitForRecordingPage(page);
    expect(await page.locator("h1").count()).toBe(1);
    expect(await page.locator("h1").textContent()).toBe("Ready workspace");
  } finally { await browser.close(); }
}, 20_000);

it("rejects a stuck loading screen instead of saving it as a frozen recording", async () => {
  const { browser } = await launchAgentBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<main aria-busy="true" style="position:fixed;inset:0">Loading workspace</main>');
    await expect(waitForRecordingPage(page)).rejects.toThrow("网页仍在加载");
  } finally { await browser.close(); }
}, 25_000);

it("allows a ready page with a small loading widget", async () => {
  const { browser } = await launchAgentBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Ready workspace</h1><span role="status" aria-label="Loading suggestions">Loading suggestions</span>');
    await expect(waitForRecordingPage(page)).resolves.toBeUndefined();
  } finally { await browser.close(); }
}, 10_000);

it("starts a ready application without waiting for periodic background requests to stop", async () => {
  const { browser } = await launchAgentBrowser();
  try {
    const page = await browser.newPage();
    await page.route("https://ready.example/pulse", route => route.fulfill({ status: 204 }));
    await page.setContent("<h1>Ready workspace</h1>");
    await page.evaluate("setInterval(()=>fetch('https://ready.example/pulse').catch(()=>{}),80)");
    const started = Date.now();
    await waitForRecordingPage(page);
    expect(Date.now() - started).toBeLessThan(4000);
  } finally { await browser.close(); }
}, 15_000);
