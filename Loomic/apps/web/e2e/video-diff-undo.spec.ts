import { expect, test } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEditorBrowserFixture } from "../../server/src/features/video-editor/browser-fixture";

if (existsSync(resolve("../../.env.local"))) loadEnvFile(resolve("../../.env.local"));
const realModel = process.env.HELT_TEST_REAL_MODEL === "1";
let fixture: Awaited<ReturnType<typeof createEditorBrowserFixture>>;
let folder: string;
const ffmpeg = process.platform === "win32" ? resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe") : "ffmpeg";

test.beforeAll(async () => {
  const plan = { summary: "剪辑两段视频并添加字幕和音乐", actions: [
    { type:"cut", format:"portrait", clips:[{name:"first.mp4",duration:3,start:0.5,end:2},{name:"second.mp4",duration:2,start:0,end:1}] },
    { type:"caption",text:"新品上市",startMs:0,endMs:1000 },
    { type:"caption",text:"第二镜头",startMs:1500,endMs:2400 },
    { type:"audio",assetName:"music.wav",startMs:200,volume:0.3 },
    { type:"export",format:"mp4" },
  ] };
  fixture = await createEditorBrowserFixture(process.env.DATABASE_URL!, "http://localhost:3224", realModel ? undefined : JSON.stringify(plan));
  folder = await mkdtemp(join(tmpdir(), "loomic-diff-"));
  for (const [name, duration, source] of [["first.mp4",3,"testsrc2=size=320x180:rate=30"],["second.mp4",2,"color=c=blue:s=320x180:r=30"]] as const) {
    execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",source,"-t",String(duration),"-c:v","libx264","-pix_fmt","yuv420p",join(folder,name)]);
  }
  execFileSync(ffmpeg,["-v","error","-f","lavfi","-i","sine=frequency=440:sample_rate=48000:duration=3",join(folder,"music.wav")]);
});
test.afterAll(async () => { await fixture?.close();if(folder)await rm(folder,{recursive:true,force:true}); });

