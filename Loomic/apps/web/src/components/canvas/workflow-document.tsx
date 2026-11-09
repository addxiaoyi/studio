"use client";
import {productLabel} from "@/lib/product-label";
import { useState } from "react";
import { readWorkflowDocument } from "@helstera/shared";
import { FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import type {
  SceneElement,
  WorkflowCanvasApi,
} from "@/components/workflow/scene";

export function CanvasWorkflowDocument({
  element,
  api,
}: { element: SceneElement; api: WorkflowCanvasApi | null }) {
  const document = readWorkflowDocument(element),
    [editing, setEditing] = useState(false),
    [text, setText] = useState(""),
    [baseMarkdown, setBaseMarkdown] = useState("");
  const [error, setError] = useState("");
  if (!document) return null;
  const edit = () => {
    setText(document.markdown);
    setBaseMarkdown(document.markdown);
    setError("");
    setEditing(true);
  };
  const save = () => {
    if (!api || !text.trim()) return;
    const current = api
      .getSceneElementsIncludingDeleted()
      .find((item) => item.id === element.id && !item.isDeleted);
    if (!current) {
      setError("文稿已删除，请关闭后重新选择。");
      return;
    }
    const source = readWorkflowDocument(current);
    if (source?.markdown !== baseMarkdown) {
      setError("文稿已在别处修改，请关闭后重新打开编辑。");
      return;
    }
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((item) =>
          item.id === element.id
            ? {
                ...item,
                version: (item.version ?? 0) + 1,
                versionNonce: Math.floor(Math.random() * 2_000_000_000),
                updated: Date.now(),
                customData: {
                  ...item.customData,
                  workflowDocument: { title: document.title, markdown: text },
                },
              }
            : item,
        ),
      captureUpdate: "IMMEDIATELY",
    });
    setEditing(false);
  };
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <>
      <article
        className="canvas-workflow-document"
        aria-label={`${productLabel(document.title)}文稿`}
      >
        <header>
          <FileText size={18} />
          <strong>{productLabel(document.title)}</strong>
          <button aria-label="编辑画布文稿" onClick={edit} onPointerDown={stop}>
            <Pencil size={14} />
            编辑
          </button>
        </header>
        <div
          className="canvas-workflow-document-body"
          onPointerDown={stop}
          onWheel={stop}
        >
          <MarkdownRenderer text={document.markdown} />
        </div>
      </article>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑画布文稿</DialogTitle>
            <DialogDescription>
              保存后在画布中排版显示，支持撤销。
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="文稿内容"
            className="workflow-field min-h-64"
            maxLength={20000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button disabled={!text.trim()} onClick={save}>
              保存文稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
