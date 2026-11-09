import {test,expect,_electron,type ElectronApplication} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layoutWorkflow,type WorkflowGraph} from "@helstera/shared";
import {CanvasWorkflowService} from "../../server/src/features/canvas-workflows/service";
import {createWorkflowFixture} from "../../server/src/features/canvas-workflows/browser-fixture";
import {projectWorkflow} from "../src/components/workflow/scene";

test("IF routes real text, groups survive collapse, and pinned output is reused",async({page},info)=>{
  const fixture=await createWorkflowFixture(process.env.DATABASE_URL!,"http://localhost:3228"),folder=await mkdtemp(join(tmpdir(),"workflow-logic-"));let desktop:ElectronApplication|undefined;
  try{
    const position={x:0,y:0};
    const graph=layoutWorkflow({title:"IF 文字流程",nodes:[
      {id:"source",title:"输入文字",position,config:{kind:"text",role:"story",text:"hello"}},
      {id:"check",title:"条件检查",position,note:"仅处理包含 hello 的内容",config:{kind:"condition",conditions:[{field:"text",operator:"contains",value:"hello"}],match:"all"}},
      {id:"yes",title:"大写处理",position,config:{kind:"transform",operation:"uppercase",search:"",replacement:""}},
      {id:"no",title:"备用模板",position,config:{kind:"template",template:"fallback {{text}}"}},
      {id:"merge",title:"合并文字",position,config:{kind:"merge",separator:"\n"}},
      {id:"delay",title:"稍后交付",position,config:{kind:"delay",seconds:1}},
      {id:"output",title:"交付",position,config:{kind:"deliver"}},
    ],edges:[{id:"a",source:"source",target:"check"},{id:"b",source:"check",target:"yes",branch:"true"},{id:"c",source:"check",target:"no",branch:"false"},{id:"d",source:"yes",target:"merge"},{id:"e",source:"no",target:"merge"},{id:"f",source:"merge",target:"delay"},{id:"g",source:"delay",target:"output"}],groups:[{id:"inputs",title:"输入判断",note:"资料与判断",nodeIds:["source","check"],collapsed:false}]} satisfies WorkflowGraph);
    const service=new CanvasWorkflowService(fixture.db),flow=await service.create(fixture.userId,fixture.canvasId,graph,randomUUID());
    await fixture.db.query("update canvases set content=$2::jsonb where id=$1",[fixture.canvasId,JSON.stringify({elements:projectWorkflow([],flow.id,graph,{},false),appState:{scrollX:0,scrollY:0,zoom:{value:1}},files:{}})]);
    if(process.env.HELT_TEST_CANDIDATE_PATH){const env={...process.env,HELSTERA_ISOLATED_TEST:"1",HELSTERA_TEST_USER_DATA:folder,HELSTERA_DESKTOP_LOCAL_URL:"http://localhost:3228"};delete env.ELECTRON_RUN_AS_NODE;desktop=await _electron.launch({executablePath:process.env.HELT_TEST_CANDIDATE_PATH,env:env as Record<string,string>,timeout:45000});page=await desktop.firstWindow();}
    await page.setViewportSize({width:1700,height:1000});
    page.on("console",message=>{if(message.type()==="error"&&/Route error|TypeError|ReferenceError|Maximum update/.test(message.text()))console.error("[logic-page]",message.text());});
    const url=`http://localhost:3228/${desktop?"desktop-app/":""}canvas/?id=${fixture.canvasId}&session=${fixture.sessionId}`;
    await page.goto(url);await page.getByRole("button",{name:"打开可视化工作流",exact:true}).click();
    const dock=page.getByRole("region",{name:"可视化工作流",exact:true});
    await dock.getByRole("button",{name:"折叠分组输入判断",exact:true}).click();
    await dock.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(dock.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
    await page.reload();await page.getByRole("button",{name:"打开可视化工作流",exact:true}).click();
    await expect(dock.getByRole("button",{name:"展开分组输入判断",exact:true})).toBeVisible();
    expect((await service.get(fixture.userId,fixture.canvasId,flow.id)).graph.nodes).toHaveLength(7);
    await dock.getByRole("button",{name:"展开分组输入判断",exact:true}).click();
    await dock.getByRole("button",{name:/IF 条件分支 条件检查/}).click();
    await expect(dock.getByRole("textbox",{name:"条件1字段",exact:true})).toHaveValue("text");
    await dock.getByText("节点备注 · 已填写",{exact:true}).click();await expect(dock.getByRole("textbox",{name:"备注",exact:true})).toHaveValue("仅处理包含 hello 的内容");
    await dock.getByRole("button",{name:"保存并运行",exact:true}).click();await page.getByRole("button",{name:"确认运行已保存版本",exact:true}).click();
    await expect(dock.getByRole("region",{name:"工作流运行记录",exact:true})).toContainText("全部完成",{timeout:30000});
    await expect(dock).toContainText("已跳过");
    const run=(await service.runs(fixture.userId,fixture.canvasId,flow.id))[0]!;
    const steps=(await fixture.db.query("select step_id,output,attempt from agent_goal_steps where goal_id=$1 order by ordinal",[run.goalId])).rows;
    expect(steps.find(step=>step.step_id==="no")).toMatchObject({attempt:0,output:{skipped:true}});
    expect(steps.find(step=>step.step_id==="merge").output.text).toBe("HELLO");
    await dock.getByRole("button",{name:"定位节点：输入文字",exact:true}).click();await dock.getByRole("button",{name:"输出",exact:true}).click();
    await dock.getByRole("button",{name:"固定此结果",exact:true}).click();await dock.getByRole("button",{name:"保存草稿",exact:true}).click();await expect(dock.getByRole("button",{name:"已保存",exact:true})).toBeDisabled();
    await expect(dock.getByRole("button",{name:"取消固定",exact:true})).toBeVisible();
    await dock.getByRole("button",{name:"运行流程",exact:true}).click();await expect(page.getByRole("dialog",{name:"确认运行「IF 文字流程」"})).toContainText("复用固定结果");await page.getByRole("button",{name:"确认运行已保存版本",exact:true}).click();
    await expect(dock.getByRole("region",{name:"工作流运行记录",exact:true})).toContainText("全部完成",{timeout:30000});
    const latest=(await service.runs(fixture.userId,fixture.canvasId,flow.id))[0]!;
    expect((await fixture.db.query("select executor,output from agent_goal_steps where goal_id=$1 and step_id='source'",[latest.goalId])).rows[0]).toMatchObject({executor:"result.pinned",output:{pinned:true,text:"hello"}});
    expect((await fixture.db.query("select count(*)::int as n from background_jobs")).rows[0].n).toBe(0);
    await page.screenshot({path:info.outputPath("logic-pinned-run.png")});
  }finally{await desktop?.close();await fixture.close();await rm(folder,{recursive:true,force:true});}
});
