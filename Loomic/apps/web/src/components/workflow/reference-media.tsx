"use client";
import { useEffect, useState } from "react";
import { Film, ImageIcon, X } from "lucide-react";
import type { WorkflowGraph, WorkflowNode } from "@helstera/shared";
import { StyledSelect } from "@/components/ui/styled-select";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import {
  materialNode,
  type WorkflowCanvasApi,
  type NodePreview,
} from "./scene";
import {
  workflowInputReferences,
  type WorkflowReference,
} from "./material-references";
import "./workflow-media.css";

export function WorkflowReferenceThumb({
  reference,
  token,
}: {
  reference: WorkflowReference;
  token: string;
}) {
  return (
    <div className="workflow-reference-thumb" title={reference.title}>
      {reference.assetId && reference.mediaType === "image" ? (
        <AuthenticatedRecording
          assetId={reference.assetId}
          kind="image"
          accessToken={token}
          label={reference.title}
        />
      ) : reference.mediaType === "video" ? (
        <Film size={24} aria-hidden="true" />
      ) : (
        <ImageIcon size={24} aria-hidden="true" />
      )}
    </div>
  );
}

export function WorkflowReferenceEditor({
  graph,
  node,
  api,
  token,
  disabled,
  previews,
  onEmbed,
  onRemove,
  onFrame,
}: {
  graph: WorkflowGraph;
  node: WorkflowNode;
  api: WorkflowCanvasApi | null;
  token: string;
  disabled: boolean;
  previews: Record<string, NodePreview>;
  onEmbed(elementIds: string[]): void;
  onRemove(sourceId: string): void;
  onFrame(sourceId: string, at: number): void;
}) {
  const [catalog, setCatalog] = useState<WorkflowNode[]>([]);
  useEffect(() => {
    if (!api) return;
    let previous = "";
    const inspect = () => {
      const items = api
        .getSceneElements()
        .map(materialNode)
        .filter((item): item is WorkflowNode => Boolean(item));
      const signature = JSON.stringify(
        items.map((item) => [item.id, item.title, item.config]),
      );
      if (signature !== previous) {
        previous = signature;
        setCatalog(items);
      }
    };
    inspect();
    return api.onChange(inspect);
  }, [api]);
  if (node.config.kind !== "generate") return null;
  const references = workflowInputReferences(graph, node.id, previews);
  return (
    <section className="workflow-reference-editor" aria-label="生成参考素材">
      <header>
        <h4>参考素材</h4>
        <span>{references.length} / 6</span>
      </header>
      <p>
        拖动画布图片或视频到生成节点。视频先抽帧，可调整时刻；素材引用本身不扣费。
      </p>
      <StyledSelect
        aria-label="从画布嵌入参考素材"
        value=""
        disabled={disabled || references.length >= 6}
        options={[
          {
            value: "",
            label: catalog.length ? "从画布选择素材…" : "画布暂无已保存素材",
          },
          ...catalog.flatMap((item) =>
            item.config.kind === "asset"
              ? [
                  {
                    value: item.config.elementId,
                    label: `${item.config.mediaType === "video" ? "视频" : "图片"} · ${item.title}`,
                  },
                ]
              : [],
          ),
        ]}
        onChange={(id) => onEmbed([id])}
      />
      {!references.length && (
        <div className="workflow-reference-empty">
          拖入这里的参考图将显示在节点中
        </div>
      )}
      <ul>
        {references.map((reference) => (
          <li key={reference.sourceId}>
            <WorkflowReferenceThumb reference={reference} token={token} />
            <div className="workflow-reference-info">
              <strong>{reference.title}</strong>
              {reference.frameAt !== undefined ? (
                <label>
                  取帧时刻（秒）
                  <input
                    className="workflow-field"
                    type="number"
                    min={0}
                    max={7200}
                    step={0.1}
                    value={reference.frameAt}
                    disabled={disabled}
                    onChange={(event) => {
                      const at = Number(event.target.value);
                      if (Number.isFinite(at) && at >= 0 && at <= 7200)
                        onFrame(reference.sourceId, at);
                    }}
                  />
                </label>
              ) : (
                <small>
                  {reference.assetId ? "已绑定原素材" : "等待上游生成"}
                </small>
              )}
              {reference.mediaType === "video" && reference.assetId && (
                <details>
                  <summary>预览原视频</summary>
                  <AuthenticatedRecording
                    assetId={reference.assetId}
                    accessToken={token}
                    label={reference.title}
                  />
                </details>
              )}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(reference.sourceId)}
              aria-label={`移除参考素材：${reference.title}`}
            >
              <X size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
