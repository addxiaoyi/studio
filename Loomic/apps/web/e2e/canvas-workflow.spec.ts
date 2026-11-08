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
  page.on("pageerror",error=>console.error("[workflow-page]",error.message));
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
  await page.getByRole("button", { name: "矩形 (R)", exact: true }).click();
  await page.mouse.move(110, 180);
  await page.mouse.down();
  await page.mouse.move(250, 250, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("v");
  await page.getByRole("button", { name: "打开可视化工作流" }).click();
  const workspace = page.getByRole("region", {
    name: "可视化工作流",
    exact: true,
  });
  await workspace
    .getByRole("button", { name: "网站研究与截图", exact: true })
    .click();
  await workspace.getByRole("button", { name: /网址输入 目标网址/ }).click();
  await workspace
    .getByRole("textbox", { name: "目标网址", exact: true })
    .fill("https://example.com/");
  await workspace
    .getByRole("button", { name: /浏览与录制 读取网页与截图/ })
    .click();
  await workspace.getByRole("button", { name: "断开site到capture" }).click();
  await expect(
    workspace.getByRole("button", { name: "运行流程", exact: true }),
  ).toBeDisabled();
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
  expect(
    rows[0].content.elements.filter(
      (element: { type: string; isDeleted?: boolean;customData?:{workflow?:unknown} }) =>
        element.type === "rectangle" && !element.isDeleted && !element.customData?.workflow,
    ),
  ).toHaveLength(1);
  expect(
    rows[0].content.elements.filter(
      (element: { type: string; isDeleted?: boolean }) =>
        element.type === "image" && !element.isDeleted,
    ),
  ).toHaveLength(1);
  expect(
    rows[0].content.elements.filter(
      (element: { customData?: { workflow?: unknown }; isDeleted?: boolean }) =>
        element.customData?.workflow && !element.isDeleted,
    ),
  ).toHaveLength(3);
  expect(
    (await fixture.db.query("select state from agent_goal_steps")).rows.every(
      (row) => row.state === "succeeded",
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("workflow-complete.png") });
  await expect(workspace.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "打开可视化工作流" }).click();
  await workspace
    .getByRole("button", { name: "运行记录", exact: true })
    .click();
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
  await workspace.getByRole("button", { name: "AI 搭建", exact: true }).click();
  await workspace
    .getByLabel("让 AI 帮你搭建")
    .fill("为 example.com 搭建读取网页与输出截图的工作流");
  await workspace
    .getByRole("button", { name: "发送给 AI", exact: true })
    .click();
  await expect(workspace.getByRole("region",{name:"AI 工作流操作"}).last()).toContainText("等待确认");
  expect(
    (
      await fixture.db.query(
        "select count(*)::int as n from canvas_workflow_runs",
      )
    ).rows[0].n,
  ).toBe(1);
  await workspace.getByRole("button", { name: "应用到画布",exact:true }).click();
  await expect(workspace.getByRole("region",{name:"AI 工作流操作"}).last()).toContainText("已应用");
  await expect(
    workspace.getByRole("button", { name: "已保存", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 620, height: 900 });
  await workspace
    .getByRole("button", { name: "定位流程节点", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("workflow-narrow.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await workspace
    .getByRole("button", { name: "收起流程面板", exact: true })
    .click();
  await expect(workspace).toBeHidden();
  await expect(page.getByRole("article", { name: /目标网址/ })).toBeVisible();
  await page.getByRole("button", { name: "展开画布流程", exact: true }).click();
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

test("turns story references into structured shots and editable canvas text", async ({ page }, info) => {
  if (desktop) page=await desktop.firstWindow();
  await page.setViewportSize({width:1440,height:960});
  await page.goto(`http://localhost:3228/${desktop?"desktop-app/":""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);
  await page.getByRole("button", { name: "打开可视化工作流" }).click();
  const workspace=page.getByRole("region",{name:"可视化工作流",exact:true});
  await workspace.getByRole("combobox",{name:"创作流程模板"}).click();
  await page.getByRole("option",{name:"剧本 → 分镜",exact:true}).click();
  await workspace.getByRole("button",{name:/创作资料 故事与创作要求/}).click();
  await workspace.getByRole("textbox",{name:"创作资料",exact:true}).fill("机器人寻找花园，经过热闹城市，最后到达安静的屋顶。");
  await workspace.getByRole("button",{name:"保存草稿",exact:true}).click();
  await workspace.getByRole("button",{name:"运行流程",exact:true}).click();
  await page.getByRole("button",{name:"确认运行已保存版本"}).click();
  await expect(workspace.getByRole("region",{name:"工作流运行记录"})).toContainText("全部完成",{timeout:30000});
  await expect(workspace).toContainText("镜头 3");
  const goal=(await fixture.db.query("select * from agent_goals where goal='剧本到分镜' order by created_at desc limit 1")).rows[0];
  expect(goal.status).toBe("completed");
  const saved=(await fixture.db.query("select content from canvases where id=$1",[fixture.canvasId])).rows[0].content;
  expect(saved.elements.some((element:{type:string;customData?:{workflowDocument?:{markdown?:string}};isDeleted?:boolean})=>element.type==="embeddable"&&!element.isDeleted&&element.customData?.workflowDocument?.markdown?.includes("机器人穿过城市"))).toBe(true);
  await workspace.getByRole("button",{name:"定位画布结果"}).click();
  await expect(page.getByRole("article",{name:"生成分镜文稿"}).getByRole("heading",{name:"机器人的花园",exact:true})).toBeVisible();
  const document=page.getByRole("article",{name:"生成分镜文稿"});
  await expect.poll(async()=>{const doc=await document.boundingBox(),dock=await workspace.boundingBox();return doc!.x>dock!.x+dock!.width;}).toBe(true);
  await document.getByRole("button",{name:"编辑画布文稿"}).click();
  await expect(page.getByRole("dialog",{name:"编辑画布文稿"})).toBeVisible();
  await page.getByRole("dialog",{name:"编辑画布文稿"}).getByRole("button",{name:"取消",exact:true}).click();
  await page.screenshot({path:info.outputPath("creative-storyboard.png")});
});

test("keeps the workflow left of chat and dismisses timeline on blank canvas",async({page},info)=>{
  if(desktop)page=await desktop.firstWindow();
  await page.setViewportSize({width:1700,height:960});
  await page.goto(`http://localhost:3228/${desktop?"desktop-app/":""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);
  const chat=page.getByRole("heading",{name:"Helstera Agent",exact:true});
  await expect(chat).toBeVisible();
  await page.getByRole("button",{name:"打开可视化工作流"}).click();
  const dock=page.getByRole("region",{name:"可视化工作流",exact:true});
  await expect(chat).toBeVisible();
  const panelBounds=await dock.boundingBox(),chatBounds=await chat.boundingBox();
  expect(panelBounds!.x).toBeLessThan(120);
  expect(panelBounds!.x+panelBounds!.width).toBeLessThan(chatBounds!.x);
  await page.screenshot({path:info.outputPath("canvas-left-workflow-chat.png")});
  await dock.getByRole("button",{name:"收起流程面板"}).click();
  await page.getByRole("button",{name:"媒体时间线",exact:true}).click();
  const timeline=page.getByRole("complementary",{name:"媒体时间线"});await expect(timeline).toBeVisible();
  await timeline.getByRole("textbox",{name:"字幕内容"}).fill("未提交字幕草稿");
  await expect(timeline).toBeVisible();
  await page.getByRole("button",{name:"拖拽画布 (H)",exact:true}).click();
  const surface=page.locator('[data-canvas-surface] canvas').last();
  await surface.hover({position:{x:500,y:150}});await page.mouse.down();await page.mouse.move(500,800,{steps:8});await page.mouse.up();
  await expect(timeline).toBeVisible();
  await surface.click({position:{x:500,y:160}});await expect(timeline).toBeHidden();
  await page.getByRole("button",{name:"媒体时间线",exact:true}).click();
  await expect(timeline.getByRole("textbox",{name:"字幕内容"})).toHaveValue("未提交字幕草稿");
  await timeline.getByRole("button",{name:"关闭时间线"}).click();
});

test("reuses completed results and private workflow and prompt recipes without running again",async({page},info)=>{
  if(desktop)page=await desktop.firstWindow();
  await page.goto(`http://localhost:3228/${desktop?"desktop-app/":""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);
  await page.getByRole("button",{name:"打开可视化工作流"}).click();
  const workspace=page.getByRole("region",{name:"可视化工作流",exact:true});
  await workspace.getByRole("button",{name:"运行流程",exact:true}).click();
  await page.getByRole("button",{name:"确认运行已保存版本"}).click();
  await expect.poll(async()=>Number((await fixture.db.query("select count(*) as n from agent_goals where goal='剧本到分镜' and status='completed'")).rows[0].n)).toBe(2);
  await expect(workspace.getByRole("region",{name:"工作流运行记录"})).toContainText("全部完成");
  const count=Number((await fixture.db.query("select count(*) as n from agent_goals")).rows[0].n);
  await workspace.getByRole("button",{name:"运行记录",exact:true}).click();
  await workspace.getByRole("button",{name:"对比 / 复用历史结果"}).click();
  const comparison=page.getByRole("dialog",{name:"结果对比与复用"});
  await expect(comparison).toContainText("机器人的花园");
  await expect(comparison.getByRole("combobox",{name:"右侧运行"})).not.toContainText("选择历史运行");
  await page.screenshot({path:info.outputPath("inspire-results-compare.png")});
  await comparison.getByRole("button",{name:"文字用作输入"}).first().click();
  await expect(comparison).toBeHidden();
  await expect(workspace).toContainText("已有结果");
  await workspace.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(workspace.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
  await workspace.getByRole("button",{name:"资源库",exact:true}).click();
  await workspace.getByRole("button",{name:"保存当前流程 / 选区"}).click();
  await workspace.getByRole("textbox",{name:"资源名称"}).fill("可复用的分镜流程");
  await workspace.getByRole("button",{name:"保存到个人库"}).click();
  const recipe=workspace.getByRole("article").filter({hasText:"可复用的分镜流程"});
  await expect(recipe).toBeVisible();
  await recipe.getByRole("button",{name:"移除",exact:true}).click();
  await expect(recipe).toBeHidden();
  await workspace.getByRole("button",{name:"撤销移除"}).click();
  await expect(recipe).toBeVisible();
  await workspace.getByRole("button",{name:"提示词",exact:true}).click();
  await workspace.getByRole("article").filter({hasText:"角色一致性"}).getByRole("button",{name:"追加到当前输入"}).click();
  await expect(workspace.getByRole("textbox",{name:"让 AI 帮你搭建"})).toHaveValue(/角色/);
  await workspace.getByRole("button",{name:"提示词库",exact:true}).click();
  await workspace.getByRole("button",{name:"保存当前提示词"}).click();
  await workspace.getByRole("textbox",{name:"资源名称"}).fill("角色约束验收");
  await workspace.getByRole("button",{name:"保存到个人库"}).click();
  await expect(workspace.getByRole("article").filter({hasText:"角色约束验收"})).toBeVisible();
  await page.screenshot({path:info.outputPath("inspire-library.png")});
  await workspace.getByRole("button",{name:"流程模板",exact:true}).click();
  await recipe.getByRole("button",{name:"插入画布草稿"}).click();
  await expect(workspace).toContainText("已有结果");
  await workspace.getByRole("button",{name:"保存草稿",exact:true}).click();
  await expect(workspace.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
  expect(Number((await fixture.db.query("select count(*) as n from agent_goals")).rows[0].n)).toBe(count);
  expect((await fixture.db.query("select count(*)::int as n from creative_library where archived_at is null")).rows[0].n).toBe(2);
  await page.reload();await page.getByRole("button",{name:"打开可视化工作流"}).click();
  await workspace.getByRole("button",{name:"资源库",exact:true}).click();
  await expect(recipe).toBeVisible();
  await page.setViewportSize({width:620,height:900});
  await page.screenshot({path:info.outputPath("inspire-library-narrow.png")});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole("button",{name:"文字 (T)",exact:true}).click();
  await page.mouse.click(700,180);await page.keyboard.type("Inspire reference: consistent white robot");await page.keyboard.press("Escape");
  await workspace.getByRole("button",{name:"AI 搭建",exact:true}).click();
  await workspace.getByRole("button",{name:/引用画布选区/}).click();
  await expect(workspace).toContainText("Inspire reference");
  await workspace.getByRole("textbox",{name:"让 AI 帮你搭建"}).fill("仅规划引用验收，不运行");
  await workspace.getByRole("button",{name:"发送给 AI",exact:true}).click();
  await expect(workspace.getByRole("region",{name:"AI 工作流操作"}).last()).toContainText("引用验收方案");
  await workspace.getByRole("button",{name:"暂不应用",exact:true}).last().click();
  expect(Number((await fixture.db.query("select count(*) as n from agent_goals")).rows[0].n)).toBe(count);
});
