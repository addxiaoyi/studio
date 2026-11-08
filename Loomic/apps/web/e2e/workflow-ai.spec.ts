import {
  test,
  expect,
  _electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowFixture } from "../../server/src/features/canvas-workflows/browser-fixture";
test("conversational AI previews edits, persists decisions, and controls the same run", async ({
  page,
}, info) => {
  const fixture = await createWorkflowFixture(
      process.env.DATABASE_URL!,
      "http://localhost:3228",
    ),
    folder = await mkdtemp(join(tmpdir(), "workflow-ai-"));
  let desktop: ElectronApplication | undefined;
  try {
    if (process.env.HELT_TEST_CANDIDATE_PATH) {
      const env = {
        ...process.env,
        HELSTERA_ISOLATED_TEST: "1",
        HELSTERA_TEST_USER_DATA: folder,
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
    await page.setViewportSize({ width: 1500, height: 960 });
    const url = `http://localhost:3228/${desktop ? "desktop-app/" : ""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`;
    await page.goto(url);
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    const dock = page.getByRole("region", {
      name: "可视化工作流",
      exact: true,
    });
    const ask = async (text: string) => {
      await dock.getByRole("button", { name: "AI 搭建", exact: true }).click();
      await dock.getByRole("textbox", { name: "让 AI 帮你搭建" }).fill(text);
      await dock
        .getByRole("button", { name: "发送给 AI", exact: true })
        .click();
      await expect(
        dock.getByRole("region", { name: "AI 工作流操作" }).last(),
      ).toContainText("等待确认");
    };
    await ask("创建一个网站研究并录制的工作流");
    expect(
      (
        await fixture.db.query(
          "select count(*)::int as n from canvas_workflows",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "打开可视化工作流" }).click();
    await dock.getByRole("button", { name: "AI 搭建", exact: true }).click();
    await expect(
      dock.getByRole("region", { name: "工作流 AI 对话" }),
    ).toContainText("创建一个网站研究");
    await expect(
      dock.getByRole("region", { name: "AI 工作流操作" }),
    ).toContainText("等待确认");
    await dock.getByRole("button", { name: "应用到画布", exact: true }).click();
    await expect(
      dock.getByRole("combobox", { name: "选择工作流" }),
    ).toContainText("AI 网站研究");
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(0);
    await ask("运行当前流程");
    await dock
      .getByRole("button", { name: "确认运行流程", exact: true })
      .click();
    await expect(
      dock.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("等待动作确认");
    const run = (await fixture.db.query("select id from agent_goals")).rows[0]
      .id;
    await ask("暂停当前流程");
    await dock
      .getByRole("button", { name: "确认暂停运行", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await fixture.db.query(
              "select status from agent_goals where id=$1",
              [run],
            )
          ).rows[0].status,
      )
      .toBe("paused");
    await ask("继续当前流程");
    await dock
      .getByRole("button", { name: "确认继续运行", exact: true })
      .click();
    await expect(
      dock.getByRole("region", { name: "工作流运行记录" }),
    ).toContainText("等待动作确认");
    expect(
      (await fixture.db.query("select count(*)::int as n from agent_goals"))
        .rows[0].n,
    ).toBe(1);
    expect(
      (
        await fixture.db.query(
          "select count(*)::int as n from website_capture_tasks",
        )
      ).rows[0].n,
    ).toBe(0);
    await dock.getByRole("button", { name: "取消运行", exact: true }).click();
    await dock.getByRole("button", { name: "节点 · 3", exact: true }).click();
    await dock.getByRole("button", { name: /网址输入 目标网址/ }).click();
    await dock.getByRole("button", { name: "定位", exact: true }).click();
    await dock.getByRole("button", { name: "收起流程面板" }).click();
    const source = page.locator('[data-workflow-node="site"]');
    await expect(source).toBeInViewport();
    const bounds = (await source.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 40, { button: "right" });
    await page.getByRole("menuitem", { name: "让 AI 修改", exact: true }).click();
    await expect(dock.getByRole("region", { name: "AI 工作流操作" })).toHaveCount(4);
    await expect(dock.getByRole("textbox", { name: "让 AI 帮你搭建" })).toBeFocused();
    await expect(dock.getByRole("textbox", { name: "让 AI 帮你搭建" })).toBeInViewport({ ratio: 0.99 });
    await expect(dock.getByRole("button", { name: "发送给 AI", exact: true })).toBeInViewport({ ratio: 0.99 });
    await page.screenshot({
      path: info.outputPath("workflow-ai-conversation.png"),
    });
    await page.evaluate(()=>localStorage.setItem("theme","dark"));
    await page.reload();
    await page.getByRole("button",{name:"打开可视化工作流",exact:true}).click();
    await dock.getByRole("button",{name:"AI 搭建",exact:true}).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(dock.getByRole("region",{name:"AI 工作流操作"})).toHaveCount(4);
    await expect(dock.getByRole("button",{name:"发送给 AI",exact:true})).toBeInViewport({ratio:0.99});
    await page.screenshot({path:info.outputPath("workflow-dark.png")});
    await page.setViewportSize({width:760,height:900});
    const closeChat=page.getByRole("button",{name:"关闭 AI 对话面板",exact:true});
    if(await closeChat.isVisible())await closeChat.click();
    await dock.getByRole("textbox",{name:"让 AI 帮你搭建"}).focus();
    await expect(dock.getByRole("textbox",{name:"让 AI 帮你搭建"})).toBeInViewport();
    await expect(dock.getByRole("button",{name:"发送给 AI",exact:true})).toBeInViewport({ratio:0.99});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect((await dock.locator(".workflow-assistant-history").boundingBox())!.height).toBeGreaterThanOrEqual(80);
    await page.screenshot({path:info.outputPath("workflow-dark-narrow.png")});
  } finally {
    await desktop?.close();
    await fixture.close();
    await rm(folder, { recursive: true, force: true });
  }
});
