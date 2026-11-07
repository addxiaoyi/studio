import type { VideoEditorAction } from "@helstera/shared";
import { validateStudioCut, type StudioCut } from "./studio-cut";

export function actionCut(actions: VideoEditorAction[], base: { duration: number; format: StudioCut["format"]; cut?: StudioCut | null }): { cut: StudioCut; replaceVideo: boolean } {
  const cuts = actions.filter(action => action.type === "cut");
  if (cuts.length > 1) throw new Error("一次方案只能包含一个剪辑动作。");
  const visuals = cuts[0];
  const transitionActions=actions.filter(action=>action.type==="transition");
  if(transitionActions.length&&!visuals&&!base.cut)throw new Error("请先使用素材剪辑建立片段，再添加转场。");
  const captions = actions.filter(action => action.type === "caption").map(({ type: _type, ...caption }) => caption);
  const audio = actions.filter(action => action.type === "audio").map(({ type: _type, ...track }) => track);
  const images=actions.filter(action=>action.type==="image").map(({type:_type,...image})=>image);
  const replaces=Boolean(visuals)||transitionActions.length>0;
  const inherited=!visuals&&transitionActions.length?base.cut:undefined;
  const cut: StudioCut = {
    format: visuals?.format ?? base.format,
    clips: visuals?.clips.map((clip, index) => ({ ...clip, id: `clip-${index}` })) ?? inherited?.clips ?? [{ id: "existing", name: "current-composition", duration: base.duration, start: 0, end: base.duration }],
    captions:[...(inherited?.captions??[]),...captions], audio:[...(inherited?.audio??[]),...audio],images:[...(inherited?.images??[]),...images],
    transitions:[...(inherited?.transitions??[]).filter(item=>!transitionActions.some(action=>action.afterClip===item.afterClip)),...transitionActions.map(({type:_type,...transition})=>transition)],
  };
  validateStudioCut(cut);
  return { cut, replaceVideo: replaces };
}
