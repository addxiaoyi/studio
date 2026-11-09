export function studioDisplayName(name: string, english = false): string {
  const labels: Record<string, string> = english
    ? {
        CanvasImage: "Image",
        "<Img>": "Image",
        "<Video>": "Video",
        "<Audio>": "Audio",
        "<AbsoluteFill>": "Layout",
      }
    : {
        CanvasImage: "图片",
        "<Img>": "图片",
        "<Video>": "视频",
        "<Audio>": "音频",
        "<AbsoluteFill>": "画面布局",
      };
  if (labels[name]) return labels[name];
  if (/^Canvas-[a-f\d]{16}$/i.test(name))
    return english ? "Canvas film" : "画布成片";
  if (/^layer-\d+$/.test(name))
    return `${english ? "Layer" : "图层"} ${Number(name.slice(6)) + 1}`;
  const shortened = name.replace(
    /^generated-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}-/i,
    "",
  );
  if (/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\./i.test(shortened))
    return `${english ? "Imported media" : "导入素材"} · ${shortened.split(".").at(-1)?.toUpperCase()}`;
  return shortened;
}
