import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createAgentBrowserFixture } from "../../server/src/features/agent-browser/browser-fixture";
if (existsSync(resolve("../../.env.local")))
  loadEnvFile(resolve("../../.env.local"));
let fixture: Awaited<ReturnType<typeof createAgentBrowserFixture>>,
  desktop: ElectronApplication | undefined;
test.beforeAll(async () => {
  fixture = await createAgentBrowserFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3226",
  );
});
test.afterAll(async () => {
  await desktop?.close();
  await fixture?.close();
});
test("shows real browser actions, persists the view across refresh and respects pause", async ({
  page,
}, info) => {
  if (process.env.HELT_TEST_CANDIDATE_PATH) {
    const directory = await mkdtemp(join(tmpdir(), "loomic-browser-desktop-"));
    const env = {
      ...process.env,
      HELSTERA_ISOLATED_TEST: "1",
      HELSTERA_TEST_USER_DATA: directory,
      HELSTERA_DESKTOP_LOCAL_URL: "http://localhost:3226",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({
      executablePath: process.env.HELT_TEST_CANDIDATE_PATH,
      env: env as Record<string, string>,
      timeout: 45_000,
    });
    page = await desktop.firstWindow();
  }
  await page.goto("http://localhost:3226/home/");
  await page
    .getByRole("button", { name: "展开 Agent 浏览器", exact: true })
    .click();
  const panel = page.getByRole("complementary", {
    name: "Agent 浏览器",
    exact: true,
  });
  await expect(panel).toBeVisible();
  const frame = panel.getByRole("img", { name: "浏览器画面：Agent 操作验收" });
  await expect(frame).toBeVisible();
  expect(
    await frame.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(1280);
  await expect(
    panel.getByText(fixture.engine === "chromix" ? "Chromix" : "Chromium", {
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "下一动作前暂停", exact: true })
    .click();
  await expect
    .poll(() => fixture.store.checkpoint(fixture.observer.id))
    .toBe("paused");
  let executed = false;
  const action = fixture.observer
    .beforeAction("填写搜索内容")
    .then(async () => {
      await fixture.observer.pointAt("input", "输入搜索", "type");
      await fixture.page.getByLabel("搜索内容").fill("Loomic Agent");
      await fixture.page
        .getByRole("button", { name: "搜索", exact: true })
        .click();
      await fixture.observer.capture();
      executed = true;
    });
  expect(executed).toBe(false);
  await panel.getByRole("button", { name: "继续 Agent", exact: true }).click();
  await action;
  expect(await fixture.page.locator("#state").innerText()).toBe(
    "搜索完成：Loomic Agent",
  );
  await expect(
    panel.locator('.agent-browser-state [data-state="running"]'),
  ).toHaveText("实时画面");
  await expect(panel.locator(".agent-browser-detail")).toHaveText("输入搜索");
  await page.screenshot({ path: info.outputPath("browser-live.png") });
  await panel
    .getByRole("button", { name: "关闭浏览器侧栏", exact: true })
    .click();
  await expect(panel).not.toBeVisible();
  expect(
    (
      await fixture.store.get(fixture.observer.id, {
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
      })
    )?.state,
  ).toBe("running");
  await page.reload();
  await page
    .getByRole("button", { name: "展开 Agent 浏览器", exact: true })
    .click();
  await expect(frame).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(panel).toBeVisible();
  expect(
    await panel.evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath("browser-narrow.png") });
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await info.attach("engine", {
    body: JSON.stringify({
      engine: fixture.engine,
      desktop: Boolean(desktop),
      taskId: fixture.taskId,
    }),
    contentType: "application/json",
  });
});
