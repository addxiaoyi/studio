"use client";
import type { WorkflowNode } from "@helstera/shared";
import { StyledSelect } from "@/components/ui/styled-select";
import { Button } from "@/components/ui/button";
import { CollectionInspector } from "./collection-inspector";
export function LogicInspector({
  node,
  disabled,
  onChange,
  branchHint = true,
}: {
  node: WorkflowNode;
  disabled: boolean;
  onChange(node: WorkflowNode): void;
  branchHint?: boolean;
}) {
  const c = node.config,
    field = "workflow-field";
  if (["switch","split","batch"].includes(c.kind)) return <CollectionInspector config={c} disabled={disabled} onChange={config=>onChange({...node,config})} renderFields={(config,change)=><LogicInspector node={{...node,config}} disabled={disabled} branchHint={false} onChange={next=>change(next.config)}/>}/>;
  if (c.kind === "condition")
    return (
      <div className="workflow-conditions">
        <label>
          匹配方式
          <StyledSelect
            aria-label="条件匹配方式"
            value={c.match}
            disabled={disabled}
            options={[
              { value: "all", label: "满足全部条件" },
              { value: "any", label: "满足任一条件" },
            ]}
            onChange={(value) =>
              onChange({
                ...node,
                config: { ...c, match: value as "all" | "any" },
              })
            }
          />
        </label>
        {c.conditions.map((rule, index) => {
          const change = (patch: Partial<typeof rule>) =>
            onChange({
              ...node,
              config: {
                ...c,
                conditions: c.conditions.map((item, i) =>
                  i === index ? { ...item, ...patch } : item,
                ),
              },
            });
          return (
            <fieldset key={index}>
              <legend>条件 {index + 1}</legend>
              <label>
                字段
                <input
                  aria-label={`条件${index + 1}字段`}
                  className={field}
                  disabled={disabled}
                  value={rule.field}
                  placeholder="text 或 json.score"
                  onChange={(event) => change({ field: event.target.value })}
                />
              </label>
              <StyledSelect
                aria-label={`条件${index + 1}比较`}
                value={rule.operator}
                disabled={disabled}
                onChange={(value) =>
                  change({ operator: value as typeof rule.operator })
                }
                options={[
                  { value: "not_empty", label: "不为空" },
                  { value: "equals", label: "等于" },
                  { value: "not_equals", label: "不等于" },
                  { value: "contains", label: "包含文字" },
                  { value: "greater_than", label: "大于" },
                  { value: "less_than", label: "小于" },
                ]}
              />
              {rule.operator !== "not_empty" && (
                <label>
                  比较值
                  <input
                    className={field}
                    disabled={disabled}
                    value={rule.value}
                    onChange={(event) => change({ value: event.target.value })}
                  />
                </label>
              )}
              {c.conditions.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...node,
                      config: {
                        ...c,
                        conditions: c.conditions.filter((_, i) => i !== index),
                      },
                    })
                  }
                >
                  删除条件 {index + 1}
                </Button>
              )}
            </fieldset>
          );
        })}
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || c.conditions.length >= 8}
          onClick={() =>
            onChange({
              ...node,
              config: {
                ...c,
                conditions: [
                  ...c.conditions,
                  { field: "text", operator: "not_empty", value: "" },
                ],
              },
            })
          }
        >
          添加条件
        </Button>
        {branchHint&&<p className="node-data-caption">
          从“是 / 否”出口连接后续节点，未命中的分支不会执行。
        </p>}
      </div>
    );
  if (c.kind === "transform")
    return (
      <>
        <label>
          处理方式
          <StyledSelect
            aria-label="文字处理方式"
            value={c.operation}
            disabled={disabled}
            options={[
              { value: "trim", label: "移除首尾空白" },
              { value: "uppercase", label: "转为大写" },
              { value: "lowercase", label: "转为小写" },
              { value: "replace", label: "替换文字" },
            ]}
            onChange={(value) =>
              onChange({
                ...node,
                config: { ...c, operation: value as typeof c.operation },
              })
            }
          />
        </label>
        {c.operation === "replace" && (
          <>
            <label>
              查找
              <input
                className={field}
                value={c.search}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    config: { ...c, search: event.target.value },
                  })
                }
              />
            </label>
            <label>
              替换为
              <input
                className={field}
                value={c.replacement}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    ...node,
                    config: { ...c, replacement: event.target.value },
                  })
                }
              />
            </label>
          </>
        )}
      </>
    );
  if (c.kind === "json")
    return (
      <label>
        JSON 数据
        <textarea
          className={field}
          rows={6}
          value={c.json}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...node, config: { ...c, json: event.target.value } })
          }
        />
      </label>
    );
  if (c.kind === "extract")
    return (
      <label>
        字段路径
        <input
          className={field}
          value={c.path}
          disabled={disabled}
          placeholder="message 或 user.name"
          onChange={(event) =>
            onChange({ ...node, config: { ...c, path: event.target.value } })
          }
        />
      </label>
    );
  if (c.kind === "template")
    return (
      <label>
        文本模板
        <textarea
          className={field}
          rows={5}
          value={c.template}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              config: { ...c, template: event.target.value },
            })
          }
        />
        <small>使用 {"{{text}}"} 插入上游文字，不执行代码。</small>
      </label>
    );
  if (c.kind === "merge")
    return (
      <label>
        分隔符
        <textarea
          className={field}
          rows={2}
          value={c.separator}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              config: { ...c, separator: event.target.value },
            })
          }
        />
        <small>按输入连线顺序合并，仅使用已命中的分支。</small>
      </label>
    );
  if (c.kind === "delay")
    return (
      <label>
        等待秒数
        <input
          className={field}
          type="number"
          min={1}
          max={60}
          value={c.seconds}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...node,
              config: {
                ...c,
                seconds: Math.max(
                  1,
                  Math.min(60, Number(event.target.value) || 1),
                ),
              },
            })
          }
        />
      </label>
    );
  return null;
}
