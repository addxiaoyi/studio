"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function WorkflowRenameDialog({
  title,
  close,
  rename,
}: {
  title: string;
  close(): void;
  rename(title: string): void;
}) {
  const [name, setName] = useState(title);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    rename(name.trim());
    close();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名流程</DialogTitle>
          <DialogDescription>
            使用容易辨认的名称，方便继续创作。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="workflow-rename-form">
          <label htmlFor="workflow-name">流程名称</label>
          <input
            id="workflow-name"
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              完成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
