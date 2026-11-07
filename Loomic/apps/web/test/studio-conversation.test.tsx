// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioConversationPanel } from "@/components/studio-conversation-panel";
import { requestStudioChat } from "@/lib/studio-chat";
import { confirmStudioPlan, completeStudioPlan } from "@/lib/studio-ai-edit";

vi.mock("@/lib/i18n",()=>({useLocale:()=>"zh-CN"}));
vi.mock("@/lib/visualforge-storage",()=>({readStudioChat:async()=>undefined,saveStudioChat:async()=>"u",saveStudioPlan:async()=>"u",clearStudioPlan:async()=>undefined}));
vi.mock("@/lib/studio-ai-session",()=>({readRecoveredStudioSession:async()=>null}));
vi.mock("@/lib/studio-chat",async original=>({...await original<typeof import("@/lib/studio-chat")>(),requestStudioChat:vi.fn()}));
vi.mock("@/lib/studio-ai-edit",async original=>({...await original<typeof import("@/lib/studio-ai-edit")>(),confirmStudioPlan:vi.fn(),completeStudioPlan:vi.fn()}));
const approval={id:"123e4567-e89b-42d3-a456-426614174000",fingerprint:"b".repeat(64),expiresAt:"2099-01-01",estimatedCredits:0 as const};
const initial={compositionId:"MyComp",revision:"a".repeat(64),duration:2,format:"landscape" as const,captions:[],cut:null,layers:[]};
function mount(){
  let snapshot:typeof initial & {appliedEdits?:string[]}=initial;
  const runtime={listMedia:()=>[],projectId:()=>"MyComp",snapshot:vi.fn(async()=>snapshot),studioState:vi.fn(async()=>({compositions:["MyComp"],currentFrame:0,fps:30,playing:false,muted:false,controls:["seek"],undoable:[]})),control:vi.fn(async()=>"已定位到 1 秒。"),applyEdit:vi.fn(async()=>{snapshot={...initial,revision:"c".repeat(64),appliedEdits:[approval.id]};})};
  render(<StudioConversationPanel runtime={runtime as never} mediaRevision={0} userId="u" token="t" exported={vi.fn()}/>);
  return {runtime,change:()=>{snapshot={...initial,revision:"d".repeat(64)};}};
}
async function send(text:string){await waitFor(()=>expect(screen.getByLabelText("与视频 AI 对话")).toBeEnabled());fireEvent.change(screen.getByLabelText("与视频 AI 对话"),{target:{value:text}});await waitFor(()=>expect(screen.getByRole("button",{name:"发送"})).toBeEnabled());fireEvent.click(screen.getByRole("button",{name:"发送"}));}
beforeEach(()=>{vi.mocked(completeStudioPlan).mockResolvedValue(undefined);vi.mocked(confirmStudioPlan).mockResolvedValue({id:approval.id,compositionId:"MyComp",revision:initial.revision,cut:{format:"landscape",clips:[]},replaceVideo:false});});
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("keeps multi-turn context and accepts only the explicit chat confirmation for a pending plan",async()=>{
  vi.mocked(requestStudioChat).mockResolvedValueOnce({source:"model",model:"test",reply:{message:"当前视频2秒。"}}).mockResolvedValueOnce({source:"model",model:"test",reply:{message:"准备加标题。",plan:{summary:"标题",actions:[{type:"caption",text:"你好",startMs:0,endMs:1000}]}},approval});
  const {runtime}=mount();await send("介绍当前视频");await screen.findByText("当前视频2秒。");await send("给它加标题");
  await screen.findByText("确认这些修改");expect(runtime.applyEdit).not.toHaveBeenCalled();
  expect(vi.mocked(requestStudioChat).mock.calls[1]?.[1].history).toEqual(expect.arrayContaining([expect.objectContaining({role:"user",content:"介绍当前视频"})]));
  await send("确认全部并执行");await screen.findByText("已按你明确确认的方案修改当前视频。可以继续对话调整或导出。");
  expect(runtime.applyEdit).toHaveBeenCalledOnce();expect(requestStudioChat).toHaveBeenCalledTimes(2);expect(confirmStudioPlan).toHaveBeenCalledWith("t",expect.anything(),new Set([0]));
});
it("executes requested playback controls and records their observed result",async()=>{
  vi.mocked(requestStudioChat).mockResolvedValue({source:"model",model:"test",reply:{message:"准备定位。",control:{type:"seek",seconds:1}}});
  const {runtime}=mount();await send("请把预览定位到1秒");await screen.findByText("已定位到 1 秒。");
  expect(runtime.control).toHaveBeenCalledOnce();expect(runtime.applyEdit).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"已完成"})).toBeDisabled();expect(screen.queryByRole("button",{name:"定位到 1 秒"})).not.toBeInTheDocument();
});
it("does not run a reply against a project changed while the model was thinking",async()=>{
  let reply!:(value:Awaited<ReturnType<typeof requestStudioChat>>)=>void;
  vi.mocked(requestStudioChat).mockReturnValue(new Promise(resolve=>{reply=resolve;}));
  const {runtime,change}=mount();await send("请把预览定位到1秒");await waitFor(()=>expect(requestStudioChat).toHaveBeenCalledOnce());change();
  reply({source:"model",model:"test",reply:{message:"定位",control:{type:"seek",seconds:1}}});
  expect(await screen.findByRole("alert")).toHaveTextContent("工程已改变");expect(runtime.control).not.toHaveBeenCalled();
});
it("handles an exact playback request immediately without another model call",async()=>{
  const {runtime}=mount();await send("定位到1秒");await screen.findByText("已定位到 1 秒。");
  expect(requestStudioChat).not.toHaveBeenCalled();expect(runtime.control).toHaveBeenCalledWith({type:"seek",seconds:1},"MyComp");
});
