import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { createEditorBrowserFixture } from "../../server/src/features/video-editor/browser-fixture";
if(existsSync(resolve("../../.env.local")))loadEnvFile(resolve("../../.env.local"));
const real=process.env.HELT_TEST_REAL_MODEL==="1";
let fixture:Awaited<ReturnType<typeof createEditorBrowserFixture>>;
test.beforeAll(async()=>{
  fixture=await createEditorBrowserFixture(process.env.DATABASE_URL!,"http://localhost:3224",real?undefined:input=>{
    const prompt=String(input.prompt);
    if(prompt.includes("先介绍"))return {message:"当前视频2秒。我可以添加标题、改画幅和控制预览。"};
    if(prompt.includes("定位"))return {message:"定位到1秒。",control:{type:"seek",seconds:1}};
    if(prompt.includes("撤销"))return {message:"撤销最近修改，保留之前的标题与画幅。",control:{type:"undo"}};
    if(prompt.includes("播放"))return {message:"播放当前视频。",control:{type:"play"}};
    if(prompt.includes("暂停"))return {message:"暂停预览。",control:{type:"pause"}};
    if(prompt.includes("已有")){
      const layer=(input.layers as {id:string;text?:string;kind:string}[]).find(item=>item.kind==="div"&&item.text==="欢迎");
      return {message:"把已有标题改成新品，不新增字幕。",plan:{summary:"修改已有标题",actions:[{type:"layer",layerId:layer!.id,changes:{text:"新品",fontSize:60,color:"#ff0000"}}]}};
    }
    return {message:"先添加标题并调整画幅，确认后执行。",plan:{summary:"开头标题与竖屏",actions:[{type:"caption",text:"欢迎",startMs:0,endMs:1000},{type:"resize",width:720,height:1280}]}};
  });
});
test.afterAll(async()=>{await fixture?.close();});
test("conversation reads context, edits existing layers, controls playback and recovers history",async({page,context},info)=>{
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  expect((await context.request.post("http://localhost:3311/api/local-auth/password",{data:{email:fixture.email,password:fixture.password}})).status()).toBe(200);
  await page.goto("/video/?/MyComp");
  await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  const snapshot=()=>page.evaluate(()=>(window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  const before=await snapshot();
  const replies:unknown[]=[];
  async function send(prompt:string){
    await page.getByLabel("与视频 AI 对话",{exact:true}).fill(prompt);
    const response=page.waitForResponse(response=>response.url().endsWith("/api/video/editor/chat"),{timeout:110000});
    await page.getByRole("button",{name:"发送",exact:true}).click();
    const reply=await response;expect(reply.status(),await reply.text()).toBe(200);replies.push(await reply.json());
    await mkdir(info.outputDir,{recursive:true});await writeFile(info.outputPath("replies.json"),JSON.stringify(replies,null,2));
    await expect(page.getByRole("button",{name:"停止",exact:true})).toHaveCount(0);
  }
  async function apply(inChat=false){
    const card=page.getByTestId("studio-ai-plan");
    await expect(card,replies.map(item=>JSON.stringify(item)).join("\n")).toBeVisible();
    if(inChat){await page.getByLabel("与视频 AI 对话",{exact:true}).fill("确认全部并执行");await page.getByRole("button",{name:"发送",exact:true}).click();}
    else {for(const check of await card.getByRole("checkbox").all())await check.check();await card.getByRole("button",{name:"确认并应用修改",exact:true}).click();}
    await expect(card.getByRole("heading",{name:"修改已应用",exact:true})).toBeVisible();
    await expect(card.getByRole("button",{name:"撤销本次修改",exact:true})).toBeEnabled();
  }
  await send("先介绍当前工程的真实时长和你能做的事，只回答，不要修改方案。");
  expect((await snapshot()).revision).toBe(before.revision);
  await send("在0至1秒添加文字为‘欢迎’的字幕，同时把画幅改成720×1280。只要caption和resize这两个动作，保留现有画面。");
  expect((await snapshot()).revision).toBe(before.revision);await apply();
  const titled=await snapshot();expect(titled.captions[0].text).toBe("欢迎");expect(titled.width).toBe(720);
  await send("把已有的‘欢迎’文字图层改成‘新品’，字号60，颜色#ff0000。只用一个layer动作，不添加字幕，不更改时间。");
  expect((await snapshot()).captions).toHaveLength(1);await apply(true);
  expect((await snapshot()).captions.map((item:{text:string})=>item.text)).toEqual(["新品"]);
  await send("定位到1秒，只返回seek控制。");
  await expect(page.getByText("已定位到 1 秒。",{exact:true})).toBeVisible();
  await send("播放当前视频，只返回play控制。");
  await expect(page.getByText("正在播放当前视频。",{exact:true})).toBeVisible();
  await send("暂停预览，只返回pause控制。");
  await expect(page.getByText("预览已暂停。",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  await expect(page.getByRole("log")).toContainText("字号60");
  expect((await snapshot()).captions.map((item:{text:string})=>item.text)).toEqual(["新品"]);
  await send("撤销最近一次修改（把新品改回欢迎），只返回undo控制，不重新生成编辑计划。");
  await page.getByRole("button",{name:"撤销最近修改",exact:true}).click();
  await expect.poll(async()=>(await snapshot()).revision).toBe(titled.revision);
  await page.screenshot({path:info.outputPath("conversation.png"),animations:"disabled"});
  await page.setViewportSize({width:540,height:900});
  await expect(page.getByLabel("与视频 AI 对话",{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("conversation-narrow.png"),animations:"disabled"});
  await page.setViewportSize({width:320,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach("model-replies",{body:JSON.stringify({inference:real?"real":"injected",replies,restored:true}),contentType:"application/json"});
  expect(errors).toEqual([]);
});
