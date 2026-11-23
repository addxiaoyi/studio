type MediaType = "image" | "video";

function isGarbageLabel(value: string) {
  return /\uFFFD|[\u0370-\u03FF]/.test(value);
}

function cleanVideoName(modelId: string, displayName: string): string {
  const id = modelId.toLowerCase();
  const known: Record<string, string> = {
    "minimax-h3": "MiniMax H3",
    "minimax-h3-max": "MiniMax H3 Max",
    "hailuo-h3": "Hailuo H3",
    "hailuo-h3-cankaosheng": "Hailuo H3 Reference",
    "hailuo-h3-quannengcankao": "Hailuo H3 Omni Reference",
    "hailuo-h3-shouweizhen": "Hailuo H3 First/Last Frame",
    "hailuo-h3-max-shouweizhen": "Hailuo H3 Max First/Last Frame",
  };
  if (known[id]) return known[id];
  if (displayName && !isGarbageLabel(displayName)) return displayName;
  return modelId
    .split(/[/:]/)
    .pop()!
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function videoPresentation(modelId: string, displayName: string) {
  const identity = modelId.toLowerCase();
  const name = cleanVideoName(modelId, displayName);
  if (identity.includes("shouweizhen")) return { displayName: name, description: "First/last-frame video generation" };
  if (identity.includes("cankaosheng") || identity.includes("r2v") || identity.includes("videoref")) return { displayName: name, description: "Reference-to-video generation" };
  if (identity.includes("i2v") || identity.includes("image")) return { displayName: name, description: "Image-to-video generation" };
  if (identity.includes("edit") || identity.includes("animate")) return { displayName: name, description: "Video editing and animation" };
  return { displayName: name, description: "Text-to-video generation" };
}

export function getPublicModelPresentation(modelId: string, displayName: string, mediaType: MediaType) {
  const identity = `${modelId} ${displayName}`.toLowerCase();
  if (mediaType === "video") return videoPresentation(modelId, displayName);
  if (identity.includes("gpt-image")) {
    const name = isGarbageLabel(displayName) ? modelId : displayName || modelId;
    const description = modelId.endsWith("-flare") ? "快速出图，适合日常设计、批量素材与创意测试。"
      : modelId.endsWith("-sunburst") ? "精细创作，注重画面细节、复杂场景与图片编辑。"
      : "均衡图片生成，适合海报设计、图片编辑与日常创作。";
    return { displayName: name, description };
  }
  return { displayName: displayName || modelId, description: "Configured image generation model" };
}
