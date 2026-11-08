import {expect,it} from "vitest";
import {parseWorkflowAssistantPlan} from "./assistant-planner.js";
it("accepts structured controls and rejects executable text or unrecognized actions",()=>{
  expect(parseWorkflowAssistantPlan('{"action":"pause","summary":"暂停当前运行"}')).toEqual({action:"pause",summary:"暂停当前运行"});
  expect(parseWorkflowAssistantPlan('{"action":"run","targetNodeId":"capture","summary":"只执行到录制"}')).toMatchObject({action:"run",targetNodeId:"capture"});
  expect(()=>parseWorkflowAssistantPlan('execute("charge")')).toThrow("有效");
  expect(()=>parseWorkflowAssistantPlan('{"action":"approve_payment","summary":"扣费"}')).toThrow("不受支持");
});
