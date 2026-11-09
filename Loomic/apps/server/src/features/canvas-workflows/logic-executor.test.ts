import {it,expect,vi} from "vitest";
import {executeLogicNode} from "./logic-executor.js";
import {shouldSkipStep} from "../agent-goals/step-routing.js";
const source={step_id:"input",state:"succeeded",output:{text:" hello ",json:{message:"hi"}}};
const input=(command:unknown)=>({step:{step_id:"node",command,depends_on:["input"],output:null},previous:[source],goal:{plan:{steps:[]}}}) as never;
it("executes text and JSON utilities without eval or a model",async()=>{
  expect(await executeLogicNode(input({executor:"text.transform",fromStep:"input",operation:"trim",search:"",replacement:""}))).toEqual({text:"hello"});
  expect(await executeLogicNode(input({executor:"text.template",fromStep:"input",template:"prefix {{text}}"}))).toEqual({text:"prefix  hello "});
  expect(await executeLogicNode(input({executor:"data.extract",fromStep:"input",path:"message"}))).toEqual({json:"hi",text:"hi"});
  await expect(executeLogicNode(input({executor:"data.extract",fromStep:"input",path:"nope"}))).rejects.toThrow("找不到");
});
it("marks nonmatching side-effect branches for skip before their executor or approval",()=>{
  const previous=[{step_id:"check",state:"succeeded",output:{condition:true}}],plan={steps:[{id:"generate",when:[{source:"check",branch:"false"}]}]};
  expect(shouldSkipStep(plan as never,{step_id:"generate",executor:"media.generate",depends_on:["check"]} as never,previous as never)).toBe(true);
  expect(shouldSkipStep(plan as never,{step_id:"merge",executor:"text.merge",depends_on:["check","skipped"]} as never,previous as never)).toBe(false);
});
it("uses a durable wake time for waiting nodes",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-09T00:00:00Z"));
  try{await expect(executeLogicNode(input({executor:"flow.delay",fromStep:"input",seconds:5}))).rejects.toMatchObject({output:{resumeAt:"2026-11-09T00:00:05.000Z"}});const next=input({executor:"flow.delay",fromStep:"input",seconds:5}) as unknown as {step:{output:unknown}};next.step.output={resumeAt:"2026-11-08T23:59:55.000Z"};expect(await executeLogicNode(next as never)).toMatchObject({text:" hello ",waitedSeconds:5});}finally{vi.useRealTimers();}
});
