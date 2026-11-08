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
  if(process.env.HELT_TEST_CANDIDATE_PATH){
    const userData=await mkdtemp(join(tmpdir(),"loomic-presentation-desktop-"));
    const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:userData,HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3228"};delete env.ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();
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
    .toBeGreaterThan(0.1);
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
  await expect(card.getByRole('button',{name:'导入视频工作区剪辑'})).toBeVisible();
  await page.screenshot({path:info.outputPath('journey-complete.png')});
  await card.getByRole('button',{name:'导入视频工作区剪辑'}).click();
  await expect(page.getByLabel('网站录像导入')).toContainText('已导入',{timeout:45000});
  await page.screenshot({path:info.outputPath('recording-in-video-workspace.png')});
});
