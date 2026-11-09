import { test, expect, _electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp,stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { resolve,join } from "node:path";
import { createPresentationFixture } from "../../server/src/features/website-capture/presentation-fixture";
if (existsSync(resolve("../../.env.local")))
  loadEnvFile(resolve("../../.env.local"));
let fixture: Awaited<ReturnType<typeof createPresentationFixture>>;
let desktop:ElectronApplication|undefined;
test.beforeAll(async () => {
  fixture = await createPresentationFixture(
    process.env.DATABASE_URL!,
    "http://localhost:3228",
  );
});
test.afterAll(async () => {
  await desktop?.close();
  await fixture?.close();
});
test("rejects then approves a real presentation, plays the recording and restores it after refresh", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  if(process.env.HELT_TEST_CANDIDATE_PATH){
    const userData=await mkdtemp(join(tmpdir(),"loomic-presentation-desktop-"));
    const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:userData,HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3228"};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window?.show(); window?.focus(); });
    await desktop.evaluate(({session},path)=>{session.defaultSession.on("will-download",(_event,item)=>item.setSavePath(path));},info.outputPath("website-introduction.webm"));
  }
  await page.goto(`http://localhost:3228/home/?session=${fixture.sessionId}`);
  await page
    .getByRole("button", { name: "展开 Agent 浏览器", exact: true })
    .click();
  const card = page.getByRole("region", { name: "网站介绍演示", exact: true });
  await card.getByRole("button", { name: /网站介绍演示与录制/ }).click();
  await card.getByRole('button',{name:'使用手动录制参数'}).click();
  await card
    .getByRole("textbox", { name: "演示网址" })
    .fill("https://8.8.8.8/");
  await card.getByRole("combobox", { name: "演示时长" }).click();
  await page.getByRole("option", { name: "12 秒", exact: true }).click();
  await card.getByRole("button", { name: "查看录制方案" }).click();
  await expect(card.getByLabel("网站演示录制确认")).toContainText(
    "12 秒 · 4 个光标",
  );
  expect(
    Number(
      (await fixture.db.query("select count(*) from background_jobs")).rows[0]
        .count,
    ),
  ).toBe(0);
  await card.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(card).toContainText("演示已取消");
  expect(
    Number(
      (await fixture.db.query("select count(*) from background_jobs")).rows[0]
        .count,
    ),
  ).toBe(0);
  await card.getByRole("button", { name: "制作新的演示" }).click();
  await card.getByRole("button", { name: "查看录制方案" }).click();
  await card.getByRole("button", { name: "确认演示并录制" }).click();
  await expect(card).toContainText("演示录像已保存", { timeout: 60000 });
  const video = card.getByLabel("网站介绍演示录像");
  await expect(video).toBeVisible();
  await video.evaluate(async (el: HTMLVideoElement) => {
    el.muted = true;
    await el.play();
  });
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.1).catch(async error => {
      await info.attach("video-playback-state", { body: JSON.stringify(await video.evaluate((el: HTMLVideoElement) => ({ time: el.currentTime, paused: el.paused, ready: el.readyState, network: el.networkState, error: el.error?.message, width: el.videoWidth, duration: el.duration, hidden: document.hidden, quality: el.getVideoPlaybackQuality() }))), contentType: "application/json" });
      throw error;
    });
  const download = desktop?null:page.waitForEvent("download");
  await card.getByRole("link", { name: "下载 WebM 演示录像" }).click();
  if(desktop)await expect.poll(async()=>{try{return(await stat(info.outputPath("website-introduction.webm"))).size;}catch{return 0;}},{timeout:30000}).toBeGreaterThan(1000);
  else await (await download!).saveAs(info.outputPath("website-introduction.webm"));
  const messages = (
    await fixture.db.query(
      "select content from chat_messages where session_id=$1",
      [fixture.sessionId],
    )
  ).rows;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toContain("网站介绍演示");
  expect(
    Number(
      (
        await fixture.db.query(
          "select count(*) from generated_assets where media_type='video'",
        )
      ).rows[0].count,
    ),
  ).toBe(1);
  await page.reload();
  await page
    .getByRole("button", { name: "展开 Agent 浏览器", exact: true })
    .click();
  await expect(video).toBeVisible();
  expect(
    Number(
      (await fixture.db.query("select count(*) from background_jobs")).rows[0]
        .count,
    ),
  ).toBe(1);
  await page.screenshot({ path: info.outputPath("recording-restored.png") });
  const completed = (await fixture.db.query("select id,result from website_capture_tasks where status='succeeded' order by created_at desc limit 1")).rows[0];
  expect(completed.result.canvasDelivery.status).toBe("succeeded");
  const delivered = (await fixture.db.query("select content from canvases where id=$1", [fixture.canvasId])).rows[0].content;
  expect(delivered.elements.filter((element: any) => element.customData?.websiteCaptureTaskId === completed.id)).toHaveLength(2);
  await fixture.db.query("insert into chat_messages(session_id,role,content,content_blocks) values($1,'assistant','',$2)", [fixture.sessionId, JSON.stringify([{ type: "tool", toolCallId: "capture-acceptance", toolName: "website_capture", status: "completed", output: { taskId: completed.id } }])]);
  await page.goto(`http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);
  const progress = page.getByRole("region", { name: "网站浏览进度", exact: true });
  await expect(progress.getByRole("heading", { name: "演示验收", level: 2 })).toBeVisible();
  await expect(progress.locator("strong").filter({ hasText: "网站定位" })).toBeVisible();
  await progress.getByRole("button", { name: "定位画布素材" }).click();
  const embeddedVideo = page.locator("[data-canvas-video]");
  await expect(embeddedVideo).toBeInViewport();
  const videoBounds = await embeddedVideo.boundingBox();
  if (!videoBounds) throw new Error("Canvas video is missing");
  await page.mouse.move(videoBounds.x + videoBounds.width / 2, videoBounds.y + videoBounds.height / 2);
  const videoActions = page.getByRole("group", { name: "视频创作操作" });
  await expect(videoActions).toBeInViewport();
  await page.screenshot({ path: info.outputPath("capture-on-canvas.png") });
  await videoActions.hover();
  await videoActions.getByRole("button", { name: "加入时间线", exact: true }).click();
  const timeline = page.getByRole("complementary", { name: "媒体时间线", exact: true });
  await expect(timeline.getByRole("button", { name: /让 AI 剪辑网站录像/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("capture-on-canvas-timeline.png") });
  await timeline.getByRole("button", { name: /让 AI 剪辑网站录像/ }).click();
  await page.waitForURL(/\/video\//);
  const savedTimeline = (await fixture.db.query("select content from canvases where id=$1", [fixture.canvasId])).rows[0].content;
  expect(savedTimeline.elements.find((element: any) => element.customData?.isVideo)?.customData.timelineIncluded).toBe(true);
  const imported = page.getByRole("region", { name: "画布视频剪辑" });
  await imported.getByRole("button", { name: "加入剪辑时间线" }).click({ timeout: 90000 });
  await expect(imported).toContainText("画布视频已加入剪辑时间线", { timeout: 30000 });
  await expect(page.getByLabel("修改对象", { exact: true })).toContainText("12.0s", { timeout: 30000 });
  await expect(page.getByRole("complementary", { name: "视频 AI 对话" }).getByRole("alert")).toHaveCount(0);
  await imported.getByRole("button", { name: "让 AI 剪辑", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /对话|编辑要求|输入/ }).filter({ visible: true }).last()).toHaveValue(/剪辑当前时间线/);
  await page.screenshot({ path: info.outputPath("capture-ai-edit-ready.png") });
});

test("uses a secure login form and never persists raw credentials in browser recovery",async({page},info)=>{
  if(process.env.HELT_TEST_CANDIDATE_PATH){
    await desktop?.close();
    const userData=await mkdtemp(join(tmpdir(),"loomic-login-desktop-"));
    const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:userData,HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3228"};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();
  }
  await page.goto(`http://localhost:3228/home/?session=${fixture.sessionId}`);
  await page.getByRole("button",{name:"展开 Agent 浏览器",exact:true}).click();
  const card=page.getByRole("region",{name:"网站介绍演示",exact:true});
  await card.getByRole("button",{name:/网站介绍演示与录制/}).click();
  await card.getByRole('button',{name:'使用手动录制参数'}).click();
  await card.getByRole("textbox",{name:"演示网址"}).fill("https://8.8.8.8/");
  await card.getByRole("combobox",{name:"演示时长"}).click();
  await page.getByRole("option",{name:"12 秒",exact:true}).click();
  await card.getByRole("checkbox",{name:"需要登录后体验"}).check();
  await card.getByText('高级登录设置（可选）',{exact:true}).click();
  await card.getByLabel("登录地址",{exact:true}).fill("https://8.8.8.8/login");
  await card.getByLabel("网站账号",{exact:true}).fill("private-user@example.test");
  await card.getByLabel("网站密码",{exact:true}).fill("private-test-password");
  await card.getByLabel("登录成功后可见的文字",{exact:true}).fill("我的工作台");
  const jobsBefore=Number((await fixture.db.query("select count(*) from background_jobs")).rows[0].count);
  await card.getByRole("button",{name:"查看录制方案"}).click();
  await expect(card.getByLabel("网站演示录制确认")).toContainText("登录成功标记：我的工作台");
  const browserState=await page.evaluate(()=>JSON.stringify(localStorage));
  expect(browserState).not.toContain("private-test-password");expect(browserState).not.toContain("private-user@example.test");
  expect(Number((await fixture.db.query("select count(*) from background_jobs")).rows[0].count)).toBe(jobsBefore);
  await page.screenshot({path:info.outputPath("login-approval.png")});
  await card.getByRole("button",{name:"确认演示并录制"}).click();
  await expect(card).toContainText("演示录像已保存",{timeout:60000});
  expect((await fixture.db.query("select ciphertext from website_login_secrets")).rows.every(row=>row.ciphertext===null)).toBe(true);
  const video=card.getByLabel("网站介绍演示录像");await expect(video).toBeVisible();
  await video.evaluate(async(el:HTMLVideoElement)=>{el.muted=true;await el.play();});
  await expect.poll(()=>video.evaluate((el:HTMLVideoElement)=>el.currentTime)).toBeGreaterThan(.1);
  await page.reload();await page.getByRole("button",{name:"展开 Agent 浏览器",exact:true}).click();
  await expect(video).toBeVisible();
  expect(Number((await fixture.db.query("select count(*) from background_jobs")).rows[0].count)).toBe(jobsBefore+1);
  await page.screenshot({path:info.outputPath("authenticated-recording-restored.png")});
});

