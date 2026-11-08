import type { WorkflowGraph } from "@helstera/shared";
import type { NodePreview } from "./scene";

export type WorkflowReference = {
  sourceId: string;
  edgeId: string;
  title: string;
  assetId?: string;
  mediaType: "image" | "video";
  frameAt?: number;
};

export function workflowInputReferences(
  graph: WorkflowGraph,
  targetId: string,
  previews: Record<string, NodePreview> = {},
): WorkflowReference[] {
  return graph.edges
    .filter((edge) => edge.target === targetId)
    .flatMap((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source);
      if (!source) return [];
      const config = source.config;
      const preview = previews[source.id];
      const base = {
        sourceId: source.id,
        edgeId: edge.id,
        title: source.title,
      };
      if (config.kind === "asset")
        return [
          { ...base, assetId: config.assetId, mediaType: config.mediaType },
        ];
      if (config.kind === "frame") {
        const input = graph.nodes.find((node) =>
          graph.edges.some(
            (link) => link.target === source.id && link.source === node.id,
          ),
        );
        const video =
          input?.config.kind === "asset"
            ? input.config.assetId
            : input && previews[input.id]?.assetId;
        return [
          {
            ...base,
            frameAt: config.at,
            ...(preview?.assetId
              ? { assetId: preview.assetId, mediaType: "image" as const }
              : {
                  ...(video ? { assetId: video } : {}),
                  mediaType: "video" as const,
                }),
          },
        ];
      }
      if (
        config.kind === "generate" ||
        ["trim", "compose", "capture"].includes(config.kind)
      ) {
        return [
          {
            ...base,
            ...(preview?.assetId ? { assetId: preview.assetId } : {}),
            mediaType:
              config.kind === "generate"
                ? config.mediaType
                : ("video" as const),
          },
        ];
      }
      return [];
    });
}
