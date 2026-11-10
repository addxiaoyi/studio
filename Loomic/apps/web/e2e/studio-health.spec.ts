import { expect, test } from "@playwright/test";
import { createEditorBrowserFixture } from "../../server/src/features/video-editor/browser-fixture";

let fixture: Awaited<ReturnType<typeof createEditorBrowserFixture>>;
test.beforeAll(async () => { fixture = await createEditorBrowserFixture(process.env.DATABASE_URL!, "http://localhost:3234", "{}"); });
test.afterAll(async () => { await fixture?.close(); });

test("failed startup retries the saved project and compiler stalls release their worker", async ({ page, context }, info) => {
  expect((await context.request.post("http://localhost:3311/api/local-auth/password", { data: { email: fixture.email, password: fixture.password } })).status()).toBe(200);
  const entry = "**/creative/visualforge/entry.mjs*";
  await page.route(entry, route => route.abort("failed"));
  await page.goto("/video/");
  await expect(page.getByRole("region", { name: "视频创作工作台" }).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新打开已保存工程" })).toBeVisible();
  await page.unroute(entry);
  const start = Date.now();
  await page.getByRole("button", { name: "重新打开已保存工程" }).click();
  await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
  console.log("EDITOR_STARTUP_MS", Date.now() - start);
  await expect(page.getByRole("region", { name: "编辑器启动进度" })).toHaveCount(0);
  const revision = await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  await page.reload();
  await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
  expect((await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"))).revision).toBe(revision.revision);
  await page.clock.install();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("helstera:studio-stage", { detail: { phase: "compile" } })));
  await page.clock.runFor(45_000);
  await expect(page.getByRole("region", { name: "视频创作工作台" }).getByRole("alert")).toContainText("超时");
  await expect(page.getByLabel("导入本机素材", { exact: true })).toBeDisabled();
  await expect(page.locator(".visualforge-native-root")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("startup-timeout.png") });
  await page.clock.resume();
  await page.getByRole("button", { name: "重新打开已保存工程" }).click();
  await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
  expect((await page.evaluate(async () => (window as any).remotion_browserStudio.loomicSnapshot("MyComp"))).revision).toBe(revision.revision);
  await page.screenshot({ path: info.outputPath("startup-recovered.png") });
});

test("editor, export and transcript controls remain keyboard reachable at high DPI", async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    expect((await context.request.post("http://localhost:3311/api/local-auth/password", { data: { email: fixture.email, password: fixture.password } })).status()).toBe(200);
    await page.goto("http://localhost:3234/video/");
    await expect(page.getByLabel("导入本机素材", { exact: true })).toBeEnabled({ timeout: 90_000 });
    await page.getByRole("button", { name: "关闭 AI 编辑", exact: true }).click();
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 480 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const fileMenu = page.getByTestId("video-studio").getByRole("button", { name: "菜单", exact: true });
      await fileMenu.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "导出视频", exact: true }).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "视频", exact: true }).click();
      await dialog.getByRole("button", { name: "容器", exact: true }).click();
      await dialog.getByText("WebM", { exact: true }).click();
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
      const exportButton = dialog.getByRole("button", { name: /导出.*视频/ });
      await exportButton.scrollIntoViewIfNeeded();
      const box = await exportButton.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 481).toBe(true);
      await page.screenshot({ path: info.outputPath(`export-${width}-dpi2.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await page.getByRole("button", { name: "打开文字剪辑", exact: true }).click();
      const language = page.getByRole("combobox", { name: "语言", exact: true });
      await language.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(language).toBeFocused();
      await page.screenshot({ path: info.outputPath(`transcript-${width}-dpi2.png`) });
      await page.getByRole("button", { name: "返回时间线", exact: true }).click();
    }
  } catch (cause) {
    await info.attach("high-dpi-state", { body: await page.locator("body").ariaSnapshot(), contentType: "text/plain" });
    await page.screenshot({ path: info.outputPath("high-dpi-failure.png") });
    throw cause;
  } finally { await context.close(); }
});
