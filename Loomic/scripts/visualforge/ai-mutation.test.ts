import { describe, expect, it } from "bun:test";
import { createBlankTemplateProject } from "../../vendor/visualforge/packages/browser-studio/src/templates/blank";
import { inspectComposition, prepareStudioEdit, projectFingerprint, type StudioEdit } from "./ai-mutation";

const compositionFile = "/project/src/Composition.tsx";
const id = "123e4567-e89b-42d3-a456-426614174000";
const cut = { format: "portrait" as const, clips: [{ id: "clip", name: "clip.mp4", duration: 5, start: 1, end: 4 }], captions: [{ text: "中文标题", startMs: 0, endMs: 1000 }], audio: [{ assetName: "music.wav", startMs: 1000, volume: 0.3 }] };

describe("current composition AI mutation", () => {
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
