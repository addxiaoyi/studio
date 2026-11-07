import {expect,test,_electron,type ElectronApplication} from "@playwright/test";
import {existsSync} from "node:fs";
import {mkdtemp,readFile,rm,copyFile,stat} from "node:fs/promises";
import {loadEnvFile} from "node:process";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {createEditorBrowserFixture} from "../../server/src/features/video-editor/browser-fixture";
if(existsSync(resolve("../../.env.local")))loadEnvFile(resolve("../../.env.local"));
let fixture:Awaited<ReturnType<typeof createEditorBrowserFixture>>,folder:string;
let desktop:ElectronApplication|undefined;
const ffmpeg=process.platform==="win32"?resolve("../desktop/resources/ffmpeg/win-x64/ffmpeg.exe"):"ffmpeg";
const realModel=process.env.HELT_TEST_REAL_MODEL==="1";
test.beforeAll(async()=>{
  fixture=await createEditorBrowserFixture(process.env.DATABASE_URL!,"http://localhost:3224",realModel?undefined:input=>{
    if(String(input.prompt).includes("关键帧")){
      const layer=(input.layers as {id:string;kind:string;text?:string}[]).find(item=>item.kind==="div"&&item.text==="动画验收")!;
      return {message:"给标题添加淡入和位移关键帧。",plan:{summary:"标题动画",actions:[{type:"keyframes",layerId:layer.id,tracks:[{property:"opacity",points:[{timeMs:0,value:0,ease:"none"},{timeMs:900,value:1,ease:"power2.out"}]},{property:"x",points:[{timeMs:0,value:-80,ease:"none"},{timeMs:900,value:0,ease:"power2.out"}]}]}]}};
    }
    return {message:"两镜头淡化转场。",plan:{summary:"淡化剪辑",actions:[{type:"cut",format:"landscape",clips:[{name:"red.mp4",duration:2,start:0,end:2},{name:"blue.mp4",duration:2,start:0,end:2}]},{type:"transition",afterClip:0,durationMs:500,style:"fade"},{type:"caption",text:"动画验收",startMs:0,endMs:1500}]}};
  });
  folder=await mkdtemp(join(tmpdir(),"loomic-motion-"));
  for(const color of ["red","blue"])execFileSync(ffmpeg,["-v","error","-f","lavfi","-i",`color=c=${color}:s=320x180:r=30`,"-t","2","-c:v","libx264","-pix_fmt","yuv420p",join(folder,`${color}.mp4`)]);
  if(process.env.HELT_TEST_CANDIDATE_PATH){
    const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:join(folder,"profile"),HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3224"};delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
    desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});
    await desktop.evaluate(({session},directory)=>{session.defaultSession.on("will-download",(_event,item)=>item.setSavePath(`${directory}/${item.getFilename()}`));},folder);
  }
});
test.afterAll(async()=>{await desktop?.close();await fixture?.close();if(folder&&!process.env.HELT_TEST_CANDIDATE_PATH)await rm(folder,{recursive:true,force:true});});
test("GSAP frames, transition blending and export survive refresh and per-action undo",async({page,context},info)=>{
  if(desktop){page=await desktop.firstWindow();context=desktop.context();info.annotations.push({type:"desktop-candidate",description:process.env.HELT_TEST_CANDIDATE_PATH!});}
  const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await context.request.post("http://localhost:3311/api/local-auth/password",{data:{email:fixture.email,password:fixture.password}});
  await page.goto("http://localhost:3224/video/?/MyComp");await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  await page.getByLabel("导入本机素材",{exact:true}).setInputFiles([join(folder,"red.mp4"),join(folder,"blue.mp4")]);await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled();
  const snapshot=()=>page.evaluate(()=>(window as any).remotion_browserStudio.loomicSnapshot("MyComp"));
  async function send(prompt:string){
    await page.getByLabel("与视频 AI 对话",{exact:true}).fill(prompt);
    const planned=prompt.startsWith("定位到")||prompt==="导出视频"?null:page.waitForResponse(response=>response.url().endsWith("/api/video/editor/chat"),{timeout:110000});
    await page.getByRole("button",{name:"发送",exact:true}).click();
    if(planned){const response=await planned;expect(response.status(),await response.text()).toBe(200);await info.attach(`plan-${Date.now()}`,{body:await response.body(),contentType:"application/json"});}
  }
  async function apply(){
    const card=page.getByTestId("studio-ai-plan");await expect(card.getByRole("button",{name:"确认并应用修改",exact:true})).toBeVisible();
    for(const checkbox of await card.getByRole("checkbox").all())await checkbox.check();await card.getByRole("button",{name:"确认并应用修改",exact:true}).click();
    await expect(card.getByRole("button",{name:"撤销本次修改",exact:true})).toBeEnabled();
    await expect(page.getByText("编辑器已就绪",{exact:true})).toBeVisible({timeout:90000});
  }
  await send("将red.mp4的0至2秒接blue.mp4的0至2秒，横屏，在第一个衔接处添加500毫秒淡化转场。同时在0至1.5秒添加文字‘动画验收’。只返回cut、transition、caption三个动作。");await apply();
  expect((await snapshot()).duration).toBe(3.5);const cutRevision=(await snapshot()).revision;
  await send("给已有文字图层‘动画验收’添加关键帧：opacity在0毫秒为0、900毫秒为1；x在0毫秒为-80、900毫秒为0。末关键帧缓动power2.out。只返回一个keyframes动作，保留所有其他内容。");await apply();
  async function seek(seconds:number){await send(`定位到${seconds}秒`);await expect(page.getByText(`已定位到 ${seconds} 秒。`,{exact:true})).toBeVisible();}
  const title=page.locator(".visualforge-native-root div").filter({hasText:/^动画验收$/}).last();
  await seek(0);await expect.poll(()=>title.evaluate(element=>getComputedStyle(element).opacity)).toBe("0");
  await seek(0.9);await expect.poll(()=>title.evaluate(element=>getComputedStyle(element).opacity)).toBe("1");
  await page.screenshot({path:info.outputPath("keyframe-visible.png"),animations:"disabled"});
  await page.reload();await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90000});
  expect((await snapshot()).layers.some((layer:{motion?:unknown[]})=>layer.motion?.length)).toBe(true);
  await send("导出视频");const dialog=page.locator("dialog[open]");await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:"视频",exact:true}).click();await dialog.getByRole("button",{name:"容器",exact:true}).click();await dialog.getByText("WebM",{exact:true}).click();
  const download=desktop?null:page.waitForEvent("download",{timeout:90000});await dialog.getByRole("button",{name:/渲染.*视频/}).click();
  const output=info.outputPath("motion-transition.webm");
  if(desktop){await expect.poll(async()=>{try{return (await stat(join(folder,"MyComp.webm"))).size;}catch{return 0;}},{timeout:90000}).toBeGreaterThan(1000);await copyFile(join(folder,"MyComp.webm"),output);}
  else await(await download!).saveAs(output);
  expect((await readFile(output)).length).toBeGreaterThan(1000);
  execFileSync(ffmpeg,["-v","error","-xerror","-i",output,"-f","null","-"],{timeout:30000});
  const pixels=execFileSync(ffmpeg,["-v","error","-ss","1.75","-i",output,"-frames:v","1","-vf","scale=1:1","-f","rawvideo","-pix_fmt","rgb24","-"],{timeout:30000});
  expect(pixels[0]).toBeGreaterThan(40);expect(pixels[2]).toBeGreaterThan(40);
  await page.getByRole("button",{name:"撤销动作 1",exact:true}).click();await expect.poll(async()=>(await snapshot()).revision).toBe(cutRevision);
  expect(errors).toEqual([]);
  if(desktop)await info.attach("desktop-runtime",{body:JSON.stringify(await desktop.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,userData:app.getPath("userData"),electron:process.versions.electron}))),contentType:"application/json"});
});
