import {
  layoutWorkflow,
  type WorkflowGraph,
  type WorkflowNode,
} from "./canvas-workflow.js";

export function creativeWorkflow(
  template: "script" | "storyboard" | "film",
): WorkflowGraph {
  const nodes: WorkflowNode[] = [
    {
      id: "story",
      title: "故事与创作要求",
      position: { x: 0, y: 0 },
      config: { kind: "text", role: "story", text: "" },
    },
    {
      id: "author",
      title: template === "script" ? "创作剧本" : "生成分镜",
      position: { x: 0, y: 0 },
      config: {
        kind: "write",
        mode: template === "script" ? "script" : "storyboard",
        instruction: "保留故事中的角色与视觉风格，输出可拍摄的内容。",
        shotCount: 3,
      },
    },
    {
      id: "deliver",
      title: "作品回到画布",
      position: { x: 0, y: 0 },
      config: { kind: "deliver" },
    },
  ];
  const edges: WorkflowGraph["edges"] = [
    { id: "story-author", source: "story", target: "author" },
  ];
  if (template !== "film")
    edges.push({ id: "author-deliver", source: "author", target: "deliver" });
  else {
    nodes.push({
      id: "compose",
      title: "合成三个镜头",
      position: { x: 0, y: 0 },
      config: { kind: "compose", aspect: "landscape" },
    });
    for (let index = 1; index <= 3; index++) {
      nodes.push({
        id: `shot-${index}`,
        title: `镜头 ${index}`,
        position: { x: 0, y: 0 },
        config: { kind: "shot", index },
      });
      nodes.push({
        id: `video-${index}`,
        title: `生成镜头 ${index}`,
        position: { x: 0, y: 0 },
        config: {
          kind: "generate",
          mediaType: "video",
          model: "",
          prompt: "保持人物与场景一致。",
          aspectRatio: "16:9",
          duration: 5,
          resolution: "720p",
        },
      });
      edges.push(
        {
          id: `author-shot-${index}`,
          source: "author",
          target: `shot-${index}`,
        },
        {
          id: `shot-video-${index}`,
          source: `shot-${index}`,
          target: `video-${index}`,
        },
        {
          id: `video-compose-${index}`,
          source: `video-${index}`,
          target: "compose",
        },
      );
    }
    edges.push(
      { id: "compose-deliver", source: "compose", target: "deliver" },
      { id: "script-deliver", source: "author", target: "deliver" },
    );
  }
  return layoutWorkflow({
    title:
      template === "film"
        ? "故事到成片"
        : template === "script"
          ? "故事到剧本"
          : "剧本到分镜",
    nodes,
    edges,
  });
}
