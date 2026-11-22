import { type WorkflowGraph, validWorkflowPath } from "@helstera/shared";

export type WorkflowFieldSample = {
  nodeId: string;
  title: string;
  origin: "input" | "run";
  output: Record<string, unknown> | null;
  error: string;
};
export type WorkflowField = { path: string; type: string; preview: string };
const MAX_FIELDS = 200;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 20;
const MAX_PREVIEW_LENGTH = 120;

function sourceKey(graph: WorkflowGraph, sourceId: string): string {
  const ids = new Set<string>();
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    queue.push(
      ...graph.edges
        .filter((edge) => edge.target === id)
        .map((edge) => edge.source),
    );
  }
  return JSON.stringify({
    nodes: graph.nodes
      .filter((node) => ids.has(node.id))
      .map((node) => ({ id: node.id, config: node.config, pin: node.pin })),
    edges: graph.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ),
  });
}

export function workflowFieldSample(
  graph: WorkflowGraph,
  nodeId: string,
  outputs: Record<string, Record<string, unknown>> = {},
  runGraph?: WorkflowGraph,
): WorkflowFieldSample | null {
  const inputs = graph.edges.filter((edge) => edge.target === nodeId);
  const source = graph.nodes.find((node) => node.id === inputs[0]?.source);
  if (!source) return null;
  const base = {
    nodeId: source.id,
    title: source.title,
    origin: "input" as const,
  };
  if (inputs.length !== 1)
    return {
      ...base,
      output: null,
      error: "字段节点需要单个上游输入，请先调整连线。",
    };
  if (!source.pin && source.config.kind === "text")
    return {
      ...base,
      output: { text: source.config.text, role: source.config.role },
      error: "",
    };
  if (!source.pin && source.config.kind === "json") {
    try {
      const json: unknown = JSON.parse(source.config.json);
      if (json === null || typeof json !== "object")
        return {
          ...base,
          output: null,
          error: "上游 JSON 输入需要对象或数组。",
        };
      return {
        ...base,
        output: { json, text: JSON.stringify(json, null, 2) },
        error: "",
      };
    } catch {
      return {
        ...base,
        output: null,
        error: "上游 JSON 输入格式无效，请先修复。",
      };
    }
  }
  if (
    outputs[source.id] &&
    runGraph &&
    sourceKey(graph, source.id) === sourceKey(runGraph, source.id)
  ) {
    return {
      ...base,
      origin: "run",
      output: outputs[source.id] ?? null,
      error: "",
    };
  }
  return {
    ...base,
    origin: "run",
    output: null,
    error: "上游尚无匹配当前配置的成功输出。请先运行上游，再选择字段。",
  };
}

export function listWorkflowFields(output: unknown): {
  fields: WorkflowField[];
  truncated: boolean;
} {
  const fields: WorkflowField[] = [];
  let truncated = false;
  function visit(value: unknown, prefix: string, depth: number) {
    if (value === null || typeof value !== "object") return;
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return;
    }
    const keys = Object.keys(value);
    const visible = Array.isArray(value)
      ? keys.slice(0, MAX_ARRAY_ITEMS)
      : keys;
    if (visible.length < keys.length) truncated = true;
    for (const key of visible) {
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
      if (fields.length >= MAX_FIELDS) {
        truncated = true;
        return;
      }
      const path = prefix ? `${prefix}.${key}` : key;
      if (path.length > 120 || !validWorkflowPath(path)) continue;
      const actual = (value as Record<string, unknown>)[key];
      const type =
        actual === null
          ? "空值"
          : Array.isArray(actual)
            ? "数组"
            : typeof actual === "object"
              ? "对象"
              : typeof actual === "number"
                ? "数字"
                : typeof actual === "boolean"
                  ? "布尔值"
                  : "文字";
      const text = Array.isArray(actual)
        ? `${actual.length} 项`
        : actual !== null && typeof actual === "object"
          ? `${Object.keys(actual).length} 个字段`
          : String(actual);
      fields.push({
        path,
        type,
        preview:
          text.length > MAX_PREVIEW_LENGTH
            ? `${text.slice(0, MAX_PREVIEW_LENGTH)}…`
            : text,
      });
      visit(actual, path, depth + 1);
    }
  }
  visit(output, "", 0);
  return { fields, truncated };
}
