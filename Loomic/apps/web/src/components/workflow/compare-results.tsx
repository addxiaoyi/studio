"use client";
import { useEffect, useState } from "react";
import type { WorkflowNode } from "@helstera/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { AuthenticatedRecording } from "@/components/chat/authenticated-recording";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import {
  fetchWorkflowResults,
  reuseWorkflowOutput,
  type WorkflowResultRun,
} from "@/lib/canvas-workflow-api";

type RunChoice = { goalId: string; revision: number; createdAt: string };
export function WorkflowResultCompare({
  open,
  onClose,
  token,
  canvasId,
  workflowId,
  history,
  disabled,
  onReuse,
}: {
  open: boolean;
  onClose(): void;
  token: string;
  canvasId: string;
  workflowId: string;
  history: RunChoice[];
  disabled: boolean;
  onReuse(node: WorkflowNode): Promise<void>;
}) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState("");
  useEffect(() => {
    if (open) {
      setLeft(history[0]?.goalId ?? "");
      setRight(history[1]?.goalId ?? "");
    }
  }, [open, workflowId]);
  const options = [
    { value: "", label: "选择历史运行" },
    ...history.map((run) => ({
      value: run.goalId,
      label: `第${run.revision}版 · ${new Date(run.createdAt).toLocaleString()}`,
    })),
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="workflow-compare-dialog">
        <DialogHeader>
          <DialogTitle>结果对比与复用</DialogTitle>
          <DialogDescription>
            对照历史参数和实际结果。用作输入会引用已完成素材，不重新生成或扣费。
          </DialogDescription>
        </DialogHeader>
        <div className="workflow-compare-grid">
          {[
            { id: left, set: setLeft, label: "左侧运行" },
            { id: right, set: setRight, label: "右侧运行" },
          ].map((side) => (
            <section key={side.label}>
              <StyledSelect
                aria-label={side.label}
                value={side.id}
                onChange={side.set}
                options={options}
              />
              <ResultColumn
                token={token}
                canvasId={canvasId}
                workflowId={workflowId}
                goalId={side.id}
                disabled={disabled}
                onReuse={onReuse}
              />
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function ResultColumn({
  token,
  canvasId,
  workflowId,
  goalId,
  disabled,
  onReuse,
}: {
  token: string;
  canvasId: string;
  workflowId: string;
  goalId: string;
  disabled: boolean;
  onReuse(node: WorkflowNode): Promise<void>;
}) {
  const [run, setRun] = useState<WorkflowResultRun | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setRun(null);
    setError("");
    if (!goalId) return;
    setLoading(true);
    void fetchWorkflowResults(token, canvasId, workflowId, goalId)
      .then((value) => {
        if (alive) setRun(value);
      })
      .catch((cause) => {
        if (alive) setError(cause.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, canvasId, workflowId, goalId]);
  const reuse = async (nodeId: string, assetId?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const node = await reuseWorkflowOutput(token, canvasId, workflowId, {
        goalId,
        nodeId,
        ...(assetId ? { assetId } : {}),
      });
      await onReuse(node);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "结果复用失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="workflow-compare-results">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载结果…</p>
      ) : !goalId ? (
        <p>选择一个运行以查看结果。</p>
      ) : !run?.results.length ? (
        <p>这个运行尚无可对比的完成结果。</p>
      ) : (
        run.results.map((item) => (
          <article key={item.nodeId}>
            <h3>{item.title}</h3>
            {item.config && ["model","prompt","aspectRatio","duration","resolution","instruction"].some(key=>item.config?.[key]!==undefined) && (
              <div className="workflow-result-params">
                {[
                  "model",
                  "prompt",
                  "aspectRatio",
                  "duration",
                  "resolution",
                  "instruction",
                ]
                  .filter((key) => item.config?.[key] !== undefined)
                  .map((key) => (
                    <p key={key}>
                      <b>
                        {
                          {
                            model: "模型",
                            prompt: "提示词",
                            aspectRatio: "画幅",
                            duration: "时长",
                            resolution: "分辨率",
                            instruction: "要求",
                          }[key]
                        }
                        ：
                      </b>
                      {String(item.config![key])}
                    </p>
                  ))}
              </div>
            )}
            {item.text && (
              <>
                <div className="workflow-result-text">
                  <MarkdownRenderer text={item.text} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || busy}
                  onClick={() => void reuse(item.nodeId)}
                >
                  文字用作输入
                </Button>
              </>
            )}
            {item.assets.map((asset) => (
              <div className="workflow-result-asset" key={asset.id}>
                {asset.available ? (
                  <AuthenticatedRecording
                    assetId={asset.id}
                    accessToken={token}
                    kind={asset.mediaType}
                    maxBytes={250 * 1024 * 1024}
                    label={item.title}
                  />
                ) : (
                  <p role="status">素材已到期、删除或无访问权限。</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || busy || !asset.available}
                  onClick={() => void reuse(item.nodeId, asset.id)}
                >
                  {asset.mediaType === "video" ? "视频" : "图片"}用作输入
                </Button>
              </div>
            ))}
          </article>
        ))
      )}
    </div>
  );
}
