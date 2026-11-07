// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeModelPlan } from "@/lib/studio-ai-edit";
import { studioTimelineDiff } from "@/lib/studio-timeline-diff";
import { StudioTimelineDiff } from "@/components/studio-timeline-diff";
vi.mock("@/lib/i18n", () => ({ useLocale: () => "zh-CN" }));
afterEach(cleanup);
const snapshot = { compositionId:"MyComp",revision:"a".repeat(64),duration:4,format:"landscape" as const,captions:[{text:"原字幕",startMs:0,endMs:1000}],cut:null };
const plan = { ...normalizeModelPlan({summary:"剪辑字幕配乐",actions:[
  {type:"cut",format:"portrait",clips:[{name:"a.mp4",duration:4,start:1,end:3},{name:"b.mp4",duration:3,start:0,end:1}]},
  {type:"caption",text:"新字幕",startMs:500,endMs:2500},
  {type:"audio",assetName:"music.wav",startMs:500,volume:0.3}, {type:"export",format:"mp4"},
]},snapshot), mediaDurations:{"music.wav":1} };
it("compares ordered clips, replaced captions, music length and shared time scale", () => {
  const diff=studioTimelineDiff(plan)!;
  expect(diff.scale).toBe(4);expect(diff.after.duration).toBe(3);
  expect(diff.after.video.map(clip=>[clip.start,clip.end])).toEqual([[0,2],[2,3]]);
  expect(diff.before.captions[0]?.label).toBe("原字幕");expect(diff.after.captions.map(c=>c.label)).toEqual(["新字幕"]);
  expect(diff.after.audio[0]).toMatchObject({start:0.5,end:1.5,detail:"30%",actionIndex:2});
  expect(diff.before.audioKnown).toBe(false);
  const undone=studioTimelineDiff(plan,[0,1,2])!;
  expect(undone.after.duration).toBe(4);expect(undone.after.format).toBe("landscape");expect(undone.after.captions).toEqual(undone.before.captions);
});
it("shows interactive before and after tracks without mutating a plan", async () => {
  const before=JSON.stringify(plan);render(<StudioTimelineDiff plan={plan} undone={[]} applied={false} />);
  fireEvent.click(screen.getByRole("button",{name:"查看时间线差异"}));
  expect(await screen.findByRole("dialog")).toBeVisible();expect(screen.getByRole("region",{name:"修改前"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"字幕: 新字幕, 0.5s–2.5s"}));
  expect(screen.getByRole("status")).toHaveTextContent("动作 2");expect(JSON.stringify(plan)).toBe(before);
});
it("previews edits to existing captions and canvas without altering the original tracks",()=>{
  const current={...snapshot,width:1280,height:720,layers:[{id:"layer-1",label:"原字幕",kind:"div",text:"原字幕",startMs:0,endMs:1000,editable:["text" as const]}]};
  const editing=normalizeModelPlan({summary:"改标题和画幅",actions:[{type:"layer",layerId:"layer-1",changes:{text:"新标题"}},{type:"resize",width:720,height:1280}]},current);
  const diff=studioTimelineDiff(editing)!;
  expect(diff.before.captions[0]?.label).toBe("原字幕");expect(diff.after.captions[0]?.label).toBe("新标题");expect(diff.after.format).toBe("portrait");expect(diff.details).toHaveLength(2);
});
