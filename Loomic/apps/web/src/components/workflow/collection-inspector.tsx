"use client";
import { useId, type ReactNode } from "react";
import type { WorkflowNode } from "@helstera/shared";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";

type Config = WorkflowNode["config"];
type Props = {
  config: Config;
  disabled: boolean;
  onChange(config: Config): void;
  renderFields(config: Config, change: (config: Config) => void): ReactNode;
};
function moveUp<T>(items: T[], index: number): T[] {
  const prior = items[index - 1];
  const current = items[index];
  if (prior === undefined || current === undefined) return items;
  const next = [...items];
  next[index - 1] = current;
  next[index] = prior;
  return next;
}
export function CollectionInspector({
  config: c,
  disabled,
  onChange,
  renderFields,
}: Props) {
  const controlId = useId();
  if (c.kind === "switch")
    return (
      <div className="workflow-conditions">
        <label htmlFor={`${controlId}-mode`}>
          匹配方式
          <StyledSelect
            id={`${controlId}-mode`}
            aria-label="Switch 匹配方式"
            value={c.mode}
            disabled={disabled}
            options={[
              { value: "first", label: "首个命中出口" },
              { value: "all", label: "全部命中出口" },
            ]}
            onChange={(mode) =>
              onChange({ ...c, mode: mode as "first" | "all" })
            }
          />
        </label>
        {c.cases.map((route, index) => (
          <fieldset key={route.id}>
            <legend>出口 {index + 1}</legend>
            <label>
              出口名称
              <input
                className="workflow-field"
                aria-label={`出口${index + 1}名称`}
                maxLength={40}
                value={route.title}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...c,
                    cases: c.cases.map((item) =>
                      item.id === route.id
                        ? { ...item, title: event.target.value || "未命名出口" }
                        : item,
                    ),
                  })
                }
              />
            </label>
            {renderFields(
              {
                kind: "condition",
                conditions: route.conditions,
                match: route.match,
              },
              (config) => {
                if (config.kind === "condition")
                  onChange({
                    ...c,
                    cases: c.cases.map((item) =>
                      item.id === route.id
                        ? {
                            ...item,
                            conditions: config.conditions,
                            match: config.match,
                          }
                        : item,
                    ),
                  });
              },
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => {
                  onChange({ ...c, cases: moveUp(c.cases, index) });
                }}
              >
                上移出口
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || c.cases.length === 1}
                onClick={() =>
                  onChange({
                    ...c,
                    cases: c.cases.filter((item) => item.id !== route.id),
                  })
                }
              >
                删除出口 {index + 1}
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || c.cases.length >= 6}
          onClick={() =>
            onChange({
              ...c,
              cases: [
                ...c.cases,
                {
                  id: `route-${crypto.randomUUID()}`,
                  title: `分支 ${c.cases.length + 1}`,
                  match: "all",
                  conditions: [
                    { field: "text", operator: "not_empty", value: "" },
                  ],
                },
              ],
            })
          }
        >
          添加出口
        </Button>
        <p className="node-data-caption">
          按上方顺序匹配。没有条件命中时走“默认”；删除出口后请修复原有连线。
        </p>
      </div>
    );
  if (c.kind !== "split" && c.kind !== "batch") return null;
  const cap = (
    <label>
      最多处理项数
      <input
        className="workflow-field"
        aria-label="最多处理项数"
        type="number"
        min={1}
        max={100}
        value={c.maxItems}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            ...c,
            maxItems: Math.min(
              100,
              Math.max(1, Number(event.target.value) || 1),
            ),
          })
        }
      />
      <small>1–100 项。超过上限会停止，不会静默丢弃多余内容。</small>
    </label>
  );
  if (c.kind === "split")
    return (
      <>
        <label htmlFor={`${controlId}-source`}>
          列表来源
          <StyledSelect
            id={`${controlId}-source`}
            aria-label="列表来源"
            value={c.source}
            disabled={disabled}
            options={[
              { value: "json", label: "JSON 数组" },
              { value: "lines", label: "分隔文字" },
            ]}
            onChange={(source) =>
              onChange({ ...c, source: source as "json" | "lines" })
            }
          />
        </label>
        {c.source === "json" ? (
          <label>
            数组字段路径
            <input
              className="workflow-field"
              value={c.path}
              disabled={disabled}
              placeholder="留空使用整个数组，例如 items"
              onChange={(event) => onChange({ ...c, path: event.target.value })}
            />
          </label>
        ) : (
          <label>
            拆分分隔符
            <textarea
              className="workflow-field"
              rows={2}
              value={c.separator}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...c, separator: event.target.value })
              }
            />
            <small>默认换行；空白条目会跳过。</small>
          </label>
        )}
        {cap}
      </>
    );
  return (
    <div className="workflow-conditions">
      {cap}
      <label>
        每批处理项数
        <input
          className="workflow-field"
          aria-label="每批处理项数"
          type="number"
          min={1}
          max={10}
          value={c.batchSize}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...c,
              batchSize: Math.min(
                10,
                Math.max(1, Number(event.target.value) || 1),
              ),
            })
          }
        />
      </label>
      <p className="node-data-caption">
        每项按以下顺序处理，每批保存进度。输出完整列表与合并文字。这里的文字和字段操作不调用模型。
      </p>
      {c.operations.map((operation, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Controlled operation slots follow execution order and carry no local values.
        <fieldset key={index}>
          <legend>逐项动作 {index + 1}</legend>
          {renderFields(operation, (config) => {
            if (
              config.kind === "transform" ||
              config.kind === "template" ||
              config.kind === "extract"
            )
              onChange({
                ...c,
                operations: c.operations.map((item, i) =>
                  i === index ? config : item,
                ),
              });
          })}
          {operation.kind === "template" && (
            <small>{"{{index}}"} 表示从 1 开始的项序号。</small>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || index === 0}
              onClick={() => {
                onChange({ ...c, operations: moveUp(c.operations, index) });
              }}
            >
              上移动作
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || c.operations.length === 1}
              onClick={() =>
                onChange({
                  ...c,
                  operations: c.operations.filter((_, i) => i !== index),
                })
              }
            >
              删除动作 {index + 1}
            </Button>
          </div>
        </fieldset>
      ))}
      <StyledSelect
        aria-label="添加逐项动作"
        value=""
        disabled={disabled || c.operations.length >= 8}
        options={[
          { value: "", label: "添加逐项动作…" },
          { value: "extract", label: "提取字段" },
          { value: "transform", label: "文字处理" },
          { value: "template", label: "文字模板" },
        ]}
        onChange={(kind) => {
          const op =
            kind === "extract"
              ? { kind: "extract" as const, path: "title" }
              : kind === "transform"
                ? {
                    kind: "transform" as const,
                    operation: "trim" as const,
                    search: "",
                    replacement: "",
                  }
                : { kind: "template" as const, template: "{{text}}" };
          onChange({ ...c, operations: [...c.operations, op] });
        }}
      />
    </div>
  );
}
