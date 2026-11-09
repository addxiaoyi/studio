"use client";
import { useEffect, useState } from "react";
import {
  workflowChanges,
  type WorkflowDocument,
  type WorkflowVersion,
} from "@helstera/shared";
import { fetchWorkflowVersions } from "@/lib/canvas-workflow-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { WorkflowMap } from "./navigation-map";

export function WorkflowVersionHistory({
  open,
  onClose,
  token,
  canvasId,
  document,
  disabled,
  onRestore,
  failure,
}: {
  open: boolean;
  onClose(): void;
  token: string;
  canvasId: string;
  document: WorkflowDocument;
  disabled: boolean;
  onRestore(revision: number): Promise<unknown>;
  failure: string;
}) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter deliberately starts a fresh request after a failed read.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    setVersions([]);
    setSelected(0);
    void fetchWorkflowVersions(token, canvasId, document.id)
      .then((rows) => {
        if (alive) {
          setVersions(rows);
          setMore(rows.length === 20);
          setSelected(
            rows.find((row) => row.revision !== document.revision)?.revision ??
              rows[0]?.revision ??
              0,
          );
        }
      })
      .catch((cause) => {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "无法读取版本历史。",
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, token, canvasId, document.id, document.revision, retry]);
  const version = versions.find((row) => row.revision === selected);
  const changes = version ? workflowChanges(document.graph, version.graph) : [];
  const loadMore = async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchWorkflowVersions(
        token,
        canvasId,
        document.id,
        versions.at(-1)?.revision,
      );
      setVersions((current) => [...current, ...rows]);
      setMore(rows.length === 20);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取更早版本。");
    } finally {
      setLoading(false);
    }
  };
  const restore = async () => {
    if (!version || disabled || restoring) return;
    setRestoring(true);
    try {
      const restored = await onRestore(version.revision);
      if (restored) onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "恢复失败，当前版本已保留。",
      );
    } finally {
      setRestoring(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !restoring) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>工作流版本历史</DialogTitle>
          <DialogDescription>
            先核对差异，再恢复为一个新版本。不会执行节点或扣费，当前版本也会保留。
          </DialogDescription>
        </DialogHeader>
        <div className="workflow-version-scroll">
          {loading && <output className="block text-sm">正在读取版本…</output>}
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新加载
              </Button>
            </div>
          )}
          {!loading && !error && !versions.length && (
            <p className="text-sm">
              还没有可恢复版本。下一次保存后会保留快照。
            </p>
          )}
          {!!versions.length && (
            <div className="workflow-version-actions">
              <StyledSelect
                aria-label="选择历史版本"
                value={String(selected)}
                options={versions.map((row) => ({
                  value: String(row.revision),
                  label: `第 ${row.revision} 版 · ${new Date(row.createdAt).toLocaleString()}${row.restoredFrom ? ` · 恢复自第${row.restoredFrom}版` : ""}`,
                }))}
                onChange={(value) => setSelected(Number(value))}
                disabled={restoring}
              />
              {more && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading || restoring}
                  onClick={() => void loadMore()}
                >
                  加载更早版本
                </Button>
              )}
            </div>
          )}
          {version && (
            <>
              <div className="workflow-version-preview mt-4">
                <section>
                  <h3>当前 · 第 {document.revision} 版</h3>
                  <WorkflowMap graph={document.graph} label="当前版本缩略图" />
                </section>
                <section>
                  <h3>恢复预览 · 第 {version.revision} 版</h3>
                  <WorkflowMap
                    graph={version.graph}
                    label="历史版本缩略图"
                    highlight={version.graph.nodes
                      .filter(
                        (node) =>
                          JSON.stringify(node) !==
                          JSON.stringify(
                            document.graph.nodes.find(
                              (prior) => prior.id === node.id,
                            ),
                          ),
                      )
                      .map((node) => node.id)}
                  />
                </section>
              </div>
              <ol className="workflow-version-changes" aria-label="版本差异">
                {changes.map((change, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: This read-only diff has no row state; identical descriptions can occur on different nodes.
                  <li key={index} className="workflow-version-change">
                    <strong>{change.title}</strong>
                    <small>{change.detail}</small>
                  </li>
                ))}
              </ol>
              {!changes.length && (
                <p className="text-sm text-muted-foreground">
                  与当前图内容一致。
                </p>
              )}
            </>
          )}
          {disabled && (
            <output className="block text-sm text-muted-foreground">
              先保存当前草稿或结束当前运行，再恢复历史版本。
            </output>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={restoring} onClick={onClose}>
            返回画布
          </Button>
          <Button
            disabled={
              disabled ||
              restoring ||
              loading ||
              !version ||
              version.revision === document.revision ||
              !changes.length
            }
            onClick={() => void restore()}
          >
            {restoring
              ? "正在恢复…"
              : `确认恢复为第 ${document.revision + 1} 版`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