test('plans from conversation, resumes human verification after refresh and remembers the session',async({page},info)=>{
  if(process.env.HELT_TEST_CANDIDATE_PATH){
    await desktop?.close();const userData=await mkdtemp(join(tmpdir(),'loomic-journey-desktop-'));
    const env={...process.env,HELSTERA_ISOLATED_TEST:'1',HELSTERA_TEST_USER_DATA:userData,HELSTERA_DESKTOP_LOCAL_URL:'http://localhost:3228'};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();
  }
  await page.goto(`http://localhost:3228/home/?session=${fixture.sessionId}`);
  await page.getByRole('button',{name:'展开 Agent 浏览器',exact:true}).click();
  const card=page.getByRole('region',{name:'网站介绍演示',exact:true});
  await card.getByRole('button',{name:/网站介绍演示与录制/}).click();
  await card.getByRole('textbox',{name:'网站',exact:true}).fill('https://8.8.8.8/');
  await card.getByRole('textbox',{name:'想体验什么'}).fill('请让我接管登录，再录制首页介绍');
  await card.getByRole('button',{name:'让 Agent 规划'}).click();
  await expect(card.getByRole('region',{name:'AI 网站体验路线'})).toBeVisible();
  await card.getByRole('checkbox',{name:'记住此网站会话 24 小时'}).check();
  await card.getByRole('button',{name:'确认路线并录制'}).click();
  const handoff=page.getByRole('region',{name:'人工接管登录'});
  await expect(handoff).toBeVisible({timeout:30000});
  const task=(await fixture.db.query("select id from website_capture_tasks where stage='waiting_login'")).rows[0].id;
  await page.reload();await page.getByRole('button',{name:'展开 Agent 浏览器',exact:true}).click();
  await expect(handoff.getByRole('img',{name:'待接管的登录页面'})).toBeVisible();
  if (desktop) await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(2));
  else await page.setViewportSize({ width: 640, height: 480 });
  const resumeControl = handoff.getByRole('button',{name:'验证完成，继续录制'});
  await resumeControl.focus();
  await expect(resumeControl).toBeFocused();
  await resumeControl.scrollIntoViewIfNeeded();
  expect(await resumeControl.evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight;})).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await handoff.evaluate(el=>el.contains(document.activeElement))).toBe(true);
  await page.screenshot({path:info.outputPath('handoff-200-percent.png')});
  if (desktop) await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1));
  else await page.setViewportSize({ width: 1280, height: 900 });
  const screen=handoff.getByRole('group',{name:'登录页面操作区域'}),bounds=await screen.boundingBox();
  if(!bounds)throw new Error('Handoff preview missing');
  await screen.click({position:{x:bounds.width*160/1280,y:bounds.height*140/720}});
  await expect(handoff).toContainText('已操作，请查看当前画面。');
  await handoff.getByLabel('输入到页面选中的控件').fill('123456');
  await handoff.getByRole('button',{name:'输入文字',exact:true}).click();
  await expect(handoff.getByRole('button',{name:'确认输入',exact:true})).toBeEnabled();
  await handoff.getByRole('button',{name:'确认输入',exact:true}).click();
  await expect(page.getByText('https://8.8.8.8/verify',{exact:true})).toBeVisible();
  await expect(handoff.getByRole('button',{name:'验证完成，继续录制'})).toBeEnabled();
  await page.screenshot({path:info.outputPath('handoff-verified.png')});
  await handoff.getByRole('button',{name:'验证完成，继续录制'}).click();
  await expect(card).toContainText('演示录像已保存',{timeout:60000});
  expect((await fixture.db.query('select status from website_capture_tasks where id=$1',[task])).rows[0].status).toBe('succeeded');
  expect((await fixture.db.query('select count(*)::int as n from website_handoff_commands where task_id=$1 and ciphertext is not null',[task])).rows[0].n).toBe(0);
  expect((await fixture.db.query('select count(*)::int as n from website_browser_sessions where user_id=$1 and ciphertext is not null',[fixture.userId])).rows[0].n).toBe(1);
  await expect(card.getByRole('button',{name:'让 AI 剪辑录像'})).toBeVisible();
  await page.screenshot({path:info.outputPath('journey-complete.png')});
  await card.getByRole('button',{name:'让 AI 剪辑录像'}).click();
  await expect(page.getByLabel('画布视频剪辑')).toContainText('已导入',{timeout:45000});
  await page.screenshot({path:info.outputPath('recording-in-video-workspace.png')});
  await page.getByRole('button',{name:'展开 Agent 浏览器',exact:true}).click();
  await page.getByRole('button',{name:'网站登录会话 · 管理',exact:true}).click();
  const sessions=page.getByRole('region',{name:'网站登录会话管理'});await expect(sessions).toContainText('https://8.8.8.8');
  await sessions.getByRole('button',{name:'立即撤销',exact:true}).click();await expect(sessions).toContainText('没有已保存的网站会话。');
  expect((await fixture.db.query('select count(*)::int as n from website_browser_sessions where user_id=$1 and ciphertext is not null',[fixture.userId])).rows[0].n).toBe(0);
});
