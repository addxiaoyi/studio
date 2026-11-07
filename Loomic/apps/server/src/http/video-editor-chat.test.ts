import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerVideoEditorRoutes } from "./video-editor.js";

const input = { prompt: "把刚才标题改为新品", projectId: "MyComp", compositionId: "MyComp", revision: "a".repeat(64), compositionDuration: 2, media: [], history: [{role:"user",content:"标题是欢迎"}], studio: { compositions:["MyComp"],currentFrame:0,fps:30,playing:false,muted:false,controls:["seek","undo"],undoable:[1] }, layers: [{id:"l1",label:"欢迎",kind:"div",text:"欢迎",startMs:0,endMs:2000,editable:["text"]}] };
function setup(reply: unknown) {
  const model = { invoke: vi.fn().mockResolvedValue({content:JSON.stringify(reply)}) };
  const save = vi.fn().mockResolvedValue({id:"123e4567-e89b-42d3-a456-426614174000",fingerprint:"b".repeat(64),expiresAt:"2099-01-01",estimatedCredits:0});
  const app=Fastify();registerVideoEditorRoutes(app,{auth:{authenticate:async()=>({id:"u"})} as never,env:{} as never,viewerService:{ensureViewer:async()=>({workspace:{id:"w"}})} as never,settingsService:{getChatModelConfig:async()=>({model:"openai:test"})} as never,createPlanModel:()=>model as never,planStore:{save} as never});
  return {app,model,save};
}
it("includes history and current layers, saving only a validated proposal",async()=>{
  const {app,model,save}=setup({message:"将已有标题改为新品，请确认。",plan:{summary:"修改标题",actions:[{type:"layer",layerId:"l1",changes:{text:"新品"}}]}});
  try {const response=await app.inject({method:"POST",url:"/api/video/editor/chat",payload:input});expect(response.statusCode).toBe(200);expect(response.json().approval).toBeDefined();expect(save).toHaveBeenCalledOnce();expect(JSON.stringify(model.invoke.mock.calls)).toContain("标题是欢迎");}finally{await app.close();}
});
it("answers questions without saving or executing a plan",async()=>{
  const {app,save}=setup({message:"当前视频2秒，有一条欢迎标题。"});
  try{const response=await app.inject({method:"POST",url:"/api/video/editor/chat",payload:input});expect(response.statusCode).toBe(200);expect(save).not.toHaveBeenCalled();}finally{await app.close();}
});
it("uses provider JSON output when the configured model supports it",async()=>{
  const {app,model,save}=setup({message:"unused"});
  const structured=vi.fn(()=>({invoke:vi.fn().mockResolvedValue({message:"当前视频2秒。"})}));
  Object.assign(model,{withStructuredOutput:structured});
  try{
    const response=await app.inject({method:"POST",url:"/api/video/editor/chat",payload:input});
    expect(response.statusCode).toBe(200);expect(response.json().reply.message).toBe("当前视频2秒。");
    expect(structured).toHaveBeenCalledWith(expect.anything(),{name:"video_reply",method:"jsonMode"});expect(model.invoke).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  }finally{await app.close();}
});
it.each([
  {message:"执行代码",control:{type:"shell",command:"bad"}},
  {message:"改标题",plan:{summary:"越界",actions:[{type:"layer",layerId:"other",changes:{text:"x"}}]}},
  {message:"撤销",control:{type:"undo",actionIndex:0}},
  {message:"定位",control:{type:"seek",seconds:20}},
])("rejects unrecognized or stale model actions",async reply=>{
  const {app,save}=setup(reply);try{expect((await app.inject({method:"POST",url:"/api/video/editor/chat",payload:input})).statusCode).toBe(422);expect(save).not.toHaveBeenCalled();}finally{await app.close();}
});
