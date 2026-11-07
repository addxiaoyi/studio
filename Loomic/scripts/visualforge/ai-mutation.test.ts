import { describe, expect, it } from "bun:test";
import { createBlankTemplateProject } from "../../vendor/visualforge/packages/browser-studio/src/templates/blank";
import { inspectComposition, prepareStudioEdit, prepareStudioUndo, projectFingerprint, type StudioEdit } from "./ai-mutation";

const compositionFile = "/project/src/Composition.tsx";
const id = "123e4567-e89b-42d3-a456-426614174000";
const cut = { format: "portrait" as const, clips: [{ id: "clip", name: "clip.mp4", duration: 5, start: 1, end: 4 }], captions: [{ text: "中文标题", startMs: 0, endMs: 1000 }], audio: [{ assetName: "music.wav", startMs: 1000, volume: 0.3 }] };

describe("current composition AI mutation", () => {
  it("undoes one caption or audio action after restart and restores the original cut last", async () => {
    const project = createBlankTemplateProject();
    const revision = await projectFingerprint(project, "MyComp");
    const edit: StudioEdit = { id, compositionId:"MyComp",revision,cut,replaceVideo:true,commands:[
      {type:"cut",format:"portrait",clips:cut.clips.map(({id:_id,...clip})=>clip)},
      {type:"caption",...cut.captions[0]!}, {type:"audio",...cut.audio[0]!},
    ] };
    let next=await prepareStudioEdit(project,compositionFile,edit);
    next=await prepareStudioUndo(structuredClone(next),compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(next,"MyComp"),actionIndex:1});
    expect(inspectComposition(next,compositionFile,"MyComp").captions).toEqual([]);
    expect(next.loomicCuts?.MyComp?.cut.audio).toEqual(cut.audio);
    const beforeDuplicate=next;
    next=await prepareStudioUndo(next,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(next,"MyComp"),actionIndex:1});
    expect(next).toBe(beforeDuplicate);
    next=await prepareStudioUndo(next,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(next,"MyComp"),actionIndex:2});
    expect(next.loomicCuts?.MyComp?.cut.audio).toEqual([]);
    next=await prepareStudioUndo(next,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(next,"MyComp"),actionIndex:0});
    expect(await projectFingerprint(next,"MyComp")).toBe(revision);
    expect(next.loomicEditJournals?.[id]?.undone).toEqual([0,1,2]);
    expect(next.loomicAppliedEdits).toContain(id);
    expect(await prepareStudioEdit(next,compositionFile,edit)).toBe(next);
  });

  it("blocks undo over manual edits and cut undo that would invalidate remaining layers", async () => {
    const project=createBlankTemplateProject();
    const lateCaption={text:"最后一秒",startMs:2000,endMs:3000};
    const next=await prepareStudioEdit(project,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(project,"MyComp"),cut:{...cut,captions:[lateCaption],audio:[]},replaceVideo:true,commands:[{type:"cut",format:"portrait",clips:cut.clips.map(({id:_id,...clip})=>clip)},{type:"caption",...lateCaption}]});
    const revision=await projectFingerprint(next,"MyComp");
    await expect(prepareStudioUndo(next,compositionFile,{id,compositionId:"MyComp",revision,actionIndex:0})).rejects.toThrow("先撤销");
    const changed={...next,files:{...next.files,"/project/src/manual.ts":"export const title='Manual';"}};
    await expect(prepareStudioUndo(changed,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(changed,"MyComp"),actionIndex:1})).rejects.toThrow("后续修改");
  });
  it("updates existing text and canvas through approved actions and undoes them separately",async()=>{
    const project=createBlankTemplateProject();
    project.files[compositionFile]=project.files[compositionFile]!.replace("return null;",'return <div style={{color:"#ffffff",fontSize:32}}>欢迎</div>;');
    const before=inspectComposition(project,compositionFile,"MyComp");
    const layer=before.layers.find(item=>item.text==="欢迎")!;
    const revision=await projectFingerprint(project,"MyComp");
    const edit:StudioEdit={id,compositionId:"MyComp",revision,cut,replaceVideo:false,commands:[{type:"layer",layerId:layer.id,changes:{text:"新品",fontSize:64,color:"#ff0000"}},{type:"resize",width:720,height:1280}]};
    let changed=await prepareStudioEdit(project,compositionFile,edit);
    expect(changed.files[compositionFile]).not.toContain(">欢迎<");expect(changed.files[compositionFile]).toContain('fontSize:64');
    expect(inspectComposition(changed,compositionFile,"MyComp")).toMatchObject({width:720,height:1280});
    changed=await prepareStudioUndo(changed,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(changed,"MyComp"),actionIndex:0});
    expect(inspectComposition(changed,compositionFile,"MyComp").layers.some(item=>item.text==="欢迎")).toBe(true);
    expect(inspectComposition(changed,compositionFile,"MyComp").height).toBe(1280);
    changed=await prepareStudioUndo(changed,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(changed,"MyComp"),actionIndex:1});
    expect(await projectFingerprint(changed,"MyComp")).toBe(revision);
  });
  it("persists editable GSAP keyframes and reverses a motion edit after reload",async()=>{
    const project=createBlankTemplateProject();project.files[compositionFile]=project.files[compositionFile]!.replace("return null;",'return <div>动起来</div>;');
    const before=inspectComposition(project,compositionFile,"MyComp"),revision=await projectFingerprint(project,"MyComp");
    const tracks=[{property:"opacity" as const,points:[{timeMs:0,value:0,ease:"none" as const},{timeMs:900,value:1,ease:"power2.out" as const}]}];
    const edit:StudioEdit={id,compositionId:"MyComp",revision,cut,replaceVideo:false,commands:[{type:"keyframes",layerId:before.layers[0]!.id,tracks}]};
    const applied=await prepareStudioEdit(project,compositionFile,edit);
    expect(applied.files["/project/src/loomic-gsap.js"]!.length).toBeGreaterThan(10000);
    expect(inspectComposition(applied,compositionFile,"MyComp").layers[0]?.motion).toEqual(tracks);
    const undone=await prepareStudioUndo(structuredClone(applied),compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(applied,"MyComp")});
    expect(await projectFingerprint(undone,"MyComp")).toBe(revision);
  });
  it("creates overlapping transition sequences and restores hard cuts on undo",async()=>{
    const project=createBlankTemplateProject();const clips=[{name:"a.mp4",duration:2,start:0,end:2},{name:"b.mp4",duration:2,start:0,end:2}];
    const edit:StudioEdit={id,compositionId:"MyComp",revision:await projectFingerprint(project,"MyComp"),cut,replaceVideo:true,commands:[{type:"cut",format:"landscape",clips},{type:"transition",afterClip:0,style:"fade",durationMs:500}]};
    const applied=await prepareStudioEdit(project,compositionFile,edit);
    expect(inspectComposition(applied,compositionFile,"MyComp").duration).toBe(3.5);
    const reverted=await prepareStudioUndo(applied,compositionFile,{id,compositionId:"MyComp",revision:await projectFingerprint(applied,"MyComp"),actionIndex:1});
    expect(inspectComposition(reverted,compositionFile,"MyComp").duration).toBe(4);
  });
  it("isolates a duplicated composition before editing its shared source",async()=>{
    const project=createBlankTemplateProject();
    project.files[compositionFile]=project.files[compositionFile]!.replace("return null;",'return <div>原始图片标题</div>;').replace("<Composition","<><Composition").replace("    />","    /><Composition id=\"Copy\" component={MyComponent} durationInFrames={60} fps={30} width={1280} height={720}/></>");
    const revision=await projectFingerprint(project,"Copy");
    const changed=await prepareStudioEdit(project,compositionFile,{id,compositionId:"Copy",revision,cut,replaceVideo:false,commands:[{type:"layer",layerId:"layer-0",changes:{text:"副本修改"}}]});
    expect(inspectComposition(changed,compositionFile,"MyComp").layers[0]?.text).toBe("原始图片标题");
    expect(inspectComposition(changed,compositionFile,"Copy").layers[0]?.text).toBe("副本修改");
    const undone=await prepareStudioUndo(changed,compositionFile,{id,compositionId:"Copy",revision:await projectFingerprint(changed,"Copy")});
    expect(await projectFingerprint(undone,"Copy")).toBe(revision);
  });
  it("reads native BasicCaptions under nested sequences and clips to their visible range", () => {
    const project = createBlankTemplateProject();
    project.files[compositionFile] = 'import {BasicCaptions as Subtitles} from "./basic-captions.element";\n' + project.files[compositionFile]!.replace("return null;", 'return <Sequence from={15} durationInFrames={30}><Subtitles from={15} captions={[{text:"原生字幕",startMs:0,endMs:1500,timestampMs:null,confidence:null}]} /></Sequence>;');
    expect(inspectComposition(project, compositionFile, "MyComp").captions).toEqual([{ text: "原生字幕", startMs: 1000, endMs: 1500 }]);
  });

  it("fails explicitly for dynamic native caption data instead of pretending there are no captions", () => {
    const project = createBlankTemplateProject();
    project.files[compositionFile] = 'import {BasicCaptions} from "./basic-captions.element";\n' + project.files[compositionFile]!.replace("return null;", 'return <BasicCaptions captions={loadCaptions()} />;');
    expect(() => inspectComposition(project, compositionFile, "MyComp")).toThrow("字幕");
  });
  it("accepts the relative composition path returned by the live Studio", () => {
    expect(inspectComposition(createBlankTemplateProject(), "src/Composition.tsx", "MyComp").duration).toBe(2);
  });
  it("appends layers to an empty component without rendering a literal null", async () => {
    const project = createBlankTemplateProject();
    const next = await prepareStudioEdit(project, compositionFile, { id, compositionId: "MyComp", revision: await projectFingerprint(project, "MyComp"), cut, replaceVideo: false });
    expect(next.files[compositionFile]).not.toContain("<>null");
    expect(inspectComposition(next, compositionFile, "MyComp").captions).toEqual(cut.captions);
  });

  it("reads only captions rendered by the selected component, including nested timing", () => {
    const project = createBlankTemplateProject();
    project.files[compositionFile] = project.files[compositionFile]!.replace("return null;", 'return <Sequence from={30}><Sequence name="字幕" from={0} durationInFrames={15}><div>{"当前"}</div></Sequence></Sequence>;') + '\nexport const Other = () => <Sequence name="字幕" from={0} durationInFrames={30}><div>{"其他合成"}</div></Sequence>;';
    expect(inspectComposition(project, compositionFile, "MyComp").captions).toEqual([{ text: "当前", startMs: 1000, endMs: 1500 }]);
  });

  it("uses the current frame rate for appended captions and music", async () => {
    const project = createBlankTemplateProject();
    project.files[compositionFile] = project.files[compositionFile]!.replace("fps={30}", "fps={60}").replace("durationInFrames={60}", "durationInFrames={180}");
    const next = await prepareStudioEdit(project, compositionFile, { id, compositionId: "MyComp", revision: await projectFingerprint(project, "MyComp"), cut, replaceVideo: false });
    expect(inspectComposition(next, compositionFile, "MyComp").captions).toEqual(cut.captions);
    const layer = Object.values(next.files).find(source => source.includes('name="背景音乐"'))!;
    expect(layer).toContain('from={60}');
  });
  it("updates the current composition, duration and format atomically and recognizes its captions", async () => {
    const project = createBlankTemplateProject();
    const edit: StudioEdit = { id, compositionId: "MyComp", revision: await projectFingerprint(project, "MyComp"), cut, replaceVideo: true };
    const next = await prepareStudioEdit(project, compositionFile, edit);
    expect(next.files[compositionFile]).toContain('id="MyComp"');
    expect(next.files[compositionFile]).toContain("durationInFrames={90}");
    expect(next.files[compositionFile]).toContain("height={1280}");
    expect(inspectComposition(next, compositionFile, "MyComp").captions).toEqual(cut.captions);
    expect(next.loomicCuts?.MyComp?.cut.audio).toEqual(cut.audio);
    expect(await prepareStudioEdit(next, compositionFile, edit)).toBe(next);
    expect(project.files[compositionFile]).toContain("return null;");
  });

  it("rejects stale revisions and preserves existing content for subtitle-only actions", async () => {
    const project = createBlankTemplateProject();
    const revision = await projectFingerprint(project, "MyComp");
    const changed = { ...project, files: { ...project.files, [compositionFile]: project.files[compositionFile]!.replace("return null;", 'return <div>Original</div>;') } };
    const edit: StudioEdit = { id, compositionId: "MyComp", revision, cut: { ...cut, clips: [{ ...cut.clips[0]!, end: 3 }], audio: [] }, replaceVideo: false };
    await expect(prepareStudioEdit(changed, compositionFile, edit)).rejects.toThrow("已改变");
    const next = await prepareStudioEdit(changed, compositionFile, { ...edit, revision: await projectFingerprint(changed, "MyComp") });
    expect(next.files[compositionFile]).toContain("<div>Original</div>");
    expect(next.loomicCuts?.MyComp).toBeUndefined();
    const layer = Object.values(next.files).find(source => source.includes('name="字幕"'))!;
    expect(layer).not.toContain("<Video");
    expect(layer).toContain('backgroundColor:"transparent"');
  });
});
