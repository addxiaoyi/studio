import { expect,test } from "@playwright/test";
import { createPresentationFixture } from "../../server/src/features/website-capture/presentation-fixture";
import { createBlankTemplateProject } from "../../../vendor/visualforge/packages/browser-studio/src/templates/blank";

test("keeps the same project between canvas and video, retains old drafts and identifies missing copies on a second device", async ({page,browser},info) => {
  const fixture=await createPresentationFixture(process.env.DATABASE_URL!,"http://localhost:3238",async ctx => {
    ctx.app.get("/api/workspace/settings",async()=>({settings:{autoDeleteEmptyCanvas:false}}));
  });
  const project=(await fixture.db.query("select p.id,p.name from projects p join canvases c on c.project_id=p.id where c.id=$1",[fixture.canvasId])).rows[0];
  project.name="网站介绍 · 服装新品发布与品牌形象视频制作工程";
  await fixture.db.query("update projects set name=$2 where id=$1",[project.id,project.name]);
  const legacy=createBlankTemplateProject();
  legacy.files["/project/src/Composition.tsx"]=legacy.files["/project/src/Composition.tsx"]!.replace("return null;","return <div>原画布的视频草稿</div>;");
  const standalone=createBlankTemplateProject();
  standalone.files["/project/src/Composition.tsx"]=standalone.files["/project/src/Composition.tsx"]!.replace("return null;","return <div>独立草稿保留</div>;");
  const secondary=await browser.newContext({viewport:{width:1280,height:900}});
  try {
    await page.goto(`/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);
    await expect(page.getByRole("combobox",{name:"切换工程视图"})).toBeVisible({timeout:90_000});
    await expect(page.getByRole("status").filter({hasText:"已保存"})).toBeVisible({timeout:30_000});
    await page.evaluate(async ({userId,canvasId,legacy,standalone}) => {
      const request=indexedDB.open("loomic-visualforge-projects",4);
      request.onupgradeneeded=()=>{for(const name of ["projects","exports","editorPlans","editorChats"])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(["projects","editorChats"],"readwrite");
        tx.objectStore("projects").put(legacy,`${userId}:canvas:${canvasId}`);
        tx.objectStore("projects").put(standalone,userId);
        tx.objectStore("editorChats").put({turns:[],draft:"保留旧画布对话草稿"},`${userId}:canvas:${canvasId}`);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
      });db.close();
    },{userId:fixture.userId,canvasId:fixture.canvasId,legacy,standalone});
    await page.getByRole("combobox",{name:"切换工程视图"}).click();
    await page.getByRole("option",{name:"视频剪辑",exact:true}).click();
    await expect(page).toHaveURL(/\/video\//,{timeout:30_000});
    await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90_000});
    await expect(page.getByTitle(project.name,{exact:true})).toBeVisible();
    await expect(page.getByLabel("与视频 AI 对话")).toHaveValue("保留旧画布对话草稿");
    await expect.poll(async()=>Number((await fixture.db.query("select count(*) as n from project_user_contexts where project_id=$1 and view='video' and composition_id='MyComp'",[project.id])).rows[0].n)).toBe(1);
    const readProject=async(key:string)=>page.evaluate(async key=>{
      const request=indexedDB.open("loomic-visualforge-projects",4);
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const tx=db.transaction("projects","readonly"),read=tx.objectStore("projects").get(key);
      const saved=await new Promise<any>((resolve,reject)=>{read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);});db.close();return saved;
    },key);
    expect((await readProject(`${fixture.userId}:project:${project.id}`)).files["/project/src/Composition.tsx"]).toContain("原画布的视频草稿");
    expect((await readProject(fixture.userId)).files["/project/src/Composition.tsx"]).toContain("独立草稿保留");
    await page.reload();
    await expect(page.getByLabel("导入本机素材",{exact:true})).toBeEnabled({timeout:90_000});
    await page.getByRole("navigation",{name:"工程视图"}).getByRole("link",{name:"画布",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`id=${fixture.canvasId}`));
    await expect(page.getByRole("combobox",{name:"切换工程视图"})).toBeVisible();

    const second=await secondary.newPage();await second.goto("http://localhost:3238/video/");
    await expect(second.getByText("当前设备没有这个视频工程的本机副本，请回原设备继续。画布和对话仍可打开。",{exact:true})).toBeVisible({timeout:90_000});
    await expect(second.getByTitle(project.name,{exact:true})).toBeVisible();
    await second.setViewportSize({width:638,height:900});
    await second.evaluate(()=>{document.documentElement.style.zoom="2";document.documentElement.classList.add("dark");});
    await expect(second.getByRole("combobox",{name:"切换工程视图"})).toBeVisible();
    await second.getByRole("combobox",{name:"切换工程视图"}).focus();
    await second.keyboard.press("Enter");
    await expect(second.getByRole("option",{name:"画布",exact:true})).toBeVisible();
    await second.keyboard.press("Escape");
    await expect(second.getByRole("combobox",{name:"切换工程视图"})).toBeFocused();
    const overflow=await second.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await second.screenshot({path:info.outputPath("project-context-narrow-dark.png"),fullPage:true});
    await second.evaluate(()=>{document.documentElement.style.zoom="";document.documentElement.classList.remove("dark");});
    await second.setViewportSize({width:1280,height:900});
    await second.getByRole("navigation",{name:"工程视图"}).getByRole("link",{name:"对话",exact:true}).click();
    await expect(second).toHaveURL(new RegExp(`session=${fixture.sessionId}`));
    await expect(second.getByRole("combobox",{name:"切换工程视图"})).toBeVisible();
  } finally {await secondary.close();await fixture.close();}
});
