"use client";
import { Button } from "@/components/ui/button";
import type { WorkflowEdit } from "@helstera/shared";

export function WorkflowEditSelection({
  edits,
  selected,
  requested,
  deletionConfirmed,
  disabled,
  toggle,
  confirmDeletion,
  selectAll,
  clear,
  pending,
}: {
  edits: WorkflowEdit[];
  selected: string[];
  requested: string[];
  deletionConfirmed: boolean;
  disabled: boolean;
  pending: boolean;
  toggle(id: string, checked: boolean): void;
  confirmDeletion(checked: boolean): void;
  selectAll(): void;
  clear(): void;
}) {
  const destructive = edits.filter(
    (edit) => edit.destructive && selected.includes(edit.id),
  );
  return (
    <section aria-label="选择 AI 改动" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {pending
          ? "选择要接受的节点和连线。所需依赖会一起列入；未选择的改动保留原版本。"
          : "本次实际接受的改动已勾选，其他改动保留原版本。"}
      </p>
      {pending && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={selectAll}
          >
            全选改动
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={clear}
          >
            清空选择
          </Button>
        </div>
      )}
      <ul className="workflow-change-list">
        {edits.map((edit) => (
          <li key={edit.id}>
            <label className="flex min-h-9 items-start gap-2">
              <input
                type="checkbox"
                checked={selected.includes(edit.id)}
                disabled={disabled}
                onChange={(event) => toggle(edit.id, event.target.checked)}
              />
              <span className="min-w-0 break-words">
                <strong>{edit.title}</strong>
                <small className="block">
                  {edit.detail}
                  {selected.includes(edit.id) && !requested.includes(edit.id)
                    ? " · 所选改动的依赖项"
                    : ""}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {pending && destructive.length > 0 && (
        <label className="flex min-h-9 items-start gap-2 rounded-lg border p-3 text-xs">
          <input
            type="checkbox"
            checked={deletionConfirmed}
            disabled={disabled}
            onChange={(event) => confirmDeletion(event.target.checked)}
          />
          <span>
            确认删除选中的 {destructive.length}{" "}
            个节点及相关连线。原始素材文件保留。
          </span>
        </label>
      )}
    </section>
  );
}
