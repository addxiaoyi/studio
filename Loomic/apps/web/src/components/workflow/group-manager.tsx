"use client";
import type { WorkflowGraph } from "@helstera/shared";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  LocateFixed,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
export function WorkflowGroupManager({
  graph,
  selectedIds,
  disabled,
  onChange,
  onLocate,
}: {
  graph: WorkflowGraph;
  selectedIds: string[];
  disabled: boolean;
  onChange(graph: WorkflowGraph): void;
  onLocate(ids: string[]): void;
}) {
  const groups = graph.groups ?? [],
    ids = selectedIds.filter((id) =>
      graph.nodes.some((node) => node.id === id),
    );
  const create = () => {
    if (disabled || ids.length < 2) return;
    const kept = groups
      .map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((id) => !ids.includes(id)),
      }))
      .filter((group) => group.nodeIds.length);
    onChange({
      ...graph,
      groups: [
        ...kept,
        {
          id: `group-${crypto.randomUUID()}`,
          title: `节点组 ${groups.length + 1}`,
          nodeIds: ids,
          collapsed: false,
        },
      ],
    });
  };
  return (
    <section className="workflow-group-manager" aria-label="节点分组">
      <header>
        <h3>
          <Layers size={14} />
          节点分组
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || ids.length < 2}
          onClick={create}
        >
          <Plus size={13} />
          将选中节点分组
        </Button>
      </header>
      {!groups.length && <p>在画布中框选至少两个流程节点，建立分组。</p>}
      {groups.map((group) => {
        const edit = (patch: Partial<typeof group>) =>
          onChange({
            ...graph,
            groups: groups.map((item) =>
              item.id === group.id ? { ...group, ...patch } : item,
            ),
          });
        return (
          <article key={group.id}>
            <div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${group.collapsed ? "展开" : "折叠"}分组${group.title}`}
                onClick={() => edit({ collapsed: !group.collapsed })}
              >
                {group.collapsed ? (
                  <ChevronRight size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </button>
              <input
                aria-label={`分组名称${group.title}`}
                value={group.title}
                disabled={disabled}
                maxLength={100}
                onChange={(event) =>
                  edit({ title: event.target.value || "未命名分组" })
                }
              />
              <span>{group.nodeIds.length} 节点</span>
              <button
                type="button"
                aria-label={`定位分组${group.title}`}
                onClick={() => onLocate(group.nodeIds)}
              >
                <LocateFixed size={14} />
              </button>
            </div>
            <textarea
              aria-label={`分组备注${group.title}`}
              placeholder="说明这一组的用途…"
              value={group.note ?? ""}
              maxLength={2000}
              disabled={disabled}
              onChange={(event) => edit({ note: event.target.value })}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...graph,
                  groups: groups.filter((item) => item.id !== group.id),
                })
              }
            >
              取消分组，保留节点
            </button>
          </article>
        );
      })}
    </section>
  );
}
