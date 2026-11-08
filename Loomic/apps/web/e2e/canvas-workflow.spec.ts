import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>,
  desktop: ElectronApplication | undefined;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
});
test.afterAll(async () => {
  try {
    await desktop?.close();
  } finally {
    await fixture?.close();
  }
});
test("edits, confirms and executes a visual workflow with durable node receipts and canvas output", async ({
  page,
}, info) => {
  if (process.env.HELT_TEST_CANDIDATE_PATH) {
    const directory = await mkdtemp(join(tmpdir(), "workflow-desktop-"));
    const env = {
      ...process.env,
      HELSTERA_ISOLATED_TEST: "1",
      HELSTERA_TEST_USER_DATA: directory,
      HELSTERA_DESKTOP_LOCAL_URL: "http://localhost:3228",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = await _electron.launch({
      executablePath: process.env.HELT_TEST_CANDIDATE_PATH,
      env: env as Record<string, string>,
      timeout: 45000,
    });
    page = await desktop.firstWindow();
  }
  await page.goto(
    `http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`,
  );
  await page.getByRole("button", { name: "打开可视化工作流" }).click();
  const workspace = page.getByRole("region", {
    name: "可视化工作流",
    exact: true,
  });
  await workspace
    .getByRole("button", { name: "网站研究与截图", exact: true })
    .click();
  await workspace.getByRole("article", { name: /目标网址/ }).click();
  await workspace
    .getByRole("textbox", { name: "目标网址", exact: true })
    .fill("https://example.com/");
	await workspace.getByRole("article", { name: /读取网页与截图/ }).click();
	await workspace.getByRole("button", { name: "断开site到capture" }).click();
	await expect(workspace.getByRole("button", { name: "运行流程", exact: true })).toBeDisabled();
	await workspace.getByRole("combobox", { name: "连接上游节点" }).click();
	await page.getByRole("option", { name: "目标网址", exact: true }).click();
  await workspace
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "运行流程", exact: true }),
  ).toBeEnabled();
  expect(
    (await fixture.db.query("select count(*)::int as n from agent_goals"))
      .rows[0].n,
  ).toBe(0);
  await page.screenshot({ path: info.outputPath("workflow-draft.png") });
  await workspace
    .getByRole("button", { name: "运行流程", exact: true })
    .click();
  await page.getByRole("button", { name: "确认运行已保存版本" }).click();
  await expect(
    workspace.getByRole("region", { name: "工作流运行记录" }),
  ).toContainText("全部完成", { timeout: 30000 });
  const rows = (
    await fixture.db.query("select content from canvases where id=$1", [
      fixture.canvasId,
    ])
  ).rows;
  expect(rows[0].content.elements).toHaveLength(1);
  expect(
    (await fixture.db.query("select state from agent_goal_steps")).rows.every(
      (row) => row.state === "succeeded",
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("workflow-complete.png") });
  await page.reload();
  await page.getByRole("button", { name: "打开可视化工作流" }).click();
  await expect(
    workspace.getByRole("region", { name: "工作流运行记录" }),
  ).toContainText("全部完成");
  expect(
    (
      await fixture.db.query(
        "select count(*)::int as n from canvas_workflow_runs",
      )
    ).rows[0].n,
  ).toBe(1);
  await workspace
    .getByLabel("让 AI 帮你搭建")
    .fill("为 example.com 搭建读取网页与输出截图的工作流");
  await workspace
    .getByRole("button", { name: "生成方案", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("检查 AI 工作流方案");
  expect(
    (
      await fixture.db.query(
        "select count(*)::int as n from canvas_workflow_runs",
      )
    ).rows[0].n,
  ).toBe(1);
  await page.getByRole("button", { name: "应用到草稿" }).click();
  await expect(workspace).toContainText("AI 方案已应用到草稿");
  await page.setViewportSize({ width: 620, height: 900 });
  await page.screenshot({ path: info.outputPath("workflow-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await workspace
    .getByRole("button", { name: "保存草稿", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "已保存", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await fixture.db.query(
        "select count(*)::int as n from canvas_workflow_runs",
      )
    ).rows[0].n,
  ).toBe(1);
});