test("complex plan previews the timeline, persists individual undo, and exports the remaining actions", async ({page,context},info) => {
  info.annotations.push({type:"inference",description:realModel?"real configured model":"injected plan; inference not verified"});
  const errors: string[]=[];page.on("pageerror",error=>errors.push(error.message));
  const confirmations: string[]=[];
  page.on("request",request=>{ if (request.method()==="POST" && /\/plans\/[^/]+\/confirm$/.test(request.url())) confirmations.push(request.url()); });
  expect((await context.request.post("http://localhost:3311/api/local-auth/password",{data:{email:fixture.email,password:fixture.password}})).status()).toBe(200);
  await page.goto("/video/?/MyComp");
  await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  await page.getByLabel("导入本机素材",{exact:true}).setInputFiles([join(folder,"first.mp4"),join(folder,"second.mp4"),join(folder,"music.wav")]);
  await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"AI 编辑",exact:true}).click();
  const before=await page.evaluate(()=> (window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  await page.getByLabel("描述视频编辑目标",{exact:true}).fill('只做以下5个动作，顺序保持一致：1.竖屏剪辑first.mp4的0.5至2秒，再接second.mp4的0至1秒，总时长2.5秒；2.在0至1秒添加字幕“新品上市”；3.在1.5至2.4秒添加字幕“第二镜头”；4.使用已选music.wav从0.2秒开始以30%音量播放；5.导出MP4。不要添加其他动作，保留上述精确参数。');
  await page.getByText("背景音乐（可选）",{exact:true}).click();
  await page.getByLabel("背景音乐素材",{exact:true}).selectOption("music.wav");
  await page.getByLabel("音乐起播（秒）",{exact:true}).fill("0.2");
  const response=page.waitForResponse(response=>response.url().endsWith("/api/video/editor/plan"),{timeout:90000});
  await page.getByRole("button",{name:"预览修改方案",exact:true}).click();
  const planned=await response;expect(planned.status(),await planned.text()).toBe(200);
  const payload=await planned.json();
  expect(payload.plan.actions.map((action:{type:string})=>action.type)).toEqual(["cut","caption","caption","audio","export"]);
  expect(payload.plan.actions[0]).toMatchObject({format:"portrait",clips:[{name:"first.mp4",start:0.5,end:2},{name:"second.mp4",start:0,end:1}]});
  expect(payload.plan.actions[1]).toMatchObject({text:"新品上市",startMs:0,endMs:1000});
  expect(payload.plan.actions[2]).toMatchObject({text:"第二镜头",startMs:1500,endMs:2400});
  await page.getByRole("button",{name:"查看时间线差异",exact:true}).click();
  const diff=page.getByRole("dialog",{name:"时间线差异预览"});await expect(diff).toBeVisible();
  await expect(diff.getByRole("region",{name:"修改前",exact:true})).toContainText("2s");
  await expect(diff.getByRole("region",{name:"确认后",exact:true})).toContainText("2.5s");
  await expect(diff.getByRole("button",{name:"画面: first.mp4, 0s–1.5s",exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("timeline-diff.png"),animations:"disabled"});
  await page.setViewportSize({width:540,height:900});
  expect(await diff.evaluate(element=>element.getBoundingClientRect().right<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("timeline-diff-narrow.png"),animations:"disabled"});
  await page.keyboard.press("Escape");await page.setViewportSize({width:1440,height:960});
  expect((await page.evaluate(()=> (window as any).remotion_browserStudio.loomicSnapshot("MyComp"))).revision).toBe(before.revision);
  const plan=page.getByTestId("studio-ai-plan");
  for(const checkbox of await plan.getByRole("checkbox").all())await checkbox.check();
  await page.getByRole("button",{name:"确认并应用修改",exact:true}).click();
  await expect(page.getByRole("button",{name:"撤销动作 2",exact:true})).toBeEnabled();
  const snapshot=()=>page.evaluate(()=> (window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  expect((await snapshot()).captions).toHaveLength(2);
  await page.getByRole("button",{name:"撤销动作 1",exact:true}).click();
  await expect(page.getByLabel("AI 编辑当前合成",{exact:true}).getByRole("alert")).toContainText("先撤销");
  expect((await snapshot()).duration).toBe(2.5);
  await page.getByRole("button",{name:"撤销动作 2",exact:true}).click();
  await expect.poll(async()=> (await snapshot()).captions.map((caption:{text:string})=>caption.text)).toEqual(["第二镜头"]);
  await page.reload();await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  await page.getByRole("button",{name:"AI 编辑",exact:true}).click();
  await expect(plan.locator('[data-action-index="1"]')).toContainText("已撤销");
  await expect(page.getByRole("button",{name:"撤销动作 4",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"撤销动作 4",exact:true}).click();
  await expect.poll(async()=> (await snapshot()).editReceipt.undone).toEqual([1,3]);
  await page.getByRole("button",{name:"导出当前版本",exact:true}).click();
  const exportDialog=page.locator('dialog[open]');await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole("button",{name:"视频",exact:true}).click();
  await exportDialog.getByRole("button",{name:"容器",exact:true}).click();await exportDialog.getByText("WebM",{exact:true}).click();
  const downloading=page.waitForEvent("download",{timeout:90000});await exportDialog.getByRole("button",{name:/渲染.*视频/}).click();
  const videoFile=info.outputPath("partial-undo.webm");await (await downloading).saveAs(videoFile);
  expect((await readFile(videoFile)).length).toBeGreaterThan(1000);
  execFileSync(ffmpeg,["-v","error","-xerror","-i",videoFile,"-f","null","-"],{timeout:30000});
  await expect(page.getByLabel("本机导出记录",{exact:true}).locator("video")).toBeVisible();
  await page.getByRole("button",{name:"撤销动作 3",exact:true}).click();
  await expect.poll(async()=> (await snapshot()).captions).toEqual([]);
  await page.getByRole("button",{name:"撤销动作 1",exact:true}).click();
  await expect.poll(async()=> (await snapshot()).revision).toBe(before.revision);
  await expect(page.getByRole("heading",{name:"本次修改已全部撤销",exact:true})).toBeVisible();
  const after=await snapshot();expect(after.editReceipt.undone).toEqual([0,1,2,3]);
  await page.reload();await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  await page.getByRole("button",{name:"AI 编辑",exact:true}).click();
  await expect(page.getByRole("heading",{name:"本次修改已全部撤销",exact:true})).toBeVisible();
  expect((await snapshot()).revision).toBe(before.revision);
  expect(confirmations).toHaveLength(1);
  await expect(page.getByLabel("本机导出记录",{exact:true}).locator("video")).toBeVisible();
  await page.screenshot({path:info.outputPath("actions-undone.png"),animations:"disabled"});
  await info.attach("model-and-undo",{body:JSON.stringify({inference:realModel?"real":"injected",model:payload.model,plan:payload.plan,undone:after.editReceipt.undone,originalRestored:before.revision===after.revision}),contentType:"application/json"});
  expect(errors).toEqual([]);
});
