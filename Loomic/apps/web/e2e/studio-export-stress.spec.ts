import { expect, test } from "@playwright/test";
import { createEditorBrowserFixture } from "../../server/src/features/video-editor/browser-fixture";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("exports mixed-frame-rate footage with audio and captions after cancellation and reload", async ({ page, context }, info) => {
  const fixture = await createEditorBrowserFixture(process.env.DATABASE_URL!, "http://localhost:3234", "{}");
  const folder = await mkdtemp(join(tmpdir(), "helstera-export-stress-"));
  const ffmpeg = process.env.HELSTERA_FFMPEG || "ffmpeg";
  const encode = (args: string[]) => {
    const proc = spawnSync(ffmpeg, ["-v", "error", ...args], { windowsHide: true, encoding: "utf8", timeout: 90_000 });
    expect(proc.status, proc.stderr).toBe(0);
    return proc.stdout;
  };
  const downloads: string[] = [];
  page.on("download", file => downloads.push(file.suggestedFilename()));
  try {
    for (const [i, fps] of [24, 25, 30].entries()) encode(["-f", "lavfi", "-i", `testsrc2=s=320x180:r=${fps}:d=30`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", join(folder, `part-${i}.mp4`)]);
    encode(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=90", join(folder, "music.wav")]);
    expect((await context.request.post("http://localhost:3311/api/local-auth/password", { data: { email: fixture.email, password: fixture.password } })).status()).toBe(200);
    await page.goto("/video/");
    await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
    await page.getByLabel("导入本机素材", { exact: true }).setInputFiles([0,1,2].map(i => join(folder, `part-${i}.mp4`)).concat(join(folder, "music.wav")));
    await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.evaluate(async () => {
      const studio = (window as any).remotion_browserStudio;
      const snapshot = await studio.loomicSnapshot("MyComp");
      await studio.loomicApplyEdit({ id: crypto.randomUUID(), compositionId: "MyComp", revision: snapshot.revision, replaceVideo: true, cut: {
        format: "landscape", clips: [0,1,2].map(i => ({ id: `part-${i}`, name: `part-${i}.mp4`, start: 0, end: 30, duration: 30 })),
        captions: [0,1,2].map(i => ({ text: `第${i+1}段 · 长视频中文验收`, startMs: i*30_000, endMs: (i+1)*30_000 })),
        audio: [{ assetName: "music.wav", startMs: 0, volume: 0.3 }],
      }});
    });
    await expect.poll(() => page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp").then((snapshot: { duration: number }) => snapshot.duration))).toBe(90);
    // Fixture setup uses the editing API; reload verifies the persisted user-facing project.
    await page.reload();
    await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByLabel("修改对象")).toContainText("90.0s", { timeout: 60_000 });
    const revision = (await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"))).revision;
    const openExport = async () => {
      await page.getByRole("button", { name: "导出视频", exact: true }).click();
      const modal = page.locator("dialog[open]");
      await modal.getByRole("button", { name: "视频", exact: true }).click();
      await modal.getByRole("button", { name: "容器", exact: true }).click();
      await modal.getByText("WebM", { exact: true }).click();
      await modal.getByRole("button", { name: /导出.*视频/ }).click();
    };
    await openExport();
    const cancel = page.getByRole("button", { name: "取消导出", exact: true });
    await expect(cancel).toBeVisible({ timeout: 30_000 });
    await cancel.click();
    await expect(page.getByTestId("video-studio")).toContainText(/已取消|Cancelled|Canceled/);
    expect(downloads).toHaveLength(0);
    await page.reload();
    await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
    expect((await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"))).revision).toBe(revision);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const samples: number[] = [];
    let sampling = false;
    const monitor = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try { const metrics = await cdp.send("Performance.getMetrics"); samples.push(metrics.metrics.find(m => m.name === "JSHeapUsedSize")?.value ?? 0); }
      catch (cause) { console.warn("EXPORT_MEMORY_SAMPLE", String(cause)); }
      finally { sampling = false; }
    }, 2_000);
    const output = info.outputPath("90-second-film.webm");
    const started = Date.now();
    try {
      const complete = page.waitForEvent("download", { timeout: 540_000 });
      await openExport();
      await (await complete).saveAs(output);
    } finally { clearInterval(monitor); await cdp.detach(); }
    const videoBytes = (await readFile(output)).length;
    expect(videoBytes).toBeGreaterThan(100_000);
    const probe = spawnSync(ffmpeg, ["-i", output, "-f", "null", "-"], { windowsHide: true, encoding: "utf8", timeout: 60_000 });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stderr).toMatch(/Duration: 00:01:30\./);
    expect(probe.stderr).toContain("Audio:");
    const frames = encode(["-i", output, "-vf", "fps=1/30,scale=16:16", "-f", "framemd5", "-"]);
    expect(new Set(frames.split("\n").filter(line => /^0,/.test(line)).map(line => line.split(",").at(-1))).size).toBe(3);
    const evidence = { durationSeconds: 90, sourceFps: [24,25,30], videoBytes, exportMilliseconds: Date.now()-started, peakJavaScriptHeapBytes: Math.max(...samples), samples: samples.length, cancelPreventedDownload: true, projectRestored: true };
    console.log("LONG_EXPORT", JSON.stringify(evidence));
    await info.attach("export-metrics", { body: JSON.stringify(evidence), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("long-export-complete.png") });
  } finally { await fixture.close(); await rm(folder, { recursive: true, force: true }); }
});
