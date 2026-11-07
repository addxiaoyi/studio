import type { VideoEditorAction } from "@helstera/shared";
import { validateStudioCut, type StudioCut } from "./studio-cut";

export function actionCut(actions: VideoEditorAction[], base: { duration: number; format: StudioCut["format"]; cut?: StudioCut | null }): { cut: StudioCut; replaceVideo: boolean } {
  const cuts = actions.filter(action => action.type === "cut");
  if (cuts.length > 1) throw new Error("一次方案只能包含一个剪辑动作。");
  const visuals = cuts[0];
  const captions = actions.filter(action => action.type === "caption").map(({ type: _type, ...caption }) => caption);
  const audio = actions.filter(action => action.type === "audio").map(({ type: _type, ...track }) => track);
  const cut: StudioCut = {
    format: visuals?.format ?? base.format,
    clips: visuals?.clips.map((clip, index) => ({ ...clip, id: `clip-${index}` })) ?? [{ id: "existing", name: "current-composition", duration: base.duration, start: 0, end: base.duration }],
    captions, audio,
  };
  validateStudioCut(cut);
  return { cut, replaceVideo: Boolean(visuals) };
}
