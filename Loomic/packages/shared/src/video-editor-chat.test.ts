import { expect, it } from "vitest";
import { videoChatReplySchema, validateStudioControl } from "./video-editor-chat.js";
import { videoEditorPlanSchema, validateVideoEditorPlan } from "./video-editor-contracts.js";
const input={prompt:"改标题",projectId:"MyComp",compositionDuration:2,media:[],history:[],locale:"zh-CN" as const,studio:{compositions:["MyComp"],currentFrame:0,fps:30,playing:false,muted:false,controls:["seek" as const,"undo" as const],undoable:[1]},layers:[{id:"l1",label:"标题",kind:"div",startMs:0,endMs:1000,editable:["text" as const],values:{color:"white",fontSize:42}}]};
it("validates native layer identity and restricts editable properties",()=>{
  const plan=videoEditorPlanSchema.parse({summary:"修改",actions:[{type:"layer",layerId:"l1",changes:{text:"新品"}}]});
  expect(()=>validateVideoEditorPlan(plan,input)).not.toThrow();
  expect(()=>validateVideoEditorPlan({...plan,actions:[{type:"layer",layerId:"l2",changes:{text:"新品"}}]},input)).toThrow("图层");
  expect(()=>validateVideoEditorPlan({...plan,actions:[{type:"layer",layerId:"l1",changes:{x:10}}]},input)).toThrow("图层");
});
it("rejects unapproved command types and conflicting response stages",()=>{
  expect(videoChatReplySchema.safeParse({message:"执行",control:{type:"confirm"}}).success).toBe(false);
  expect(videoChatReplySchema.safeParse({message:"执行",control:{type:"play"},plan:{summary:"剪辑",actions:[{type:"resize",width:720,height:1280}]}}).success).toBe(false);
  expect(()=>validateStudioControl({type:"undo",actionIndex:0},input)).toThrow("撤销");
  expect(()=>validateStudioControl({type:"seek",seconds:3},input)).toThrow("时长");
});
