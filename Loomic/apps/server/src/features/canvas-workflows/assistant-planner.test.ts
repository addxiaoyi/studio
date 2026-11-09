import {expect,it} from "vitest";
import {parseWorkflowAssistantPlan} from "./assistant-planner.js";
it("accepts structured controls and rejects executable text or unrecognized actions",()=>{
  expect(parseWorkflowAssistantPlan('{"action":"pause","summary":"暂停当前运行"}')).toEqual({action:"pause",summary:"暂停当前运行"});
  expect(parseWorkflowAssistantPlan('{"action":"run","targetNodeId":"capture","summary":"只执行到录制"}')).toMatchObject({action:"run",targetNodeId:"capture"});
  expect(()=>parseWorkflowAssistantPlan('execute("charge")')).toThrow("有效");
  expect(()=>parseWorkflowAssistantPlan('{"action":"approve_payment","summary":"扣费"}')).toThrow("不受支持");
});
it("fills only irrelevant defaults for model-authored batch operations",()=>{
  const base={position:{x:0,y:0}};
  const plan={action:"edit",summary:"整理列表",graph:{title:"批量",nodes:[{...base,id:"split",title:"拆分",config:{kind:"split",source:"json",maxItems:3}},{...base,id:"batch",title:"处理",config:{kind:"batch",maxItems:3,batchSize:1,operations:[{kind:"transform",operation:"uppercase"}]}}],edges:[]}};
  const parsed=parseWorkflowAssistantPlan(JSON.stringify(plan));
  expect(parsed.graph?.nodes[0]?.config).toMatchObject({path:"",separator:"\n"});
  expect(parsed.graph?.nodes[1]?.config).toMatchObject({operations:[{kind:"transform",operation:"uppercase",search:"",replacement:""}]});
  plan.graph.nodes[1]!.config={kind:"batch",maxItems:101,batchSize:1,operations:[{kind:"transform",operation:"uppercase"}]} as never;
  expect(()=>parseWorkflowAssistantPlan(JSON.stringify(plan))).toThrow("不受支持");
});
