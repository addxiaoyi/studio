type Fields = Record<string, unknown>;
function fields(value: unknown): value is Fields {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeLogic(raw: unknown): unknown {
  if (!fields(raw)) return raw;
  if(raw.kind==="json"&&raw.json!==null&&typeof raw.json==="object")return {...raw,json:JSON.stringify(raw.json)};
  if (raw.kind === "transform" && ["trim", "uppercase", "lowercase"].includes(String(raw.operation)))
    return { ...raw, search: raw.search ?? "", replacement: raw.replacement ?? "" };
  if (raw.kind === "split" && raw.source === "json")
    return { ...raw, path: raw.path ?? "", separator: raw.separator ?? "\n" };
  if (raw.kind === "batch" && Array.isArray(raw.operations))
    return { ...raw, operations: raw.operations.map(normalizeLogic) };
  return raw;
}
export function normalizeWorkflowSuggestion(raw: unknown): unknown {
  if (!fields(raw) || raw.action !== "edit" || !fields(raw.graph) || !Array.isArray(raw.graph.nodes)) return raw;
  return { ...raw, graph: { ...raw.graph, nodes: raw.graph.nodes.map(node => fields(node) ? { ...node, config: normalizeLogic(node.config) } : node) } };
}
