"use client";
import { Button } from "@/components/ui/button";
import { StyledSelect } from "@/components/ui/styled-select";
import { useMemo, useState } from "react";
import {
  type WorkflowFieldSample,
  listWorkflowFields,
} from "./upstream-fields";
import "./field-picker.css";

export function WorkflowFieldPicker({
  sample,
  value,
  label,
  disabled,
  jsonOnly = false,
  onChange,
  locate,
}: {
  sample: WorkflowFieldSample | null;
  value: string;
  label: string;
  disabled: boolean;
  jsonOnly?: boolean;
  onChange(path: string): void;
  locate?: ((id: string) => void) | undefined;
}) {
  const [query, setQuery] = useState("");
  const root = jsonOnly
    ? (sample?.output?.json ?? sample?.output)
    : sample?.output;
  const { fields, truncated } = useMemo(() => listWorkflowFields(root), [root]);
  const selected = fields.find((field) => field.path === value);
  const visible = fields.filter((field) =>
    field.path.toLowerCase().includes(query.toLowerCase()),
  );
  function locateSource() {
    if (sample) locate?.(sample.nodeId);
  }
  return (
    <details className="workflow-field-picker rounded-lg border p-2 text-xs">
      <summary className="min-h-7 cursor-pointer font-medium">
        从上游选择{label}字段
      </summary>
      <div className="mt-2 min-w-0 space-y-2 break-words">
        {sample ? (
          <p>
            {sample.title} ·{" "}
            {sample.origin === "input" ? "当前输入" : "上次成功输出"}
          </p>
        ) : (
          <p>先连接 JSON 或文字输入，或运行上游节点获取样本。</p>
        )}
        {sample?.error && <output className="block">{sample.error}</output>}
        {sample?.output && (
          <>
            <label className="block">
              筛选{label}字段
              <input
                className="workflow-field"
                aria-label={`筛选${label}字段`}
                value={query}
                disabled={disabled}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <StyledSelect
              aria-label={`选择${label}字段`}
              value={
                selected &&
                visible.some((field) => field.path === selected.path)
                  ? selected.path
                  : null
              }
              disabled={disabled || !visible.length}
              placeholder={visible.length ? "选择字段" : "没有匹配字段"}
              options={visible.map((field) => ({
                value: field.path,
                label: `${field.path} · ${field.type} · ${field.preview}`,
              }))}
              onChange={onChange}
            />
            {selected && (
              <output className="block">
                {selected.path} · {selected.type} · {selected.preview}
              </output>
            )}
            {value && !selected && (
              <output className="block">
                字段“{value}”在当前上游样本中不存在，请检查来源或修改路径。
              </output>
            )}
            {truncated && <p>较大样本只展示部分字段，可继续手填路径。</p>}
          </>
        )}
        {sample && locate && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={locateSource}
          >
            定位上游节点
          </Button>
        )}
      </div>
    </details>
  );
}
