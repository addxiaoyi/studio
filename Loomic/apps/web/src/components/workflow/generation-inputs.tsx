"use client";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";

export function WorkflowGenerationInputs({
  preview,
  token,
}: {
  preview: unknown;
  token: string;
}) {
  if (!preview || typeof preview !== "object") return null;
  const input = preview as {
    prompt?: unknown;
    inputAssetIds?: unknown;
    aspectRatio?: unknown;
  };
  const ids = Array.isArray(input.inputAssetIds)
    ? input.inputAssetIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, 6)
    : [];
  return (
    <details className="mt-2">
      <summary>查看实际生成内容与参考素材</summary>
      <p className="mt-2 whitespace-pre-wrap max-h-48 overflow-auto">
        {String(input.prompt ?? "")}
      </p>
      <p className="mt-2 text-muted-foreground">
        参考图片 {ids.length} 张 · 画幅 {String(input.aspectRatio ?? "")}
      </p>
      <div className="workflow-generation-inputs">
        {ids.map((id, index) => (
          <AuthenticatedRecording
            key={id}
            assetId={id}
            accessToken={token}
            kind="image"
            label={`本次生成的参考图 ${index + 1}`}
          />
        ))}
      </div>
    </details>
  );
}
