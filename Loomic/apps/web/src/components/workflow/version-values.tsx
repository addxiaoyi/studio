import type { WorkflowGraph, WorkflowNode } from "@helstera/shared";
const names: Record<string, string> = {
  title: "名称",
  note: "备注",
  kind: "节点类型",
  text: "内容",
  json: "JSON 数据",
  model: "模型",
  prompt: "提示词",
  instruction: "创作要求",
  conditions: "条件",
  cases: "分支规则",
  mode: "匹配方式",
  match: "条件组合",
  source: "列表来源",
  path: "字段路径",
  separator: "分隔符",
  maxItems: "项数上限",
  batchSize: "批次大小",
  operations: "逐项动作",
  template: "模板",
  operation: "文字处理",
  search: "查找",
  replacement: "替换",
  seconds: "等待秒数",
  url: "网址",
  record: "录制",
  start: "开始秒数",
  end: "结束秒数",
  duration: "时长",
  aspect: "画幅",
  aspectRatio: "画幅",
  resolution: "分辨率",
  position: "位置",
  pin: "固定结果",
};
function display(value: unknown): string {
  if (value === undefined || value === null) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(display).join("；");
  if (typeof value === "object")
    return Object.entries(value)
      .map(([key, entry]) => `${names[key] ?? key}: ${display(entry)}`)
      .join(" · ");
  return String(value).replaceAll("\n", " ↵ ").slice(0, 1600) || "空白";
}
function fields(node: WorkflowNode): Record<string, unknown> {
  return {
    title: node.title,
    ...node.config,
    note: node.note,
    position: node.position,
    pin: node.pin,
  };
}
export function WorkflowVersionValues({
  before,
  after,
}: { before: WorkflowGraph; after: WorkflowGraph }) {
  return (
    <div className="workflow-version-values">
      {after.nodes.map((node) => {
        const prior = before.nodes.find((item) => item.id === node.id);
        if (!prior) return null;
        const left = fields(prior);
        const right = fields(node);
        const keys = [
            ...new Set([...Object.keys(left), ...Object.keys(right)]),
          ].filter(
            (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
          );
        if (!keys.length) return null;
        return (
          <details key={node.id}>
            <summary>{node.title} · 参数前后值</summary>
            <dl>
              {keys.map((key) => (
                <div key={key}>
                  <dt>{names[key] ?? key}</dt>
                  <dd>
                    <span>当前</span>
                    {display(left[key])}
                  </dd>
                  <dd>
                    <span>恢复后</span>
                    {display(right[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        );
      })}
    </div>
  );
}
