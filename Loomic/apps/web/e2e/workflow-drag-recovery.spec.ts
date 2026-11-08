import {test,expect,_electron,type ElectronApplication} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {websiteWorkflow} from "@helstera/shared";
import {createWorkflowFixture} from "../../server/src/features/canvas-workflows/browser-fixture";
import {CanvasWorkflowService} from "../../server/src/features/canvas-workflows/service";
import {projectWorkflow} from "../src/components/workflow/scene";
test("reloads stale node locks, keeps view gestures read-only across tabs, and preserves recovery",async({page},info)=>{
  const browserPage=page;const fixture=await createWorkflowFixture(process.env.DATABASE_URL!,"http://localhost:3228"),directory=await mkdtemp(join(tmpdir(),"drag-recovery-"));let desktop:ElectronApplication|undefined;
  let second:typeof page|undefined;
  try{
    const routeCandidate=async(target:typeof page)=>{if(process.env.HELT_WORKFLOW_STATIC_ROOT)await target.route("http://localhost:3001/**",async route=>{const response=await route.fetch({url:route.request().url().replace("http://localhost:3001","http://localhost:3315")});await route.fulfill({response});});};await routeCandidate(browserPage);
    const graph=websiteWorkflow();graph.title="拖动恢复验收";graph.nodes[0]!.config={kind:"url",url:"https://example.com"};graph.nodes.forEach((node,index)=>node.position={x:440+index*390,y:220+(index%2)*120});
    const flow=await new CanvasWorkflowService(fixture.db).create(fixture.userId,fixture.canvasId,graph,randomUUID());
    const elements=projectWorkflow([],flow.id,graph,{},true),content={elements,appState:{viewBackgroundColor:"#ffffff",gridModeEnabled:false},files:{}};
    await fixture.db.query("update canvases set content=$2::jsonb where id=$1",[fixture.canvasId,JSON.stringify(content)]);
    if(process.env.HELT_TEST_CANDIDATE_PATH){await browserPage.goto(`http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);await expect(browserPage.getByRole("button",{name:"打开可视化工作流"})).toBeVisible();const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:directory,HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3228"};delete env.ELECTRON_RUN_AS_NODE;desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();}
    page.on("pageerror",error=>console.error("[drag-page]",error.message));
    if(desktop)await routeCandidate(page);
    const url=`http://localhost:3228/${desktop?"desktop-app/":""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`;
    let writes=0;page.on("request",request=>{if(request.method()==="PUT"&&request.url().endsWith(`/api/canvases/${fixture.canvasId}`))writes++;});
    await page.setViewportSize({width:1700,height:960});await page.goto(url);await page.getByRole("button",{name:"打开可视化工作流"}).click();const dock=page.getByRole("region",{name:"可视化工作流",exact:true});
    await expect(dock.getByRole("button",{name:/网址输入 目标网址/})).toBeVisible();await dock.getByRole("button",{name:"定位流程节点",exact:true}).click();
    const node=page.locator('[data-workflow-node="site"]');let last="";await expect.poll(async()=>{const now=JSON.stringify(await node.boundingBox()),same=now===last;last=now;return same;}).toBe(true);
    await page.waitForTimeout(1800);const before=writes;
    await dock.getByRole("button",{name:/网址输入 目标网址/}).click();await page.getByRole("button",{name:"缩小",exact:true}).press("Enter");await page.getByRole("button",{name:"放大",exact:true}).press("Enter");
    await page.waitForTimeout(1800);expect(writes).toBe(before);
    second=desktop?browserPage:await page.context().newPage();if(!desktop)await routeCandidate(second);await second.goto(`http://localhost:3228/canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`);await second.getByRole("button",{name:"打开可视化工作流"}).click();await expect(second.getByRole("region",{name:"可视化工作流",exact:true})).toContainText("拖动恢复验收");await second.close();second=undefined;
    await page.bringToFront();await dock.getByRole("button",{name:"定位流程节点",exact:true}).click();await expect.poll(async()=>{const now=JSON.stringify(await node.boundingBox()),same=now===last;last=now;return same;}).toBe(true);
    await page.keyboard.press("Escape");await page.keyboard.press("v");const box=(await node.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+25);await page.mouse.down();await page.mouse.move(box.x+box.width/2+48,box.y+90,{steps:20});await page.mouse.up();
    await expect.poll(async()=>{const scene=(await fixture.db.query("select content from canvases where id=$1",[fixture.canvasId])).rows[0].content.elements;return scene.find((el:{id:string})=>el.id===elements[0]!.id)?.y;}).toBeGreaterThan(270);
    await expect(page.getByRole("alert").filter({hasText:"画布已在其它窗口"})).toHaveCount(0);
    expect((await fixture.db.query("select content from canvases where id=$1",[fixture.canvasId])).rows[0].content.elements.filter((el:{customData?:{workflow?:unknown};locked?:boolean})=>el.customData?.workflow).every((el:{locked?:boolean})=>el.locked===false)).toBe(true);
    await dock.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(dock.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
    const key=`helstera:canvas-recovery:${fixture.canvasId}`,copy={savedAt:Date.now(),content:{...content,elements:[...elements,{id:"recovered-note",type:"text",text:"必须保留的本机草稿",x:100,y:100,width:200,height:40}]}};
    await page.evaluate(({key,copy})=>localStorage.setItem(key,JSON.stringify(copy)),{key,copy});await page.reload();await expect(page.getByRole("button",{name:"下载本机副本"})).toBeVisible();
    await page.getByRole("button",{name:"打开可视化工作流"}).click();await page.getByRole("button",{name:"缩小",exact:true}).click();await page.waitForTimeout(1800);
    expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toEqual(copy);
    if(desktop){const destination=join(directory,"canvas-recovery.json");await desktop.evaluate(({BrowserWindow},path)=>{BrowserWindow.getAllWindows()[0]!.webContents.session.once("will-download",(_event,item)=>item.setSavePath(path));},destination);await page.getByRole("button",{name:"下载本机副本"}).click();await expect.poll(async()=>{try{return JSON.parse(await readFile(destination,"utf8")).content.elements.some((element:{id:string})=>element.id==="recovered-note");}catch(error){if((error as {code?:string}).code==="ENOENT")return false;throw error;}}).toBe(true);}else{const download=page.waitForEvent("download");await page.getByRole("button",{name:"下载本机副本"}).click();expect((await download).suggestedFilename()).toContain("canvas-recovery");}
    await page.screenshot({path:info.outputPath("node-drag-recovery.png")});
    await page.getByRole("button",{name:"丢弃",exact:true}).click();
    expect((await fixture.db.query("select count(*)::int as n from agent_goals")).rows[0].n).toBe(0);
  }catch(cause){console.error("[drag-recovery]",cause);await page.screenshot({path:info.outputPath("drag-recovery-failed.png")});throw cause;}finally{await second?.close();if(desktop){const process=desktop.process();await Promise.race([desktop.close(),new Promise<void>(resolve=>{const timer=setTimeout(()=>{process.kill();resolve();},5000);timer.unref();})]);}await fixture.close();await rm(directory,{recursive:true,force:true});}
});
