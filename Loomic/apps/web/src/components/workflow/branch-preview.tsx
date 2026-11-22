"use client";

import { Button } from "@/components/ui/button";
import {
  type WorkflowBranchConfig,
  evaluateWorkflowBranches,
} from "@helstera/shared";
import { type ChangeEvent, useId, useMemo, useState } from "react";
import "./branch-preview.css";

const MAX_SAMPLE_LENGTH = 24_000;
const MAX_VALUE_LENGTH = 120;
const comparisons = {
  equals: "等于",
  not_equals: "不等于",
  contains: "包含文字",
  not_empty: "不为空",
  greater_than: "大于",
  less_than: "小于",
};

function describeValue(value: unknown): string {
  if (value === undefined) return "字段不存在";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
    : text;
}

export function BranchPreview({ config }: { config: WorkflowBranchConfig }) {
  const id = useId();
  const [sample, setSample] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const preview = useMemo(() => {
    if (!submitted)
      return { evaluation: null, error: "", invalidSample: false };
    if (sample.length > MAX_SAMPLE_LENGTH) {
      return {
        evaluation: null,
        error: "样本最多支持 24000 字，请缩短后重试。",
        invalidSample: true,
      };
    }
    let source: unknown;
    try {
      source = JSON.parse(sample);
    } catch {
      return {
        evaluation: null,
        error: '请输入有效的 JSON 对象，例如 {"text":"内容"}。',
        invalidSample: true,
      };
    }
    if (
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source)
    ) {
      return {
        evaluation: null,
        error: "上游输出必须是 JSON 对象，不能是数组、空值或单个文字。",
        invalidSample: true,
      };
    }
    try {
      return {
        evaluation: evaluateWorkflowBranches(
          source as Record<string, unknown>,
          config,
        ),
        error: "",
        invalidSample: false,
      };
    } catch (cause) {
      return {
        evaluation: null,
        error:
          cause instanceof Error
            ? cause.message
            : "条件无法演算，请检查节点设置。",
        invalidSample: false,
      };
    }
  }, [sample, submitted, config]);

  function onSampleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setSample(event.target.value);
    setSubmitted(false);
  }
  function onPreview() {
    setSubmitted(true);
  }
  const evaluation = preview.evaluation;
  const outlets = evaluation?.branches.map((branch) => {
    if (branch === "default") return "默认出口";
    if (config.kind === "condition") return branch === "true" ? "是" : "否";
    return config.cases.find((route) => route.id === branch)?.title ?? branch;
  });

  return (
    <details className="workflow-branch-preview">
      <summary>样本演算</summary>
      <div className="workflow-branch-preview-body">
        <p id={`${id}-hint`}>
          粘贴上游节点输出，查看条件与出口。演算在本机完成，不调用模型或创建任务。
        </p>
        <label htmlFor={`${id}-sample`}>上游输出样本（JSON）</label>
        <textarea
          id={`${id}-sample`}
          className="workflow-field"
          rows={5}
          maxLength={MAX_SAMPLE_LENGTH}
          value={sample}
          onChange={onSampleChange}
          placeholder={'{"text":"内容","json":{"score":80}}'}
          aria-invalid={preview.invalidSample}
          aria-describedby={`${id}-hint${preview.invalidSample ? ` ${id}-error` : ""}`}
          spellCheck={false}
        />
        <Button type="button" size="sm" variant="outline" onClick={onPreview}>
          演算条件
        </Button>
        {preview.error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="workflow-branch-preview-error"
          >
            {preview.error}
          </p>
        )}
        {evaluation ? (
          <div className="workflow-branch-preview-results">
            <output>命中出口：{outlets?.join("、")}</output>
            {config.kind === "switch" &&
              config.mode === "first" &&
              evaluation.routes.length < config.cases.length && (
                <p>按顺序首个命中后停止，其余出口未演算。</p>
              )}
            {evaluation.routes.map((route) => (
              <section key={route.id} aria-label={`${route.title}条件结果`}>
                <h4>
                  {config.kind === "condition" ? "条件结果" : route.title} ·{" "}
                  {route.matched ? "命中" : "未命中"}
                </h4>
                <ol>
                  {route.conditions.map(({ rule, actual, matched }, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Read-only rule results have no persistent identity or local state.
                    <li key={index}>
                      <strong>
                        条件 {index + 1} · {matched ? "满足" : "不满足"}
                      </strong>
                      <span>
                        <code>{rule.field}</code>：{describeValue(actual)}
                      </span>
                      <span>
                        要求：{comparisons[rule.operator]}
                        {rule.operator === "not_empty"
                          ? ""
                          : ` ${describeValue(rule.value)}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          !preview.error && (
            <p className="workflow-branch-preview-empty">
              输入样本后点击“演算条件”，查看命中结果。
            </p>
          )
        )}
      </div>
    </details>
  );
}
